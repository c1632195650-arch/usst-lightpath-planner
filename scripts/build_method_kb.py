# -*- coding: utf-8 -*-
"""
方法论库 · 建库与灌库（Method KB builder）
============================================
从 `scripts/method_kb_data.py`（纯数据）灌入 `data/method_kb.db`，然后建 FTS5 + 向量索引。

幂等：可反复运行。`entries` 按 slug 做 UPSERT；关联表每次重建（数据量小、避免残留）。

用法：
  python scripts/build_method_kb.py          # 建库 + 灌数据 + 建索引
  python scripts/build_method_kb.py seed     # 只灌数据（不建向量，快）
  python scripts/build_method_kb.py stats    # 看统计
"""
import os, sys, json, sqlite3, datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
DB_PATH = os.path.join(BASE, "..", "data", "method_kb.db")

import method_kb_data as DATA


def _dumps(x):
    return json.dumps(x, ensure_ascii=False)


def ensure_schema(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS entries(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,                 -- principle|method|exam|discipline|playbook
        domain TEXT NOT NULL,               -- cognitive|neuro|psych|behavior|study_skill|exam|competition|discipline
        discipline_scope TEXT NOT NULL,     -- 通用|理科|工科|文科
        title TEXT NOT NULL,
        summary TEXT,
        principle TEXT,
        steps TEXT,                         -- JSON array
        parameters TEXT,                    -- JSON object（可编译进引擎）
        applicable_when TEXT,               -- JSON object
        contraindications TEXT,
        evidence_tier TEXT NOT NULL,        -- A|B|C|D
        citation TEXT,                      -- JSON object（含 verification 字段）
        status TEXT NOT NULL DEFAULT 'verified',  -- verified|contested|deprecated
        seg_text TEXT,
        created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS meta_abilities(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT,
        description TEXT, parent_id TEXT
    );
    CREATE TABLE IF NOT EXISTS entry_ability(
        entry_id INTEGER NOT NULL,
        ability_id TEXT NOT NULL,
        role TEXT NOT NULL,                 -- train|require
        PRIMARY KEY(entry_id, ability_id, role)
    );
    CREATE TABLE IF NOT EXISTS task_ability(
        task_slug TEXT NOT NULL, task_name TEXT,
        ability_id TEXT NOT NULL, weight REAL,
        PRIMARY KEY(task_slug, ability_id)
    );
    """)


def seed(conn):
    now = datetime.datetime.now().isoformat(timespec="seconds")

    # 元能力
    for a in DATA.META_ABILITIES:
        conn.execute(
            "INSERT INTO meta_abilities(id,name,category,description,parent_id) VALUES(?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category, "
            "description=excluded.description",
            (a["id"], a["name"], a.get("category"), a.get("description"), a.get("parent_id")))

    # 任务-能力映射
    conn.execute("DELETE FROM task_ability")
    for t in DATA.TASKS:
        for aid, w in t["abilities"]:
            conn.execute("INSERT INTO task_ability(task_slug,task_name,ability_id,weight) VALUES(?,?,?,?)",
                         (t["slug"], t["name"], aid, w))

    # 条目
    n_new = n_upd = 0
    for e in DATA.ENTRIES:
        cur = conn.execute("SELECT id FROM entries WHERE slug=?", (e["slug"],)).fetchone()
        payload = (
            e["type"], e["domain"], e["discipline_scope"], e["title"], e["summary"],
            e["principle"], _dumps(e["steps"]), _dumps(e["parameters"]),
            _dumps(e["applicable_when"]), e["contraindications"], e["evidence_tier"],
            _dumps(e["citation"]), e["status"], now)
        if cur:
            conn.execute(
                "UPDATE entries SET type=?,domain=?,discipline_scope=?,title=?,summary=?,principle=?,"
                "steps=?,parameters=?,applicable_when=?,contraindications=?,evidence_tier=?,citation=?,"
                "status=?,updated_at=? WHERE slug=?",
                payload + (e["slug"],))
            eid = cur[0]
            n_upd += 1
        else:
            conn.execute(
                "INSERT INTO entries(slug,type,domain,discipline_scope,title,summary,principle,steps,"
                "parameters,applicable_when,contraindications,evidence_tier,citation,status,created_at,updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (e["slug"],) + payload[:13] + (now, now))
            eid = conn.execute("SELECT id FROM entries WHERE slug=?", (e["slug"],)).fetchone()[0]
            n_new += 1

        # 关联表（重建该条目的，避免残留）
        conn.execute("DELETE FROM entry_ability WHERE entry_id=?", (eid,))
        for aid, role in e["abilities"]:
            conn.execute("INSERT OR IGNORE INTO entry_ability(entry_id,ability_id,role) VALUES(?,?,?)",
                         (eid, aid, role))
    conn.commit()
    print(f"[seed] 元能力 {len(DATA.META_ABILITIES)}｜任务 {len(DATA.TASKS)}｜"
          f"条目 新增 {n_new} / 更新 {n_upd}｜拒收清单 {len(DATA.REJECTED)} 项")


def build_all():
    conn = sqlite3.connect(DB_PATH)
    ensure_schema(conn)
    seed(conn)
    conn.close()
    import method_rag
    method_rag.DB_PATH = DB_PATH
    method_rag.build_index()


def stats():
    conn = sqlite3.connect(DB_PATH)
    q = lambda s: conn.execute(s).fetchone()[0]
    print("条目总数:", q("SELECT count(*) FROM entries"))
    print("按证据等级:", dict(conn.execute("SELECT evidence_tier,count(*) FROM entries GROUP BY evidence_tier").fetchall()))
    print("按状态:", dict(conn.execute("SELECT status,count(*) FROM entries GROUP BY status").fetchall()))
    print("按领域:", dict(conn.execute("SELECT domain,count(*) FROM entries GROUP BY domain").fetchall()))
    print("向量块:", q("SELECT count(*) FROM chunks"))
    conn.close()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd == "seed":
        c = sqlite3.connect(DB_PATH); ensure_schema(c); seed(c); c.close()
    elif cmd == "stats":
        stats()
    else:
        build_all()
        stats()
