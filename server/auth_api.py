"""账号系统 /api/auth/* + 云端 kv /api/db（FastAPI 版）
============================================================

来源与纪律：本文件是 Ray 线 `serve.py`（纯标准库 http.server）中
「本地账号系统 + kv 存储」的**逐字段语义移植**（2026-10-02 delta 融合补口）。
移植原因：三线融合后 `serve.py` 与 `server/app.py` 并存，但前端 `lib/auth.ts`
探测的 `/api/auth/me` 在 app.py 上不存在 → auth 恒 offline → 登录页永远不出现。
移植后单后端（app.py）即可跑通登录；`serve.py` 保留不动，作为 Ray 线的生产托管形态。

与 serve.py 的差异（仅实现形态，契约零变化）：
  · http.server → FastAPI APIRouter；
  · 独立 sqlite（`server/lp_auth.db`，可用 LP_AUTH_DB 覆盖）而非 serve.py 的 data/app.db
    —— 不与数据资产库（usst_articles.db 等）混放；
  · 会话 Cookie 改用 FastAPI set_cookie（HttpOnly / SameSite=Lax / Path=/，同 serve.py）。

契约（与 serve.py / src/lib/auth.ts / src/lib/persistence.ts 逐字段一致）：
  GET    /api/auth/me          → 200 {ok, username} | 401
  POST   /api/auth/register    {username, password} → 200 +Set-Cookie | 400 | 409
  POST   /api/auth/login       {username, password} → 200 +Set-Cookie | 401 | 429
  POST   /api/auth/logout      → 200（清会话 + 清 Cookie）
  POST   /api/auth/delete      {password} → 200（级联清数据，不可恢复）| 401 | 403
  GET    /api/db               → 200 {ok, items:[{key,value,updated_at}]} | 401
  PUT    /api/db/{key}         {value, updated_at} → 200 | 400（白名单外/缺字段）| 401
  DELETE /api/db/{key}         → 200 | 401
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from pathlib import Path

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

SESSION_COOKIE = "lp_session"
SESSION_TTL = 7 * 24 * 3600          # 7 天滑动过期（同 serve.py）
PBKDF2_ROUNDS = 200_000

# 可写 kv key 白名单（与 src/lib/storageRegistry.ts / serve.py WRITABLE_KEYS 一致；
# tests/persistence.test.ts 用例③机械守着两边一致 —— 加 key 必须三处同步）。
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
    # 三线融合（2026-10-01）补登记：beta-v2 侧梨宝链路三个 key（storageRegistry 同步）
    "usst.libao.deadlines.v1",
    "usst.libao.chat.v1",
    "usst.libao.chat.cleared",
    # delta 融合（2026-10-02）补登记：dialogManager 快照 v2/v3（storageRegistry 同步）
    "usst.libao.chat.v2",
    "usst.libao.chat.v3",
})

# 简单防爆破：用户名 → 最近失败时间戳列表（进程内存态，重启即清；同 serve.py）
_login_failures: dict[str, list[float]] = {}
_failures_lock = threading.Lock()
FAIL_WINDOW = 600.0   # 10 分钟
FAIL_LIMIT = 5

_DB_PATH = Path(os.environ.get("LP_AUTH_DB", str(Path(__file__).parent / "lp_auth.db")))

router = APIRouter()


# ---------------------------------------------------------------- 存储

def db() -> sqlite3.Connection:
    con = sqlite3.connect(_DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db() -> None:
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
        """
    )
    con.commit()
    con.close()


# ---------------------------------------------------------------- 口令与会话

def _hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ROUNDS)
    return f"{salt}${dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ROUNDS)
    return hmac.compare_digest(f"{salt}${dk.hex()}", stored)


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


def _current_user(con: sqlite3.Connection, request: Request) -> sqlite3.Row | None:
    token = request.cookies.get(SESSION_COOKIE, "")
    if not re.fullmatch(r"[A-Za-z0-9_\-]+", token or ""):
        return None
    return con.execute(
        """SELECT u.id, u.username FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token = ? AND s.expires_at > ?""",
        (token, int(time.time())),
    ).fetchone()


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=SESSION_TTL, httponly=True, samesite="lax", path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def _unauthorized() -> JSONResponse:
    return JSONResponse({"ok": False, "error": "未登录或会话已过期"}, status_code=401)


class AuthBody(BaseModel):
    username: str
    password: str


class DeleteBody(BaseModel):
    password: str


# ---------------------------------------------------------------- /api/auth/*

@router.get("/api/auth/me")
def auth_me(request: Request):
    con = db()
    try:
        user = _current_user(con, request)
        if user is None:
            return _unauthorized()
        return {"ok": True, "username": user["username"]}
    finally:
        con.close()


