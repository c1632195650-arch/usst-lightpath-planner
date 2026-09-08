# -*- coding: utf-8 -*-
"""批量抓取微信公众号：去重 + 跳过已存在 + 抓正文+图片，存 _wx_raw/。"""
import os, re, sys, json, time, hashlib, pathlib, html
os.environ.setdefault("HTTP_PROXY", "http://127.0.0.1:7890")
os.environ.setdefault("HTTPS_PROXY", "http://127.0.0.1:7890")
import requests
from bs4 import BeautifulSoup
import sqlite3

URLS_FILE = r"D:\WORKBUDDY DATA\学术部\usst-planner\_urls_batch2.txt"
OUT_DIR = pathlib.Path(r"D:\WORKBUDDY DATA\学术部\usst-planner\_wx_raw2")
OUT_DIR.mkdir(parents=True, exist_ok=True)
DB = r"D:\WORKBUDDY DATA\学术部\usst-planner\data\usst_articles.db"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

def clean(s):
    s = re.sub(r"\n{3,}", "\n\n", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()

def parse(html_text):
    soup = BeautifulSoup(html_text, "html.parser")
    title = (soup.find("h1", id="activity-name") or soup.find("h1"))
    title = clean(title.get_text()) if title else "(无标题)"
    # 公众号名（account）
    acc = ""
    am = soup.find("a", id="js_name") or soup.find("strong", class_="profile_nickname")
    if am:
        acc = clean(am.get_text())
    # 出版时间
    pt = ""
    pm = soup.find("em", id="publish_time") or soup.find("span", id="publish_time")
    if pm:
        pt = clean(pm.get_text())
    body = soup.find("div", id="js_content") or soup.find("div", class_="rich_media_content")
    text = ""
    imgs = []
    if body:
        text = clean(body.get_text("\n"))
        for img in body.find_all("img"):
            src = img.get("data-src") or img.get("src") or ""
            if not src:
                bg = img.get("style") or ""
                m = re.search(r'url\(["\']?(//?[^"\')]+)', bg)
                if m: src = m.group(1)
            if not src: continue
            if src.startswith("//"): src = "https:" + src
            elif src.startswith("/"): src = "https://mp.weixin.qq.com" + src
            imgs.append(src)
    seen, uniq = set(), []
    for u in imgs:
        if u not in seen:
            seen.add(u); uniq.append(u)
    return title, acc, pt, text, uniq

def dl(url, path, sess):
    for attempt in range(3):
        try:
            r = sess.get(url, headers={**HEADERS, "Referer": "https://mp.weixin.qq.com/"},
                         timeout=60, stream=True)
            if r.status_code == 200 and int(r.headers.get("Content-Length", 0) or 1) > 500:
                with open(path, "wb") as f:
                    for chunk in r.iter_content(8192):
                        f.write(chunk)
                return True
        except Exception as e:
            if attempt == 2:
                print(f"   下载失败: {e}")
    return False

def normalize(u):
    """去掉 search_click_id 和 scene/sessionid 等动态参数"""
    if "mp.weixin.qq.com/s?" in u:
        m = re.search(r"(__biz=.*?chksm=[^&]+)", u)
        if m:
            return "https://mp.weixin.qq.com/s?" + m.group(1)
    return u.split("#")[0]

def main():
    sess = requests.Session()
    sess.trust_env = True
    conn = sqlite3.connect(DB); cur = conn.cursor()
    # 已存在 source_url
    existing = {r[0] for r in cur.execute("SELECT source_url FROM articles WHERE source_url IS NOT NULL AND source_url!=''")}
    print(f"已存在 source_url 数：{len(existing)}")
    urls = [u.strip() for u in open(URLS_FILE, encoding="utf-8") if u.strip().startswith("http")]
    print(f"输入链接数：{len(urls)}")
    norm_to_orig = {}
    for u in urls:
        n = normalize(u)
        norm_to_orig.setdefault(n, u)
    urls = list(norm_to_orig.keys())
    print(f"去重后：{len(urls)}")

    report = []
    for i, url in enumerate(urls, 1):
        if url in existing:
            print(f"[{i:>2}] skip (exists): {url[:60]}")
            continue
        print(f"[{i:>2}] {url[:80]}")
        try:
            r = sess.get(url, headers=HEADERS, timeout=40)
            r.encoding = "utf-8"
            raw = r.text
        except Exception as e:
            print(f"   抓取失败: {e}")
            continue
        title, acc, pt, text, imgs = parse(raw)
        print(f"   标题: {title[:50]}  账号: {acc}  字符: {len(text)}  图: {len(imgs)}")
        if not title or title == "(无标题)":
            print("   ⚠ 标题为空，可能被反爬")
            continue
        safe = re.sub(r'[\\/:*?"<>|]', "_", title)[:40]
        d = OUT_DIR / f"{i:02d}_{safe}"
        d.mkdir(exist_ok=True)
        (d / "正文.txt").write_text(
            f"标题: {title}\n账号: {acc}\nURL: {url}\n时间: {pt}\n\n{text}", encoding="utf-8")
        ok = 0
        for j, iu in enumerate(imgs, 1):
            ext = ".png" if "png" in iu.lower().split("?")[0] else ".jpg"
            if "gif" in iu.lower().split("?")[0]: ext = ".gif"
            if dl(iu, d / f"img_{j:02d}{ext}", sess): ok += 1
            time.sleep(0.15)
        print(f"   下载图片: {ok}/{len(imgs)}  -> {d}")
        report.append({"idx": i, "url": url, "title": title, "account": acc,
                       "pub_time": pt, "text_len": len(text),
                       "imgs": len(imgs), "downloaded": ok, "dir": str(d)})
        time.sleep(0.4)
    (OUT_DIR / "抓取报告.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n=== 汇总：成功 {len(report)} 篇 ===")
    for r in report:
        print(f"  [{r['idx']:>2}] {r['title'][:38]}  ({r['account'][:18]})  字{r['text_len']} 图{r['downloaded']}")

if __name__ == "__main__":
    main()
