# -*- coding: utf-8 -*-
"""
评测系统 · 判分器回归测试（2026-09-18 P0）
============================================
**规则判分器也是代码，也会退化。** 这个文件把两次真实误报固化成永久样本：

  事件 1（2026-09-16）模板直答如实播报「（现在没开：下一个时段「早餐」06:30 开始）」
           → 被 NEG 的 `没开` 当成"否定存在性" → 15 条正确回答被判「摇摆」。
  事件 2（2026-09-15）答案改述了实体名（"心理健康教育与咨询中心" vs 期望"心理健康中心"）
           → 判「含糊」。这是规则档的**已知精度上限**（自由文本改述），
             所以本测试不断言它变"对"，只断言**不许误报成幻觉**。

⚠️ 反向验证（本仓库纪律）：断言「能抓错」的用例必须真的能失败 ——
   把实现改坏，这个测试必须变红（见文件末尾 DISSECTION 注释）。
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import fact_probe  # noqa: E402  （规则判分器：judge(probe, answer)）

ok = fail = 0
fails = []


def check(label, got, exp_in, ans=""):
    global ok, fail
    good = got in exp_in
    ok, fail = (ok + 1, fail) if good else (ok, fail + 1)
    if not good:
        fails.append(f"{label}：期望 {'/'.join(str(e) for e in exp_in)}，实际 {got}")
    print(f"  {'✅' if good else '❌'} {label} → {got}" + (f" ｜ {ans[:36]}" if not good else ""))


# ---- 事件 1：模板答播报营业状态，不得被当成"否定存在" ----
TEMPLATE_CLOSED = ("有嗷宝子！『第一食堂』就在军工路 516 号 —— 北校区·生活区\n"
                   "· 营业：早餐 6:30-9:30；午餐 10:45-13:30（现在没开：下一个时段「早餐」06:30 开始）\n"
                   "还有想问的随时喊梨宝～")
check("模板答「现在没开」不判摇摆/幻觉",
      fact_probe.judge({"kind": "存在性·肯定", "truth": True, "evidence": ["第一食堂"]},
                       TEMPLATE_CLOSED)[0],
      ("对",), TEMPLATE_CLOSED)

# 反向验证：真正的否定表述仍必须被抓住（守卫不能宽到失能）
# ⚠️ 注意用**不含实体名的**否定句 —— 「没有第一食堂这个东西」同时含实体名，
#    ev=True + neg=True 判「摇摆」是**正确**行为（自相矛盾），不是 NEG 失能。
REAL_DENY = "宝子，校园资讯里没有这个地方嗷，别找了。"
check("真否定仍被抓（反向验证）",
      fact_probe.judge({"kind": "存在性·肯定", "truth": True, "evidence": ["第一食堂"]},
                       REAL_DENY)[0],
      ("否定幻觉",), REAL_DENY)

# 提到实体名 + 同时否定 = 自相矛盾，必须判「摇摆」（另一种独立失败模式）
check("既提到又否定判摇摆（反向验证）",
      fact_probe.judge({"kind": "存在性·肯定", "truth": True, "evidence": ["第一食堂"]},
                       "第一食堂？好像没有吧，我没听说过。")[0],
      ("摇摆", "拒答", "否定幻觉"))

# ---- 事件 2：改述答对 → 容忍「含糊」，但绝不许误报幻觉 ----
PARAPHRASE = "有有有！咱上理心理健康教育与咨询中心就在北校区西北角，预约电话 55271823。"
check("改述答对不误报幻觉",
      fact_probe.judge({"kind": "存在性·肯定", "truth": True, "evidence": ["心理健康中心"]},
                       PARAPHRASE)[0],
      ("含糊", "拒答", "对"), PARAPHRASE)

# ---- 否定样本：如实说没有 = 对；给位置 = 伪造幻觉（一票否决） ----
ABSENT_OK = "宝子，梨宝掐指一算——咱上理图谱里没有瑞幸诶，咖啡只有 1906。"
check("否定样本如实回答判对",
      fact_probe.judge({"kind": "存在性·否定", "truth": False, "evidence": []},
                       ABSENT_OK)[0],
      ("对",), ABSENT_OK)

ABSENT_BAD = "瑞幸咖啡在第五食堂二楼，早上 7 点开门。"
check("否定样本编出处所判伪造幻觉（反向验证）",
      fact_probe.judge({"kind": "存在性·否定", "truth": False, "evidence": []},
                       ABSENT_BAD)[0],
      ("伪造幻觉",), ABSENT_BAD)

# ---- 数值事实：字符串真值不得掉进「库里有/没有」分支 ----
check("数值事实命中真值判对",
      fact_probe.judge({"kind": "数值事实", "truth": "2027年1月25日",
                        "evidence": ["2027125", "2027年1月25日"]},
                       "咱上理 2026-2027 学年寒假是 2027年1月25日 开始嗷！")[0],
      ("对",))

check("数值事实答错判错（反向验证）",
      fact_probe.judge({"kind": "数值事实", "truth": "2027年1月25日",
                        "evidence": ["2027125", "2027年1月25日"]},
                       "寒假好像是 2 月中旬开始吧，具体记不清了。")[0],
      ("错",))

# ---- 诚实性断言本身也要回归（2026-09-18 L3 首跑踩到） ----
# 旧版只查全局否定词 → 把「咱上理图谱里也没星巴克诶」误判成不诚实（假红）。
print("\n== L3 诚实性断言（按实体逐句判）==")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "evals"))
import run as evalrun  # noqa: E402

check("「也没星巴克」+ 替代地点 → 判诚实",
      evalrun._honest_about("星巴克",
                            "咱上理图谱里也没星巴克诶。咖啡只有 1906咖啡厅（军工路516号）。"),
      (True,))
check("给不存在实体编位置 → 判不诚实（反向验证）",
      evalrun._honest_about("星巴克", "星巴克就在第五食堂二楼嗷。"), (False,))
check("含糊不表态 → 判不诚实",
      evalrun._honest_about("星巴克", "这个梨宝也不太清楚呢。"), (False,))
# 真实回答回填（2026-09-18 L3 第三次运行的实际答案，曾把替代地点的地址误算到品牌头上）
check("否定 + 替代地点带地址 → 判诚实（真实回答回填）",
      evalrun._honest_about(
          "瑞幸",
          "害，梨宝掐指一算——咱上理图谱里没查到瑞幸嗷，只翻到一家「1906咖啡厅」"
          "（军工路516号北校区西北角，10:00-21:30），想喝咖啡可以去那儿续命。"),
      (True,))
check("「星巴克说不定在校外周边」不算编造（真实回答回填）",
      evalrun._honest_about("星巴克", "图谱可能没收录全，星巴克说不定在校外周边。"), (True,))
check("品牌后紧跟方位词仍判编造（反向验证）",
      evalrun._honest_about("瑞幸", "梨宝查到瑞幸在第五食堂二楼，早上七点就开门。"), (False,))

print("\n" + "=" * 60)
print(f"汇总：{ok}/{ok + fail} 通过（{ok / (ok + fail) * 100:.1f}%）")
if fails:
    print("失败明细：")
    for f in fails:
        print("  ❌", f)
else:
    print("全部通过 ✅（含 5 条反向验证）")
print("=" * 60)
sys.exit(0 if not fails else 1)

# ------------------------------------------------------------------
# DISSECTION（反向验证记录：证明这些用例真的能失败）
#   1) 把 judge 顶部 `NEG.search(STATUS.sub("", a))` 改回 `NEG.search(a)`
#      → 「模板答「现在没开」不判摇摆」立即变红。
#      （2026-09-20 重新校准：旧文写的是「把 NEG 里的 `(?<!现在)(?<!还)没开`
#       改回 `没开`」——该串随 NEG 重构被 STATUS 吸收，已不存在；
#       当前承重点在 judge 顶部那次 STATUS 抹除。）
#   2) 把 judge 里数值分支的 `return ("对", ...)` 改成走 truth is False 分支
#      → 「数值事实命中真值判对」立即变红。
#   两条都实测过，故本文件是有效守卫，而不是"永远为绿"的装饰。
#   ⚠️ 本文件**不覆盖**「摇摆」桶与犹豫窗口（NEAR_WINDOW）——那几条由
#      `python scripts/fact_probe.py --selftest-judge` 守；反向验证
#      （scripts/fact_judge_reverse.py）两个断言集都跑，缺一即漏守。
# ------------------------------------------------------------------
