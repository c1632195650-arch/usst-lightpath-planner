# -*- coding: utf-8 -*-
"""
数据资产确定性门禁（P0，2026-09-19）
====================================
回答一个问题：**520 篇冻结语料库现在还是不是完整的、索引和内容还一致吗？**

四道检查，全部 0 成本、离线、可进 CI：
  ① PRAGMA integrity_check      库结构完整性（B-tree/页校验）
  ② PRAGMA foreign_key_check    外键违约（当前库未声明 FK，恒空 —— 留作未来加 FK 时的护栏）
  ③ FTS5 'integrity-check'      全文索引与内容表一致性（SQLite 官方命令；
                                索引与内容漂移时抛 SQLITE_CORRUPT_VTAB。
                                本库是**常规 FTS5 表**（非外容表），用不带 rank 的形式）
  ④ 行数钉住（pins）            articles(is_dup=0)=520 / articles_fts=515 / chunks=1873
                                钉值存 `data/data_pins.json` —— 改钉值 = 显式 diff，
                                防「数据悄悄少了一半但测试照绿」。

⚠️ 反向验证（本仓库纪律，已实测）：
   - 拷贝库 → 删一行 chunks        → ④ 变红；
   - 拷贝库 → 直接删 articles_fts_content 一行（绕过 FTS）→ ③ 抛 SQLITE_CORRUPT_VTAB。
   两步都在本文件的 docstring 之外由人手工做过（2026-09-19），门禁真的能红。

用法：
  python scripts/gate_data.py                 # 四道检查，异常 exit 1
  python scripts/gate_data.py --db <path>     # 指定库（反向验证用临时副本）
  python scripts/gate_data.py --update-pins   # 数据升级后显式重钉（会改 data_pins.json）
"""
import argparse
import json
import os
import sqlite3
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "usst_articles.db")
PINS_PATH = os.path.join(ROOT, "data", "data_pins.json")

# 钉什么、怎么数（键名 = data_pins.json 的键；SQL 必须与 rag.py build 的口径一致）
PIN_SQL = {
    "articles_is_dup0": "SELECT COUNT(*) FROM articles WHERE is_dup=0",
    "articles_fts": "SELECT COUNT(*) FROM articles_fts",
    "chunks": "SELECT COUNT(*) FROM chunks",
}


def load_pins():
    if not os.path.exists(PINS_PATH):
        return None
    return json.load(open(PINS_PATH, encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser(description="数据资产确定性门禁")
    ap.add_argument("--db", default=DB_PATH, help="指定库路径（反向验证用临时副本）")
    ap.add_argument("--update-pins", action="store_true", help="用当前行数重写 data_pins.json")
    args = ap.parse_args()

    if not os.path.exists(args.db):
        print(f"❌ 数据库不存在：{args.db}")
        return 2

    fails = []

    # ① ② 结构完整性 + 外键（只读语义，用普通连接即可）
    con = sqlite3.connect(args.db)
    cur = con.cursor()

    r = cur.execute("PRAGMA integrity_check").fetchone()[0]
    ok = r == "ok"
    print(f"  {'✅' if ok else '❌'} PRAGMA integrity_check → {r}")
    if not ok:
        fails.append(f"integrity_check={r}")

    fk = cur.execute("PRAGMA foreign_key_check").fetchall()
    ok = len(fk) == 0
    print(f"  {'✅' if ok else '❌'} PRAGMA foreign_key_check → {len(fk)} 处违约")
    if not ok:
        fails.append(f"foreign_key_check 违约 {len(fk)} 处：{fk[:3]}")

    # ③ FTS5 官方一致性命令（会对 FTS 影子表做内部校验写入 → 必须可写连接）
    try:
        cur.execute("INSERT INTO articles_fts(articles_fts) VALUES('integrity-check')")
        print("  ✅ FTS5 integrity-check → 索引与内容一致")
    except sqlite3.DatabaseError as e:
        print(f"  ❌ FTS5 integrity-check → {e}")
        fails.append(f"FTS5 一致性：{e}")

    # ④ 行数钉住
    counts = {k: cur.execute(sql).fetchone()[0] for k, sql in PIN_SQL.items()}
    con.close()

    pins = load_pins()
    if args.update_pins:
        json.dump(counts, open(PINS_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"\n📌 钉值已更新 → {PINS_PATH}")
        pins = counts
    if pins is None:
        print("  ⚠️ 无钉值文件（首次运行？）——请用 --update-pins 生成后再用作门禁")
    else:
        for k, expect in pins.items():
            got = counts.get(k)
            good = got == expect
            print(f"  {'✅' if good else '❌'} 行数钉住 {k} = {got}（钉值 {expect}）")
            if not good:
                fails.append(f"行数钉住 {k}：现值 {got} ≠ 钉值 {expect}")

    print()
    if fails:
        print("🚫 数据门禁未通过：")
        for f in fails:
            print("   ❌", f)
        return 1
    print("✅ 数据门禁全部通过（结构 / 外键 / FTS 一致性 / 行数钉住）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
