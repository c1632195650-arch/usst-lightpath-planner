# -*- coding: utf-8 -*-
"""
梨宝 · 校园空间层（差异化核心）
================================
回答「对上理校园的空间理解」：教学楼/食堂/超市等 POI、步行关系、食堂招牌菜。

设计取舍（回答"要不要识图"）：
  - 不做图像理解。校园空间用**结构化 POI + 步行关系**表达即可，
    纯 JSON 可承载、可校验、可被 LLM 直接引用，比识图更准更可控。
  - 不碰测绘坐标（规避地图合规风险），只存"相对位置 + 步行分钟 + 邻近地标"。
  - 数据来自官网食堂导览 + 校园自媒体交叉验证；未确认项标 verified=false，
    查询未命中时**诚实兜底**（列出校区食堂全览），绝不编造距离。

对外接口：
  space_context(text)  -> 给 LLM 的空间上下文字符串（无空间意图返回 ""）
"""
import os, json

_HERE = os.path.dirname(os.path.abspath(__file__))
MAP_PATH = os.path.join(_HERE, "..", "data", "campus_map.json")

_map = None

def load_map():
    global _map
    if _map is None:
        with open(MAP_PATH, encoding="utf-8") as f:
            _map = json.load(f)
    return _map

def _all_pois():
    m = load_map()
    return list(m.get("pois", [])) + list(m.get("landmarks", []))

def _names_of(p):
    return [p["name"]] + list(p.get("alias", []))


def find_poi(name):
    """按名称或别名找 POI。

    匹配优先级（2026-09-11 修正）：
      1) 精确相等（name 或 alias）
      2) 包含匹配，但**按候选词长度降序**取最长命中

    旧实现是「遍历顺序 + 双向子串」，会导致
      『南校区图书馆』被『图书馆』抢走、『申一教』被『一教』抢走 ——
     课表里的『南校区图书馆』会被误解析成北校区，属实质性错误。
    """
    name = (name or "").strip()
    if not name:
        return None
    allp = _all_pois()
    # 1) 精确匹配
    for p in allp:
        if name in _names_of(p):
            return p
    # 2) 包含匹配：候选词越长越优先；同为最长时，POI 主名越长越优先
    cands = []
    for p in allp:
        for n in _names_of(p):
            if n and (n in name or name in n):
                cands.append((len(n), len(p["name"]), p))
    if not cands:
        return None
    cands.sort(key=lambda x: (-x[0], -x[1]))
    return cands[0][2]

def match_pois(text):
    """从一段文本里匹配出所有提到的 POI。

    按候选词长度降序匹配，命中后把该词从文本中「挖空」，
    避免短别名（如『一教』）被『申一教』这类长名重复触发。
    """
    text = text or ""
    cands = []
    for p in _all_pois():
        for n in _names_of(p):
            if n:
                cands.append((len(n), n, p))
    cands.sort(key=lambda x: -x[0])
    consumed = text
    hits, used = [], set()
    for _ln, n, p in cands:
        if id(p) in used:
            continue
        if n in consumed:
            hits.append(p)
            used.add(id(p))
            consumed = consumed.replace(n, "　" * len(n))
    return hits

def nearby(place_name, max_min=15):
    """查步行矩阵，返回 [(poi_or_name, minutes, note)]；无数据返回空列表"""
    m = load_map()
    out = []
    for w in m.get("walk_minutes", []):
        frm, to = w.get("from", ""), w.get("to", "")
        mn = w.get("minutes", 99)
        if mn > max_min:
            continue
        if place_name in frm or frm in place_name:
            out.append((to, mn, w.get("note", "")))
        elif place_name in to or to in place_name:
            out.append((frm, mn, w.get("note", "")))
    return sorted(out, key=lambda x: x[1])

