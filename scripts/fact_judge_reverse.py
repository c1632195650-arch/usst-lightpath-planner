# -*- coding: utf-8 -*-
"""判分器反向验证（mutation testing）—— 证明 `fact_probe` 的自检**有牙齿**。

================================================================
为什么需要这个脚本
================================================================
2026-09-18 的两次教训：**自己写的测试常常是"假覆盖"**（端到端测"锁生效"的
输入变化其实不让块移动；测"转场重挂"因为 improve 实测 accepted=0 根本走不到
目标分支）。表现是——把实现整个关掉，测试**照样全绿**。

所以纪律是：**新测试必须做反向验证。要验函数就破坏函数体，不是破坏调用点。**

这个脚本把这套纪律自动化到判分器上：逐个"变异" `fact_probe.py` 的判分实现，
每变异一次就跑一次 `--selftest-judge`，**要求必须变红**。不变红 = 自检没覆盖到
那段实现 = 那段实现在自检面前形同虚设。

首次运行就抓到一处真问题：变异"关掉营业状态抹除（STATUS.sub → 恒等）"时自检
仍是 12/12 全绿 —— 因为修 NEG 时已把「没开」摘掉，NEG 再也匹配不到营业状态词，
`STATUS.sub` 成了**死代码**。补上「没有营业」这一真实口语形态的用例后，
该变异体才被抓住。

用法：
  python scripts/fact_judge_reverse.py       # 退出码 0 = 自检对全部变异体敏感
"""
import os
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "fact_probe.py")
MUT_PATH = os.path.join(HERE, "_fact_judge_mut.py")   # 跑完即删

# (说明, 原文, 变异为) —— 每一条都必须让自检变红
# ⚠️ 这里有**维护成本**：变异点靠字符串定位，`fact_probe.py` 一改结构就会
#    "定位失败"（脚本会明确报出来，不会静默通过）。这是刻意的取舍 ——
#    宁可要求改判分器的人顺手同步这里，也不要一个永远绿的装饰性测试。
MUTS = [
    ("关掉「贴着实体的犹豫」判定 → 应失去对「命中但不干脆」的区分",
     "if near_recall:", "if False:"),
    ("关掉「贴着实体的召回失败」判定 → 应把「查不到」误报成干净命中",
     "if near_lookup:", "if False:"),
    ("关掉营业状态抹除（STATUS.sub → 恒等）→ 应把「没有营业」误判成否定幻觉",
     'NEG.search(STATUS.sub("", a))', "NEG.search(a)"),
    ("关掉贴实体否认判定（_denies_entity → 恒 False）→ 应漏掉真否定幻觉",
     "def _denies_entity(a, evidence, window=8):\n",
     "def _denies_entity(a, evidence, window=8):\n    return False\n"),
    ("把 SOFT_RECALL 收回原样（丢掉「不太确定」口语变体）→ 应漏掉犹豫形态",
     'r"(不太?确定|不太?清楚|没把握|记不太?清)"', 'r"(不确定|没把握)"'),
    ("把 NEAR_WINDOW 放大到铺满全文（等于取消距离约束）→ "
     "应把「另起一句给营业时间免责」的正确答案误降级",
     "NEAR_WINDOW = 18", "NEAR_WINDOW = 400"),
    ("把 _ev_variants 改成只收原样（丢掉「去括号限定语」形态）→ "
     "应重新造出「南校区有个清真食堂」这类假含糊",
     "for v in (n, _BRACKET.sub(\"\", n)):", "for v in (n,):"),
    ("把 NEG 的「有没有」守卫（(?<!有)）去掉 → "
     "应把转述问题的疑问句误判成否认",
     'NEG = re.compile(r"((?<!有)没有', 'NEG = re.compile(r"(没有'),
    ("把 SOFT_LOOKUP 收回原样（丢掉「没提过/没见过」）→ "
     "应把「库里没有、如实说没提过」的正确回答误判成含糊",
     "没查到|没找到|没提过|没提|没见过|没看到|没明文", "没查到|没找到"),
    ("把 _denies_entity 的窗口放到铺满全文（否定幻觉不再要求紧贴）→ "
     "应把「没有休息日」这种属性否定误判成否定幻觉（最危险的误红）",
     "def _denies_entity(a, evidence, window=8):", "def _denies_entity(a, evidence, window=400):"),
]


def main():
    with open(TARGET, encoding="utf-8") as f:
        src = f.read()
    print("=" * 72)
    print("判分器反向验证：每个变异体都必须让 --selftest-judge 变红")
    print("=" * 72)
    missed = []
    try:
        for name, a, b in MUTS:
            if a not in src:
                print(f"  ⚠️  变异体定位失败（源码已改，需同步本脚本）：{name}")
                missed.append(name)
                continue
            with open(MUT_PATH, "w", encoding="utf-8") as f:
                f.write(src.replace(a, b, 1))
            p = subprocess.run([sys.executable, MUT_PATH, "--selftest-judge"],
                               cwd=HERE, capture_output=True, text=True,
                               encoding="utf-8", errors="replace")
            tail = [ln for ln in (p.stdout or "").splitlines() if "判分器自检" in ln]
            tail = tail[-1].strip() if tail else "（自检无输出）"
            red = p.returncode != 0
            print(f"  {'🔴 变红 ✓' if red else '🟢 仍绿 ✗'}  {name}")
            print(f"          {tail}")
            if not red:
                missed.append(name)
    finally:
        if os.path.exists(MUT_PATH):
            os.remove(MUT_PATH)

    ok = len(MUTS) - len(missed)
    print(f"\n反向验证：{ok}/{len(MUTS)} 个变异体被自检抓住")
    if missed:
        print("❌ 以下变异体未被抓住 —— 自检对这段实现是'假覆盖'，必须补用例：")
        for m in missed:
            print(f"   · {m}")
    return 1 if missed else 0


if __name__ == "__main__":
    sys.exit(main())
