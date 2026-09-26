# -*- coding: utf-8 -*-
"""
健康知识库 · 独立检索层（Health KB retrieval）
==============================================
与 `method_rag.py`（方法库）、`rag.py`（上理库）**三方分离**。

分离的额外理由（本库独有）：
  1. 安全语义不同 —— 健康库必须先过「安全护栏」，再谈检索；
  2. 证据来源不同 —— 以官方指南为主（WHO/CDC/中国居民膳食指南/AASM…），需带指南年份；
  3. 个体差异更强 —— 同类问题对不同人的答案不同，故每条结果必须带「通用区间」声明。

★ 三层安全护栏（顺序即优先级，**先守门再检索**）：
  L0 危机/急症（urgent）  → 不检索，直接给急救口径（120 / 12356）
  L1 求医问诊（diagnosis）→ 不检索，转专业（不做诊断、不开药、不给剂量）
  L2 伪科学/危险做法（myth）→ 不检索，给纠正口径
  L3 一般问题 → 正常检索；若命中 consult 级红旗词，结果附「尽快就医」提示

对外接口：
  search(query, k=5)              -> list[dict]
  guard(query)                    -> dict(level, words, advice)  确定性，无外部调用
  build_index()                   -> None
  thresholds()                    -> (high, low)
"""
import os, re, sys, json, sqlite3, struct
import numpy as np

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
DB_PATH = os.path.join(BASE, "..", "data", "health_kb.db")

os.environ.setdefault("FASTEMBED_CACHE_PATH",
                      os.path.join(os.path.expanduser("~"), ".workbuddy", "cache", "fastembed"))

# 独立门限（2026-09-21 用 15 条健康域 + 12 条库外查询实测标定）：
#   IN 区间 0.594–0.877（均值 0.725）｜OUT 区间 0.328–0.605（均值 0.422）
#   两段之间唯一交叠是「自习坐一整天」（0.594，已用久坐扩展抬升）与
#   「食堂几点开门」（0.605，本就与三餐条目语义相邻），故门限取 0.63：
#   OUT 最高 0.605 < 0.63 < IN 次低 0.646。
HEALTH_RAW_HIGH = float(os.environ.get("HEALTH_RAW_HIGH", "0.70"))
HEALTH_RAW_LOW = float(os.environ.get("HEALTH_RAW_LOW", "0.63"))


def thresholds():
    return HEALTH_RAW_HIGH, HEALTH_RAW_LOW


# ============================================================
# 一、安全护栏（纯函数、确定性、不检索）
# ============================================================
import health_kb_data as DATA


def red_flag_hits(query):
    """返回 (level, [命中词])；level ∈ None | 'urgent' | 'consult'。"""
    q = query or ""
    urgent = [w for w in DATA.RED_FLAGS["urgent"] if w in q]
    if urgent:
        return "urgent", urgent
    consult = [w for w in DATA.RED_FLAGS["consult"] if w in q]
    if consult:
        return "consult", consult
    return None, []


def is_diagnosis_request(query):
    """求医问诊类：『我是不是得了…』『吃什么药』『帮我看化验单』。"""
    q = query or ""
    return any(p in q for p in DATA.DIAGNOSIS_PATTERNS)


