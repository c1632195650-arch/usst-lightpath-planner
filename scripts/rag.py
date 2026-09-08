# -*- coding: utf-8 -*-
"""
上理生活助手 · RAG 检索层（阶段 3）
====================================
对 data/usst_articles.db 里的公众号全文：
  1. jieba 中文分词 → FTS5 关键词索引
  2. bge-small-zh-v1.5 → 分块向量（余弦相似度）
  3. search(query) 混合检索：FTS5 BM25 + 向量，返回 top-k 文章

用法：
  python scripts/rag.py build               # 建索引（FTS5 + 向量）
  python scripts/rag.py search "四六级什么时候报名" [k]
"""
import os, re, sys, io, sqlite3, struct, math, json
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "..", "data", "usst_articles.db")

# 向量模型缓存固定到常驻目录（默认在 Temp，重启会丢，导致重新下载 95MB）
os.environ.setdefault("FASTEMBED_CACHE_PATH",
                      os.path.join(os.path.expanduser("~"), ".workbuddy", "cache", "fastembed"))

# ---------- 中文分词 ----------
import jieba
jieba.setLogLevel(60)  # 关掉 jieba 日志
CAMPUS_WORDS = ["四六级", "光电杯", "短学期", "三学期", "选课", "重修", "基础学部", "学生汇",
    "校历", "体测", "体锻", "自习", "食堂", "宿舍", "报到", "迎新", "保研", "综测", "学分",
    "双学位", "辅修", "转专业", "补考", "缓考", "WeLink", "welink", "上理", "小喇叭", "球知道",
    "体育教学部", "军工路", "复兴路", "营口路", "短驳", "班车", "脱单", "期末", "期中", "考试周",
    "复试", "专升本", "考研", "国家奖学金", "力量举", "跳绳社", "篮球裁判"]
for w in CAMPUS_WORDS:
    jieba.add_word(w)

def seg(text):
    if not text:
        return ""
    return " ".join(jieba.cut(text))

# ---------- 向量嵌入 ----------
EMBED_MODEL = "BAAI/bge-small-zh-v1.5"
QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章："

_model = None

def get_model():
    global _model
    if _model is None:
        from fastembed import TextEmbedding
        _model = TextEmbedding(model_name=EMBED_MODEL)
    return _model

def embed_docs(docs, batch_size=32):
    """文档向量（bge 无需前缀）"""
    m = get_model()
    return [v.tolist() for v in m.embed(list(docs), batch_size=batch_size)]

def embed_query(q):
    """查询向量（bge 需加前缀）"""
    m = get_model()
    if hasattr(m, "query_embed"):
        return list(m.query_embed(q))[0].tolist()
    # 兜底：手动加前缀
    return list(m.embed([QUERY_PREFIX + q]))[0].tolist()

# ---------- 分块 ----------
def chunk_text(text, title="", max_len=500, overlap=80):
    """按句子边界分块，标题前置到每块"""
    text = (text or "").strip()
    if not text:
        return []
    # 按句号/换行/分号切句
    sents = re.split(r'(?<=[。！？!?；;\n])', text)
    chunks, cur = [], ""
    for s in sents:
        if len(cur) + len(s) <= max_len:
            cur += s
        else:
            if cur.strip():
                chunks.append(cur.strip())
            cur = s
    if cur.strip():
        chunks.append(cur.strip())
    # 标题前置
    if title:
        chunks = [(title + "。" + c) if not c.startswith(title) else c for c in chunks]
    return chunks

# ---------- 建索引 ----------
def build():
    conn = sqlite3.connect(DB_PATH)
    # 0. 字段容错
    cols = {r[1] for r in conn.execute("PRAGMA table_info(articles)")}
    if "seg_text" not in cols:
        conn.execute("ALTER TABLE articles ADD COLUMN seg_text TEXT")
    if "is_dup" not in cols:
        conn.execute("ALTER TABLE articles ADD COLUMN is_dup INTEGER DEFAULT 0")
    conn.commit()

    # 1. 分词列（仅主条目 is_dup=0，排除 DB 层去重掉的转载）
    #    无全文时用 summary 兜底，保证「标题+摘要」仍可检索
    rows = conn.execute(
        "SELECT id, account, title, full_text, summary FROM articles WHERE is_dup=0"
    ).fetchall()
    seg_map = {}
    for aid, acct, title, ft, sm in rows:
        body = (ft or "").strip() or (sm or "").strip()
        s = seg(title + "。" + body)
        seg_map[aid] = s
        conn.execute("UPDATE articles SET seg_text=? WHERE id=?", (s, aid))
    conn.commit()
    print(f"[主条目] {len(rows)} 篇（已排除 is_dup=1 转载重复）")

    # 2. FTS5（独立表，rowid=article id，仅主条目；外部内容表 rebuild 会连重复行一起索引，故不用）
    conn.execute("DROP TABLE IF EXISTS articles_fts")
    conn.execute(
        "CREATE VIRTUAL TABLE articles_fts USING fts5(account, title, seg_text, tokenize='unicode61')"
    )
    for aid, acct, title, ft, sm in rows:
        conn.execute(
            "INSERT INTO articles_fts(rowid, account, title, seg_text) VALUES(?,?,?,?)",
            (aid, acct, title, seg_map[aid]),
        )
    conn.commit()
    n_fts = conn.execute("SELECT count(*) FROM articles_fts").fetchone()[0]
    print(f"[FTS5] 索引建立：{n_fts} 篇")

    # 3. 分块 + 向量（仅主条目）
    conn.execute("DROP TABLE IF EXISTS chunks")
    conn.execute("""
        CREATE TABLE chunks(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id INTEGER NOT NULL,
            chunk_text TEXT NOT NULL,
            vec BLOB NOT NULL
        )""")
    docs = []  # (article_id, chunk_text)
    for aid, acct, title, ft, sm in rows:
        body = (ft or "").strip() or (sm or "").strip()
        for c in chunk_text(body, title=title):
            docs.append((aid, c))
    print(f"[chunk] 共 {len(docs)} 块，开始嵌入…")
    embs = embed_docs([d[1] for d in docs], batch_size=32)
    for (aid, c), v in zip(docs, embs):
        blob = struct.pack(f"{len(v)}f", *v)
        conn.execute("INSERT INTO chunks(article_id, chunk_text, vec) VALUES(?,?,?)", (aid, c, blob))
    conn.commit()
    print(f"[vec] 已写入 {len(embs)} 条向量（{len(embs[0])} 维）")
    conn.close()
    print("✅ 索引构建完成")

