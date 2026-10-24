# -*- coding: utf-8 -*-
"""
F1 · crawl_cron / review_queue 的离线测试（纯 Python，禁 pytest：本环境无 pytest）
================================================================================
全部使用 tempfile.mkdtemp() 系统临时目录里的**临时库/临时队列/临时日志**，
绝不读写生产库 data/usst_articles.db，不在仓库内留任何产物（残留留在系统临时目录）。

运行：
    .venv/Scripts/python.exe scripts/test_crawl_queue.py     # Windows
    python scripts/test_crawl_queue.py                       # Linux

用例清单（对应 F1 工单验收）：
  test_approve_fts_and_pins      ① 临时库上 approve 后 articles 计数 +1 且 FTS 可检索到
  test_approve_dedup_similar     ①b 同文（标题相似）approve → is_dup=1 软合并、不进 FTS
  test_reject                    ② reject 后不入库（且队列移除）
  test_sentinel_fail_alert_only  ③ 哨兵失败（mock fetch 抛异常）→ 告警 + 零入库零入队
  test_queue_dedup_by_source_url ④ 队列按 source_url 去重（重复运行不重复入队）
  test_zero_new_streak_alert     ⑤ 连续 3 个采集日零新增 → 写告警（同日只报一次）

向量/embedding 说明：approve 的增量路径按设计只建 FTS（关键词检索），
向量块由全量 `python scripts/rag.py build` 统一补 —— embedding 依赖 fastembed
模型（95MB、CPU 分钟级），离线单测跳过该步骤（工单允许），故本文件不断言 chunks。
"""
import json
import os
import sqlite3
import sys
import tempfile
import traceback
from datetime import datetime, timedelta

BASE = os.path.dirname(os.path.abspath(__file__))
if BASE not in sys.path:
    sys.path.insert(0, BASE)

import crawl_cron
import review_queue
import collector
import rag


# ---------- 测试脚手架 ----------

