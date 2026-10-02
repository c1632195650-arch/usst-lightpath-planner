# -*- coding: utf-8 -*-
"""
光溯移动端 · 账号与令牌（M0 · /api/auth/*）
============================================================
最小账号体系（mobile-impl-plan §6）：只存昵称+密码（pbkdf2 哈希），
无手机号/邮箱/教务信息 —— 攻击者拿到库也只会得到哈希。

设计要点：
  · SQLite 模式沿用仓内惯例：每次调用现开连接、用完即关（同 server/memory.py
    的 `_conn()`），天然线程安全 —— FastAPI 同步端点跑在线程池里也不怕。
  · 密码散列 `hashlib.pbkdf2_hmac('sha256', ..., 200000)` —— 标准库实现，
    零第三方依赖；盐 16B `secrets.token_bytes`。
  · 登录令牌：`secrets.token_urlsafe(32)`；库里**只存 sha256(token)**（原文不落库，
    拖库也撞不出可用的令牌），有效期 90 天（created_at 过期校验）。
    鉴权头 `Authorization: Bearer <token>`。
  · ICS 令牌：users.ics_token（32B urlsafe），仅供 `/api/sync/plan.ics?token=`
    免鉴权头使用（日历 App 填不了 Header）；泄露可重置 —— 重置接口留白天做。
  · DB 路径可用环境变量 `LIBAO_ACCOUNT_DB` 覆盖（冒烟测试指 tempfile 用）；
    默认 `data/libao_account.db`，**首次访问时由服务进程自动创建**且已 gitignore
    —— 这是程序行为，不是手工编辑 data/ 二进制（约束文档 §2.1 白纸黑字的例外）。

端点（签名表 mobile-impl-plan §6.4）：
  POST /api/auth/register  {username, password} → {userId, token, icsToken} | 400/409
  POST /api/auth/login     {username, password} → {userId, token, icsToken} | 401

⚠️ 错误一律直接回 `JSONResponse({"error": "<code>"})`，**不走 HTTPException**：
app.py 的全局 handler 会把 400 重写成 422（schemathesis 契约修复那批，别动它），
而移动端契约要求 400/401/409 + `{"error": code}`，所以这里用 JSONResponse 精确控形。

📌 响应里多带一个 `icsToken`（不在方案 §6.4 的原表里，2026-10-03 夜间增补并申报）：
F6 页内「复制订阅链接」需要它 —— 客户端不拿到 ics_token 就拼不出
/api/sync/plan.ics?token= 链接，而日历 App 又填不了 Bearer 头。
ics_token 本就不敏感于密码（泄露可重置），随登录下发是同一信任面。
"""
import datetime as _dt
import hashlib
import os
import re
import secrets
import sqlite3

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter()

_HERE = os.path.dirname(os.path.abspath(__file__))
# 默认落 data/（与 usst_articles.db 同目录）；冒烟测试用环境变量指到 tempfile
DB_PATH = os.environ.get("LIBAO_ACCOUNT_DB") or os.path.join(_HERE, "..", "data", "libao_account.db")

TOKEN_TTL_DAYS = 90
# 方案 §6.4：用户名 2~24 位（字母/数字/下划线/中文），密码 6~64 位
_USERNAME_RE = re.compile(r"^[A-Za-z0-9_\u4e00-\u9fa5]{2,24}$")
MIN_PASSWORD_LEN, MAX_PASSWORD_LEN = 6, 64
PBKDF2_ROUNDS = 200_000


def _conn():
    parent = os.path.dirname(os.path.abspath(DB_PATH))
    if parent:
        os.makedirs(parent, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=5)
    c.execute("PRAGMA busy_timeout=5000")
    c.execute("PRAGMA journal_mode=WAL")
    # DDL 逐字对齐方案 §6.2；全部 IF NOT EXISTS —— 重复调用幂等
    c.execute("""CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      pass_salt  TEXT    NOT NULL,
      pass_hash  TEXT    NOT NULL,
      ics_token  TEXT    NOT NULL UNIQUE,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS tokens (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS sync_state (
      user_id     INTEGER PRIMARY KEY REFERENCES users(id),
      schema_ver  INTEGER NOT NULL,
      payload     TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS week_plans (
      user_id    INTEGER NOT NULL REFERENCES users(id),
      week_no    INTEGER NOT NULL,
      payload    TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, week_no)
    )""")
    return c


