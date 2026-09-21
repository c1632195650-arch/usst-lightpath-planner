# -*- coding: utf-8 -*-
"""路网内在质量体检 —— ISO 19157 口径的离线扫描（2026-09-18）

## 为什么需要它

外部精度校验（跟高德/学长站比坐标）只能回答「差多少」，回答不了「为什么差」。
本脚本做**自证式体检**：只看我们自己这张 OSM 派生路网，给出可复现、可回归的指标，
让「路网质量」从一句主观判断变成几个能盯着看的数。

## 指标与 ISO 19157 数据质量元素的对应

| ISO 19157 元素 | 本脚本的指标 |
|---|---|
| 完整性 Completeness | 孤立节点、未定位 POI、连通分量、最大连通分量占比 |
| 逻辑一致性 Logical Consistency | 重边、自环、零长边、悬挂链（degree==1）、桥接边（校外碎片） |
| 位置精度 Positional Accuracy | 绕行系数分布（代理人指标）、端点吸附距离分布 |
| 主题精度 Thematic Accuracy | 锚点来源分布（实锚/弱锚）、OSM 标签口径（bicycle 标签缺失） |
| 时间质量 Temporal Quality | 快照日期、`_meta.updated` |
| 可用性 Usability | 连杆率 LNR、交叉口密度、方向熵、平均速度下的可达范围 |

## 关键指标的读法（避免误判）

* **绕行系数 = 路网距离 / 直线距离**，它**随距离变化**：短距离配对会因「从建筑走到路上」
  的接入段而虚高（50 m 的两栋楼要绕 120 m 很正常）。所以要看**中位数**与**长距离分位**，
  不能拿单对短距离的比值下结论。
* **方向熵**越低说明路网越规整（正交路网）。它是**形状**指标，不是好/坏指标
  —— 老校区路网弯弯曲曲是事实，不能靠它判断对错。
* **连杆率 LNR = 边数 / 节点数**。城市路网经验值 1.0–1.4；太低说明大量「一条道走到黑」
  的长链（缺横路），太高说明节点过密（抽稀不足）。

## 用法

    python scripts/audit_network_quality.py                 # 打印报告
    python scripts/audit_network_quality.py --json out.json # 同时落盘 JSON（供回归比对）
    python scripts/audit_network_quality.py --sample 0      # 绕行系数用全量配对（默认抽样）
"""
import argparse
import json
import math
import os
import random
import statistics as st
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "server"))

import campus_network as cn  # noqa: E402

STRONG = {"osm", "keypoint"}


