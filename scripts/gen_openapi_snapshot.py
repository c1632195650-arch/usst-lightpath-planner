#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""W5 · openapi 快照生成器（2026-10-25 工作单 W5：ST204 销项）
=============================================================
此前快照是手工维护的，schemathesis 193 例唯一发现 = ST204×10
（未声明方法回 405，快照未声明 405）。本脚本把快照转为「生成+入库」：

  ① 拉活后端 /openapi.json（FastAPI 自带；公网被 nginx SPA 拦截，
     默认走 --via-ssh 到服务器 localhost:8000）；
  ② 后处理：每个操作的 responses 注入 405（与 422 若缺）；
  ③ **只增不删**合并：现有快照里 live 文档没有的声明（历史路径等）
     原样保留；live 与既有重叠的操作，既有响应声明不被覆盖；
  ④ 写 data/openapi_snapshot.json（键序与 live 文档一致，diff 干净）。

用法：
  python scripts/gen_openapi_snapshot.py [--url http://127.0.0.1:8000/openapi.json]
                                        [--via-ssh]   # 经 ssh 拉 43.142.141.186 的 localhost
                                        [--out data/openapi_snapshot.json]
                                        [--dry-run]   # 只打印 diff 摘要不写
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(BASE, "..", "data", "openapi_snapshot.json")
SSH = ["ssh", "-i", os.path.expanduser("~/.ssh/SLGS.pem"), "-o", "BatchMode=yes",
       "ubuntu@43.142.141.186", "curl -s http://127.0.0.1:8000/openapi.json"]
METHODS = ("get", "post", "put", "delete", "patch", "head", "options")

RESP_405 = {"description": "Method Not Allowed（该路径未声明的方法；带 Allow 头）"}
RESP_422 = {"description": "Validation Error（请求参数校验失败）"}

# W5 实测补充声明（schemathesis 逐项销项；只增）：
#   401 = 带鉴权端点对无凭据/坏凭据的合法响应；400 = register 的业务拒绝（重名等）。
_RESP_401 = {"description": "Unauthorized（缺/坏凭据；或身份不符）"}
_RESP_400 = {"description": "Bad Request（业务拒绝，如用户名已存在/用户名非法）"}
_RESP_404 = {"description": "Not Found（如 token 无对应计划）"}
_RESP_409 = {"description": "Conflict（用户名已被占用）"}
_RESP_429 = {"description": "Too Many Requests（登录限速）"}
EXTRA_RESPONSES = {
    ("put", "/api/sync/state"): {"401": _RESP_401},
    ("get", "/api/sync/state"): {"401": _RESP_401},
    ("get", "/api/sync/plan"): {"401": _RESP_401},
    ("put", "/api/sync/plan"): {"401": _RESP_401},
    ("get", "/api/sync/plan.ics"): {"401": _RESP_401, "404": _RESP_404},
    ("post", "/api/auth/ics/reset"): {"401": _RESP_401},
    ("post", "/api/auth/login"): {"401": _RESP_401, "429": _RESP_429},
    ("post", "/api/auth/register"): {"400": _RESP_400, "409": _RESP_409, "429": _RESP_429},
}
# SSE 端点的 200 内容类型（live 文档只声明 application/json，实测是 text/event-stream）
_SSE_PATHS = {("post", "/api/chat/stream")}


def fetch_live(url, via_ssh):
    if via_ssh:
        r = subprocess.run(SSH, capture_output=True, text=True, timeout=60)
        if r.returncode != 0 or not r.stdout.strip().startswith("{"):
            raise RuntimeError(f"ssh 拉取失败：{r.stderr[:200]}")
        return json.loads(r.stdout)
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def inject_and_merge(live, existing):
    """live 为主体；注入 405/422；existing 独有声明只增保留。返回 (merged, stats)。"""
    merged = json.loads(json.dumps(live))  # 深拷贝
    stats = {"ops": 0, "added_405": 0, "added_422": 0, "kept_only_existing_paths": 0}
    ex_paths = (existing or {}).get("paths", {})
    for path, item in merged["paths"].items():
        for method, op in item.items():
            if method not in METHODS:
                continue
            stats["ops"] += 1
            responses = op.setdefault("responses", {})
            if "405" not in responses:
                responses["405"] = dict(RESP_405)
                stats["added_405"] += 1
            if "422" not in responses:
                responses["422"] = dict(RESP_422)
                stats["added_422"] += 1
            extra = EXTRA_RESPONSES.get((method, path))
            if extra:
                for code, decl in extra.items():
                    responses.setdefault(code, decl)
            if (method, path) in _SSE_PATHS:
                r200 = responses.setdefault("200", {"description": "Successful Response"})
                content = r200.setdefault("content", {})
                # SSE：data 帧是 JSON 文本、非纯标量——schema 不约束（ST108 实录：标 string 会误报）
                content.setdefault("text/event-stream", {})
            # 只增：既有快照的响应声明（live 没有的）保留
            ex_op = ex_paths.get(path, {}).get(method)
            if ex_op:
                for code, decl in (ex_op.get("responses") or {}).items():
                    responses.setdefault(code, decl)
    # 只增：existing 独有的整个路径保留（live 没有的历史声明）
    for path, item in ex_paths.items():
        if path not in merged["paths"]:
            merged["paths"][path] = item
            stats["kept_only_existing_paths"] += 1
    return merged, stats


def main():
    ap = argparse.ArgumentParser(description="W5 openapi 快照生成器")
    ap.add_argument("--url", default="http://127.0.0.1:8000/openapi.json")
    ap.add_argument("--via-ssh", action="store_true")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    live = fetch_live(a.url, a.via_ssh)
    existing = {}
    if os.path.exists(a.out):
        try:
            with open(a.out, encoding="utf-8") as f:
                existing = json.load(f)
        except json.JSONDecodeError:
            print("⚠️ 现有快照解析失败，按无既有处理")
    merged, stats = inject_and_merge(live, existing)
    print(f"live 文档：{len(live['paths'])} 路径 / {stats['ops']} 操作；"
          f"注入 405×{stats['added_405']}、422×{stats['added_422']}；"
          f"保留既有独有路径 ×{stats['kept_only_existing_paths']}")
    if a.dry_run:
        print("（dry-run，未写入）")
        return
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"✅ 已写 {os.path.relpath(a.out)}（快照只增纪律：不删既有声明）")


if __name__ == "__main__":
    main()
