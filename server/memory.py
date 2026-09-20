# -*- coding: utf-8 -*-
"""
梨宝 · 分层记忆层
==================
解决「大模型介入时没有记忆 / 每次都重新压缩」的问题。三层结构：

  L2 对话信号  profiles  跨会话留存：年级/学院/课程/弱项/口味偏好…
                         ⚠️ 术语注意：这里的 profile 是「对话中听来的信号」，
                         与前端 PersonaProfile（35 题测评产出的「基准画像」）是
                         两回事 —— 别再混用「画像」一个词指两种东西。
  L1 会话摘要  sessions  **增量**压缩（旧摘要 + 新增几轮 → 新摘要，不重算全量）
  L0 短期原文  messages  最近 K 轮原文，保证细节不丢

压缩触发：每累积 SUMMARIZE_EVERY 轮才压一次，且只压"上次压缩后的增量"。
无 LLM Key 时自动降级为规则摘要（拼接+截断），功能不残废。

事实回写（M2，2026-09-20）：从对话里抽到的事实分两类走两条路 ——
  · 偏好类（weak / preferences / courses）：自动并入 profiles，**可撤销**；
  · 客观事实（grade / college / major，身份类）：只挂起（facts 表 pending），
    **用户确认后才**并入 profiles —— AI 不得替用户拍板身份（core §4 L4）。
用户可随时在「记忆面板」查看 / 确认 / 拒绝 / 撤销 / 删除。

对外接口：
  memory_context(user_id, session_id)  -> 拼好的记忆上下文字符串
  remember(user_id, session_id, role, content)  -> 落库并按需增量压缩；
      user 轮额外返回 {"pending": [...], "applied": [...]}（给前端出卡片）
  propose_facts / confirm_fact / reject_fact / undo_fact / delete_fact / list_facts
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
    c.execute("""CREATE TABLE IF NOT EXISTS facts(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, kind TEXT,
        key TEXT, value TEXT, status TEXT, source TEXT,
        created_at TEXT, decided_at TEXT)""")
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
    """规则抽取 + 合并进长期画像（去重累积）。保留作兼容入口；
    对话主链路请用 propose_facts（带偏好/客观事实分流）。"""
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

# ---------- 事实回写（M2）：偏好自动生效可撤销，客观事实须确认 ----------
# 客观事实 = 身份类字段。AI 只能「提议」，用户确认后才进画像；
# 用户自己随时可改（前端基础信息卡），但 AI 永远不直接改写。
OBJECTIVE_KEYS = ("grade", "college", "major")

def _flatten_facts(facts):
    """extract_facts 的 dict → [(kind, key, value), …] 统一形态，便于落 facts 表。"""
    out = []
    for k, v in facts.items():
        if k in OBJECTIVE_KEYS:
            out.append(("objective", k, str(v)))
        elif k == "weak":
            for item in (v if isinstance(v, list) else [v]):
                out.append(("preference", f"weak.{item}", str(item)))
        elif k == "preferences":
            for label, item in v.items():
                out.append(("preference", f"preferences.{label}", str(item)))
        elif k == "courses":
            for item in (v if isinstance(v, list) else [v]):
                out.append(("preference", f"course.{item}", str(item)))
    return out

def _merge_into_profile(user_id, key, value):
    """单条事实并入 profiles（与 update_profile 同一套去重语义，纯增量）。"""
    p = get_profile(user_id)
    if key.startswith("weak."):
        cur = p.get("weak", [])
        if value not in cur:
            p["weak"] = cur + [value]
    elif key.startswith("preferences."):
        p.setdefault("preferences", {})[key.split(".", 1)[1]] = value
    elif key.startswith("course."):
        cur = p.get("courses", [])
        if value not in cur:
            p["courses"] = cur + [value]
    else:
        p[key] = value
    save_profile(user_id, p)

def _remove_from_profile(user_id, key, value):
    """撤销/删除时把画像里对应的一条也拿掉（不留幽灵数据）。"""
    p = get_profile(user_id)
    changed = False
    if key.startswith("weak.") and value in p.get("weak", []):
        p["weak"] = [x for x in p["weak"] if x != value]; changed = True
    elif key.startswith("preferences.") and p.get("preferences", {}).get(key.split(".", 1)[1]) == value:
        p["preferences"].pop(key.split(".", 1)[1]); changed = True
    elif key.startswith("course.") and value in p.get("courses", []):
        p["courses"] = [x for x in p["courses"] if x != value]; changed = True
    elif key in OBJECTIVE_KEYS and p.get(key) == value:
        p.pop(key); changed = True
    if changed:
        save_profile(user_id, p)

def _fact_row(r):
    return {"id": r[0], "user_id": r[1], "kind": r[2], "key": r[3],
            "value": r[4], "status": r[5], "source": r[6]}

def _has_live_fact(c, user_id, key, value):
    """同一条事实已有 pending / applied 记录 → 不重复弹卡。"""
    r = c.execute(
        "SELECT 1 FROM facts WHERE user_id=? AND key=? AND value=? "
        "AND status IN ('pending','applied') LIMIT 1", (user_id, key, value)).fetchone()
    return bool(r)

def propose_facts(user_id, text):
    """抽取 → 分类 → 分流落库。返回 {"pending": […], "applied": […]}：
      · preference  → 立即 applied 并入画像（用户可撤销）；
      · objective   → 仅 pending，等用户确认（前端出建议卡）。"""
    facts = extract_facts(text)
    if not facts:
        return {"pending": [], "applied": []}
    now = datetime.datetime.now().isoformat(timespec="seconds")
    pending, applied = [], []
    c = _conn()
    for kind, key, value in _flatten_facts(facts):
        if _has_live_fact(c, user_id, key, value):
            continue
        status = "applied" if kind == "preference" else "pending"
        cur = c.execute(
            "INSERT INTO facts(user_id, kind, key, value, status, source, created_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (user_id, kind, key, value, status, (text or "")[:80], now))
        item = {"id": cur.lastrowid, "kind": kind, "key": key, "value": value}
        if kind == "preference":
            applied.append(item)
        else:
            pending.append(item)
    c.commit(); c.close()
    # 画像合并放在 facts 连接关闭之后 —— 嵌套开连接会撞 SQLite 的库锁
    for item in applied:
        _merge_into_profile(user_id, item["key"], item["value"])
    return {"pending": pending, "applied": applied}

def _get_fact(fact_id):
    c = _conn()
    r = c.execute("SELECT id, user_id, kind, key, value, status, source FROM facts WHERE id=?",
                  (fact_id,)).fetchone()
    c.close()
    return _fact_row(r) if r else None

def confirm_fact(fact_id):
    """pending → applied：用户点头，客观事实才进画像。"""
    f = _get_fact(fact_id)
    if not f or f["status"] != "pending":
        return None
    c = _conn()
    c.execute("UPDATE facts SET status='applied', decided_at=? WHERE id=?",
              (datetime.datetime.now().isoformat(timespec="seconds"), fact_id))
    c.commit(); c.close()
    _merge_into_profile(f["user_id"], f["key"], f["value"])
    return {**f, "status": "applied"}

def reject_fact(fact_id):
    """pending → rejected：用户说不记，就永远不进画像。"""
    f = _get_fact(fact_id)
    if not f or f["status"] != "pending":
        return None
    c = _conn()
    c.execute("UPDATE facts SET status='rejected', decided_at=? WHERE id=?",
              (datetime.datetime.now().isoformat(timespec="seconds"), fact_id))
    c.commit(); c.close()
    return {**f, "status": "rejected"}

def undo_fact(fact_id):
    """applied → rejected 并从画像里移除（偏好类「自动生效」的后悔药）。"""
    f = _get_fact(fact_id)
    if not f or f["status"] != "applied":
        return None
    c = _conn()
    c.execute("UPDATE facts SET status='rejected', decided_at=? WHERE id=?",
              (datetime.datetime.now().isoformat(timespec="seconds"), fact_id))
    c.commit(); c.close()
    _remove_from_profile(f["user_id"], f["key"], f["value"])
    return {**f, "status": "rejected"}

def delete_fact(fact_id):
    """硬删除一条记忆；若它已生效，画像里的痕迹一并清掉。"""
    f = _get_fact(fact_id)
    if not f:
        return False
    c = _conn()
    c.execute("DELETE FROM facts WHERE id=?", (fact_id,))
    c.commit(); c.close()
    if f["status"] == "applied":
        _remove_from_profile(f["user_id"], f["key"], f["value"])
    return True

def list_facts(user_id, status=None):
    """列出某用户的事实记录（新→旧）。status 不传 = pending + applied。"""
    c = _conn()
    if status:
        rows = c.execute(
            "SELECT id, user_id, kind, key, value, status, source FROM facts "
            "WHERE user_id=? AND status=? ORDER BY id DESC", (user_id, status)).fetchall()
    else:
        rows = c.execute(
            "SELECT id, user_id, kind, key, value, status, source FROM facts "
            "WHERE user_id=? AND status IN ('pending','applied') ORDER BY id DESC",
            (user_id,)).fetchall()
    c.close()
    return [_fact_row(r) for r in rows]

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

def history_messages(sid, k=50):
    """某会话最近 k 条消息（升序、带自增 id 与时间戳）—— 供前端跨会话恢复聊天记录。

    与 recent_messages 的区别：这条给「恢复 UI」用，要 id（前端按 id 去重合并）
    与 created_at（按天分组展示）；recent_messages 给 LLM 上下文用，越轻越好。
    """
    if k < 1:
        return []
    c = _conn()
    rows = c.execute(
        "SELECT id, role, content, created_at FROM messages WHERE session_id=? "
        "ORDER BY id DESC LIMIT ?", (sid, k)
    ).fetchall()
    c.close()
    return [{"id": r[0], "role": r[1], "content": r[2], "created_at": r[3]}
            for r in reversed(rows)]

# ---------- 对外：拼接三层记忆 ----------
def remember(user_id, session_id, role, content):
    """落库 + 抽事实（分流回写）+ 按需增量压缩（一个入口搞定）。

    user 轮返回 {"pending": […], "applied": […]}：pending 是等确认的客观事实
    （前端出建议卡），applied 是已自动生效的偏好（前端出可撤销提示）。
    assistant 轮返回空结构 —— 回答侧不抽事实，只落原文与摘要。
    """
    add_message(session_id, user_id, role, content)
    events = {"pending": [], "applied": []}
    if role == "user":
        try:
            events = propose_facts(user_id, content)
        except Exception as e:
            print("[memory] 事实抽取失败：", e)
    maybe_summarize(session_id)
    return events

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
