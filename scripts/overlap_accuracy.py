# -*- coding: utf-8 -*-
"""GPS 轨迹 OA（重叠精度）校验 —— 拿真实足迹给「引擎路线」打分（2026-09-18）

## 为什么是 OA

外部坐标比对（跟高德/学长站比点位）只能说明「点标得准不准」；
真正决定产品好坏的是**路线像不像人会走的路**。OA（Overlap Accuracy，重叠精度）
就是量这个的：把真人的 GPS 轨迹和引擎算出的折线叠在一起看重合度。

## 指标（每个 OD 一条轨迹）

| 指标 | 定义 | 说明 |
|---|---|---|
| **OA** | 轨迹点中落在「引擎折线 ± buffer」内的比例 | 主指标，越高越好 |
| **覆盖率 coverage** | 引擎折线中落在「轨迹点 ± buffer」内的比例 | OA 的召回侧：防「轨迹只走了路线的 1/10 也能得高分」 |
| **P90 偏差** | 轨迹点到引擎折线的第 90 百分位距离 | 描述偏差量级，不被个别漂移点带偏 |
| **长度比 ratio** | 轨迹实测长度 ÷ 引擎折线长度 | >1 说明人绕了/引擎抄了近路；<1 说明引擎绕远 |

**OA 高 + 覆盖率低** = 引擎多算了一段人不走的（路线偏长）；
**OA 低 + 覆盖率高** = 人走了别的路（引擎漏了这条通路 —— 最有价值的发现）。

## 输入格式

推荐用**清单文件**（避免从文件名猜 OD）：

```json
// traces/manifest.json
[
  {"from": "第三教学楼", "to": "第五食堂", "file": "t01.csv", "person": "A"},
  ...
]
```

轨迹文件：CSV，表头必须含 `lat,lon`（`ts` 可选，用于剔除停留点）：

```csv
lat,lon,ts
31.29451,121.55123,1758000000
...
```

也支持 GeoJSON（`LineString` 或 `Feature<LineString>`）。

## 用法

    # 跑真实轨迹
    python scripts/overlap_accuracy.py --manifest traces/manifest.json --buffer 15

    # 无真实数据时的自检：由引擎路线合成带噪声的轨迹，OA 必须仍然很高
    # （否则说明工具本身写错了，而不是数据不好）
    python scripts/overlap_accuracy.py --self-test

    # 也可不看 OD，直接给一条笛卡尔轨迹文件
    python scripts/overlap_accuracy.py --file traces/one.csv --from 第三教学楼 --to 第五食堂
"""
import argparse
import csv
import json
import math
import os
import random
import statistics as st
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "server"))

import campus  # noqa: E402
import campus_network as cn  # noqa: E402


# ---------------------------------------------------------------- 几何
def _pt_seg_distance(p, a, b):
    """点到线段的距离（米）。用等距圆柱投影在局部把经纬度当平面。"""
    lat0 = math.radians((a[0] + b[0] + p[0]) / 3.0)
    mx = 111320.0 * math.cos(lat0)
    my = 110540.0

    def xy(q):
        return ((q[1] - a[1]) * mx, (q[0] - a[0]) * my)

    px, py = xy(p)
    ax, ay = 0.0, 0.0
    bx, by = xy(b)
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 <= 1e-12:
        return math.hypot(px, py)
    t = max(0.0, min(1.0, (px * dx + py * dy) / L2))
    return math.hypot(px - t * dx, py - t * dy)


def _polyline_length(pl):
    return sum(cn.hav(pl[i], pl[i + 1]) for i in range(len(pl) - 1))


def _resample(pts, step_m=10.0):
    """按固定弧长重采样（保留首尾）。"""
    if len(pts) < 2:
        return list(pts)
    out = [pts[0]]
    acc = 0.0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        d = cn.hav(a, b)
        if d <= 1e-9:
            continue
        while acc + d >= step_m:
            t = (step_m - acc) / d
            p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            out.append(p)
            a = p
            d = cn.hav(a, b)
            acc = 0.0
            if d <= 1e-9:
                break
        acc += d
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    return out


