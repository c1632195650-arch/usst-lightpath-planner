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
