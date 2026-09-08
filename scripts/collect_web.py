# -*- coding: utf-8 -*-
"""
学校官网常青信息采集器（webplus 建站系统通用）
=================================================
补公众号覆盖不到的「常青信息」：图书馆借阅规则/开馆、体育部体测/体育课、
教务处规章制度/学生手册/选课学籍、学生处奖助贷。这些是常年有效、权威的
官方信息，正好补齐「生活服务/体测/奖助/数字校园」四大缺口。

原理（已实测）：
  列表页 list.htm → 文章 URL 形如 /YYYY/MMDD/c{站点ID}a{文章ID}/page.htm + 标题；
  详情页 page.htm → 正文在 <div class="wp_articlecontent">，时间「发布时间：YYYY-MM-DD」。

用法：
    python scripts/collect_web.py [每栏目最大页数，默认 3]

账号字段用「部门名」，与公众号账号并存（检索时统一处理）。
"""
import urllib.request, urllib.parse, re, time, sqlite3, json, os, sys
from datetime import datetime
from clean_text import is_ad_title

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

PROXY = "http://127.0.0.1:7890"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "..", "data")
DB_PATH = os.path.join(DATA_DIR, "usst_articles.db")

# ---- 栏目清单：(部门名, 站点域名, 栏目路径, 栏目名) ----
COLUMNS = [
    # 图书馆（生活服务·图书馆/开馆/借阅）
    ("图书馆", "library.usst.edu.cn", "/17721/list.htm", "借阅服务"),
    ("图书馆", "library.usst.edu.cn", "/17724/list.htm", "借阅规则"),
    ("图书馆", "library.usst.edu.cn", "/17725/list.htm", "续借流程"),
    ("图书馆", "library.usst.edu.cn", "/17727/list.htm", "逾期处理"),
    ("图书馆", "library.usst.edu.cn", "/17728/list.htm", "馆际互借"),
    ("图书馆", "library.usst.edu.cn", "/17722/list.htm", "空间服务"),
    ("图书馆", "library.usst.edu.cn", "/17723/list.htm", "图情服务"),
    # 体育教学部（体测/体育课/场地）
    ("体育教学部", "tyb.usst.edu.cn", "/2969/list.htm", "教学科研"),
    ("体育教学部", "tyb.usst.edu.cn", "/2976/list.htm", "群体工作"),
    ("体育教学部", "tyb.usst.edu.cn", "/2987/list.htm", "场地设施"),
    # 教务处（规章制度/学生手册/学籍/选课/考试）
    ("教务处", "jwc.usst.edu.cn", "/xssc/list.htm", "学生手册"),
    ("教务处", "jwc.usst.edu.cn", "/zhgll/list.htm", "综合管理类"),
    ("教务处", "jwc.usst.edu.cn", "/jwgll/list.htm", "教务管理类"),
    ("教务处", "jwc.usst.edu.cn", "/xjxlgl/list.htm", "学籍学历管理"),
    ("教务处", "jwc.usst.edu.cn", "/ksycjgl/list.htm", "考试与成绩管理"),
    ("教务处", "jwc.usst.edu.cn", "/xkbm/list.htm", "选课报名"),
    # 学生处（奖助贷/心理/就业/规章制度）
    ("学生处", "xsc.usst.edu.cn", "/12873/list.htm", "奖学金"),
    ("学生处", "xsc.usst.edu.cn", "/12874/list.htm", "帮困助学"),
    ("学生处", "xsc.usst.edu.cn", "/12875/list.htm", "慈善公益"),
    ("学生处", "xsc.usst.edu.cn", "/12876/list.htm", "赋能筑梦"),
    ("学生处", "xsc.usst.edu.cn", "/12881/list.htm", "心理咨询"),
    ("学生处", "xsc.usst.edu.cn", "/12878/list.htm", "就业政策"),
    ("学生处", "xsc.usst.edu.cn", "/12877/list.htm", "生涯教育"),
    ("学生处", "xsc.usst.edu.cn", "/12867/list.htm", "规章制度"),
    ("学生处", "xsc.usst.edu.cn", "/12872/list.htm", "纪律处分相关"),
]


def clean(s):
    s = re.sub(r"<[^>]+>", "", s)
    for a, b in [("&nbsp;", " "), ("&amp;", "&"), ("&quot;", '"'), ("&middot;", "·"),
                 ("&ldquo;", "“"), ("&rdquo;", "”"), ("&lt;", "<"), ("&gt;", ">")]:
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def fetch(url):
    try:
        op = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
        op.addheaders = [("User-Agent", UA), ("Accept-Language", "zh-CN,zh;q=0.9")]
        return op.open(url, timeout=25).read().decode("utf-8", "ignore")
    except Exception:
        return ""


