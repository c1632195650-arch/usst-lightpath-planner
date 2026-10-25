# -*- coding: utf-8 -*-
"""metrics —— 落地仪表盘 v1 计数事件（W8，码上式指标）
=================================================================
从 2026-10-25 起积累「累计用户 / 问答数 / 排程生成量」——所有后续申报材料的
硬通货。铁律三条（与脱敏纪律同向）：

  · **零内容**：不落任何用户输入/输出文本；
  · **零身份**：不落用户 ID / session / IP——只有 {date, event} 两字段；
  · **永不抛**：计数失败绝不伤业务路径（同 logutil 纪律）。

事件面（三个，调用侧只各加一行）：
  · register —— /api/auth/register 成功（注册成功才 +1，冲突/限流不计）；
  · chat    —— /api/chat 与 /api/chat/stream 经 _chat_core 成功返回（一处埋点双覆盖）；
  · plan    —— /api/sync/plan PUT 成功（用户把生成的一周计划落云 = 排程生成事实）。

聚合：scripts/metrics_aggregate.py（cron 每日 04:37）→ data/metrics_daily.json。
**不做线上查询端点**（零新增攻击面）；报告由脚本打印/入仓。
"""
import json
import os
import threading
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
METRICS_DIR = os.environ.get("LIBAO_METRICS_DIR", os.path.join(_HERE, "..", "data"))
METRICS_PATH = os.path.join(METRICS_DIR, "metrics_events.jsonl")

_lock = threading.Lock()

EVENTS = ("register", "chat", "plan")


def track(event: str) -> None:
    """记一笔计数事件：只写 {date, event}，永不抛。"""
    try:
        if event not in EVENTS:  # 事件面封闭——防调用侧手滑写出带内容的自由字段
            return
        rec = {"date": time.strftime("%Y-%m-%d"), "event": event}
        line = json.dumps(rec, ensure_ascii=False)
        with _lock:
            os.makedirs(METRICS_DIR, exist_ok=True)
            with open(METRICS_PATH, "a", encoding="utf-8", newline="\n") as f:
                f.write(line + "\n")
    except Exception:  # noqa: BLE001  计数失败绝不伤业务路径
        pass
