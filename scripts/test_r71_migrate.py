# -*- coding: utf-8 -*-
"""R批 P1-4 · R7.1 设备台账 → 账号台账 迁移合并（进程内单测，不依赖后端服务）
=====================================================================
CY 2026-10-03 拍板：**迁移合并**（不是弃置）。根因：`identity.getUserId()`
未登录用随机设备 id、登录后用账号名 —— 「先离线用、后登录」读写指向两个台账，
梨宝记忆凭空清零（走查实录：记忆面板 0 / 0，看着像坏了）。

KV 侧 `uploadLocalSnapshot` 搬的是 localStorage 云快照，而 facts/profiles 在
**后端 SQLite**，KV 通道碰不到 —— 这就是本模块存在的理由。

反向验证：
    python scripts/test_r71_migrate.py --reverse
    把 migrate_user_id 整个替换成 no-op（模拟「弃置」路线）→ **期望变红**。
    红了，才证明这批用例真的在守「迁移发生」这件事，而不是一套永远绿的摆设。

用法：
    python scripts/test_r71_migrate.py            # 正向：全部应绿
    python scripts/test_r71_migrate.py --reverse  # 反向验证：期望失败（红）
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import memory  # noqa: E402


def _fresh_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    memory.DB_PATH = path
    memory._conn().close()
    return path


def _all_facts(user_id):
    """全部状态的事实（含 rejected）—— 迁移测试要看被拒/被撤销的条目去向。"""
    c = memory._conn()
    rows = c.execute(
        "SELECT id, kind, key, value, status FROM facts WHERE user_id=? ORDER BY id",
        (user_id,)).fetchall()
    c.close()
    return [{"id": r[0], "kind": r[1], "key": r[2], "value": r[3], "status": r[4]} for r in rows]


class MigrateUserIdTest(unittest.TestCase):

    def setUp(self):
        self.path = _fresh_db()

    def tearDown(self):
        try:
            os.remove(self.path)
        except OSError:
            pass

    # ---------- 基本迁移 ----------
    def test_moves_pending_and_applied_facts(self):
        """设备侧 pending + applied 都搬到账号侧，条数一致。"""
        memory.add_pending_fact("dev-1", "objective.timetable_summary", "课表摘要A", source="timetable")
        memory.add_preference_fact("dev-1", "preferences.weekly_ball", "每周三打球", source="libao")
        r = memory.migrate_user_id("dev-1", "alice")
        self.assertTrue(r["moved"] >= 2, "两条都该搬过去，实际 %s" % r)
        facts = memory.list_facts("alice")
        keys = {f["key"] for f in facts}
        self.assertIn("objective.timetable_summary", keys)
        self.assertIn("preferences.weekly_ball", keys)
        # 设备侧不该剩活记录
        left = _all_facts("dev-1")
        self.assertEqual([f for f in left if f["status"] in ("pending", "applied")], [],
                         "设备侧活记录应清空，实际 %s" % left)

    def test_rejected_not_revived(self):
        """用户撤销过的（rejected）不搬 —— 撤销不该被"复活"。

        ⚠️ preference 类落的是 applied，要撤销得用 `undo_fact`（applied→rejected）；
        `reject_fact` 只吃 pending，用错函数会静默返回 None、测试变成假绿。
        """
        f = memory.add_preference_fact("dev-2", "preferences.p1", "偏好X")
        undone = memory.undo_fact(f["id"])
        self.assertIsNotNone(undone, "undo_fact 应对 applied 生效")
        self.assertEqual(_all_facts("dev-2")[0]["status"], "rejected", "撤销后应是 rejected")
        r = memory.migrate_user_id("dev-2", "bob")
        facts = memory.list_facts("bob")
        self.assertEqual([x for x in facts if x["key"] == "preferences.p1"], [],
                         "rejected 不该被搬过去")
        self.assertGreaterEqual(r["skipped"], 1)

    # ---------- 冲突策略（CY 定稿：账号优先）----------
    def test_account_wins_keeps_account_value(self):
        """冲突时保留账号侧（默认 account_wins）：同 key 账号已有一条，设备侧那条被拒。"""
        memory.add_pending_fact("dev-3", "objective.timetable_summary", "设备侧摘要")
        memory.add_pending_fact("alice3", "objective.timetable_summary", "账号侧摘要")
        r = memory.migrate_user_id("dev-3", "alice3", strategy="account_wins")
        facts = [f for f in _all_facts("alice3")
                 if f["key"] == "objective.timetable_summary"]
        live = [f for f in facts if f["status"] in ("pending", "applied")]
        self.assertEqual(len(live), 1, "同 key 只该留一条活记录，实际 %s" % facts)
        self.assertEqual(live[0]["value"], "账号侧摘要", "账号优先应留账号侧的值")
        self.assertGreaterEqual(r["skipped"], 1)

    def test_device_wins_overrides(self):
        """device_wins：保留设备侧的值（离线期信息更新鲜时用）。"""
        memory.add_pending_fact("dev-4", "objective.timetable_summary", "设备侧摘要")
        memory.add_pending_fact("alice4", "objective.timetable_summary", "账号侧摘要")
        memory.migrate_user_id("dev-4", "alice4", strategy="device_wins")
        facts = [f for f in _all_facts("alice4")
                 if f["key"] == "objective.timetable_summary"]
        live = [f for f in facts if f["status"] in ("pending", "applied")]
        self.assertEqual(len(live), 1)
        self.assertEqual(live[0]["value"], "设备侧摘要", "device_wins 应留设备侧的值")

    def test_unknown_strategy_falls_back(self):
        """未知策略不炸，落回默认 account_wins。"""
        memory.add_pending_fact("dev-5", "objective.timetable_summary", "设备侧")
        memory.add_pending_fact("alice5", "objective.timetable_summary", "账号侧")
        r = memory.migrate_user_id("dev-5", "alice5", strategy="乱写的")
        self.assertEqual(r["strategy"], "account_wins")

    # ---------- 画像合并 ----------
    def test_profile_merged_fieldwise(self):
        """画像字段级补空：账号侧没有的字段从设备侧补上，账号侧已有的不覆盖。"""
        memory.save_profile("dev-6", {"grade": "大二", "college": "光电学院", "weak": ["高数"]})
        memory.save_profile("alice6", {"grade": "大三"})
        r = memory.migrate_user_id("dev-6", "alice6")
        prof = memory.get_profile("alice6")
        self.assertEqual(prof.get("grade"), "大三", "账号侧已有值不该被覆盖")
        self.assertEqual(prof.get("college"), "光电学院", "账号侧缺的字段该补上")
        self.assertTrue(r["profile_merged"])

    def test_profile_moved_when_account_empty(self):
        """账号侧画像为空 → 设备侧整份搬过去。"""
        memory.save_profile("dev-7", {"major": "光电信息科学与工程"})
        memory.migrate_user_id("dev-7", "alice7")
        self.assertEqual(memory.get_profile("alice7").get("major"), "光电信息科学与工程")

    # ---------- 边界 ----------
    def test_same_id_is_noop(self):
        """old == new：不动数据（防手滑把自己的台账搅乱）。"""
        memory.add_preference_fact("same", "preferences.k", "v")
        r = memory.migrate_user_id("same", "same")
        self.assertEqual(r["moved"], 0)
        self.assertEqual(len(memory.list_facts("same")), 1, "数据不该被动")

    def test_empty_id_guarded(self):
        """空 id 直接拒 —— 不能把全库洗成同一个 user_id。"""
        r = memory.migrate_user_id("", "alice")
        self.assertEqual(r["moved"], 0)
        r2 = memory.migrate_user_id("dev", "")
        self.assertEqual(r2["moved"], 0)

    def test_migration_is_idempotent(self):
        """重复迁移第二次是空操作 —— 不产生重复条目。"""
        memory.add_preference_fact("dev-8", "preferences.ball", "每周三打球")
        memory.migrate_user_id("dev-8", "alice8")
        first = len(memory.list_facts("alice8"))
        memory.migrate_user_id("dev-8", "alice8")
        self.assertEqual(len(memory.list_facts("alice8")), first,
                         "重复迁移不该增加条目")


if __name__ == "__main__":
    if "--reverse" in sys.argv:
        # 反向验证：把迁移实现换成 no-op（等价于「弃置」路线）→ 期望大面积变红
        memory.migrate_user_id = lambda *a, **k: {
            "moved": 0, "skipped": 0, "profile_merged": False,
            "strategy": k.get("strategy", "account_wins")}
        print("[reverse] migrate_user_id 已替换为 no-op —— 期望出现 FAIL")
        sys.argv = [sys.argv[0]]
        unittest.main(verbosity=2)
    else:
        unittest.main(verbosity=2)