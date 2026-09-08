# -*- coding: utf-8 -*-
"""
梨宝 · 分层记忆层
==================
解决「大模型介入时没有记忆 / 每次都重新压缩」的问题。三层结构：

  L2 长期画像  profiles  跨会话留存：年级/学院/课程/弱项/口味偏好…
  L1 会话摘要  sessions  **增量**压缩（旧摘要 + 新增几轮 → 新摘要，不重算全量）
  L0 短期原文  messages  最近 K 轮原文，保证细节不丢

压缩触发：每累积 SUMMARIZE_EVERY 轮才压一次，且只压"上次压缩后的增量"。
无 LLM Key 时自动降级为规则摘要（拼接+截断），功能不残废。

对外接口：
  memory_context(user_id, session_id)  -> 拼好的记忆上下文字符串
  remember(user_id, session_id, role, content)  -> 落库并按需增量压缩
"""
import os, re, json, sqlite3, datetime

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "..", "data", "libao_memory.db")

SUMMARIZE_EVERY = 4      # 每累积 4 轮压缩一次（不是每轮都压）
RECENT_TURNS = 6         # 短期保留最近 6 条消息

# ---------- 环境变量（与 app.py 同套） ----------
def _load_env():
    p = os.path.join(_HERE, ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

_load_env()
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "deepseek-chat")

# ---------- 建库 ----------
def _conn():
    c = sqlite3.connect(DB_PATH)
    c.execute("""CREATE TABLE IF NOT EXISTS profiles(
        user_id TEXT PRIMARY KEY, profile TEXT, updated_at TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS sessions(
        session_id TEXT PRIMARY KEY, user_id TEXT, summary TEXT,
        turn_count INTEGER DEFAULT 0, last_summarized_turn INTEGER DEFAULT 0,
        updated_at TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS messages(
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT,
        content TEXT, created_at TEXT)""")
    return c

# ---------- L2 长期画像 ----------
# 规则抽取：省 token、延迟低，覆盖 80% 常见自我介绍
_RULES = {
    "grade":   r"(大一|大二|大三|大四|大五|研一|研二|研三|新生)",
    "college": r"([\u4e00-\u9fff]{2,6}学院)",
    "major":   r"([\u4e00-\u9fff]{2,12}专业)",
    "weak":    r"(高数|高等数学|英语|C语言|物理|线代|线性代数)[^。！？]{0,8}(不好|很差|听不懂|挂科|不会|难|菜|头疼)",
    "like":    r"(喜欢|爱吃|偏好)([^。！？]{1,12})",
    "dislike": r"(不吃|讨厌|忌口|过敏)([^。！？]{1,12})",
}
_COURSES = ["高等数学", "高数", "C语言", "C 语言", "大学英语", "线性代数", "概率论",
            "大学物理", "数据结构", "毛概", "马原", "体育"]

def extract_facts(text):
    """从一句话里规则抽取画像片段（抽不到就返回空 dict，交给 LLM 兜）"""
    t = text or ""
    out = {}
    g = re.search(_RULES["grade"], t)
    if g:
        out["grade"] = g.group(1)
    c = re.search(_RULES["college"], t)
    if c:
        out["college"] = c.group(1)
    m = re.search(_RULES["major"], t)
    if m:
        out["major"] = m.group(1)
    w = re.search(_RULES["weak"], t)
    if w:
        out.setdefault("weak", [])
        if isinstance(out["weak"], list) and w.group(1) not in out["weak"]:
            out["weak"].append(w.group(1))
    lk = re.search(_RULES["like"], t)
    if lk:
        out.setdefault("preferences", {})["喜欢"] = lk.group(2).strip()
    dk = re.search(_RULES["dislike"], t)
    if dk:
        out.setdefault("preferences", {})["忌口"] = dk.group(2).strip()
    found = [c for c in _COURSES if c in t]
    if found:
        out["courses"] = found
    return out

def get_profile(user_id):
    c = _conn()
    r = c.execute("SELECT profile FROM profiles WHERE user_id=?", (user_id,)).fetchone()
    c.close()
    return json.loads(r[0]) if r and r[0] else {}

def save_profile(user_id, profile):
    c = _conn()
    c.execute("INSERT INTO profiles(user_id, profile, updated_at) VALUES(?,?,?) "
              "ON CONFLICT(user_id) DO UPDATE SET profile=excluded.profile, updated_at=excluded.updated_at",
              (user_id, json.dumps(profile, ensure_ascii=False),
               datetime.datetime.now().isoformat(timespec="seconds")))
    c.commit(); c.close()

def update_profile(user_id, text):
    """规则抽取 + 合并进长期画像（去重累积）"""
    facts = extract_facts(text)
    if not facts:
        return {}
    p = get_profile(user_id)
    for k, v in facts.items():
        if k in ("weak", "courses"):
            cur = p.get(k, [])
            p[k] = list(dict.fromkeys(cur + (v if isinstance(v, list) else [v])))
        elif k == "preferences":
            p.setdefault("preferences", {}).update(v)
        else:
            p[k] = v
    save_profile(user_id, p)
    return facts

