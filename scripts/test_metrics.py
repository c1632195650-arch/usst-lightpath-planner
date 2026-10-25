# -*- coding: utf-8 -*-
"""W8 · metrics 守卫测试（2026-10-25，自跑器风格，纯离线）
====================================================
① track：只写 {date, event} 两字段（隐私自检：事件面封闭、无自由字段）；
   未知事件名静默忽略；永不抛。
② aggregate：按日 new_* + cumulative_* 数学正确；幂等重跑逐字节一致；
   脏行跳过不炸。
③ 隐私自检：events jsonl 每行 keys == {date, event}，无任何第三字段。
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

import metrics  # noqa: E402
import metrics_aggregate  # noqa: E402


def test_track_shape_and_privacy():
    tmp = tempfile.mkdtemp()
    metrics.METRICS_DIR = tmp
    metrics.METRICS_PATH = os.path.join(tmp, "metrics_events.jsonl")
    metrics.track("register")
    metrics.track("chat")
    metrics.track("chat")
    metrics.track("plan")
    metrics.track("HACK-自由事件名")  # 事件面封闭：应被忽略
    rows = [json.loads(l) for l in open(metrics.METRICS_PATH, encoding="utf-8") if l.strip()]
    assert len(rows) == 4, f"应恰好 4 行（未知事件忽略）：{len(rows)}"
    for r in rows:
        assert set(r.keys()) == {"date", "event"}, f"隐私铁律：只许 {date,event} 两字段：{r}"
        assert r["event"] in metrics.EVENTS
    # 永不抛：路径是目录炸弹也不许伤业务
    metrics.METRICS_PATH = os.path.join(tmp, "no_such_dir", "x.jsonl")
    metrics.METRICS_DIR = os.path.join(tmp, "no_such_dir")
    metrics.track("chat")  # 静默通过
    metrics.METRICS_DIR = tmp
    metrics.METRICS_PATH = os.path.join(tmp, "metrics_events.jsonl")
    print("✓ ① track：{date,event} 两字段 + 事件面封闭 + 永不抛")


def test_aggregate_math_and_idempotent():
    tmp = tempfile.mkdtemp()
    ev = os.path.join(tmp, "events.jsonl")
    with open(ev, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps({"date": "2026-10-24", "event": "register"}) + "\n")
        f.write(json.dumps({"date": "2026-10-24", "event": "chat"}) + "\n")
        f.write(json.dumps({"date": "2026-10-24", "event": "chat"}) + "\n")
        f.write(json.dumps({"date": "2026-10-25", "event": "plan"}) + "\n")
        f.write("半行脏数据{{{不炸\n")
    out = os.path.join(tmp, "daily.json")
    days, _ = metrics_aggregate.aggregate(ev, out)
    assert len(days) == 2, f"应聚合出 2 天：{len(days)}"
    d24, d25 = days
    assert d24["register"] == 1 and d24["chat"] == 2 and d24["plan"] == 0
    assert d24["cumulative_users"] == 1 and d24["cumulative_chats"] == 2 and d24["cumulative_plans"] == 0
    assert d25["plan"] == 1 and d25["cumulative_plans"] == 1 and d25["cumulative_chats"] == 2
    first = open(out, "rb").read()
    days2, _ = metrics_aggregate.aggregate(ev, out)
    assert open(out, "rb").read() == first, "幂等：重跑输出逐字节一致"
    assert days2 == days
    print("✓ ② aggregate：new/cumulative 数学正确 + 幂等逐字节一致 + 脏行跳过")


if __name__ == "__main__":
    test_track_shape_and_privacy()
    test_aggregate_math_and_idempotent()
    print("\nW8 metrics 守卫全过")