@router.post("/api/auth/register")
def auth_register(body: AuthBody):
    username = body.username.strip()
    if not (1 <= len(username) <= 32):
        return JSONResponse({"ok": False, "error": "用户名需 1–32 个字符"}, status_code=400)
    if len(body.password) < 6:
        return JSONResponse({"ok": False, "error": "密码至少 6 位"}, status_code=400)
    con = db()
    try:
        if con.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            return JSONResponse({"ok": False, "error": "用户名已存在"}, status_code=409)
        cur = con.execute(
            "INSERT INTO users(username, pw_hash, created_at) VALUES (?,?,?)",
            (username, _hash_password(body.password), int(time.time())),
        )
        con.commit()
        token = _create_session(con, cur.lastrowid)
        resp = JSONResponse({"ok": True, "username": username})
        _set_session_cookie(resp, token)
        return resp
    finally:
        con.close()


@router.post("/api/auth/login")
def auth_login(body: AuthBody, response: Response):
    username = body.username.strip()
    if not _login_allowed(username):
        return JSONResponse({"ok": False, "error": "失败次数过多，10 分钟后再试"}, status_code=429)
    con = db()
    try:
        user = con.execute(
            "SELECT id, pw_hash FROM users WHERE username=?", (username,)
        ).fetchone()
        if not user or not _verify_password(body.password, user["pw_hash"]):
            _login_failed(username)
            return JSONResponse({"ok": False, "error": "用户名或密码不对"}, status_code=401)
        token = _create_session(con, user["id"])
        resp = JSONResponse({"ok": True, "username": username})
        _set_session_cookie(resp, token)
        return resp
    finally:
        con.close()


@router.post("/api/auth/logout")
def auth_logout(request: Request):
    con = db()
    try:
        token = request.cookies.get(SESSION_COOKIE, "")
        if re.fullmatch(r"[A-Za-z0-9_\-]+", token or ""):
            con.execute("DELETE FROM sessions WHERE token=?", (token,))
            con.commit()
        resp = JSONResponse({"ok": True})
        _clear_session_cookie(resp)
        return resp
    finally:
        con.close()


@router.post("/api/auth/delete")
def auth_delete(body: DeleteBody, request: Request):
    """注销账号：校验密码后删除用户行；kv / sessions 靠 FK CASCADE 连带清空。
    **不可恢复** —— 本系统无密码找回（规格书 §1.3：忘记密码 = 删账号重来）。"""
    con = db()
    try:
        user = _current_user(con, request)
        if user is None:
            return _unauthorized()
        row = con.execute("SELECT pw_hash FROM users WHERE id=?", (user["id"],)).fetchone()
        if row is None or not _verify_password(body.password, row["pw_hash"]):
            return JSONResponse({"ok": False, "error": "密码不对，账号未注销"}, status_code=403)
        con.execute("DELETE FROM users WHERE id=?", (user["id"],))
        con.commit()
        resp = JSONResponse({"ok": True, "username": user["username"]})
        _clear_session_cookie(resp)
        return resp
    finally:
        con.close()


# ---------------------------------------------------------------- /api/db（云端 kv）

@router.get("/api/db")
def kv_list(request: Request):
    con = db()
    try:
        user = _current_user(con, request)
        if user is None:
            return _unauthorized()
        rows = con.execute(
            "SELECT key, value, updated_at FROM kv WHERE user_id=?", (user["id"],)
        ).fetchall()
        return {
            "ok": True,
            "items": [{"key": r["key"], "value": r["value"], "updated_at": r["updated_at"]}
                      for r in rows],
        }
    finally:
        con.close()


@router.put("/api/db/{key}")
async def kv_put(key: str, request: Request):
    # 契约保持 serve.py 语义：白名单外 / 缺字段 / 非 JSON 一律 400
    # （不用 pydantic —— 它对缺字段回 422，与 serve.py 的 400 契约不一致）
    if key not in WRITABLE_KEYS:
        return JSONResponse({"ok": False, "error": f"key 未登记，拒绝写入：{key}"}, status_code=400)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "需要 { value, updated_at }"}, status_code=400)
    if not isinstance(body, dict) or "value" not in body or "updated_at" not in body:
        return JSONResponse({"ok": False, "error": "需要 { value, updated_at }"}, status_code=400)
    con = db()
    try:
        user = _current_user(con, request)
        if user is None:
            return _unauthorized()
        con.execute(
            """INSERT INTO kv(key, user_id, value, updated_at) VALUES (?,?,?,?)
               ON CONFLICT(key, user_id) DO UPDATE SET
                 value=excluded.value, updated_at=excluded.updated_at""",
            (key, user["id"], json.dumps(body["value"], ensure_ascii=False), int(body["updated_at"])),
        )
        con.commit()
        return {"ok": True}
    finally:
        con.close()


@router.delete("/api/db/{key}")
def kv_delete(key: str, request: Request):
    con = db()
    try:
        user = _current_user(con, request)
        if user is None:
            return _unauthorized()
        con.execute("DELETE FROM kv WHERE key=? AND user_id=?", (key, user["id"]))
        con.commit()
        return {"ok": True}
    finally:
        con.close()
