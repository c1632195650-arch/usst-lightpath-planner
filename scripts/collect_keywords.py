# -*- coding: utf-8 -*-
"""
上理公众号关键词采集器（阶段 1 增量版 · 按领域关键词搜索）
=============================================================
搜狗「文章搜索(type=2)」是关键词搜索，不能按公众号枚举全部推文。故本采集器
不再按「账号名」搜索，而是按「领域关键词矩阵」搜索，命中白名单号的文章才入库。

规避的坑（2026-09-08 试点后确认）：
  1. 账号名映射错误 → 白名单用搜狗真实显示名精确匹配；
  2. 旧闻堆积 → 时效下限 2024-01-01（重点 2025-2026）；
  3. 软广/引流 → is_ad_title 标题级过滤 + 低价值娱乐标记 low_value；
  4. 同文去重 → UNIQUE(account,title) + 标题相似度(0.85)去重；
  5. 反爬 → 请求间隔 + 空结果/antispider 退避。

用法：
    python scripts/collect_keywords.py [每词页数，默认 2]

依赖：仅标准库 + 同目录 clean_text.py。幂等：重复跑自动去重，可断点续跑。
"""
import urllib.request, urllib.parse, re, time, sqlite3, json, os, sys, difflib
from datetime import datetime
from clean_text import is_ad_title, is_low_value_title

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# ---- 配置 ----
PROXY = "http://127.0.0.1:7890"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "..", "data")
DB_PATH = os.path.join(DATA_DIR, "usst_articles.db")

# 白名单：搜狗真实显示名（跳过「在上理」「上理工基础学部学生汇」——搜狗无法枚举）
WHITELIST = {
    "上理小喇叭", "上理球知道", "上海理工大学体育教学部",
    "上海理工大学", "上理大学生",
}

# 时效下限：只收 2024-01-01 及以后（规避旧闻堆积）
MIN_YEAR = 2024
# 常青信息（指南/标准/说明类，常年有效）放宽到 2022
EVERGREEN_YEAR = 2022
EVERGREEN_HINT = ["指南", "标准", "说明", "办法", "规定", "攻略", "须知", "手册",
                  "课程修读", "体质", "体测", "修读", "选课", "评分", "条例", "章程"]

# 每个关键词用两个前缀（分别命中不同号：上理→球知道/小喇叭/大学生；上海理工大学→官方/体育）
PREFIXES = ["上理", "上海理工大学"]

# ---- 关键词矩阵：按这些号「实际高产」的内容类型分批次 ----
KEYWORDS = {
    "学业教务": ["选课", "重修", "补考", "缓考", "转专业", "辅修", "双学位", "绩点",
               "学分", "期末考试", "成绩查询", "四六级", "六级", "四级"],
    "升学就业": ["考研", "保研", "复试", "专升本", "留学", "出国", "offer", "就业",
               "招聘", "实习", "秋招", "选调"],
    "放假校历": ["放假", "校历", "寒假", "暑假", "国庆", "中秋", "五一", "清明", "元旦", "调休"],
    "新生报到": ["新生", "报到", "迎新", "开学", "军训", "宿舍", "快递", "报到指南"],
    "活动社团": ["社团", "招新", "讲座", "比赛", "大赛", "晚会", "运动会", "校庆", "十佳", "辩论", "迎新晚会"],
    "体育": ["体育", "体测", "体质健康", "篮球", "羽毛球", "足球", "跑步", "健身", "马拉松"],
    "奖助表彰": ["奖学金", "助学金", "国家奖学金", "励志", "勤工", "喜报", "获奖", "表彰"],
    "数字校园": ["WeLink", "welink", "一网通办", "校园卡", "校园网", "图书馆", "教务系统"],
    # ---- 第二波 · 长尾具体词（2026-09-08 扩充）----
    "球类运动": ["排球", "网球", "乒乓球", "游泳", "龙舟", "帆船", "武术", "瑜伽", "健美操", "跆拳道"],
    "文艺活动": ["十佳歌手", "主持人大赛", "辩论赛", "演讲比赛", "征文", "书画", "摄影", "合唱", "朗诵"],
    "学院专业": ["光电", "机械", "能动", "管理", "外语", "材料", "环建", "理学院", "专业分流", "大类招生"],
    "教务学业": ["选课系统", "学分制", "毕业设计", "毕业论文", "实习报告", "学位", "毕业"],
    "校园服务": ["校园美食", "食堂测评", "军训", "奖助学金", "助学贷款", "绿色通道", "宿舍", "住宿"],
    "体育课程": ["体育课", "体育修读", "体测标准", "体质健康标准", "体育免修", "体育考试", "晨跑", "步道乐跑"],
}

HTML_ENT = [("&middot;", "·"), ("&mdash;", "—"), ("&ldquo;", "“"), ("&rdquo;", "”"),
            ("&lsquo;", "‘"), ("&rsquo;", "’"), ("&amp;", "&"), ("&quot;", '"'),
            ("&nbsp;", " "), ("&hellip;", "…"), ("&lt;", "<"), ("&gt;", ">")]


def clean(s):
    s = re.sub(r"<!--red_beg-->|<!--red_end-->", "", s)
    s = re.sub(r"<[^>]+>", "", s)
    for a, b in HTML_ENT:
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def norm_title(t):
    """标题归一化：去标点/空格/年份干扰，用于相似度比较"""
    t = re.sub(r"[^\u4e00-\u9fa5A-Za-z0-9]", "", t or "")
    return t.lower()


def fetch(url):
    try:
        op = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
        op.addheaders = [("User-Agent", UA), ("Accept-Language", "zh-CN,zh;q=0.9")]
        return op.open(url, timeout=25).read().decode("utf-8", "ignore")
    except Exception:
        return ""


