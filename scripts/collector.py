# -*- coding: utf-8 -*-
"""
上理公众号信息采集器（阶段 1 · 摘要层）
================================================
通过「搜狗微信文章搜索」这一公开渠道（无需登录），按公众号白名单抓取文章摘要，
过滤广告，结构化写入 SQLite，并导出一份 JSON 供前端使用。

用法：
    python scripts/collector.py [每号抓取页数，默认 2]

依赖：仅 Python 标准库（urllib / sqlite3 / json），无需安装任何包。
网络：需本机代理 127.0.0.1:7890（搜狗微信在国内可达，直连失败时走代理兜底）。
"""
import urllib.request, urllib.parse, re, time, sqlite3, json, os, sys
from datetime import datetime
from clean_text import is_ad_title

# ---- 配置 ----
PROXY = "http://127.0.0.1:7890"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# 白名单：(搜索词, 公众号显示名)。
# 搜狗里部分号的显示名与口语名不一致，故分开配置；过滤按「显示名」精确匹配。
#
# 【核实结论 2026-09-07】搜狗「文章搜索(type=2)」本质是关键词搜索，不是按公众号枚举：
#   只能抓到「标题/正文含该关键词」且显示名精确匹配的文章，抓不全一个号的全部推文。
#   故以下 5 个「名字够独特」的号可正常抓；另 2 个号搜狗无法枚举，见文末注释。
ACCOUNTS = [
    ("上理小喇叭", "上理小喇叭"),
    ("上理球知道", "上理球知道"),
    ("上海理工体育教学部", "上海理工大学体育教学部"),   # 显示名带「大学」
    ("上海理工大学", "上海理工大学"),                    # 官方
    ("上理大学生", "上理大学生"),
]
# 以下 2 个号搜狗「文章搜索」无法可靠枚举，需走搜狗账号搜索(type=1，已死/需验证码)
# 或微信内搜索、或手动补链接：
#   - 「在上理」：搜"在上理"返回的是别家文章（名字太口语化，无命中）。
#   - 「上理工基础学部学生汇」：2026-03-17 基础学部成立后由「上海理工大学基础学院」
#     更名而来，改名太新，搜狗索引尚未收录新名（搜"上海理工大学基础学院"能搜到旧账号，
#     但已解散、多为 2016-2024 旧闻，已于清洗阶段剔除）。
#     注：其旧账号「上海理工大学基础学院」数据在 data/removed_log.txt 有删除记录。

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "..", "data")
DB_PATH = os.path.join(DATA_DIR, "usst_articles.db")
JSON_PATH = os.path.join(DATA_DIR, "usst_articles.json")

HTML_ENT = [("&middot;", "·"), ("&mdash;", "—"), ("&ldquo;", "“"), ("&rdquo;", "”"),
            ("&lsquo;", "‘"), ("&rsquo;", "’"), ("&amp;", "&"), ("&quot;", '"'),
            ("&nbsp;", " "), ("&hellip;", "…"), ("&lt;", "<"), ("&gt;", ">")]


def clean(s):
    """去 HTML 标签 + 常见实体 + 搜狗高亮标记"""
    s = re.sub(r"<!--red_beg-->|<!--red_end-->", "", s)
    s = re.sub(r"<[^>]+>", "", s)
    for a, b in HTML_ENT:
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def fetch(url, retry=2):
    """抓取 URL，走代理；失败走直连兜底"""
    body = None
    # 先走代理
    try:
        op = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
        op.addheaders = [("User-Agent", UA), ("Accept-Language", "zh-CN,zh;q=0.9")]
        body = op.open(url, timeout=25).read().decode("utf-8", "ignore")
    except Exception:
        pass
    # 代理失败走直连
    if body is None:
        op = urllib.request.build_opener()
        op.addheaders = [("User-Agent", UA), ("Accept-Language", "zh-CN,zh;q=0.9")]
        body = op.open(url, timeout=25).read().decode("utf-8", "ignore")
    return body


