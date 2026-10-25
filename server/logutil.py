# -*- coding: utf-8 -*-
"""logutil —— 服务端 JSONL 日志统一出口（W10c，P1-4 残项）
=================================================================
此前 server 各模块用裸 print 打运维日志：systemd 里能看，但要 grep/聚合
得逐模块解析自由文本。本模块给一个**零依赖**的结构化出口：

  · log_event(module, event, **fields) → 单行 JSON 追加 data/logs/server_events.jsonl
    （字段全 str 化，异常对象取 repr；永不抛——日志失败不能伤业务）；
  · 兼容层：launch_be 已有日志落盘惯例（_logs/）不变，本模块只服务
    「请求路径上的结构化事件」（检索门/LLM 降级/同步冲突这类）；
  · 调用侧改造（只增不改语义）：app/memory/plan_dialog 的**异常分支**
    print 逐步换 log_event（本批先接 4 处高频点，其余随批次自然收敛）。

用法：
    from logutil import log_event
    log_event("chat", "llm_fallback", rid=rid, reason=repr(e))
"""
import json
import os
import threading
from datetime import datetime

_HERE = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.environ.get("LIBAO_LOG_DIR", os.path.join(_HERE, "..", "data", "logs"))
LOG_PATH = os.path.join(LOG_DIR, "server_events.jsonl")

_lock = threading.Lock()


def log_event(module: str, event: str, **fields) -> None:
    """结构化事件日志：单行 JSON，永不抛。"""
    try:
        rec = {"ts": datetime.now().isoformat(timespec="milliseconds"),
               "module": str(module), "event": str(event)}
        for k, v in fields.items():
            rec[k] = repr(v) if isinstance(v, BaseException) else v
        line = json.dumps(rec, ensure_ascii=False, default=str)
        with _lock:
            os.makedirs(LOG_DIR, exist_ok=True)
            with open(LOG_PATH, "a", encoding="utf-8", newline="\n") as f:
                f.write(line + "\n")
    except Exception:  # noqa: BLE001  日志失败绝不伤业务路径
        pass
