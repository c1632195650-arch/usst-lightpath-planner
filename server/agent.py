# -*- coding: utf-8 -*-
"""梨宝 · L2 agent 托底（工具调用）
================================================
位置：梯子的第三级，**只接 `route == "llm"`（规则路由判定为知识库外）的那部分流量**。
        L0 模板直答（0 次 LLM） → L1 现有 RAG 快路径（1 次） → L2 本模块（1~3 次）
为什么需要它：旧行为是「库外 → LLM 凭常识裸答」。事实探针里「学校有没有麦当劳」
就是从这条路摔下去的 —— 规则说没有，LLM 就跟着编。托底层的职责是**让模型先自查一轮**，
查完确实没有，才诚实认账并指官方渠道。

工具与优先级（写死在 System 里，不靠模型自觉）：
    结构化图谱(search_pois) > 官方资讯库(search_kb) > 常识 > 联网(web_search)
三道锁：
    ① 优先级锁 —— 低优先级不得覆盖高优先级
    ② 标注锁   —— 引用联网内容必须说明「网上说法、仅供参考」，禁止说成官方规定
    ③ 冲突锁   —— 联网与库/图谱矛盾时，以库/图谱为准

成本控制：MAX_ROUNDS=3；模型第一轮就能直接答的问题（情感陪伴/闲聊/方法论）
不会产生任何工具调用，与旧链路同为 1 次调用 —— 增量只发生在真需要查的场景。
"""
import json

import requests

import campus
import rag
import websearch

MAX_ROUNDS = 3

_TOOLS = [
    {"type": "function", "function": {
        "name": "search_kb",
        "description": ("检索上理工官方资讯库（520 篇公众号文章：通知、政策、流程、攻略）。"
                        "涉及学校政策/时间/地点/流程时先查这里。"),
        "parameters": {"type": "object", "properties": {
            "q": {"type": "string",
                  "description": "检索词。**短关键词比长句命中率高**，如「VPN」「四六级报名」。"}},
            "required": ["q"]}}},
    {"type": "function", "function": {
        "name": "search_pois",
        "description": ("检索校园 147 个地点的结构化图谱（食堂/教学楼/快递/打印/超市/场馆），"
                        "支持官方名、别名与品牌词（麦当劳、全家）。返回位置、营业时间、特征。"),
        "parameters": {"type": "object", "properties": {
            "q": {"type": "string", "description": "地点名或品牌名"}},
            "required": ["q"]}}},
    {"type": "function", "function": {
        "name": "web_search",
        "description": ("联网搜索。**仅当确认校园资讯库与校园图谱都没有答案**时才允许使用。"
                        "引用结果时必须标注「网上说法、仅供参考」。"),
        "parameters": {"type": "object", "properties": {
            "q": {"type": "string", "description": "搜索词"}},
            "required": ["q"]}}},
]

_AGENT_RULES = """【本轮模式：托底核查】
常规链路（资讯库检索 + 校园图谱）**没有**直接命中这个问题，你来做最后一道核查。
你可以调用工具（最多 2 次），按下面的判断决定要不要用：

1. 情感陪伴、闲聊、学习方法、经验建议类 → **不需要工具**，直接按梨宝人设回答。
2. 涉及学校事实（地点/政策/时间/流程）→ 先用 search_pois / search_kb 核实。
3. 只有前两类都查不到、且问题确实需要外部信息时，才允许 web_search。

【三道锁，必须遵守】
- 优先级锁：结构化图谱 > 官方资讯库 > 你的常识 > 联网；低优先级不得覆盖高优先级。
- 标注锁：引用联网内容时必须自然说明「网上是这么说的、仅供参考」，**禁止**说成学校官方规定。
- 冲突锁：联网结果与资讯库/图谱矛盾时，以资讯库/图谱为准；可补充网上的说法但要点明分歧。

【兜底口径】若全部工具都查不到：诚实说「校园资讯里没有这条」+ 建议官方渠道
（学校官网 / 辅导员 / 后勤 400-085-4008），**不要编造**。
保持梨宝人设与篇幅（180 字内）。"""


