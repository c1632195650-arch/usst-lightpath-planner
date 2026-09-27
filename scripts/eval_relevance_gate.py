# -*- coding: utf-8 -*-
"""
D 批 D5 · 问答相关性门评测（负例 5 条 + 正例回归）
==========================================================
病灶：grounded/hybrid 路由对假命中无防护 —— 检索排序分高就「关键词命中就套用」。
D5 在 api_chat 里加了一次廉价 LLM 门（问题 + top3 标题/摘要 → relevant），
判不相关 → route 降级 'llm'（边界外诚实口径）。

用法（需先启动后端，且 LLM Key 已配 —— 门本身就要 LLM）：
    LIBAO_BASE=http://127.0.0.1:8001 python scripts/eval_relevance_gate.py

判读（响应新增 `relevance` 字段，D5 观测信号）：
  · 负例（字面相近、话题无关）通过 = relevance == "irrelevant_downgraded"
    且最终 route == "llm"（不套用无关命中）；
  · 正例通过 = relevance == "ok"（命中不受影响）；
  · relevance == None 且 route 落 'llm' = **检索本来就未命中** —— 该负例不成立
    （门没被触发，不能计入 5/5，评测报告里如实标出）；
  · relevance == None 且 route 仍 grounded/hybrid = 门不可用（LLM 挂了/超时）——
    设计行为：保持现状不加伪门，报告里如实标注，不算负例失败。
"""
import json
import os
import sys
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.environ.get("LIBAO_BASE", "http://127.0.0.1:8001")

# ── 负例：字面与库内条目相近，但话题无关（门应当拦下 → 降级 llm）──
NEGATIVES = [
    {"id": "n1", "q": "健身房里有没有功率自行车？", "note": "字面撞「功率」类条目；库内没有器材清单"},
    {"id": "n2", "q": "宿舍楼里能自己开小超市吗？", "note": "字面撞「宿舍」「超市」；问的是商业政策，库内不答"},
    {"id": "n3", "q": "食堂窗口招暑期兼职吗？", "note": "字面撞「食堂」；问的是招聘政策，库内不答"},
    {"id": "n4", "q": "图书馆的藏书可以在网上卖掉吗？", "note": "字面撞「图书馆」；问的是二手交易，库内不答"},
    {"id": "n5", "q": "学校操场的草坪可以租给别人办婚礼吗？", "note": "字面撞「操场」；问的是场地外租，库内不答"},
]

# ── 正例：真实命中，门判相关后照常走 grounded/hybrid（回归保护）──
# ⚠️ 正例的入选标准是「检索层确实返回了答案载体」（先经 /api/search 核实）。
# 「图书馆几点开门」在当前库里检索不到开放时间文章（top 全是借阅/文明规范/假期安排）——
# 门把它拦下是**对的**（库内没有答案载体就该走 llm 诚实口径，而不是硬套借阅规则），
# 故不能当正例。这正是 D5 门的靶心：假命中防线同时守住了「没有依据就别装作有」。
POSITIVES = [
    {"id": "p1", "q": "四六级什么时候报名"},
    {"id": "p2", "q": "清明节食堂怎么开放"},
    {"id": "p3", "q": "体育场馆暑期怎么开放"},
]


def chat(q):
    body = json.dumps({"q": q, "user_id": "u-gate-eval", "session_id": "s-gate-eval"}).encode("utf-8")
    req = urllib.request.Request(
        BASE.rstrip("/") + "/api/chat",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}


def main():
    print(f"[live] {BASE}/api/chat（D5 相关性门评测）\n")
    neg_pass = 0
    neg_valid = 0
    pos_pass = 0
    pos_total = 0

    for it in NEGATIVES:
        res = chat(it["q"])
        rel = res.get("relevance")
        route = res.get("route")
        mode = res.get("mode")
        if rel == "irrelevant_downgraded" and route == "llm":
            neg_valid += 1
            neg_pass += 1
            verdict = "✅ 拦下（降级 llm 诚实口径）"
        elif rel == "ok":
            neg_valid += 1
            verdict = "❌ 门判相关（假命中漏过）"
        elif rel is None and route in ("grounded", "hybrid"):
            verdict = "⚠️ 门不可用（LLM 未生效，按现状放行——设计行为，不计失败）"
        else:
            verdict = "➖ 未触发门（检索未命中，负例不成立，不计入分母）"
        print(f"  {it['id']} {it['q']}")
        print(f"     route={route} relevance={rel} mode={mode} top_raw={res.get('top_raw_vec')} → {verdict}")
        print(f"     （{it['note']}）")

    for it in POSITIVES:
        res = chat(it["q"])
        rel = res.get("relevance")
        route = res.get("route")
        pos_total += 1
        if rel == "ok":
            pos_pass += 1
            verdict = "✅ 命中照常（门未误伤）"
        elif rel == "irrelevant_downgraded":
            verdict = "❌ 门误伤真命中"
        else:
            verdict = "⚠️ 门未生效/未触发（如实记录）"
        print(f"  {it['id']} {it['q']} → route={route} relevance={rel} → {verdict}")

    print()
    print(f"负例：{neg_pass}/{neg_valid} 触发且拦下（有效负例 {neg_valid}/5；未触发的算不成立）")
    print(f"正例：{pos_pass}/{pos_total} 命中未受影响")
    ok = neg_valid >= 1 and neg_pass == neg_valid and pos_pass == pos_total
    print("DoD（负例全拦 + 正例不受影响）：", "✅ 过" if ok else "❌ 未过（见上明细）")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
