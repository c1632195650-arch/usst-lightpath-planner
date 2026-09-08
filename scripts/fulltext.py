# -*- coding: utf-8 -*-
"""
全文抓取器（阶段 2 · 全文层）
================================================
对数据库里已清洗的摘要条目，逐个解析搜狗 /link → 真实 mp.weixin.qq.com 链接，
再抓取公众号正文（#js_content），回写 full_text / resolved_url 字段。

用法：
    python scripts/fulltext.py [起始序号] [结束序号]

原理（已实测通过）：
    1. 带 CookieJar 会话先访问搜狗搜索页拿 SNUID/SUV；
    2. 请求 /link?url=...（带 Referer）返回一段 JS，内含 `url += '...'` 片段；
    3. 拼接片段得真实 mp.weixin.qq.com 链接（无需解密、无需验证码）；
    4. 抓 mp 页面，正则提取 <div id="js_content"> 正文。

限速：搜狗解析与 mp 抓取之间均有 sleep，避免触发反爬。
"""
import urllib.request, urllib.parse, re, sqlite3, sys, io, os, time, http.cookiejar
from datetime import datetime
from clean_text import clean_ad_tails

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
PROXY = "http://127.0.0.1:7890"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "..", "data", "usst_articles.db")

# ---- 会话：搜狗走代理 ----
cj = http.cookiejar.CookieJar()
sogou = urllib.request.build_opener(
    urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}),
    urllib.request.HTTPCookieProcessor(cj),
)
# ---- 会话：mp.weixin 直连优先 ----
mp_cj = http.cookiejar.CookieJar()
mp_direct = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(mp_cj))
mp_proxy = urllib.request.build_opener(
    urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}),
    urllib.request.HTTPCookieProcessor(mp_cj),
)


def get(op, url, referer=None, retry=1):
    headers = [("User-Agent", UA), ("Accept-Language", "zh-CN,zh;q=0.9")]
    if referer:
        headers.append(("Referer", referer))
    op.addheaders = headers
    last = None
    for _ in range(retry + 1):
        try:
            return op.open(url, timeout=30).read().decode("utf-8", "ignore")
        except Exception as e:
            last = e
            time.sleep(1.5)
    raise last


def prime(account):
    """先访问搜索页，建立 SNUID/SUV cookie（否则 /link 必反爬）"""
    url = "https://weixin.sogou.com/weixin?type=2&query=" + urllib.parse.quote(account)
    try:
        get(sogou, url)
    except Exception:
        pass


def resolve_link(link_url, referer):
    """/link -> 真实 mp URL"""
    html = get(sogou, link_url, referer=referer)
    frags = re.findall(r"url \+= '(.*?)'", html)
    if not frags:
        if "antispider" in html or "验证码" in html:
            return None, "antispider"
        return None, "no_frag"
    return "".join(frags), "ok"


def extract_fulltext(html):
    """从 mp 页面提取正文"""
    m = re.search(r'<div[^>]*id="js_content"[^>]*>(.*?)</div>\s*<script', html, re.S)
    if not m:
        m = re.search(r'id="js_content"[^>]*>(.*)', html, re.S)
    if not m:
        return ""
    txt = m.group(1)
    # 段落之间加换行
    txt = re.sub(r"</p>", "\n", txt)
    txt = re.sub(r"<br\s*/?>", "\n", txt)
    txt = re.sub(r"<[^>]+>", "", txt)
    txt = re.sub(r"&nbsp;", " ", txt)
    txt = re.sub(r"&amp;", "&", txt)
    txt = re.sub(r"&lt;", "<", txt)
    txt = re.sub(r"&gt;", ">", txt)
    txt = re.sub(r"[ \t]+", " ", txt)
    txt = re.sub(r"\n\s*\n+", "\n", txt)
    return clean_ad_tails(txt.strip())


def fetch_mp(mp_url, referer):
    """抓 mp 正文，直连优先，代理兜底"""
    try:
        html = get(mp_direct, mp_url, referer=referer)
    except Exception:
        html = get(mp_proxy, mp_url, referer=referer)
    return extract_fulltext(html)


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    end = int(sys.argv[2]) if len(sys.argv) > 2 else 10**9

    conn = sqlite3.connect(DB_PATH)
    # 加字段
    cols = {r[1] for r in conn.execute("PRAGMA table_info(articles)")}
    if "full_text" not in cols:
        conn.execute("ALTER TABLE articles ADD COLUMN full_text TEXT")
    if "resolved_url" not in cols:
        conn.execute("ALTER TABLE articles ADD COLUMN resolved_url TEXT")
    if "full_text_at" not in cols:
        conn.execute("ALTER TABLE articles ADD COLUMN full_text_at TEXT")
    conn.commit()

    rows = conn.execute(
        "SELECT id, account, title, source_url FROM articles "
        "WHERE (full_text IS NULL OR full_text='') AND (source IS NULL OR source!='web') ORDER BY id"
    ).fetchall()
    rows = [r for r in rows if start <= r[0] <= end]
    print(f"待抓全文：{len(rows)} 条\n")

    ok = fail = skip = 0
    last_account = None
    for i, (aid, account, title, src) in enumerate(rows, 1):
        src = (src or "").replace("&amp;", "&").replace(" ", "%20")
        referer = "https://weixin.sogou.com/weixin?type=2&query=" + urllib.parse.quote(account)
        # 账号切换时先 prime 建立 cookie
        if account != last_account:
            prime(account)
            last_account = account
            time.sleep(1.5)
        try:
            # 1. 解真实链接（反爬则重 prime 后重试一次）
            mp_url, status = resolve_link(src, referer)
            if status == "antispider":
                time.sleep(5)
                prime(account)
                time.sleep(1.5)
                mp_url, status = resolve_link(src, referer)
            if status != "ok":
                print(f"[{i}/{len(rows)}] 解析失败({status}) {title[:26]}")
                fail += 1
                time.sleep(2.5)
                continue
            time.sleep(1.2)
            # 2. 抓正文
            text = fetch_mp(mp_url, referer)
            if len(text) < 50:
                print(f"[{i}/{len(rows)}] 正文过短({len(text)}字) {title[:26]}")
                fail += 1
                time.sleep(1.5)
                continue
            conn.execute(
                "UPDATE articles SET full_text=?, resolved_url=?, full_text_at=? WHERE id=?",
                (text, mp_url, datetime.now().isoformat(timespec="seconds"), aid),
            )
            conn.commit()
            ok += 1
            print(f"[{i}/{len(rows)}] ✓ {len(text)}字 | {account} | {title[:26]}")
        except Exception as e:
            print(f"[{i}/{len(rows)}] ✗ 异常 {e} | {title[:26]}")
            fail += 1
        time.sleep(2.0)

    conn.close()
    print(f"\n完成：成功 {ok}，失败 {fail}，跳过 {skip}")


if __name__ == "__main__":
    main()
