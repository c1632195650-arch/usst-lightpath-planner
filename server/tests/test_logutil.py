# -*- coding: utf-8 -*-
"""W10c · log_event 测试（纯 Python）：落盘/字段/异常安全/并发安全。"""
import json
import os
import sys
import tempfile
import threading

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import logutil  # noqa: E402


def run(tmp):
    logutil.LOG_DIR = tmp  # 测试重定向（线程锁/路径模块级，测试串行改安全）
    logutil.LOG_PATH = os.path.join(tmp, "events.jsonl")
    logutil.log_event("chat", "llm_fallback", rid="r1", reason=RuntimeError("boom"))
    logutil.log_event("sync", "tie", n=3)
    lines = [json.loads(l) for l in open(logutil.LOG_PATH, encoding="utf-8")]
    assert len(lines) == 2
    assert lines[0]["module"] == "chat" and lines[0]["event"] == "llm_fallback"
    assert lines[0]["rid"] == "r1"
    assert "boom" in lines[0]["reason"], "异常对象应 repr 化"
    assert lines[1]["n"] == 3 and "ts" in lines[1]
    # 并发安全：8 线程 × 25 条 → 200 行无交错损坏
    def spam():
        for i in range(25):
            logutil.log_event("t", "spam", i=i)
    threads = [threading.Thread(target=spam) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    total = sum(1 for _ in open(logutil.LOG_PATH, encoding="utf-8"))
    assert total == 202, f"并发丢行/交错：{total}"
    for l in open(logutil.LOG_PATH, encoding="utf-8"):
        json.loads(l)  # 每行都是合法 JSON（无半行交错）
    # 永不抛：把路径改成目录炸弹
    logutil.LOG_PATH = os.path.join(tmp, "not_exist_dir_should_not_crash", "x.jsonl")
    logutil.LOG_DIR = os.path.join(tmp, "not_exist_dir_should_not_crash")
    logutil.LOG_PATH = os.path.join(logutil.LOG_DIR, os.path.join(tmp, "a_file"), "x.jsonl")
    os.makedirs(os.path.join(tmp, "a_file"), exist_ok=True)
    logutil.log_event("t", "never_crash")  # 应静默通过
    print("✓ W10c log_event：落盘/repr/并发200行全JSON/永不抛")


if __name__ == "__main__":
    run(tempfile.mkdtemp())
