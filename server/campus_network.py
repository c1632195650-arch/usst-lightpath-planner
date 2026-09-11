# -*- coding: utf-8 -*-
"""校园路网 + POI 挂载 —— 提供任意两点的步行路径。

数据源：data/osm/junchanglu.osm（© OpenStreetMap contributors，ODbL 1.0）
        + data/campus_map.json 的语义线索（roads 路段 / near_landmark / walk_minutes / zone）

设计：
  · 路网来自 OSM 的真实几何（footway/service/residential 等），Dijkstra 求最短路
  · 每个 POI 按**多轮传播**定位，线索优先级：
      A. OSM 具名建筑（含别名匹配）        —— 最准
      B. near_landmark 邻居坐标均值
      C. roads 路段上的相邻点插值
      D. walk_minutes 邻居按距离加权
      E. 兜底：同 zone 内已定位 POI 的质心 —— 最粗
  · 定位结果只驻留内存，不写回 campus_map.json（保持图谱"不落坐标"的合规设计）

用法：
    from campus_network import Network
    net = Network()
    net.route("第三教学楼", "第五食堂")
"""
import heapq
import json
import math
import os
import re
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OSM_FILE = os.path.join(ROOT, "data", "osm", "junchanglu.osm")
MAP_FILE = os.path.join(ROOT, "data", "campus_map.json")

WALK_SPEED = 1.25  # 米/秒 ≈ 4.5 km/h

HW_WALK = {
    "footway", "path", "steps", "pedestrian", "service",
    "residential", "living_street", "track", "corridor",
}


def hav(a, b):
    R = 6371000.0
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def norm(s):
    """归一化名称：剥外层括号、去补充说明、取斜杠前主体、去『原』前缀。"""
    s = (s or "").strip()
    m = re.match(r"^[（(](.*)[）)]$", s)          # 整体被括号包裹：(原第四食堂)
    if m:
        s = m.group(1).strip()
    t = re.sub(r"[（(][^）)]*[）)]", "", s)
    t = t.split("/")[0].strip()
    t = re.sub(r"^原", "", t).strip()
    return t or s