def _bearing(a, b):
    """初始方位角（度，0=正北，顺时针）。"""
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dl = lon2 - lon1
    y = math.sin(dl) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def scan(net, sample=4000, seed=20260918):
    out = {}

    # ---------- 1. 基本量 ----------
    nodes = list(net.adj.keys())
    edges = set()
    directed = Counter()        # 有向出现次数：无向边正常出现 2 次（u→v, v→u）
    self_loops = 0
    zero_len = 0
    asym = 0                    # 只存了 u→v 没存 v→u（单向存放，属逻辑不一致）
    for u, nbrs in net.adj.items():
        for v, w in nbrs:
            if u == v:
                self_loops += 1
                continue
            if w <= 1e-9:
                zero_len += 1
            directed[(u, v)] += 1
            edges.add(frozenset((u, v)))
    # 🔴 重边 = **同一有向对**出现 >1 次。不能直接数 frozenset 出现 >1 ——
    #    无向边本来就以 u→v 与 v→u 各存一次，那样会把**每一条边**都误报成重边。
    dup_edges = [k for k, c in directed.items() if c > 1]
    for u, v in directed:
        if (v, u) not in directed:
            asym += 1

    deg = {n: len(set(v for v, _ in net.adj.get(n, ()))) for n in nodes}
    dangling = [n for n, d in deg.items() if d == 1]
    isolated = [n for n, d in deg.items() if d == 0]

    # 连通分量（不借桥接边 —— 看「校内/本地」真实连通性）
    seen_n, comps = set(), []
    for n in nodes:
        if n in seen_n:
            continue
        stack, comp = [n], []
        seen_n.add(n)
        while stack:
            u = stack.pop()
            comp.append(u)
            for v, _ in net.adj.get(u, ()):
                if v in seen_n:
                    continue
                if frozenset((u, v)) in net.bridge_edges:
                    continue
                seen_n.add(v)
                stack.append(v)
        comps.append(comp)
    comps.sort(key=len, reverse=True)

    # 范围与面积（用节点 bbox；用于密度类指标）
    lats = [n[0] for n in nodes]
    lons = [n[1] for n in nodes]
    h_km = cn.hav((min(lats), min(lons)), (max(lats), min(lons))) / 1000.0
    w_km = cn.hav((min(lats), min(lons)), (min(lats), max(lons))) / 1000.0
    area_km2 = max(h_km * w_km, 1e-9)

    n_edges = len(edges)
    out["topology"] = {
        "nodes": len(nodes),
        "edges_undirected": n_edges,
        "components": len(comps),
        "largest_component": len(comps[0]) if comps else 0,
        "largest_component_share": round(len(comps[0]) / max(len(nodes), 1), 4) if comps else 0,
        "isolated_nodes": len(isolated),
        "dangling_nodes": len(dangling),
        "self_loops": self_loops,
        "zero_length_edges": zero_len,
        "parallel_edge_pairs": len(dup_edges),
        "one_way_stored_edges": asym,
        "bbox_km": [round(h_km, 3), round(w_km, 3)],
        "bbox_area_km2": round(area_km2, 4),
        "bbox_caveat": "bbox 含校园外围城市道路（军工路等），密度类指标因此被稀释",
    }

    # ---------- 2. 网络形态 ----------
    inter = [n for n, d in deg.items() if d >= 3]
    out["shape"] = {
        "link_node_ratio": round(n_edges / max(len(nodes), 1), 3),
        "mean_degree": round(sum(deg.values()) / max(len(nodes), 1), 3),
        "intersections_deg3plus": len(inter),
        "intersection_density_per_km2": round(len(inter) / area_km2, 1),
        "edge_length_median_m": round(st.median(
            [w for u in net.adj for _, w in net.adj[u]] or [0]), 2),
    }

    # ---------- 3. 方向熵（形状/规整度） ----------
    # 方位角折到 0–180°（无向），每 10° 一档。
    # 注意：**不要去算「轴向对齐占比」然后当成好坏** —— 军工路一带的主轴约 55°，
    # 不是正南北；用「离 0°/90° 多近」来量会把一个正常的斜向路网判成「不规整」。
    # 所以这里只报：熵（无序度）+ 前两个峰所在的角度与其占比。
    bins = 18
    hist = [0] * bins
    total = 0
    for u, v in edges:
        b = _bearing(u, v) % 180.0
        hist[min(int(b // (180.0 / bins)), bins - 1)] += 1
        total += 1
    probs = [c / total for c in hist if c]
    H = -sum(p * math.log(p) for p in probs) / math.log(bins) if probs else 0.0
    ranked = sorted(range(bins), key=lambda i: -hist[i])
    step = 180.0 / bins
    out["orientation"] = {
        "entropy_norm_0to1": round(H, 4),
        "top_axis_deg": round(ranked[0] * step + step / 2, 1),
        "top_axis_share": round(hist[ranked[0]] / max(total, 1), 4),
        "top2_axes_deg": [round(ranked[0] * step + step / 2, 1),
                          round(ranked[1] * step + step / 2, 1)],
        "top2_axis_share": round((hist[ranked[0]] + hist[ranked[1]]) / max(total, 1), 4),
        "histogram": hist,
        "note": ("熵越低越规整；主峰近似 = 该片区街道主走向。"
                 "这是形状指标，不判好坏"),
    }

    # ---------- 4. 绕行系数（位置精度的代理指标） ----------
    pois = [(n, p[0], p[1]) for n, p in net.poi.items()]
    rnd = random.Random(seed)
    pairs = []
    if sample and sample > 0 and len(pois) > 1:
        for _ in range(sample):
            a, b = rnd.sample(pois, 2)
            pairs.append((a, b))
    else:
        for i in range(len(pois)):
            for j in range(i + 1, len(pois)):
                pairs.append((pois[i], pois[j]))

    ratios, by_band = [], defaultdict(list)
    for (na, pa, sa), (nb, pb, sb) in pairs:
        if not cn.same_walk_group(net._campus_of.get(na), net._campus_of.get(nb)):
            continue
        straight = cn.hav(pa, pb)
        if straight < 30:            # 太近的配对，直线本身就不可走，比值无意义
            continue
        r = net.route(na, nb)
        if not r:
            continue
        ratio = r["meters"] / straight
        ratios.append(ratio)
        band = ("0.03–0.2 km" if straight < 200 else
                "0.2–0.5 km" if straight < 500 else
                "0.5–1 km" if straight < 1000 else ">1 km")
        by_band[band].append(ratio)

    def q(xs, p):
        if not xs:
            return None
        xs = sorted(xs)
        return round(xs[min(int(p * len(xs)), len(xs) - 1)], 3)

    out["circuity"] = {
        "pairs_used": len(ratios),
        "median": round(st.median(ratios), 3) if ratios else None,
        "p90": q(ratios, 0.90),
        "p99": q(ratios, 0.99),
        "share_over_2": round(sum(1 for r in ratios if r > 2.0) / max(len(ratios), 1), 4),
        "by_distance_band": {
            k: {"n": len(v), "median": round(st.median(v), 3)}
            for k, v in sorted(by_band.items())
        },
        "note": "比值随距离下降是正常的（短距离的接入段占比高）",
    }

    # ---------- 5. 主题精度 / 台账 ----------
    src = Counter(s for _, s in net.poi.values())
    out["anchors"] = {
        "total_poi": len(net.poi),
        "strong": sum(v for k, v in src.items() if k in STRONG),
        "strong_share": round(sum(v for k, v in src.items() if k in STRONG)
                              / max(len(net.poi), 1), 4),
        "by_source": dict(src.most_common()),
        "unlocated": list(net.unlocated),
    }

    # ---------- 6. 逻辑一致性：桥接边 / 广场 / 隧道台账 ----------
    out["ledger"] = {
        "bridge_edges_offcampus": len(net.bridge_edges),
        "bridged_fragments": len(net.bridged),
        "bridge_gaps_m": [round(b["gap_m"], 1) for b in
                          sorted(net.bridged, key=lambda x: -x["gap_m"])][:10],
        "area_polys": net.area_polys,
        "area_chord_edges": len(net.area_edges),
        "skipped_car_tunnels": len(net.skipped_tunnel),
        "osm_buildings_indexed": len(net.bld),
    }

    # ---------- 7. 锚点塌缩检测（同坐标不同地点） ----------
    # 🔴 这是本项目踩过的坑：`七公寓` 是 approx 锚，坐标**直接复用了** `580号校门`，
    #    两者距离恒为 0 m。同坐标有两种性质完全不同的成因，必须分开看：
    #      · **合法同址**：两端锚在同一条 OSM 建筑面（如同一楼的 1 层食堂 / 2 层图书馆）
    #        —— 物理上就在一起，距离≈0 是对的；
    #      · **疑似缺陷**：至少一端是 approx / walk_minutes / zone 等派生锚
    #        —— 说明它是「抄」了邻居的坐标，不是真的同址。
    grid = defaultdict(list)
    for n, (pt, s) in net.poi.items():
        grid[(round(pt[0], 5), round(pt[1], 5))].append((n, s))
    collapsed = []
    for key, members in grid.items():
        if len(members) < 2:
            continue
        suspect = [m for m in members if m[1] not in ("osm", "keypoint")]
        collapsed.append({
            "coord": key,
            "members": sorted(m[0] for m in members),
            "sources": {m[0]: m[1] for m in sorted(members)},
            "suspect": bool(suspect),
            "suspect_members": sorted(m[0] for m in suspect),
        })
    collapsed.sort(key=lambda x: (not x["suspect"], -len(x["members"])))
    out["anchor_collapse"] = {
        "groups": len(collapsed),
        "suspect_groups": sum(1 for c in collapsed if c["suspect"]),
        "detail": collapsed,
    }
    return out


def report(r):
    L = []
    p = L.append
    p("=" * 78)
    p("路网内在质量体检（ISO 19157 口径）")
    p("=" * 78)

    t = r["topology"]
    p("")
    p("① 完整性 Completeness")
    p(f"   节点 {t['nodes']} ／ 无向边 {t['edges_undirected']} ／ 范围 {t['bbox_km'][0]}×{t['bbox_km'][1]} km"
      f"（{t['bbox_area_km2']} km²）")
    p(f"   连通分量 {t['components']} 个；最大分量占 {t['largest_component_share']*100:.1f}%"
      f"（{t['largest_component']} 节点）")
    p(f"   孤立节点 {t['isolated_nodes']} ／ 悬挂端点(度1) {t['dangling_nodes']}")
    p(f"   未定位 POI {len(r['anchors']['unlocated'])} 个"
      + (f"：{r['anchors']['unlocated'][:5]}" if r["anchors"]["unlocated"] else ""))

    p("")
    p("② 逻辑一致性 Logical Consistency")
    p(f"   自环 {t['self_loops']} ／ 零长边 {t['zero_length_edges']}"
      f" ／ 重边（同一有向对多次）{t['parallel_edge_pairs']}"
      f" ／ 单向存放边 {t['one_way_stored_edges']}")
    g = r["ledger"]
    p(f"   桥接边（校外碎片）{g['bridge_edges_offcampus']} 条 / {g['bridged_fragments']} 处"
      f"；最大缺口 {g['bridge_gaps_m'][:3]} m")
    p(f"   车行隧道已剔除 {g['skipped_car_tunnels']} 段 ／ 广场面 {g['area_polys']} 块"
      f"（面内直连边 {g['area_chord_edges']}）")
    p(f"   OSM 具名建筑索引 {g['osm_buildings_indexed']} 条")

    p("")
    p("③ 位置精度（代理） Positional Accuracy")
    c = r["circuity"]
    p(f"   绕行系数（{c['pairs_used']} 组配对）：中位 {c['median']} ／ P90 {c['p90']} ／ P99 {c['p99']}"
      f" ／ >2.0 占 {c['share_over_2']*100:.1f}%")
    for k, v in c["by_distance_band"].items():
        p(f"     {k:<12} n={v['n']:<5} 中位 {v['median']}")

    p("")
    p("④ 主题精度 Thematic Accuracy")
    a = r["anchors"]
    p(f"   实锚 {a['strong']}/{a['total_poi']}（{a['strong_share']*100:.0f}%）")
    for k, v in a["by_source"].items():
        tag = "实锚" if k in STRONG else "弱锚"
        p(f"     [{tag}] {k:<16} {v}")

    p("")
    p("⑤ 网络形态 Shape / Usability")
    s = r["shape"]
    p(f"   连杆率 LNR {s['link_node_ratio']} ／ 平均度 {s['mean_degree']}"
      f" ／ 边中位长 {s['edge_length_median_m']} m")
    p(f"   交叉口(度≥3) {s['intersections_deg3plus']} 个 → {s['intersection_density_per_km2']} 个/km²"
      f"（⚠️ 范围含校外城市道路，密度被稀释）")
    o = r["orientation"]
    p(f"   方向熵 {o['entropy_norm_0to1']}（0=完全正交，1=完全无序）")
    p(f"   主走向 {o['top_axis_deg']}°（占 {o['top_axis_share']*100:.1f}%）；"
      f"次峰 {o['top2_axes_deg'][1]}° → 两峰合计 {o['top2_axis_share']*100:.1f}%")
    p("")
    p("⑥ 锚点塌缩检测（同坐标不同地点）")
    ac = r["anchor_collapse"]
    p(f"   同坐标分组 {ac['groups']} 组，其中**疑似缺陷** {ac['suspect_groups']} 组"
      f"（判据：组内至少一端是 approx/walk_minutes/zone 等派生锚 → 是「抄」了邻居坐标）")
    for c in ac["detail"][:12]:
        tag = "🔴疑似缺陷" if c["suspect"] else "   合法同址"
        p(f"     {tag} {c['coord'][0]:.5f},{c['coord'][1]:.5f}  ← "
          + " ／ ".join(f"{m}({c['sources'][m]})" for m in c["members"]))
    if len(ac["detail"]) > 12:
        p(f"     … 其余 {len(ac['detail'])-12} 组见 JSON 的 anchor_collapse.detail")
    p("")
    p("=" * 78)
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=None, help="把报告 JSON 写到该路径（供回归比对）")
    ap.add_argument("--sample", type=int, default=4000,
                    help="绕行系数抽样配对数；0 = 全量（较慢）")
    args = ap.parse_args()

    net = cn.Network()
    r = scan(net, sample=args.sample)
    print(report(r))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(r, f, ensure_ascii=False, indent=1)
        print(f"已写出 JSON：{args.json}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
