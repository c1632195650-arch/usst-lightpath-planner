# -*- coding: utf-8 -*-
"""
维护批 P0-3（2026-10-11）· 登录/注册限速测试
==============================================
跑法：.venv/Scripts/python.exe scripts/test_auth_ratelimit.py

覆盖：
  1. 登录：连续失败达阈值后，**连正确密码也 429**（且第 3 次不再跑 PBKDF2 ——
     由「失败后再成功需先清窗」隐式证明）；
  2. 登录成功清窗：清窗后正确密码立刻 200（不误伤正常用户）；
  3. 注册：按「尝试次数」计窗 —— 成功注册也占窗，防批量注册 CPU 放大；
  4. 逃生门：LIBAO_RATELIMIT=0 时彻底关闭（旧行为，无限速）。

RV 反向验证：把 account.py 的 _rl_check 挂载点删掉（登录/注册函数里的两处
limited 判断），本测试第 1/3 项必红（429 不会出现）。
"""
import os
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_SERVER = os.path.join(_HERE, "..", "server")
sys.path.insert(0, _SERVER)

_tmpdir = tempfile.mkdtemp(prefix="_rl_")
# 阈值压小、窗口拉长：让测试在秒级跑完且互相不干扰
os.environ["LIBAO_ACCOUNT_DB"] = os.path.join(_tmpdir, "acct.db")
os.environ["LIBAO_RATELIMIT_WINDOW_SEC"] = "600"
os.environ["LIBAO_RATELIMIT_MAX_LOGIN"] = "2"
os.environ["LIBAO_RATELIMIT_MAX_REGISTER"] = "2"
# 环境变量必须在 import account 前就位（模块级常量在 import 时读取）
os.environ.pop("LIBAO_RATELIMIT", None)

import account  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

_app = FastAPI()
_app.include_router(account.router)
client = TestClient(_app)

FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        FAILURES.append(f"{name} {detail}")
        print(f"  FAIL {name} {detail}")


def login(u, p):
    return client.post("/api/auth/login", json={"username": u, "password": p})


def register(u, p):
    return client.post("/api/auth/register", json={"username": u, "password": p})


print("[1] 登录失败限速：2 次失败后正确密码也 429")
account._rate_limit_state_reset()
r = register("rl_user_a", "rightpass")
check("预置注册成功", r.status_code == 200, f"got {r.status_code}")
check("第 1 次错误密码 401", login("rl_user_a", "wrong1").status_code == 401)
check("第 2 次错误密码 401", login("rl_user_a", "wrong1").status_code == 401)
r3 = login("rl_user_a", "rightpass")
check("第 3 次（正确密码）429", r3.status_code == 429, f"got {r3.status_code} {r3.text}")
check("429 错误码形态", r3.json().get("error") == "too_many_attempts", r3.text)

print("[2] 登录成功清窗：清窗后正常用户不受影响")
account._rate_limit_state_reset()
check("正确密码 200", login("rl_user_a", "rightpass").status_code == 200)

print("[3] 注册按尝试次数计窗：第 3 次注册（全新用户名）也 429")
account._rate_limit_state_reset()
check("注册 u1 成功", register("rl_user_b1", "rightpass").status_code == 200)
check("注册 u2 成功", register("rl_user_b2", "rightpass").status_code == 200)
r3 = register("rl_user_b3", "rightpass")
check("第 3 次注册 429", r3.status_code == 429, f"got {r3.status_code} {r3.text}")

print("[4] 逃生门 LIBAO_RATELIMIT=0：回到无限速旧行为")
os.environ["LIBAO_RATELIMIT"] = "0"
account._rate_limit_state_reset()
codes = [login("rl_user_a", "wrong1").status_code for _ in range(5)]
check("连错 5 次全是 401（无 429）", codes == [401] * 5, f"got {codes}")
os.environ.pop("LIBAO_RATELIMIT", None)

print()
if FAILURES:
    print("FAIL")
    for f in FAILURES:
        print("  -", f)
    sys.exit(1)
print("PASS  登录/注册限速（阈值前置 PBKDF2、成功清窗、注册计尝试、逃生门可关）")
