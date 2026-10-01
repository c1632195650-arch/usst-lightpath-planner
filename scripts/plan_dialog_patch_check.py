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