# 规则式匹配（不是简单子串）：每条给触发词 + 固定的纠正文案。
# 触发词宁可保守（别把正常的「出汗」「运动 30 分钟」误判成迷思）。
MYTH_RULES = [
    {"id": "detox", "words": ["排毒", "断食排毒", "排毒餐", "清宿便"],
     "correction": "「排毒/断食排毒」没有科学依据：代谢废物由肝肾完成清除，没有任何食物或产品能『排毒』；极端断食还会带来电解质紊乱与进食障碍风险。"},
    {"id": "fatburn30", "words": ["才开始燃脂", "才燃脂", "30分钟才", "三十分钟才", "燃脂30分钟", "半小时才"],
     "correction": "「运动 30 分钟后才开始燃脂」是错的：能量消耗从第一分钟就发生，脂肪供能比例随强度与时间连续变化，不存在 30 分钟开关。"},
    {"id": "sweat", "words": ["汗蒸", "出汗排毒", "暴汗服", "发汗减肥"],
     "correction": "出汗不是排毒、汗蒸不减肥：汗液主要是水与电解质，减的是水分不是脂肪，且有脱水风险。"},
    {"id": "device", "words": ["塑身衣", "甩脂机", "震动带", "震动腰带", "燃脂腰带", "被动运动"],
     "correction": "塑身衣、甩脂机、震动带这类被动器械减脂缺乏可靠证据，也不会带来局部减脂；体重变化只能来自能量缺口。"},
    {"id": "melatonin", "words": ["褪黑素"],
     "correction": "褪黑素不是通用安眠药：它主要调节昼夜节律（对倒时差、节律延迟更合适），剂量与适应证属于医疗决策；长期失眠应走 CBT-I 与专业评估。"},
    {"id": "alcohol", "words": ["喝酒助眠", "睡前喝酒", "睡前饮酒", "喝酒帮助睡眠", "喝酒好睡", "睡前喝点酒"],
     "correction": "喝酒助眠是假象：酒精缩短入睡时间，却破坏后半夜睡眠结构、加重打鼾与夜尿。"},
]
# 组合规则：单看「酒」太宽（睡前喝牛奶也可能带「酒」字旁的语境），
# 必须**同时**出现酒与睡眠语义才判为迷思。
MYTH_COMBO_RULES = [
    {"id": "alcohol-combo", "all": ["酒", "睡"], "correction":
        "喝酒助眠是假象：酒精虽让人更快睡着，却破坏后半夜睡眠结构、加重打鼾与夜尿，"
        "《中国居民膳食指南》也不建议用饮酒助眠。"},
]


def is_myth(query):
    """返回命中的规则列表（每条含 correction）。"""
    q = query or ""
    hits = [r for r in MYTH_RULES if any(w in q for w in r["words"])]
    for r in MYTH_COMBO_RULES:
        if all(w in q for w in r["all"]):
            if not any(h["id"].startswith("alcohol") for h in hits):
                hits.append(r)
    return hits


def myth_correction(rules):
    """L2 纠正口径（文案写死在规则里，不让 LLM 自由发挥）。"""
    lines = ["先说结论：下面这些是流行说法，不是有效方法 ——"]
    for r in rules:
        lines.append("· " + r["correction"])
    lines.append("真正有效、也被官方指南支持的路子是：规律作息 + 每周 150 分钟以上中等强度活动 "
                 "+ 按《中国居民膳食指南（2022）》安排三餐 + 每晚睡够 7 小时。")
    return "\n".join(lines)


def urgent_advice(words):
    """L0 危机/急症口径：不给自我处理方案，只给行动指令。"""
    suicide = any(w in ("自杀", "想死", "不想活", "轻生", "自伤", "割腕", "跳楼", "结束生命")
                  for w in words)
    lines = []
    if suicide:
        lines.append("先说最重要的：如果你现在有伤害自己的念头，请立刻求助，不要一个人扛 ——")
        lines.append("· 全国统一心理援助热线 **12356**（24 小时，可匿名）")
        lines.append("· 情况紧急或身边有人正要行动 → 同时拨打 **110 / 120**")
        lines.append("· 尽量让信任的人陪在你身边，把可能用到的物品交给别人保管")
        lines.append("我不会替你判断严重程度，也不提供自我处理方案 —— 但请你现在就拨这个电话。")
    else:
        lines.append("这些症状属于**需要紧急医学评估**的信号，不要靠休息观察硬扛：")
        lines.append("· 胸痛/压榨感持续不缓解、伴冷汗或放射到左臂下颌 → 立即拨打 **120**")
        lines.append("· 突发言语不清、口角歪斜、一侧肢体无力 → 按卒中处理，立即 **120**")
        lines.append("· 晕厥、呼吸困难、大量出血、抽搐 → 立即 **120**")
        lines.append("我已停止检索健康建议 —— 这类情况的正确动作是叫急救，不是查资料。")
    return "\n".join(lines)


