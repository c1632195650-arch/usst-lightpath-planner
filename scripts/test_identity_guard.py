# -*- coding: utf-8 -*-
"""
维护批 P0-1（2026-10-11）· 身份属主校验（防 IDOR）测试
======================================================
跑法：.venv/Scripts/python.exe scripts/test_identity_guard.py

覆盖（LIBAO_REQUIRE_OWNER 默认关 —— 关=旧行为，开=身份闸）：
  [1] 闸关闭：无任何凭据跨用户访问照旧放行 —— 这就是被修掉的洞（反向基线）；
  [2] 闸开启：哨兵身份 401 / 缺密钥 401 / 认领成功 200 / 密钥不符 404 /
      哨兵会话 401；/api/chat 闸在管线之前（401 时不触发检索）；
  [3] 事实属主：他人身份确认事实 → ok:false（同形不泄露）；本人 → ok:true；
  [4] 闸再关回：恢复旧行为（逃生门可运行时回退）。

RV 反向验证：把 app.py 各端点里的 `_owner_guard` 挂载删掉，[2]/[3] 必红；
[1] 本身就是「没有守卫时长什么样」的留影。
"""
import os
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.join(_HERE, "..")
sys.path.insert(0, os.path.join(_ROOT, "server"))
sys.path.insert(0, os.path.join(_ROOT, "scripts"))

_tmpdir = tempfile.mkdtemp(prefix="_idguard_")
os.environ["LIBAO_ACCOUNT_DB"] = os.path.join(_tmpdir, "acct.db")
os.environ["LIBAO_MEMORY_DB"] = os.path.join(_tmpdir, "memory.db")
# 测试环境必须无 LLM（防止真的打外网）；server/.env 里的真实 Key 靠显式置空压掉
os.environ["LLM_API_KEY"] = ""

import memory as memory_module  # noqa: E402
memory_module._conn().close()   # 临时库建表（reset 端点直连删行，表必须先在）

import app as app_module  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app_module.app)

FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        FAILURES.append(f"{name} {detail}")
        print(f"  FAIL {name} {detail}")


K_A = "identity-key-alpha"
K_B = "identity-key-bravo"
H_A = {"X-Identity-Key": K_A}
H_B = {"X-Identity-Key": K_B}


print("[1] 闸关闭（默认）：旧行为，无凭据可跨用户访问 —— 被修掉的洞长这样")
os.environ.pop("LIBAO_REQUIRE_OWNER", None)
r = client.get("/api/chat/history", params={"user_id": "stranger-a", "session_id": "someone-elses"})
check("无凭据读他人会话 → 200（洞）", r.status_code == 200, f"got {r.status_code}")
r = client.post("/api/memory/reset", json={"session_id": "s", "user_id": "stranger-a"})
check("无凭据重置他人记忆 → 200（洞）", r.status_code == 200, f"got {r.status_code}")

print("[2] 闸开启：认领 / 拒绝 / 哨兵三态")
os.environ["LIBAO_REQUIRE_OWNER"] = "1"
r = client.get("/api/chat/history", params={"user_id": "anon", "session_id": "s1"})
check("哨兵 user_id → 401 identity_required",
      r.status_code == 401 and r.json().get("error") == "identity_required", f"got {r.status_code} {r.text[:60]}")
r = client.get("/api/chat/history", params={"user_id": "u-x", "session_id": "s1"})
check("真实身份但无密钥 → 401 identity_key_required",
      r.status_code == 401 and r.json().get("error") == "identity_key_required", f"got {r.status_code} {r.text[:60]}")