def _hash_password(password: str, salt_hex: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), PBKDF2_ROUNDS, dklen=32,
    ).hex()


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def _parse_iso(ts: str) -> "_dt.datetime | None":
    """宽容解析 ISO-8601（兼容 `Z` 后缀与 `+00:00`）；解析不了返回 None，由调用方裁决。"""
    try:
        return _dt.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def issue_token(user_id: int) -> str:
    """签发登录令牌：原文只出现在响应里，库里只留 sha256。"""
    token = secrets.token_urlsafe(32)
    c = _conn()
    try:
        c.execute(
            "INSERT INTO tokens(token_hash, user_id, created_at) VALUES(?,?,?)",
            (hashlib.sha256(token.encode()).hexdigest(), user_id, _now_iso()),
        )
        c.commit()
    finally:
        c.close()
    return token


def user_id_from_request(request: Request) -> int | None:
    """Bearer 鉴权（同步端点共用）。任何一步不对都返回 None —— 调用方回 401。

    过期判定按 created_at + 90 天；created_at 解析不了按过期处理（宁可登出，不冒风险）。
    """
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None
    token = auth[7:].strip()
    if not token:
        return None
    c = _conn()
    try:
        row = c.execute(
            "SELECT user_id, created_at FROM tokens WHERE token_hash=?",
            (hashlib.sha256(token.encode()).hexdigest(),),
        ).fetchone()
    finally:
        c.close()
    if not row:
        return None
    created = _parse_iso(row[1])
    if created is None:
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=_dt.timezone.utc)
    if _dt.datetime.now(_dt.timezone.utc) - created > _dt.timedelta(days=TOKEN_TTL_DAYS):
        return None
    return int(row[0])


class AuthReq(BaseModel):
    """注册/登录共用请求体。unknown 字段直接 422（契约即文档，同 ChatReq 口径）。"""
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


def _err(status: int, code: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": code})


@router.post("/api/auth/register")
def api_auth_register(body: AuthReq):
    username = body.username.strip()
    if not _USERNAME_RE.fullmatch(username):
        return _err(400, "invalid_username")
    if not (MIN_PASSWORD_LEN <= len(body.password) <= MAX_PASSWORD_LEN):
        return _err(400, "invalid_password")

    salt = secrets.token_bytes(16).hex()
    pass_hash = _hash_password(body.password, salt)
    ics_token = secrets.token_urlsafe(32)

    c = _conn()
    try:
        cur = c.execute(
            "INSERT INTO users(username, pass_salt, pass_hash, ics_token, created_at) VALUES(?,?,?,?,?)",
            (username, salt, pass_hash, ics_token, _now_iso()),
        )
        c.commit()
        user_id = int(cur.lastrowid)
    except sqlite3.IntegrityError:
        # username UNIQUE（NOCASE）冲突 —— 反向断言：重名必须 409，不能静默覆盖
        return _err(409, "username_taken")
    finally:
        c.close()
    return {"userId": user_id, "token": issue_token(user_id), "icsToken": ics_token}


@router.post("/api/auth/login")
def api_auth_login(body: AuthReq):
    c = _conn()
    try:
        row = c.execute(
            "SELECT id, pass_salt, pass_hash FROM users WHERE username=?",
            (body.username.strip(),),
        ).fetchone()
    finally:
        c.close()
    # 用户不存在与密码错误同形 —— 不给撞库者「这个用户名存在」的信号
    if not row:
        return _err(401, "bad_credentials")
    if not secrets.compare_digest(_hash_password(body.password, row[1]), row[2]):
        return _err(401, "bad_credentials")
    c2 = _conn()
    try:
        got = c2.execute("SELECT ics_token FROM users WHERE id=?", (int(row[0]),)).fetchone()
    finally:
        c2.close()
    return {"userId": int(row[0]), "token": issue_token(int(row[0])), "icsToken": got[0] if got else None}
