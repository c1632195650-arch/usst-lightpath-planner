# -*- coding: utf-8 -*-
"""
DB 层同文去重（软合并）
=========================
把多号转载的同一篇文章在数据库层合并：聚类后每组保留一个「主条目」，
其余标记 is_dup=1、dup_of=主条目 id（软删除，不物理删行，可回退审计）。

主条目选择规则：
    1. 官方号「上海理工大学」优先；
    2. 否则全文最长（信息最全）优先。

用法：
    python scripts/dedup_db.py [相似度阈值，默认 0.82]

执行后需重建索引：python scripts/rag.py build
"""
import os, re, sys, sqlite3
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rag import _similar  # 复用检索层的标题相似度

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "..", "data", "usst_articles.db")
LOG_PATH = os.path.join(BASE, "..", "data", "dedup_log.txt")

OFFICIAL = "上海理工大学"


def cluster(rows, threshold):
    """O(n²) 贪心聚类：把标题相似度 >= threshold 的归为一组"""
    groups, used = [], set()
    for i in range(len(rows)):
        if rows[i][0] in used:
            continue
        grp = [rows[i]]
        used.add(rows[i][0])
        for j in range(i + 1, len(rows)):
            if rows[j][0] in used:
                continue
            if _similar(rows[i][2], rows[j][2]) >= threshold:
                grp.append(rows[j])
                used.add(rows[j][0])
        if len(grp) > 1:
            groups.append(grp)
    return groups


def pick_primary(group):
    """选主条目：官方号优先，其次全文最长"""
    official = [r for r in group if r[1] == OFFICIAL]
    if official:
        return max(official, key=lambda r: r[4] or 0)
    return max(group, key=lambda r: r[4] or 0)


def main():
    threshold = float(sys.argv[1]) if len(sys.argv) > 1 else 0.82
    conn = sqlite3.connect(DB_PATH)

    # 加字段
    cols = {r[1] for r in conn.execute("PRAGMA table_info(articles)")}
    if "is_dup" not in cols:
        conn.execute("ALTER TABLE articles ADD COLUMN is_dup INTEGER DEFAULT 0")
    if "dup_of" not in cols:
        conn.execute("ALTER TABLE articles ADD COLUMN dup_of INTEGER")
    conn.commit()

    # 先清零（幂等：可重复跑）
    conn.execute("UPDATE articles SET is_dup=0, dup_of=NULL")
    conn.commit()

    # rows: (id, account, title, pub_time, full_len)
    rows = conn.execute(
        "SELECT id, account, title, pub_time, length(full_text) FROM articles ORDER BY id"
    ).fetchall()

    groups = cluster(rows, threshold)
    if not groups:
        print("未发现重复组，无需合并。")
        conn.close()
        return

    log = [f"# DB 层同文去重日志 ({datetime.now().strftime('%Y-%m-%d %H:%M')}) · 阈值 {threshold}\n"]
    merged = 0
    for gi, g in enumerate(groups, 1):
        primary = pick_primary(g)
        dups = [r for r in g if r[0] != primary[0]]
        log.append(f"\n## 组 {gi} · 主条目 id={primary[0]}「{primary[2][:36]}」({primary[1]})")
        for d in dups:
            conn.execute("UPDATE articles SET is_dup=1, dup_of=? WHERE id=?", (primary[0], d[0]))
            merged += 1
            log.append(f"  - 合并 id={d[0]}「{d[2][:36]}」({d[1]}, {d[3]}) → id={primary[0]}")

    conn.commit()

    # 导出日志
    with open(LOG_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(log) + "\n")

    remain = conn.execute("SELECT count(*) FROM articles WHERE is_dup=0").fetchone()[0]
    total = conn.execute("SELECT count(*) FROM articles").fetchone()[0]
    print(f"共 {len(groups)} 组重复，标记 {merged} 篇为重复（is_dup=1）。")
    print(f"主条目 {remain} 篇 / 总 {total} 篇。日志已写 {LOG_PATH}")
    conn.close()


if __name__ == "__main__":
    main()