def parse_page(html):
    """解析搜索结果页，返回 [{account,title,summary,ts,link}]"""
    blocks = re.findall(r'<li id="sogou_vr_.*?</li>', html, re.S)
    out = []
    for b in blocks:
        m_title = re.search(r"<h3>\s*<a[^>]*>(.*?)</a>", b, re.S)
        m_sum = re.search(r'<p class="txt-info"[^>]*>(.*?)</p>', b, re.S)
        m_acct = re.search(r'all-time-y2">(.*?)</span>', b, re.S)
        m_ts = re.search(r"timeConvert\('(\d+)'\)", b)
        m_link = re.search(r'href="(/link\?url=[^"]+)"', b)
        if not m_title:
            continue
        out.append({
            "account": clean(m_acct.group(1)) if m_acct else "",
            "title": clean(m_title.group(1)),
            "summary": clean(m_sum.group(1)) if m_sum else "",
            "ts": int(m_ts.group(1)) if m_ts else 0,
            "link": m_link.group(1) if m_link else "",
        })
    return out


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT,
            pub_time TEXT,
            source_url TEXT,
            crawled_at TEXT,
            UNIQUE(account, title)
        )
    """)
    conn.commit()
    return conn


def crawl_account(conn, query, display_name, pages, delay=1.5):
    """抓取某个公众号的文章（按搜索词搜 + 显示名精确过滤）"""
    got = 0
    for page in range(1, pages + 1):
        url = ("https://weixin.sogou.com/weixin?type=2&query="
               + urllib.parse.quote(query) + (f"&page={page}" if page > 1 else ""))
        try:
            html = fetch(url)
        except Exception as e:
            print(f"    [第{page}页] 抓取失败：{e}")
            break
        items = parse_page(html)
        if not items:
            print(f"    [第{page}页] 无结果或触发反爬，跳过")
            break
        kept = [it for it in items
                if it["account"] == display_name and not is_ad_title(it["title"])]  # 显示名精确过滤 + 标题软广过滤
        for it in kept:
            pub = datetime.fromtimestamp(it["ts"]).strftime("%Y-%m-%d") if it["ts"] else ""
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO articles(account,title,summary,pub_time,source_url,crawled_at) "
                    "VALUES(?,?,?,?,?,?)",
                    (it["account"], it["title"], it["summary"], pub,
                     "https://weixin.sogou.com" + it["link"], datetime.now().isoformat(timespec="seconds")),
                )
                got += 1
            except Exception as e:
                print("    入库异常：", e)
        print(f"    [第{page}页] 共 {len(items)} 条，白名单命中 {len(kept)} 条")
        if page < pages:
            time.sleep(delay)
    conn.commit()
    return got


def main():
    pages = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = init_db()

    print("=" * 56)
    print(f"上理公众号采集 · 白名单 {len(ACCOUNTS)} 个号 · 每号 {pages} 页")
    print("=" * 56)

    total = 0
    report = {}
    for query, display in ACCOUNTS:
        print(f"\n▶ {display}（搜索词：{query}）")
        n = crawl_account(conn, query, display, pages)
        report[display] = n
        total += n
        time.sleep(1.0)

    # 汇总
    cnt = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
    print("\n" + "=" * 56)
    print("采集完成（新增命中计入下方）：")
    for a, n in report.items():
        print(f"  {a}: {n} 条")
    print("-" * 56)
    print(f"数据库累计 {cnt} 条（含历史去重保留）")

    # 导出 JSON
    rows = conn.execute(
        "SELECT account,title,summary,pub_time,source_url FROM articles ORDER BY pub_time DESC"
    ).fetchall()
    data = [{"account": r[0], "title": r[1], "summary": r[2], "pub_time": r[3], "url": r[4]}
            for r in rows]
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"JSON 已导出：{JSON_PATH}（{len(data)} 条）")

    conn.close()


if __name__ == "__main__":
    main()
