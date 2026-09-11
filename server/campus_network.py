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
KEY_FILE = os.path.join(ROOT, "data", "osm", "key_points.json")
MAP_FILE = os.path.join(ROOT, "data", "campus_map.json")

WALK_SPEED = 1.25  # 米/秒 ≈ 4.5 km/h

# 步道 + 校内路（一定可走）
HW_WALK = {
    "footway", "path", "steps", "pedestrian", "service",
    "residential", "living_street", "track", "corridor",
}
# 城市道路：行人可沿路边走（军工路 primary / 海安路 tertiary / cycleway 等）。
# 必须纳入 —— 否则「从七公寓（580 校门旁）沿军工路走校外」这类更快路线会被漏掉，
# 导致路径时间系统性偏慢。高德之所以给出校外路线，正是因为校外确实可能更快。
HW_STREET = {
    "primary", "primary_link", "secondary", "secondary_link",
    "tertiary", "tertiary_link", "cycleway", "unclassified",
}
# 明确不可步行：高架快速路（中环路 trunk 等）
HW_NO = {"trunk", "trunk_link", "motorway", "motorway_link", "raceway", "bus_guideway"}

# 城市道路的步行折损：沿马路边走比校园步道慢一些，但不是不能走
STREET_PENALTY = 1.15


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

        adj, bld, street_edges = {}, {}, set()
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
                # 同名建筑可能有南北两栋（如「室内体育馆」），全部保留按校区挑
                for key in {name.strip(), norm(name)}:
                    if key:
                        bld.setdefault(key, []).append(c)
            h = tags.get("highway")
            if h in HW_WALK or h in HW_STREET:
                is_street = h in HW_STREET
                pen = STREET_PENALTY if is_street else 1.0
                for i in range(len(pts) - 1):
                    a, b = pts[i], pts[i + 1]
                    d = hav(a, b)
                    if d <= 0:
                        continue
                    adj.setdefault(a, []).append((b, d * pen))
                    adj.setdefault(b, []).append((a, d * pen))
                    if is_street:
                        street_edges.add(frozenset((a, b)))
        self.adj, self.bld, self.street_edges = adj, bld, street_edges
        # 与至少一条步道相连的节点（用于「仅校内」模式下的吸附与寻路）
        self.campus_nodes = {
            n for n, lst in adj.items()
            if any(frozenset((n, b)) not in street_edges for b, _ in lst)
        }

        # 关键节点（校门/天桥）为人工核对坐标，优先级最高；approx 段是近似锚点
        try:
            _kp = json.load(open(KEY_FILE, encoding="utf-8"))
            self.key_points = dict(_kp.get("points", {}))
            self.approx_names = {k for k in _kp.get("approx", {}) if not k.startswith("_")}
            for _n in self.approx_names:
                self.key_points.setdefault(_n, _kp["approx"][_n]["coord"])
        except Exception:
            self.key_points, self.approx_names = {}, set()

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
    CAMPUS_CENTER = {"北校": (31.2950161, 121.5506739), "南校": (31.2906712, 121.5535545)}

    def _campus_ok(self, coord, campus):
        """OSM 命中点的所在校区是否与图谱标注一致。

        防止「南校五公寓」被同名 OSM 建筑（在北校）带偏 —— 曾导致
        「第二学生公寓 ↔ 第五学生公寓」算出 3 分钟（跨校区实际约 15 分钟）。
        无 campus 标注（如『连接』）则不校验。
        """
        if campus not in self.CAMPUS_CENTER:
            return True
        d_n = hav(coord, self.CAMPUS_CENTER["北校"])
        d_s = hav(coord, self.CAMPUS_CENTER["南校"])
        return (d_n < d_s) == (campus == "北校")

    def _pick(self, key, campus):
        """从同名候选里挑出与图谱校区相符的那个。"""
        for cc in self.bld.get(key, []):
            if self._campus_ok(cc, campus):
                return cc
        return None

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

                # A0. 人工核对的关键节点（校门/天桥）—— 优先于一切
                kp = self.key_points.get(p["name"])
                if kp:
                    c = tuple(kp)
                    src = "approx" if p["name"] in self.approx_names else "keypoint"

                # A. OSM 建筑（命中点须与图谱标注的校区一致）
                if c is None:
                    for cand in [p["name"]] + list(p.get("alias", [])):
                        hit = self._pick(cand, p.get("campus")) or self._pick(norm(cand), p.get("campus"))
                        if hit:
                            c, src = hit, "osm"
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
    def _snap(self, pt, campus_only=False):
        """把坐标吸附到最近的路网节点 —— 两种模式都**优先吸附到步道节点**。

        建筑物旁边理应是步道；若吸到马路边节点，会既绕远又让「仅校内」模式无路可走
        （曾导致「一教→三教 最快 9.8 分」比「仅校内 8.5 分」还慢的矛盾结果）。
        """
        pool = self.campus_nodes or self.adj
        best, bd = None, 1e18
        for n in pool:
            d = hav(pt, n)
            if d < bd:
                bd, best = d, n
        return best, bd

    def _dijkstra(self, src, dst, mode="fastest"):
        if src not in self.adj or dst not in self.adj:
            return None
        campus_only = (mode == "campus")
        dist, pq, seen = {src: 0.0}, [(0.0, src)], set()
        while pq:
            d, u = heapq.heappop(pq)
            if u in seen:
                continue
            seen.add(u)
            if u == dst:
                return d
            for v, w in self.adj.get(u, ()):
                if campus_only and frozenset((u, v)) in self.street_edges:
                    continue   # 仅校内模式：跳过城市道路边
                nd = d + w
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    heapq.heappush(pq, (nd, v))
        return None

    def route(self, a, b, mode="fastest"):
        """返回 dict 或 None（未定位 / 不连通）。

        mode:
          "fastest" —— 全路网（含军工路等校外城市道路），即「实地怎么走最快」
          "campus"  —— 只走校内步道，用来对比「纯校内绕行」要多花多少时间
        reliable=False 表示至少一端是靠 zone/campus/global 质心兜底定位的，
        或两端坐标几乎重合 —— 此时距离仅供参考。
        """
        a, b = self.resolve(a), self.resolve(b)
        if not a or not b:
            return None
        pa, pb = self.poi[a], self.poi[b]
        c_only = (mode == "campus")
        sa, da = self._snap(pa[0], c_only)
        sb, db = self._snap(pb[0], c_only)
        d = self._dijkstra(sa, sb, mode)
        if d is None:
            return None
        total = d + da + db
        weak = ("zone", "campus", "global", "approx")
        reliable = (pa[1] not in weak and pb[1] not in weak
                    and hav(pa[0], pb[0]) > 5)
        return {
            "from": a, "to": b,
            "mode": mode,
            "meters": total,
            "path_meters": d,
            "access": (da, db),
            "minutes": total / WALK_SPEED / 60,
            "locate": (pa[1], pb[1]),
            "reliable": reliable,
        }

    def compare(self, a, b):
        """多路径对比：全路网（最快）vs 仅校内。返回 dict 或 None。

        用来回答「这条是不是得走校外才快」「从七公寓出发要不要出校门」。
        """
        fast = self.route(a, b, "fastest")
        camp = self.route(a, b, "campus")
        if not fast and not camp:
            return None
        res = {"from": fast["from"] if fast else camp["from"],
               "to": fast["to"] if fast else camp["to"],
               "fastest": fast, "campus": camp}
        if fast and camp:
            res["diff_minutes"] = camp["minutes"] - fast["minutes"]
            res["outdoor_better"] = res["diff_minutes"] > 0.5
        else:
            res["diff_minutes"] = None
            res["outdoor_better"] = None
        return res

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