class Network:
    def __init__(self):
        self.adj = {}          # (lat,lon) -> [(lat,lon), meters]
        self.bld = {}          # OSM 建筑名/归一化名 -> (lat,lon)
        self.poi = {}          # POI 名 -> ((lat,lon), 线索来源)
        self.unlocated = []
        self.bridged = []      # 桥接过的碎片：(缺口米数, 碎片节点数)
        self._load_osm()
        self._bridge_components()
        self._locate_pois()

    # ---------- 路网 ----------
    def _load_osm(self):
        root = ET.parse(OSM_FILE).getroot()
        nodes = {}
        for el in root:
            if el.tag == "node":
                nodes[el.get("id")] = (float(el.get("lat")), float(el.get("lon")))

        adj, bld = {}, {}
        for el in root:
            if el.tag != "way":
                continue
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            pts = [nodes[r] for r in (nd.get("ref") for nd in el.findall("nd")) if r in nodes]
            if not pts:
                continue
            name = tags.get("name")
            if "building" in tags and name:
                c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
                bld.setdefault(name.strip(), c)
                n = norm(name)
                if n:
                    bld.setdefault(n, c)
            if tags.get("highway") in HW_WALK:
                for i in range(len(pts) - 1):
                    a, b = pts[i], pts[i + 1]
                    d = hav(a, b)
                    if d <= 0:
                        continue
                    adj.setdefault(a, []).append((b, d))
                    adj.setdefault(b, []).append((a, d))
        self.adj, self.bld = adj, bld

    # ---------- 碎片桥接 ----------
    def _bridge_components(self, max_gap=300.0):
        """OSM 路网常有小碎片（缺一小段路）。把缺口 < max_gap 的碎片桥接起来。

        只桥接近距离缺口 —— 1100 校区、复兴路校区与主校区相距数公里，不会被误连。
        桥接边按直线距离 ×1.2 计（近似绕行）。
        """
        seen, comps = set(), []
        for n in self.adj:
            if n in seen:
                continue
            st, comp = [n], []
            seen.add(n)
            while st:
                x = st.pop()
                comp.append(x)
                for y, _ in self.adj.get(x, ()):
                    if y not in seen:
                        seen.add(y)
                        st.append(y)
            comps.append(comp)
        comps.sort(key=len, reverse=True)
        if len(comps) <= 1:
            return

        main = set(comps[0])
        for comp in comps[1:]:
            best = None
            for a in comp:
                for b in main:
                    d = hav(a, b)
                    if best is None or d < best[0]:
                        best = (d, a, b)
            if best is None:
                continue
            d, a, b = best
            if d <= max_gap:
                w = d * 1.2
                self.adj.setdefault(a, []).append((b, w))
                self.adj.setdefault(b, []).append((a, w))
                main.update(comp)
                self.bridged.append((round(d), len(comp)))

    # ---------- POI 定位 ----------
    def _locate_pois(self):
        m = json.load(open(MAP_FILE, encoding="utf-8"))
        allp = m["pois"] + m["landmarks"]
        by_name = {p["name"]: p for p in allp}
        res = {}

        def alias_resolve(x):
            if x in by_name:
                return x
            for p in allp:
                if x in p.get("alias", []):
                    return p["name"]
            return None

        pending = list(allp)
        for _ in range(5):
            still = []
            for p in pending:
                c, src = None, None

                # A. OSM 建筑
                for cand in [p["name"]] + list(p.get("alias", [])):
                    if cand in self.bld:
                        c, src = self.bld[cand], "osm"
                        break
                    n = norm(cand)
                    if n and n in self.bld:
                        c, src = self.bld[n], "osm"
                        break

                # B. near_landmark
                if c is None:
                    nb = []
                    for x in p.get("near_landmark", []):
                        x = re.sub(r"[（(].*", "", x).strip()
                        xn = alias_resolve(x)
                        if xn and xn in res:
                            nb.append(res[xn][0])
                    if nb:
                        c = (sum(y[0] for y in nb) / len(nb), sum(y[1] for y in nb) / len(nb))
                        src = "near_landmark"

                # C. roads 路段相邻点
                if c is None:
                    for road in m.get("roads", []):
                        segs = [s.strip() for s in road["line"].split("→")]
                        hit = [x for x in segs if alias_resolve(x) == p["name"]] or ([p["name"]] if p["name"] in segs else [])
                        if not hit:
                            continue
                        i = segs.index(hit[0])
                        nb = []
                        for j in (i - 1, i + 1):
                            if 0 <= j < len(segs):
                                xn = alias_resolve(segs[j])
                                if xn and xn in res:
                                    nb.append(res[xn][0])
                        if nb:
                            c = (sum(y[0] for y in nb) / len(nb), sum(y[1] for y in nb) / len(nb))
                            src = "roads"
                            break

                # D. walk_minutes 邻居（按分钟数反比加权）
                if c is None:
                    nb = []
                    for w in m.get("walk_minutes", []):
                        if w["from"] == p["name"] and w["to"] in res:
                            nb.append((res[w["to"]][0], float(w.get("minutes", 3))))
                        elif w["to"] == p["name"] and w["from"] in res:
                            nb.append((res[w["from"]][0], float(w.get("minutes", 3))))
                    if nb:
                        tw = sum(1.0 / max(mn, 0.5) for _, mn in nb)
                        c = (sum(cc[0] / max(mn, 0.5) for cc, mn in nb) / tw,
                             sum(cc[1] / max(mn, 0.5) for cc, mn in nb) / tw)
                        src = "walk_minutes"

                if c is None:
                    still.append(p)
                else:
                    res[p["name"]] = (c, src)
            pending = still
            if not pending:
                break

        # E. 兜底：逐级放宽 —— 同 zone → 同校区 → 全局质心
        for p in pending:
            tiers = [
                ("zone", [res[q["name"]][0] for q in allp
                          if q.get("zone") == p.get("zone") and q["name"] in res]),
                ("campus", [res[q["name"]][0] for q in allp
                            if q.get("campus") == p.get("campus") and q["name"] in res]),
                ("global", [v[0] for v in res.values()]),
            ]
            for src_name, peers in tiers:
                if peers:
                    res[p["name"]] = ((sum(x[0] for x in peers) / len(peers),
                                       sum(x[1] for x in peers) / len(peers)), src_name)
                    break

        self.poi = res
        self.unlocated = [p["name"] for p in allp if p["name"] not in res]

        # 别名 → 主名，供 route() 解析口语名（如「第四宿舍 (思伊堂)」）
        self.alias_map = {}
        for p in allp:
            for a in p.get("alias", []):
                self.alias_map.setdefault(a, p["name"])

    def resolve(self, name):
        """把任意写法解析为图谱里的 POI 主名；解析不到返回 None。"""
        if name in self.poi:
            return name
        if name in self.alias_map:
            return self.alias_map[name]
        n = norm(name)
        for k in self.poi:
            if norm(k) == n:
                return k
        return None

    # ---------- 寻路 ----------
    def _snap(self, pt):
        best, bd = None, 1e18
        for n in self.adj:
            d = hav(pt, n)
            if d < bd:
                bd, best = d, n
        return best, bd

    def _dijkstra(self, src, dst):
        if src not in self.adj or dst not in self.adj:
            return None
        dist, pq, seen = {src: 0.0}, [(0.0, src)], set()
        while pq:
            d, u = heapq.heappop(pq)
            if u in seen:
                continue
            seen.add(u)
            if u == dst:
                return d
            for v, w in self.adj.get(u, ()):
                nd = d + w
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    heapq.heappush(pq, (nd, v))
        return None

    def route(self, a, b):
        """返回 dict 或 None（未定位 / 不连通）。

        reliable=False 表示至少一端是靠 zone/campus/global 质心兜底定位的，
        或两端坐标几乎重合 —— 此时距离仅供参考。
        """
        a, b = self.resolve(a), self.resolve(b)
        if not a or not b:
            return None
        pa, pb = self.poi[a], self.poi[b]
        sa, da = self._snap(pa[0])
        sb, db = self._snap(pb[0])
        d = self._dijkstra(sa, sb)
        if d is None:
            return None
        total = d + da + db
        weak = ("zone", "campus", "global")
        reliable = (pa[1] not in weak and pb[1] not in weak
                    and hav(pa[0], pb[0]) > 5)
        return {
            "from": a, "to": b,
            "meters": total,
            "path_meters": d,
            "access": (da, db),
            "minutes": total / WALK_SPEED / 60,
            "locate": (pa[1], pb[1]),
            "reliable": reliable,
        }

    def stats(self):
        n = len(self.poi)
        from collections import Counter
        c = Counter(v[1] for v in self.poi.values())
        return {
            "path_nodes": len(self.adj),
            "osm_buildings": len({k for k in self.bld}),
            "poi_located": n,
            "by_source": dict(c),
            "unlocated": self.unlocated,
        }


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    net = Network()
    st = net.stats()
    print("=" * 66)
    print("校园路网 · POI 挂载诊断")
    print("=" * 66)
    print(f"  路网节点      : {st['path_nodes']}")
    print(f"  OSM 建筑索引  : {st['osm_buildings']}")
    print(f"  POI 已定位    : {st['poi_located']}")
    for k, v in sorted(st["by_source"].items(), key=lambda x: -x[1]):
        print(f"      {k:14s}: {v}")
    if st["unlocated"]:
        print(f"  未能定位      : {len(st['unlocated'])} → {'、'.join(st['unlocated'])}")
    print()
    print("  实测样例：")
    for a, b in [("第三教学楼", "第五食堂"), ("第一教学楼", "第三教学楼"),
                 ("南校区第一宿舍", "清真食堂（334）"), ("刘湛恩故居", "第一食堂"),
                 ("第二学生公寓", "第五学生公寓")]:
        r = net.route(a, b)
        if r:
            print(f"    {a} → {b}: {r['meters']:.0f} 米 / {r['minutes']:.1f} 分钟  (定位 {r['locate'][0]}/{r['locate'][1]})")
        else:
            print(f"    {a} → {b}: 无法计算（未定位或不连通）")
