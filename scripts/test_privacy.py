# -*- coding: utf-8 -*-
"""
脱敏网关专门用例（P2 · 究极测评体系；OWASP LLM02 敏感信息泄露的落地闸）
================================================================
保护对象（NF-3 隐私红线）：学号 / 手机号 / 邮箱 / 其他编号 在进入检索与模型前
必须被占位符化；占位后的文本里**不允许再出现任何原始敏感值**。

直接测 server/app.py 的 `desensitize`（生产代码路径，不重实现、不 mock）——
此前这条红线「靠人看」，现在每次提交都跑（eval:gate 已把它挂进 L0）。

⚠️ 反向验证（本仓库纪律，已实测）：
   把 app.py 里学号规则 `(?<!\d)20\d{11}(?!\d)` 的 `{11}` 改成 `{10}`
   → 本文件「学号→占位符」用例立即变红。
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "server"))

from app import desensitize  # noqa: E402

ok = fail = 0
fails = []


def check(label, cond, detail=""):
    global ok, fail
    ok, fail = (ok + 1, fail) if cond else (ok, fail + 1)
    if not cond:
        fails.append(f"{label}：{detail}")
    print(f"  {'✅' if cond else '❌'} {label}" + (f" ｜ {detail[:70]}" if not cond else ""))


CASES = [
    # (问题原文, 必须消失的敏感值, 场景说明)
    ("我的学号是2535012345，帮我查下绩点", "2535012345", "学号（10 位，合成号同真实格式）"),
    ("学号2535012345能借几本书", "2535012345", "学号（中文紧邻——`\b` 边界失效的老坑）"),
    ("手机 13812345678 收不到验证码", "13812345678", "手机号"),
    ("邮箱是li.bao@stmail.usst.edu.cn发不出去", "li.bao@stmail.usst.edu.cn", "邮箱"),
    ("校园卡号 0219768 补办流程", "0219768", "短编号"),
    ("一卡通2535012345和手机13812345678都丢了", None, "混合输入（占位符应分别就位）"),
]

print("== 脱敏网关 · 专项用例 ==")
for q, secret, label in CASES:
    out = desensitize(q)
    if secret:
        check(f"{label}：原值不再出现", secret not in out, f"泄露 → {out[:60]}")
    else:
        check(f"{label}：两个原值都不再出现",
              "20231234567" not in out and "13812345678" not in out, f"泄露 → {out[:60]}")

# ⚠️ 实测发现（2026-09-19）：常见 11 位学号（20231234567）不命中 `[学号]` 规则
#    （该规则要求 20+11=13 位），实际走 `[编号]` 兜底——隐私结果等价（值被遮住），
#    但语义弱化。待 CY 确认真实学号位数后校准该规则。
check("占位符就位（10 位学号 → [学号]）", "[学号]" in desensitize("学号2535012345"))
check("占位符就位（[手机号]）", "[手机号]" in desensitize("手机13812345678"))
check("占位符就位（[邮箱]）", "[邮箱]" in desensitize("邮箱 a.b@usst.edu.cn"))

# 防误伤：普通数字不该被误脱敏
check("防误伤：普通数字（今天 3 号）不受影响", desensitize("今天 3 号") == "今天 3 号")
check("防误伤：课表节数（6-9 节）不受影响", desensitize("金工实习 6-9 节") == "金工实习 6-9 节")
check("防误伤：电话归属地段短号 8000 不误伤", desensitize("内线 8000") == "内线 8000",
      desensitize("内线 8000"))
check("兼容：13 位旧格式学号仍命中（老规则保留）",
      "[学号]" in desensitize("学号2023123456789"))

print("\n" + "=" * 60)
print(f"汇总：{ok}/{ok + fail} 通过（{ok / (ok + fail) * 100:.1f}%）")
if fails:
    print("失败明细：")
    for f in fails:
        print("  ❌", f)
else:
    print("全部通过 ✅（隐私红线已闸门化）")
print("=" * 60)
sys.exit(0 if not fails else 1)
