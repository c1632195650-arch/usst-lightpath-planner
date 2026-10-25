# -*- coding: utf-8 -*-
"""W4 · refresh_pins 防三犯测试（纯 Python，无 pytest 依赖）
=================================================================
三条：
  ① 真值函数：临时库造数（主条目/FTS/chunks 各异值）→ refresh_pins →
     data_pins.json 三键与库真值逐项相等（幂等：跑两次不变）；
  ② 旧 pins 过期 → 一次 refresh_pins 即对齐（防三犯场景复现）；
  ③ approve 路径委托：review_queue.update_pins 直接产出真值（不再增量推算）。
RV 口径：refresh_pins 的 chunks 计数改写死 0 → ①②恰红（摘调用等效）。
"""
import json
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rag import refresh_pins  # noqa: E402

SCHEMA = """
CREATE TABLE articles (id INTEGER PRIMARY KEY, is_dup INTEGER DEFAULT 0);
CREATE TABLE articles_fts (rowid INTEGER);
CREATE TABLE chunks (id INTEGER PRIMARY KEY);
"""


def make_db(tmp, main, fts, chunks, dup=3):
    db = os.path.join(tmp, "t.db")
    c = sqlite3.connect(db)
    c.executescript(SCHEMA)
    c.execute(f"INSERT INTO articles(id,is_dup) VALUES(1,0)")
    for _ in range(dup):
        c.execute("INSERT INTO articles(id,is_dup) VALUES(NULL,1)")
    for _ in range(main - 1):
        c.execute("INSERT INTO articles(id,is_dup) VALUES(NULL,0)")
    for _ in range(fts):
        c.execute("INSERT INTO articles_fts(rowid) VALUES(NULL)")
    for _ in range(chunks):
        c.execute("INSERT INTO chunks(id) VALUES(NULL)")
    c.commit()
    c.close()
    return db


def read_pins(db):
    p = os.path.join(os.path.dirname(db), "data_pins.json")
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def test_truth_and_idempotent():
    tmp = tempfile.mkdtemp()
    db = make_db(tmp, main=7, fts=6, chunks=1937)
    out = refresh_pins(db)
    assert out == {"articles_is_dup0": 7, "articles_fts": 6, "chunks": 1937}, out
    pins = read_pins(db)
    assert pins == out, f"文件与返回不一致：{pins}"
    refresh_pins(db)  # 幂等
    assert read_pins(db) == out, "二次运行漂移"
    print("✓ 真值+幂等：7/6/1937 三键逐项相等，二次不变")


def test_stale_pins_healed():
    tmp = tempfile.mkdtemp()
    db = make_db(tmp, main=531, fts=526, chunks=2046)
    p = os.path.join(os.path.dirname(db), "data_pins.json")
    with open(p, "w", encoding="utf-8") as f:  # 人为过期（防三犯场景：库里已重建、pins 停旧值）
        json.dump({"articles_is_dup0": 520, "articles_fts": 515, "chunks": 1873}, f)
    refresh_pins(db)
    assert read_pins(db)["chunks"] == 2046, "过期 chunks 未被治愈"
    print("✓ 过期治愈：1873→2046 一次对齐")


def test_approve_path_delegates():
    from review_queue import update_pins
    tmp = tempfile.mkdtemp()
    db = make_db(tmp, main=9, fts=8, chunks=100)
    update_pins(db, "skip", main_inserted=1, fts_inserted=1)  # 旧增量路径场景
    pins = read_pins(db)
    assert pins == {"articles_is_dup0": 9, "articles_fts": 8, "chunks": 100}, pins
    print("✓ approve 委托：update_pins 恒产真值（不再 +1 推算）")


if __name__ == "__main__":
    test_truth_and_idempotent()
    test_stale_pins_healed()
    test_approve_path_delegates()
    print("\nW4 refresh_pins 三条全过")