# ---- 校区归属与跨区通行（排程引擎依赖） ----
# 分区口径：北校区 = 军工路 516 号（主校区）；南校区 = 军工路 334 号；
#           两者合称「本部」，由海安路人行天桥连接。
#           1100（基础学院）/ 580 / 复兴路 为独立校区，不参与本部日常排程。
_CAMPUS_CN = {
    "北校": "军工路 516 号（北校区·主校区）",
    "南校": "军工路 334 号（南校区）",
    "1100": "军工路 1100 号（基础学院）",
    "580": "军工路 580 号",
    "复兴路": "复兴中路 1195 号（中英国际学院）",
    "连接": "南北校区连接点",
}
# 仅北校↔南校是真实高频跨区场景；其余组合属「不在一个教学区」
# 2026-09-11 高德实测校准：天桥两侧临近点（思餐厅 ↔ 第二学生公寓）仅 288m/4min；
#   跨越整个校区（北校中部 → 南校西侧外语学院）约 910m/13min（含绕行军工路辅路）。
#   原定 15 分钟偏保守，改为 10 分钟折中值；排程引擎如需精确值应查 walk_minutes。
_CROSS_MIN = {("北校", "南校"): 10, ("南校", "北校"): 10}

def campus_of(name):
    """查建筑/地点所属校区。返回 '北校'|'南校'|'1100'|'580'|'复兴路'|'连接'|None"""
    p = find_poi(name)
    return p.get("campus") if p else None

def campus_cn(code):
    return _CAMPUS_CN.get(code, code or "未知")

def cross_campus(a, b):
    """判断两地之间是否需要跨校区通行（供排程插缓冲块用）。
    返回 dict: {is_cross, from, to, minutes, note}
      is_cross=None 表示有一方未收录（不臆断）
    """
    ca, cb = campus_of(a), campus_of(b)
    if not ca or not cb:
        return {"is_cross": None, "from": ca, "to": cb, "minutes": None,
                "note": "有一方的校区未收录，按同区处理更稳妥"}
    if ca == cb:
        return {"is_cross": False, "from": ca, "to": cb, "minutes": 0, "note": "同校区"}
    mn = _CROSS_MIN.get((ca, cb))
    if mn:
        return {"is_cross": True, "from": ca, "to": cb, "minutes": mn,
                "note": f"{campus_cn(ca)} → {campus_cn(cb)}，走海安路人行天桥，建议预留 {mn} 分钟"}
    return {"is_cross": True, "from": ca, "to": cb, "minutes": None,
            "note": f"{campus_cn(ca)} 与 {campus_cn(cb)} 分属不同教学区，不参与本部日常排程"}

def poi_brief(p, with_dishes=True):
    """POI 一句话简介（含招牌菜 —— 贴心细节就在这）"""
    parts = [f"{p['name']}"]
    if p.get("near_landmark"):
        parts.append("近" + "、".join(p["near_landmark"][:2]))
    if p.get("hours"):
        h = "；".join(f"{k} {v}" for k, v in list(p["hours"].items())[:3])
        parts.append("营业 " + h)
    if p.get("closed"):
        parts.append(p["closed"])
    if with_dishes and p.get("signature"):
        parts.append("招牌：" + "、".join(p["signature"][:4]))
    if p.get("features"):
        parts.append("；".join(p["features"][:2]))
    if p.get("note"):
        parts.append(p["note"])
    if p.get("good_for"):
        parts.append("适合：" + "、".join(p["good_for"][:3]))
    return "（".join([]) + " | ".join(parts)

def canteen_overview():
    """食堂全览 —— 用于"学校有哪些食堂"或位置未知时的诚实兜底"""
    m = load_map()
    lines = []
    for p in m.get("pois", []):
        if p.get("type") in ("食堂", "餐厅", "烘焙/饮品"):
            lines.append("- " + poi_brief(p))
    return "\n".join(lines)

# 触发空间意图的关键词
_SPACE_HINTS = ["附近", "旁边", "近", "哪儿", "哪里", "去哪", "下课", "吃饭", "食堂",
                "便利店", "超市", "餐厅", "好吃", "推荐菜", "吃什么", "教学楼",
                "一教", "二教", "三教", "四教", "五教", "宿舍", "公寓", "图书馆",
                "自习", "打印", "驿站", "快递", "浴室", "洗澡", "ATM", "取款",
                "校门", "天桥", "操场", "健身房", "怎么走", "在哪"]

