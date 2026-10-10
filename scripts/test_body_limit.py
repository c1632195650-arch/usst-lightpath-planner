# -*- coding: utf-8 -*-
"""
维护批 P0-4（2026-10-11）· 请求体大小上限测试
==============================================
跑法：.venv/Scripts/python.exe scripts/test_body_limit.py

覆盖（阈值压到 KB 级，秒级跑完）：
  1. 普通小 body → 正常通过（200/422，不误伤）；
  2. 超 LIBAO_MAX_BODY_MB 的 body → 413 payload_too_large；
  3. 同样大小的 body 打 PDF 通道（LIBAO_MAX_PDF_MB 更宽）→ 不吃 413；
  4. 逃生门 LIBAO_MAX_BODY_MB=0 → 闸关闭，回到无上限旧行为。

RV 反向验证：把 app.py 的 _body_size_guard 中间件整个摘掉，第 2 项必红。
"""
import os
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.join(_HERE, "..")
sys.path.insert(0, os.path.join(_ROOT, "server"))
sys.path.insert(0, os.path.join(_ROOT, "scripts"))

_tmpdir = tempfile.mkdtemp(prefix="_bodylimit_")
os.environ["LIBAO_ACCOUNT_DB"] = os.path.join(_tmpdir, "acct.db")
os.environ["LIBAO_MEMORY_DB"] = os.path.join(_tmpdir, "memory.db")
# 阈值压小：全局 1KB；PDF 通道 200KB（测试体 100KB：超全局、不超 PDF）
os.environ["LIBAO_MAX_BODY_MB"] = "0.001"
os.environ["LIBAO_MAX_PDF_MB"] = "0.2"

import app as app_module  # noqa: E402  （必须在环境变量就位后导入）
import memory as memory_module  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# 临时库建表（/api/memory/reset 直接连库删行，表必须先存在）
memory_module._conn().close()

client = TestClient(app_module.app)

FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        FAILURES.append(f"{name} {detail}")
        print(f"  FAIL {name} {detail}")


BIG = b"x" * 100_000

print("[1] 普通小 body 正常通过")
r = client.post("/api/memory/reset", json={"session_id": "s1", "user_id": "u1"})
check("小 body 不吃 413", r.status_code == 200, f"got {r.status_code} {r.text[:80]}")

print("[2] 超限 body → 413")
r = client.post("/api/memory/reset", content=BIG, headers={"Content-Type": "application/json"})
check("100KB 打全局通道 → 413", r.status_code == 413, f"got {r.status_code} {r.text[:80]}")
check("413 错误码形态", r.json().get("error") == "payload_too_large", r.text[:80])

print("[3] PDF 通道额度更宽：同体积不吃 413")
r = client.post("/api/import_pdf", content=BIG, headers={"Content-Type": "application/pdf"})
check("100KB 打 PDF 通道不 413", r.status_code != 413, f"got {r.status_code} {r.text[:80]}")

print("[4] 逃生门 LIBAO_MAX_BODY_MB=0")
os.environ["LIBAO_MAX_BODY_MB"] = "0"
r = client.post("/api/memory/reset", content=BIG, headers={"Content-Type": "application/json"})
check("闸关闭后 100KB 不再 413", r.status_code != 413, f"got {r.status_code} {r.text[:80]}")

print()
if FAILURES:
    print("FAIL")
    for f in FAILURES:
        print("  -", f)
    sys.exit(1)
print("PASS  请求体上限（全局/PDF 分档、413 形态、逃生门可关）")
