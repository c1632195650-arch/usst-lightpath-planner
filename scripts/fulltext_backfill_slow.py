#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""W1 · 公众号 56 篇慢跑回填（止损门版，2026-10-25 工作单 W1）
=============================================================
背景：搜狗 /link token 过期是设计缺口（2026-10-24 定性）；单次「重搜→取新
link→resolve→抓正文」链路已实证可行（探针成功拿到真实 mp.weixin URL），但
连续批量会触发反爬（8s×56 → 53 antispider）。本脚本是**低成本试探**：每天
一小批、篇间 30–45s、首批成功率 <60% 即止损停跑（写 STOP 旗，后续 cron 空转
退出），转人工搬运通道。

执行点说明（对工作单的登记适配）：工作单原定「服务器 crontab」，但服务器
IP 已被搜狗反爬标记（2026-10-25 实测 antispider=True），链路只在本地代理
（127.0.0.1:7890）下成立 ⟹ 定时任务落在**本机**（schtasks 06:47），成功
批次后生成增量 SQL 并可 --push-server 应用到服务器 + 重建索引。

用法：
  python scripts/fulltext_backfill_slow.py [--batch 10] [--min-success 0.6]
      [--sleep-min 30] [--sleep-max 45] [--db PATH] [--logs DIR]
      [--sleep-s 0]        # 测试用：篇间固定秒数（绕开随机）
      [--push-server]      # 批次成功后把增量 SQL 应用到 43.142.141.186 并重建
