# -*- coding: utf-8 -*-
"""
方法论 → 排程引擎的编译器（构建期执行）
==========================================
把 `data/method_kb.db` 里**机器可消费**的 parameters 抽出来，编译成
`src/data/methodParams.generated.ts`。

为什么走编译而不是运行时查库：
  排程引擎是**纯函数、不 fetch、不读时钟**（scheduler-v2-spec 铁律）。知识要影响排程，
  必须在**构建期**就变成常量，运行时引擎才能保持确定性与可测性。

编译纪律：
  · 每个映射都必须**显式声明来源条目 slug + 参数键**，缺条目或缺键 = 直接报错退出
    （宁可不编译，不许静默产出空参数 —— 对应项目「审计工具自身会骗人」的教训）。
  · 产物是 **.ts 而非 .json**：项目 tsconfig 不需要开 resolveJsonModule，
    且 .ts 自带类型推断。
  · 幂等：同库同内容 → 产物逐字节一致（时间戳除外，已刻意不放）。

用法： python scripts/compile_method_params.py
"""
import os, sys, json, sqlite3, datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "..", "data", "method_kb.db")
OUT_PATH = os.path.join(BASE, "..", "src", "data", "methodParams.generated.ts")

# 显式映射：目标键 <- (条目 slug, 条目 parameters 里的键)
MAPPING = {
    "studyDurations":        ("pomodoro", "durations"),
    "focusMin":              ("pomodoro", "focusMin"),
    "breakMin":              ("pomodoro", "breakMin"),
    "deepBlockMin":          ("deep-work", "deepBlockMin"),
    "maxDeepBlocksPerDay":   ("deep-work", "maxDeepBlocksPerDay"),
    "maxConsecutiveBlockMin": ("cognitive-load-theory", "maxConsecutiveBlockMin"),
    "maxNewConceptsPerBlock": ("cognitive-load-theory", "maxNewConceptsPerBlock"),
    "reviewIntervalsDays":   ("spaced-repetition-tool", "intervalsDays"),
    "dailyReviewCapMin":     ("spaced-repetition-tool", "dailyReviewCapMin"),
    "minSleepHours":         ("sleep-memory-consolidation", "minSleepHours"),
    "napMin":                ("sleep-memory-consolidation", "napMin"),
    "napMaxMin":             ("sleep-memory-consolidation", "napMaxMin"),
    "ultradianCycleMin":     ("ultradian-rhythm", "cycleMin"),
    "ultradianBreakMin":     ("ultradian-rhythm", "breakMin"),
    "examSprintLeadDays":    ("exam-strategy", "sprintLeadDays"),
    "examMockIntervalDays":  ("exam-strategy", "mockIntervalDays"),
    "examMinMockCount":      ("exam-strategy", "minMockCount"),
    "examErrorTaxonomy":     ("mock-exam-analysis", "errorTaxonomy"),
    "habitExpectDays":       ("habit-formation-loop", "expectDays"),
    "mcmTotalHours":         ("mcm-3day-timeline", "totalHours"),
    "mcmDecideTopicByHour":  ("mcm-3day-timeline", "decideTopicByHour"),
    "mcmWritingBlockHours":  ("mcm-3day-timeline", "writingBlockHours"),
    "mcmSleepMinHours":      ("mcm-3day-timeline", "sleepMinHours"),
}

# 每个键的期望类型（编译期校验，防止数据写错类型仍被编译进去）
TYPE_OF = {
    "studyDurations": list, "focusMin": int, "breakMin": int,
    "deepBlockMin": int, "maxDeepBlocksPerDay": int,
    "maxConsecutiveBlockMin": int, "maxNewConceptsPerBlock": int,
    "reviewIntervalsDays": list, "dailyReviewCapMin": int,
    "minSleepHours": int, "napMin": int, "napMaxMin": int,
    "ultradianCycleMin": int, "ultradianBreakMin": int,
    "examSprintLeadDays": int, "examMockIntervalDays": int, "examMinMockCount": int,
    "examErrorTaxonomy": list, "habitExpectDays": int,
    "mcmTotalHours": int, "mcmDecideTopicByHour": int,
    "mcmWritingBlockHours": int, "mcmSleepMinHours": int,
}