def _post(base_url, api_key, model, messages, tools=None, timeout=45):
    payload = {"model": model, "messages": messages,
               "temperature": 0.5, "max_tokens": 500}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    r = requests.post(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}",
                 "Content-Type": "application/json"},
        json=payload, timeout=timeout,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]


def _exec_tool(name, args, web_ok=True):
    """工具执行器。**任何异常都在这里转成可读文本**，绝不让 agent 循环因工具崩掉。"""
    q = (args or {}).get("q") or ""
    if name == "search_kb":
        rows = rag.search(q, 4) if q else []
        if not rows:
            return "（资讯库没有相关结果）"
        return "\n".join(
            f"[{i}]《{r['title']}》(raw_vec={r.get('raw_vec', 0):.3f})\n"
            f"{(r.get('snippet') or r.get('full_text') or '')[:300]}"
            for i, r in enumerate(rows[:4], 1)
        )
    if name == "search_pois":
        rows = campus.search_pois(q, limit=4) if q else []
        if not rows:
            return "（校园图谱没有相关地点）"
        out = []
        for r in rows:
            seg = f"- {r['name']}（{r.get('campus_cn') or ''}" \
                  f"{('｜' + r['zone']) if r.get('zone') else ''}）"
            if r.get("hours"):
                seg += "｜营业 " + "；".join(f"{k} {v}" for k, v in list(r["hours"].items())[:3])
            if r.get("features"):
                seg += "｜" + "；".join(r["features"][:2])
            out.append(seg)
        return "\n".join(out)
    if name == "web_search":
        if not web_ok:
            return "（联网搜索已被关闭）"
        rows = websearch.web_search(q, 5)
        if not rows:
            return "（联网无结果或不可用）"
        return "\n".join(
            f"[{i}] {r['title']}（{r['provider']}）\n{r['url']}\n{r['snippet']}"
            for i, r in enumerate(rows[:5], 1)
        )
    return f"（未知工具 {name}）"


def run_agent(q, persona, base_url, api_key, model,
              mem_ctx="", profile_ctx="", web_ok=True):
    """跑一轮托底。成功 → {"answer","tools"}；未配置 / 任何异常 → None（调用方回退旧链路）。"""
    if not api_key:
        return None
    blocks = []
    if profile_ctx:
        blocks.append("【用户档案】" + profile_ctx)
    if mem_ctx:
        blocks.append(mem_ctx)
    blocks.append(f"【用户问题】{q}")
    messages = [
        {"role": "system", "content": persona + "\n\n" + _AGENT_RULES},
        {"role": "user", "content": "\n\n".join(blocks)},
    ]
    tools = [t for t in _TOOLS
             if web_ok or t["function"]["name"] != "web_search"]
    used = []
    try:
        for _ in range(MAX_ROUNDS):
            msg = _post(base_url, api_key, model, messages, tools=tools)
            calls = msg.get("tool_calls") or []
            if not calls:
                ans = (msg.get("content") or "").strip()
                return {"answer": ans, "tools": used} if ans else None
            messages.append({"role": "assistant",
                             "content": msg.get("content") or "",
                             "tool_calls": calls})
            for tc in calls[:3]:
                fn = tc.get("function") or {}
                name = fn.get("name") or ""
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except Exception:
                    args = {}
                try:
                    out = _exec_tool(name, args, web_ok=web_ok)
                except Exception as e:
                    out = f"（工具 {name} 执行失败：{e}）"
                used.append(name)
                messages.append({"role": "tool",
                                 "tool_call_id": tc.get("id"),
                                 "content": out[:1200]})
        # 轮次用尽 → 强制收口（撤掉 tools，避免无限循环）
        msg = _post(base_url, api_key, model, messages, tools=None)
        ans = (msg.get("content") or "").strip()
        return {"answer": ans, "tools": used} if ans else None
    except Exception as e:
        print("[agent] 托底失败，回退快路径：", e)
        return None
