# -*- coding: utf-8 -*-
"""
F1 · 人工审核队列 CLI（list / show / approve / reject）
======================================================
crawl_cron.py 把新采到的条目放进 data/pending_review.jsonl（jsonl，零 DB 迁移），
本 CLI 是**唯一入库口**：人工过目后 approve 才写 articles 表并重建检索索引。

子命令：
  python scripts/review_queue.py list [--queue PATH]
  python scripts/review_queue.py show <id> [--queue PATH]
  python scripts/review_queue.py approve <id> [--db PATH] [--queue PATH] [--no-index]
  python scripts/review_queue.py reject <id> [--queue PATH]

approve 流程（工单 F1 步骤 4）：
  复用 dedup_db.cluster/pick_primary 做标题级同文去重 + clean_text 做引流清洗
  → 写入 articles 表（字段按库 schema 填齐，keyword/source 填源清单）
  → 重建检索索引 → 更新 data/data_pins.json 计数

退出码：
  0 成功（含 --no-index / reject / show / list）
  1 条目不存在等参数错误
  2 标题命中软广过滤，拒绝写入（条目保留在队列，等人工 reject）
  3 索引未能自动重建 —— 需人工执行 python scripts/rag.py build（特殊提醒码）
  4 自动重建子进程执行失败 —— 同样需人工执行 python scripts/rag.py build
"""
import argparse
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
if BASE not in sys.path:
    sys.path.insert(0, BASE)

import dedup_db            # noqa: E402  复用 cluster / pick_primary（标题级同文去重）
import gate_data           # noqa: E402  复用 PIN_SQL（钉值口径与门禁严格一致）
import rag                 # noqa: E402  复用 seg()（jieba 分词口径）与 FTS 表 schema
from clean_text import clean_ad_tails, is_ad_title, is_low_value_title  # noqa: E402

ROOT = os.path.dirname(BASE)
DEFAULT_DB = os.path.join(ROOT, "data", "usst_articles.db")
DEFAULT_QUEUE = os.path.join(ROOT, "data", "pending_review.jsonl")

# 与 scripts/rag.py build() 的 DDL 逐字一致（build 全量重建会 DROP 后按同 DDL 重建，增量行天然兼容）
FTS_DDL = ("CREATE VIRTUAL TABLE articles_fts "
           "USING fts5(account, title, seg_text, tokenize='unicode61')")

EXIT_OK, EXIT_ERR, EXIT_AD, EXIT_MANUAL, EXIT_BUILD_FAIL = 0, 1, 2, 3, 4


# ---------- 队列 IO ----------

def load_queue(queue_path):
    """读队列 → [(原始行, 解析对象或 None)]；坏行原样保留不丢数据"""
    if not os.path.exists(queue_path):
        return []
    out = []
    with open(queue_path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n").rstrip("\r")
            if not line.strip():
                continue
            try:
                out.append((line, json.loads(line)))
            except Exception:
                out.append((line, None))
    return out


def save_queue(queue_path, entries):
    """整文件重写（原子替换），显式 newline='\n'（本仓全仓 LF 约定）"""
    d = os.path.dirname(os.path.abspath(queue_path))
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = queue_path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        for raw, _it in entries:
            f.write(raw + "\n")
    os.replace(tmp, queue_path)


def find_entry(entries, item_id):
    for raw, it in entries:
        if it and it.get("id") == item_id:
            return raw, it
    return None


def drop_entry(entries, item_id):
    return [(raw, it) for raw, it in entries
            if not (it and it.get("id") == item_id)]


# ---------- 库 schema / FTS ----------

def ensure_articles_schema(conn):
    """确保 articles 表及全部扩展列存在（与 collector/collect_web/dedup_db 的最终 schema 一致）。

    生产库早已齐列 → 全部 no-op；测试用临时空库 → 一次建齐。
    """
    conn.execute("""
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT,
            pub_time TEXT,
            source_url TEXT,
            crawled_at TEXT,
            full_text TEXT,
            resolved_url TEXT,
            full_text_at TEXT,
            seg_text TEXT,
            is_dup INTEGER DEFAULT 0,
            dup_of INTEGER,
            low_value INTEGER DEFAULT 0,
            keyword TEXT,
            source TEXT,
            UNIQUE(account, title)
        )
    """)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(articles)")}
    for col, ddl in [("full_text", "TEXT"), ("resolved_url", "TEXT"),
                     ("full_text_at", "TEXT"), ("seg_text", "TEXT"),
                     ("is_dup", "INTEGER DEFAULT 0"), ("dup_of", "INTEGER"),
                     ("low_value", "INTEGER DEFAULT 0"), ("keyword", "TEXT"),
                     ("source", "TEXT")]:
        if col not in cols:
            conn.execute(f"ALTER TABLE articles ADD COLUMN {col} {ddl}")
    conn.commit()


def ensure_fts(conn):
    """articles_fts 不存在时按 rag.build 同款 DDL 创建（独立 FTS5 表，rowid=article id）"""
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='articles_fts'"
    ).fetchone()
    if not row:
        conn.execute(FTS_DDL)


