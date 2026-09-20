# -*- coding: utf-8 -*-
"""
梨宝 · 记忆回写单测（M2：偏好自动生效可撤销 / 客观事实须确认）
==============================================================
不依赖后端服务、不碰真实数据库 —— DB_PATH 被重定向到临时文件。

用法：
    python scripts/test_memory_facts.py            # 正向：全部应绿
    python scripts/test_memory_facts.py --reverse  # 反向验证：
        把「分流」关掉（一切事实都自动生效 = 旧 update_profile 的行为），
        再跑同一套用例 —— **期望出现失败（红）**。
        红了，才证明这批测试真的守住了「客观事实必须用户确认」这条规则，
        而不是一套永远绿的摆设。退出码 0 = 反向验证成功（确实变红了）。
"""
import os, sys, tempfile, argparse, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import memory  # noqa: E402


def _fresh_db():
    """每个用例独享一个临时库，互不污染。"""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    memory.DB_PATH = path
    memory._conn().close()  # 触发建表
    return path


class MemoryFactsTest(unittest.TestCase):
    def setUp(self):
        self.db = _fresh_db()
        self.uid = "u_test"

    def tearDown(self):
        try:
            os.remove(self.db)
        except OSError:
            pass

    # ---------- 偏好类：自动生效 ----------
    def test_preference_auto_applies_to_profile(self):
        ev = memory.propose_facts(self.uid, "我不吃香菜")
        self.assertTrue(ev["applied"], "偏好类必须自动生效")
        self.assertFalse(ev["pending"], "偏好类不该挂起")
        prof = memory.get_profile(self.uid)
        self.assertEqual(prof.get("preferences", {}).get("忌口"), "香菜")

    def test_weak_and_course_are_preferences(self):
        ev = memory.propose_facts(self.uid, "我高数听不懂，在学C语言")
        kinds = {f["key"].split(".")[0] for f in ev["applied"]}
        self.assertIn("weak", kinds, "自认薄弱算偏好类")
        self.assertIn("course", kinds, "提及课程算偏好类")

    # ---------- 客观事实：只挂起，用户确认才进画像 ----------
    def test_objective_fact_pends_and_profile_untouched(self):
        ev = memory.propose_facts(self.uid, "我是光电学院大二的学生")
        self.assertTrue(ev["pending"], "身份类客观事实必须挂起等确认")
        for f in ev["pending"]:
            self.assertEqual(f["kind"], "objective")
        prof = memory.get_profile(self.uid)
        self.assertNotIn("grade", prof, "确认前画像里绝不能出现年级")
        self.assertNotIn("college", prof, "确认前画像里绝不能出现学院")

    def test_confirm_fact_merges_into_profile(self):
        ev = memory.propose_facts(self.uid, "我是大二学生")
        fid = ev["pending"][0]["id"]
        r = memory.confirm_fact(fid)
        self.assertIsNotNone(r)
        self.assertEqual(r["status"], "applied")
        self.assertEqual(memory.get_profile(self.uid).get("grade"), "大二")

    def test_reject_fact_never_enters_profile(self):
        ev = memory.propose_facts(self.uid, "我是大三学生")
        fid = ev["pending"][0]["id"]
        memory.reject_fact(fid)
        self.assertNotIn("grade", memory.get_profile(self.uid))
        # 拒绝的记录不再出现在面板（面板只列 pending + applied）
        self.assertEqual(
            [f for f in memory.list_facts(self.uid) if f["status"] == "rejected"], [])

    def test_undo_preference_removes_from_profile(self):
        ev = memory.propose_facts(self.uid, "我不吃香菜")
        fid = ev["applied"][0]["id"]
        r = memory.undo_fact(fid)
        self.assertIsNotNone(r)
        prof = memory.get_profile(self.uid)
        self.assertNotIn("忌口", prof.get("preferences", {}), "撤销后画像里不能留痕迹")

    def test_delete_applied_fact_cleans_profile(self):
        ev = memory.propose_facts(self.uid, "我喜欢打羽毛球")
        fid = ev["applied"][0]["id"]
        self.assertTrue(memory.delete_fact(fid))
        self.assertNotIn("喜欢", memory.get_profile(self.uid).get("preferences", {}))

    # ---------- 去重 ----------
    def test_duplicate_fact_not_proposed_twice(self):
        memory.propose_facts(self.uid, "我不吃香菜")
        ev2 = memory.propose_facts(self.uid, "我真的不吃香菜")
        self.assertEqual(ev2["applied"], [], "同一事实不能重复弹卡/重复生效")

    def test_changed_objective_value_still_pends(self):
        memory.propose_facts(self.uid, "我是大一学生")
        ev = memory.propose_facts(self.uid, "我现在大二了")
        self.assertTrue(ev["pending"], "同字段新值 = 变更，仍要用户确认")
        self.assertNotIn("grade", memory.get_profile(self.uid))

    # ---------- 面板查询 ----------
    def test_list_facts_filters(self):
        memory.propose_facts(self.uid, "我是大一学生")     # pending
        memory.propose_facts(self.uid, "我不吃香菜")       # applied
        allf = memory.list_facts(self.uid)
        self.assertEqual({f["status"] for f in allf}, {"pending", "applied"})
        self.assertEqual({f["status"] for f in memory.list_facts(self.uid, "pending")}, {"pending"})

    # ---------- remember 入口 ----------
    def test_remember_returns_events_for_user_role(self):
        ev = memory.remember(self.uid, "s_t", "user", "我是大二学生，不吃香菜")
        self.assertTrue(ev["pending"] and ev["applied"])
        ev2 = memory.remember(self.uid, "s_t", "assistant", "好的，记住了")
        self.assertEqual(ev2, {"pending": [], "applied": []})