# ---------- L1 会话摘要（增量） ----------
def _session_row(sid):
    c = _conn()
    r = c.execute("SELECT summary, turn_count, last_summarized_turn FROM sessions WHERE session_id=?",
                  (sid,)).fetchone()
    c.close()
    return r or ("", 0, 0)

def get_summary(sid):
    return _session_row(sid)[0]

def _llm_summarize(old_summary, new_turns):
    """增量压缩：旧摘要 + 新增对话 → 新摘要（不是全量重算）"""
    if not LLM_API_KEY:
        # 降级：规则拼接截断
        joined = " ".join(f"{r}:{t}" for r, t in new_turns)
        return (old_summary + " " + joined)[-400:]
    try:
        import requests
        conv = "\n".join(f"{'用户' if r == 'user' else '梨宝'}: {t}" for r, t in new_turns)
        prompt = (
            "【已有摘要】\n" + (old_summary or "（无）") +
            "\n\n【新增对话】\n" + conv +
            "\n\n请把「已有摘要」与「新增对话」合并成一条更新后的摘要：\n"
            "1) 保留用户身份、已确认的事实、待办与偏好；2) 去掉寒暄和重复；"
            "3) 中文，200 字以内；4) 只输出摘要本身，不要解释。"
        )
        r = requests.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
            json={"model": LLM_MODEL,
                  "messages": [{"role": "user", "content": prompt}],
                  "temperature": 0.3, "max_tokens": 300},
            timeout=30)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print("[memory] 摘要失败，降级：", e)
        joined = " ".join(f"{r}:{t}" for r, t in new_turns)
        return (old_summary + " " + joined)[-400:]

def maybe_summarize(sid, force=False):
    """达到阈值才压缩，且只压增量部分"""
    old, total, last = _session_row(sid)
    if not force and total - last < SUMMARIZE_EVERY:
        return old
    c = _conn()
    rows = c.execute(
        "SELECT role, content FROM messages WHERE session_id=? ORDER BY id", (sid,)
    ).fetchall()
    c.close()
    new_turns = rows[last:]
    if not new_turns:
        return old
    new_sum = _llm_summarize(old, new_turns)
    c = _conn()
    c.execute("UPDATE sessions SET summary=?, last_summarized_turn=? WHERE session_id=?",
              (new_sum, total, sid))
    c.commit(); c.close()
    return new_sum

# ---------- L0 短期原文 ----------
def add_message(sid, uid, role, content):
    c = _conn()
    now = datetime.datetime.now().isoformat(timespec="seconds")
    c.execute("INSERT INTO messages(session_id, role, content, created_at) VALUES(?,?,?,?)",
              (sid, role, content, now))
    c.execute("INSERT INTO sessions(session_id, user_id, turn_count, updated_at) VALUES(?,?,1,?) "
              "ON CONFLICT(session_id) DO UPDATE SET turn_count=turn_count+1, updated_at=excluded.updated_at",
              (sid, uid, now))
    c.commit(); c.close()

def recent_messages(sid, k=RECENT_TURNS):
    c = _conn()
    rows = c.execute(
        "SELECT role, content FROM messages WHERE session_id=? ORDER BY id DESC LIMIT ?", (sid, k)
    ).fetchall()
    c.close()
    return list(reversed(rows))

# ---------- 对外：拼接三层记忆 ----------
def remember(user_id, session_id, role, content):
    """落库 + 抽画像 + 按需增量压缩（一个入口搞定）"""
    add_message(session_id, user_id, role, content)
    facts = {}
    if role == "user":
        facts = update_profile(user_id, content)
    maybe_summarize(session_id)
    return facts

def memory_context(user_id, session_id):
    """返回给 LLM 的记忆上下文（三层拼接）"""
    blocks = []
    prof = get_profile(user_id)
    if prof:
        bits = []
        for k in ("grade", "college", "major"):
            if prof.get(k):
                bits.append(prof[k])
        if prof.get("courses"):
            bits.append("在学：" + "、".join(prof["courses"][:6]))
        if prof.get("weak"):
            bits.append("自认薄弱：" + "、".join(prof["weak"][:4]))
        if prof.get("preferences"):
            bits.append("偏好：" + "、".join(f"{k}={v}" for k, v in prof["preferences"].items()))
        if bits:
            blocks.append("[关于这位同学·长期记忆]\n" + "；".join(bits))
    summ = get_summary(session_id)
    if summ:
        blocks.append("[本次聊天前面的内容·已压缩]\n" + summ)
    recent = recent_messages(session_id)
    if recent:
        lines = "\n".join(f"{'用户' if r == 'user' else '梨宝'}：{t}" for r, t in recent)
        blocks.append("[最近几轮原话]\n" + lines)
    return "\n\n".join(blocks)
