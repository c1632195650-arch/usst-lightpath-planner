"""用本地 OSM 数据算校园内两点的步行路径。

数据来源：data/osm/junchanglu.osm（由 scripts/fetch_osm.py 拉取）
数据 © OpenStreetMap contributors，ODbL 1.0

用法：
    python scripts/osm_route.py --list                # 列出全部具名建筑
    python scripts/osm_route.py 第三教学楼 第五食堂     # 算步行路径
"""
import os
import sys
import math
import heapq
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OSM_FILE = os.path.join(ROOT, "data", "osm", "junchanglu.osm")

# 步行速度（米/秒）。1.25 m/s ≈ 4.5 km/h，校园常见步速；实测校核后可调。
WALK_SPEED = 1.25

HW_WALK = {
    "footway", "path", "steps", "pedestrian", "service",
    "residential", "living_street", "track", "corridor",
}

# 常用简称 → OSM 全称
ALIAS = {
    "一教": "第一教学楼", "二教": "第二教学楼", "三教": "第三教学楼", "四教": "第四教学楼",
    "五食堂": "第五食堂", "一食堂": "第一食堂", "二食堂": "第二食堂 / 教工食堂",
    "二公寓": "第二学生公寓 1 号楼", "三公寓": "第三学生公寓 1 号楼",
    "四公寓": "第四学生公寓 1 号楼", "五公寓": "第五学生公寓 1 号楼",
    "六宿舍": "第六宿舍 (留学生公寓) (馥赉堂)",
}


def hav(a, b):
    R = 6371000.0
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def load():
    root = ET.parse(OSM_FILE).getroot()
    nodes, ways = {}, []
    for el in root:
        if el.tag == "node":
            nodes[el.get("id")] = (float(el.get("lat")), float(el.get("lon")))
        elif el.tag == "way":
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            ways.append((tags, [nd.get("ref") for nd in el.findall("nd")]))

    bld, adj = {}, {}
    for tags, refs in ways:
        if "building" in tags and tags.get("name"):
            pts = [nodes[r] for r in refs if r in nodes]
            if pts:
                bld[tags["name"]] = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        if tags.get("highway") in HW_WALK:
            pts = [nodes[r] for r in refs if r in nodes]
            for i in range(len(pts) - 1):
                a, c = pts[i], pts[i + 1]
                d = hav(a, c)
                if d <= 0:
                    continue
                adj.setdefault(a, []).append((c, d))
                adj.setdefault(c, []).append((a, d))
    return bld, adj


def nearest(pt, adj):
    best, bd = None, 1e18
    for n in adj:
        d = hav(pt, n)
        if d < bd:
            bd, best = d, n
    return best, bd


def dijkstra(src, dst, adj):
    dist, pq, seen = {src: 0.0}, [(0.0, src)], set()
    while pq:
        d, u = heapq.heappop(pq)
        if u in seen:
            continue
        seen.add(u)
        if u == dst:
            return d
        for v, w in adj.get(u, ()):
            nd = d + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return None


def resolve(name, bld):
    if name in bld:
        return name
    name = ALIAS.get(name, name)
    if name in bld:
        return name
    hits = [k for k in bld if name in k or k in name]
    return hits[0] if hits else None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    bld, adj = load()

    if "--list" in sys.argv or not args:
        print(f"OSM 具名建筑 {len(bld)} 栋 ｜ 路网节点 {len(adj)}")
        print("用法：python scripts/osm_route.py <起点> <终点>\n")
        for i, k in enumerate(sorted(bld)):
            print(f"  {k}", end="\n" if i % 2 else " ｜")
        print()
        return

    if len(args) < 2:
        print("请给出起点和终点，例如：python scripts/osm_route.py 三教 五食堂")
        return

    a, b = resolve(args[0], bld), resolve(args[1], bld)
    if not a or not b:
        miss = args[0] if not a else args[1]
        print(f"未匹配到建筑「{miss}」—— 用 --list 查看可用名称")
        return

    s, sd = nearest(bld[a], adj)
    t, td = nearest(bld[b], adj)
    d = dijkstra(s, t, adj)
    if d is None:
        print(f"{a} → {b}：路网不连通（分属不同连通块）")
        return

    total = d + sd + td          # 含建筑到路网的接驳段
    line = hav(bld[a], bld[b])
    print(f"{a} → {b}")
    print(f"  路径 {total:.0f} 米（路网 {d:.0f} + 接驳 {sd:.0f}+{td:.0f}）")
    print(f"  直线 {line:.0f} 米 ｜ 绕行比 {total/line:.2f}")
    print(f"  步行约 {total/WALK_SPEED/60:.1f} 分钟（按 {WALK_SPEED} m/s）")


if __name__ == "__main__":
    main()