def is_default_db(db_path):
    """目标库是否就是 rag.py 默认的生产库（决定能否安全代跑 rag.py build）"""
    default_db = os.path.abspath(os.path.join(ROOT, "data", "usst_articles.db"))
    a = os.path.normcase(os.path.abspath(db_path))
    b = os.path.normcase(default_db)
    if a == b:
        return True
    try:
        return os.path.samefile(a, b)
    except OSError:
        return False


# ---------- 钉值 ----------

def update_pins(db_path, rebuild_status, main_inserted, fts_inserted):
    """approve 后更新库旁的 data_pins.json（W4：统一走 rag.refresh_pins 真值函数）。

    旧实现是「增量推算」（main_inserted +1 / fts_inserted +1），与真值漂移过两次
    （2026-10-24/25 同根因实录）——W4 防三犯收编：approve 路径与 build 路径都调
    rag.refresh_pins（数三表覆盖写），幂等且恒等于库真值。增量参数保留签名兼容，
    仅用于打印说明。
    """
    from rag import refresh_pins  # 局部导入避免环（rag 不依赖本模块）
    pins = refresh_pins(db_path)
    if rebuild_status != "ok":
        print(f"📌（重建状态 {rebuild_status}，pins 已按库真值刷新；本批主表 +{main_inserted}/FTS +{fts_inserted}）")
    else:
        print(f"📌 data_pins.json 已按真值更新：{pins}")


# ---------- 子命令 ----------

def cmd_list(queue_path):
    entries = load_queue(queue_path)
    items = [it for _raw, it in entries if it]
    bad = len(entries) - len(items)
    print(f"待审 {len(items)} 条" + (f"（另有 {bad} 行无法解析的原样保留）" if bad else ""))
    for it in items:
        title = it.get("title") or ""
        print(f"  {it.get('id','?')}  [{it.get('source_type','?')}/{it.get('account','?')}]  "
              f"{it.get('pub_time') or '—'}  {title[:44]}")
    return EXIT_OK


def cmd_show(queue_path, item_id):
    hit = find_entry(load_queue(queue_path), item_id)
    if not hit:
        print(f"队列中没有 id={item_id}")
        return EXIT_ERR
    print(json.dumps(hit[1], ensure_ascii=False, indent=2))
    return EXIT_OK


def cmd_reject(queue_path, item_id):
    entries = load_queue(queue_path)
    hit = find_entry(entries, item_id)
    if not hit:
        print(f"队列中没有 id={item_id}")
        return EXIT_ERR
    save_queue(queue_path, drop_entry(entries, item_id))
    print(f"🚫 已拒绝并移出队列：「{hit[1].get('title','')}」（不写入 articles 表）")
    return EXIT_OK


