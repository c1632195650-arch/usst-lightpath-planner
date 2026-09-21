# -*- coding: utf-8 -*-
"""弱锚审计 —— 把每个非 `osm` 定位的 POI 与其最近的 OSM 具名建筑并排列出。

## 为什么需要它

图谱**不落坐标**（合规红线），POI 位置全部由 `campus_network.py` 在运行时锚定。
锚定分档（`res[name] = (coord, source)`）：

    keypoint/approx > osm > roads > near_landmark > walk_minutes > zone > campus > global

只有 `osm`（OSM 真实几何）与 `keypoint`（人工核对）算**实锚**；其余都是**派生锚**——
位置由「邻居的邻居」推出来，误差会累积，也是两条不同 POI 塌缩到同一点的根因
（如『七公寓』与『580号校门』曾完全重合，因为七公寓是 approx 锚直接复用了校门坐标）。

本脚本不修改任何数据，只**排序出候选**：对每个弱锚，列出最近的 N 个 OSM 具名建筑。
人工确认「这个名字其实就是那栋楼／那个设施」后，在图谱数据里加 `match_osm` 即可升为实锚。

## 用法

    python scripts/audit_weak_anchors.py            # 全部弱锚，各列最近 5 个 OSM 建筑
    python scripts/audit_weak_anchors.py -k 8       # 各列最近 8 个
    python scripts/audit_weak_anchors.py --max 30   # 只列距离 ≤30 m 的候选（筛选高置信）
    python scripts/audit_weak_anchors.py -q 图书馆   # 只看名字含「图书馆」的
"""
import argparse
import collections
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "server"))

import campus_network as cn  # noqa: E402

# 实锚的定义（其余皆为派生锚 / 弱锚）
STRONG = {"osm", "keypoint"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-k", "--topk", type=int, default=5, help="每个弱锚列几个候选（默认 5）")
    ap.add_argument("--max", type=float, default=None, help="只显示距离 ≤ N 米的候选")
    ap.add_argument("-q", "--query", default=None, help="只看名字含该串的弱锚")
    args = ap.parse_args()

    net = cn.Network()

    # OSM 具名建筑 → 质心（一个名字可能由多个 way/relation 拼成 → 取所有点均值）
    bld_centroid = {}
    for name, coords in net.bld.items():
        bld_centroid[name] = (
            sum(c[0] for c in coords) / len(coords),
            sum(c[1] for c in coords) / len(coords),
        )

    by_src = collections.defaultdict(list)
    for name, (pt, src) in net.poi.items():
        if src not in STRONG:
            by_src[src].append((name, pt))

    dist = collections.Counter(v[1] for v in net.poi.values())
    print("=" * 78)
    print("定位来源分布（实锚 = osm + keypoint）")
    print("=" * 78)
    total = len(net.poi)
    for s, n in dist.most_common():
        tag = "实锚" if s in STRONG else "弱锚"
        print(f"  [{tag}] {s:<16} {n:>4}  ({n / total * 100:.0f}%)")
    n_strong = sum(n for s, n in dist.items() if s in STRONG)
    print(f"  → 实锚 {n_strong}/{total}（{n_strong / total * 100:.0f}%）")
    print()

    order = ["near_landmark", "walk_minutes", "roads", "approx", "zone", "campus", "global"]
    for src in order:
        rows = by_src.get(src)
        if not rows:
            continue
        print("=" * 78)
        print(f"弱锚来源：{src}   （{len(rows)} 个）")
        print("=" * 78)
        for name, pt in sorted(rows):
            if args.query and args.query not in name:
                continue
            cands = sorted(
                ((cn.hav(pt, c), n) for n, c in bld_centroid.items()),
                key=lambda x: x[0],
            )
            if args.max is not None:
                cands = [c for c in cands if c[0] <= args.max]
            print(f"\n  ▸ {name}")
            if not cands:
                print("      （附近无 OSM 具名建筑）")
                continue
            for d, n in cands[: args.topk]:
                flag = "  ← 疑似就是这栋" if d <= 15 else ("  ← 近邻" if d <= 40 else "")
                print(f"      {d:7.1f} m   {n}{flag}")
        print()

    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
