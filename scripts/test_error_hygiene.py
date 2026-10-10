# -*- coding: utf-8 -*-
"""
维护批 P0-6（2026-10-11）· 异常外泄收敛 + 生产日志落盘测试
==========================================================
跑法：.venv/Scripts/python.exe scripts/test_error_hygiene.py

覆盖：
  [1] /api/weather 上游异常 → ok:false + 固定代码 weather_source_unavailable，
      异常串（含模拟的内部地址/密钥痕迹）不再出现在响应体里；
  [2] /api/plan/understand 内部异常 → reason=internal_error，细节不外泄；
  [3] timeout 分支契约保留（前端/评测按 reason 判超时重试）；
  [4] launch_be.py 源码锁：stdout/stderr 必须落盘到 _logs/（不允许再回 DEVNULL）。

RV 反向验证：把 plan_dialog 的 internal_error 分支改回 f"{type(e).__name__}: {e}"
（或 launch_be.py 改回 DEVNULL），对应断言必红。
"""
import os
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.join(_HERE, "..")
sys.path.insert(0, os.path.join(_ROOT, "server"))
sys.path.insert(0, os.path.join(_ROOT, "scripts"))

_tmpdir = tempfile.mkdtemp(prefix="_errhyg_")
os.environ["LIBAO_ACCOUNT_DB"] = os.path.join(_tmpdir, "acct.db")
os.environ["LIBAO_MEMORY_DB"] = os.path.join(_tmpdir, "memory.db")
# dummy key：让 understand 走到 _chat（否则 no_key 短路，测不到异常分支）；
# 真实外呼不会发生 —— _chat 在测试里被 monkeypatch，weather 不涉 LLM。
os.environ["LLM_API_KEY"] = "test-dummy-key-not-real"

import requests as _requests  # noqa: E402
import memory as memory_module  # noqa: E402
memory_module._conn().close()

import app as app_module  # noqa: E402
import plan_dialog  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app_module.app)
FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        FAILURES.append(f"{name} {detail}")
        print(f"  FAIL {name} {detail}")


print("[1] 天气上游异常：固定代码，不泄内部细节")
orig_get = _requests.get
def _boom(*a, **kw):
    raise RuntimeError("connect to http://internal-proxy.local:9999 timed out (secret-token)")
_requests.get = _boom
try:
    r = client.get("/api/weather", params={"days": 1})
    body = r.text
    check("weather 200 且 ok:false", r.status_code == 200 and r.json().get("ok") is False, f"got {r.status_code} {body[:80]}")
    check("固定错误码", r.json().get("error") == "weather_source_unavailable", body[:80])
    check("内部细节不外泄", "secret-token" not in body and "internal-proxy" not in body, body[:80])
finally:
    _requests.get = orig_get

print("[2] understand 内部异常 → internal_error，细节进日志不进响应")
orig_chat = plan_dialog._chat
def _chat_boom(system, user, max_tokens=0):
    raise RuntimeError("prompt path /server/secret leaked")
try:
    plan_dialog._chat = _chat_boom
    r = client.post("/api/plan/understand", json={"scene": "answer", "q": "周二晚上", "asked": ["when: 时间"]})
    body = r.text
    check("understand 200 且 ok:false", r.status_code == 200 and r.json().get("ok") is False, f"got {r.status_code} {body[:80]}")
    check("reason=internal_error", r.json().get("reason") == "internal_error", body[:80])
    check("异常细节不外泄", "secret" not in body and "RuntimeError" not in body, body[:80])
finally:
    plan_dialog._chat = orig_chat

print("[3] timeout 分支契约保留")
def _chat_timeout(system, user, max_tokens=0):
    raise _requests.Timeout("upstream slow")
try:
    plan_dialog._chat = _chat_timeout
    r = client.post("/api/plan/understand", json={"scene": "answer", "q": "周三下午", "asked": ["when: 时间"]})
    check("timeout 契约不变", r.json().get("reason") == "timeout", r.text[:80])
finally:
    plan_dialog._chat = orig_chat

print("[4] launch_be.py 源码锁：日志必须落盘 _logs/（不允许回 DEVNULL）")
with open(os.path.join(_ROOT, "launch_be.py"), encoding="utf-8") as fh:
    src = fh.read()
check("stdout 指向日志文件句柄", "stdout=_log_fh" in src, "缺少 stdout=_log_fh")
check("stderr 合流到同一文件", "stderr=subprocess.STDOUT" in src, "缺少 STDERR 合流")
check("不再使用 DEVNULL", "subprocess.DEVNULL" not in src, "subprocess.DEVNULL 仍在源码里")

print()
if FAILURES:
    print("FAIL")
    for f in FAILURES:
        print("  -", f)
    sys.exit(1)
print("PASS  异常外泄收敛（weather/understand 固定代码、timeout 契约保留、launch_be 日志落盘）")