退出码：0 = 本批完成（含止损后空转）；1 = 止损触发（首次）；2 = 环境异常。
"""
import argparse
import difflib
import http.cookiejar
import json
import os
import random
import re
import sqlite3
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
from fulltext import extract_fulltext  # noqa: E402  正文提取与既有链路同一实现

PROXY = "http://127.0.0.1:7890"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
DEFAULT_DB = os.path.join(BASE, "..", "data", "usst_articles.db")
DEFAULT_LOGS = os.path.join(BASE, "..", "_logs")
SSH = ["ssh", "-i", os.path.expanduser("~/.ssh/SLGS.pem"), "-o", "BatchMode=yes",
       "ubuntu@43.142.141.186"]

# ---------------------------------------------------------------------------
# HTTP：搜狗走代理+Cookie 会话（SNUID 前置），mp 直连优先
# ---------------------------------------------------------------------------


def make_http():
    """返回 (get_sogou, get_mp)：可注入替换的两个抓取函数。"""
    cj = http.cookiejar.CookieJar()
    sogou_opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}),
        urllib.request.HTTPCookieProcessor(cj),
    )
    mp_cj = http.cookiejar.CookieJar()
    mp_direct = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(mp_cj))
    mp_proxy = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}),
        urllib.request.HTTPCookieProcessor(mp_cj),
    )

    def _get(op, url, referer=None):
        headers = {"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"}
        if referer:
            headers["Referer"] = referer
        return op.open(urllib.request.Request(url, headers=headers),
                       timeout=30).read().decode("utf-8", "ignore")

    def get_sogou(url, referer=None):
        return _get(sogou_opener, url, referer)

    def get_mp(url, referer=None):
        try:
            return _get(mp_direct, url, referer)
        except Exception:
            return _get(mp_proxy, url, referer)

    return get_sogou, get_mp


def sogou_search_url(query):
    return "https://weixin.sogou.com/weixin?type=2&query=" + urllib.parse.quote(query)


def antispider(html):
    return "antispider" in html or "验证码" in html


# ---------------------------------------------------------------------------
# 核心链路（全部接受注入，供测试 mock）
# ---------------------------------------------------------------------------


def probe_ok(get_sogou):
    """哨兵：搜狗搜索页可达且未进反爬（不可用则整批不做——工作单 §②）。"""
    try:
        html = get_sogou(sogou_search_url("上理"))
        return bool(html) and not antispider(html)
    except Exception:
        return False


def _norm(s):
    return re.sub(r"<[^>]+>|【|】|\s", "", s)


def search_match(get_sogou, account, title):
    """搜索→结果标题相似度匹配。返回 (link, search_url) 或 (None, search_url)。"""
    search_url = sogou_search_url(f"{account} {title[:20]}")
    html = get_sogou(search_url)
    if antispider(html):
        return None, search_url
    items = re.findall(
        r'<h3>.*?<a[^>]+href="(/link\?url=[^"]+)"[^>]*>(.*?)</a>.*?</h3>', html, re.S)
    if not items:
        return None, search_url
    want = _norm(title)
    best, best_r = None, 0.0
    for link, t in items:
        r = difflib.SequenceMatcher(None, want, _norm(t)).ratio()
        if r > best_r:
            best, best_r = link, r
    if best_r < 0.55 or best is None:
        return None, search_url
    link = best.replace(" ", "%20").replace("&amp;", "&")
    if link.startswith("/"):
        link = "https://weixin.sogou.com" + link
    return link, search_url


def resolve_link(get_sogou, link, referer):
    """新 /link → 真实 mp URL（frags 拼接，同 fulltext.py）。"""
    html = get_sogou(link, referer=referer)
    frags = re.findall(r"url \+= '(.*?)'", html)
    if not frags:
        return None
    return "".join(frags)


def fetch_article(get_sogou, get_mp, account, title):
    """单篇全链路。返回 (fulltext, new_source_url, resolved_url, reason)。"""
    link, search_url = search_match(get_sogou, account, title)
    if link is None:
        return None, None, None, "no_match"
    real = resolve_link(get_sogou, link, search_url)
    if real is None:
        return None, link, None, "no_frag"
    try:
        mp = get_mp(real, referer=link)
    except Exception:
        return None, link, real, "mp_fail"
    ft = extract_fulltext(mp)
    if len(ft) < 50:
        return None, link, real, f"short({len(ft)})"
    return ft, link, real, "ok"


# ---------------------------------------------------------------------------
# 编排
# ---------------------------------------------------------------------------


def append_jsonl(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def count_sentinel_streak(alert_log):
    """alert 日志尾部连续「哨兵失败」条数（成功批会写 batch 条目打断计数）。"""
    if not os.path.exists(alert_log):
        return 0
    streak = 0
    with open(alert_log, encoding="utf-8") as f:
        lines = [l for l in f if l.strip()]
    for line in reversed(lines):
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            break
        if "哨兵失败" in str(obj.get("reason", "")):
            streak += 1
        else:
            break
    return streak


def select_batch(conn, n):
    """is_dup=0、公众号源（sogou 链接）、无全文；pub_time 降序、空值殿后。"""
    return conn.execute(
        "SELECT id, account, title FROM articles "
        "WHERE is_dup=0 AND (full_text IS NULL OR length(full_text)<50) "
        "AND source_url LIKE '%sogou%' "
        "ORDER BY (pub_time IS NULL or pub_time=''), pub_time DESC LIMIT ?",
        (n,),
    ).fetchall()


def run(batch=10, min_success=0.6, db_path=None, logs_dir=None,
        sleep_min=30, sleep_max=45, sleep_s=None, push_server=False,
        get_sogou=None, get_mp=None, _build=True):
    """跑一批。返回 summary dict（测试注入 get_* 与 _build=False 可全离线）。"""
    db_path = os.path.abspath(db_path or DEFAULT_DB)
    logs_dir = os.path.abspath(logs_dir or DEFAULT_LOGS)
    run_log = os.path.join(logs_dir, "backfill_run.jsonl")
    alert_log = os.path.join(logs_dir, "backfill_alert.jsonl")
    stop_flag = os.path.join(logs_dir, "backfill_STOP")
    now = datetime.now().isoformat(timespec="seconds")

    # 0) 止损旗：触发过即不再自跑（工作单 §④：不自动重试）
    if os.path.exists(stop_flag):
        print("⛔ backfill_STOP 在位——止损已触发，本轮空转退出（人工处置后再删旗）")
        return {"ok": True, "stopped": True, "attempted": 0}

    get_sogou = get_sogou or make_http()[0]
    get_mp = get_mp or make_http()[1]

    # 1) 哨兵（连续 6 次失败 → 立 STOP 防每日告警刷屏；成功一次即清零计数）
    if not probe_ok(get_sogou):
        streak = 1 + count_sentinel_streak(alert_log)
        reason = f"搜狗哨兵失败（antispider/网络）——本批中止，零写入（连败 {streak} 次）"
        append_jsonl(alert_log, {"time": now, "reason": reason, "streak": streak})
        if streak >= 6:
            open(stop_flag, "w", encoding="utf-8").write(f"sentinel-streak {now}\n")
            reason += "——连败达 6 次，立 STOP 转人工"
        print(f"🚨 {reason}")
        return {"ok": False, "alerted": True, "reason": reason, "streak": streak}

    # 2) 选批
    conn = sqlite3.connect(db_path)
    rows = select_batch(conn, batch)
    if not rows:
        print("✅ 没有待回填的公众号文章了——任务完成")
        open(stop_flag, "w", encoding="utf-8").write(f"done {now}\n")
        conn.close()
        return {"ok": True, "done": True, "attempted": 0}

    # 3) 逐篇（失败零写入；成功立即 UPDATE 并 commit，中断不丢已得）
    ok = fail = 0
    delta_rows = []
    for i, (aid, account, title) in enumerate(rows, 1):
        try:
            ft, link, real, reason = fetch_article(get_sogou, get_mp, account, title)
        except Exception as e:
            ft, link, real, reason = None, None, None, f"err:{e!r}"[:80]
        if ft:
            conn.execute(
                "UPDATE articles SET full_text=?, full_text_at=?, resolved_url=?, "
                "source_url=(CASE WHEN ? IS NULL THEN source_url ELSE ? END) WHERE id=?",
                (ft, now[:10], real, link, link, aid))
            conn.commit()
            ok += 1
            delta_rows.append((aid, ft, now[:10], link, real))
            append_jsonl(run_log, {"time": now, "id": aid, "title": title[:40],
                                   "ok": True, "len": len(ft)})
            print(f"[{i}/{len(rows)}] ✓ {title[:32]}（{len(ft)} 字）")
        else:
            fail += 1
            append_jsonl(run_log, {"time": now, "id": aid, "title": title[:40],
                                   "ok": False, "reason": reason})
            print(f"[{i}/{len(rows)}] ✗ {title[:32]} — {reason}")
        if i < len(rows):
            time.sleep(sleep_s if sleep_s is not None else random.uniform(sleep_min, sleep_max))
    conn.close()

    rate = ok / len(rows)
    append_jsonl(run_log, {"time": now, "type": "batch",
                           "attempted": len(rows), "ok": ok, "fail": fail,
                           "rate": round(rate, 3)})

    # 4) 止损门
    if rate < min_success:
        reason = (f"止损：本批成功率 {rate:.0%} < {min_success:.0%}"
                  f"（ok={ok}/{len(rows)}）——停止后续，转人工通道")
        append_jsonl(alert_log, {"time": now, "reason": reason, "ok": ok,
                                 "attempted": len(rows)})
        open(stop_flag, "w", encoding="utf-8").write(f"stoploss {now}\n")
        print(f"🚨 {reason}")
        return {"ok": False, "stoploss": True, "attempted": len(rows),
                "ok_n": ok, "rate": rate}

    # 5) 成功批：增量 SQL（供 --push-server / 人工应用）+ 本地重建（含 pins）
    if ok > 0:
        delta_path = os.path.join(logs_dir, f"backfill_delta_{now[:10].replace('-', '')}.sql")
        with open(delta_path, "w", encoding="utf-8", newline="\n") as f:
            for aid, ft, day, link, real in delta_rows:
                safe = ft.replace("'", "''")
                f.write(f"UPDATE articles SET full_text='{safe}', full_text_at='{day}', "
                        f"resolved_url='{real or ''}', "
                        f"source_url=(CASE WHEN '{link or ''}'='' THEN source_url "
                        f"ELSE '{link or ''}' END) WHERE id={aid};\n")
        print(f"📄 增量 SQL → {os.path.basename(delta_path)}")
        if _build:
            subprocess.run([sys.executable, os.path.join(BASE, "rag.py"), "build"],
                           cwd=BASE, check=False)
        if push_server:
            push_delta_to_server(delta_path)

    return {"ok": True, "attempted": len(rows), "ok_n": ok, "rate": rate}


def push_delta_to_server(delta_path):
    """增量 SQL 应用到服务器 + 重建（ssh BatchMode；失败只告警不回滚）。"""
    try:
        remote = "/tmp/_backfill_delta.sql"
        subprocess.run(["scp", "-q", "-i", os.path.expanduser("~/.ssh/SLGS.pem"),
                        delta_path, f"ubuntu@43.142.141.186:{remote}"], check=True)
        subprocess.run(SSH + [
            f"cd /opt/usst/app && /opt/usst/venv/bin/python -c \""
            f"import sqlite3;c=sqlite3.connect('data/usst_articles.db');"
            f"c.executescript(open('{remote}',encoding='utf-8').read());c.commit()\""
            f" && rm -f {remote}"], check=True)
        subprocess.run(SSH + ["cd /opt/usst/app && /opt/usst/venv/bin/python scripts/rag.py build"],
                       check=True)
        print("☁ 服务器增量应用 + 重建完成")
    except Exception as e:
        append_jsonl(os.path.join(DEFAULT_LOGS, "backfill_alert.jsonl"),
                     {"time": datetime.now().isoformat(timespec="seconds"),
                      "reason": f"push-server 失败（增量 SQL 已留本地）：{e!r}"})
        print(f"⚠ push-server 失败：{e!r}（增量 SQL 已留本地，可人工应用）")


def main():
    ap = argparse.ArgumentParser(description="W1 公众号慢跑回填（止损门版）")
    ap.add_argument("--batch", type=int, default=10)
    ap.add_argument("--min-success", type=float, default=0.6)
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--logs", default=DEFAULT_LOGS)
    ap.add_argument("--sleep-min", type=float, default=30)
    ap.add_argument("--sleep-max", type=float, default=45)
    ap.add_argument("--sleep-s", type=float, default=None,
                    help="测试用：篇间固定秒数（默认随机 sleep-min..max）")
    ap.add_argument("--push-server", action="store_true")
    a = ap.parse_args()
    summary = run(batch=a.batch, min_success=a.min_success, db_path=a.db,
                  logs_dir=a.logs, sleep_min=a.sleep_min, sleep_max=a.sleep_max,
                  sleep_s=a.sleep_s, push_server=a.push_server)
    print(json.dumps(summary, ensure_ascii=False))
    if summary.get("stoploss"):
        sys.exit(1)
    if not summary.get("ok"):
        sys.exit(2)


if __name__ == "__main__":
    main()