def cmd_approve(db_path, queue_path, item_id, no_index=False):
    entries = load_queue(queue_path)
    hit = find_entry(entries, item_id)
    if not hit:
        print(f"队列中没有 id={item_id}")
        return EXIT_ERR
    _raw, item = hit

    title = (item.get("title") or "").strip()
    if is_ad_title(title):
        print(f"❌ 标题命中软广过滤，拒绝写入（条目保留在队列，可人工 reject）：{title}")
        return EXIT_AD

    account = (item.get("account") or "").strip() or (item.get("source_type") or "")
    source_type = item.get("source_type") or ""
    summary = (item.get("summary") or "").strip()
    pub_time = (item.get("pub_time") or "").strip() or None
    source_url = (item.get("source_url") or "").strip()
    # 合规缺省（工单）：公众号源只存标题+摘要+链接，队列行不携带正文 → full_text 置空，
    # 事后由 scripts/fulltext.py 补采；清洗函数照常过一遍，正文通道打开后自动生效。
    full_text = clean_ad_tails("")

    conn = sqlite3.connect(db_path)
    ensure_articles_schema(conn)

    # UNIQUE(account, title) 防线：同源同题已入库 → 只移出队列
    exist = conn.execute(
        "SELECT id FROM articles WHERE account=? AND title=?", (account, title)
    ).fetchone()
    if exist:
        conn.close()
        save_queue(queue_path, drop_entry(entries, item_id))
        print(f"库中已有同源同题条目 id={exist[0]}，视为已入库，仅移出队列。")
        return EXIT_OK

    # 标题级同文去重：复用 dedup_db.cluster / pick_primary（与 DB 批量去重同一套判定，阈值 0.82）
    mains = conn.execute(
        "SELECT id, account, title, pub_time, length(full_text) FROM articles WHERE is_dup=0"
    ).fetchall()
    # 候选行：无全文 → 长度给 0，与既有主条目并列时 max 平局取先者（既有主条目保持 primary）
    cand = (-1, account, title, pub_time or "", 0)
    is_dup, dup_of = 0, None
    for grp in dedup_db.cluster(mains + [cand], 0.82):
        if any(r[0] == -1 for r in grp):
            primary = dedup_db.pick_primary(grp)
            if primary[0] != -1:
                is_dup, dup_of = 1, primary[0]
            break

    low_value = 1 if is_low_value_title(title) else 0
    indexable = (is_dup == 0 and low_value == 0)
    # 分词口径与 rag.build 一致：seg(title + "。" + 正文或摘要)；仅可索引条目计算
    seg = rag.seg(title + "。" + (full_text.strip() or summary)) if indexable else ""

    now = datetime.now().isoformat(timespec="seconds")
    cur = conn.execute(
        "INSERT INTO articles(account,title,summary,pub_time,source_url,crawled_at,"
        "full_text,resolved_url,full_text_at,seg_text,is_dup,dup_of,low_value,keyword,source) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (account, title, summary or None, pub_time, source_url or None, now,
         full_text or None, source_url or None, None, seg or None,
         is_dup, dup_of, low_value, account, source_type),
    )
    aid = cur.lastrowid
    fts_inserted = False
    if indexable:
        ensure_fts(conn)
        # 增量 FTS：与 rag.build 的插入完全同构（rowid=article id），
        # 让新条目在下次全量重建前就可供关键词检索；向量块仍由全量重建统一补
        conn.execute("INSERT INTO articles_fts(rowid, account, title, seg_text) VALUES(?,?,?,?)",
                     (aid, account, title, seg))
        fts_inserted = True
    conn.commit()
    conn.close()
    print(f"✅ 已入库 id={aid}「{title}」 [{source_type}/{account}]"
          + (f"（同文软合并 → 主条目 id={dup_of}，is_dup=1 不进索引）" if is_dup else ""))

    # ---- 索引重建 ----
    # rag.build() 不支持指定库路径（模块级 DB_PATH 指向默认生产库）：
    #   目标库 = 默认生产库 → 子进程代跑 python scripts/rag.py build（正确且安全）；
    #   目标库 = 其他路径   → 打印人工提示并以退出码 3 提醒（绝不误重建生产库）。
    rc = EXIT_OK
    rebuild_status = "skipped" if no_index else "manual"
    if no_index:
        print("⏭ --no-index：跳过索引重建（FTS 已增量更新，向量块待全量重建）")
    elif is_default_db(db_path):
        print("🔁 重建检索索引（python scripts/rag.py build，17MB 库全量重建，分钟级）…")
        r = subprocess.run([sys.executable, os.path.join(BASE, "rag.py"), "build"])
        if r.returncode == 0:
            rebuild_status = "ok"
        else:
            rebuild_status = "fail"
            rc = EXIT_BUILD_FAIL
            print("❌ 索引重建子进程失败，请人工执行：python scripts/rag.py build")
    else:
        print("⚠️ 当前库不是 rag.py 的默认生产库（rag.build 不支持指定库路径），未自动重建。")
        print(f"   请人工执行：python scripts/rag.py build（本库：{db_path}）")
        rc = EXIT_MANUAL

    update_pins(db_path, rebuild_status,
                main_inserted=(is_dup == 0), fts_inserted=fts_inserted)
    save_queue(queue_path, drop_entry(entries, item_id))
    return rc


# ---------- CLI ----------

def main(argv=None):
    ap = argparse.ArgumentParser(prog="review_queue.py", description="F1 人工审核队列 CLI")
    sub = ap.add_subparsers(dest="cmd", required=True)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--db", default=DEFAULT_DB, help="articles 库路径（默认 data/usst_articles.db）")
    common.add_argument("--queue", default=DEFAULT_QUEUE,
                        help="审核队列 jsonl（默认 data/pending_review.jsonl）")
    sub.add_parser("list", parents=[common], help="列出待审条目")
    p = sub.add_parser("show", parents=[common], help="查看单条详情")
    p.add_argument("id")
    p = sub.add_parser("approve", parents=[common], help="批准入库（去重清洗 → 写库 → 重建索引 → 更新钉值）")
    p.add_argument("id")
    p.add_argument("--no-index", action="store_true", help="跳过索引重建（FTS 仍会增量更新）")
    p = sub.add_parser("reject", parents=[common], help="拒绝（仅移出队列，不写库）")
    p.add_argument("id")
    a = ap.parse_args(argv)

    if a.cmd == "list":
        return cmd_list(a.queue)
    if a.cmd == "show":
        return cmd_show(a.queue, a.id)
    if a.cmd == "reject":
        return cmd_reject(a.queue, a.id)
    if a.cmd == "approve":
        return cmd_approve(a.db, a.queue, a.id, no_index=a.no_index)
    return EXIT_ERR


if __name__ == "__main__":
    sys.exit(main())
