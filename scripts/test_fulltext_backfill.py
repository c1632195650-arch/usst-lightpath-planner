# -*- coding: utf-8 -*-
"""W1 · 慢跑回填止损演练（纯 Python，无 pytest 依赖——沿 test_crawl_queue.py 体例）
=================================================================
两条：
  ① 止损门：哨兵过但全批失败 → alert 落盘 + STOP 旗创建 + **DB 零写入**；
  ② 链路成功：单篇 mock 全链 → full_text 写入 + run 日志 ok 条目 + 无 STOP。
RV 口径：摘掉止损分支（min_success 恒过）→ ①恰红；摘掉 UPDATE → ②恰红。
"""
import json
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fulltext_backfill_slow import run  # noqa: E402

DB_SCHEMA = """
CREATE TABLE articles (
  id INTEGER PRIMARY KEY, account TEXT, title TEXT, pub_time TEXT,
  source_url TEXT, full_text TEXT, full_text_at TEXT, resolved_url TEXT, is_dup INTEGER DEFAULT 0
);
"""


def make_db(tmp, rows):
    db = os.path.join(tmp, "t.db")
    c = sqlite3.connect(db)
    c.executescript(DB_SCHEMA)
    c.executemany("INSERT INTO articles(id,account,title,pub_time,source_url) VALUES(?,?,?,?,?)", rows)
    c.commit()
    c.close()
    return db


def rows_sogou(tmp):
    return make_db(tmp, [
        (1, "上理球知道", "考研出分复试重点", "2026-03-01", "https://weixin.sogou.com/link?url=OLD1"),
        (2, "上理小喇叭", "寒假返乡拼车指南", "2026-01-20", "https://weixin.sogou.com/link?url=OLD2"),
    ])


def test_stoploss_zero_write():
    """① 全批 no_match → 止损：alert+STOP+零写入。"""
    tmp = tempfile.mkdtemp()
    db = rows_sogou(tmp)
    logs = os.path.join(tmp, "_logs")

    def fake_sogou(url, referer=None):
        return "<html>结果页（无匹配项）</html>"  # 非 antispider、无 h3/link

    def fake_mp(url, referer=None):
        raise AssertionError("止损批不应触达 mp 抓取")

    s = run(batch=5, min_success=0.6, db_path=db, logs_dir=logs,
            sleep_s=0, get_sogou=fake_sogou, get_mp=fake_mp, _build=False)
    assert s.get("stoploss") is True, f"应触发止损：{s}"
    assert os.path.exists(os.path.join(logs, "backfill_alert.jsonl")), "alert 未落盘"
    assert os.path.exists(os.path.join(logs, "backfill_STOP")), "STOP 旗未创建"
    c = sqlite3.connect(db)
    n = c.execute("SELECT count(*) FROM articles WHERE full_text IS NOT NULL").fetchone()[0]
    c.close()
    assert n == 0, f"止损批必须零写入（实际写了 {n} 条）"

    # 止损后再次 run：空转退出（不再触网）
    s2 = run(db_path=db, logs_dir=logs, get_sogou=fake_sogou, get_mp=fake_mp, _build=False)
    assert s2.get("stopped") is True, f"STOP 旗在位应空转：{s2}"
    print("✓ 止损演练：alert+STOP+零写入+再跑空转")


def test_happy_path_writes():
    """② 单篇全链成功 → 写入 + run ok 条目 + 无 STOP。"""
    tmp = tempfile.mkdtemp()
    db = rows_sogou(tmp)
    logs = os.path.join(tmp, "_logs")
    search_html = ('<h3><a href="/link?url=NEW1&amp;k=1">考研出分这些复试重点你要知道</a></h3>'
                   '<h3><a href="/link?url=OTHER">毫不相关的结果</a></h3>')
    link_html = "var x=1; url += 'https://mp.weixin.qq.com/s?abc'; url += '&def=1';"
    mp_html = ('<div id="js_content"><p>第一条正文内容足够长。</p>'
               '<p>第二条正文内容也足够长，确保长度超过五十字的门槛。'
               '再加一点内容保证通过长度校验。</p></div>')

    state = {"search": 0}

    def fake_sogou(url, referer=None):
        if "type=2" in url:
            state["search"] += 1
            return search_html if state["search"] <= 1 else search_html
        return link_html  # /link → frags

    def fake_mp(url, referer=None):
        return mp_html

    s = run(batch=5, min_success=0.5, db_path=db, logs_dir=logs,
            sleep_s=0, get_sogou=fake_sogou, get_mp=fake_mp, _build=False)
    assert s.get("ok") is True and s.get("ok_n", 0) >= 1, f"应有成功篇：{s}"
    assert not os.path.exists(os.path.join(logs, "backfill_STOP")), "成功批不应立 STOP"
    c = sqlite3.connect(db)
    row = c.execute("SELECT full_text, resolved_url FROM articles WHERE id=1").fetchone()
    c.close()
    assert row[0] and "正文内容" in row[0], f"full_text 未写入：{row}"
    assert row[1] == "https://mp.weixin.qq.com/s?abc&def=1", f"resolved_url 不符：{row}"
    run_lines = [json.loads(l) for l in open(os.path.join(logs, "backfill_run.jsonl"), encoding="utf-8")]
    assert any(l.get("ok") and l.get("id") == 1 for l in run_lines), "run 日志缺 ok 条目"
    print("✓ 链路演练：写入+resolved_url+日志+无 STOP")


if __name__ == "__main__":
    test_stoploss_zero_write()
    test_happy_path_writes()
    print("\nW1 止损演练全部通过")
