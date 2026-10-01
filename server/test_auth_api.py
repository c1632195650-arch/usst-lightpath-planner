"""auth_api 的接口测试（TestClient，独立临时库，不碰运行时 lp_auth.db）
============================================================
跑法：cd server && python -m pytest test_auth_api.py -q
（或 python test_auth_api.py 直接执行）

反向验证纪律：下面的负例断言（409/400/401/403/429）就是反向验证 ——
关掉对应实现（白名单/口令校验/会话校验）这些用例会变红，不存在"改断言凑绿"。
"""
import os
import sys
import tempfile
import time
import uuid
from pathlib import Path

_tmpdir = tempfile.mkdtemp(prefix="lp_auth_test_")
os.environ["LP_AUTH_DB"] = str(Path(_tmpdir) / "auth.db")

sys.path.insert(0, str(Path(__file__).parent))
import auth_api  # noqa: E402  （必须在 LP_AUTH_DB 设定之后 import）

from fastapi.testclient import TestClient  # noqa: E402
from fastapi import FastAPI  # noqa: E402

auth_api.init_db()
app = FastAPI()
app.include_router(auth_api.router)
client = TestClient(app)


def _register_and_login(username: str = "tester") -> dict:
    """注册即登录（serve.py 语义），返回注册响应。
    用户名带唯一后缀 —— 各用例共用同一个临时库，固定名会跨用例撞 409；
    实际用户名存 `_register_and_login.last` 供断言。"""
    username = f"{username}-{uuid.uuid4().hex[:6]}"
    _register_and_login.last = username
    r = client.post("/api/auth/register", json={"username": username, "password": "secret6"})
    assert r.status_code == 200, r.text
    return r


def test_register_then_me():
    r = _register_and_login("alice")
    assert r.json() == {"ok": True, "username": _register_and_login.last}
    assert "lp_session" in r.cookies
    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["username"] == _register_and_login.last


def test_register_duplicate_and_validation():
    # 自建账号再注册同名 → 409（不依赖用例执行顺序）
    created = _register_and_login("alice")
    assert created.status_code == 200
    assert client.post("/api/auth/register",
                       json={"username": _register_and_login.last,
                             "password": "secret6"}).status_code == 409
    assert client.post("/api/auth/register",
                       json={"username": "bob", "password": "123"}).status_code == 400   # 密码太短
    assert client.post("/api/auth/register",
                       json={"username": "", "password": "secret6"}).status_code == 400  # 名太短


def test_logout_invalidates_session():
    _register_and_login("carol")
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401  # 会话真被删了（反向验证）


def test_login_wrong_password_and_rate_limit():
    _register_and_login("dave")
    dave = _register_and_login.last
    assert client.post("/api/auth/login",
                       json={"username": dave, "password": "wrong!"}).status_code == 401
    ok = client.post("/api/auth/login", json={"username": dave, "password": "secret6"})
    assert ok.status_code == 200
    # 连错 5 次触发防爆破闸（FAIL_LIMIT=5 / FAIL_WINDOW=600s）
    for _ in range(auth_api.FAIL_LIMIT):
        client.post("/api/auth/login", json={"username": "eve", "password": "badbad"})
    assert client.post("/api/auth/login",
                       json={"username": "eve", "password": "whatever"}).status_code == 429


def test_kv_whitelist_and_roundtrip():
    _register_and_login("frank")
    good = {"value": {"courses": [1, 2]}, "updated_at": int(time.time() * 1000)}
    assert client.put("/api/db/usst-user-plan-v1", json=good).status_code == 200
    listing = client.get("/api/db")
    assert listing.status_code == 200
    items = {i["key"]: i for i in listing.json()["items"]}
    assert items["usst-user-plan-v1"]["key"] == "usst-user-plan-v1"
    # value 落库为 JSON 字符串（同 serve.py 语义），读回可解析
    import json as _json
    assert _json.loads(items["usst-user-plan-v1"]["value"]) == good["value"]
    # 负例：白名单外的 key 拒写；缺字段拒写 —— 关掉这两个闸用例即红（反向验证）
    assert client.put("/api/db/not-in-whitelist", json=good).status_code == 400
    assert client.put("/api/db/usst-user-plan-v1",
                      json={"value": 1}).status_code == 400
    # 覆盖写 + 删除
    assert client.put("/api/db/usst-user-plan-v1",
                      json={"value": "v2", "updated_at": 1}).status_code == 200
    assert client.delete("/api/db/usst-user-plan-v1").status_code == 200
    assert client.get("/api/db").json()["items"] == []


def test_kv_requires_auth():
    anon = TestClient(app)  # 无 Cookie 的独立客户端
    assert anon.get("/api/db").status_code == 401
    assert anon.put("/api/db/usst-user-plan-v1",
                    json={"value": 1, "updated_at": 1}).status_code == 401


def test_delete_account_cascades():
    _register_and_login("grace")
    client.put("/api/db/usst-goals-v1", json={"value": [], "updated_at": 1})
    # 密码不对 → 403，账号还在（反向验证）
    assert client.post("/api/auth/delete", json={"password": "nope123"}).status_code == 403
    assert client.get("/api/auth/me").status_code == 200
    # 密码对 → 注销；FK CASCADE 连带清空 kv/sessions
    assert client.post("/api/auth/delete", json={"password": "secret6"}).status_code == 200
    assert client.get("/api/auth/me").status_code == 401


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as e:
                fails += 1
                print(f"FAIL {name}: {e}")
    sys.exit(1 if fails else 0)