def parse_list(html):
    """列表页 → [(title, url, date)]，URL 形如 /YYYY/MMDD/cXXXaYYY/page.htm（单/双引号均兼容）"""
    out = []
    seen = set()
    # 形式1：<span class="news_title"><a href='/2026/0908/cxxxaxxx/page.htm' title='标题'>标题</a></span>
    pat = r"""href=['"](/20\d{2}/\d{4}/c\d+a\d+/page\.htm)['"][^>]*title=['"]([^'"]+)['"]"""
    for m in re.finditer(pat, html):
        url, title = m.group(1), clean(m.group(2))
        if title and url not in seen and not is_ad_title(title):
            seen.add(url)
            out.append((title, url, ""))
    # 形式2：无 title 属性，文字在 <a> 内
    pat2 = r"""href=['"](/20\d{2}/\d{4}/c\d+a\d+/page\.htm)['"][^>]*>\s*([^<]{3,80})\s*</a>"""
    for m in re.finditer(pat2, html):
        url, title = m.group(1), clean(m.group(2))
        if title and url not in seen and not is_ad_title(title):
            seen.add(url)
            out.append((title, url, ""))
    # 提取每个条目的时间（news_meta）
    metas = re.findall(r'class="news_meta">(\d{4}-\d{2}-\d{2})</span>', html)
    for i, (t, u, _) in enumerate(out):
        d = metas[i] if i < len(metas) else ""
        out[i] = (t, u, d)
    return out


def parse_page(html):
    """详情页 → (正文, 发布时间, pdf_url)。正文为空但含 pdfsrc 时返回 pdf_url 供下载提取。"""
    # 正文
    m = re.search(r'<div[^>]*class="wp_articlecontent"[^>]*>(.*?)</div>\s*<', html, re.S)
    if not m:
        m = re.search(r'wp_articlecontent[^>]*>(.*?)</div>', html, re.S)
    body = m.group(1) if m else ""
    body = re.sub(r"</p>", "\n", body)
    body = re.sub(r"<br\s*/?>", "\n", body)
    body = re.sub(r"<[^>]+>", "", body)
    body = re.sub(r"&nbsp;", " ", body)
    body = re.sub(r"[ \t]+", " ", body)
    body = re.sub(r"\n\s*\n+", "\n", body)
    body = body.strip()
    # PDF 路径
    pdf = re.search(r'pdfsrc="([^"]+\.pdf)"', html)
    pdf_url = pdf.group(1) if pdf else ""
    # 时间
    t = re.search(r"发布时间[：:]\s*(\d{4}-\d{2}-\d{2})", html)
    pub = t.group(1) if t else ""
    return body, pub, pdf_url


def extract_pdf(host, pdf_path):
    """下载 PDF 并提取文本（pypdf）"""
    try:
        from pypdf import PdfReader
        import io as _io
        url = f"https://{host}{pdf_path}"
        op = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
        op.addheaders = [("User-Agent", UA)]
        data = op.open(url, timeout=30).read()
        reader = PdfReader(_io.BytesIO(data))
        parts = [page.extract_text() or "" for page in reader.pages]
        txt = "\n".join(p for p in parts if p)
        return re.sub(r"[ \t]+", " ", txt).strip()
    except Exception as e:
        print(f"    [PDF] 提取失败: {e}")
        return ""


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT, pub_time TEXT, source_url TEXT, crawled_at TEXT,
            UNIQUE(account, title)
        )
    """)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(articles)")}
    for col, ddl in [("full_text", "TEXT"), ("resolved_url", "TEXT"),
                     ("full_text_at", "TEXT"), ("seg_text", "TEXT"),
                     ("is_dup", "INTEGER DEFAULT 0"), ("dup_of", "INTEGER"),
                     ("low_value", "INTEGER DEFAULT 0"), ("keyword", "TEXT"),
                     ("source", "TEXT")]:
        if col not in cols:
            conn.execute(f"ALTER TABLE articles ADD COLUMN {col} {ddl}")
    conn.commit()
    return conn


def crawl_column(conn, dept, host, col_path, col_name, pages):
    got = 0
    for page in range(1, pages + 1):
        path = col_path if page == 1 else col_path.replace("list.htm", f"list{page}.htm")
        url = f"https://{host}{path}"
        html = fetch(url)
        items = parse_list(html)
        if not items:
            break
        for title, u, list_date in items:
            full = f"https://{host}{u}"
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO articles(account,title,pub_time,source_url,crawled_at,source,keyword) "
                    "VALUES(?,?,?,?,?,?,?)",
                    (dept, title, list_date or None, full, datetime.now().isoformat(timespec="seconds"), "web", col_name),
                )
                # 若 INSERT 成功（未去重），再抓正文
                if conn.execute("SELECT changes()").fetchone()[0]:
                    detail = fetch(full)
                    body, pub, pdf_url = parse_page(detail)
                    if not body and pdf_url:
                        body = extract_pdf(host, pdf_url)
                    if body:
                        conn.execute(
                            "UPDATE articles SET full_text=?, pub_time=COALESCE(?, pub_time), resolved_url=? "
                            "WHERE account=? AND title=?",
                            (body, pub or None, full, dept, title),
                        )
                    got += 1
                    time.sleep(1.0)
            except sqlite3.IntegrityError:
                pass
        conn.commit()
        if not items or page == pages:
            break
        time.sleep(1.5)
    return got


def main():
    pages = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = init_db()
    print("=" * 60)
    print(f"官网常青信息采集 · {len(COLUMNS)} 个栏目 · 每栏 {pages} 页")
    print("=" * 60)
    total = 0
    for dept, host, col_path, col_name in COLUMNS:
        n = crawl_column(conn, dept, host, col_path, col_name, pages)
        total += n
        print(f"  [{dept}/{col_name}] {col_path} → +{n}")
    print("-" * 60)
    print(f"官网累计新增 {total} 条 · 库总 {conn.execute('SELECT COUNT(*) FROM articles').fetchone()[0]} 条")
    conn.close()


if __name__ == "__main__":
    main()
