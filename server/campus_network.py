# -*- coding: utf-8 -*-
"""校园路网 + POI 挂载 —— 提供任意两点的步行路径。

数据源：data/osm/junchanglu.osm（本部，© OpenStreetMap contributors，ODbL 1.0）
        + data/osm/jichuxueyuan.osm（1100 基础学院及周边，同一 OSM 快照）
        + data/campus_map.json 的语义线索（roads 路段 / near_landmark / walk_minutes / zone）

设计：
  · 路网来自 OSM 的真实几何（footway/service/residential 等），Dijkstra 求最短路
  · 两份 OSM 提取来自同一快照 —— 367 个节点坐标**完全重合**，按 (lat,lon) 直接拼接成
    一张图；实测本部 ↔ 1100 沿军工路连通（516 校门 → 1100 教学楼 ≈ 1.5 km / 20 分钟）
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
OSM_DIR = os.path.join(ROOT, "data", "osm")
# 复兴路校区（fuxinglu.osm）暂不接入：图谱里没有复兴路 POI，也无内部路网语义锚点。
OSM_FILES = ("junchanglu.osm", "jichuxueyuan.osm")
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

# ---------- 车行隧道：不可步行（2026-09-18 修）----------
# 周家嘴路隧道（`tunnel=yes`, `layer=-2/-3`, `highway=primary`）此前被当作普通城市道路
# 纳入路网 —— 行人根本进不了江底车行隧道。实测它正是「7 处碎片桥接」之一（缺口 4.4 m），
# 也就是说我们把一条不可通行的隧道接进了步行图，还顺手用它连通了两块路网。
# 规则收紧得**只针对城市道路**：`tunnel=yes` 的 footway/path 是**人行地道**，必须保留可走
# （`tunnel=building_passage` 同理），所以不能一刀切。
TUNNEL_CAR = {"yes", "culvert"}

# ---------- 可穿越的开敞空间（广场）----------
# OSM 用 `area=yes` + `highway=pedestrian` 表达**面状**步行空间：广场、楼间大空地。
# 此前与普通道路一样按**折线**装载 —— 人只能沿周长绕，明明能斜穿却要绕边。
# 只收 `pedestrian`（**语义上明确就是行人空间**）。实测过把 `service` 面（停车场/回车场）
# 也算进来：多 229 条边，总绕行中位只从 1.510 降到 1.503 —— 收益 ~0.1%，
# 却引入「车行场地上能否随意穿行」这个**无法证实**的假设。宁窄勿滥。
# 依据（不臆造）：夏威夷大学 298 条实地 OD 研究指出校内步行无约束，
# "on-campus walking is unrestricted and can deviate from discrete roadways or sidewalks"。
# ⚠️ 实测结论也要如实写在体检报告里：**这一层对总绕行的改善很小（~0.5%）**，
#    绕行系数偏高的主因不是「缺广场斜穿」，而是 OSM 上校园路径本身就稀疏。见 docs/。
HW_AREA = {"pedestrian"}
AREA_CHORD_MAX = 90.0   # 面内两点超过此距离不直连 —— 避免横穿整个大场（那不是「斜穿」）
AREA_PENALTY = 1.10     # 穿空地略慢于铺装步道（避让、绕树、绕花坛）

# 点状地图要素（amenity/shop/leisure…）——建筑面索引拿不到的点状设施。
# 实例：1100 的「教育超市」(shop=supermarket)、「校医务室」(amenity=clinic)。
NODE_TAG_KEYS = {"amenity", "shop", "leisure", "tourism", "office", "healthcare"}


# ---------- 可步行分组（校区隔离的唯一口径）----------
# 为什么需要它：`_locate_pois` 的 near_landmark / zone / global 档位原先**不校验校区**，
# 于是独立校区的地点会被本部地标吸附 —— 实测 `1100教育超市`、`申一教`、`申二教`、
# `1100图书馆` 曾全部塌缩到北校「学生活动中心」坐标，进而算出「三教 → 1100教育超市 4.5 分钟」
# 这种离谱结果（两处实际相距约 600 米以上）。
# 口径与 campus.py 的 `_CAMPUS_CN` / `_meta.notes` 一致：
#   本部 = 北校（军工路 516）＋ 南校（军工路 334），由海安路人行天桥相连；
#          580 号（军工路 580，北校西北角同一片街区，七公寓/民族餐厅在此）并入本部，可步行。
#   独立 = 1100 基础学院 / 复兴路 —— **作为排程/就近推荐的口径保持独立**（不参与本部
#          日常排程）。注：1100 的路网自 2026-09-16 起已接入（jichuxueyuan.osm），沿军工路
#          实际步行可达 —— 跨组通行参考走 `route_cross_group()`，不放宽本口径。
_WALK_GROUP = {"北校": "本部", "南校": "本部", "580": "本部", "连接": "本部"}


def walk_group(campus):
    """校区码 → 可步行分组。未知（None / 空）返回 None。"""
    if not campus:
        return None
    return _WALK_GROUP.get(campus, campus)


def same_walk_group(a, b):
    """两个校区码是否属于同一可步行分组。

    任一方未知时返回 True —— 保持既有宽松行为（不因为缺标注就拒绝定位），
    只有**明确分属两个不同分组**时才阻断。
    """
    ga, gb = walk_group(a), walk_group(b)
    if ga is None or gb is None:
        return True
    return ga == gb


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
        self.bridged = []      # 桥接过的碎片：[{gap_m, nodes, a, b}] —— 实为**校外**碎片的连接
        self.bridge_edges = set()
        self.area_edges = set()
        self.area_polys = 0
        self.skipped_tunnel = []
        self._load_osm()
        self._bridge_components()
        self._dedupe_adj()
        self._locate_pois()

    # ---------- 路网 ----------
    def _load_osm(self):
        adj, bld, street_edges, node_poi = {}, {}, set(), {}
        area_edges = set()      # 广场内部斜穿边（"校园"模式可用，"最快"模式也可用）
        area_polys = 0          # 识别到的面状步行空间个数（诊断用）
        skipped_tunnel = []     # 被剔除的车行隧道（诊断用）
        for fn in OSM_FILES:
            root = ET.parse(os.path.join(OSM_DIR, fn)).getroot()
            nodes, node_named, way_pts = {}, {}, {}
            for el in root:
                if el.tag != "node":
                    continue
                p = (float(el.get("lat")), float(el.get("lon")))
                nodes[el.get("id")] = p
                tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
                name = tags.get("name")
                if name and NODE_TAG_KEYS & tags.keys():
                    node_named.setdefault(name.strip(), []).append(p)
            node_poi.update(node_named)   # 同名时后者覆盖前者（同快照坐标一致，无实际影响）

            for el in root:
                if el.tag != "way":
                    continue
                tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
                pts = [nodes[r] for r in (nd.get("ref") for nd in el.findall("nd")) if r in nodes]
                if not pts:
                    continue
                way_pts[el.get("id")] = pts      # 供下方 relation 拼面用（relation 只带 way 引用）
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
                    # 🔴 车行隧道不可步行（只拦城市道路 —— 人行地道是 footway/path，保留）
                    if is_street and tags.get("tunnel") in TUNNEL_CAR:
                        skipped_tunnel.append((tags.get("name") or el.get("id"), h, tags.get("tunnel")))
                        continue
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
                    # 面状步行空间：整条闭合折线记下来，稍后补「面内直连边」
                    if tags.get("area") == "yes" and h in HW_AREA and len(pts) >= 3:
                        area_polys += 1
                        uniq = list(dict.fromkeys(pts))
                        for i in range(len(uniq)):
                            for j in range(i + 1, len(uniq)):
                                d = hav(uniq[i], uniq[j])
                                if 0 < d <= AREA_CHORD_MAX:
                                    w = d * AREA_PENALTY
                                    adj.setdefault(uniq[i], []).append((uniq[j], w))
                                    adj.setdefault(uniq[j], []).append((uniq[i], w))
                                    area_edges.add(frozenset((uniq[i], uniq[j])))

            # ③ 关系（multipolygon 建筑）—— 此前**整类被忽略**（只读 node 与 way）。
            #    OSM 里相当多的校园建筑是「若干个 way 拼成一个面」，用 relation 表达：
            #    实测被漏掉的有湛恩纪念图书馆、综合楼 A–D 座、管理学院、教育超市、
            #    第一食堂、第九/第十/第十二宿舍、会议中心、现代化教学中心…
            #    后果不只是少几个锚点：**图书馆被迫退到 zone 质心这种弱锚**，
            #    与「图书馆（图文信息中心）」塌缩到同一个点（2026-09-16 评估发现）。
            #    质心取成员 way 的全部节点均值 —— 这些楼都是规整矩形，够用。
            #    只收带 building / building:part 的关系，把杨浦区边界、公交线路、
            #    河道、landuse（上理小区/时运苑）这类非建筑关系挡在索引之外。
            #    ⚠️ 追加在 way **之后**：同名时 `_pick` 取首个校区相符的候选，
            #    所以 way 的既有锚点逐字节不变，这里是纯加法。
            for el in root:
                if el.tag != "relation":
                    continue
                tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
                if tags.get("type") != "multipolygon":
                    continue
                if "building" not in tags and "building:part" not in tags:
                    continue
                name = tags.get("name")
                if not name:
                    continue
                pts = []
                for mb in el.findall("member"):
                    if mb.get("type") == "way":
                        pts.extend(way_pts.get(mb.get("ref"), []))
                if not pts:
                    continue
                c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
                for key in {name.strip(), norm(name)}:
                    if key:
                        bld.setdefault(key, []).append(c)

        self.adj, self.bld, self.street_edges, self.node_poi = adj, bld, street_edges, node_poi
        self.area_edges, self.area_polys, self.skipped_tunnel = area_edges, area_polys, skipped_tunnel
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

        ⚠️ 2026-09-18 实测澄清（此前一直被当成「校内路网断成 7 截」）：
        这 7 处**没有一处落在校园内部** —— 全在校外（控江路/图们路居民区内部路、
        周家嘴路车行隧道、军工路 primary）。校内路网本来就是**一整块**。
        所以桥接的性质是「给校外碎片留条路」，而不是「补校内的洞」；
        它们是**精度最差的边**（直线 ×1.2 的猜法），记录端点供体检报告分类。
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
                self.bridge_edges.add(frozenset((a, b)))
                main.update(comp)
                self.bridged.append({"gap_m": round(d), "nodes": len(comp), "a": a, "b": b})

    def _dedupe_adj(self):
        """同一对节点只保留**一条**边，权重取最小值。

        为什么会有重复：一条 way 可能同时带 `highway=footway` 与 `highway=service`，
        或者广场的**面内直连边**正好压在某条真实周长边上 —— 于是同一个节点对会被
        写进邻接表两次，且**两次的惩罚系数不同**（步道 1.0 / 城市道路 1.15 /
        穿广场 1.10）。2026-09-18 体检实测：2750 条边里有 **376 对**是重复的
        （其中 148 对权重不一致）。

        ⚠️ 这是**行为等价**的清理：`_dijkstra` 本来就对同一对节点松弛多次、
        取最小的那个距离，所以「只留最小权重」得到的最短路与清理前**完全一致**
        —— 只是少了 14% 的无效松弛。留最小也是正确的语义：一条路只要有一侧
        算步道，就不该按机动车道的惩罚来走。
        """
        for n, lst in self.adj.items():
            if len(lst) < 2:
                continue
            best = {}
            for v, w in lst:
                if v not in best or w < best[v]:
                    best[v] = w
            if len(best) != len(lst):
                self.adj[n] = [(v, w) for v, w in best.items()]

    # ---------- POI 定位 ----------
    CAMPUS_CENTER = {"北校": (31.2950161, 121.5506739), "南校": (31.2906712, 121.5535545)}

    # 1100 基础学院片区的纬度分界。⚠️ 窗口极窄（~36 m），两头的界标都实测过：
    #   本部最北 OSM 建筑 = 第五食堂 31.298419；1100 最南 OSM 要素 = 校区西南
    #   service 路 31.29874 —— 取中点 31.2986。若 OSM 更新后两边有新要素
    #   越过此线，请以「(本部最北 + 1100最南)/2」重新取值。
    # 用途：OSM 命中点的校区归属校验 —— 1100 片区里的同名设施（如「教育超市」节点
    # 在本部南校与 1100 各有一个）不允许被本部 POI 认领，反之亦然。
    _LAT_1100 = 31.2986

    def _campus_ok(self, coord, campus):
        """OSM 命中点的所在校区是否与图谱标注一致。

        防止「南校五公寓」被同名 OSM 建筑（在北校）带偏 —— 曾导致
        「第二学生公寓 ↔ 第五学生公寓」算出 3 分钟（跨校区实际约 15 分钟）。
        无 campus 标注（如『连接』）则不校验。
        2026-09-16 新增 1100 片区校验：jichuxueyuan.osm 的 bbox 覆盖本部到 1100
        沿线，同名设施必须按纬度分界隔离（本部南校与 1100 各有一个「教育超市」）。
        """
        if coord[0] >= self._LAT_1100:
            return campus == "1100"          # 1100 片区的点只归 1100 认领
        if campus == "1100":
            return False                     # 1100 的 POI 不许认领片区外的点
        if campus not in self.CAMPUS_CENTER:
            return True
        d_n = hav(coord, self.CAMPUS_CENTER["北校"])
        d_s = hav(coord, self.CAMPUS_CENTER["南校"])
        return (d_n < d_s) == (campus == "北校")

    def _pick(self, key, campus):
        """从同名候选里挑出与图谱校区相符的那个（先建筑面，后点状设施）。"""
        for cc in self.bld.get(key, []):
            if self._campus_ok(cc, campus):
                return cc
        for cc in self.node_poi.get(key, []):
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

                # A. OSM 建筑 / 点状设施（命中点须与图谱标注的校区一致）
                #    match_osm = 数据侧显式指认的 OSM 要素名（图谱不落坐标，只落名字，
                #    合规口径不变）。用在 OSM 名与图谱名对不上的场合，如
                #    「1100图书馆」↔ OSM「1L清真食堂和第四食堂2L图书馆」（楼层合名）。
                if c is None:
                    for cand in ([p["name"]] + list(p.get("alias", []))
                                 + list(p.get("match_osm", []))):
                        hit = self._pick(cand, p.get("campus")) or self._pick(norm(cand), p.get("campus"))
                        if hit:
                            c, src = hit, "osm"
                            break

                # B. near_landmark（**须同可步行分组**，否则跨区引用会把独立校区带偏）
                if c is None:
                    nb = []
                    for x in p.get("near_landmark", []):
                        x = re.sub(r"[（(].*", "", x).strip()
                        xn = alias_resolve(x)
                        if not xn or xn not in res:
                            continue
                        peer = by_name.get(xn)
                        if peer and not same_walk_group(p.get("campus"), peer.get("campus")):
                            continue
                        nb.append(res[xn][0])
                    if nb:
                        c = (sum(y[0] for y in nb) / len(nb), sum(y[1] for y in nb) / len(nb))
                        src = "near_landmark"

                # C. roads 路段相邻点（同样须同分组）
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
                                if not xn or xn not in res:
                                    continue
                                peer = by_name.get(xn)
                                if peer and not same_walk_group(p.get("campus"), peer.get("campus")):
                                    continue
                                nb.append(res[xn][0])
                        if nb:
                            c = (sum(y[0] for y in nb) / len(nb), sum(y[1] for y in nb) / len(nb))
                            src = "roads"
                            break

                # D. walk_minutes 邻居（按分钟数反比加权；同样须同分组）
                if c is None:
                    nb = []
                    for w in m.get("walk_minutes", []):
                        for me, other in ((w["from"], w["to"]), (w["to"], w["from"])):
                            if me != p["name"] or other not in res:
                                continue
                            peer = by_name.get(other)
                            if peer and not same_walk_group(p.get("campus"), peer.get("campus")):
                                continue
                            nb.append((res[other][0], float(w.get("minutes", 3))))
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
        #    全部按可步行分组过滤：独立校区若在本路网内没有任何同组锚点，
        #    就**如实保持未定位**（宁可不给，也不编一个本部坐标）。
        for p in pending:
            tiers = [
                ("zone", [res[q["name"]][0] for q in allp
                          if q.get("zone") == p.get("zone") and q["name"] in res
                          and same_walk_group(p.get("campus"), q.get("campus"))]),
                ("campus", [res[q["name"]][0] for q in allp
                            if q.get("campus") == p.get("campus") and q["name"] in res]),
                ("global", [res[q["name"]][0] for q in allp
                            if q["name"] in res
                            and same_walk_group(p.get("campus"), q.get("campus"))]),
            ]
            for src_name, peers in tiers:
                if peers:
                    res[p["name"]] = ((sum(x[0] for x in peers) / len(peers),
                                       sum(x[1] for x in peers) / len(peers)), src_name)
                    break

        self.poi = res
        self.unlocated = [p["name"] for p in allp if p["name"] not in res]

        # 主名 → 校区码，供 route() 做「跨分组不产生步行时间」的判定
        self._campus_of = {p["name"]: p.get("campus") for p in allp}

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
        """最短路距离；不可达返回 None。"""
        d, _prev = self._dijkstra_full(src, dst, mode)
        return d

    def _dijkstra_full(self, src, dst, mode="fastest"):
        """最短路距离 + 前驱表，返回 (dist, prev)。

        与 `_dijkstra` 的唯一差别是多记了一张 `prev` 表（供回溯折线用）。
        遍历顺序、松弛规则、返回值口径都完全一致 —— 所以 `_dijkstra` 的结果不变。
        折线的用途：GPS 轨迹比对（`scripts/overlap_accuracy.py`）与轨迹可视化。
        """
        if src not in self.adj or dst not in self.adj:
            return None, {}
        campus_only = (mode == "campus")
        dist, pq, seen = {src: 0.0}, [(0.0, src)], set()
        prev = {}
        while pq:
            d, u = heapq.heappop(pq)
            if u in seen:
                continue
            seen.add(u)
            if u == dst:
                return d, prev
            for v, w in self.adj.get(u, ()):
                if campus_only and (frozenset((u, v)) in self.street_edges
                                    or frozenset((u, v)) in self.bridge_edges):
                    continue   # 仅校内模式：跳过城市道路边与碎片桥接边（桥接边全在校外）
                nd = d + w
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(pq, (nd, v))
        return None, prev

    @staticmethod
    def _rebuild_path(prev, src, dst):
        """从前驱表回溯出节点序列（含起终点）。"""
        path, cur = [dst], dst
        while cur != src:
            cur = prev.get(cur)
            if cur is None:
                return None
            path.append(cur)
        path.reverse()
        return path

    def route(self, a, b, mode="fastest", _cross_group=False, with_path=False):
        """返回 dict 或 None（未定位 / 不连通 / 跨教学工作区）。

        mode:
          "fastest" —— 全路网（含军工路等校外城市道路），即「实地怎么走最快」
          "campus"  —— 只走校内步道，用来对比「纯校内绕行」要多花多少时间
        reliable=False 表示至少一端是靠 zone/campus/global 质心兜底定位的，
        或两端坐标几乎重合 —— 此时距离仅供参考。

        ⚠️ 两端若**分属不同的可步行分组**（本部 vs 1100 基础学院 / 复兴路），
        按产品口径返回 None —— 跨教学区不参与本部日常排程，让上层用
        `cross_campus()` 说明，而不是给一个会被当成转场分钟的数字。
        （1100 的路网数据其实已接入且沿军工路连通 —— 跨组步行参考走
        `route_cross_group()`，只用于回答「怎么走」类问题，不进排程。）
        """
        a, b = self.resolve(a), self.resolve(b)
        if not a or not b:
            return None
        pa, pb = self.poi[a], self.poi[b]
        if not _cross_group and not same_walk_group(self._campus_of[a], self._campus_of[b]):
            return None
        c_only = (mode == "campus")
        sa, da = self._snap(pa[0], c_only)
        sb, db = self._snap(pb[0], c_only)
        if with_path:
            d, prev = self._dijkstra_full(sa, sb, mode)
            nodes = self._rebuild_path(prev, sa, sb) if d is not None else None
        else:
            d, nodes = self._dijkstra(sa, sb, mode), None
        if d is None:
            return None
        total = d + da + db
        weak = ("zone", "campus", "global", "approx")
        reliable = (pa[1] not in weak and pb[1] not in weak
                    and hav(pa[0], pb[0]) > 5)
        res = {
            "from": a, "to": b,
            "mode": mode,
            "meters": total,
            "path_meters": d,
            "access": (da, db),
            "minutes": total / WALK_SPEED / 60,
            "locate": (pa[1], pb[1]),
            "reliable": reliable,
        }
        if with_path:
            # 折线 = POI 起点 → 吸附节点 → …路网… → 吸附节点 → POI 终点
            # ⚠️ 只供内部计算/可视化。对外接口**不得**返回（含经纬度，合规红线）。
            res["polyline"] = ([pa[0]] + (nodes or []) + [pb[0]])
        return res

    def route_cross_group(self, a, b):
        """跨可步行分组的**步行参考**（本部 ↔ 1100 基础学院）。

        与 route() 的区别：不按可步行分组阻断 —— 因为两校区沿军工路确实
        步行可达（OSM 路网已连通，实测 516 校门 → 1100 教学楼 ≈ 1.5 km）。
        用途限定：回答「从本部到基础学院怎么走」这类问题；
        **不得**把结果喂给排程当转场分钟（那要走 route()/cross_campus 口径）。
        """
        return self.route(a, b, _cross_group=True)

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
            "osm_files": list(OSM_FILES),
            "osm_poi_nodes": len(self.node_poi),
            "path_nodes": len(self.adj),
            "path_edges": sum(len(v) for v in self.adj.values()) // 2,
            "osm_buildings": len({k for k in self.bld}),
            "bridges": len(self.bridged),
            "bridge_edges": len(self.bridge_edges),
            "area_polys": self.area_polys,
            "area_edges": len(self.area_edges),
            "skipped_tunnel": self.skipped_tunnel,
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
    print(f"  OSM 提取      : {'、'.join(st['osm_files'])}")
    print(f"  路网节点      : {st['path_nodes']}  ｜ 边: {st['path_edges']}")
    print(f"  OSM 建筑索引  : {st['osm_buildings']}  ｜ 点状设施: {st['osm_poi_nodes']}")
    print(f"  可穿越空地    : {st['area_polys']} 块 ｜ 面内直连边 {st['area_edges']}")
    print(f"  碎片桥接      : {st['bridges']} 处（全部在校外，见 docs/network-quality-*.md）")
    print(f"  剔除的车行隧道: {st['skipped_tunnel']}")
    print(f"  POI 已定位    : {st['poi_located']}")
    for k, v in sorted(st["by_source"].items(), key=lambda x: -x[1]):
        print(f"      {k:14s}: {v}")
    if st["unlocated"]:
        print(f"  未能定位      : {len(st['unlocated'])} → {'、'.join(st['unlocated'])}")
    print()
    print("  实测样例：")
    for a, b in [("第三教学楼", "第五食堂"), ("第一教学楼", "第三教学楼"),
                 ("南校区第一宿舍", "清真食堂（334）"), ("刘湛恩故居", "第一食堂"),
                 ("第二学生公寓", "第五学生公寓"),
                 ("申一教", "1100图书馆"), ("申一教", "1100教育超市")]:
        r = net.route(a, b)
        if r:
            print(f"    {a} → {b}: {r['meters']:.0f} 米 / {r['minutes']:.1f} 分钟  (定位 {r['locate'][0]}/{r['locate'][1]})")
        else:
            print(f"    {a} → {b}: 无法计算（未定位或不连通）")
    print()
    print("  跨教学区步行参考（不进排程）：")
    for a, b in [("第一教学楼", "申一教"), ("516号校门", "1100图书馆")]:
        r = net.route_cross_group(a, b)
        if r:
            print(f"    {a} → {b}: {r['meters']:.0f} 米 / {r['minutes']:.1f} 分钟  [{'可信' if r['reliable'] else '参考'}]")
        else:
            print(f"    {a} → {b}: 无法计算")
