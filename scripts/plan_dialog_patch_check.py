# -*- coding: utf-8 -*-
"""批 1.2 · server 侧 weekNo 白名单自检（不进 gate，批内手工跑）。

用法：python scripts/plan_dialog_patch_check.py
断言 _clean_patch 保留合法 weekNo、丢弃越界值；模块可导入（不起服务）。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

import plan_dialog  # noqa: E402

# 合法 weekNo 保留
out = plan_dialog._clean_patch({"weekNo": 10, "weekday": 5, "title": "开题报告"})
assert out.get("weekNo") == 10, out
assert out.get("weekday") == 5, out
assert out.get("title") == "开题报告", out

# 越界丢弃：0 / 31 / 负数 / 非数字
for bad in (0, 31, -3, "abc", None):
    out = plan_dialog._clean_patch({"weekNo": bad})
    assert "weekNo" not in out, f"weekNo={bad!r} 应被丢弃，实际 {out}"

# 小数取整
out = plan_dialog._clean_patch({"weekNo": 10.0})
assert out.get("weekNo") == 10, out

print("[plan_dialog_patch_check] all assertions passed: weekNo whitelist 1-30 OK")

# ---- 批次 1（交互升级方案 4.1）：startMin / endMin 白名单 ----
out = plan_dialog._clean_patch({"startMin": 1080, "endMin": 1200})
assert out.get("startMin") == 1080, out
assert out.get("endMin") == 1200, out

# 边界与越界：0/1440 合法，负数/超界/非数字丢弃
out = plan_dialog._clean_patch({"startMin": 0, "endMin": 1440})
assert out.get("startMin") == 0, out
assert out.get("endMin") == 1440, out
for bad in (-1, 1441, 2400, "abc", None):
    out = plan_dialog._clean_patch({"startMin": bad, "endMin": bad})
    assert "startMin" not in out and "endMin" not in out, f"startMin/endMin={bad!r} 应被丢弃，实际 {out}"

out = plan_dialog._clean_patch({"startMin": 1079.7})
assert out.get("startMin") == 1079, out

print("[plan_dialog_patch_check] startMin/endMin whitelist 0-1440 OK")

# ---- S2b（2026-10-07）：自然计划陈述 → new_intent(create) 的离线用例 ----
# 口径（_SYSTEM_DIALOG 易混边界）：「我明天打算去吃大餐」这类第一人称自然陈述
# 应被对话管理器判成 new_intent(intent=create)，绝不落 chit_chat（无 topic 也一样）。
# 代码层可断言的部分：_clean_dialog 对该 act/args 形态放行（patch 槽位全保留），
# 且无 topic 状态下不因状态对账误杀。
clean = plan_dialog._clean_dialog(
    {
        "act": "new_intent",
        "args": {
            "intent": "create",
            "patch": {"title": "吃大餐", "relativeDays": 1},
        },
        "reply_note": "听出来你要安排周六的大餐，我来排",
        "confidence": 0.9,
    },
    {"topic": None, "missStreak": 0},
)
assert clean is not None, "new_intent(create) 自然陈述在无 topic 下必须放行"
assert clean["act"] == "new_intent"
assert clean["args"]["intent"] == "create"
assert clean["args"]["patch"]["title"] == "吃大餐"
assert clean["args"]["patch"]["relativeDays"] == 1
print("[plan_dialog_patch_check] S2b natural-plan new_intent(create) passthrough OK")