def consult_notice(words):
    """L3 附带的『尽快就医』提示（不阻断检索）。"""
    return ("提示：你提到的「" + "、".join(words[:3]) + "」属于建议尽快就医评估的情况；"
            "下面是通用常识，不能替代医生的判断，请把它当成就诊前的整理，不是处理方案。")


def diagnosis_refusal():
    """L1 拒答口径：不诊断、不开药、不给剂量。"""
    return ("这类问题我不能替你下结论：诊断、用药选择、剂量与检查报告解读都必须由医生"
            "结合你的病史和查体来做。我可以帮你做的是：整理清楚症状出现的时间与诱因、"
            "列出就诊时该问医生的问题、告诉你该挂什么科。")


# 注：myth_correction 已在上方按 MYTH_RULES 实现（文案写死在规则里）。


def guard(query):
    """统一入口：一次性给出本轮应走的口径。确定性、不检索、不调模型。

    ⚠️ HEALTH_GUARD_DISABLE=1 只用于**反向验证**（证明「拆掉护栏 → 金标必红」），
       生产环境不该出现这个环境变量。
    """
    if os.environ.get("HEALTH_GUARD_DISABLE") == "1":
        return {"level": "ok", "words": [], "advice": "", "block": False}
    level, words = red_flag_hits(query)
    if level == "urgent":
        return {"level": "urgent", "words": words, "advice": urgent_advice(words), "block": True}
    if is_diagnosis_request(query):
        return {"level": "diagnosis", "words": [], "advice": diagnosis_refusal(), "block": True}
    myths = is_myth(query)
    if myths:
        return {"level": "myth", "words": [r["id"] for r in myths],
                "advice": myth_correction(myths), "block": True}
    if level == "consult":
        return {"level": "consult", "words": words, "advice": consult_notice(words), "block": False}
    return {"level": "ok", "words": [], "advice": "", "block": False}


# ============================================================
# 二、检索（复用方法库的分词与向量实例；库与门限独立）
# ============================================================
import jieba
jieba.setLogLevel(60)
for w in ["睡眠卫生", "昼夜节律", "社交时差", "入睡潜伏期", "睡眠限制", "刺激控制",
          "认知行为治疗", "失眠", "呼吸暂停", "中等强度", "高强度", "抗阻训练",
          "力量训练", "渐进超负荷", "久坐", "膳食指南", "膳食宝塔", "添加糖",
          "反式脂肪", "食盐", "蛋白质", "行为激活", "正念", "筛查量表",
          "心理援助热线", "进食障碍"]:
    jieba.add_word(w)

import method_rag as _MR  # 只复用分词/嵌入实现，DB 与门限仍然独立


def seg(text):
    return _MR.seg(text)


def fts_query(query):
    return _MR.fts_query(query)


def embed_query(q):
    return _MR.embed_query(q)


def embed_docs(docs, batch_size=32):
    return _MR.embed_docs(docs, batch_size=batch_size)


COLLOQUIAL_EXPAND = [
    (re.compile(r"睡不好|睡不着|失眠|熬夜|通宵|早八"), "睡眠 入睡 作息 睡眠卫生"),
    (re.compile(r"没劲|没精神|犯困|总是困|累"), "疲劳 睡眠不足 活动量"),
    (re.compile(r"胖了|减肥|减脂|瘦身|体重"), "体重管理 能量缺口 身体活动"),
    (re.compile(r"焦虑|紧张|压力大|心慌|emo|崩溃"), "压力 情绪 焦虑 应对"),
    (re.compile(r"坐一整天|坐久了|一直坐着|久坐|不动[一会]?[儿]?"), "久坐 身体活动 步数"),
    (re.compile(r"补觉|补回来|周末睡|熬了夜"), "睡眠债 睡眠剥夺 作息规律"),
    (re.compile(r"突击训练|体测|加练|临时抱佛脚"), "训练负荷 循序渐进 运动损伤"),
    (re.compile(r"吃什么|怎么吃|食堂|外卖"), "膳食 三餐 食物多样"),
]


