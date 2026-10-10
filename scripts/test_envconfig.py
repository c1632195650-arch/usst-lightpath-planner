# -*- coding: utf-8 -*-
"""
维护批 P1-10（2026-10-11）· envconfig 收敛 + TrustedHost 测试
============================================================
跑法：.venv/Scripts/python.exe scripts/test_envconfig.py

覆盖：
  [1] load_env 解析语义：KEY=VALUE / 注释 / 值含等号 / setdefault 尊重已设变量 / 幂等；
  [2] 三模块（app/memory/plan_dialog）的 LLM 三件套与 envconfig 单一来源一致
      （收敛前它们各自手抄 —— 改实现漂移即红）；
  [3] TrustedHost：默认不启用（不设 env 的进程行为零变化 —— 由其他测试进程证明）；
      本进程设 LIBAO_TRUSTED_HOSTS 后，名单内 Host 200、伪造 Host 400。

RV 反向验证：把 envconfig.load_env 的 setdefault 改成直接赋值，[1] 必红；
把三模块任一改回手抄解析，[2] 必红。
"""
import os
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.join(_HERE, "..")
sys.path.insert(0, os.path.join(_ROOT, "server"))
sys.path.insert(0, os.path.join(_ROOT, "scripts"))

_tmpdir = tempfile.mkdtemp(prefix="_envcfg_")
os.environ["LIBAO_ACCOUNT_DB"] = os.path.join(_tmpdir, "acct.db")
os.environ["LIBAO_MEMORY_DB"] = os.path.join(_tmpdir, "memory.db")
os.environ["LLM_API_KEY"] = "test-dummy-key-not-real"
# 本进程启用 TrustedHost（其余测试进程不设此变量 → 默认不启用，行为零变化）
os.environ["LIBAO_TRUSTED_HOSTS"] = "testserver"

from envconfig import load_env, llm_settings  # noqa: E402

import memory as memory_module  # noqa: E402
memory_module._conn().close()
import app as app_module  # noqa: E402
import plan_dialog  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        FAILURES.append(f"{name} {detail}")
        print(f"  FAIL {name} {detail}")


print("[1] load_env 解析语义")
env_file = os.path.join(_tmpdir, "t.env")
with open(env_file, "w", encoding="utf-8", newline="\n") as fh:
    # EXISTING_VAR 故意与环境变量同名 —— 用于验证 setdefault（已设优先）语义
    fh.write("# 注释行\n\nFOO_BAR=hello\nEQ_VAL=a=b=c\nEXISTING_VAR=from-file\n")
os.environ["EXISTING_VAR"] = "from-env"
load_env(env_file)
load_env(env_file)  # 幂等：重复加载不炸不重复
check("普通键值", os.environ.get("FOO_BAR") == "hello", os.environ.get("FOO_BAR", ""))
check("值可含等号", os.environ.get("EQ_VAL") == "a=b=c", os.environ.get("EQ_VAL", ""))
check("已设变量不被文件覆盖（setdefault 语义）", os.environ.get("EXISTING_VAR") == "from-env")
load_env(os.path.join(_tmpdir, "not-exists.env"))
check("文件不存在静默跳过", True)

print("[2] 三模块 LLM 三件套与单一来源一致")
base, key, model = llm_settings()
check("app 一致", (app_module.LLM_BASE_URL, app_module.LLM_API_KEY, app_module.LLM_MODEL) == (base, key, model))
check("memory 一致", (memory_module.LLM_BASE_URL, memory_module.LLM_API_KEY, memory_module.LLM_MODEL) == (base, key, model))
check("plan_dialog 一致", (plan_dialog.LLM_BASE_URL, plan_dialog.LLM_API_KEY, plan_dialog.LLM_MODEL) == (base, key, model))
check("base_url rstrip 保留", base == "https://api.deepseek.com/v1", base)

print("[3] TrustedHost：名单内放行、伪造 Host 400")
client = TestClient(app_module.app)
r = client.get("/api/health")
check("名单内 Host → 200", r.status_code == 200, f"got {r.status_code}")
r = client.get("/api/health", headers={"Host": "evil.example.com"})
check("伪造 Host → 400", r.status_code == 400, f"got {r.status_code}")

print()
if FAILURES:
    print("FAIL")
    for f in FAILURES:
        print("  -", f)
    sys.exit(1)
print("PASS  envconfig 单一来源 + TrustedHost（env 可选启用）")
