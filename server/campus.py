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

def find_poi(name):
    """按名称或别名精确找 POI（长名优先，避免子串误匹配）"""
    name = (name or "").strip()
    if not name:
        return None
    for p in _all_pois():
        names = sorted([p["name"]] + p.get("alias", []), key=len, reverse=True)
        for n in names:
            if n and (n == name or name in n or n in name):
                return p
    return None

def match_pois(text):
    """从一段文本里匹配出所有提到的 POI"""
    text = text or ""
    hits = []
    for p in _all_pois():
        names = sorted([p["name"]] + p.get("alias", []), key=len, reverse=True)
        for n in names:
            if n and n in text:
                hits.append(p)
                break
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
        nb = nearby(p["name"])
        if nb:
            resolved = True
            blocks.append(f"\n『{p['name']}』周边：")
            for name, mn, note in nb:
                tgt = find_poi(name)
                seg = f"  - 步行约{mn}分钟 → {name}"
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

    oc = m.get("off_campus", [])
    if oc and any(k in text for k in ("校外", "校门口", "出去吃", "改善伙食", "聚餐")):
        blocks.append("\n[校外小吃]")
        for o in oc[:4]:
            blocks.append(f"  - {o['name']}（{o['where']}）：{'、'.join(o.get('signature', [])[:3])}")

    return "\n".join(blocks)
