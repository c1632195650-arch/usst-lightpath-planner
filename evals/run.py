# -*- coding: utf-8 -*-
"""
评测系统 · 台架（2026-09-18 P0）
================================
一条命令跑完「双端确定性套件 + 检索层评测」，输出指标、对比基线、按门禁退出。
设计原则（与业界共识一致）：**能用确定性判分就不用模型裁判**——
本文件里没有任何 LLM 调用，所以它便宜到可以挂在每次提交上。

套件划分
--------
  l0  确定性套件（双端，0 成本）
      后端：test_campus / test_direct / test_rag
      前端：npm test:ui / test:engine / typecheck
      → 门禁：**必须 100%**（回归集的意义就是恒为 100%）

  l1  检索层评测（0 成本，需要后端活着）
      · 图谱实体召回：/api/poi?q=<问句> 里有没有期望实体
      · 文档召回：/api/search?q=<问句> 的 recall@5 与 MRR
      · 模板直答正确性：/api/chat 对存在性题应走 mode=template（零 LLM 成本）
      → 门禁：entity_recall=1.00、template_acc=1.00、recall@5≥0.90、违禁词命中=0

  e2e 端到端对话（**要花 LLM 的钱**，默认不跑，留给夜间/发版前）
      全量 golden 过 /api/chat，检查 must_include / must_not_include / mode / 来源文档

用法
----
  python evals/run.py --suite l0 --gate              # 提交前（≈1 分钟）
  python evals/run.py --suite l1 --gate              # 提交前（需后端）
  python evals/run.py --suite all --gate             # 提交前全量免费档
  python evals/run.py --suite e2e --base http://127.0.0.1:8000   # 夜间档（花钱）
  python evals/run.py --suite l1 --update-baseline   # 确认新基线（指标提升后）
"""
import argparse
import datetime
import glob
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNS_DIR = os.path.join(ROOT, "evals", "runs")
BASE_LINE = os.path.join(RUNS_DIR, "baseline.json")
NODE_DIR = r"C:\Users\CY\.workbuddy\binaries\node\versions\24.14.0"
PY = sys.executable          # 谁调用我，就用谁的解释器（托管 venv）

GATES = {"entity_recall": 1.00, "template_acc": 1.00, "recall@5": 0.90, "forbidden_hits": 0}


def env():
    e = os.environ.copy()
    if os.path.isdir(NODE_DIR):
        e["PATH"] = NODE_DIR + os.pathsep + e.get("PATH", "")
    e["NO_PROXY"] = e["no_proxy"] = "127.0.0.1,localhost"
    return e


def sh(cmd, timeout=900):
    t0 = time.time()
    p = subprocess.run(cmd, cwd=ROOT, env=env(), shell=True,
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=timeout)
    return p.returncode, (p.stdout or "") + (p.stderr or ""), time.time() - t0


_SUM = re.compile(r"汇总：(\d+)/(\d+)")
_NODE = re.compile(r"^# pass (\d+)|^ℹ pass (\d+)|^# fail (\d+)|^ℹ fail (\d+)", re.M)


def parse_nums(out):
    m = _SUM.search(out)
    if m:
        return int(m.group(1)), int(m.group(2))
    p = f = None
    for line in out.splitlines():
        s = line.strip().lstrip("ℹ# ").strip()
        mm = re.match(r"pass (\d+)", s)
        if mm:
            p = int(mm.group(1))
        mm = re.match(r"fail (\d+)", s)
        if mm:
            f = int(mm.group(1))
    if p is not None:
        return p, p + (f or 0)
    return None, None


def suite_l0():
    """双端确定性套件。返回 [(名称, 端, pass, total, rc, 秒)]"""
    cmds = [
        ("test_campus", "后端", f'"{PY}" scripts/test_campus.py'),
        ("test_direct", "后端", f'"{PY}" scripts/test_direct.py'),
        ("test_rag", "后端", f'"{PY}" scripts/test_rag.py'),
        ("judge_rules", "评测", f'"{PY}" evals/test_judge_rules.py'),
        ("test:ui", "前端", "npm run test:ui"),
        ("test:engine", "前端", "npm run test:engine"),
        ("typecheck", "前端", "npm run typecheck"),
    ]
    rows = []
    for name, side, cmd in cmds:
        rc, out, sec = sh(cmd)
        p, t = parse_nums(out)
        rows.append({"name": name, "side": side, "pass": p, "total": t,
                     "rc": rc, "sec": round(sec, 1),
                     "tail": "\n".join(out.strip().splitlines()[-6:])})
        mark = "✅" if rc == 0 else "❌"
        print(f"  {mark} [{side}] {name:<12} {'' if p is None else f'{p}/{t}':<8} "
              f"{round(sec,1)}s" + ("" if rc == 0 else "  ← 看 tail"))
        if rc != 0:
            print("      " + (rows[-1]["tail"].replace("\n", "\n      ")))
    return rows