def has_space_intent(text):
    t = text or ""
    return any(h in t for h in _SPACE_HINTS)

def space_context(text):
    """
    生成给 LLM 的空间上下文。
    - 命中已知地点 → 给"该地点附近的 POI + 步行分钟"
    - 未命中（如"三教"官网未收录）→ 给"校区食堂全览"并标注未知，绝不编造距离
    - 无空间意图 → 返回 ""
    """
    if not has_space_intent(text):
        return ""

    m = load_map()
    hits = match_pois(text)
    blocks = [f"[校园空间·{m['_meta']['campus']}]"]

    resolved = False
    for p in hits[:2]:
        loc = p.get("zone") or ""
        blocks.append(f"\n『{p['name']}』所在校区：{campus_cn(p.get('campus'))}" + (f"｜位置：{loc}" if loc else ""))
        # 关键细节（贴心信息就在这里：楼内自习室 / 快递点 / 招牌菜 / 营业时间）
        if p.get("note"):
            blocks.append(f"  说明：{p['note']}")
        if p.get("features"):
            blocks.append("  特色：" + "；".join(p["features"][:3]))
        if p.get("hours"):
            h = "；".join(f"{k} {v}" for k, v in list(p["hours"].items())[:3])
            blocks.append(f"  时间：{h}")
        if p.get("closed"):
            blocks.append(f"  休止：{p['closed']}")
        nb = nearby(p["name"])
        if nb:
            resolved = True
            blocks.append("  周边步行：")
            for name, mn, note in nb:
                tgt = find_poi(name)
                seg = f"  - 步行约{mn}分钟 → {name}"
                if tgt and tgt.get("campus") and tgt["campus"] != "连接":
                    seg += f"［{tgt['campus']}］"
                if tgt and tgt.get("signature"):
                    seg += f"（招牌：{'、'.join(tgt['signature'][:3])}）"
                if note:
                    seg += f" ｜ {note}"
                blocks.append(seg)

    if not resolved:
        blocks.append(
            "\n（注意：用户提到的地点我还没有精确到分钟的步行数据，"
            "**不要编造距离**。下面给出本部食堂全览，请结合就餐时间/口味帮 TA 选，"
            "并可以自然地说一句『具体几步路你自己走两次就熟啦』。）"
        )
        blocks.append(canteen_overview())
    else:
        blocks.append("\n[本部食堂全览（备查）]")
        blocks.append(canteen_overview())

    # 用户同时提到两个地点 → 直接算两者之间的步行路径
    if len(hits) >= 2:
        r = route(hits[0]["name"], hits[1]["name"])
        if r:
            warn = "" if r["reliable"] else "（含估算成分，仅供参考）"
            blocks.append(
                f"\n[两点间步行] {r['from']} → {r['to']}：约 {r['meters']:.0f} 米，"
                f"步行约 {r['minutes']:.0f} 分钟{warn}"
            )

    oc = m.get("off_campus", [])
    if oc and any(k in text for k in ("校外", "校门口", "出去吃", "改善伙食", "聚餐")):
        blocks.append("\n[校外小吃]")
        for o in oc[:4]:
            blocks.append(f"  - {o['name']}（{o['where']}）：{'、'.join(o.get('signature', [])[:3])}")

    return "\n".join(blocks)


# ---------- 路网寻路（OSM 派生，懒加载）----------
_network = None


def network():
    """惰性初始化路网（首次约 0.1 s，之后复用）。失败则返回 None，不影响其它功能。"""
    global _network
    if _network is None:
        try:
            from campus_network import Network
            _network = Network()
        except Exception:
            _network = False
    return _network or None


def route(a, b):
    """任意两点步行路径。返回 {'meters','minutes','reliable',...} 或 None。

    路网来自 OSM（© OpenStreetMap contributors，ODbL 1.0）；
    每端仍优先采用 walk_minutes 里的实测值（见 campus_network 的定位优先级）。
    """
    net = network()
    if not net:
        return None
    return net.route(a, b)