def _simplify(pts, tol_m):
    """Douglas–Peucker 简化 —— 量长度**必须**先做这一步。

    GPS 噪声会虚增长度：逐点求和的长度里，每个点的定位误差都贡献一段「之字形」位移。
    实测 σ≈8 m 的轨迹能把 300 m 的路量成 500 m（虚增 ~60%），
    于是「长度比」这个指标完全失效（看起来像人人都在绕远路）。
    简化容差取 ~2σ 就能把抖动压掉、保留真实拐点。

    只用于**量长度**；偏差类指标仍用原始点（那里需要保留真实抖动）。
    纯重采样没用 —— 沿之字形路径重采样，之字形还在。
    """
    if len(pts) < 3:
        return list(pts)

    def rec(lo, hi, keep):
        if hi <= lo + 1:
            return
        a, b = pts[lo], pts[hi]
        worst, wi = -1.0, -1
        for i in range(lo + 1, hi):
            d = _pt_seg_distance(pts[i], a, b)
            if d > worst:
                worst, wi = d, i
        if worst > tol_m:
            keep.add(wi)
            rec(lo, wi, keep)
            rec(wi, hi, keep)

    keep = {0, len(pts) - 1}
    rec(0, len(pts) - 1, keep)
    return [pts[i] for i in sorted(keep)]


def _dist_to_polyline(p, pl):
    if len(pl) == 1:
        return cn.hav(p, pl[0])
    return min(_pt_seg_distance(p, pl[i], pl[i + 1]) for i in range(len(pl) - 1))