# ---------------- 反向验证 ----------------
def _old_style_propose(user_id, text):
    """旧实现复刻：抽取后**不分流**，全部直接并入画像（M2 之前的行为）。"""
    facts = memory.extract_facts(text)
    if not facts:
        return {"pending": [], "applied": []}
    p = memory.get_profile(user_id)
    applied = []
    for k, v in facts.items():
        if k in ("weak", "courses"):
            cur = p.get(k, [])
            p[k] = list(dict.fromkeys(cur + (v if isinstance(v, list) else [v])))
        elif k == "preferences":
            p.setdefault("preferences", {}).update(v)
        else:
            p[k] = v
        applied.append({"id": -1, "kind": "preference", "key": k, "value": str(v)})
    memory.save_profile(user_id, p)
    return {"pending": [], "applied": applied}


def run_reverse():
    """关掉分流 → 同一套用例期望变红。红 = 测试守得住；绿 = 测试是摆设。"""
    _fresh_db()
    orig = memory.propose_facts
    memory.propose_facts = _old_style_propose
    try:
        suite = unittest.TestLoader().loadTestsFromTestCase(MemoryFactsTest)
        result = unittest.TextTestRunner(verbosity=1).run(suite)
    finally:
        memory.propose_facts = orig
    if result.wasSuccessful():
        print("\n❌ 反向验证失败：分流关掉后用例仍然全绿 —— 这套测试守不住规则！")
        return 1
    failed = len(result.failures) + len(result.errors)
    print(f"\n✅ 反向验证成功：分流关闭后 {failed} 个用例如期变红 —— 测试真的在守「客观事实须确认」。")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reverse", action="store_true", help="反向验证：关分流，期望变红")
    args = ap.parse_args()
    sys.argv = [sys.argv[0]]  # unittest 会自己解析 sys.argv，先摘掉我们的参数
    if args.reverse:
        sys.exit(run_reverse())
    suite = unittest.TestLoader().loadTestsFromTestCase(MemoryFactsTest)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)


if __name__ == "__main__":
    main()
