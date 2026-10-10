# -*- coding: utf-8 -*-
"""
维护批 P0-7（2026-10-11）· ICS 令牌重置端点测试
================================================
跑法：.venv/Scripts/python.exe scripts/test_ics_reset.py

覆盖：
  1. 注册后旧 ics_token 能拉到订阅（200）；
  2. Bearer 重置 → 返回新 token；旧 token 立即 404；新 token 200；
  3. 无 Bearer → 401（重置不是匿名操作）；
  4. 重置不影响登录令牌（登录仍通）。

RV 反向验证：把 api_ics_reset 里的 UPDATE 语句注释掉，第 2 项「旧 token 404」必红。
"""
import os
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_SERVER = os.path.join(_HERE, "..", "server")
sys.path.insert(0, _SERVER)

_tmpdir = tempfile.mkdtemp(prefix="_ics_")
os.environ["LIBAO_ACCOUNT_DB"] = os.path.join(_tmpdir, "acct.db")

import account  # noqa: E402
import sync  # noqa: E402  （plan.ics 端点在 sync 路由上）
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

_app = FastAPI()
_app.include_router(account.router)
_app.include_router(sync.router)
client = TestClient(_app)

FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        FAILURES.append(f"{name} {detail}")
        print(f"  FAIL {name} {detail}")


print("[0] 预置：注册拿到 token 与 icsToken")
r = client.post("/api/auth/register", json={"username": "ics_user", "password": "rightpass"})
check("注册成功", r.status_code == 200, f"got {r.status_code} {r.text[:60]}")
token = r.json()["token"]
ics_old = r.json()["icsToken"]

print("[1] 旧 token 可拉订阅")
r = client.get("/api/sync/plan.ics", params={"token": ics_old})
check("旧 token 200", r.status_code == 200, f"got {r.status_code} {r.text[:60]}")

print("[2] 重置：旧作废、新可用")
r = client.post("/api/auth/ics/reset", headers={"Authorization": f"Bearer {token}"})
check("重置成功返回新 token", r.status_code == 200 and r.json().get("icsToken"), f"got {r.status_code} {r.text[:60]}")
ics_new = r.json()["icsToken"]
check("新 token ≠ 旧 token", ics_new != ics_old)
r = client.get("/api/sync/plan.ics", params={"token": ics_old})
check("旧 token 立即 404", r.status_code == 404, f"got {r.status_code}")
r = client.get("/api/sync/plan.ics", params={"token": ics_new})
check("新 token 200", r.status_code == 200, f"got {r.status_code}")

print("[3] 无 Bearer → 401")
r = client.post("/api/auth/ics/reset")
check("匿名重置 401", r.status_code == 401, f"got {r.status_code}")

print("[4] 重置不影响登录令牌")
r = client.post("/api/auth/login", json={"username": "ics_user", "password": "rightpass"})
check("登录仍通", r.status_code == 200, f"got {r.status_code}")

print()
if FAILURES:
    print("FAIL")
    for f in FAILURES:
        print("  -", f)
    sys.exit(1)
print("PASS  ICS 令牌重置（旧作废/新可用/匿名 401/登录令牌不受影响）")