# ---------- 同文去重 ----------
import difflib

def _norm_title(t):
    """标题归一化：仅保留中英文与数字，去掉标点/空白/括号装饰/前后缀噪声"""
    if not t:
        return ""
    t = t.lower()
    # 去掉方括号/书名号等装饰内容里的常见噪声词
    t = re.sub(r"[【\[].*?[】\]]", "", t)
    t = re.sub(r"[（(].*?[）)]", "", t)
    # 仅保留中文、英文字母、数字
    t = re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", t)
    return t

def _similar(a, b):
    """归一化后的标题相似度"""
    na, nb = _norm_title(a), _norm_title(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    return difflib.SequenceMatcher(None, na, nb).ratio()

def dedup_items(items, key="title", threshold=0.82):
    """按标题相似度去重，保留排在前（更相关）的一条"""
    out = []
    for it in items:
        t = it.get(key, "")
        if any(_similar(t, kept.get(key, "")) >= threshold for kept in out):
            continue
        out.append(it)
    return out

# ---------- 检索 ----------
def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    return dot  # 向量已归一化时即余弦

def search(query, k=5, top_fts=20, top_vec=20):
    conn = sqlite3.connect(DB_PATH)

    # 1) FTS5 关键词
    fts_hits = {}
    try:
        q = " ".join(jieba.cut(query))
        for r in conn.execute(
            "SELECT rowid, bm25(articles_fts) AS score FROM articles_fts "
            "WHERE articles_fts MATCH ? ORDER BY score LIMIT ?", (q, top_fts)
        ):
            fts_hits[r[0]] = -r[1]  # bm25 越小越相关，取负转正
    except Exception:
        pass

    # 2) 向量语义
    qv = embed_query(query)
    vec_hits = {}
    for cid, aid, blob in conn.execute("SELECT id, article_id, vec FROM chunks"):
        n = len(blob) // 4
        v = struct.unpack(f"{n}f", blob)
        vec_hits[cid] = (aid, cosine(qv, v))
    top_chunks = sorted(vec_hits.items(), key=lambda x: -x[1][1])[:top_vec]

    # 3) 归并到文章级：向量得分 = 该文章最相关块的得分
    vec_article = {}
    for cid, (aid, s) in top_chunks:
        if aid not in vec_article or s > vec_article[aid]:
            vec_article[aid] = s

    # 4) 混合排序：归一化后加权（FTS5 权重 0.4 / 向量 0.6），再乘时效因子
    def norm(d):
        if not d:
            return {}
        mx = max(d.values()) or 1
        return {k: v / mx for k, v in d.items()}

    nf, nv = norm(fts_hits), norm(vec_article)
    # 取每篇的发布时间用于时效加权
    pt = dict(conn.execute("SELECT id, pub_time FROM articles").fetchall())
    import datetime
    CUR = datetime.date.today()

    def recency(pub_time):
        """3 个月内不衰减；之后每 90 天减 0.1，下限 0.5（强相关旧文不被弱相关新文压掉）"""
        try:
            d = datetime.datetime.strptime((pub_time or "")[:10], "%Y-%m-%d").date()
            days = (CUR - d).days
            if days <= 90:
                return 1.0
            return max(0.5, 1.0 - 0.1 * ((days - 90) / 90))
        except Exception:
            return 0.7

    merged = {}
    for aid in set(nf) | set(nv):
        base = 0.4 * nf.get(aid, 0) + 0.6 * nv.get(aid, 0)
        merged[aid] = base * recency(pt.get(aid))
    # 多取候选（去重需要余量）
    ranked = sorted(merged.items(), key=lambda x: -x[1])[:max(k * 4, k)]

    # 取回文章详情
    out = []
    for aid, score in ranked:
        r = conn.execute(
            "SELECT id, account, title, pub_time, full_text, "
            "COALESCE(resolved_url, source_url) FROM articles WHERE id=?", (aid,)
        ).fetchone()
        if r:
            out.append({
                "id": r[0], "account": r[1], "title": r[2], "pub_time": r[3],
                "score": round(score, 4),
                "full_text": (r[4] or "")[:300],
                "url": r[5] or "",
            })
    conn.close()
    # 同文去重（多号转载同一篇只留最相关一条），再截到 k
    return dedup_items(out)[:k]

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "search"
    if cmd == "build":
        build()
    elif cmd == "search":
        q = sys.argv[2] if len(sys.argv) > 2 else "四六级报名"
        k = int(sys.argv[3]) if len(sys.argv) > 3 else 5
        print(f"查询：{q}\n" + "=" * 56)
        for i, it in enumerate(search(q, k), 1):
            print(f"\n[{i}] {it['title']}  (score={it['score']})")
            print(f"    [{it['account']} · {it['pub_time']}]")
            print(f"    {it['full_text'][:120]}")
    else:
        print("用法: python rag.py build | search \"查询\" [k]")
