# -*- coding: utf-8 -*-
"""抓取指定微信公众号文章：标题 + 正文文本 + 图片 URL，并下载图片到临时目录。"""
import os, re, sys, json, time, html, pathlib

os.environ.setdefault("HTTP_PROXY", "http://127.0.0.1:7890")
os.environ.setdefault("HTTPS_PROXY", "http://127.0.0.1:7890")

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

URLS = [
    "https://mp.weixin.qq.com/s/CnAERicc-bM96vuU3z3N_Q",
    "https://mp.weixin.qq.com/s/CzCXs3QmDe5oWbH1OAFKyQ",
    "https://mp.weixin.qq.com/s/l80Lcv1bXCxOxyHIbN5tMQ",
    "https://mp.weixin.qq.com/s/5-8iE1iAosPWnd7RVtcN8w",
]

OUT_DIR = pathlib.Path(r"D:\WORKBUDDY DATA\学术部\usst-planner\_wx_raw")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def clean_text(s):
    s = re.sub(r"\n{3,}", "\n\n", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


def fetch(url, sess):
    r = sess.get(url, headers=HEADERS, timeout=40)
    r.encoding = "utf-8"
    return r.text


def parse(html_text):
    soup = BeautifulSoup(html_text, "html.parser")
    title = (soup.find("h1", id="activity-name") or soup.find("h1"))
    title = clean_text(title.get_text()) if title else "(无标题)"
    body = soup.find("div", id="js_content") or soup.find("div", class_="rich_media_content")
    if not body:
        return title, "", []
    text = clean_text(body.get_text("\n"))
    imgs = []
    for img in body.find_all("img"):
        src = img.get("data-src") or img.get("src") or ""
        if not src:
            bg = img.get("style") or ""
            m = re.search(r'url\(["\']?(//?[^"\')]+)', bg)
            if m:
                src = m.group(1)
        if not src:
            continue
        if src.startswith("//"):
            src = "https:" + src
        elif src.startswith("/"):
            src = "https://mp.weixin.qq.com" + src
        imgs.append(src)
    # 去重保序
    seen, uniq = set(), []
    for u in imgs:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    return title, text, uniq


def dl(url, path, sess):
    for attempt in range(3):
        try:
            r = sess.get(url, headers={**HEADERS, "Referer": "https://mp.weixin.qq.com/"}, timeout=60, stream=True)
            if r.status_code == 200 and int(r.headers.get("Content-Length", 0) or 1) > 1000:
                with open(path, "wb") as f:
                    for chunk in r.iter_content(8192):
                        f.write(chunk)
                return True
        except Exception as e:
            if attempt == 2:
                print("   下载失败:", e)
    return False


def main():
    sess = requests.Session()
    sess.trust_env = True
    report = []
    for i, url in enumerate(URLS, 1):
        print(f"\n=== [{i}/{len(URLS)}] {url}")
        try:
            raw = fetch(url, sess)
        except Exception as e:
            print("  抓取失败:", e)
            continue
        title, text, imgs = parse(raw)
        print(f"  标题: {title}")
        print(f"  正文字符数: {len(text)}  图片数: {len(imgs)}")
        safe_title = re.sub(r'[\\/:*?"<>|]', "_", title)[:40]
        d = OUT_DIR / f"{i:02d}_{safe_title}"
        d.mkdir(exist_ok=True)
        (d / "正文.txt").write_text(f"{title}\n{url}\n\n{text}", encoding="utf-8")
        ok = 0
        for j, iu in enumerate(imgs, 1):
            ext = ".png" if "png" in iu.lower().split("?")[0] else ".jpg"
            if "gif" in iu.lower().split("?")[0]:
                ext = ".gif"
            if dl(iu, d / f"img_{j:02d}{ext}", sess):
                ok += 1
            time.sleep(0.2)
        print(f"  已下载图片: {ok}/{len(imgs)}  → {d}")
        report.append({"idx": i, "url": url, "title": title, "text_len": len(text),
                       "imgs": len(imgs), "downloaded": ok, "dir": str(d)})
    (OUT_DIR / "抓取报告.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n=== 汇总 ===")
    for r in report:
        print(f"[{r['idx']}] {r['title']}  正文{r['text_len']}字  图{r['downloaded']}/{r['imgs']}")


if __name__ == "__main__":
    main()