def expand_query(q):
    extra = [kw for pat, kw in COLLOQUIAL_EXPAND if pat.search(q or "")]
    if not extra:
        return q
    return q + "。" + "。".join(extra)


# ---------- 建索引 ----------
def build_index():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, slug, title, summary, principle, steps, domain, evidence_tier, status, escalate "
        "FROM entries WHERE status != 'deprecated'"
    ).fetchall()
    if not rows:
        conn.close()
        print("[health] entries 为空，先跑 build_health_kb.py seed")
        return

    seg_map = {}
    for eid, slug, title, summary, principle, steps, domain, tier, status, esc in rows:
        text = "。".join(x for x in [
            title, f"领域：{domain}", summary or "", principle or ""] if x)
        seg_map[eid] = seg(text)
        conn.execute("UPDATE entries SET seg_text=? WHERE id=?", (seg_map[eid], eid))
    conn.commit()

    conn.execute("DROP TABLE IF EXISTS entries_fts")
    conn.execute("CREATE VIRTUAL TABLE entries_fts USING fts5(title, summary, seg_text, tokenize='unicode61')")
    for eid, slug, title, summary, principle, steps, domain, tier, status, esc in rows:
        conn.execute("INSERT INTO entries_fts(rowid, title, summary, seg_text) VALUES(?,?,?,?)",
                     (eid, title, summary or "", seg_map[eid]))
    conn.commit()
    n_fts = conn.execute("SELECT count(*) FROM entries_fts").fetchone()[0]

    conn.execute("DROP TABLE IF EXISTS chunks")
    conn.execute("""CREATE TABLE chunks(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        vec BLOB NOT NULL)""")
    docs = []
    for eid, slug, title, summary, principle, steps, domain, tier, status, esc in rows:
        try:
            steps_list = json.loads(steps) if isinstance(steps, str) and steps else []
        except Exception:
            steps_list = []
        full = "。".join(x for x in [
            title, summary or "", principle or "",
            "怎么做：" + "；".join(str(s) for s in steps_list) if steps_list else ""] if x)
        docs.append((eid, full))
    embs = embed_docs([d[1] for d in docs], batch_size=32)
    for (eid, c), v in zip(docs, embs):
        conn.execute("INSERT INTO chunks(entry_id, chunk_text, vec) VALUES(?,?,?)",
                     (eid, c, struct.pack(f"{len(v)}f", *v)))
    conn.commit()
    conn.close()
    print(f"[health] FTS5 {n_fts} 条｜向量块 {len(embs)} 个（{len(embs[0])} 维）✅")


def _row_to_dict(r):
    (eid, slug, type_, domain, title, summary, principle, steps,
     params, app_when, contra, tier, citation, status, esc) = r

    def _j(x, d):
        try:
            return json.loads(x) if x else d
        except Exception:
            return d
    return {
        "id": eid, "slug": slug, "type": type_, "domain": domain,
        "title": title, "summary": summary, "principle": principle,
        "steps": _j(steps, []), "parameters": _j(params, {}),
        "applicable_when": _j(app_when, []), "contraindications": contra or "",
        "evidence_tier": tier, "citation": _j(citation, {}),
        "status": status, "escalate": bool(esc),
    }