def _params(conn, slug):
    row = conn.execute("SELECT parameters, evidence_tier, status FROM entries WHERE slug=?", (slug,)).fetchone()
    if not row:
        raise SystemExit(f"[compile] 缺少来源条目：{slug}（先跑 build_method_kb.py）")
    try:
        p = json.loads(row[0]) if row[0] else {}
    except Exception:
        p = {}
    return p, row[1], row[2]


def compile_params():
    conn = sqlite3.connect(DB_PATH)
    blocks, provenance = {}, {}
    for key, (slug, pkey) in MAPPING.items():
        params, tier, status = _params(conn, slug)
        if pkey not in params:
            raise SystemExit(f"[compile] 条目 {slug} 缺参数键 {pkey}（不允许静默缺省）")
        if status == "deprecated":
            raise SystemExit(f"[compile] 条目 {slug} 已 deprecated，不得编译进引擎")
        val = params[pkey]
        want = TYPE_OF[key]
        if want is int and not isinstance(val, int):
            raise SystemExit(f"[compile] {key} 期望 int，得到 {type(val).__name__}")
        if want is list and not isinstance(val, list):
            raise SystemExit(f"[compile] {key} 期望 list，得到 {type(val).__name__}")
        blocks[key] = val
        provenance[key] = {"slug": slug, "param": pkey, "tier": tier}

    # 分阶段索引：phase -> 该阶段适用的条目（供 methods.ts 做 L3 主动建议）
    by_phase, by_task = {}, {}
    for slug, aw, title, status in conn.execute(
        "SELECT slug, applicable_when, title, status FROM entries WHERE status='verified'"
    ).fetchall():
        try:
            aw = json.loads(aw) if aw else {}
        except Exception:
            aw = {}
        for ph in (aw.get("phase") or ["any"]):
            by_phase.setdefault(ph, []).append(slug)
        for t in (aw.get("task") or []):
            by_task.setdefault(t, []).append(slug)

    # 提示索引（前端/L3 展示用；不进引擎计算路径）
    hints = []
    for slug, title, summary, tier, status in conn.execute(
        "SELECT slug, title, summary, evidence_tier, status FROM entries ORDER BY id"
    ).fetchall():
        hints.append({"slug": slug, "title": title, "summary": summary or "",
                      "tier": tier, "status": status})
    conn.close()

    doc = {
        "_meta": {
            "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "source": "data/method_kb.db",
            "hint_count": len(hints),
            "provenance": provenance,
            "note": "由 scripts/compile_method_params.py 生成 —— 勿手改；改条目后重跑编译。",
        },
        "blocks": blocks,
        "byPhase": by_phase,
        "byTask": by_task,
        "hints": hints,
    }
    return doc


TS_HEADER = """/**
 * ⚠️ 生成文件 —— 由 scripts/compile_method_params.py 从 data/method_kb.db 编译而来。
 * 手改无效：下次编译会被覆盖。要改参数请改 scripts/method_kb_data.py 里对应条目的
 * parameters 字段，然后重跑 `python scripts/compile_method_params.py`。
 *
 * 每个值的出处见 `_meta.provenance`（哪个条目 / 哪个参数键 / 证据等级）。
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
    lines = [TS_HEADER, "export const METHOD_PARAMS = {"]
    m = doc["_meta"]
    lines.append(f"  _meta: {{ generated_at: {json.dumps(m['generated_at'])}, "
                 f"source: {json.dumps(m['source'])}, hint_count: {m['hint_count']} }},")
    lines.append("  blocks: " + _ts_val(doc["blocks"]) + ",")
    lines.append("  byPhase: " + _ts_val(doc["byPhase"]) + ",")
    lines.append("  byTask: " + _ts_val(doc["byTask"]) + ",")
    lines.append("  hints: [")
    for h in doc["hints"]:
        lines.append("    " + _ts_val(h) + ",")
    lines.append("  ],")
    lines.append("} as const;")
    lines.append("")
    lines.append("export type MethodParams = typeof METHOD_PARAMS;")
    return "\n".join(lines)


def main():
    doc = compile_params()
    src = emit(doc)
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)
    print(f"[compile] {OUT_PATH}")
    print(f"[compile] blocks={len(doc['blocks'])} hints={len(doc['hints'])} "
          f"phases={list(doc['byPhase'])} tasks={list(doc['byTask'])}")


if __name__ == "__main__":
    main()
