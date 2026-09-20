# -*- coding: utf-8 -*-
"""
评测系统 · 裁判校准（2026-09-18 P1）
=====================================
裁判本身是模型，必须先证明「它跟人一致」才能进 CI —— 这是 LLM-as-Judge 综述里
最硬的一条纪律。本文件把它变成可执行的检查：

  一致率（二值/档位判定）  > 70%     —— 达不到就不许门禁
  Spearman ρ（数值打分）   > 0.75    —— 达不到就不许门禁
  n < 10                            —— 样本不足，**拒绝下结论**（不许说"通过"）

用法
----
  python evals/calibrate.py --init              # 从 golden 里抽 20 条生成待标注模板
  #   → 人工把 labels.jsonl 里的 "human" 字段填上（分数或 0/1），其余别动
  python evals/calibrate.py --provider ollama   # 跑裁判并出校准结论
  python evals/calibrate.py --provider none     # 只验证管线（不发请求，必定"未判定"）

⚠️ 本脚本**不会**自动把结论写进 CI 配置：门槛达标后由人把 `--judge` 加进夜间档。
"""
import argparse
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "evals"))

import judge  # noqa: E402

LABELS = os.path.join(ROOT, "evals", "judges", "labels.jsonl")
GOLDEN = os.path.join(ROOT, "evals", "golden", "golden_v1.jsonl")
TH_AGREE, TH_RHO, MIN_N = 0.70, 0.75, 10

# 数值型（用 Spearman）vs 二值型（用一致率）
NUMERIC = {"faithfulness", "relevance"}
BINARY = {"tone_safety"}


def spearman(xs, ys):
    """纯 python Spearman 秩相关（避免为一行统计拉 scipy）"""
    def rank(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r
    n = len(xs)
    if n < 3:
        return None
    rx, ry = rank(xs), rank(ys)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    dx = sum((a - mx) ** 2 for a in rx) ** 0.5
    dy = sum((b - my) ** 2 for b in ry) ** 0.5
    return round(num / (dx * dy), 4) if dx and dy else None


def init_labels(n=20):
    """从 golden 抽样生成待标注集：数值题走 faithfulness，其余走 tone_safety。
    期望文档全部带进 payload.evidence —— 「客观题给证据」是判分纪律第 4 条。"""
    gold = [json.loads(l) for l in open(GOLDEN, encoding="utf-8") if l.strip()]
    pick, step = [], max(1, len(gold) // n)
    for i in range(0, len(gold), step):
        pick.append(gold[i])
    pick = pick[:n]
    os.makedirs(os.path.dirname(LABELS), exist_ok=True)
    with open(LABELS, "w", encoding="utf-8") as f:
        for g in pick:
            metric = "faithfulness" if g["kind"] in ("numeric", "exists", "where", "hours") \
                else "tone_safety"
            f.write(json.dumps({
                "id": g["id"], "metric": metric, "q": g["q"],
                "payload": {"question": g["q"], "answer": "",
                            "evidence": (g.get("expect") or {}).get("must_include") or [],
                            "reference": g.get("truth") if g["kind"] == "numeric" else ""},
                "human": None,
                "hint": ("填 1-5 分（忠实度）" if metric == "faithfulness"
                         else "填 0/1（是否合规）"),
            }, ensure_ascii=False) + "\n")
    print(f"✅ 已生成待标注模板：{LABELS}（{len(pick)} 条）")
    print("   请把 answer 换成真实回答（可用 scripts/test_libao.py --ask 取），再填 human 字段。")
    return 0


def main():
    ap = argparse.ArgumentParser(description="裁判校准")
    ap.add_argument("--init", action="store_true")
    ap.add_argument("--provider", default="none", choices=["none", "ollama", "deepseek"])
    args = ap.parse_args()
    if args.init:
        return init_labels()
    if not os.path.exists(LABELS):
        print(f"❌ 没有标注文件：{LABELS}\n   先跑：python evals/calibrate.py --init")
        return 2

    rows = [json.loads(l) for l in open(LABELS, encoding="utf-8") if l.strip()]
    labeled = [r for r in rows if r.get("human") is not None]
    print(f"标注文件 {len(rows)} 条，其中已人工标注 {len(labeled)} 条｜provider={args.provider}")
    if len(labeled) < MIN_N:
        print(f"⚠️  已标注不足 {MIN_N} 条 —— **拒绝下结论**（样本不足时得出的「通过」是假象）。")
        print("   这是刻意设计：校准结论不能靠 3 条样本得出。")
        return 0

    pairs_num, pairs_bin, failed, unknown = [], [], 0, 0
    for r in labeled:
        out = judge.judge_one(r["metric"], r.get("payload") or {}, args.provider)
        r["_judge"] = out
        if out.get("failed"):
            failed += 1
            continue
        if out.get("unknown"):
            unknown += 1
            continue
        if r["metric"] in NUMERIC:
            sc = out["scores"].get("score") or out["scores"].get("relevance")
            if sc is not None:
                pairs_num.append((float(r["human"]), float(sc)))
        else:
            ok = all(v == 1 for v in out["scores"].values())
            pairs_bin.append((bool(r["human"]), ok))

    print(f"\n判定 {len(pairs_num)} 条数值 / {len(pairs_bin)} 条二值"
          f"｜裁判失败 {failed}｜未判定 {unknown}")
    rho = spearman([a for a, _ in pairs_num], [b for _, b in pairs_num]) if len(pairs_num) >= 3 else None
    agree = (sum(1 for h, j in pairs_bin if h == j) / len(pairs_bin)) if pairs_bin else None
    if rho is not None:
        print(f"  Spearman ρ = {rho}（门槛 > {TH_RHO}）"
              f" {'✅' if rho > TH_RHO else '❌'}")
    if agree is not None:
        print(f"  一致率 = {round(agree, 4)}（门槛 > {TH_AGREE}）"
              f" {'✅' if agree > TH_AGREE else '❌'}")

    ok_num = rho is None or rho > TH_RHO
    ok_bin = agree is None or agree > TH_AGREE
    print(f"\n结论：{'✅ 裁判可进 CI（夜间档）' if (ok_num and ok_bin) else '❌ 暂时不可进 CI'}")
    print("      裁判换模型/换版本后必须重跑本校准。")
    out = os.path.join(ROOT, "evals", "runs", "calibration.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({"provider": args.provider, "rho": rho, "agreement": agree,
               "n_num": len(pairs_num), "n_bin": len(pairs_bin),
               "failed": failed, "unknown": unknown,
               "labels_file": LABELS, "rows": rows},
              open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"   记录：{out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