def make_temp_env(with_pins=False):
    """临时目录 + 临时库（齐列 schema）+ 队列/日志路径；一切产物留在系统临时目录"""
    d = tempfile.mkdtemp(prefix="f1_crawl_")
    db = os.path.join(d, "test_articles.db")
    queue = os.path.join(d, "pending_review.jsonl")
    logs = os.path.join(d, "_logs")
    conn = sqlite3.connect(db)
    review_queue.ensure_articles_schema(conn)
    conn.commit()
    conn.close()
    if with_pins:
        with open(os.path.join(d, "data_pins.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump({"articles_is_dup0": 0, "articles_fts": 0, "chunks": 0}, f, ensure_ascii=False)
    return d, db, queue, logs


def seed_queue(queue_path, items):
    os.makedirs(os.path.dirname(queue_path), exist_ok=True)
    with open(queue_path, "a", encoding="utf-8", newline="\n") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")


def make_item(url, title, source_type="web", account="图书馆",
              summary="", pub_time="2026-10-19"):
    return {
        "id": crawl_cron.item_id(url),
        "title": title,
        "summary": summary,
        "pub_time": pub_time,
        "source_url": url,
        "source_type": source_type,
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "account": account,
    }


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def articles_count(db):
    conn = sqlite3.connect(db)
    try:
        return conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
    finally:
        conn.close()


def fts_rowids(db, query):
    conn = sqlite3.connect(db)
    try:
        q = rag.fts_query(query)
        return [r[0] for r in conn.execute(
            "SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?", (q,))]
    finally:
        conn.close()


# ---------- mock 抓取（离线，无网络） ----------

def fake_wechat_html(title, summary, account, ts):
    """伪造搜狗结果块：结构对齐 collector.parse_page 的正则（h3/txt-info/all-time-y2/timeConvert//link）"""
    return (
        '<li id="sogou_vr_0">'
        f"<h3><a>{title}</a></h3>"
        f'<p class="txt-info">{summary}</p>'
        f'<span class="all-time-y2">{account}</span>'
        f"<script>timeConvert('{ts}')</script>"
        '<a href="/link?url=TESTLINK">x</a>'
        "</li>"
    )


WEB_COLUMN_URL = "https://library.usst.edu.cn/17721/list.htm"
WEB_ARTICLE_URL = "https://library.usst.edu.cn/2026/1019/c123a456/page.htm"
WECHAT_TITLE = "图书馆寒假开放时间安排的通知"
WECHAT_SUMMARY = "寒假期间图书馆开放时间为每日九点至十七点"
WEB_TITLE = "关于期末考试与放假安排的通知"


def make_fetcher(with_hits=True):
    """mock fetcher：命中 URL 返回伪造页面，其余 URL 抛异常（顺带验证失败源被跳过）"""
    ts = int((datetime.now() - timedelta(days=1)).timestamp())
    pages = {crawl_cron.SENTINEL_URL: "<html>ok</html>"}
    if with_hits:
        pages[crawl_cron.sogou_search_url(collector.ACCOUNTS[0][0])] = fake_wechat_html(
            WECHAT_TITLE, WECHAT_SUMMARY, collector.ACCOUNTS[0][1], ts)
        pages[WEB_COLUMN_URL] = (
            "<span class='news_title'>"
            f"<a href='/2026/1019/c123a456/page.htm' title='{WEB_TITLE}'>{WEB_TITLE}</a>"
            "</span>"
            '<span class="news_meta">2026-10-19</span>'
        )

    def fetcher(url):
        if url in pages:
            return pages[url]
        raise RuntimeError(f"mock: unexpected url {url}")

    return fetcher


def empty_fetcher(url):
    """哨兵可达但所有采集源失败 → 恒零新增"""
    if url == crawl_cron.SENTINEL_URL:
        return "<html>ok</html>"
    raise RuntimeError("mock: no route")


def boom_fetcher(url):
    """连哨兵都失败（网络不可用）"""
    raise RuntimeError("mock: network down")


# ---------- 用例 ----------

def test_approve_fts_and_pins():
    """① approve 后 articles 计数 +1 且 FTS 可检索到；data_pins.json 三键口径正确"""
    d, db, queue, logs = make_temp_env(with_pins=True)
    url = WEB_ARTICLE_URL
    seed_queue(queue, [make_item(url, WEB_TITLE, source_type="web", account="图书馆",
                                 summary="考试周图书馆延长开放")])

    rc = review_queue.cmd_approve(db, queue, crawl_cron.item_id(url), no_index=True)
    assert rc == 0, f"approve 退出码应为 0，实际 {rc}"

    # articles 计数 +1，字段按 schema 填齐
    conn = sqlite3.connect(db)
    row = conn.execute(
        "SELECT account, title, summary, pub_time, source_url, seg_text, is_dup, dup_of, "
        "low_value, keyword, source, resolved_url FROM articles").fetchone()
    assert row is not None, "approve 后 articles 应有 1 行"
    assert row[0] == "图书馆" and row[1] == WEB_TITLE
    assert row[3] == "2026-10-19" and row[4] == url
    assert row[5], "seg_text 应已按 rag.seg 口径写入"
    assert row[6] == 0 and row[7] is None, "非重复主条目 is_dup=0/dup_of=NULL"
    assert row[9] == "图书馆" and row[10] == "web", "keyword/source 应填源清单"
    assert row[11] == url, "resolved_url 应回填 source_url"
    aid = conn.execute("SELECT id FROM articles").fetchone()[0]
    conn.close()

    # FTS 可检索到（用例允许跳过 embedding，注释见文件头）
    hits = fts_rowids(db, WEB_TITLE)
    assert hits == [aid], f"FTS 应命中且 rowid=article id，实际 {hits} / aid={aid}"

    # 队列已移除；钉值三键：主条目 +1、FTS +1、chunks 不动（待全量重建对齐）
    assert read_jsonl(queue) == [], "approve 后条目应移出队列"
    with open(os.path.join(d, "data_pins.json"), encoding="utf-8") as f:
        pins = json.load(f)
    assert pins["articles_is_dup0"] == 1 and pins["articles_fts"] == 1 and pins["chunks"] == 0


def test_approve_dedup_similar():
    """①b 标题相似（同文异链）的第二个条目 approve → is_dup=1 软合并，不进 FTS"""
    d, db, queue, _logs = make_temp_env(with_pins=False)  # 无钉值文件 → 跳过更新，不报错
    u1 = "https://library.usst.edu.cn/2026/1010/c1a1/page.htm"
    u2 = "https://xxgk.usst.edu.cn/2026/1011/c2a2/page.htm"
    t = "关于期末考试与放假安排的通知"
    seed_queue(queue, [
        make_item(u1, t, source_type="web", account="图书馆"),
        make_item(u2, t + "（转发）", source_type="web", account="校务信息公开"),
    ])

    assert review_queue.cmd_approve(db, queue, crawl_cron.item_id(u1), no_index=True) == 0
    assert review_queue.cmd_approve(db, queue, crawl_cron.item_id(u2), no_index=True) == 0

    conn = sqlite3.connect(db)
    rows = conn.execute(
        "SELECT id, is_dup, dup_of, seg_text FROM articles ORDER BY id").fetchall()
    conn.close()
    assert len(rows) == 2, "两条都应入库（软合并保留记录，与 dedup_db 口径一致）"
    first, second = rows
    assert first[1] == 0 and first[3], "先批准的为主条目（is_dup=0，有 seg_text）"
    assert second[1] == 1 and second[2] == first[0] and second[3] is None, \
        f"后批准的应 is_dup=1、dup_of={first[0]}、不进索引，实际 {second}"

    assert len(fts_rowids(db, t)) == 1, "FTS 里只应有主条目一条"
    assert read_jsonl(queue) == [], "两条都应移出队列"


def test_reject():
    """② reject 后不入库，仅移出队列；不存在的 id 报错"""
    d, db, queue, _logs = make_temp_env()
    u1 = "https://library.usst.edu.cn/2026/1020/c9a9/page.htm"
    u2 = "https://library.usst.edu.cn/2026/1021/c8a8/page.htm"
    seed_queue(queue, [make_item(u1, "垃圾广告条目"), make_item(u2, "正常条目")])

    assert review_queue.cmd_reject(queue, crawl_cron.item_id(u1)) == 0
    left = read_jsonl(queue)
    assert [it["id"] for it in left] == [crawl_cron.item_id(u2)], "只应剩未处理那条"
    assert articles_count(db) == 0, "reject 绝不写库"
    assert review_queue.cmd_reject(queue, "nonexistent000") == 1, "不存在的 id 应返回 1"


def test_sentinel_fail_alert_only():
    """③ 哨兵失败（mock fetch 抛异常）→ 写告警、零入库、零入队、无运行报告"""
    d, db, queue, logs = make_temp_env()
    s = crawl_cron.run(db_path=db, queue_path=queue, logs_dir=logs, fetcher=boom_fetcher)
    assert s["ok"] is False and s.get("alerted") is True

    alerts = read_jsonl(os.path.join(logs, "crawl_alert.jsonl"))
    assert len(alerts) == 1, "应恰好一条告警"
    assert "哨兵" in alerts[0]["reason"] and "time" in alerts[0]
    assert not os.path.exists(queue), "零入队（队列文件都不应产生）"
    assert not os.path.exists(os.path.join(logs, "crawl_run.jsonl")), "哨兵失败不写运行报告"
    assert articles_count(db) == 0, "零入库"


def test_queue_dedup_by_source_url():
    """④ 队列按 source_url 去重：第二次运行同一批页面 → 零新增；字段与 id 确定性"""
    d, db, queue, logs = make_temp_env()
    fetcher = make_fetcher(with_hits=True)

    s1 = crawl_cron.run(db_path=db, queue_path=queue, logs_dir=logs,
                        since_days=3650, fetcher=fetcher)
    assert s1["ok"] is True and s1["new_n"] == 2, f"首轮应入队 2 条（公众号+官网），实际 {s1}"
    items = read_jsonl(queue)
    assert len(items) == 2
    expected_keys = {"id", "title", "summary", "pub_time", "source_url",
                     "source_type", "fetched_at", "account"}
    for it in items:
        assert set(it.keys()) == expected_keys, f"队列行字段集不符：{sorted(it.keys())}"
    ids = {it["id"] for it in items}
    # id = md5(source_url) 前 12 位，确定性
    assert crawl_cron.item_id("https://weixin.sogou.com/link?url=TESTLINK") in ids
    assert crawl_cron.item_id(WEB_ARTICLE_URL) in ids
    assert all(len(i) == 12 for i in ids)
    # 运行报告字段
    rec = read_jsonl(os.path.join(logs, "crawl_run.jsonl"))[-1]
    assert set(rec.keys()) == {"time", "new_n", "pending_n", "elapsed_s"}
    assert rec["pending_n"] == 2

    s2 = crawl_cron.run(db_path=db, queue_path=queue, logs_dir=logs,
                        since_days=3650, fetcher=fetcher)
    assert s2["new_n"] == 0, f"同 URL 第二轮必须被去重，实际 {s2}"
    assert len(read_jsonl(queue)) == 2, "队列不应重复追加"

    # 已在库的也不入队：把官网那条手工入库后清空队列再跑 → 只剩公众号那条之外零新增
    conn = sqlite3.connect(db)
    conn.execute("INSERT INTO articles(account,title,source_url,crawled_at) VALUES(?,?,?,?)",
                 ("图书馆", WEB_TITLE, WEB_ARTICLE_URL, "2026-10-24T00:00:00"))
    conn.commit()
    conn.close()
    os.remove(queue)
    s3 = crawl_cron.run(db_path=db, queue_path=queue, logs_dir=logs,
                        since_days=3650, fetcher=fetcher)
    assert s3["new_n"] == 1, f"库中已有的 URL 应被跳过，实际 {s3}"
    assert read_jsonl(queue)[0]["source_type"] == "wechat"


def test_zero_new_streak_alert():
    """⑤ 连续 3 个采集日零新增 → 写告警；同日重复运行不重复告警；未满 3 天不告警"""
    d, db, queue, logs = make_temp_env()
    run_log = os.path.join(logs, "crawl_run.jsonl")
    alert_log = os.path.join(logs, "crawl_alert.jsonl")

    def seed_zero_day(days_ago):
        os.makedirs(logs, exist_ok=True)
        day = (datetime.now() - timedelta(days=days_ago)).date()
        with open(run_log, "a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps({"time": f"{day}T08:00:00", "new_n": 0,
                                "pending_n": 0, "elapsed_s": 1.0}, ensure_ascii=False) + "\n")

    # 第 1 天（今天）零新增 → 只有 1 个采集日，不告警
    s1 = crawl_cron.run(db_path=db, queue_path=queue, logs_dir=logs, fetcher=empty_fetcher)
    assert s1["new_n"] == 0 and s1["streak"] == 1 and not s1["streak_alerted"]
    assert not os.path.exists(alert_log)

    # 补上昨日零新增 → 2 个采集日，仍不告警
    seed_zero_day(1)
    s2 = crawl_cron.run(db_path=db, queue_path=queue, logs_dir=logs, fetcher=empty_fetcher)
    assert s2["streak"] == 2 and not s2["streak_alerted"]
    assert not os.path.exists(alert_log)

    # 补上前天零新增 → 连续 3 个采集日零新增 → 告警
    seed_zero_day(2)
    s3 = crawl_cron.run(db_path=db, queue_path=queue, logs_dir=logs, fetcher=empty_fetcher)
    assert s3["streak"] >= 3 and s3["streak_alerted"], f"第 3 个零新增日应告警，实际 {s3}"
    alerts = read_jsonl(alert_log)
    assert len(alerts) == 1 and alerts[0]["reason"].startswith("连续3天零新增")

    # 同日再跑 → 去重，不重复告警
    s4 = crawl_cron.run(db_path=db, queue_path=queue, logs_dir=logs, fetcher=empty_fetcher)
    assert s4["streak_alerted"] is False, "同日第二次告警应被抑制"
    assert len(read_jsonl(alert_log)) == 1


# ---------- 主入口（禁 pytest：普通函数逐个跑，断言用 assert） ----------

def main():
    tests = [
        test_approve_fts_and_pins,
        test_approve_dedup_similar,
        test_reject,
        test_sentinel_fail_alert_only,
        test_queue_dedup_by_source_url,
        test_zero_new_streak_alert,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {t.__name__}")
            traceback.print_exc()
    if failed:
        print(f"{failed}/{len(tests)} FAILED")
        return 1
    print(f"ALL PASS ({len(tests)} tests)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
