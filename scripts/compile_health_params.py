# -*- coding: utf-8 -*-
"""
健康库 → 排程引擎的编译器（构建期执行）
==========================================
把 `data/health_kb.db` 里**机器可消费**的 parameters 编译成
`src/data/healthParams.generated.ts`。

与方法库编译器同构（构建期固化、引擎保持纯函数），但多了两条更严的过滤纪律：

  · **安全升级条目（escalate=1）一律不编译** —— 那是「就医口径」，不是排程参数；
    引擎若把「胸痛」当成可排的任务参数就荒唐了。
  · **争议条目（contested）一律不编译** —— 证据不一致的数值不能进确定性引擎。
  · 只编译**通用人群区间**；凡是「个体差异极大、需要医嘱」的数值（如减重速度、
    蛋白质训练期区间）要么不进编译，要么只进 sedentary 基线并保留声明。

映射来源：`health_kb_data.COMPILE_TARGETS`（显式声明，缺条目/缺键/类型不符 = 报错退出）。

用法： python scripts/compile_health_params.py
"""
import os, sys, json, sqlite3, datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
DB_PATH = os.path.join(BASE, "..", "data", "health_kb.db")
OUT_PATH = os.path.join(BASE, "..", "src", "data", "healthParams.generated.ts")

import health_kb_data as DATA

MAPPING = DATA.COMPILE_TARGETS

# 期望类型（编译期校验）
TYPE_OF = {
    "sleepMinHours": int, "sleepWindowHours": list,
    "weeklyModerateMin": int, "weeklyVigorousMin": int, "minimumSessionMin": int,
    "strengthDaysPerWeek": int, "sedentaryBreakMin": int, "dailyStepsTarget": int,
    "napMin": int, "napMaxMin": int, "mealsPerDay": int,
    "saltMaxG": int, "addedSugarMaxG": int,
    "waterMlMale": int, "waterMlFemale": int,
    "vegetableMinG": int, "dairyMinMl": int,
    "proteinGPerKgSedentary": float, "weeklyLoadIncreasePct": int,
}


def _load(conn, slug):
    row = conn.execute(
        "SELECT parameters, evidence_tier, status, escalate FROM entries WHERE slug=?", (slug,)
    ).fetchone()
    if not row:
        raise SystemExit(f"[compile] 缺少来源条目：{slug}（先跑 build_health_kb.py）")
    try:
        p = json.loads(row[0]) if row[0] else {}
    except Exception:
        p = {}
    return p, row[1], row[2], row[3]


def compile_params():
    conn = sqlite3.connect(DB_PATH)
    blocks, provenance = {}, {}
    for key, (slug, pkey) in MAPPING.items():
        params, tier, status, esc = _load(conn, slug)
        if pkey not in params:
            raise SystemExit(f"[compile] 条目 {slug} 缺参数键 {pkey}（不允许静默缺省）")
        if status == "deprecated":
            raise SystemExit(f"[compile] 条目 {slug} 已 deprecated，不得编译进引擎")
        if status == "contested":
            raise SystemExit(f"[compile] 条目 {slug} 为 contested（证据不一致），不得编译进确定性引擎")
        if esc:
            raise SystemExit(f"[compile] 条目 {slug} 是安全升级条目（escalate=1），不得编译成排程参数")
        val = params[pkey]
        want = TYPE_OF[key]
        if want is int and (not isinstance(val, int) or isinstance(val, bool)):
            raise SystemExit(f"[compile] {key} 期望 int，得到 {type(val).__name__}")
        if want is float and (isinstance(val, bool) or not isinstance(val, (int, float))):
            raise SystemExit(f"[compile] {key} 期望 number，得到 {type(val).__name__}")
        if want is list and not isinstance(val, list):
            raise SystemExit(f"[compile] {key} 期望 list，得到 {type(val).__name__}")
        blocks[key] = val
        provenance[key] = {"slug": slug, "param": pkey, "tier": tier}

    # 分域索引（供 UI / L3 主动建议用；不进引擎计算路径）
    by_domain = {}
    for slug, domain, status in conn.execute(
        "SELECT slug, domain, status FROM entries WHERE status='verified' ORDER BY id"
    ).fetchall():
        by_domain.setdefault(domain, []).append(slug)

    hints = []
    for slug, domain, title, summary, tier, status, esc in conn.execute(
        "SELECT slug, domain, title, summary, evidence_tier, status, escalate FROM entries ORDER BY id"
    ).fetchall():
        hints.append({"slug": slug, "domain": domain, "title": title,
                      "summary": summary or "", "tier": tier, "status": status,
                      "escalate": bool(esc)})
    conn.close()

    return {
        "_meta": {
            "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "source": "data/health_kb.db",
            "hint_count": len(hints),
            "provenance": provenance,
            "disclaimer": DATA.DISCLAIMER,
            "note": "由 scripts/compile_health_params.py 生成 —— 勿手改；改条目后重跑编译。",
        },
        "blocks": blocks,
        "byDomain": by_domain,
        "hints": hints,
    }


TS_HEADER = """/**
 * ⚠️ 生成文件 —— 由 scripts/compile_health_params.py 从 data/health_kb.db 编译而来。
 * 手改无效：下次编译会被覆盖。要改参数请改 scripts/health_kb_data.py 里对应条目的
 * parameters 字段，然后重跑 `python scripts/compile_health_params.py`。
 *
 * 过滤纪律：escalate（安全升级）与 contested（争议）条目**不会**出现在这里 ——
 * 它们只走对话层口径，不进确定性排程引擎。
 * 每个值的出处见 `_meta.provenance`（条目 slug / 参数键 / 证据等级）。
 */
"""


def _ts_val(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ", ".join(_ts_val(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{ " + ", ".join(f"{json.dumps(k, ensure_ascii=False)}: {_ts_val(x)}" for k, x in v.items()) + " }"
    return repr(v)


def emit(doc):
    m = doc["_meta"]
    lines = [TS_HEADER, "export const HEALTH_PARAMS = {"]
    # provenance 必须落进产物：否则「某个数值来自哪条指南」在前端不可追溯，
    # 也无法在测试里断言「争议/安全条目没被编译进来」。
    lines.append(f"  _meta: {{ generated_at: {json.dumps(m['generated_at'])}, "
                 f"source: {json.dumps(m['source'])}, hint_count: {m['hint_count']}, "
                 f"disclaimer: {json.dumps(m['disclaimer'], ensure_ascii=False)}, "
                 f"provenance: {_ts_val(m['provenance'])} }},")
    lines.append("  blocks: " + _ts_val(doc["blocks"]) + ",")
    lines.append("  byDomain: " + _ts_val(doc["byDomain"]) + ",")
    lines.append("  hints: [")
    for h in doc["hints"]:
        lines.append("    " + _ts_val(h) + ",")
    lines.append("  ],")
    lines.append("} as const;")
    lines.append("")
    lines.append("export type HealthParams = typeof HEALTH_PARAMS;")
    return "\n".join(lines)


def main():
    doc = compile_params()
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(emit(doc))
    print(f"[compile] {OUT_PATH}")
    print(f"[compile] blocks={len(doc['blocks'])} hints={len(doc['hints'])} "
          f"domains={list(doc['byDomain'])}")


if __name__ == "__main__":
    main()