def search(query, k=5, top_fts=20, top_vec=20):
    """混合检索（FTS 0.4 / 向量 0.6，无时效衰减）。

    守门优先：guard() 判定 block 的查询直接返回空列表 —— 由对话层走对应口径，
    检索层一条结果都不给，避免给危险做法或伪科学背书。
    """
    g = guard(query)
    if g["block"]:
        return []
    query_eff = expand_query(query)
    conn = sqlite3.connect(DB_PATH)

    fts_hits = {}
    try:
        q = fts_query(query_eff)
        if q:
            for r in conn.execute(
                "SELECT rowid, bm25(entries_fts) AS score FROM entries_fts "
                "WHERE entries_fts MATCH ? ORDER BY score LIMIT ?", (q, top_fts)):
                fts_hits[r[0]] = -r[1]
    except Exception as e:
        print(f"[health] FTS5 检索失败（降级为仅向量）: {e!r}", file=sys.stderr)

    qv = np.asarray(embed_query(query_eff), dtype=np.float32)
    qn = float(np.linalg.norm(qv))
    if qn > 0:
        qv = qv / qn
    vec_rows = conn.execute("SELECT id, entry_id, vec FROM chunks").fetchall()
    vec_entry, best_chunk = {}, {}
    if vec_rows:
        ids = np.array([r[0] for r in vec_rows])
        eids = np.array([r[1] for r in vec_rows])
        mat = np.frombuffer(b"".join(r[2] for r in vec_rows), dtype=np.float32).reshape(len(vec_rows), -1)
        sims = mat @ qv
        for i in np.argsort(-sims)[:top_vec]:
            cid, eid, s = int(ids[i]), int(eids[i]), float(sims[i])
            if eid not in vec_entry or s > vec_entry[eid]:
                vec_entry[eid] = s
                best_chunk[eid] = cid

    def norm(d):
        if not d:
            return {}
        mx = max(d.values()) or 1
        return {k: v / mx for k, v in d.items()}
    nf, nv = norm(fts_hits), norm(vec_entry)
    merged = {eid: 0.4 * nf.get(eid, 0) + 0.6 * nv.get(eid, 0) for eid in set(nf) | set(nv)}
    ranked = sorted(merged.items(), key=lambda x: -x[1])[:max(k * 3, k)]

    out = []
    for eid, score in ranked:
        r = conn.execute(
            "SELECT id, slug, type, domain, title, summary, principle, steps, parameters, "
            "applicable_when, contraindications, evidence_tier, citation, status, escalate "
            "FROM entries WHERE id=?", (eid,)).fetchone()
        if not r:
            continue
        d = _row_to_dict(r)
        d["score"] = round(score, 4)
        d["raw_vec"] = round(vec_entry.get(eid, 0.0), 4)
        cid = best_chunk.get(eid)
        d["snippet"] = (conn.execute("SELECT chunk_text FROM chunks WHERE id=?", (cid,)).fetchone() or [""])[0] \
            if cid else (d["summary"] or "")
        out.append(d)
    conn.close()
    return out[:k]


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "search"
    if cmd == "build":
        build_index()
    elif cmd == "guard":
        q = sys.argv[2] if len(sys.argv) > 2 else ""
        g = guard(q)
        print(f"level={g['level']} block={g['block']} words={g['words']}")
        if g["advice"]:
            print(g["advice"])
    elif cmd == "search":
        q = sys.argv[2] if len(sys.argv) > 2 else "每天应该睡多久"
        k = int(sys.argv[3]) if len(sys.argv) > 3 else 5
        hi, lo = thresholds()
        print(f"查询：{q}  （门限 high={hi} low={lo}）\n" + "=" * 56)
        for i, it in enumerate(search(q, k), 1):
            flag = "🚩" if it["escalate"] else "  "
            print(f"\n[{i}] {flag} {it['title']}  score={it['score']} raw_vec={it['raw_vec']} "
                  f"[{it['evidence_tier']}/{it['status']}]")
            print(f"    {it['summary']}")
    else:
        print("用法: python health_rag.py build | guard \"查询\" | search \"查询\" [k]")
