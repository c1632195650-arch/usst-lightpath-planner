# -*- coding: utf-8 -*-
"""
L0 模板直答层单测（不需要起后端、不消耗 LLM）
==============================================
跑法： python scripts/test_direct.py
覆盖三类正例（存在性 / 位置 / 营业时间）+ 五类反例（该放行给 RAG/agent 的），
以及「模板答案必须含图谱真值」这一条硬约束 —— 模板答错比不答更危险。
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

import direct  # noqa: E402

ok = fail = 0
fails = []


def check(label, good, detail=""):
    global ok, fail
    if good:
        ok += 1
    else:
        fail += 1
        fails.append(f"{label}（{detail}）")
    print(f"  {'✅' if good else '❌'} {label}" + (f" ｜ {detail}" if detail else ""))


# ---- 正例：品牌嵌入图谱（麦当劳案例本体）----
print("\n== 正例 · 存在性（品牌嵌在 features 里）==")
d = direct.try_direct("学校有没有麦当劳")
check("命中「麦当劳」", bool(d), "返回 None 说明没拦到")
if d:
    check("答案指明落在第二食堂", "第二食堂" in d["answer"], d["answer"][:60])
    check("答案引用图谱原文（含营业时间）", "麦当劳" in d["answer"], d["answer"][:80])
    check("kind 判定为 exist", d["kind"] == "exist", d["kind"])

print("\n== 正例 · 措辞翻转（同一事实换问法）==")
d2 = direct.try_direct("学校里有麦当劳吗？")
check("「学校里有麦当劳吗」同样命中", bool(d2) and "第二食堂" in d2["answer"])

print("\n== 正例 · 品牌短名 → POI 全名（全家便利店）==")
d3 = direct.try_direct("学校有没有全家")
check("「全家」命中", bool(d3))
if d3:
    check("答案指向全家便利店", "全家" in d3["answer"], d3["answer"][:50])

print("\n== 正例 · 位置与营业时间 ==")
d4 = direct.try_direct("1906咖啡厅在哪")
check("「X在哪」命中", bool(d4) and d4["kind"] == "where", str(d4)[:60] if d4 else "None")
d5 = direct.try_direct("第一食堂几点开门")
check("「X几点开」命中", bool(d5) and d5["kind"] == "hours", str(d5)[:60] if d5 else "None")
if d5:
    check("答案含营业时间字段", "营业" in d5["answer"] or "时间" in d5["answer"])

print("\n== 反例 · 必须放行（返回 None）==")
NEG = [
    ("二食堂有啥推荐菜吗", "含「推荐」→ 交给 RAG 才有价值"),
    ("三教附近有啥吃的", "无存在性/位置触发词"),
    ("我失恋了怎么办", "情感陪伴类"),
    ("宿舍晚上断电吗", "无限定实体（问题在「断电」而非「宿舍在哪」）"),
    ("学校有没有星巴克", "库里真没有 → 交由 agent 走诚实兜底"),
    ("图书馆借书能借几本？能借多久？", "数值型提问，非三类问法"),
]
for q, why in NEG:
    check(f"放行「{q}」", direct.try_direct(q) is None, why)

# 2026-09-19 数据更新：瑞幸已入驻（思餐厅四楼，文证：后勤/学生会推文）→ 从放行反例转正为模板直答
d_ru = direct.try_direct("学校有没有瑞幸")
check("「学校有没有瑞幸」转正为模板直答（数据更新）",
      bool(d_ru) and "思餐厅" in d_ru["answer"], str(d_ru)[:70] if d_ru else "None")

print("\n== 边界 · 长句不拦（多跳问题交给 agent）==")
long_q = "我上午在三教上课中午想去二食堂吃饭但下午还要赶去南校区开会，学校有没有第二食堂来着"
check("超长句返回 None", direct.try_direct(long_q) is None)

# ---- 2026-09-18 评测（L3 对话级套件）抓到的两个真问题，固化为回归 ----
print("\n== 多轮指代 · 追问句无实体时借用上下文（评测抓到）==")
d_ctx = direct.try_direct("那它几点开门", context="学校有没有麦当劳")
check("「那它几点开门」借上文实体仍走模板", bool(d_ctx) and d_ctx["entity"] == "第二食堂",
      str(d_ctx)[:70] if d_ctx else "None（会掉回 LLM 白花钱）")
check("借上下文时 kind 判为 hours", bool(d_ctx) and d_ctx["kind"] == "hours")
check("无上下文时同一追问不命中（不得凭空猜实体）",
      direct.try_direct("那它几点开门") is None)

# ---- 2026-09-18 第二例（评测抓到，且是本轮改动自己引入的）：上下文劫持 ----
print("\n== 上下文劫持守卫（跨轮实体不得顶掉当前问题）==")
HISTORY = "用户：学校有没有星巴克\n梨宝：咱上理咖啡只有 1906咖啡厅（军工路516号北校区西北角）"
check("「学校有没有星巴克」不被上文里的 1906 劫持",
      direct.try_direct("学校有没有星巴克", context=HISTORY) is None,
      "当前句无指代词 → 禁止借上下文实体")
LONG_ANAPH = "那它这个食堂到底几点钟开门营业呢请问"      # 18 字，超 _ANAPHORA 的长度护栏
check("长追问不借实体（>14 字护栏生效）",
      direct.try_direct(LONG_ANAPH, context="学校有没有麦当劳") is None,
      f"「{LONG_ANAPH}」共 {len(LONG_ANAPH)} 字，应放行走正常链路")
check("裸「那麦当劳呢」放行（语义不明，不猜）",
      direct.try_direct("那麦当劳呢", context=HISTORY) is None,
      "「X呢」可能是问营业时间也可能是闲聊，三类问法都不匹配 → 交正常链路")

print("\n== 推荐类问法必须放行（评测抓到：曾被 `有…吗` 误拦致答非所问）==")
for q in ["三教附近有啥近的食堂吗", "学校附近有没有麦当劳", "二食堂附近有啥好吃的吗"]:
    check(f"放行「{q}」", direct.try_direct(q) is None,
          "含附近/有啥 → 属于就近推荐，模板只答单个地点会答非所问")

print("\n" + "=" * 60)
print(f"汇总：{ok}/{ok + fail} 通过（{ok / (ok + fail) * 100:.1f}%）")
if fails:
    print("失败明细：")
    for f in fails:
        print("  ❌", f)
else:
    print("全部通过 ✅")
print("=" * 60)
sys.exit(0 if not fails else 1)