# ---------------- HTTP（与 libao 调试器同一约定：回环不走代理） ----------------
def _get(base, path, timeout=30):
    with urllib.request.urlopen(base + path, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _post(base, path, obj, timeout=90):
    req = urllib.request.Request(base + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def load_golden(version="v1"):
    path = os.path.join(ROOT, "evals", "golden", f"golden_{version}.jsonl")
    return [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]


def suite_l1(base):
    """检索层评测（免费）。返回 (per_task, metrics)"""
    items = load_golden()
    per, t0 = [], time.time()
    # 🔴 门禁只统计 split=regression（真值硬、可本地校验）；
    #    capability（期望较软，如主题召回）单独记录为观察值，**不参与门禁** ——
    #    否则软期望的噪声会伪装成产品退步（2026-09-18 首跑就踩到这条）。
    hits5 = mrr_sum = n_doc = 0
    c_hits5 = c_n_doc = 0
    ent_ok = ent_n = 0
    tpl_ok = tpl_n = 0
    forbidden = []

    for it in items:
        q = it["q"]
        gated = it["split"] == "regression"
        rec = {"id": it["id"], "q": q, "src": it["src"],
               "class": it["class"], "split": it["split"]}
        enc = urllib.parse.quote(q)
        # ① 图谱实体召回
        ent = (it.get("expect") or {}).get("entity")
        if ent:
            ent_n += 1
            try:
                r = _get(base, f"/api/poi?q={enc}&k=5")
                names = [x["name"] for x in r.get("results", [])]
                ok = ent in names
                rec["entity_hit"] = ok
                rec["entity_top5"] = names
                ent_ok += ok
            except Exception as e:
                rec["entity_hit"] = None
                rec["error"] = str(e)
        # ② 文档召回
        docs = (it.get("expect") or {}).get("docs") or []
        if docs:
            if gated:
                n_doc += 1
            else:
                c_n_doc += 1
            try:
                r = _get(base, f"/api/search?q={enc}&k=5")
                titles = [x["title"] for x in r.get("results", [])]
                rank = next((i + 1 for i, t in enumerate(titles)
                             if any(d == t or d in t or t in d for d in docs)), 0)
                rec["doc_rank"] = rank
                rec["docs_top5"] = titles
                if gated:
                    hits5 += 1 if rank else 0
                    mrr_sum += (1.0 / rank) if rank else 0.0
                else:
                    c_hits5 += 1 if rank else 0
            except Exception as e:
                rec["doc_rank"] = None
                rec["error"] = str(e)
        # ③ 模板直答正确性（存在性正例：应 0 LLM 走模板）
        if it["split"] == "regression" and it["kind"] in ("exists", "where", "hours") \
                and it["src"] != "brand_absent":
            tpl_n += 1
            try:
                d = _post(base, "/api/chat", {"q": q, "user_id": "u-eval",
                                              "session_id": f"s-eval-{it['id']}"})
                ans = d.get("answer", "")
                mi = it["expect"].get("must_include") or []
                bad = [k for k in (it["expect"].get("must_not_include") or []) if k in ans]
                good = (d.get("mode") == "template" and not bad
                        and any(k in ans for k in mi) if mi else d.get("mode") == "template")
                rec.update({"mode": d.get("mode"), "tools": d.get("tools"),
                            "answer": ans[:200], "template_ok": bool(good)})
                tpl_ok += bool(good)
                if bad:
                    forbidden.append({"id": it["id"], "q": q, "hit": bad})
            except Exception as e:
                rec["template_ok"] = None
                rec["error"] = str(e)
        per.append(rec)

    m = {"n": len(items), "entities": ent_n, "docs": n_doc, "templates": tpl_n,
         "entity_recall": round(ent_ok / ent_n, 4) if ent_n else 1.0,
         "template_acc": round(tpl_ok / tpl_n, 4) if tpl_n else 1.0,
         "recall@5": round(hits5 / n_doc, 4) if n_doc else 1.0,
         "mrr": round(mrr_sum / n_doc, 4) if n_doc else 1.0,
         # 观察值（capability，不门禁）：soft 期望的召回情况
         "obs_cap_recall@5": round(c_hits5 / c_n_doc, 4) if c_n_doc else None,
         "obs_cap_docs": c_n_doc,
         "forbidden_hits": len(forbidden), "forbidden": forbidden,
         "sec": round(time.time() - t0, 1)}
    return per, m


def suite_e2e(base):
    """端到端（花钱档）：全量 golden 过对话，规则判分（规则档免费，裁判档 P1）"""
    items = load_golden()
    per, ok_n = [], 0
    for it in items:
        try:
            d = _post(base, "/api/chat", {"q": it["q"], "user_id": "u-e2e",
                                          "session_id": f"s-e2e-{it['id']}"})
            ans = d.get("answer", "")
            mi = it["expect"].get("must_include") or []
            mn = it["expect"].get("must_not_include") or []
            bad = [k for k in mn if k in ans]
            good = (not bad) and (not mi or any(k in ans for k in mi))
            if it["kind"] == "absent":
                neg = re.search(r"(没有|没得|查无|并没有|不确定|没查到)", ans)
                good = bool(neg) and not re.search(r"(在.{0,8}(楼|食堂|超市|店))", ans)
            per.append({"id": it["id"], "q": it["q"], "ok": good, "mode": d.get("mode"),
                        "tools": d.get("tools"), "raw": d.get("top_raw_vec"),
                        "answer": ans[:160], "bad": bad})
            ok_n += bool(good)
        except Exception as e:
            per.append({"id": it["id"], "q": it["q"], "ok": False, "error": str(e)})
    return per, {"n": len(items), "acc": round(ok_n / len(items), 4) if items else 0.0}


def compare_baseline(metrics):
    if not os.path.exists(BASE_LINE):
        return ["（无基线，本次可作基线：--update-baseline）"]
    old = json.load(open(BASE_LINE, encoding="utf-8")).get("metrics", {})
    lines = []
    for k, v in metrics.items():
        if isinstance(v, (int, float)) and k in old:
            d = round(v - old[k], 4)
            arrow = "→" if d == 0 else ("↑" if d > 0 else "↓")
            flag = "" if d >= 0 else "  ⚠️ 退步"
            lines.append(f"   {k:<14} {old[k]} {arrow} {v}{flag}")
    return lines or ["（基线里没有可比指标）"]


def main():
    ap = argparse.ArgumentParser(description="梨宝评测台架")
    ap.add_argument("--suite", default="all", choices=["l0", "l1", "e2e", "all"])
    ap.add_argument("--base", default=os.environ.get("LIBAO_BASE", "http://127.0.0.1:8000"))
    ap.add_argument("--gate", action="store_true", help="按门禁阈值设退出码")
    ap.add_argument("--update-baseline", action="store_true")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    ts = time.strftime("%Y%m%d-%H%M%S")
    result = {"ts": ts, "base": base, "suite": args.suite, "metrics": {}, "tasks": []}
    fails = []

    print(f"🧪 梨宝评测 · suite={args.suite} · 后端 {base}\n")
    if args.suite in ("l0", "all"):
        print("== L0 确定性套件（双端 · 0 成本 · 门禁 100%）==")
        rows = suite_l0()
        result["l0"] = rows
        bad = [r["name"] for r in rows if r["rc"] != 0]
        result["metrics"]["l0_all_pass"] = 1.0 if not bad else 0.0
        if bad:
            fails.append(f"L0 套件未全绿：{bad}")
        print()

    if args.suite in ("l1", "all"):
        print("== L1 检索层评测（0 成本 · 需后端活着）==")
        try:
            _get(base, "/api/health", timeout=6)
        except Exception as e:
            print(f"  ❌ 后端不可达：{e}\n     先启动：python server/app.py")
            return 2
        per, m = suite_l1(base)
        result["tasks"] = per
        result["metrics"].update(m)
        print(f"  用例 {m['n']} 条｜实体召回 {m['entity_recall']}"
              f"（{m['entities']} 题）｜模板直答 {m['template_acc']}（{m['templates']} 题）")
        print(f"  门禁档文档 recall@5 {m['recall@5']}｜MRR {m['mrr']}（{m['docs']} 题）"
              f"｜违禁词命中 {m['forbidden_hits']}｜{m['sec']}s")
        if m.get("obs_cap_recall@5") is not None:
            print(f"  观察档（capability，不门禁）recall@5 {m['obs_cap_recall@5']}"
                  f"（{m['obs_cap_docs']} 题，软期望）")
        for g, thr in GATES.items():
            v = m.get(g)
            if v is None:
                continue
            good = (v >= thr) if g != "forbidden_hits" else (v <= thr)
            print(f"   {'✅' if good else '❌'} 门禁 {g} = {v}（要求 {'≥' if g!='forbidden_hits' else '≤'} {thr}）")
            if not good:
                fails.append(f"{g}={v} 未达门禁 {thr}")
        if m["forbidden"]:
            for f in m["forbidden"][:5]:
                print(f"      🔴 违禁词：{f['q']} → {f['hit']}")
        print()

    if args.suite == "e2e":
        print("== E2E 对话评测（花钱档）==")
        per, m = suite_e2e(base)
        result["tasks"] = per
        result["metrics"].update(m)
        print(f"  准确率 {m['acc']}（{m['n']} 条）")

    print("== 与基线对比 ==")
    for line in compare_baseline(result["metrics"]):
        print(line)

    os.makedirs(RUNS_DIR, exist_ok=True)
    out = os.path.join(RUNS_DIR, f"run_{ts}.json")
    json.dump(result, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if args.update_baseline:
        json.dump({"ts": ts, "metrics": result["metrics"]},
                  open(BASE_LINE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"\n📌 基线已更新：{BASE_LINE}")
    print(f"明细：{out}")

    if args.gate and fails:
        print("\n🚫 门禁未通过：")
        for f in fails:
            print("   ❌", f)
        return 1
    if args.gate:
        print("\n✅ 门禁全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
