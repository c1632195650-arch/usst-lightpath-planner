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
import numpy as np
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
    """按句子边界分块，标题前置到每块；下一块以上一块末尾约 overlap 字的完整句子开头（跨块上下文连续）"""
    text = (text or "").strip()
    if not text:
        return []
    # 按句号/换行/分号切句
    sents = [s for s in re.split(r'(?<=[。！？!?；;\n])', text) if s.strip()]
    chunks, cur_sents = [], []
    for s in sents:
        if sum(len(x) for x in cur_sents) + len(s) <= max_len:
            cur_sents.append(s)
            continue
        if cur_sents:
            chunks.append("".join(cur_sents).strip())
            # 取当前块末尾约 overlap 字的完整句子作为下一块开头
            tail, acc = [], ""
            for prev in reversed(cur_sents):
                acc = prev + acc
                tail.insert(0, prev)
                if len(acc) >= overlap:
                    break
        else:
            tail = []  # 单句超长，只能硬切
        head = "".join(tail)
        cur_sents = [head + s] if len(head) + len(s) <= max_len else [s]
    if cur_sents:
        chunks.append("".join(cur_sents).strip())
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

    # 1. 分词列（仅主条目 is_dup=0；同时排除 low_value=1 的行政公示/招标类噪音）
    #    无全文时用 summary 兜底，保证「标题+摘要」仍可检索
    rows = conn.execute(
        "SELECT id, account, title, full_text, summary FROM articles "
        "WHERE is_dup=0 AND COALESCE(low_value,0)=0"
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

# 查询扩展：口语 → 官方术语（弥合"大功率"对不上"违规电器/额定功率"的词汇鸿沟）
_QUERY_EXPAND = [
    ("大功率", "违规电器 额定功率 400W 宿管会 检查条例 电热毯 电煮锅"),
    ("断电", "熄灯 供电 用电 宿舍管理"),
    ("门禁", "关门 关门时间 宿舍 进出 晚归"),
    ("断网", "校园网 网络 USSTroam 无线"),
    ("断水", "供水 水电 宿舍"),
    ("能不能用", "是否允许 违规 禁止"),
    ("可以带", "是否允许 违规 禁止"),
    ("多少钱", "收费 标准 费用 价格"),
    ("几号", "日期 时间"),
    ("几点关", "开放时间 结束 闭馆"),
    ("怎么预约", "预约流程 预约方式 申请 系统"),
    ("在哪", "位置 地点 地址 位于"),
    ("怎么走", "路线 位置 交通"),
    ("补办", "挂失 重新办理 流程"),
    ("重修", "重修报名 选课 流程"),
    ("挂科", "不及格 重修 补考"),
]


def expand_terms(query):
    """返回扩展出的官方术语列表（用于 OR 召回）"""
    if not query:
        return []
    terms = []
    for src, dst in _QUERY_EXPAND:
        if src in query:
            terms.extend(dst.split())
    # 去重保序
    seen, out = set(), []
    for t in terms:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def search(query, k=5, top_fts=20, top_vec=20):
    conn = sqlite3.connect(DB_PATH)

    # 1) FTS5 关键词（原查询，AND 语义，保证精确性）
    fts_hits = {}
    try:
        q = " ".join(jieba.cut(query))
        for r in conn.execute(
            "SELECT rowid, bm25(articles_fts) AS score FROM articles_fts "
            "WHERE articles_fts MATCH ? ORDER BY score LIMIT ?", (q, top_fts)
        ):
            fts_hits[r[0]] = -r[1]  # bm25 越小越相关，取负转正
    except Exception as e:
        print(f"[rag] FTS5 原查询检索失败（降级为仅向量）: {e!r}", file=sys.stderr)

    # 1b) 扩展召回：口语→官方术语，OR 语义（FTS5 空格是 AND，扩展词必须走 OR 否则反而漏召）
    #     分数打 0.6 折，避免盖过原查询的精确命中
    try:
        terms = expand_terms(query)
        if terms:
            q2 = " OR ".join('"' + t + '"' for t in terms[:12])
            for r in conn.execute(
                "SELECT rowid, bm25(articles_fts) AS score FROM articles_fts "
                "WHERE articles_fts MATCH ? ORDER BY score LIMIT ?", (q2, top_fts)
            ):
                s = -r[1] * 0.6
                if s > fts_hits.get(r[0], 0):
                    fts_hits[r[0]] = s
    except Exception as e:
        print(f"[rag] FTS5 扩展词检索失败（降级为原查询结果）: {e!r}", file=sys.stderr)

    # 2) 向量语义（numpy 矩阵乘一次算完全部块的余弦；Python 循环在千级 chunk 时慢 10 倍以上）
    qv = np.asarray(embed_query(query), dtype=np.float32)
    qn = float(np.linalg.norm(qv))
    if qn > 0:
        qv = qv / qn  # 显式归一化，不假定模型输出已归一化
    vec_rows = conn.execute("SELECT id, article_id, vec FROM chunks").fetchall()
    vec_hits = {}
    if vec_rows:
        ids = np.array([r[0] for r in vec_rows])
        aids = np.array([r[1] for r in vec_rows])
        mat = np.frombuffer(b"".join(r[2] for r in vec_rows), dtype=np.float32).reshape(len(vec_rows), -1)
        sims = mat @ qv
        for i in np.argsort(-sims)[:top_vec]:
            vec_hits[int(ids[i])] = (int(aids[i]), float(sims[i]))

    # 3) 归并到文章级：向量得分 = 该文章最相关块的得分
    vec_article = {}
    best_chunk = {}   # aid -> (chunk_id, 原始余弦)，用于取回最相关片段
    for cid, (aid, s) in vec_hits.items():
        if aid not in vec_article or s > vec_article[aid]:
            vec_article[aid] = s
            best_chunk[aid] = (cid, s)

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
            # 最相关分块（比文章开头更贴题，作为给 LLM 的 snippet）
            best_txt = ""
            if aid in best_chunk:
                c = conn.execute(
                    "SELECT chunk_text FROM chunks WHERE id=?", (best_chunk[aid][0],)
                ).fetchone()
                if c:
                    best_txt = (c[0] or "").strip()
            out.append({
                "id": r[0], "account": r[1], "title": r[2], "pub_time": r[3],
                "score": round(score, 4),
                "raw_vec": round(vec_article.get(aid, 0.0), 4),
                "snippet": best_txt[:400],
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