def _percentile(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    return xs[min(int(p * len(xs)), len(xs) - 1)]


# ---------------------------------------------------------------- IO
def _load_trace(path):
    """CSV / GeoJSON → [(lat, lon), ...]"""
    if path.lower().endswith((".json", ".geojson")):
        d = json.load(open(path, encoding="utf-8"))
        geom = d.get("geometry", d) if d.get("type") == "Feature" else d
        if geom.get("type") != "LineString":
            raise ValueError(f"{path}: 只支持 LineString，实为 {geom.get('type')}")
        return [(c[1], c[0]) for c in geom["coordinates"]]   # GeoJSON 是 [lon, lat]
    pts = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            try:
                pts.append((float(row["lat"]), float(row["lon"])))
            except (KeyError, TypeError, ValueError):
                continue
    return pts


def evaluate(route, trace, buffer_m):
    """返回单条轨迹的指标 dict。route 为 route(..., with_path=True) 的结果。"""
    pl = route["polyline"]
    # 🔴 退化路线：两端锚在**同一条 OSM 建筑面**上（如同一楼 1 层食堂 / 2 层图书馆），
    #    path_meters == 0 而 access 撑起全程 → 折线是 [A, 节点, A] 的来回。
    #    此时 OA / 长度比都没有意义（分母是掷硬币），必须单独标出来，
    #    否则会给出「引擎绕远了」这类**完全错误**的结论。
    degenerate = route["path_meters"] < 1.0
    devs = [_dist_to_polyline(p, pl) for p in trace]
    oa = sum(1 for d in devs if d <= buffer_m) / max(len(devs), 1)
    cov = sum(1 for p in pl if _dist_to_polyline(p, trace) <= buffer_m) / max(len(pl), 1)
    trace_len = _polyline_length(_simplify(trace, tol_m=buffer_m * 1.5))
    route_len = _polyline_length(pl)
    return {
        "oa": round(oa, 4),
        "coverage": round(cov, 4),
        "p90_dev_m": round(_percentile(devs, 0.90), 1),
        "median_dev_m": round(st.median(devs), 1) if devs else None,
        "max_dev_m": round(max(devs), 1) if devs else None,
        "trace_len_m": round(trace_len, 1),
        "route_len_m": round(route_len, 1),
        "length_ratio": (None if degenerate else
                         round(trace_len / route_len, 3) if route_len else None),
        "degenerate": degenerate,
        "degenerate_note": ("两端在同一栋楼（path_meters=0，全程为两端接入段）—— "
                            "OA/长度比不适用" if degenerate else ""),
        "n_points": len(trace),
    }


def _verdict(r, buffer_m, ceiling=1.0):
    """给一句人话结论（判据写成代码，避免每次口算出不同标准）。

    `ceiling` = 该设备噪声下 OA 的理论上限（见 `_oa_ceiling`）。
    默认 1.0 → 阈值就是产品标准 90%；已知噪声底线时传入真实上限，
    判据自动放宽到「上限的 90%」，**避免把手机定位误差当成引擎缺陷**。
    """
    thr = 0.90 * ceiling
    if r.get("degenerate"):
        return "⚪ 同栋楼（退化路线）：不评 OA，改看两端接入距离"
    if r["oa"] >= thr and r["coverage"] >= 0.85:
        return "✅ 引擎路线与足迹一致"
    if r["oa"] >= thr and r["coverage"] < 0.85:
        return "⚠️ 人走的那段都对，但引擎多绕了 —— 路线偏长"
    if r["oa"] < thr and r["coverage"] >= 0.85:
        return "🔴 轨迹偏离引擎路线：引擎很可能**漏了这条通路**（优先排查）"
    return "🔴 两边都对不上：可能坐标/吸附有系统偏差（也可能设备噪声过大，先核噪声底线）"


# ---------------------------------------------------------------- 自检
def _oa_ceiling(buffer_m, noise_m, n=20000, seed=1):
    """给定定位噪声 σ，**完美引擎**能达到的 OA 上限。

    这不是玄学：一个「引擎路线完全正确」的轨迹，其每个点相对真实位置仍偏移了
    定位误差。二维高斯偏移距离 ≤ buffer 的概率就是 OA 的天花板：

        P(OA) = 1 − exp(−buffer² / (2σ²))

    σ=8 m / buffer=15 m → 上限 ~83%；σ=15 m / buffer=15 m → 上限只有 **~39%**。
    所以「OA 不到 90% 就是引擎有问题」是**错的** —— 手机信号差时谁也到不了 90%。
    自检据此把判据改成「达到上限的 90% 以上」，才不会把噪声当成缺陷。
    """
    rnd = random.Random(seed)
    inside = 0
    for _ in range(n):
        dx, dy = rnd.gauss(0, noise_m), rnd.gauss(0, noise_m)
        if math.hypot(dx, dy) <= buffer_m:
            inside += 1
    return inside / n


def _self_test(buffer_m, noise_m, seed=20260918):
    """由引擎路线合成带噪声轨迹 —— 工具正确时 OA 应接近 1。"""
    rnd = random.Random(seed)
    cases = [("第三教学楼", "第五食堂"), ("第四食堂", "1100图书馆"),
             ("中德学院", "南校区图书馆"), ("图书馆（图文信息中心）", "第五食堂"),
             ("第二食堂", "第七宿舍"), ("申一教", "1100图书馆")]
    print("=" * 78)
    print("自检：由引擎折线合成带噪声轨迹（应判定为「一致」）")
    ceiling = _oa_ceiling(buffer_m, noise_m)
    print(f"     buffer={buffer_m} m，位置噪声 σ≈{noise_m} m")
    print(f"     该噪声下的 OA 理论上限 = {ceiling*100:.0f}%"
          f"（判据 = 达到上限的 90%，即 ≥ {ceiling*0.9*100:.0f}%）")
    print("=" * 78)
    ok = 0
    n_degenerate = 0
    for a, b in cases:
        r = campus.route(a, b, with_path=True)
        if not r:
            print(f"  -- {a} → {b}：无路线，跳过")
            continue
        pl = r["polyline"]
        # 沿线每 ~10 m 采一点，并加高斯噪声
        trace, acc = [], 0.0
        for i in range(len(pl) - 1):
            seg = cn.hav(pl[i], pl[i + 1])
            steps = max(1, int(seg // 10))
            for k in range(steps):
                t = k / steps
                lat = pl[i][0] + (pl[i + 1][0] - pl[i][0]) * t
                lon = pl[i][1] + (pl[i + 1][1] - pl[i][1]) * t
                lat += rnd.gauss(0, noise_m) / 110540.0
                lon += rnd.gauss(0, noise_m) / (111320.0 * math.cos(math.radians(lat)))
                trace.append((lat, lon))
        m = evaluate(r, trace, buffer_m)
        verdict = _verdict(m, buffer_m, ceiling)
        # 退化路线（同栋楼）不计入成败；其余按「噪声上限的 90%」判
        good = m.get("degenerate") or m["oa"] >= ceiling * 0.9
        ok += 1 if good else 0
        n_degenerate += 1 if m.get("degenerate") else 0
        print(f"  {'✅' if good else '❌'} {a} → {b}：OA {m['oa']*100:.0f}%"
              f" 覆盖 {m['coverage']*100:.0f}%  P90 {m['p90_dev_m']} m"
              f" 长度比 {m['length_ratio']} ｜ {verdict}")
    print()
    print(f"自检结果：{ok}/{len(cases)} 通过（工具本身可用性）｜退化路线 {n_degenerate}/{len(cases)}")

    # 🔴 逃逸口守卫（2026-09-19）：`good = degenerate or ...` 意味着**退化路线无条件算通过**。
    #    如果 6 条案例全退化成同栋楼，自检仍会 6/6 全绿 —— 而那恰恰是「工具失去分辨力」的样子
    #    （本项目已抓到多次「自造假覆盖」）。所以给退化条数加个上限。
    #    当前恰好 1 条（第四食堂 → 1100图书馆），是**刻意设计**的同栋退化案例。
    if n_degenerate > 1:
        print(f"🔴 退化路线过多（{n_degenerate}/{len(cases)}）：自检已失去分辨力 —— "
              f"`good = degenerate or ...` 把它们全判过了。请检查案例或 1100/南校的定位。")
        return 1
    if not ok:
        print("🔴 连「自己的路线加噪声」都认不出来 —— 说明评估函数写错了，别用它去评真实数据")
    return 0 if ok == len(cases) else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", help="清单 JSON：from/to/file(/person)")
    ap.add_argument("--file", help="单条轨迹文件（配合 --from/--to）")
    ap.add_argument("--from", dest="src", help="单条模式：起点 POI")
    ap.add_argument("--to", dest="dst", help="单条模式：终点 POI")
    ap.add_argument("--buffer", type=float, default=15.0, help="缓冲半径（米，默认 15）")
    ap.add_argument("--self-test", action="store_true", help="合成轨迹自检")
    ap.add_argument("--noise", type=float, default=8.0, help="自检噪声 σ（米）")
    ap.add_argument("--noise-floor", type=float, default=None,
                    help="本机定位噪声底线 σ（米）。给了就按「OA 上限」判结论，"
                         "避免把手机定位误差误判成引擎缺陷。估法：起终点站着不动 "
                         "10 秒，取这段时间内点的离散度（见 docs/gps-trace-protocol.md）")
    ap.add_argument("--json", help="把逐条结果写成 JSON")
    args = ap.parse_args()

    if args.self_test:
        return _self_test(args.buffer, args.noise)

    items = []
    if args.manifest:
        man = json.load(open(args.manifest, encoding="utf-8"))
        base = os.path.dirname(os.path.abspath(args.manifest))
        for it in man:
            items.append((it["from"], it["to"],
                          os.path.join(base, it["file"]), it.get("person", "")))
    elif args.file:
        if not (args.src and args.dst):
            ap.error("单条模式需要同时给 --from 与 --to")
        items.append((args.src, args.dst, args.file, ""))
    else:
        ap.error("需要 --manifest 或 --file（或 --self-test）")

    ceiling = _oa_ceiling(args.buffer, args.noise_floor) if args.noise_floor else 1.0
    print("=" * 98)
    print(f"GPS 轨迹 OA 校验（buffer = {args.buffer:g} m）")
    if args.noise_floor:
        print(f"   噪声底线 σ≈{args.noise_floor:g} m → 该设备 OA 理论上限 {ceiling*100:.0f}%"
              f"（结论按上限的 90% 判定）")
    else:
        print("   ⚠️ 未给 --noise-floor：结论按产品标准（OA 90%）判 —— "
              "手机信号差时会冤枉引擎，建议先估噪声底线")
    print("=" * 98)
    print(f"{'OD':<34}{'人':<4}{'OA':>7}{'覆盖':>8}{'P90偏差':>9}{'长度比':>8}   结论")
    print("-" * 98)
    results = []
    for a, b, path, person in items:
        if not os.path.exists(path):
            print(f"{a+' → '+b:<34}{person:<4}  （缺文件 {path}）")
            continue
        r = campus.route(a, b, with_path=True)
        if not r:
            print(f"{a+' → '+b:<34}{person:<4}  （引擎无路线）")
            continue
        trace = _load_trace(path)
        if len(trace) < 2:
            print(f"{a+' → '+b:<34}{person:<4}  （轨迹点不足）")
            continue
        m = evaluate(r, trace, args.buffer)
        m.update({"from": a, "to": b, "person": person, "file": os.path.basename(path)})
        results.append(m)
        od = f"{a} → {b}"
        print(f"{od:<34}{person:<4}{m['oa']*100:>6.0f}%{m['coverage']*100:>7.0f}%"
              f"{m['p90_dev_m']:>8.1f}m{m['length_ratio']:>8}   {_verdict(m, args.buffer, ceiling)}")

    if results:
        print("-" * 98)
        mean_oa = sum(x["oa"] for x in results) / len(results)
        print(f"合计 {len(results)} 条 ｜ 平均 OA {mean_oa*100:.0f}%"
              f" ｜ 平均覆盖率 {sum(x['coverage'] for x in results)/len(results)*100:.0f}%"
              f" ｜ 平均 P90 偏差 {sum(x['p90_dev_m'] for x in results)/len(results):.1f} m")
        # 按人聚合：同一个人的系统性偏差（走法不同/手机不同）应能看出来
        by_p = {}
        for x in results:
            by_p.setdefault(x["person"], []).append(x["oa"])
        if len(by_p) > 1:
            print("按人聚合（OA 均值）：" + " ｜ ".join(
                f"{p or '(未标)'}={sum(v)/len(v)*100:.0f}%" for p, v in by_p.items()))
    if args.json:
        json.dump(results, open(args.json, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        print(f"已写出 JSON：{args.json}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
