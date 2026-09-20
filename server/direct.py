# -*- coding: utf-8 -*-
"""
梨宝 · L0 模板直答层（存在性 / 位置 / 营业时间）
================================================
解决的问题：这三类问题的答案**完全由结构化图谱决定**，让 LLM 转述只多出两处风险
（多一次调用要花钱、改述可能出错）。事实探针已实测过这种错：
图谱里写着「第二食堂左侧有麦当劳（6:30-22:00）」，LLM 却凭常识答「学校没有」。

触发条件（三个同时满足才拦下，宁可漏拦也不误拦）：
  1) 问法属于存在性 / 位置 / 营业时间三类之一（有没有X / X在哪 / X几点开）
  2) 实体命中 —— 官方名 + 别名 + 品牌反向索引（campus.match_entities）
  3) 不含需要延展的问法（怎么/推荐/预约/多少钱…），那些交给 RAG 或 agent

命中 → 用图谱数据拼答案，**0 次 LLM 调用**（省钱 + 零改述风险）；
不命中 → 返回 None，正常链路继续走，本模块不产生任何副作用。
"""
import re
import zlib

import campus

# ---- 三类问法 ----
# 存在性：`有…吗` 中间允许 14 字 —— 官方全名很长（"图书馆（图文信息中心）"、
# "校医室（卫生科）"），窗口太窄会让这些题掉回 LLM 白花钱（2026-09-18 评测抓到的真 bug）。
_TRIG_EXIST = re.compile(r"(有没有|有[^，。？！,?!；;]{0,14}吗)")
_TRIG_WHERE = re.compile(r"(在哪|在哪里|在哪个校区|在什么地方|位置在哪)")
_TRIG_HOURS = re.compile(r"(几点开|几点关|几点闭|开门|关门|还开|开着|营业时间|时间段)")

# 需要延展的问法：一旦出现就放弃模板 —— 这类问题模板答不好，RAG/agent 才有价值
_BLOCK = re.compile(
    r"(怎么|为什么|如何|为啥|好吃|好喝|推荐|建议|怎么样|好不好|办|预约|申请|报名|"
    r"缴费|多少钱|费用|收费|价格|取消|退|能不能|可以吗|需不需要|要不要|值得|哪个好|对比|"
    # 2026-09-18 评测抓到的真问题：「三教附近**有啥**近的食堂吗」被 `有…吗` 误判成存在性，
    # 模板只答了单个地点 → 答非所问（比多花钱更糟）。推荐/就近类问法必须放行。
    r"附近|周边|最近|哪个|哪家|有啥|多远|几条)"
)

# 超过这个长度基本是多跳/描述型提问（"我上午在三教上课中午想去二食堂吃饭但下午还要去南校…"），
# 里面往往还夹着别的诉求，模板化回答会显得答非所问 —— 一律放行走正常链路。
# 实测护栏：真实正例都在 10 字上下（"学校有没有麦当劳"=8、"第一食堂几点开门"=8），30 字足够宽松。
_MAX_LEN = 30


# ---- 语言模板库（2026-09-19《梨宝语言风格规范》：规则命中也拟人，但克制）----
# 轮换种子 = crc32(问题+实体)：同问题恒定（确定性可测、回归可断言），不同问题自然错开。
# 万能尾巴「还有想问的随时喊梨宝～」进变体池，不再每句必带（克制档=收尾即止）。
_TAIL_POOL = [
    "还有想问的随时喊梨宝～",
    "要规划路线的话随时喊梨宝～",
    "",   # 克制档
]
_OPEN_EXIST = ["有嗷宝子！", "有的宝子～", "有哦！"]
_OPEN_WHERE = ["『{n}』在这儿", "{n}？位置给你指过去", "『{n}』在这里"]
_OPEN_HOURS = ["『{n}』的时间梨宝给你摆出来", "{n}的档期记好", "『{n}』几点开？看这里"]


def _pick(pool, seed_text):
    return pool[zlib.crc32(seed_text.encode("utf-8")) % len(pool)]


def _kind(q):
    """识别问法类型；hours 优先于 exist（"麦当劳几点开门"含"开"也含存在含义）。"""
    if _TRIG_HOURS.search(q):
        return "hours"
    if _TRIG_EXIST.search(q):
        return "exist"
    if _TRIG_WHERE.search(q):
        return "where"
    return None