def parse_page(html):
    blocks = re.findall(r'<li id="sogou_vr_.*?</li>', html, re.S)
    out = []
    for b in blocks:
        m_title = re.search(r"<h3>\s*<a[^>]*>(.*?)</a>", b, re.S)
        m_sum = re.search(r'<p class="txt-info"[^>]*>(.*?)</p>', b, re.S)
        m_acct = re.search(r'all-time-y2">(.*?)</span>', b, re.S)
        m_ts = re.search(r"timeConvert\('(\d+)'\)", b)
        m_link = re.search(r'href="(/link\?url=[^"]+)"', b)
        if not m_title or not m_acct:
            continue
        out.append({
            "account": clean(m_acct.group(1)),
            "title": clean(m_title.group(1)),
            "summary": clean(m_sum.group(1)) if m_sum else "",
            "ts": int(m_ts.group(1)) if m_ts else 0,
            "link": (m_link.group(1) if m_link else "").replace("&amp;", "&").replace(" ", "%20"),
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
    cols = {r[1] for r in conn.execute("PRAGMA table_info(articles)")}
    for col, ddl in [("full_text", "TEXT"), ("resolved_url", "TEXT"),
                     ("full_text_at", "TEXT"), ("seg_text", "TEXT"),
                     ("is_dup", "INTEGER DEFAULT 0"), ("dup_of", "INTEGER"),
                     ("low_value", "INTEGER DEFAULT 0"), ("keyword", "TEXT")]:
        if col not in cols:
            conn.execute(f"ALTER TABLE articles ADD COLUMN {col} {ddl}")
    conn.commit()
    return conn


def title_exists(conn, title):
    """标题相似度去重：与库内已有标题比，>=0.85 视为重复"""
    nt = norm_title(title)
    if len(nt) < 6:
        return False
    for (t,) in conn.execute("SELECT title FROM articles"):
        if difflib.SequenceMatcher(None, nt, norm_title(t)).ratio() >= 0.85:
            return True
    return False


def crawl_keyword(conn, query, pages, delay=2.0):
    """按关键词搜索，命中白名单号 + 时效 + 非软文 才入库"""
    got = 0
    for page in range(1, pages + 1):
        url = ("https://weixin.sogou.com/weixin?type=2&query="
               + urllib.parse.quote(query) + (f"&page={page}" if page > 1 else ""))
        html = fetch(url)
        if not html or "antispider" in html:
            return got, "antispider"
        items = parse_page(html)
        if not items:
            return got, "empty"
        for it in items:
            if it["account"] not in WHITELIST:
                continue
            if is_ad_title(it["title"]):
                continue
            # 时效过滤：常青信息放宽到 EVERGREEN_YEAR，其余 MIN_YEAR
            if it["ts"]:
                yr = datetime.fromtimestamp(it["ts"]).year
                floor = EVERGREEN_YEAR if any(h in it["title"] for h in EVERGREEN_HINT) else MIN_YEAR
                if yr < floor:
                    continue
            # 去重
            if title_exists(conn, it["title"]):
                continue
            pub = datetime.fromtimestamp(it["ts"]).strftime("%Y-%m-%d") if it["ts"] else ""
            try:
                conn.execute(
                    "INSERT INTO articles(account,title,summary,pub_time,source_url,crawled_at,"
                    "low_value,keyword) VALUES(?,?,?,?,?,?,?,?)",
                    (it["account"], it["title"], it["summary"], pub,
                     "https://weixin.sogou.com" + it["link"],
                     datetime.now().isoformat(timespec="seconds"),
                     1 if is_low_value_title(it["title"]) else 0, query),
                )
                got += 1
            except sqlite3.IntegrityError:
                pass  # UNIQUE 冲突，跳过
        if page < pages:
            time.sleep(delay)
    conn.commit()
    return got, "ok"


def main():
    pages = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = init_db()

    total_kw = sum(len(v) for v in KEYWORDS.values())
    total_req = total_kw * len(PREFIXES) * pages
    print("=" * 62)
    print(f"关键词采集 · {len(KEYWORDS)} 批 {total_kw} 词 × {len(PREFIXES)} 前缀 × {pages} 页")
    print(f"预计请求 {total_req} 次 · 时效下限 {MIN_YEAR}+ · 白名单 {len(WHITELIST)} 号")
    print("=" * 62)

    total = 0
    report = {}
    for batch, kws in KEYWORDS.items():
        report[batch] = 0
        for kw in kws:
            for prefix in PREFIXES:
                q = f"{prefix} {kw}"
                n, status = crawl_keyword(conn, q, pages)
                total += n
                report[batch] += n
                if n:
                    print(f"  [{batch}/{kw}] {q} → +{n}")
                if status == "antispider":
                    print(f"  ⚠ 反爬触发于 {q}，退避 8s")
                    time.sleep(8)
                time.sleep(1.8)
        print(f"\n▶ {batch} 累计 +{report[batch]}")

    cnt = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
    print("\n" + "=" * 62)
    print("采集完成：")
    for b, n in report.items():
        print(f"  {b}: +{n}")
    print(f"  本次新增 {total} 条 · 数据库累计 {cnt} 条")

    # 导出 JSON
    rows = conn.execute(
        "SELECT account,title,summary,pub_time,source_url,resolved_url,full_text,low_value "
        "FROM articles ORDER BY pub_time DESC"
    ).fetchall()
    data = [{"account": r[0], "title": r[1], "summary": r[2], "pub_time": r[3],
             "url": r[4], "resolved_url": r[5], "full_text": r[6] or "", "low_value": r[7]}
            for r in rows]
    with open(os.path.join(DATA_DIR, "usst_articles.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"JSON 已导出（{len(data)} 条）")
    conn.close()


if __name__ == "__main__":
    main()
