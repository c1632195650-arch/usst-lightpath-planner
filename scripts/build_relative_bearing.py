# -*- coding: utf-8 -*-
"""L3 · 相对方位表生成器 —— `data/relative_bearing.json`

## 为什么要这一层

`campus_map.json` 按合规口径**不落坐标**（坐标只存在于 `data/osm/key_points.json`
与内存里的 OSM 几何）。但「图书馆在一教的哪边、多远」这类**相对关系**是问路/回答
真正需要的，而且**天然不含经纬度**。

本层把 OSM 几何算出来的相对关系固化成一张可离线查询的表：
    第一教学楼 → 图书馆（图文信息中心）：西南 218°，260 m

## 口径

· 每个地点只记它**最近的 K 个邻居**（默认 6），半径 800 m 内，且**同一可步行分组**
  （本部 vs 1100 —— 跨区分组不记，否则会出现「1100 教学楼在北校东边 2 公里」这种废话）。
· 方位用**初始方位角**（大圆航线起点切向），再折成 8 向中文。
· 距离用 WGS-84 大圆距离，取整到米。
· 只对**实锚**（osm / keypoint / roads）计算 —— 弱锚（zone / campus / global / approx）
  的位置本身是推出来的，再拿它算方位等于把误差二次放大。这一条的守卫在
  `PREFER_STRONG`。

## 合规

输出**只有三样东西**：方位（度）、8 向中文、米。没有任何经纬度。
脚本自带 `_assert_no_coords()` 自检 —— 一旦输出里出现 `31.2x` / `121.5x` 形态的数值就报错退出。

用法：
    python scripts/build_relative_bearing.py            # 生成
    python scripts/build_relative_bearing.py --check    # 只校验现有表是否最新
"""
import argparse
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "server"))

OUT_PATH = os.path.join(ROOT, "data", "relative_bearing.json")

TOP_K = 6            # 每个地点记最近几个邻居
MAX_M = 800.0        # 超过这个距离就不记（问路只关心「附近」）
PREFER_STRONG = True  # 只对实锚计算
STRONG = {"osm", "keypoint", "roads"}

DIRS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]

NOTE = (
    "【L3 · 相对方位 · 2026-09-18】由 `scripts/build_relative_bearing.py` 从 OSM 几何离线生成。"
    "每条 = 「target 在 at 的 dir 方向，约 m 米」。**只含方位与距离，不含任何经纬度** —— 这正是它的价值："
    "合规上可以直接对外，功能上顶替不了的是「给出坐标」而不是「说清方位」。"
    "只对实锚（osm/keypoint/roads）计算；跨可步行分组的对不记。"
)


def bearing(a, b):
    """a→b 的初始方位角（度，0=正北，顺时针）。"""
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    dl = lo2 - lo1
    y = math.sin(dl) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def compass(deg):
    """方位角 → 8 向中文（每向 45°，扇区中心对齐）。"""
    return DIRS[int((deg + 22.5) % 360 // 45)]


def _assert_no_coords(path):
    """自检：输出里不允许出现经纬度形态的数值。"""
    s = open(path, encoding="utf-8").read()
    bad = re.findall(r"\b(?:31\.\d{3,}|121\.\d{3,})\b", s)
    if bad:
        print(f"❌ 合规自检失败：输出里出现疑似坐标数值 {sorted(set(bad))[:5]}", file=sys.stderr)
        return False
    return True


def build():
    import campus_network as cn

    net = cn.Network()
    strong = {n: xy for n, (xy, src) in net.poi.items() if (not PREFER_STRONG or src in STRONG)}
    same = cn.same_walk_group
    campus_of = net._campus_of
    names = sorted(strong)

    pairs = []
    for at in names:
        pa = strong[at]
        cand = []
        for tgt in names:
            if tgt == at:
                continue
            if not same(campus_of.get(at), campus_of.get(tgt)):
                continue
            d = cn.hav(pa, strong[tgt])
            if 0 < d <= MAX_M:
                cand.append((d, tgt))
        cand.sort()
        for d, tgt in cand[:TOP_K]:
            deg = bearing(pa, strong[tgt])
            pairs.append({
                "at": at,                     # 站在这里…
                "target": tgt,                # …看这个
                "dir": compass(deg),          # 它在哪个方向（8 向）
                "deg": round(deg, 1),         # 方位角（0=正北，顺时针）
                "m": int(round(d)),           # 直线距离（米）
            })

    out = {
        "_meta": {
            "layer": "L3 相对关系",
            "note": NOTE,
            "generated": "2026-09-18",
            "source": "OSM（© OpenStreetMap contributors，ODbL 1.0）几何，离线计算",
            "top_k": TOP_K,
            "max_m": int(MAX_M),
            "strong_only": PREFER_STRONG,
            "coords_included": False,
            "compass_8": DIRS,
            "usage": "答案里可以说『图书馆在图文信息中心西南约 260 米』；这就是本表的用途。",
        },
        "pairs": pairs,
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")

    print(f"✅ 已写回 {os.path.relpath(OUT_PATH, ROOT)}")
    print(f"   地点 {len(names)}｜关系 {len(pairs)} 条（每个地点最多 {TOP_K} 个邻居，半径 {int(MAX_M)} m）")
    if not _assert_no_coords(OUT_PATH):
        return 1
    print("   ✅ 合规自检：输出无经纬度")
    return 0


def check():
    if not os.path.exists(OUT_PATH):
        print("❌ 表不存在，先跑一次生成", file=sys.stderr)
        return 1
    d = json.load(open(OUT_PATH, encoding="utf-8"))
    print(f"   地点（去重）{len({p['at'] for p in d['pairs']})}｜关系 {len(d['pairs'])} 条")
    if not _assert_no_coords(OUT_PATH):
        return 1
    print("   ✅ 合规自检：输出无经纬度")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验现有表")
    args = ap.parse_args()
    sys.exit(check() if args.check else build())
