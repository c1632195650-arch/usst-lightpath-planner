# -*- coding: utf-8 -*-
"""
统计显著性工具（P2 · 究极测评体系 L7）
======================================
回答一个问题：**两次引擎评测的差异，是「改好了」还是「机器噪声」？**

背景（本项目踩过的实坑）：同一份代码连续两次跑，p95 能差 7×；「8 个场景超基线 50%」
用 --runs 9 复测后只剩 1 个亚毫秒场景。**单轮/跨时间对比 p95 不可下结论**——
必须配对比较 + 非参数检验（Demšar 2006：Wilcoxon signed-rank）。

方法（纯 Python 零依赖）：
  输入两份 acceptance.ts 产出的 JSON（A=改动前/基线，B=改动后），按场景×档位**配对**
  取同一指标的值（默认 p50，建议用 p50/p95 而非 max），做 Wilcoxon signed-rand 检验：
  · 报 R+ / R− / W、基于正态近似的 p 值（含并列秩校正，n≥8 才给 p，n<8 拒绝下结论）
  · 报中位差与 95% CI（bootstrap 1000 次）
  · 报相对改进（RD）：median((a-b)/a)

用法：
  python scripts/significance.py --a evals/runs/engine_a.json --b evals/runs/engine_b.json
  python scripts/significance.py --a ... --b ... --metric p50 --alpha 0.05

⚠️ 用法纪律：A/B 必须在**同机同刻**轮流采集（各跑一次为一轮，交替 ≥9 轮），
   跨时间采集的 A/B 差异混杂了机器负载，检验做得再对也是白搭。
"""
import argparse
import json
import math
import random
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def paired_values(a, b, metric):
    """按 (场景, 档位) 配对取指标值；任一侧缺失/None 的对丢弃。"""
    am = {(r["name"], r["variant"]): (r.get("metrics") or {}) for r in a.get("results", [])}
    pairs, dropped = [], []
    for r in b.get("results", []):
        key = (r["name"], r["variant"])
        m = r.get("metrics") or {}
        if key not in am or not m.get(metric) or not am[key].get(metric):
            dropped.append(f"{key[0]}[{key[1]}]")
            continue
        pairs.append((key, float(am[key][metric]), float(m[metric])))
    return pairs, dropped


def ranks_with_ties(absdiff):
    """平均秩（并列取平均）。返回 [(i, rank)]。"""
    order = sorted(range(len(absdiff)), key=lambda i: absdiff[i])
    ranks = [0.0] * len(absdiff)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and absdiff[order[j + 1]] == absdiff[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def wilcoxon(diffs):
    """Wilcoxon signed-rank。返回 (W, R+, R-, n_eff, p) ；n_eff<8 或全零返回 p=None。"""
    d = [x for x in diffs if x != 0]
    n = len(d)
    if n < 8:
        return None, None, None, n, None
    ranks = ranks_with_ties([abs(x) for x in d])
    rp = sum(r for r, x in zip(ranks, d) if x > 0)
    rm = sum(r for r, x in zip(ranks, d) if x < 0)
    w = min(rp, rm)
    # 正态近似（含并列校正）
    mu = n * (n + 1) / 4
    tie_groups = {}
    for r in ranks:
        tie_groups[r] = tie_groups.get(r, 0) + 1
    tie_term = sum(t ** 3 - t for t in tie_groups.values())
    sigma = math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - tie_term / 48)
    if sigma == 0:
        return w, rp, rm, n, None
    z = (w - mu) / sigma
    p = 2 * (0.5 * (1 + math.erf(-abs(z) / math.sqrt(2))))  # 双侧
    return w, rp, rm, n, round(p, 4)


def bootstrap_ci(diffs, iters=1000, alpha=0.05):
    med = []
    rng = random.Random(42)
    for _ in range(iters):
        sample = [rng.choice(diffs) for _ in range(len(diffs))]
        sample.sort()
        med.append(sample[len(sample) // 2])
    med.sort()
    lo = med[int(alpha / 2 * iters)]
    hi = med[int((1 - alpha / 2) * iters) - 1]
    return lo, hi


def main():
    ap = argparse.ArgumentParser(description="配对 Wilcoxon 显著性检验（引擎评测 A/B）")
    ap.add_argument("--a", required=True, help="基线侧 acceptance JSON")
    ap.add_argument("--b", required=True, help="改动侧 acceptance JSON")
    ap.add_argument("--metric", default="p50", help="比较指标（默认 p50；可选 p95/max）")
    ap.add_argument("--alpha", type=float, default=0.05)
    args = ap.parse_args()

    a = json.load(open(args.a, encoding="utf-8"))
    b = json.load(open(args.b, encoding="utf-8"))
    pairs, dropped = paired_values(a, b, args.metric)
    if dropped:
        print(f"（丢弃缺值配对：{dropped}）")
    if len(pairs) < 8:
        print(f"❌ 有效配对仅 {len(pairs)} 组（<8）—— 样本不足，拒绝下结论（防止「3 条样本就说显著」）。")
        return 2

    diffs = [b_val - a_val for _, a_val, b_val in pairs]
    w, rp, rm, n_eff, p = wilcoxon(diffs)
    diffs_sorted = sorted(diffs)
    med_diff = diffs_sorted[len(diffs_sorted) // 2]
    lo, hi = bootstrap_ci(diffs, alpha=args.alpha)
    base_vals = sorted(v for _, v, _ in pairs)
    rd = med_diff / base_vals[len(base_vals) // 2] if base_vals[len(base_vals) // 2] else None

    print(f"== Wilcoxon signed-rank（指标 {args.metric}，n={len(pairs)} 配对，有效 n={n_eff}）==")
    for key, av, bv in pairs:
        d = bv - av
        arrow = "→" if d == 0 else ("↑" if d > 0 else "↓")
        print(f"   {key[0]}[{key[1]}]  {av} {arrow} {bv}  (Δ{d:+.2f})")
    print(f"\n   R+ = {rp}｜R- = {rm}｜W = {w}")
    if p is None:
        print("   p 值不可得（有效样本 <8 或全零差）—— 拒绝下结论")
        return 2
    sig = p < args.alpha
    print(f"   p ≈ {p}（双侧，α={args.alpha}）→ {'✅ 显著' if sig else '❌ 不显著'}")
    print(f"   中位差 = {med_diff:+.2f}｜95% CI [{lo:+.2f}, {hi:+.2f}]"
          + (f"｜相对改进 RD = {rd:+.1%}" if rd is not None else ""))
    print("\n⚠️ 结论纪律：A/B 必须同机同刻交替采集；显著 ≠ 重要（亚毫秒场景的显著差异没有工程意义）。")
    return 0 if sig else 1


if __name__ == "__main__":
    sys.exit(main())
