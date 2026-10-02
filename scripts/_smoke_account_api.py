# -*- coding: utf-8 -*-
"""冒烟：光溯移动端账号体系（M1 · TestClient 直打 /api/auth/*，不起端口）。

含**反向断言**（约束文档 §10）：重名 409、错密 401、格式错 400、坏令牌 401、过期令牌 401。
数据库用 tempfile（LIBAO_ACCOUNT_DB 环境变量，import 前设置）—— 绝不碰真实 data/libao_account.db。
通过输出：ACCOUNT ALL OK
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))

# 换临时库 —— 必须在 import account 之前设置（DB_PATH 在 import 时定型）
fd, _tmp = tempfile.mkstemp(suffix=".db")
os.close(fd)
os.environ["LIBAO_ACCOUNT_DB"] = _tmp

import sqlite3

import account
from fastapi import FastAPI
from fastapi.testclient import TestClient

app = FastAPI()
app.include_router(account.router)
c = TestClient(app)

# ---------- 1) 注册成功 ----------
r = c.post("/api/auth/register", json={"username": "宝子1", "password": "probe123"})
assert r.status_code == 200, r.text
uid1, tok1 = r.json()["userId"], r.json()["token"]
print("register:", r.json())

# ---------- 2) 反向：重名（含大小写不敏感）→ 409 ----------
r = c.post("/api/auth/register", json={"username": "宝子1", "password": "probe456"})
assert r.status_code == 409 and r.json()["error"] == "username_taken", r.text
r = c.post("/api/auth/register", json={"username": "宝子1", "password": "probe456"})
assert r.status_code == 409, "NOCASE 大小写同判：" + r.text

# ---------- 3) 反向：格式错 → 400 ----------
r = c.post("/api/auth/register", json={"username": "a", "password": "probe123"})
assert r.status_code == 400 and r.json()["error"] == "invalid_username", r.text
r = c.post("/api/auth/register", json={"username": "bad name!", "password": "probe123"})
assert r.status_code == 400, r.text
r = c.post("/api/auth/register", json={"username": "好名字", "password": "12345"})
assert r.status_code == 400 and r.json()["error"] == "invalid_password", r.text
r = c.post("/api/auth/register", json={"username": "好名字", "password": "x" * 65})
assert r.status_code == 400, r.text
r = c.post("/api/auth/register", json={"username": "好名字", "password": "probe123", "extra": 1})
assert r.status_code == 422, "未知字段应 422：" + r.text

# ---------- 4) 登录：对/错 ----------
r = c.post("/api/auth/login", json={"username": "宝子1", "password": "probe123"})
assert r.status_code == 200 and r.json()["userId"] == uid1, r.text
r = c.post("/api/auth/login", json={"username": "宝子1", "password": "wrong!!"})
assert r.status_code == 401 and r.json()["error"] == "bad_credentials", r.text
r = c.post("/api/auth/login", json={"username": "不存在的宝", "password": "probe123"})
assert r.status_code == 401 and r.json()["error"] == "bad_credentials", r.text

# ---------- 5) 令牌鉴权（供 sync 用的 user_id_from_request） ----------
req = {"method": "GET", "url": "http://t/", "headers": {"authorization": f"Bearer {tok1}"}}
from starlette.requests import Request as StarletteRequest

scope = {
    "type": "http", "method": "GET", "path": "/", "headers": [
        (b"authorization", f"Bearer {tok1}".encode())], "query_string": b"",
}
got = account.user_id_from_request(StarletteRequest(scope))
assert got == uid1, f"好令牌应识别出 user_id={uid1}，得到 {got}"
scope_bad = {"type": "http", "method": "GET", "path": "/",
             "headers": [(b"authorization", b"Bearer nope")], "query_string": b""}
assert account.user_id_from_request(StarletteRequest(scope_bad)) is None, "坏令牌必须 None"
scope_none = {"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""}
assert account.user_id_from_request(StarletteRequest(scope_none)) is None, "无鉴权头必须 None"

# ---------- 6) 反向：令牌 90 天过期 ----------
con = sqlite3.connect(_tmp)
con.execute("UPDATE tokens SET created_at='2020-01-01T00:00:00+00:00' WHERE user_id=?", (uid1,))
con.commit()
con.close()
scope_old = {
    "type": "http", "method": "GET", "path": "/",
    "headers": [(b"authorization", f"Bearer {tok1}".encode())], "query_string": b"",
}
assert account.user_id_from_request(StarletteRequest(scope_old)) is None, "2020 年的令牌必须过期"

# ---------- 7) pbkdf2 参数自检（防手滑改弱） ----------
assert account.PBKDF2_ROUNDS >= 200_000, "轮数不许低于设计值"
con = sqlite3.connect(_tmp)
row = con.execute("SELECT pass_salt, pass_hash FROM users WHERE id=?", (uid1,)).fetchone()
con.close()
assert len(bytes.fromhex(row[0])) == 16, "盐必须 16 字节"
assert len(bytes.fromhex(row[1])) == 32, "哈希必须 32 字节"
assert account._hash_password("probe123", row[0]) == row[1], "正确密码的 pbkdf2 应能复现库中哈希"
assert account._hash_password("probe456", row[0]) != row[1], "错误密码不得产生相同哈希（反向）"

os.remove(_tmp)
print("ACCOUNT ALL OK")
