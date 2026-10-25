# -*- coding: utf-8 -*-
"""W3/C1 · schemaVer=3 兼容矩阵（CY 拍板条件：测试先行；v2 载荷不得清空 deadlines）
=================================================================
四组（部署前在本地跑——直接 import sync 模块测常量与合并语义，不起服务）：
  ① v2 载荷上行（无 deadlines 字段）→ 云端 deadlines 保留（PRESERVE_KEYS 语义）
  ② v3 往返：deadlines 并集（by-id LWW）、archived 语义
  ③ MIN_SCHEMA_VER 仍为 1（v1 老 App 不炸）
  ④ SCHEMA_VER=3 且 deadlines ∈ MERGED_ARRAY_KEYS（常量本身的可执行断言）
RV：PRESERVE_KEYS 摘掉 deadlines → ①恰红。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import sync  # noqa: E402


def test_constants():
    assert sync.SCHEMA_VER == 3, f"SCHEMA_VER 应为 3：{sync.SCHEMA_VER}"
    assert sync.MIN_SCHEMA_VER == 1, "MIN_SCHEMA_VER 必须维持 1（v1 老 APK 兼容，CY 条款）"
    assert "deadlines" in sync.MERGED_ARRAY_KEYS, "deadlines 必须进逐项 LWW"
    assert "deadlines" in sync.PRESERVE_KEYS, "deadlines 必须进旧客户端保留集"
    print("✓ ④ 常量：SCHEMA_VER=3 / MIN_SCHEMA_VER=1 / deadlines 双清单在位")


def test_v2_payload_preserves_deadlines():
    """CY 条款核心：v2 载荷（无 deadlines 字段）上行 → 云端 deadlines 不得清空。"""
    # 模拟 merge 循环核心（api_sync_state_put 的 v>=SCHEMA_VER 分支同构）：
    stored = {"todos": [], "deadlines": [
        {"id": "d1", "title": "六级报名", "dueAt": "2026-11-01",
         "source": "user", "updatedAt": "2026-10-20T00:00:00"},
    ]}
    incoming_v2 = {"todos": [{"id": "t9", "title": "new", "createdAt": NOW}]}  # 无 deadlines 键
    state = dict(incoming_v2)
    # PRESERVE_KEYS 语义：v2 不带 deadlines → 云端保留（api_sync_state_put v1 分支同构）
    for k in sync.PRESERVE_KEYS:
        if k not in state and k in stored:
            state[k] = stored[k]
    assert len(state.get("deadlines", [])) == 1, "v2 上行清空了 deadlines！"
    # MERGED 语义：v2 带 deadlines=[]（显式空）→ 并集不清空（stored 有项）
    state2 = dict(incoming_v2, deadlines=[])
    for k in sync.MERGED_ARRAY_KEYS:
        state2[k] = sync._merge_array_by_id(state2.get(k), stored.get(k))
    assert len(state2["deadlines"]) == 1, "空 deadlines 并集丢项"
    print("✓ ① v2 载荷不清空 deadlines（PRESERVE + 并集双路）")


def test_v3_roundtrip_and_archived():
    NOW2 = "2026-10-26T00:00:00"
    stored = {"deadlines": [
        {"id": "d1", "title": "六级报名", "dueAt": "2026-11-01", "source": "user",
         "updatedAt": "2026-10-20T00:00:00"},
        {"id": "d2", "title": "实验报告", "dueAt": "2026-10-30", "source": "event",
         "updatedAt": "2026-10-20T00:00:00"},
    ]}
    incoming = {"deadlines": [
        {"id": "d2", "title": "实验报告", "dueAt": "2026-10-30", "source": "event",
         "updatedAt": NOW2, "archived": True},  # 手机端归档（更晚的时间戳）
        {"id": "d3", "title": "光电杯", "dueAt": "2026-11-15", "source": "user",
         "updatedAt": NOW2},  # 新增
    ]}
    state = dict(incoming)
    for k in sync.MERGED_ARRAY_KEYS:
        state[k] = sync._merge_array_by_id(state.get(k), stored.get(k))
    by_id = {d["id"]: d for d in state["deadlines"]}
    assert len(by_id) == 3, f"并集应 3 条：{list(by_id)}"
    assert by_id["d2"].get("archived") is True, "归档写（更晚）应胜"
    assert by_id["d1"]["title"] == "六级报名", "未动项保留"
    assert by_id["d3"]["title"] == "光电杯", "新增保留"
    print("✓ ② v3 往返：by-id LWW + archived 语义")


def test_min_schema_v1():
    assert sync.MIN_SCHEMA_VER == 1
    # v1 分支语义：PRESERVE_KEYS 含 deadlines → v1 老客户端 PUT 时云端 deadlines 保留
    assert "deadlines" in sync.PRESERVE_KEYS
    print("✓ ③ MIN_SCHEMA_VER=1 + v1 保留路径覆盖 deadlines")


NOW = "2026-10-25T00:00:00"

if __name__ == "__main__":
    test_constants()
    test_v2_payload_preserves_deadlines()
    test_v3_roundtrip_and_archived()
    test_min_schema_v1()
    print("\nW3/C1 兼容矩阵四组全过（部署前置达成）")
