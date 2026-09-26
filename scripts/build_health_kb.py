# -*- coding: utf-8 -*-
"""
健康知识库 · 建库与灌库（Health KB builder）
============================================
从 `scripts/health_kb_data.py`（纯数据）灌入 `data/health_kb.db`，再建 FTS5 + 向量索引。

与方法库 **不合并**（data/method_kb.db），与上理库 **不合并**（data/usst_articles.db）：
  健康库独有 escalate / red_flag / 指南年份语义，且必须先过安全护栏才谈检索。

幂等：可反复运行；entries 按 slug UPSERT。

用法：
  python scripts/build_health_kb.py          # 灌数据 + 建索引
  python scripts/build_health_kb.py seed     # 只灌数据
  python scripts/build_health_kb.py stats    # 看统计
"""
import os, sys, json, sqlite3, datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
DB_PATH = os.path.join(BASE, "..", "data", "health_kb.db")

import health_kb_data as DATA


def _dumps(x):
    return json.dumps(x, ensure_ascii=False)


def ensure_schema(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS entries(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,                -- principle|skill|protocol|safety
        domain TEXT NOT NULL,              -- sleep|exercise|nutrition|mental
        title TEXT NOT NULL,
        summary TEXT,
        principle TEXT,
        steps TEXT,                        -- JSON array
        parameters TEXT,                   -- JSON object（可编译进排程引擎）
        applicable_when TEXT,              -- JSON array
        contraindications TEXT,            -- JSON array
        evidence_tier TEXT NOT NULL,       -- A|B|C|D
        citation TEXT,                     -- JSON object（source/url/year/verification）
        status TEXT NOT NULL DEFAULT 'verified',   -- verified|contested|deprecated
        escalate INTEGER NOT NULL DEFAULT 0,       -- 1 = 命中即走就医/求助口径
        seg_text TEXT,
        created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS rejected(
        slug TEXT PRIMARY KEY, title TEXT, why TEXT
    );
    """)


def seed(conn):
    now = datetime.datetime.now().isoformat(timespec="seconds")

    for r in DATA.REJECTED_HEALTH:
        conn.execute("INSERT INTO rejected(slug,title,why) VALUES(?,?,?) "
                     "ON CONFLICT(slug) DO UPDATE SET title=excluded.title, why=excluded.why",
                     (r["slug"], r["title"], r["why"]))

    n_new = n_upd = 0
    for e in DATA.ENTRIES:
        cur = conn.execute("SELECT id FROM entries WHERE slug=?", (e["slug"],)).fetchone()
        payload = (
            e["type"], e["domain"], e["title"], e["summary"], e["principle"],
            _dumps(e["steps"]), _dumps(e["parameters"]), _dumps(e["applicable_when"]),
            _dumps(e["contraindications"]), e["evidence_tier"], _dumps(e["citation"]),
            e["status"], 1 if e["escalate"] else 0, now)
        if cur:
            conn.execute(
                "UPDATE entries SET type=?,domain=?,title=?,summary=?,principle=?,steps=?,"
                "parameters=?,applicable_when=?,contraindications=?,evidence_tier=?,citation=?,"
                "status=?,escalate=?,updated_at=? WHERE slug=?", payload + (e["slug"],))
            n_upd += 1
        else:
            conn.execute(
                "INSERT INTO entries(slug,type,domain,title,summary,principle,steps,parameters,"
                "applicable_when,contraindications,evidence_tier,citation,status,escalate,created_at,updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (e["slug"],) + payload[:13] + (now, now))
            n_new += 1
    conn.commit()
    print(f"[seed] 条目 新增 {n_new} / 更新 {n_upd}｜拒收清单 {len(DATA.REJECTED_HEALTH)} 项")


def build_all():
    conn = sqlite3.connect(DB_PATH)
    ensure_schema(conn)
    seed(conn)
    conn.close()
    import health_rag
    health_rag.DB_PATH = DB_PATH
    health_rag.build_index()


def stats():
    conn = sqlite3.connect(DB_PATH)
    q = lambda s: conn.execute(s).fetchone()[0]
    print("条目总数:", q("SELECT count(*) FROM entries"))
    print("按领域:", dict(conn.execute("SELECT domain,count(*) FROM entries GROUP BY domain").fetchall()))
    print("按证据等级:", dict(conn.execute("SELECT evidence_tier,count(*) FROM entries GROUP BY evidence_tier").fetchall()))
    print("按状态:", dict(conn.execute("SELECT status,count(*) FROM entries GROUP BY status").fetchall()))
    print("安全升级条目:", q("SELECT count(*) FROM entries WHERE escalate=1"))
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
