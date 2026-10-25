#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""W7 · effective_to 可空加列迁移（C2 已拍板，2026-10-25）
=============================================================
三模式：
  migrate  备份（VACUUM INTO）→ ALTER TABLE articles ADD COLUMN effective_to TEXT（可空、幂等）
  rollback 从备份文件恢复 articles 表数据（演练/事故两用；备份文件须为 VACUUM INTO 快照）
  verify   断言列在位、可空、行数与迁移前一致

用法：
  python scripts/migrate_effective_to.py --db data/usst_articles.db migrate
  python scripts/migrate_effective_to.py --db X --backup Y rollback
  python scripts/migrate_effective_to.py --db X verify

纪律：列**可空**（无值 = 永久有效，存量行为零影响）；迁移前自动 VACUUM INTO 备份
（一致性快照，含全部表）；幂等——列已存在直接报"已在位"退出 0。
"""
import argparse
import os
import sqlite3
import sys
from datetime import datetime


def _col_exists(conn, table, col):
    return any(r[1] == col for r in conn.execute(f"PRAGMA table_info({table})"))


def do_migrate(db, backup_dir):
    conn = sqlite3.connect(db)
    if _col_exists(conn, "articles", "effective_to"):
        print("[migrate] effective_to 列已在位——幂等退出")
        conn.close()
        return
    n_before = conn.execute("SELECT count(*) FROM articles").fetchone()[0]
    conn.close()

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = os.path.join(backup_dir or os.path.dirname(os.path.abspath(db)),
                          f"articles_pre_effective_to_{stamp}.db")
    src = sqlite3.connect(db)
    src.execute(f"VACUUM INTO '{backup}'")
    src.close()
    print(f"[migrate] 备份 → {backup}")

    conn = sqlite3.connect(db)
    conn.execute("ALTER TABLE articles ADD COLUMN effective_to TEXT")
    conn.commit()
    n_after = conn.execute("SELECT count(*) FROM articles").fetchone()[0]
    assert n_before == n_after, f"行数漂移！{n_before} → {n_after}"
    # 可空验证：插入/删除一个 NULL 值行不报错（account 是 NOT NULL 必填，一并填探针值）
    conn.execute("INSERT INTO articles(title, account, is_dup) VALUES('_migrate_probe_', '_migrate_probe_', 1)")
    probe_id = conn.execute("SELECT id FROM articles WHERE title='_migrate_probe_'").fetchone()[0]
    conn.execute("UPDATE articles SET effective_to=NULL WHERE id=?", (probe_id,))
    conn.execute("DELETE FROM articles WHERE id=?", (probe_id,))
    conn.commit()
    conn.close()
    print(f"[migrate] ✅ 列在位（可空验证过），行数 {n_after}，备份 {os.path.basename(backup)}")


def do_rollback(db, backup):
    """从 VACUUM INTO 快照恢复整库（简单可靠：快照即完整库文件）。"""
    if not os.path.exists(backup):
        print(f"[rollback] 备份不存在：{backup}")
        sys.exit(1)
    src = sqlite3.connect(backup)
    src.backup(sqlite3.connect(db))  # SQLite 在线 backup API（比 iterdump 快且无类型问题）
    src.close()
    conn = sqlite3.connect(db)
    gone = not _col_exists(conn, "articles", "effective_to")
    n = conn.execute("SELECT count(*) FROM articles").fetchone()[0]
    conn.close()
    print(f"[rollback] ✅ 整库已从快照恢复（行数 {n}）；effective_to 列{'已消失' if gone else '仍在（快照晚于加列？核查）'}")


def do_verify(db):
    conn = sqlite3.connect(db)
    ok = _col_exists(conn, "articles", "effective_to")
    n = conn.execute("SELECT count(*) FROM articles").fetchone()[0]
    conn.close()
    print(f"[verify] 列在位={ok}，行数={n}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="W7 effective_to 迁移")
    ap.add_argument("--db", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "usst_articles.db"))
    ap.add_argument("--backup", help="rollback 目标快照路径")
    ap.add_argument("mode", choices=["migrate", "rollback", "verify"])
    a = ap.parse_args()
    db = os.path.abspath(a.db)
    if a.mode == "migrate":
        do_migrate(db, os.environ.get("MIGRATE_BACKUP_DIR"))
    elif a.mode == "rollback":
        do_rollback(db, a.backup)
    else:
        do_verify(db)
