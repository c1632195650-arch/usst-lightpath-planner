# -*- coding: utf-8 -*-
"""
F2 · 梨宝回答置信度四态分级测试（纯 Python 断言，环境无 pytest 且禁装依赖）
================================================================================
只测 server/confidence.py 纯函数（零重依赖，不拉起 fastapi/rag，不碰任何 db）。
运行：.venv/Scripts/python.exe server/tests/test_chat_confidence.py
RV（反向验证）由执行会话人工做一次：改坏 compute_confidence 的映射分支 →
本测试必须变红（实测记录见 BLOCKERS），证明断言真的咬住了实现。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from confidence import compute_confidence, compute_kb  # noqa: E402


def test_empty_is_none():
    assert compute_confidence("empty", "", None, 0)["level"] == "none"


def test_template_and_space_are_structured():
    assert compute_confidence("grounded", "template", None, 0)["level"] == "structured"
    assert compute_confidence("hybrid", "llm", None, 0, used_space=True)["level"] == "structured"


def test_method_and_health_kb_are_structured():
    assert compute_confidence("hybrid", "llm", None, 0, used_study=True)["level"] == "structured"
    assert compute_confidence("llm", "llm", None, 0, used_health=True)["level"] == "structured"
    assert compute_confidence("llm", "llm", None, 0, study_pseudo=True)["level"] == "structured"


def test_grounded_with_gate_ok_is_cited():
    assert compute_confidence("grounded", "llm", "ok", 3)["level"] == "cited"


def test_grounded_gate_unavailable_still_cited():
    # 门不可用（无 Key/超时）但 grounded 强命中 —— 依据仍在，如实算有据
    assert compute_confidence("grounded", "llm", None, 2)["level"] == "cited"


def test_hybrid_is_inferred():
    # hybrid = 官方资讯 + LLM 常识混合 —— 即使门判相关也诚实标注"部分为推断"
    assert compute_confidence("hybrid", "llm", "ok", 4)["level"] == "inferred"


def test_downgraded_is_never_cited():
    # 门判假命中降级 llm：即使 extractive 抽到原文也不给"有据"
    assert compute_confidence("llm", "extractive", "irrelevant_downgraded", 2)["level"] == "inferred"


def test_extractive_without_downgrade_is_cited():
    assert compute_confidence("grounded", "extractive", None, 3)["level"] == "cited"


def test_no_sources_is_none_unless_tools():
    assert compute_confidence("llm", "llm", None, 0)["level"] == "none"
    # agent 动用过自查工具（poi/联网）→ 至少是"推断"，不冒充有据也不装没有
    assert compute_confidence("llm", "llm", None, 0, tools_used=True)["level"] == "inferred"


def test_kb_marker_priority():
    assert compute_kb(True, True, True) == "space"
    assert compute_kb(False, True, True) == "method"
    assert compute_kb(False, False, True) == "health"
    assert compute_kb(False, False, False) == "none"


TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]

if __name__ == "__main__":
    failed = 0
    for t in TESTS:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e or 'assertion failed'}")
    if failed:
        print(f"{failed}/{len(TESTS)} FAILED")
        sys.exit(1)
    print(f"ALL PASS ({len(TESTS)} tests)")
