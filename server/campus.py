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
import os, json, re as _re

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


def walk_group(campus):
    """校区码 → 可步行分组（口径唯一来源在 campus_network，避免两处各写一份）。

    本部 = 北校(516) + 南校(334) + 580（西北角同一片街区）；1100 / 复兴路 为独立分组。
    懒加载 + 兜底：campus_network 不可用时原样返回，即退化为不做跨组过滤，
    不让「校区隔离」这个增强把空间检索整体拖挂。
    """
    try:
        from campus_network import walk_group as _wg
    except Exception:
        return campus
    return _wg(campus)

def _search_keys(p):
    """检索键 = 主名 + 别名 + 口语同义词。

    ⚠️ **不要把 tags 塞进 `find_poi` 的默认路径**（见该函数注释）：
    `find_poi` 服务于「身份判定」（campus_of → 排程插缓冲块、课表楼名解析），
    那里只认官方楼名与别名；口语词一旦参与，会把「宿舍几点关门」里的
    「宿舍」解析成某一栋具体的宿舍，属于实质性错误。
    口语词只在 `search_pois`（面向用户的检索）里生效。
    """
    return _names_of(p) + list(p.get("tags", []))


def find_poi(name, with_tags=False):
    """按名称或别名找 POI。

    匹配优先级（2026-09-11 修正）：
      1) 精确相等（name 或 alias）
      2) 包含匹配，但**按候选词长度降序**取最长命中

    旧实现是「遍历顺序 + 双向子串」，会导致
      『南校区图书馆』被『图书馆』抢走、『申一教』被『一教』抢走 ——
     课表里的『南校区图书馆』会被误解析成北校区，属实质性错误。

    `with_tags=True`（2026-09-15 新增）时，**仅在前两步全落空后**才用 `tags`
    兜底。这是纯粹的**加法**：官方名与别名的解析结果逐字节不变，
    所以排程/课表链路（走默认 `with_tags=False`）零行为变化；
    而面向用户的检索可以凭口语词命中（『图文』→ 图书馆）。
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
    if cands:
        cands.sort(key=lambda x: (-x[0], -x[1]))
        return cands[0][2]
    if not with_tags:
        return None
    # 3) tags 兜底（不参与上面的排序，只有真的没命中时才启用）
    for p in allp:
        if name in p.get("tags", []):
            return p
    tag_cands = []
    for p in allp:
        for t in p.get("tags", []):
            if t and (t in name or name in t):
                tag_cands.append((len(t), len(p["name"]), p))
    if not tag_cands:
        return None
    tag_cands.sort(key=lambda x: (-x[0], -x[1]))
    return tag_cands[0][2]

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
# 仅北校↔南校是真实高频跨区场景；其余组合属「不在一个教学区」。
# 2026-09-11：分钟数改为**OSM 路网实算**（经海安路人行天桥，见 campus_network.route）。
#   实测区间：天桥两侧临近点（二公寓 ↔ 五公寓）约 6 分钟；
#   跨越整个校区（三教 → 第四教学楼 / 五食堂 → 外语学院）约 15–20 分钟。
#   下面的常数仅作**路网算不出时的兜底**。
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
    # 只有「北校↔南校」是日常跨区场景（走海安路天桥），才用路网实算进排程；
    # 1100/复兴路 不参与本部日常排程（口径不变）——但 1100 的路网自 2026-09-16
    # 起已接入（jichuxueyuan.osm），沿军工路实际步行可达（约 1.5 km），
    # 故 note 附上诚实的步行参考，让梨宝答「本部到基础学院怎么走」不空手。
    if (ca, cb) not in _CROSS_MIN:
        note = f"{campus_cn(ca)} 与 {campus_cn(cb)} 分属不同教学区，不参与本部日常排程"
        if "1100" in (ca, cb):
            net = network()
            r = net.route_cross_group(a, b) if net else None
            if r and r.get("reliable"):
                note += (f"（沿军工路步行约 {r['meters']:.0f} 米 / "
                         f"{max(1, round(r['minutes']))} 分钟）")
        return {"is_cross": True, "from": ca, "to": cb, "minutes": None,
                "note": note}

    # 优先用 OSM 真实路网实算（经海安路人行天桥）
    r = route(a, b)
    if r and r.get("reliable"):
        mn = max(1, round(r["minutes"]))
        return {"is_cross": True, "from": ca, "to": cb, "minutes": mn, "src": "route",
                "note": (f"{campus_cn(ca)} → {campus_cn(cb)}，走海安路人行天桥；"
                         f"路径约 {r['meters']:.0f} 米，预留 {mn} 分钟")}

    # 算不出时回退保守常数
    mn = _CROSS_MIN.get((ca, cb))
    if mn:
        return {"is_cross": True, "from": ca, "to": cb, "minutes": mn, "src": "const",
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


# ---------- 面向用户的检索（口语 → 地点）----------
# 打分档位（刻意做成「量级分明」，避免相邻档互相压过）。
# 档位顺序是实测调出来的，不是直觉 —— 反例见每条注释：
#   100  主名/别名精确            → 用户就是在说这个地点
#    72+ 主名/别名出现在查询里      → 「三教下课饿了去哪吃」里的『三教』
#    65  tags 精确                → 「图文」「取快递」这类**人工整理过的**口语
#    58+ 查询是主名/别名的片段      → 「打印」→『红塔打印』。必须低于 tag 精确：
#                                    『图文』既是图书馆的 tag，又是『校史馆（图文信息中心）』
#                                    的别名片段；旧档位让两者并列 80 分，图书馆被挤下去。
#    50  type 精确                → 「食堂」「宿舍」这类泛类别词（由 type 承担，不塞进 tags）
#    44+ 弱信号：tag 出现在查询里 / 查询是 tag 的片段
_SCORE_NAME_EQ = 100
_SCORE_NAME_IN = 72
#    68  拼音全拼整段相等        → 「tushuguan」→ 图书馆。用户用拼音把整个名字打全了。
#    66  拼音首字母整段相等      → 「tsg」→ 图书馆。
#                                  ⚠️ 必须**高于口语词拼音档（62）**：实测「tsg」曾把
#                                  『湛恩纪念图书馆』（标签『图书馆』的首字母也是 tsg）排到了
#                                  『图书馆（图文信息中心）』前面 —— 命中**名字**永远强于命中**标签**。
_SCORE_PY_EQ = 68
_SCORE_PYI_EQ = 66
#    65  tags 精确（中文）
_SCORE_TAG_EQ = 65
#    62  口语同义词拼音整段相等  → 「dahuo」→ 学生活动中心、「chifan」→ 食堂。
_SCORE_PYG_EQ = 62
_SCORE_FRAG_IN = 58
#    52  拼音全拼前缀            → 「tushu」→ 图书馆（拼音还没打完，最常见的输入中间态）
#    44  拼音首字母前缀          → 「tsgx」→ 图书馆（图文信息中心）
_SCORE_PY_PRE = 52
#    48  类型拼音整段相等        → 「shitang」→ 所有食堂、「sushe」→ 所有宿舍…
#    42  口语同义词拼音前缀      → 「qukua」→ 取快递 → 菜鸟驿站
#    38  类型拼音前缀
_SCORE_PYT_EQ = 48
_SCORE_PYI_PRE = 44
_SCORE_PYG_PRE = 42
_SCORE_PYT_PRE = 38
_SCORE_TYPE_EQ = 50
_SCORE_WEAK = 44
_CAP = 8          # 长度加成上限：够区分「打印」和「南校区红塔打印」，又不至于碾压档位

# 纯字母数字（允许空格/中横线/下划线分隔）→ 视为「拼音输入」。
# 之所以要求**整串**都是字母数字：混了中文的查询（「tushuguan在哪」）走中文那几档更准。
_ASCII_ALNUM = _re.compile(r"^[a-z0-9]+$")


def _score_pinyin(p, q):
    """拼音匹配打分。`pyf` / `pyi` / `pyt` / `pyg` 由 `scripts/build_pinyin_index.py` 离线生成。

    **只做「整段相等」与「前缀」，不做子串** —— 这是刻意的：
    `disanjiaoxuelou` 里确实含 `sanjiao`（那正是别名『三教』，命中是对的），
    但 `xue` 也"含"于一大串名字 → 子串会带来大量假命中。
    前缀则正好对应「拼音还没打完」这个真实场景（tushu → 图书馆）。

    四档分值刻意分层，对应中文化那几档的语义：
        名字/别名拼音 > 口语同义词拼音 > 类型拼音
    —— 「找一个具体的地方」永远优先于「浏览某一类」。
    """
    best = 0
    for f in (p.get("pyf") or "").split("|"):
        if not f:
            continue
        if f == q:
            best = max(best, _SCORE_PY_EQ)
        elif len(q) >= 3 and f.startswith(q):
            best = max(best, _SCORE_PY_PRE)
    for i in (p.get("pyi") or "").split("|"):
        # 首字母缩写至少 2 位才有区分度（「y」这种单字母会命中一大片）
        if len(i) < 2:
            continue
        if i == q:
            best = max(best, _SCORE_PYI_EQ)
        elif len(q) >= 3 and i.startswith(q):
            best = max(best, _SCORE_PYI_PRE)
    # 口语同义词（tags）的拼音
    for g in (p.get("pyg") or "").split("|"):
        if len(g) < 2:
            continue
        if g == q:
            best = max(best, _SCORE_PYG_EQ)
        elif len(q) >= 3 and g.startswith(q):
            best = max(best, _SCORE_PYG_PRE)
    # 类型拼音（最弱：只用于「列一类」）
    for t in (p.get("pyt") or "").split("|"):
        if len(t) < 2:
            continue
        if t == q:
            best = max(best, _SCORE_PYT_EQ)
        elif len(q) >= 3 and t.startswith(q):
            best = max(best, _SCORE_PYT_PRE)
    return best


def _score_poi(p, query, want_type=False):
    """给单个 POI 打分。返回 0 表示不相关。"""
    q = (query or "").strip()
    if not q:
        return 0
    best = 0
    for n in _names_of(p):
        if not n:
            continue
        if n == q:
            best = max(best, _SCORE_NAME_EQ)
        elif n in q:
            best = max(best, _SCORE_NAME_IN + min(len(n), _CAP))
        # 「查询是名字的片段」这一档要求 q 至少 2 个字符：
        # 单字符会顺着**拉丁字母别名**乱命中 —— 实测「a」「y」都会命中『全家』
        # （它的别名里有 `Familymart`），而用户输入单个 `a` 时显然不是这个意思。
        elif len(q) >= 2 and q in n:
            best = max(best, _SCORE_FRAG_IN + min(len(q), _CAP))
    if best < _SCORE_TAG_EQ:
        for t in p.get("tags", []):
            if not t:
                continue
            if t == q:
                best = max(best, _SCORE_TAG_EQ)
            elif q in t or t in q:
                best = max(best, _SCORE_WEAK + min(len(t), _CAP))
    # 拼音：仅在**整串都是字母数字**时才走（含中文的查询交给中文那几档，更准）
    q_py = _re.sub(r"[\s\-_]+", "", q.lower())
    if len(q_py) >= 2 and _ASCII_ALNUM.match(q_py):
        best = max(best, _score_pinyin(p, q_py))
    if want_type and p.get("type") and p["type"] == q:
        best = max(best, _SCORE_TYPE_EQ)
    return best


def rank_pois(text, func=None, limit=5, min_score=1):
    """口语检索：返回 [(poi, score)]，按分数降序（同分保持原有顺序，稳定可测）。

    `func` 可传字符串或列表，做**五类功能**过滤（teach/office/life/sport/transport）。
    `text` 为空但给了 `func` 时，按功能列全量（分值 0）——
    这是「只看运动场所」这类浏览式用法，不是检索。
    """
    q = (text or "").strip()
    funcs = {func} if isinstance(func, str) else set(func or [])
    if not q and not funcs:
        return []
    out = []
    for p in _all_pois():
        if funcs and not (funcs & set(p.get("func", []))):
            continue
        s = _score_poi(p, q, want_type=True) if q else 0
        if q and s < min_score:
            continue
        out.append((p, s))
    out.sort(key=lambda x: -x[1])
    return out[:limit]


def poi_public(p, score=None):
    """POI 的对外投影。

    🔴 **本项目对外接口一律不返回经纬度**（决策 D4，2026-09-15）：
    `campus_map.json` 本身按合规设计不落坐标，此处再显式只挑白名单字段，
    即使将来有人往图谱里加了坐标，也不会从这个出口漏出去。
    """
    d = {
        "id": p.get("id"),
        "name": p["name"],
        "type": p.get("type"),
        "func": list(p.get("func", [])),
        "emoji": p.get("emoji", ""),
        "campus": p.get("campus"),
        "campus_cn": campus_cn(p.get("campus")),
        "zone": p.get("zone"),
        "alias": list(p.get("alias", [])),
        "tags": list(p.get("tags", [])),
    }
    for k in ("hours", "closed", "signature", "good_for", "features",
              "note", "near_landmark", "verified", "seats", "traffic", "src"):
        if p.get(k):
            d[k] = p[k]
    if score is not None:
        d["score"] = round(float(score), 1)
    return d


def search_pois(text, func=None, limit=5):
    """对外：口语检索 → 公开投影列表（不含坐标）。

    2026-09-16：品牌反向索引前置。『麦当劳』这类只存在于 features 特征串里的
    连锁店名，rank_pois 的主名/别名/tags 三层都够不到，必须先查索引；
    命中排最前，剩余名额仍由原排序补齐（对既有检索零行为变化）。
    """
    out, seen = [], set()
    for p in brand_pois(text):
        out.append(poi_public(p))
        seen.add(p["name"])
    for p, s in rank_pois(text, func=func, limit=limit):
        if p["name"] in seen:
            continue
        out.append(poi_public(p, s))
        seen.add(p["name"])
        if len(out) >= limit:
            break
    return out[:limit]


# ---------- 营业时间（把开放时间变成可判断的事实，而不是一串字符串）----------
# `re` 与 `datetime` 已在文件顶部 / 此处导入；纯函数部分不读时钟，时钟只在这一段用。
import datetime as _dt

_TIME_RANGE = _re.compile(r"(\d{1,2})\s*[:：]\s*(\d{2})\s*[-—~～]\s*(\d{1,2})\s*[:：]\s*(\d{2})")
_WEEKDAY_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def _to_min(h, m):
    return int(h) * 60 + int(m)


def open_now(p, at=None):
    """判断某地点此刻是否开放。返回 dict；**无法判断时如实返回 open=None**。

    只解析得出 `H:MM-H:MM` 的时段；『常规饭点』『长时（以现场为准）』这类
    模糊表述**不猜**（宁可返回未知，也不给一个假结论 —— 与 §「诚实兜底」同一条原则）。
    `closed` 里含当天星期几时直接判为关闭（如第一食堂『周六休息』）。
    """
    hours = p.get("hours") or {}
    now = at or _dt.datetime.now()
    if at is not None and isinstance(at, str):
        try:
            now = _dt.datetime.strptime(at[:16], "%Y-%m-%d %H:%M")
        except ValueError:
            return {"open": None, "reason": "时间格式无法解析", "period": None}
    cur = now.hour * 60 + now.minute
    today = _WEEKDAY_CN[now.weekday()]

    closed = p.get("closed") or ""
    if closed and today in closed:
        return {"open": False, "period": None, "until": None,
                "reason": f"{today}休息", "checked_at": now.strftime("%H:%M")}

    best = None
    for label, spec in hours.items():
        for m in _TIME_RANGE.finditer(str(spec)):
            h1, m1, h2, m2 = (int(x) for x in m.groups())
            s, e = _to_min(h1, m1), _to_min(h2, m2)
            if e <= s:      # 跨零点（如 22:00-01:00）
                e += 24 * 60
            if s <= cur <= e:
                return {"open": True, "period": label,
                        "until": f"{h2:02d}:{m2:02d}",
                        "reason": f"处于「{label}」时段", "checked_at": now.strftime("%H:%M")}
            if best is None or s < best[0]:
                best = (s, label, f"{h1:02d}:{m1:02d}")
    if best is None:
        return {"open": None, "period": None, "until": None,
                "reason": "开放时间未收录或表述不精确，不做判断",
                "checked_at": now.strftime("%H:%M")}
    return {"open": False, "period": None, "next": best[2],
            "reason": f"下一个时段「{best[1]}」{best[2]} 开始",
            "checked_at": now.strftime("%H:%M")}


# ---------- 就近推荐（按步行分钟，不是直线距离）----------
# 定位精度分级：由 campus_network 的「线索来源」推出。
#   high   人工核对 / OSM 具名建筑        —— 坐标可信到楼
#   medium 邻居派生（地标 / 路段 / 步行矩阵）—— 大致可信，可能偏几十米
#   low    zone / 校区 / 全局质心兜底      —— 只表示「在这一片」，不要报精确距离
_LOCATE_PRECISION = {
    "keypoint": "high", "osm": "high",
    "near_landmark": "medium", "roads": "medium", "walk_minutes": "medium",
    "zone": "low", "campus": "low", "global": "low", "approx": "low",
}


def _locate_precision(src):
    return _LOCATE_PRECISION.get(src, "low")


# 同分钟数时，定位更准的排在前面（避免「zone 质心」和「OSM 建筑」并列时顺序随机）
_PRECISION_RANK = {"high": 3, "medium": 2, "low": 1}


def nearby_by_walk(origin, limit=5, funcs=None, types=None, max_min=None, mode="fastest"):
    """从 origin 出发，按**步行分钟**升序返回最近的地点。

    为什么不吃直线距离：校园里隔一道围墙的 50 米可能要绕 8 分钟。
    所以这里直接复用 OSM 路网实算（`route`），而不是 Haversine。
    候选集 = `pois`（26 个服务型地点：吃/买/快递/打印/办事…），
    校园地标（教学楼、宿舍）不参与推荐 —— 它们不是「目的地」。

    `funcs` 按五类功能过滤（teach/office/life/sport/transport）；
    `types` 按 type 精确过滤（如 `types=["食堂","餐厅","烘焙/饮品"]`）——
    「下课饿了去哪吃」用 `types` 才准：`func='life'` 太粗，会把心理健康中心也带进来。

    两条硬过滤（2026-09-15 加，均为修实际错误）：
      1) **同可步行分组**：本部的起点不会推荐 1100 基础学院 / 复兴路的地点
         （此前 `1100教育超市` 因坐标被吸附到北校，会算出「三教 4.5 分钟」）。
      2) **退化结果不报假分钟**：若某地点因坐标只细化到 zone/片区而与本起点落在同一
         参考点，实算距离为 0 米 —— 那不是「0 分钟走到」，而是「位置没细化到楼」。
         这类结果**单独放进返回体的 `unrefined`**（`minutes=None`、`same_spot=True`），
         既不谎报 0 分钟、也不占用 `limit` 名额，更不会把真答案挤掉：
         七公寓最近的正餐其实是民族餐厅（580号），它同样是「只细化到 580 号这一片」，
         直接丢弃会让「七公寓附近吃什么」答不出最近的食堂。
    """
    m = load_map()
    cands = list(m.get("pois", []))
    fs = {funcs} if isinstance(funcs, str) else set(funcs or [])
    if fs:
        cands = [p for p in cands if fs & set(p.get("func", []))]
    ts = {types} if isinstance(types, str) else set(types or [])
    if ts:
        cands = [p for p in cands if p.get("type") in ts]

    src = find_poi(origin, with_tags=True)
    src_name = src["name"] if src else (origin or "").strip()
    if not src_name:
        return {"origin": None, "walkable": False,
                "reason": "没给出发点", "results": []}

    src_group = walk_group(src.get("campus")) if src else None
    out = []
    for p in cands:
        if p["name"] == src_name:
            continue
        # 1) 跨可步行分组直接排除（分属不同教学区，本路网无其间的路）
        if src_group is not None and walk_group(p.get("campus")) not in (None, src_group):
            continue
        r = route(src_name, p["name"], mode)
        if not r:
            continue
        mn = r["minutes"]
        if max_min is not None and mn > max_min:
            continue
        d = poi_public(p)
        d.update({
            "meters": round(r["meters"]),
            "reliable": bool(r.get("reliable")),
            "locate": r["locate"][1],
            "precision": _locate_precision(r["locate"][1]),
            "open": open_now(p),
        })
        if r["meters"] <= 0.5:
            # 2) 退化：坐标未细化到楼（same_spot），不给假分钟
            d.update({"minutes": None, "same_spot": True})
        else:
            d.update({"minutes": round(mn, 1), "same_spot": False})
        out.append(d)

    # 能算出分钟的单列一张表，按分钟升序（同分钟时定位更准的在前）；
    # 算不出的（same_spot）单独放 `unrefined` —— 它们**可能是最近的**，
    # 但不能占用 limit 名额，也不能谎报「0.0 分钟」（那会把真答案挤掉或说错）。
    timed = [d for d in out if d["minutes"] is not None]
    untimed = [d for d in out if d["minutes"] is None]
    timed.sort(key=lambda x: (x["minutes"], -_PRECISION_RANK.get(x["precision"], 0)))
    if not timed and not untimed:
        return {"origin": src_name, "walkable": False,
                "reason": f"「{src_name}」未能在路网中定位，或周边没有可推荐的地点",
                "results": [], "unrefined": []}
    return {"origin": src_name, "walkable": True, "reason": None,
            "results": timed[:limit], "unrefined": untimed}

# 触发空间意图的关键词
_SPACE_HINTS = ["附近", "旁边", "近", "哪儿", "哪里", "去哪", "下课", "吃饭", "食堂",
                "便利店", "超市", "餐厅", "好吃", "推荐菜", "吃什么", "教学楼",
                "一教", "二教", "三教", "四教", "五教", "宿舍", "公寓", "图书馆",
                "自习", "打印", "驿站", "快递", "浴室", "洗澡", "ATM", "取款",
                "校门", "天桥", "操场", "健身房", "怎么走", "在哪",
                # 2026-09-15 补：口语同义词层落地后，这些问法也能靠 tags 命中了
                "看病", "校医院", "取钱", "取快递", "寄快递", "买文具", "买东西",
                "图文", "大活", "水母楼"]

# ---------- 品牌/连锁店反向索引（2026-09-16「麦当劳翻车」修复） ----------
# 事实探针（outputs/梨宝事实正确性测试报告_2026-09-15.md）发现：问「学校有没有
# 麦当劳」会答「没有」，但事实就在 第二食堂.features = ["左侧有麦当劳（…）"] 里。
# 根因链：存在性问法（有没有/有X吗）不在 _SPACE_HINTS → 图谱不注入 → LLM 凭常识
# 说没有。修法（报告方向①②，经用户确认）：
#   ① 意图判定改为「实体命中优先，关键词兜底」——见 has_space_intent / space_context；
#   ② 品牌反向索引：启动时从 POI 的 name/features/note 里自动抽品牌词，映射回 POI，
#      并给「全家 → 全家便利店」这类**品牌短名 → POI 全名**的反向别名。
# 与 _SPACE_HINTS 的本质区别：品牌是**有限封闭集合**（校园里实际出现的店），
# 覆盖率可被探针自动校验（scripts/fact_probe.py），不存在「问不完」的开放集合问题。
# 抽取只认「X（时间/地点）」式带括号证据的特征串 + 种子词表，并排除品类泛词，
# 避免「有专门打包窗口」这类句子被误当品牌。
_BRAND_SEED = ("麦当劳", "金拱门", "全家", "罗森", "7-11", "711", "便利蜂",
               "瑞幸", "星巴克", "库迪", "蜜雪冰城", "茶百道", "沪上阿姨",
               "益禾堂", "肯德基", "德克士", "华莱士", "老娘舅", "永和豆浆",
               "张亮麻辣烫", "杨国福", "上理烘焙坊", "1906",
               # 2026-09-19 数据更新：暑假新入驻品牌（文证：后勤/学生会推文 + CY 实地）
               "KFC", "肯悦", "一点点", "苹果花园", "七分甜", "继光香香鸡", "连杏", "茉莉奶白", "Tims", "炸鸡兄弟")
_BRAND_GENERIC = {"食堂", "餐厅", "便利店", "超市", "咖啡", "奶茶", "打印",
                  "快递", "自习室", "浴室", "开水房", "烘焙", "外卖", "打包",
                  "窗口", "麻辣烫", "水果捞", "煎饼"}
_BRAND_RE = _re.compile(r"[有含设入驻引进开]([一-龥A-Za-z0-9]{2,8}?)(?=[（(])")

def _pos_mentions(s, b):
    """b 在 s 中出现且**前面紧跟的不是否定词**（「非全家」不算全家）。
    2026-09-16 实测踩坑：教育超市备注写「（非全家）」，不做守卫会注入
    『全家』本校有 → 教育超市 的自相矛盾证据。"""
    s = s or ""
    start = 0
    while True:
        i = s.find(b, start)
        if i < 0:
            return False
        if not any(n in s[max(0, i - 2):i] for n in ("非", "没", "无")):
            return True
        start = i + 1


_brand_idx = None


def _brand_index():
    """懒构建 {品牌词: [poi, ...]}。只读 name/features/note，不动数据文件。"""
    global _brand_idx
    if _brand_idx is not None:
        return _brand_idx
    idx = {}
    for p in _all_pois():
        feats = list(p.get("features", [])) + [p.get("note") or ""]
        toks = set(b for b in _BRAND_SEED
                   if b in p["name"] or any(_pos_mentions(s, b) for s in feats))
        for s in feats:
            for mm in _BRAND_RE.finditer(s):
                w = mm.group(1)
                if len(w) >= 2 and w not in _BRAND_GENERIC and not any(g in w for g in _BRAND_GENERIC):
                    toks.add(w)
        for b in toks:
            idx.setdefault(b, [])
            if all(x["name"] != p["name"] for x in idx[b]):
                idx[b].append(p)
    # 主名命中（『全家』就是 POI 名的一部分）排前面，特征串命中排后面
    for b, ps in idx.items():
        ps.sort(key=lambda p: 0 if b in p["name"] else 1)
    _brand_idx = idx
    return idx


def match_brands(text):
    """[(brand, poi)] 按品牌词长度降序；text 中出现品牌词即命中。"""
    t = text or ""
    hits = [(b, p) for b, ps in _brand_index().items() if b in t for p in ps]
    hits.sort(key=lambda x: -len(x[0]))
    return hits


def brand_pois(text):
    """text 提到的品牌所在的 POI（去重，保持品牌词长度优先序）。"""
    out, used = [], set()
    for _b, p in match_brands(text):
        if id(p) not in used:
            out.append(p)
            used.add(id(p))
    return out


def _brand_evidence(p, brand):
    """取出该品牌在 POI 数据里的原始证据串，供存在性模板直接引用。"""
    if brand in p["name"]:
        return p["name"]
    for s in list(p.get("features", [])) + [p.get("note") or ""]:
        if brand in s:
            return s
    return ""


def has_space_intent(text):
    # 2026-09-16：品牌实体命中也算空间意图 —— 存在性问法（有没有麦当劳）
    # 不再依赖关键词表穷举，见 _brand_index 注释。
    t = text or ""
    return any(h in t for h in _SPACE_HINTS) or bool(match_brands(t))


def match_entities(text):
    """match_pois（官方名/别名）+ brand_pois（品牌反向索引），按 id 去重。"""
    hits = match_pois(text)
    used = {id(p) for p in hits}
    for p in brand_pois(text):
        if id(p) not in used:
            hits.append(p)
            used.add(id(p))
    return hits


def space_context(text):
    """
    生成给 LLM 的空间上下文。
    - 命中已知地点（含品牌反向索引）→ 给"该地点附近的 POI + 步行分钟"
    - 命中品牌 → 额外给[存在性事实]块，钉死「有/在哪」，禁止 LLM 凭常识否定
    - 未命中但有空间意图（如"三教"官网未收录）→ 给"校区食堂全览"并标注未知，绝不编造距离
    - 既无实体也无意图 → 返回 ""
    """
    m = load_map()
    hits = match_entities(text)  # 2026-09-16：实体先行，关键词只做兜底闸门
    if not hits:
        if not has_space_intent(text):
            return ""
        # 口语/黑话兜底（2026-09-15 新增）：官方名与别名都没命中时，才用 tags 检索。
        # 门槛 = tags 精确命中（『图文』→图书馆、『取快递』→菜鸟驿站）。
        # 低于此不注入 —— 宁可落到「诚实兜底 + 食堂全览」，也不要塞错地点。
        seen = set()
        for p, _s in rank_pois(text, limit=2, min_score=_SCORE_TAG_EQ):
            if p["name"] in seen:
                continue
            seen.add(p["name"])
            hits.append(p)

    # 存在性事实块（2026-09-16）：品牌命中的地点，把「有/在哪/什么时间」
    # 以结构化数据直接钉进上下文 —— 答案优先级：图谱 > 语料 > LLM 常识。
    brand_hits = match_brands(text)
    if brand_hits:
        blocks_pre = ["[存在性事实·结构化图谱，以此为准，禁止凭常识回答「没有」]"]
        emitted = set()
        for b, p in brand_hits:
            if p["name"] in emitted:
                continue
            emitted.add(p["name"])
            ev = _brand_evidence(p, b)
            st = open_now(p)
            now = ""
            if st.get("open") is True:
                now = f"，现在开放中（到 {st['until']}）"
            elif st.get("open") is False:
                now = f"，现在不开放（{st['reason']}）"
            blocks_pre.append(f"- 『{b}』本校有 → {p['name']}｜证据：{ev}{now}")
        blocks = [f"[校园空间·{m['_meta']['campus']}]"] + blocks_pre
    else:
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
        # 把开放时间变成「此刻开不开」的可判断事实 —— 排程引擎用不上的字段在这里兑现价值
        st = open_now(p)
        if st.get("open") is True:
            blocks.append(f"  现在：开放中（{st['period']}时段，到 {st['until']}）")
        elif st.get("open") is False:
            blocks.append(f"  现在：不开放（{st['reason']}）")
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

    # 用户同时提到两个地点 → 直接算两者之间的步行路径（并提示是否走校外更快）
    if len(hits) >= 2:
        c = compare_paths(hits[0]["name"], hits[1]["name"])
        if c and c["fastest"]:
            f = c["fastest"]
            warn = "" if f["reliable"] else "（含估算成分，仅供参考）"
            blocks.append(
                f"\n[两点间步行] {f['from']} → {f['to']}：约 {f['meters']:.0f} 米，"
                f"步行约 {f['minutes']:.0f} 分钟{warn}"
            )
            if c["outdoor_better"]:
                blocks.append(
                    f"  ⚠️ 这条**走校外（沿军工路边）更快**：比只在校园里走省 "
                    f"{c['diff_minutes']:.0f} 分钟（仅校内需 {c['campus']['minutes']:.0f} 分钟）。"
                    f"请如实告诉用户两种走法，让 TA 自己选。"
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


def route(a, b, mode="fastest"):
    """任意两点步行路径。返回 {'meters','minutes','reliable',...} 或 None。

    mode='fastest'（默认）—— 含校外城市道路（军工路等），即「实地怎么走最快」；
    mode='campus'        —— 只走校内步道，用于对比纯校内绕行要多花多少时间。

    路网来自 OSM（© OpenStreetMap contributors，ODbL 1.0）；
    每端仍优先采用 walk_minutes 里的实测值（见 campus_network 的定位优先级）。
    """
    net = network()
    if not net:
        return None
    return net.route(a, b, mode)


def compare_paths(a, b):
    """多路径对比：最快（可走校外）vs 仅校内。

    返回 {fastest, campus, diff_minutes, outdoor_better} 或 None。
    用于回答「从七公寓（580 校门旁）去三教，是不是走校外更快」这类问题。
    """
    net = network()
    if not net:
        return None
    return net.compare(a, b)
