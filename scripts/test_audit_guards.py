# -*- coding: utf-8 -*-
"""批1 防再犯三小修 · 守卫测试（2026-10-25 全量审计批）
====================================================
覆盖三个「防再犯」结构：
  ① rag.rebuild_vectors —— 向量单独重建的唯一正规入口，尾部强制 refresh_pins
     （四次 pins 漂移的根因是手工向量重建绕过一切写点收口；本测钉死「重建必刷 pins」）；
  ② fact_probe._guard_base —— 探针防呆：非本机/8000 端口拒绝，FACT_PROBE_ALLOW=1 逃生门
     （两次探针污染生产记忆库教训）；
  ③ migrate_effective_to._assert_backup_ok —— VACUUM INTO 备份自证
     （integrity_check + 逐表行数一致 + 体积>0；假备份教训通用化）。
RV：①删 refresh_pins 调用 → pins 文件缺失恰红；②摘端口闸 → 8000 用例恰红；
    ③摘行数断言 → 漂移用例恰红。
"""
import json
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import rag  # noqa: E402
from fact_probe import _guard_base  # noqa: E402
from migrate_effective_to import _assert_backup_ok  # noqa: E402


def _mk_articles_db(db):
    conn = sqlite3.connect(db)
    conn.execute("""CREATE TABLE articles(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account TEXT NOT NULL, title TEXT, full_text TEXT, summary TEXT,
        is_dup INTEGER DEFAULT 0, low_value INTEGER DEFAULT 0)""")
    conn.execute("INSERT INTO articles(account,title,full_text,is_dup,low_value) VALUES('a','图书馆开放时间','正文正文正文',0,0)")
    conn.execute("INSERT INTO articles(account,title,full_text,is_dup,low_value) VALUES('a','转载重复','重复正文',1,0)")
    conn.commit()
    conn.close()


def test_rebuild_vectors_refreshes_pins():
    tmp = tempfile.mkdtemp()
    db = os.path.join(tmp, "t.db")
    _mk_articles_db(db)
    # 嵌入函数替身（不加载 fastembed 模型）——4 维零向量即可走通落库路径
    rag.embed_docs = lambda docs, batch_size=32: [[0.0, 0.1, 0.2, 0.3] for _ in docs]
    rag.rebuild_vectors(db)
    conn = sqlite3.connect(db)
    n = conn.execute("SELECT count(*) FROM chunks").fetchone()[0]
    conn.close()
    assert n >= 1, "向量应已写入"
    pins_path = os.path.join(tmp, "data_pins.json")
    assert os.path.exists(pins_path), "rebuild_vectors 必须刷新 pins（RV：摘 refresh_pins 调用 → 此行恰红）"
    pins = json.load(open(pins_path, encoding="utf-8"))
    assert pins["chunks"] == n, f"pins.chunks 应等于真值 {n}：{pins}"
    assert pins["articles_is_dup0"] == 1, f"is_dup0 真值 1：{pins}"
    # 幂等：再跑一次 pins 不变
    rag.rebuild_vectors(db)
    pins2 = json.load(open(pins_path, encoding="utf-8"))
    assert pins2 == pins, "二次重建 pins 应不变（幂等）"
    print("✓ ① rebuild_vectors：向量重建 → pins 随真值刷新（幂等）")


def test_guard_base():
    _guard_base("http://127.0.0.1:8013")  # 本机自定义端口：放行
    _guard_base("http://localhost:8013")
    for bad in ("http://127.0.0.1:8000",   # 默认生产端口形状（本机也拦）
                "http://43.142.141.186/",   # 非本机
                "https://x.edu.cn"):        # 非本机（https 无端口 → 443）
        try:
            _guard_base(bad)
            raise AssertionError(f"应被防呆拦截：{bad}")
        except SystemExit:
            pass
    # 逃生门：显式豁免放行（并输出大字提醒）
    os.environ["FACT_PROBE_ALLOW"] = "1"
    try:
        _guard_base("http://127.0.0.1:8000")
    finally:
        os.environ.pop("FACT_PROBE_ALLOW", None)
    print("✓ ② 探针防呆：8000/非本机拒绝 + FACT_PROBE_ALLOW=1 逃生门")


def test_assert_backup_ok():
    tmp = tempfile.mkdtemp()
    db = os.path.join(tmp, "src.db")
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE articles(id INTEGER PRIMARY KEY, t TEXT)")
    conn.executemany("INSERT INTO articles(t) VALUES(?)", [("a",), ("b",), ("c",)])
    conn.execute("CREATE TABLE misc(k TEXT)")
    conn.executemany("INSERT INTO misc(k) VALUES(?)", [("x",), ("y",)])
    conn.commit()
    conn.close()
    good = os.path.join(tmp, "good.db")
    src = sqlite3.connect(db)
    src.execute(f"VACUUM INTO '{good}'")
    src.close()
    _assert_backup_ok(db, good)  # 真备份：过

    empty = os.path.join(tmp, "empty.db")
    open(empty, "wb").close()
    try:
        _assert_backup_ok(db, empty)
        raise AssertionError("0 字节假备份应被拦")
    except AssertionError:
        pass

    garbage = os.path.join(tmp, "garbage.db")
    with open(garbage, "wb") as f:
        f.write(b"not a sqlite file at all........")
    try:
        _assert_backup_ok(db, garbage)
        raise AssertionError("垃圾文件假备份应被拦")
    except AssertionError:
        pass

    drift = os.path.join(tmp, "drift.db")
    src = sqlite3.connect(db)
    src.execute(f"VACUUM INTO '{drift}'")
    src.close()
    d = sqlite3.connect(drift)
    d.execute("DELETE FROM articles WHERE id=3")
    d.commit()
    d.close()
    try:
        _assert_backup_ok(db, drift)
        raise AssertionError("行数漂移备份应被拦（RV：摘行数断言 → 此用例恰红）")
    except AssertionError as e:
        assert "行数漂移" in str(e), f"应报行数漂移：{e}"
    print("✓ ③ 备份自证：真备份过 / 0字节·垃圾·行数漂移三类假备份全拦")


if __name__ == "__main__":
    test_rebuild_vectors_refreshes_pins()
    test_guard_base()
    test_assert_backup_ok()
    print("\n批1 防再犯三小修守卫全过")
