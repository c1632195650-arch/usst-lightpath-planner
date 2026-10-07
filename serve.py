# -*- coding: utf-8 -*-
"""serve.py —— 光溯 · 上理生涯规划助手 一体化本地服务

一个进程全包（默认 127.0.0.1:8000）：
  1. 静态托管 dist/（vite build 产物，SPA fallback → index.html）
  2. /api/db      SQLite 数据库 API（整站数据真源，localStorage 为缓存层）
  3. /api/auth/*  本地账号系统（PBKDF2 口令哈希 + HttpOnly Cookie 会话）
  4. /courses、/api/import_pdf  课表解析（timetable_parser 进程内 import，
     响应格式与旧版独立服务 python server.py 8765 逐字段兼容）

启动：python serve.py [端口]     纯 Python 标准库，零第三方依赖。
数据：data/lightpath.db（SQLite 单文件；备份 = 复制该文件）。
"""

import hashlib
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.error
import urllib.request
from urllib.parse import unquote

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "data", "lightpath.db")
DIST_DIR = os.path.join(BASE, "dist")
UPLOAD_DIR = os.path.join(BASE, "data", "uploads")
SEED_RECORDS = os.path.join(BASE, "data", "legacy_course_records.json")

sys.path.insert(0, os.path.join(BASE, "server"))
# 课表解析包（timetable_parser）在 Ray 树里已归拢进主仓库；本树尚未归拢 ——
# 装了即可用，没装时解析端点如实报错（其余路由：账号/DB/梨宝脑转发/静态 完全不受影响）。
try:
    from timetable_parser import parse_pdf  # noqa: E402
except Exception:  # pragma: no cover - 取决于本机是否安装解析包
    parse_pdf = None  # type: ignore[assignment]

PORT_DEFAULT = 8000
SESSION_COOKIE = "lp_session"
SESSION_TTL = 7 * 24 * 3600          # 7 天滑动过期
PBKDF2_ROUNDS = 200_000

# ============================================================
# 🔴 梨宝脑转发（2026-10-07，B 会话按 RAY 指示添加）
# ------------------------------------------------------------
# ⚠️ 本文件所有权属 CY —— 本块是临时桥接，待 CY 审查；删除本块 +
#    Handler 里两处 `if _is_cy_brain(path)` 调用 = 完全回退。
#
# 背景：CY 的梨宝「大脑」（LLM 对话 / 记忆 / 检索 / 路线，DeepSeek）
# 部署在 http://101.35.253.143（FastAPI）。本地 serve.py 没有 /api/chat
# 等端点（老前端问梨宝 404 =「回答不上来」的直接原因）。
# 命中下列前缀的请求原样转发给 CY 服务器，其余路由（账号/课表/静态）
# 完全不受影响。dev 模式下 vite 代理已做同样分流（vite.config.ts）。
# ============================================================
CY_API_TARGET = "http://101.35.253.143"
CY_BRAIN_PREFIXES = (
    "/api/chat",    # 梨宝对话（LLM 大脑；本地无此端点）
    "/api/memory",  # 记忆系统 facts
    "/api/plan",    # 计划理解 / 计划评估
    "/api/search",  # 校园信息检索
    "/api/health",  # LLM 在线状态（本地无此端点，转发后 lbaoHealth 才有真数据）
    "/api/weather",
    "/api/poi",
    "/api/nearby",
    "/api/route",   # 步行路线（含 /api/route/batch）
)


def _is_cy_brain(path: str) -> bool:
    return any(path.startswith(p) for p in CY_BRAIN_PREFIXES)

# 可写 kv key 白名单（与 src/lib/storageRegistry.ts 一致；legacy 两个 key 只迁不写）
# ⚠️ 这张表是**手抄**的：加一个前端 key 必须同步加到这里，否则写入被 400 拒绝、
#    而前端是 fire-and-forget，表现为**静默不同步**。
#    2026-09-27 起由 `tests/persistence.test.ts` 用例③ 机械守着两边一致。
WRITABLE_KEYS = frozenset({
    "usst-life-assistant-v2",
    "usst-user-plan-v1",
    "usst-routine-v1",
    "usst-goal-prefs-v1",
    "usst-goals-v1",
    "usst-important-dates-v1",
    "usst-activity-log-v1",
    "usst-behavior-log-v1",
    "usst-pref-corrections-v1",
    "usst-interest-ask-dismissed-v1",
    "usst.telemetry.v1",
    "usst.libao.user_id",
    "usst.libao.session_id",
    "usst.libao.basic_info",
})

