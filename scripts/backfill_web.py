# -*- coding: utf-8 -*-
"""官网无正文条目回补：重新抓详情页，文字正文为空时下载 PDF 提取文本。"""
import urllib.request, re, sqlite3, os, sys, time
from urllib.parse import urlparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from collect_web import parse_page, extract_pdf, fetch, clean

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "usst_articles.db")


def main():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, account, title, source_url FROM articles "
        "WHERE source='web' AND (full_text IS NULL OR length(full_text)<=50)"
    ).fetchall()
    print(f"待回补：{len(rows)} 条")
    ok = fail = 0
    for i, (aid, account, title, src) in enumerate(rows, 1):
        if not src:
            fail += 1
            continue
        try:
            html = fetch(src)
            body, pub, pdf_url = parse_page(html)
            if not body and pdf_url:
                host = urlparse(src).netloc
                body = extract_pdf(host, pdf_url)
            if body and len(body) > 30:
                conn.execute(
                    "UPDATE articles SET full_text=?, pub_time=COALESCE(?, pub_time) WHERE id=?",
                    (body, pub or None, aid),
                )
                conn.commit()
                ok += 1
                if i % 20 == 0:
                    print(f"  进度 {i}/{len(rows)}，成功 {ok}")
            else:
                fail += 1
        except Exception as e:
            fail += 1
        time.sleep(0.6)
    conn.close()
    print(f"\n回补完成：成功 {ok}，失败/无正文 {fail}")


if __name__ == "__main__":
    main()
