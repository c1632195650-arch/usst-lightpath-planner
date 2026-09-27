# -*- coding: utf-8 -*-
"""
WP12 —— H7 课表事实回写（pending 态闸门）+ H8 summarize_plan_events
==============================================================
不经 LLM、不碰真实数据库（DB_PATH 重定向到临时文件）。

用法：
    python scripts/test_plan_events.py            # 正向：全部应绿
    python scripts/test_plan_events.py --reverse  # 反向验证：
        把 add_pending_fact 改成直落 applied（绕过状态机）→ 期望出现失败（红）。
        红了才证明「系统侧事实也必须用户点头」这条闸门真的守得住。
"""
import os, sys, tempfile, argparse, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import memory  # noqa: E402


def _fresh_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    memory.DB_PATH = path
    memory._conn().close()
    return path


class PlanEventsTest(unittest.TestCase):
    def test_summarize_empty(self):
        self.assertEqual(memory.summarize_plan_events([]), "")
        self.assertEqual(memory.summarize_plan_events(None), "")

    def test_summarize_counts_and_tail(self):
        events = [
            {"type": "move_added", "title": "自习 → 周五 10:00", "ts": 1},
            {"type": "move_added", "title": "阅读 → 周六", "ts": 2},
            {"type": "task_added", "title": "体育", "ts": 3},
            {"type": "unknown_kind", "title": "x", "ts": 4},  # 未登记类型忽略
            "not-a-dict",  # 非法形状忽略
        ]
        out = memory.summarize_plan_events(events)
        self.assertIn("挪动 2 次", out)
        self.assertIn("新增 1 次", out)
        self.assertIn("最近一次：体育", out)

    def test_summarize_ignores_unknown_only(self):
        self.assertEqual(memory.summarize_plan_events([{"type": "???"}]), "")


class TimetableFactTest(unittest.TestCase):
    """H7：课表回写 —— 系统侧事实也必须走 pending 状态机（MemoryPanel 可拒）。"""

    def setUp(self):
        self.db = _fresh_db()
        self.uid = "u_test"

    def tearDown(self):
        try:
            os.remove(self.db)
        except OSError:
            pass

    def test_add_pending_fact_lands_pending_with_source(self):
        # 反向：add_pending_fact 直落 applied（绕过状态机）→ 本用例红
        fact = memory.add_pending_fact(self.uid, "objective.timetable_summary",
                                       "课表共 8 门课，每周约 40 节", source="timetable")
        self.assertIsNotNone(fact)
        self.assertEqual(fact["status"], "pending", "严禁直落 applied —— 状态机闸门")
        self.assertEqual(fact["kind"], "objective")
        # 落库侧也复核一遍（不只是返回值）
        rows = memory.list_facts(self.uid, "pending")
        self.assertTrue(any(r["id"] == fact["id"] and r["status"] == "pending" for r in rows))

    def test_pending_not_in_profile_until_confirmed(self):
        fact = memory.add_pending_fact(self.uid, "objective.timetable_summary", "课表摘要")
        prof = memory.get_profile(self.uid)
        self.assertNotIn("objective.timetable_summary", prof, "确认前不进画像")
        self.assertIsNotNone(memory.confirm_fact(fact["id"]))
        self.assertIn("objective.timetable_summary", memory.get_profile(self.uid),
                      "用户确认后才进画像（MemoryPanel 可拒）")

    def test_reject_keeps_profile_clean(self):
        fact = memory.add_pending_fact(self.uid, "objective.timetable_summary", "课表摘要")
        memory.reject_fact(fact["id"])
        self.assertNotIn("objective.timetable_summary", memory.get_profile(self.uid))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reverse", action="store_true",
                        help="反向验证：把 add_pending_fact 改成直落 applied → 期望红")
    args = parser.parse_args()
    if args.reverse:
        orig = memory.add_pending_fact

        def _broken(user_id, key, value, source="timetable"):
            """变异体：直落 applied —— 正向用例必须红。"""
            import datetime
            now = datetime.datetime.now().isoformat(timespec="seconds")
            c = memory._conn()
            c.execute("INSERT INTO facts(user_id, kind, key, value, status, source, created_at) "
                      "VALUES(?,?,?,?,?,?,?)",
                      (user_id, "objective", key, str(value)[:200], "applied", str(source)[:40], now))
            c.commit()
            c.close()
            return {"id": -1, "kind": "objective", "key": key, "value": value, "status": "applied"}
        memory.add_pending_fact = _broken
        result = unittest.TextTestRunner(verbosity=2).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(TimetableFactTest))
        sys.exit(0 if result.wasSuccessful() else 1)
    result = unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    sys.exit(0 if result.wasSuccessful() else 1)