def _head(kind, name, brand, seed):
    """开头句式按（问题+实体）稳定轮换——《梨宝语言风格规范》§四：同问题恒定，跨问题不同。"""
    if kind == "exist":
        core = f"『{brand}』就在{name}" if brand else f"咱上理有{name}"
        return _pick(_OPEN_EXIST, seed) + core
    if kind == "where":
        return _pick(_OPEN_WHERE, seed).format(n=name)
    return _pick(_OPEN_HOURS, seed).format(n=name)


def _render(q, p, kind):
    name = p["name"]

    # 品牌证据：把图谱里的原始串原样端出来（『麦当劳』→ 第二食堂左侧）
    brand, brand_ev = "", ""
    for b, bp in campus.match_brands(q):
        if bp["name"] == name:
            brand, brand_ev = b, campus._brand_evidence(bp, b)
            break

    loc = campus.campus_cn(p.get("campus"))
    zone = p.get("zone") or ""
    seed = f"{q}|{name}"
    lines = [_head(kind, name, brand, seed) + " —— " + loc + (f"｜{zone}" if zone else "")]

    if brand_ev:
        lines.append("· 图谱原文：" + brand_ev[:60])

    feats = [f for f in (p.get("features") or [])
             if not (brand_ev and brand_ev in f)]   # 去重：品牌证据已在上一行说过
    if feats:
        lines.append("· " + "；".join(feats[:2])[:70])

    st = campus.open_now(p)
    if p.get("hours"):
        hs = "；".join(f"{k} {v}" for k, v in list(p["hours"].items())[:3])
        if st.get("open") is True:
            hs += f"（现在开着，到 {st['until']}）"
        elif st.get("open") is False:
            hs += f"（现在没开：{st['reason']}）"
        lines.append("· 营业：" + hs[:90])
    elif p.get("closed"):
        lines.append("· 注意：" + str(p["closed"])[:40])

    nb = campus.nearby(name, 8)[:2]
    if nb:
        lines.append("· 周边：" + "、".join(f"步行 {mn} 分钟到 {tgt}" for tgt, mn, _ in nb))

    tail = _pick(_TAIL_POOL, seed + "|tail")
    if tail:
        lines.append(tail)
    return "\n".join(lines)


# 多轮指代（允许借上下文实体的唯一情形）：
# 2026-09-18 评测抓到一次**劫持**——「学校有没有瑞幸」被上一轮回答里的「1906咖啡厅」
# 顶掉了实体，答成 1906 的模板。所以借实体必须同时满足：
#   ① 当前句**不含**自己的实体（上面已判）② 当前句是短追问且有指代词 ③ 长度 ≤ 14
_ANAPHORA = re.compile(r"(它|这个|那个|那家|这家|那儿|这里|呢[？?]?$|^那)")


def try_direct(q, context=""):
    """命中 → {"answer","kind","entity"}；不命中 / 任何异常 → None（绝不影响主链路）。

    `context`：最近几轮的对话原话。**多轮指代**（"那它几点开门"）本身不含实体，
    借上一轮的实体仍可走 L0 模板（0 次 LLM）。但借实体是**高危操作**：
    上下文里同时有"用户问的"和"梨宝答的"，后者会把当前问题带跑偏，故设三道闸门
    （见 `_ANAPHORA`）。触发词与 `_BLOCK` 永远只看当前句。
    """
    q = (q or "").strip()
    if not q or len(q) > _MAX_LEN:
        return None
    kind = _kind(q)
    if not kind or _BLOCK.search(q):
        return None
    try:
        ents = campus.match_entities(q)
        if not ents and context and len(q) <= 14 and _ANAPHORA.search(q):
            ents = campus.match_entities(context)
        if not ents:
            return None
        p = ents[0]
        ans = _render((q + " " + (context or "")).strip(), p, kind)
    except Exception as e:
        print("[direct] 模板直答失败，回退正常链路：", e)
        return None
    if not ans or len(ans) < 12:
        return None
    return {"answer": ans, "kind": kind, "entity": p["name"]}
