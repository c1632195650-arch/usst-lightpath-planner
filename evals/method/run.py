# -*- coding: utf-8 -*-
"""
方法论库 · 金标评测台架（eval:method）
======================================
与 `evals/run.py`（上理库 L0/L1）同一套纪律：**确定性判分、0 LLM 成本、--gate 按门禁退出**。

测什么
------
  · 检索质量：normal / edge / adversarial(trap_hit) 的 recall@5 与 MRR
    （期望 slug 出现在 method_rag.search() 的 top5，取最优排名算 RR）
  · 边界纪律：pseudo_reject / out_of_kb 的**拒答率**
    （top1 命中的 raw_vec 必须 < METHOD_RAW_LOW —— 即 study_context 不会把它注入对话）
  · adversarial(pseudo_reject) = 伪科学迷思（左右脑 / 学习风格 / 莫扎特 / 学习金字塔…），
    方法库的立场是「不背书」：这些查询**不允许**命中任何条目（命中即等于给伪科学背书）。

门禁（v1 基线，宁松勿假绿；提升后走 --update-baseline 收紧）
  recall@5 >= 0.90 ｜ MRR >= 0.60 ｜ adversarial_acc >= 0.90 ｜ rejection_acc >= 0.85

用法
----
  python evals/method/run.py                # 全量跑，打印报告
  python evals/method/run.py --gate         # 门禁模式：不达标 exit 1
  python evals/method/run.py --category out_of_kb   # 只跑一类（调试用）
  python evals/method/run.py --dump         # 逐条打印 top3（校准用）
"""
import argparse
import json
import os
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import method_rag  # noqa: E402  （模型懒加载：首次 search 才载入 bge）

GOLDEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden_v1.jsonl")
LAST_RUN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_last_run.json")

# v1 基线门禁
GATES = {
    "recall@5": 0.90,
    "mrr": 0.60,
    "adversarial_acc": 0.90,
    "rejection_acc": 0.85,
}


def load_golden(path=GOLDEN):
    items = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                items.append(json.loads(line))
    return items


def is_rejected(hits):
    """拒答判定 = study_context 同口径：没有命中，或 top1 raw_vec 低于 METHOD_RAW_LOW。"""
    if not hits:
        return True
    return float(hits[0].get("raw_vec", 0.0)) < method_rag.METHOD_RAW_LOW


def run_all(items, dump=False):
    hi_expected = [it for it in items if it["expect"].get("any_of")]
    rej_expected = [it for it in items if it["expect"].get("reject")]

    hits5, misses, rrs = 0, [], []
    fails = []
    for it in hi_expected:
        res = method_rag.search(it["q"], k=5)
        slugs = [h["slug"] for h in res]
        want = it["expect"]["any_of"]
        rank = next((i + 1 for i, s in enumerate(slugs) if s in want), None)
        if rank:
            hits5 += 1
            rrs.append(1.0 / rank)
        else:
            misses.append(it["id"])
            rrs.append(0.0)
            fails.append({"id": it["id"], "q": it["q"], "want": want,
                          "got": [(h["slug"], h["raw_vec"]) for h in res[:3]]})
        if dump:
            print(f"[{it['id']}] {it['q']}")
            for h in res[:3]:
                print(f"    {h['slug']:<28} raw={h['raw_vec']} score={h['score']}")
            print(f"    -> {'HIT rank ' + str(rank) if rank else 'MISS'}")

    rej_ok, rej_fails = 0, []
    for it in rej_expected:
        res = method_rag.search(it["q"], k=5)
        if is_rejected(res):
            rej_ok += 1
        else:
            rej_fails.append({"id": it["id"], "q": it["q"],
                              "top": (res[0]["slug"], res[0]["raw_vec"]) if res else None})
            fails.append({"id": it["id"], "q": it["q"], "want": "reject",
                          "got": [(h["slug"], h["raw_vec"]) for h in res[:3]]})
        if dump:
            top = res[0] if res else None
            print(f"[{it['id']}] {it['q']}  -> top={top and top['slug']} "
                  f"raw={top and top['raw_vec']} {'REJECT✅' if is_rejected(res) else 'LEAK❌'}")

    n_hit, n_rej = len(hi_expected), len(rej_expected)
    metrics = {
        "recall@5": round(hits5 / n_hit, 4) if n_hit else 1.0,
        "mrr": round(sum(rrs) / len(rrs), 4) if rrs else 1.0,
        "rejection_acc": round(rej_ok / n_rej, 4) if n_rej else 1.0,
    }
    adv = [it for it in items if it["category"] == "adversarial"]
    if adv:
        adv_ids_hit = {it["id"] for it in hi_expected}
        adv_rej_total = sum(1 for it in adv if it["id"] not in adv_ids_hit)
        adv_rej_ok = adv_rej_total - sum(1 for f in rej_fails if f["id"].startswith("m-adv"))
        adv_hit_total = sum(1 for it in adv if it["id"] in adv_ids_hit)
        adv_hit_ok = adv_hit_total - sum(1 for mid in misses if mid.startswith("m-adv"))
        metrics["adversarial_acc"] = round(
            (adv_rej_ok + adv_hit_ok) / len(adv), 4)
    metrics["n_hit_expected"] = n_hit
    metrics["n_reject_expected"] = n_rej
    metrics["n_total"] = len(items)
    return metrics, fails, misses, rej_fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gate", action="store_true", help="门禁模式：不达标 exit 1")
    ap.add_argument("--dump", action="store_true", help="逐条打印 top3")
    ap.add_argument("--category", default=None, help="只跑某一类（normal/edge/adversarial/out_of_kb）")
    ap.add_argument("--update-baseline", action="store_true", help="把本次指标写为门禁基线（人工确认后）")
    args = ap.parse_args()

    items = load_golden()
    if args.category:
        items = [it for it in items if it["category"] == args.category]
    t0 = time.time()
    metrics, fails, misses, rej_fails = run_all(items, dump=args.dump)
    dt = time.time() - t0

    global GATES
    if args.update_baseline:
        GATES = {k: metrics[k] for k in GATES if k in metrics}
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "baseline.json"),
                  "w", encoding="utf-8") as f:
            json.dump(GATES, f, ensure_ascii=False, indent=1)
        print(f"[eval:method] 基线已更新 -> baseline.json: {GATES}")

    print("=" * 64)
    print(f"eval:method  golden={metrics['n_total']} 条  用时 {dt:.1f}s  "
          f"(hit={metrics['n_hit_expected']} reject={metrics['n_reject_expected']})")
    for k, v in metrics.items():
        if k.startswith("n_"):
            continue
        gate = GATES.get(k)
        ok = "✅" if gate is None or v >= gate else "❌"
        print(f"  {k:<18} {v:<8} gate>={gate}  {ok}" if gate else f"  {k:<18} {v}")
    if fails:
        print("-" * 64)
        print(f"未达标 {len(fails)} 条：")
        for f in fails:
            print(f"  [{f['id']}] {f['q']}")
            print(f"      want={f['want']}  got={f['got']}")

    report = {"metrics": metrics, "misses": misses, "reject_fails": rej_fails, "fails": fails}
    with open(LAST_RUN, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)

    if args.gate:
        bad = [k for k, g in GATES.items() if k in metrics and metrics[k] < g]
        if bad:
            print(f"[eval:method] GATE FAIL: {bad}")
            sys.exit(1)
        print("[eval:method] GATE PASS ✅")


if __name__ == "__main__":
    main()
