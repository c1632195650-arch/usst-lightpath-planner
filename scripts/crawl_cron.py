# -*- coding: utf-8 -*-
"""
F1 · D3 数据自动更新最小版 —— 采集编排器（cron 入口）
====================================================
每天两次自动增量采集校园资讯：新条目**不直写 articles 表**，而是按 source_url
去重后进入人工审核队列 data/pending_review.jsonl（jsonl，零 DB 迁移），
由 scripts/review_queue.py 人工 approve 后入库并重建检索索引。
审核队列是唯一入库口 → 误采不污染线上库。

流程（任一失败只追加告警并 exit 0，绝不产半截数据）：
  1. 哨兵：探测已知 URL（默认学校主站），失败 → _logs/crawl_alert.jsonl 并直接结束
  2. 增量采集：**import 复用** collector.py / collect_web.py 的函数级接口
     （parse_page / parse_list / ACCOUNTS / COLUMNS），不复制抓取解析逻辑。
     合规缺省：公众号源只存标题+摘要+链接（不落全文），官网源存列表页元数据；
     全文由既有 scripts/fulltext.py 机制事后补采
  3. 入队：按 source_url 去重（已在队列或已在库的不入队）
  4. 报告：_logs/crawl_run.jsonl 追加 {time, new_n, pending_n, elapsed_s}；
     连续 3 个采集日零新增 → 告警（同日只报一次）

审核：python scripts/review_queue.py list | show <id> | approve <id> | reject <id>

crontab 建议行（部署时人工配置，本脚本不自行部署）：
  17 5,17 * * * cd /opt/usst/app && .venv/bin/python scripts/crawl_cron.py

用法：
  python scripts/crawl_cron.py [--dry-run] [--since-days 7] [--pages 1]
      [--db PATH] [--queue PATH] [--logs DIR] [--sentinel-url URL]

本脚本永远 exit 0（cron 场景靠告警文件而非退出码驱动人工介入）。
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import urllib.parse
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
if BASE not in sys.path:
    # collector/collect_web 用裸 import（from clean_text import ...），需保证 scripts 目录在 path 上
    sys.path.insert(0, BASE)

import collector
import collect_web
from clean_text import is_ad_title

ROOT = os.path.dirname(BASE)
DEFAULT_DB = os.path.join(ROOT, "data", "usst_articles.db")
DEFAULT_QUEUE = os.path.join(ROOT, "data", "pending_review.jsonl")
DEFAULT_LOGS = os.path.join(ROOT, "_logs")

SENTINEL_URL = "https://www.usst.edu.cn/"   # 哨兵：主站可达即认为网络出口正常
ZERO_NEW_ALERT_PREFIX = "连续3天零新增"


def requests_fetch(url, timeout=25):
    """真实 fetcher：requests 直连；直连失败走 collector 的本地代理兜底（开发机场景）。

    服务器（Linux）上直连即可；测试时该函数会被注入的 mock fetcher 整体替换。
    """
    import requests
    headers = {"User-Agent": collector.UA, "Accept-Language": "zh-CN,zh;q=0.9"}
    try:
        r = requests.get(url, timeout=timeout, headers=headers)
    except Exception:
        r = requests.get(url, timeout=timeout, headers=headers,
                         proxies={"http": collector.PROXY, "https": collector.PROXY})
    r.raise_for_status()
    return r.text


def sogou_search_url(query, page=1):
    """搜狗微信文章搜索 URL（与 collector.crawl_account 的拼法一致）"""
    url = "https://weixin.sogou.com/weixin?type=2&query=" + urllib.parse.quote(query)
    if page > 1:
        url += f"&page={page}"
    return url


# ---------- 采集（只出候选条目，绝不写库） ----------

def collect_wechat(fetcher, pages=1):
    """公众号源：复用 collector 的 parse_page / ACCOUNTS，返回候选条目列表。

    合规缺省：只取标题+摘要+搜狗跳转链接，不抓正文、不落全文。
    """
    out = []
    for query, display in collector.ACCOUNTS:
        for page in range(1, pages + 1):
            url = sogou_search_url(query, page)
            try:
                html = fetcher(url)
            except Exception:
                break  # 本号本轮跳过：抓取失败不产半截数据
            items = collector.parse_page(html)
            if not items:
                break
            for it in items:
                if it["account"] != display or not it["link"] or is_ad_title(it["title"]):
                    continue  # 显示名精确过滤 + 链接必需 + 标题软广过滤（与 collector 同口径）
                pub = ""
                if it["ts"]:
                    pub = datetime.fromtimestamp(it["ts"]).strftime("%Y-%m-%d")
                out.append({
                    "title": it["title"],
                    "summary": it["summary"],
                    "pub_time": pub,
                    "source_url": "https://weixin.sogou.com" + it["link"],
                    "source_type": "wechat",
                    "account": display,
                })
    return out


def collect_web_pages(fetcher, pages=1):
    """官网源：复用 collect_web 的 parse_list / COLUMNS，返回候选条目列表。

    只取列表页元数据（标题/日期/URL）；栏目 URL 失效或抓取失败时跳过该栏目。
    """
    out = []
    for dept, host, col_path, col_name in collect_web.COLUMNS:
        for page in range(1, pages + 1):
            path = col_path if page == 1 else col_path.replace("list.htm", f"list{page}.htm")
            url = f"https://{host}{path}"
            try:
                html = fetcher(url)
            except Exception:
                break
            items = collect_web.parse_list(html)
            if not items:
                break
            for title, u, d in items:
                out.append({
                    "title": title,
                    "summary": "",
                    "pub_time": d or "",
                    "source_url": f"https://{host}{u}",
                    "source_type": "web",
                    "account": dept,
                })
    return out


def collect_single_pages(fetcher, sources_path=None):
    """W2（2026-10-25）单页采集模式：不在任何列表页内的静态服务指南页。

    清单 data/sources_single.json：[{id, url, keyword}]；
    复用 collect_web.parse_page（与详情页解析同一实现）抽标题/日期/正文摘要，
    按 source_url 去重入队（与列表页通道同一队列）。pub_time 取页面内日期，
    无日期留空（within_since 的保守保留语义覆盖）。
    """
    path = sources_path or os.path.join(BASE, "..", "data", "sources_single.json")
    if not os.path.exists(path):
        return []
    import json as _json
    with open(path, encoding="utf-8") as f:
        spec = _json.load(f)
    out = []
    for page in spec.get("pages", []):
        url, kw = page.get("url", ""), page.get("keyword", "")
        if not url:
            continue
        try:
            html = fetcher(url)
        except Exception:
            continue  # 单页失败只跳过该页，不产半截数据
        body, d, _pdf = collect_web.parse_page(html)
        # parse_page 返回 (正文, 日期, pdf)；标题从 <title> 或 h1 取（详情页无标题行）
        tm = re.search(r"<title>([^<]+)</title>", html)
        title = (tm.group(1).strip().rsplit("-", 1)[0].strip() if tm else "")
        if not title:
            hm = re.search(r"<h1[^>]*>([^<]+)</h1>", html)
            title = hm.group(1).strip() if hm else ""
        if not title or not body:
            continue
        out.append({
            "title": title,
            "summary": body[:200],
            "pub_time": d or "",
            "source_url": url,
            "source_type": "web",
            "account": kw,
        })
    return out


def within_since(pub_time, since_days, today=None):
    """--since-days 过滤：无日期（列表页首屏最新）保守保留，有日期按天窗口过滤"""
    pub_time = (pub_time or "").strip()
    if not pub_time:
        return True
    try:
        d = datetime.strptime(pub_time[:10], "%Y-%m-%d").date()
    except ValueError:
        return True
    today = today or datetime.now().date()
    return (today - d).days <= since_days


# ---------- 队列 / 去重 / 日志 ----------

def item_id(source_url):
    """确定性 id：url 的 md5 前 12 位（同 URL 永远同 id）"""
    return hashlib.md5(source_url.encode("utf-8")).hexdigest()[:12]


def load_queue_urls(queue_path):
    """已有队列里的 source_url 集合（坏行跳过；文件不存在视为空）"""
    urls = set()
    if not os.path.exists(queue_path):
        return urls
    with open(queue_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                u = json.loads(line).get("source_url") or ""
                if u:
                    urls.add(u)
            except Exception:
                continue
    return urls


def count_queue(queue_path):
    n = 0
    if os.path.exists(queue_path):
        with open(queue_path, encoding="utf-8") as f:
            n = sum(1 for line in f if line.strip())
    return n


def db_has_url(conn, url):
    """该 URL 是否已入库（source_url / resolved_url 任一命中；空库/旧 schema 优雅降级）"""
    if conn is None:
        return False
    try:
        row = conn.execute(
            "SELECT 1 FROM articles WHERE source_url=? OR resolved_url=? LIMIT 1", (url, url)
        ).fetchone()
        return row is not None
    except sqlite3.OperationalError:
        try:
            row = conn.execute(
                "SELECT 1 FROM articles WHERE source_url=? LIMIT 1", (url,)
            ).fetchone()
            return row is not None
        except sqlite3.OperationalError:
            return False  # 连 articles 表都没有（全新空库）→ 视为空


def append_jsonl(path, obj):
    """jsonl 追加：显式 newline='\n'（本仓全仓 LF 约定）"""
    d = os.path.dirname(os.path.abspath(path))
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def zero_new_streak(logs_dir):
    """从 crawl_run.jsonl 读历史：最近 3 个**有运行记录的日期**是否全部零新增。

    口径说明：按「运行日」而非日历日连续（cron 停跑的日子不参与计数）；
    同日多次运行只要有一次 new_n>0，该日即算非零。
    """
    path = os.path.join(logs_dir, "crawl_run.jsonl")
    if not os.path.exists(path):
        return 0
    per_date = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                d = (rec.get("time") or "")[:10]
                if not d:
                    continue
                per_date[d] = per_date.get(d, False) or (rec.get("new_n", 0) > 0)
            except Exception:
                continue
    dates = sorted(per_date, reverse=True)[:3]
    streak = 0
    for d in dates:
        if per_date[d]:
            break
        streak += 1
    return streak


def last_alert_date(logs_dir, prefix):
    """告警文件里最近一条匹配前缀的告警日期（用于同日去重），无则 None"""
    path = os.path.join(logs_dir, "crawl_alert.jsonl")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        for line in reversed(f.readlines()):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                if (rec.get("reason") or "").startswith(prefix):
                    return (rec.get("time") or "")[:10]
            except Exception:
                continue
    return None


# ---------- 主流程 ----------

def run(db_path=None, queue_path=None, logs_dir=None, since_days=7, dry_run=False,
        fetcher=None, pages=1, sentinel_url=SENTINEL_URL):
    """跑一轮「哨兵 → 采集 → 去重入队 → 报告」。fetcher 可注入（测试用 mock）。

    返回 summary dict；哨兵失败时 {"ok": False, ...} 且不写运行报告（只写告警）。
    """
    t0 = time.monotonic()
    db_path = os.path.abspath(db_path or DEFAULT_DB)
    queue_path = os.path.abspath(queue_path or DEFAULT_QUEUE)
    logs_dir = os.path.abspath(logs_dir or DEFAULT_LOGS)
    fetcher = fetcher or requests_fetch
    now_iso = datetime.now().isoformat(timespec="seconds")
    run_log = os.path.join(logs_dir, "crawl_run.jsonl")
    alert_log = os.path.join(logs_dir, "crawl_alert.jsonl")

    # 1) 哨兵：失败 → 告警 + 正常返回（不写运行报告、不采集，绝不产半截数据）
    try:
        body = fetcher(sentinel_url)
        if not body:
            raise RuntimeError("哨兵响应为空")
    except Exception as e:
        reason = f"哨兵探测失败（{sentinel_url}）：{e!r}"
        append_jsonl(alert_log, {"time": now_iso, "reason": reason})
        print(f"🚨 {reason}")
        return {"ok": False, "alerted": True, "reason": reason, "dry_run": dry_run}

    # 2) 增量采集（候选条目，不写库）
    try:
        cands = (collect_wechat(fetcher, pages=pages) + collect_web_pages(fetcher, pages=pages)
                 + collect_single_pages(fetcher))
    except Exception as e:
        reason = f"采集阶段异常终止：{e!r}"
        append_jsonl(alert_log, {"time": now_iso, "reason": reason})
        print(f"🚨 {reason}")
        return {"ok": False, "alerted": True, "reason": reason, "dry_run": dry_run}
    cands = [c for c in cands if within_since(c["pub_time"], since_days)]

    # 3) 按 source_url 去重（已在队列 or 已在库 → 不入队），追加队列
    seen = load_queue_urls(queue_path)
    conn = None
    if os.path.exists(db_path):
        try:
            conn = sqlite3.connect(db_path)
        except sqlite3.Error:
            conn = None
    new_items = []
    for c in cands:
        u = c["source_url"]
        if not u or u in seen or db_has_url(conn, u):
            continue
        seen.add(u)
        new_items.append({
            "id": item_id(u),
            "title": c["title"],
            "summary": c["summary"],
            "pub_time": c["pub_time"],
            "source_url": u,
            "source_type": c["source_type"],
            "fetched_at": now_iso,
            # 偏差说明：工单 7 字段外新增 account —— articles.account NOT NULL 且
            # UNIQUE(account,title) 需要真实来源名（公众号名/部门名），不能填 source_type
            "account": c["account"],
        })
    if conn is not None:
        conn.close()
    if new_items and not dry_run:
        append_items_to_queue(queue_path, new_items)
    pending_n = count_queue(queue_path)

    # 4) 运行报告
    elapsed_s = round(time.monotonic() - t0, 2)
    append_jsonl(run_log, {
        "time": now_iso,
        "new_n": len(new_items),
        "pending_n": pending_n,
        "elapsed_s": elapsed_s,
    })

    # 5) 连续 3 个采集日零新增 → 告警（同日去重，避免 cron 一天两次刷屏）
    streak = zero_new_streak(logs_dir)
    streak_alerted = False
    if streak >= 3 and last_alert_date(logs_dir, ZERO_NEW_ALERT_PREFIX) != now_iso[:10]:
        append_jsonl(alert_log, {
            "time": now_iso,
            "reason": f"{ZERO_NEW_ALERT_PREFIX}（最近 {streak} 个采集日无新条目），"
                      f"请检查采集源是否改版或被反爬",
        })
        streak_alerted = True

    return {
        "ok": True,
        "dry_run": dry_run,
        "new_n": len(new_items),
        "pending_n": pending_n,
        "elapsed_s": elapsed_s,
        "streak": streak,
        "streak_alerted": streak_alerted,
    }


def append_items_to_queue(queue_path, items):
    """候选条目追加进审核队列（jsonl，显式 LF）"""
    d = os.path.dirname(queue_path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(queue_path, "a", encoding="utf-8", newline="\n") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="crawl_cron.py", description="F1 数据自动更新 · 采集编排器（cron 入口）")
    ap.add_argument("--db", default=DEFAULT_DB, help="articles 库路径（默认 data/usst_articles.db）")
    ap.add_argument("--queue", default=DEFAULT_QUEUE,
                    help="人工审核队列 jsonl（默认 data/pending_review.jsonl）")
    ap.add_argument("--logs", default=DEFAULT_LOGS, help="运行/告警日志目录（默认 _logs）")
    ap.add_argument("--dry-run", action="store_true", help="只探测+写报告，不入队")
    ap.add_argument("--since-days", type=int, default=7, help="只采集最近 N 天发布的条目（默认 7）")
    ap.add_argument("--pages", type=int, default=1, help="每源抓取页数（默认 1，cron 轻量档）")
    ap.add_argument("--sentinel-url", default=SENTINEL_URL, help="哨兵探测 URL")
    a = ap.parse_args(argv)
    summary = run(db_path=a.db, queue_path=a.queue, logs_dir=a.logs, since_days=a.since_days,
                  dry_run=a.dry_run, pages=a.pages, sentinel_url=a.sentinel_url)
    print(json.dumps(summary, ensure_ascii=False))
    return 0  # 永远 0：告警走 _logs/crawl_alert.jsonl，不走退出码


if __name__ == "__main__":
    sys.exit(main())
