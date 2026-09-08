# -*- coding: utf-8 -*-
"""把 _wx_raw2 抓取结果入库：严过滤 + 重复检测 + 去重。"""
import os, re, sys, json, hashlib, pathlib
sys.stdout.reconfigure(encoding="utf-8")
import sqlite3

ROOT = pathlib.Path(r"D:\WORKBUDDY DATA\学术部\usst-planner")
REPORT = ROOT / "_wx_raw2" / "抓取报告.json"
DB = ROOT / "data" / "usst_articles.db"
WX_DIR = ROOT / "_wx_raw2"

# 严过滤黑名单（标题/正文匹配则标 low_value=1，拒绝入索引）
LOW_VALUE_KW = [
    "雅思高分班", "雅思提分", "雅思课", "小班", "VIP小班", "免费重读", "高分保障", "提分",
    "广告", "加微信", "扫码咨询", "加老师",
    "诚聘", "招聘启事", "招聘信息",
    "招生章程", "招生录取", "录取通知书",
    "新生特辑", "新生须知",  # 重复类标题，与现有重复率极高，且内容已被其他覆盖
]
# 严拒绝的（不写入）
REJECT_TITLE = [
    "PPT模板", "简历模板", "信纸素材",
    "校长.*讲话", "校庆",
]

def normalize_title(t):
    """去除空格/标点，便于 dedup"""
    t = re.sub(r"[\s\W_]+", "", t or "")
    return t.lower()

def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    # 现有标题归一化集合
    cur.execute("SELECT id, title, account, source_url FROM articles WHERE is_dup=0")
    existing = []
    for row in cur.fetchall():
        existing.append({"id": row[0], "norm": normalize_title(row[1]),
                         "title": row[1], "account": row[2], "url": row[3]})
    # 现有 source_url 集合
    cur.execute("SELECT source_url FROM articles WHERE source_url IS NOT NULL AND source_url!=''")
    existing_urls = {r[0] for r in cur.fetchall()}

    rep = json.loads(REPORT.read_text(encoding="utf-8"))
    print(f"待入库：{len(rep)} 篇\n")

    added, dup, low, rejected = 0, 0, 0, 0
    for r in rep:
        title = r["title"]
        url = r["url"]
        text_path = WX_DIR / pathlib.Path(r["dir"]).name / "正文.txt"
        full_text = text_path.read_text(encoding="utf-8") if text_path.exists() else ""
        # 切出 body（去掉头部元信息）
        m = re.search(r"\n\n([\s\S]+)$", full_text)
        body = m.group(1) if m else full_text
        norm = normalize_title(title)
        # source_url 已存在 → skip
        if url in existing_urls:
            print(f"  [skip] source_url 已存在: {title[:40]}")
            continue
        # 标题去重
        dup_of = None
        for ex in existing:
            if ex["norm"] == norm or (ex["title"] == title and ex["account"] == r.get("account", "")):
                dup_of = ex["id"]
                break
        # 黑名单检查
        is_low = 0
        is_reject = 0
        for kw in REJECT_TITLE:
            if re.search(kw, title):
                is_reject = 1
                break
        if not is_reject:
            for kw in LOW_VALUE_KW:
                if kw in title or kw in body[:500]:
                    is_low = 1
                    break
        # 摘要
        summary = re.sub(r"\s+", " ", body[:150]).strip()
        if not summary:
            summary = title
        # 标题 + URL 哈希作为 source_url
        # 实际已经给了 url
        is_dup = 1 if dup_of else 0

        if is_reject:
            print(f"  [reject] {title[:40]}")
            rejected += 1
            continue
        if dup_of:
            print(f"  [dup→{dup_of}] {title[:40]}")
            # 不入库（保留抓取文件供审核，但不占索引）
            dup += 1
            continue
        if is_low:
            print(f"  [low] {title[:40]}")
            low += 1

        # 入库
        cur.execute("""
            INSERT INTO articles (account, title, summary, pub_time, source_url, full_text, full_text_at,
                                  crawled_at, is_dup, low_value, source, keyword, seg_text)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, ?, '公众号', ?, ?)
        """, (r.get("account", ""), title, summary, r.get("pub_time", ""), url,
              body, is_low, "", body[:300]))
        conn.commit()
        new_id = cur.lastrowid
        existing.append({"id": new_id, "norm": norm, "title": title,
                         "account": r.get("account", ""), "url": url})
        existing_urls.add(url)
        added += 1
        print(f"  [+id={new_id}] {title[:40]}  字{len(body)}  图{r.get('downloaded',0)}")

    print(f"\n=== 汇总：新增 {added} | 重复 {dup} | low_value {low} | 拒绝 {rejected} ===")
    cur.execute("SELECT COUNT(*) FROM articles WHERE is_dup=0")
    print(f"主条目总数：{cur.fetchone()[0]}")

if __name__ == "__main__":
    main()
