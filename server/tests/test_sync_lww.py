# -*- coding: utf-8 -*-
"""W10b · sync LWW 纯函数独立测试（P1-5 残项；纯 Python，禁装 pytest）
=================================================================
覆盖 `_merge_array_by_id` / `_item_newer` 的四组语义（与 TS memoTypes 同构口径）：
  ① by-id 并集：双侧独有 id 都保留；脏项（非 dict / 无 id）丢弃；
  ② 同 id 新者胜（updatedAt 可解析时间）；平局（时间相等）→ 后入者胜（stored 先入
     = 云端副本胜）；
  ③ 未来时间戳：诚实接受（客户端时钟超前赢——设计文档口径「只防回退不防未来」，
     本测试把该语义钉死：若将来加服务端钳制，改这条断言须申报）；
  ④ archived 语义：归档项参与 LWW（删除=归档=一种写，时间新则覆盖未归档）。
RV：`_item_newer` 的 `ta > tb` 改 `>=` → 平局组恰红（记录进 BLOCKERS）。
"""
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sync import _merge_array_by_id, _item_newer  # noqa: E402

NOW = "2026-10-25T12:00:00"


def it(i, upd=NOW, **over):
    return {"id": f"t{i}", "title": f"item{i}", "createdAt": "2026-10-01T00:00:00",
            "updatedAt": upd, **over}


def test_union_and_dirty():
    a = [it(1), it(2), {"no_id": True}, "not-dict", {"id": ""}]
    b = [it(3), it(1, upd="2026-10-20T00:00:00", title="older-1")]
    merged = _merge_array_by_id(a, b)  # stored=a 先入、incoming=b 后写
    ids = {m["id"] for m in merged}
    assert ids == {"t1", "t2", "t3"}, f"并集+脏项丢弃失败：{ids}"
    by_id = {m["id"]: m for m in merged}
    assert by_id["t1"]["title"] == "item1", "同 id 应取新者（a 的 10-25 > b 的 10-20）"
    print("✓ ① by-id 并集 + 脏项丢弃 + 同 id 新者胜")


def test_tie_cloud_wins():
    t = "2026-10-22T08:00:00"
    stored = [it(1, upd=t, title="cloud")]
    incoming = [it(1, upd=t, title="device")]
    merged = _merge_array_by_id(incoming, stored)
    assert merged[0]["title"] == "cloud", f"平局应云端胜（stored 先入）：{merged[0]['title']}"
    print("✓ ② 平局云端胜")


def test_future_ts_accepted():
    future = (datetime.fromisoformat(NOW) + timedelta(days=30)).isoformat()
    stored = [it(1, upd=NOW)]
    incoming = [it(1, upd=future, title="from-future-clock")]
    merged = _merge_array_by_id(incoming, stored)
    assert merged[0]["title"] == "from-future-clock", "未来时间戳按设计接受（只防回退不防未来）"
    assert _item_newer(incoming[0], stored[0]) is True
    print("✓ ③ 未来时间戳接受（语义钉死：加钳制须申报改此断言）")


def test_archived_is_a_write():
    stored = [it(1, upd=NOW)]
    incoming = [it(1, upd="2026-10-26T00:00:00", archived=True)]
    merged = _merge_array_by_id(incoming, stored)
    assert merged[0].get("archived") is True, "归档是新写：时间新则覆盖"
    # 双侧并发：本地新活项更新（10-26）vs 云端旧归档写（10-20）→ 新活项胜
    stored2 = [it(2, upd="2026-10-20T00:00:00", archived=True)]
    incoming2 = [it(2, upd="2026-10-26T00:00:00")]
    merged2 = _merge_array_by_id(incoming2, stored2)
    assert merged2[0].get("archived") is not True, "旧归档不应盖新活项"
    print("✓ ④ archived 参与逐项 LWW")


if __name__ == "__main__":
    test_union_and_dirty()
    test_tie_cloud_wins()
    test_future_ts_accepted()
    test_archived_is_a_write()
    print("\nW10b LWW 四组全过")