# 简单防爆破：用户名 → 最近失败时间戳列表（进程内存态，重启即清）
_login_failures: dict[str, list[float]] = {}
_failures_lock = threading.Lock()
FAIL_WINDOW = 600.0   # 10 分钟
FAIL_LIMIT = 5


# ---------------------------------------------------------------- 数据库

def db() -> sqlite3.Connection:
    """每请求独立连接（线程安全最省心的做法）。"""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    con = db()
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          username   TEXT    NOT NULL UNIQUE,
          pw_hash    TEXT    NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token      TEXT    PRIMARY KEY,
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS kv (
          key        TEXT    NOT NULL,
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          value      TEXT    NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (key, user_id)
        );
        CREATE TABLE IF NOT EXISTS course_records (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          课名 TEXT NOT NULL, 类型 TEXT, 节次 TEXT, 周次原文 TEXT, 周次 TEXT,
          校区 TEXT, 教室 TEXT, 教师 TEXT, 考核方式 TEXT, 学时组成 TEXT,
          周学时 TEXT, 总学时 TEXT, 学分 TEXT, 星期 TEXT,
          imported_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS files (
          path        TEXT PRIMARY KEY,
          sha256      TEXT NOT NULL,
          imported_at INTEGER NOT NULL
        );
        """
    )
    # 种子：course_records 表为空且存在 legacy JSON（旧独立服务的数据）时导入
    n = con.execute("SELECT COUNT(*) AS n FROM course_records").fetchone()["n"]
    if n == 0 and os.path.exists(SEED_RECORDS):
        with open(SEED_RECORDS, encoding="utf-8") as f:
            records = json.load(f)
        _insert_records(con, records)
        print(f"[init] 已从 legacy_course_records.json 导入 {len(records)} 条课表")
    # 已归拢的历史 PDF 登记进 files 表（文件名即 sha256）
    for name in os.listdir(UPLOAD_DIR):
        stem, ext = os.path.splitext(name)
        if ext.lower() == ".pdf" and re.fullmatch(r"[0-9a-f]{64}", stem):
            rel = os.path.relpath(os.path.join(UPLOAD_DIR, name), BASE).replace("\\", "/")
            if not con.execute("SELECT 1 FROM files WHERE path=?", (rel,)).fetchone():
                con.execute(
                    "INSERT INTO files(path, sha256, imported_at) VALUES (?,?,?)",
                    (rel, stem, int(time.time())),
                )
    con.commit()
    con.close()


COURSE_FIELDS = ["课名", "类型", "节次", "周次原文", "周次", "校区", "教室", "教师",
                 "考核方式", "学时组成", "周学时", "总学时", "学分", "星期"]


def _insert_records(con: sqlite3.Connection, records: list[dict]) -> None:
    """课表入表：所有值转 TEXT（列表字段 JSON 序列化），输出时再还原。"""
    now = int(time.time())
    rows = []
    for r in records:
        vals = []
        for k in COURSE_FIELDS:
            v = r.get(k)
            vals.append(json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v)
        rows.append((*vals, now))
    placeholders = ",".join("?" * (len(COURSE_FIELDS) + 1))
    cols = ",".join(COURSE_FIELDS)
    con.executemany(
        f"INSERT INTO course_records({cols}, imported_at) VALUES ({placeholders})", rows
    )
    con.commit()


def _records_out(con: sqlite3.Connection) -> list[dict]:
    """course_records 表 → 与旧服务 /courses 相同结构的 JSON 数组。"""
    cols = ",".join(COURSE_FIELDS)
    rows = con.execute(f"SELECT {cols} FROM course_records ORDER BY id").fetchall()
    out = []
    for row in rows:
        item = {}
        for k in COURSE_FIELDS:
            v = row[k]
            if isinstance(v, str) and v.startswith("["):
                try:
                    v = json.loads(v)
                except ValueError:
                    pass
            item[k] = v
        out.append(item)
    return out


# ---------------------------------------------------------------- 账号

def _hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ROUNDS)
    return f"{salt}${dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    return hmac_compare(password, stored, salt)


def hmac_compare(password: str, stored: str, salt: str) -> bool:
    import hmac as _h
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ROUNDS)
    return _h.compare_digest(f"{salt}${dk.hex()}", stored)


def _login_allowed(username: str) -> bool:
    now = time.time()
    with _failures_lock:
        fails = [t for t in _login_failures.get(username, []) if now - t < FAIL_WINDOW]
        _login_failures[username] = fails
        return len(fails) < FAIL_LIMIT


def _login_failed(username: str) -> None:
    with _failures_lock:
        _login_failures.setdefault(username, []).append(time.time())


def _create_session(con: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    con.execute(
        "INSERT INTO sessions(token, user_id, expires_at) VALUES (?,?,?)",
        (token, user_id, int(time.time()) + SESSION_TTL),
    )
    con.commit()
    return token


def _current_user(con: sqlite3.Connection, handler: "Handler") -> sqlite3.Row | None:
    cookie = handler.headers.get("Cookie", "")
    m = re.search(rf"{SESSION_COOKIE}=([A-Za-z0-9_\-]+)", cookie)
    if not m:
        return None
    row = con.execute(
        """SELECT u.id, u.username FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token = ? AND s.expires_at > ?""",
        (m.group(1), int(time.time())),
    ).fetchone()
    return row


def _session_cookie(token: str) -> str:
    return f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; SameSite=Lax; Max-Age={SESSION_TTL}"


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # 安静运行
        pass

    # ---- 基础工具 ----
    def _send(self, code: int, body, ctype: str = "application/json; charset=utf-8",
              extra_headers: list[tuple[str, str]] | None = None) -> None:
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in extra_headers or []:
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    def _user_or_401(self, con) -> sqlite3.Row | None:
        user = _current_user(con, self)
        if user is None:
            self._send(401, {"ok": False, "error": "未登录或会话已过期"})
        return user

    # ---- 梨宝脑转发（见文件头 CY_BRAIN_PREFIXES 块说明）----
    def _proxy_cy(self) -> None:
        """把梨宝脑请求原样转发给 CY 服务器；SSE 流式（/api/chat/stream）不支持。
        2026-10-07 加固：①透传浏览器 UA（CY 侧 18:3x 起对非浏览器 UA 间歇性 403，
        Python-urllib 默认 UA 被拒）；②全路径 try/except —— 连 403 错误流的读取
        被远端重置也不能炸掉工作线程。"""
        url = CY_API_TARGET + self.path
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(url, data=body, method=self.command)
        req.add_header("Content-Type", self.headers.get("Content-Type") or "application/json")
        req.add_header("Accept", self.headers.get("Accept") or "*/*")
        # UA 透传：浏览器原样带上；没有（curl 直打本地）则给一个浏览器样 UA
        ua = self.headers.get("User-Agent")
        req.add_header("User-Agent", ua or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36")

        def _err(code: int, msg: str) -> None:
            try:
                self._send(code, {"ok": False, "error": msg})
            except Exception:
                pass

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
                self._send(resp.status, data,
                           resp.headers.get("Content-Type") or "application/json; charset=utf-8")
        except urllib.error.HTTPError as e:
            # 后端业务错（4xx/5xx）原样透传，前端按既有逻辑处理
            try:
                payload = e.read()
            except Exception:
                payload = b'{"ok":false,"error":"upstream error"}'
            try:
                self._send(e.code, payload,
                           e.headers.get("Content-Type") or "application/json; charset=utf-8")
            except Exception:
                pass
        except Exception as e:  # 连不上 / 超时 / 远端重置
            _err(502, f"梨宝脑转发失败（CY 服务器不可达）：{e}")

    # ---- GET ----
    def do_GET(self):
        path = unquote(self.path.split("?", 1)[0])
        # 生产模式：浏览器直接访问 serve.py（无 vite 代理）
        # 前端 timetableClient 的 BASE = '/timetable' → 剥掉前缀使其匹配下方路由
        if path.startswith('/timetable/'):
            path = path[len('/timetable'):]
        if _is_cy_brain(path):
            self._proxy_cy()
            return
        if path == "/api/auth/me":
            con = db()
            try:
                user = self._user_or_401(con)
                if user:
                    self._send(200, {"ok": True, "username": user["username"]})
            finally:
                con.close()
            return

        if path == "/api/db":
            con = db()
            try:
                user = self._user_or_401(con)
                if not user:
                    return
                rows = con.execute(
                    "SELECT key, value, updated_at FROM kv WHERE user_id=?", (user["id"],)
                ).fetchall()
                self._send(200, {
                    "ok": True,
                    "items": [{"key": r["key"], "value": r["value"], "updated_at": r["updated_at"]}
                              for r in rows],
                })
            finally:
                con.close()
            return

        if path == "/courses":
            con = db()
            try:
                self._send(200, _records_out(con))
            finally:
                con.close()
            return

        self._serve_static(path)

    # ---- 静态文件（dist/ + SPA fallback）----
    def _serve_static(self, path: str) -> None:
        rel = path.lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(DIST_DIR, rel))
        if not full.startswith(os.path.normpath(DIST_DIR)):
            self._send(403, {"ok": False, "error": "forbidden"})
            return
        if not os.path.isfile(full):
            # SPA 路由 fallback：无扩展名的路径全部回 index.html
            if "." not in os.path.basename(rel):
                full = os.path.join(DIST_DIR, "index.html")
            if not os.path.isfile(full):
                self._send(404, {"ok": False,
                                 "error": "dist/ 不存在或未构建：先跑 npm run build（或 node.exe node_modules/vite/bin/vite.js build）"})
                return
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype)

    # ---- POST ----
    def do_POST(self):
        path = unquote(self.path.split("?", 1)[0])
        # 生产模式：剥掉 /timetable 前缀（vite 代理在 dev 模式做了同样的事）
        if path.startswith('/timetable/'):
            path = path[len('/timetable'):]
        if _is_cy_brain(path):
            self._proxy_cy()
            return
        if path == "/api/auth/register":
            self._auth_register()
            return
        if path == "/api/auth/login":
            self._auth_login()
            return
        if path == "/api/auth/logout":
            self._auth_logout()
            return
        if path == "/api/auth/delete":
            self._auth_delete()
            return
        if path == "/api/import_pdf":
            self._import_pdf()
            return
        self._send(404, {"ok": False, "error": "not found"})

    def _auth_register(self):
        body = self._read_json() or {}
        username = str(body.get("username", "")).strip()
        password = str(body.get("password", ""))
        if not (1 <= len(username) <= 32):
            self._send(400, {"ok": False, "error": "用户名需 1–32 个字符"})
            return
        if len(password) < 6:
            self._send(400, {"ok": False, "error": "密码至少 6 位"})
            return
        con = db()
        try:
            if con.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
                self._send(409, {"ok": False, "error": "用户名已存在"})
                return
            cur = con.execute(
                "INSERT INTO users(username, pw_hash, created_at) VALUES (?,?,?)",
                (username, _hash_password(password), int(time.time())),
            )
            con.commit()
            token = _create_session(con, cur.lastrowid)
            self._send(200, {"ok": True, "username": username},
                       extra_headers=[("Set-Cookie", _session_cookie(token))])
        finally:
            con.close()

    def _auth_login(self):
        body = self._read_json() or {}
        username = str(body.get("username", "")).strip()
        password = str(body.get("password", ""))
        if not _login_allowed(username):
            self._send(429, {"ok": False, "error": "失败次数过多，10 分钟后再试"})
            return
        con = db()
        try:
            user = con.execute(
                "SELECT id, pw_hash FROM users WHERE username=?", (username,)
            ).fetchone()
            if not user or not _verify_password(password, user["pw_hash"]):
                _login_failed(username)
                self._send(401, {"ok": False, "error": "用户名或密码不对"})
                return
            token = _create_session(con, user["id"])
            self._send(200, {"ok": True, "username": username},
                       extra_headers=[("Set-Cookie", _session_cookie(token))])
        finally:
            con.close()

    def _auth_logout(self):
        con = db()
        try:
            m = re.search(rf"{SESSION_COOKIE}=([A-Za-z0-9_\-]+)",
                          self.headers.get("Cookie", ""))
            if m:
                con.execute("DELETE FROM sessions WHERE token=?", (m.group(1),))
                con.commit()
            clear = f"{SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
            self._send(200, {"ok": True}, extra_headers=[("Set-Cookie", clear)])
        finally:
            con.close()

    def _auth_delete(self):
        """注销账号：校验密码后删除用户行，并清 Cookie。
        kv / sessions 两表都是 `REFERENCES users(id) ON DELETE CASCADE`，
        且 `db()` 已开 `PRAGMA foreign_keys=ON`，故删 users 行即连带清空该账号全部数据。
        **不可恢复** —— 本系统无密码找回（规格书 §1.3：忘记密码 = 删账号重来）。
        课表（course_records / files）是全局共享资产，不随账号删。
        """
        body = self._read_json() or {}
        password = str(body.get("password", ""))
        con = db()
        try:
            user = self._user_or_401(con)
            if not user:
                return
            row = con.execute("SELECT pw_hash FROM users WHERE id=?", (user["id"],)).fetchone()
            if row is None or not _verify_password(password, row["pw_hash"]):
                self._send(403, {"ok": False, "error": "密码不对，账号未注销"})
                return
            con.execute("DELETE FROM users WHERE id=?", (user["id"],))
            con.commit()
            clear = f"{SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
            self._send(200, {"ok": True, "username": user["username"]},
                       extra_headers=[("Set-Cookie", clear)])
        finally:
            con.close()

    def _import_pdf(self):
        """语义与旧版 8765 服务逐字段兼容：业务失败也返回 HTTP 200 + ok:false；
        解析成功 = 整体覆盖课表；文件本体按 sha256 落盘并登记 files 表。"""
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        if not raw:
            self._send(400, {"ok": False, "error": "没有收到文件内容"})
            return
        sha = hashlib.sha256(raw).hexdigest()
        pdf_path = os.path.join(UPLOAD_DIR, f"{sha}.pdf")
        try:
            if not os.path.exists(pdf_path):
                with open(pdf_path, "wb") as f:
                    f.write(raw)
            if parse_pdf is None:
                self._send(200, {"ok": False, "error": (
                    "课表解析组件未安装（timetable_parser）。安装解析包后重试；"
                    "或先把课表 JSON 放到 public/my_schedule.json（前端会自动加载）。")})
                return
            records = parse_pdf(pdf_path)
            if not records:
                self._send(200, {"ok": False, "error": (
                    "未解析到任何课程。请确认上传的是『每周课表』格式的 PDF"
                    "(表格含 星期一~星期日)。原课表数据已保留。")})
                return
            con = db()
            try:
                con.execute("DELETE FROM course_records")
                _insert_records(con, records)
                rel = os.path.relpath(pdf_path, BASE).replace("\\", "/")
                con.execute(
                    "INSERT OR REPLACE INTO files(path, sha256, imported_at) VALUES (?,?,?)",
                    (rel, sha, int(time.time())),
                )
                con.commit()
            finally:
                con.close()
            self._send(200, {"ok": True, "count": len(records), "records": records})
        except IndexError:
            self._send(200, {"ok": False, "error": (
                "这份 PDF 的版式没能读全(页数/行列与预期不符)。"
                "已保留原课表数据,请确认上传的是周课表 PDF。")})
        except Exception as e:  # noqa: BLE001 —— 与旧服务口径一致，业务失败不 500
            self._send(200, {"ok": False, "error": (
                f"解析失败:{e}。已保留原课表数据,请确认上传的是周课表 PDF。")})

    # ---- PUT（kv upsert）----
    def do_PUT(self):
        path = unquote(self.path.split("?", 1)[0])
        m = re.fullmatch(r"/api/db/(.+)", path)
        if not m:
            self._send(404, {"ok": False, "error": "not found"})
            return
        key = m.group(1)
        if key not in WRITABLE_KEYS:
            self._send(400, {"ok": False, "error": f"key 未登记，拒绝写入：{key}"})
            return
        body = self._read_json() or {}
        if "value" not in body or "updated_at" not in body:
            self._send(400, {"ok": False, "error": "需要 { value, updated_at }"})
            return
        con = db()
        try:
            user = self._user_or_401(con)
            if not user:
                return
            con.execute(
                """INSERT INTO kv(key, user_id, value, updated_at) VALUES (?,?,?,?)
                   ON CONFLICT(key, user_id) DO UPDATE SET
                     value=excluded.value, updated_at=excluded.updated_at""",
                (key, user["id"], json.dumps(body["value"], ensure_ascii=False),
                 int(body["updated_at"])),
            )
            con.commit()
            self._send(200, {"ok": True})
        finally:
            con.close()

    # ---- DELETE（kv 清除：行为日志清空等场景）----
    def do_DELETE(self):
        path = unquote(self.path.split("?", 1)[0])
        m = re.fullmatch(r"/api/db/(.+)", path)
        if not m:
            self._send(404, {"ok": False, "error": "not found"})
            return
        key = m.group(1)
        if key not in WRITABLE_KEYS:
            self._send(400, {"ok": False, "error": f"key 未登记，拒绝删除：{key}"})
            return
        con = db()
        try:
            user = self._user_or_401(con)
            if not user:
                return
            con.execute("DELETE FROM kv WHERE key=? AND user_id=?", (key, user["id"]))
            con.commit()
            self._send(200, {"ok": True})
        finally:
            con.close()

    # 同源应用不需要 CORS 预检，但保留空实现以免奇怪的客户端探测报错
    def do_OPTIONS(self):
        self._send(204, b"", "text/plain")


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT_DEFAULT
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"光溯一体化服务已启动: http://127.0.0.1:{port}")
    print(f"数据库: {DB_PATH}")
    print("按 Ctrl+C 停止。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")


if __name__ == "__main__":
    main()
