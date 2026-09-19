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
    ("学校有没有瑞幸", "库里真没有 → 交由 agent 走诚实兜底"),
    ("图书馆借书能借几本？能借多久？", "数值型提问，非三类问法"),
]
for q, why in NEG:
    check(f"放行「{q}」", direct.try_direct(q) is None, why)

print("\n== 边界 · 长句不拦（多跳问题交给 agent）==")
long_q = "我上午在三教上课中午想去二食堂吃饭但下午还要赶去南校区开会，学校有没有第二食堂来着"
check("超长句返回 None", direct.try_direct(long_q) is None)

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