r = client.get("/api/chat/history", params={"user_id": "u-x", "session_id": "s1"}, headers=H_A)
check("带密钥首次 → 认领成功 200", r.status_code == 200, f"got {r.status_code} {r.text[:60]}")
r = client.get("/api/chat/history", params={"user_id": "u-x", "session_id": "s1"}, headers=H_A)
check("同密钥复访 → 200（绑定稳定）", r.status_code == 200, f"got {r.status_code}")
r = client.get("/api/chat/history", params={"user_id": "u-x", "session_id": "s1"}, headers={"X-Identity-Key": "wrong-key"})
check("密钥不符 → 404（与不存在同形）", r.status_code == 404, f"got {r.status_code} {r.text[:60]}")
r = client.get("/api/chat/history", params={"user_id": "u-x", "session_id": "default"}, headers=H_A)
check("哨兵 session_id → 401 session_required",
      r.status_code == 401 and r.json().get("error") == "session_required", f"got {r.status_code} {r.text[:60]}")
r = client.post("/api/chat", json={"q": "你好", "user_id": "u-y", "session_id": "s-y"},
                headers={"X-Identity-Key": K_B})
check("chat 身份闸在检索管线之前放行正常请求", r.status_code == 200, f"got {r.status_code} {r.text[:60]}")
r = client.post("/api/chat", json={"q": "你好", "user_id": "u-z", "session_id": "s-z"})
check("chat 无密钥 → 401（不触发检索）",
      r.status_code == 401 and r.json().get("error") == "identity_key_required", f"got {r.status_code} {r.text[:60]}")
r = client.post("/api/memory/reset", json={"session_id": "s1", "user_id": "u-x"}, headers=H_A)
check("带密钥重置自己的记忆 → 200", r.status_code == 200 and r.json().get("ok") is True,
      f"got {r.status_code} {r.text[:60]}")

print("[3] 事实属主比对（他人 ok:false 同形 / 本人 ok:true）")
events = memory_module.propose_facts("owner-a", "我大三，平时喜欢跑步")
pending = [f for f in events["pending"] if f["key"] == "grade"]
check("预置客观事实（pending）", len(pending) == 1, str(events))
fact_id = pending[0]["id"]
r = client.get("/api/memory/facts", params={"user_id": "owner-a"})
check("无密钥列他人事实 → 401", r.status_code == 401, f"got {r.status_code}")
r = client.get("/api/memory/facts", params={"user_id": "owner-a"}, headers=H_A)
check("本人带密钥列事实 → 200 有数据", r.status_code == 200 and len(r.json().get("facts", [])) >= 1,
      f"got {r.status_code} {r.text[:60]}")
r = client.post(f"/api/memory/facts/{fact_id}/confirm", json={"user_id": "owner-b"}, headers=H_B)
check("他人身份确认 → ok:false（同形）", r.status_code == 200 and r.json().get("ok") is False,
      f"got {r.status_code} {r.text[:60]}")
r = client.post(f"/api/memory/facts/{fact_id}/confirm", json={"user_id": "owner-a"}, headers=H_A)
check("本人确认 → ok:true", r.status_code == 200 and r.json().get("ok") is True,
      f"got {r.status_code} {r.text[:60]}")
ev2 = memory_module.propose_facts("owner-a", "我大四")
pending2 = [f for f in ev2["pending"] if f["key"] == "grade"]
r = client.delete(f"/api/memory/facts/{pending2[0]['id']}", params={"user_id": "owner-b"}, headers=H_B)
check("他人身份删除 → ok:false（同形）", r.status_code == 200 and r.json().get("ok") is False,
      f"got {r.status_code} {r.text[:60]}")

print("[4] 闸运行时关回：恢复旧行为（逃生门）")
os.environ.pop("LIBAO_REQUIRE_OWNER", None)
r = client.get("/api/chat/history", params={"user_id": "stranger-b", "session_id": "x"})
check("关闸后无凭据 → 200（旧行为）", r.status_code == 200, f"got {r.status_code}")

print()
if FAILURES:
    print("FAIL")
    for f in FAILURES:
        print("  -", f)
    sys.exit(1)
print("PASS  身份属主校验（关=旧行为；开=认领/401/404/属主同形拒绝；逃生门可运行时翻转）")
