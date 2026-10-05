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
    # 🔴 v2（2026-10-06）收紧为1.0 零容忍：伪科学守门是产品红线
    #   （不给伪科学背书），「基本拦住了」不是可接受状态。
    #   另一个理由：对抗样本只有 11 条，删掉 1 个黑名单词只掉 1/11 = 0.909，
    #   在 0.90 门禁下**仍然通过** —— 阈值宽到能掩盖任何单点失效。
    #   这是 2026-10-06 反向验证实测到的真实假覆盖，不是假想风险。
    "adversarial_acc": 1.0,
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


def is_pseudo_blocked(q):
    """伪科学迷思是否**被词卫兵拦下**（即检索层主动拒答，而非靠阈值兜住）。

    🔴 为什么要单独判（2026-10-06 反向验证抓到的真缺口）：
    `pseudo_reject` 类金标原本只验「最终拒答了」。实测把 `莫扎特` 从
    PSEUDO_PATTERNS 删掉后，该金标**依然通过** —— 因为扩展库后
    top1 恰好是 growth-mindset(raw=0.4992)，低于 LOW=0.54 仍被判拒答。
    → **阈值把黑名单的失效掩盖了**，属典型假覆盖：守门形同虚设且永不报警。
    本函数让「伪科学必须由黑名单主动拦下」成为可测判据，
    删任一黑名单词都会立刻让对应金标变红。
    """
    return method_rag.is_pseudoscience(q)


def run_all(items, dump=False):
    hi_expected = [it for it in items if it["expect"].get("any_of")]
    # 🔴 pseudo_reject 单独考核（见 is_pseudo_blocked 注释），不混进普通拒答统计，
    #    否则同一批样本被两套口径重复计数，且会掩盖词卫兵失效。
    rej_expected = [it for it in items
                    if it["expect"].get("reject")
                    and not (it["category"] == "adversarial"
                             and it.get("kind") == "pseudo_reject")]

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
    # 🔴 pseudo_reject（伪科学迷思）单独统计：必须由词卫兵主动拦下才算通过。
    #    这类样本**不再**混进 rejection_acc 的普通拒答统计里 ——
    #    否则「阈值恰好兜住」会被算成通过（2026-10-06 反向验证实证的假覆盖）。
    pseudo = [it for it in adv if it.get("kind") == "pseudo_reject"]
    out_of_kb = [it for it in items if it["category"] == "out_of_kb"]
    if pseudo:
        pseudo_ok = sum(1 for it in pseudo if is_pseudo_blocked(it["q"]))
        metrics["pseudo_block_acc"] = round(pseudo_ok / len(pseudo), 4)
        metrics["n_pseudo"] = len(pseudo)
        for it in pseudo:
            if not is_pseudo_blocked(it["q"]):
                fails.append({
                    "id": it["id"], "q": it["q"],
                    "want": "pseudo_blocked（必须由词卫兵拦下）",
                    "got": "黑名单未命中 —— 该伪科学词可能已被删除或未收录",
                })
    if adv:
        adv_hit_total = sum(1 for it in adv
                            if it["id"] in {h["id"] for h in hi_expected})
        adv_hit_ok = adv_hit_total - sum(1 for mid in misses if mid.startswith("m-adv"))
        # adversarial_acc 现在**只考核 pseudo_block**：trap_hit 类的召回
        # 已由 recall@5 / MRR 覆盖，混进来会稀释伪科学守门的信号。
        metrics["adversarial_acc"] = metrics.get("pseudo_block_acc", 1.0)
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
