# -*- coding: utf-8 -*-
"""
梨宝 · 聊天跨会话恢复单测（E8：history_messages + GET /api/chat/history）
==========================================================================
不依赖后端服务（不起 uvicorn、不发网络请求）—— DB_PATH 被重定向到临时文件，
端点函数直接以普通函数调用（app 模块可安全 import，路由已注册）。

用法：
    python scripts/test_chat_history.py            # 正向：全部应绿
    python scripts/test_chat_history.py --reverse  # 反向验证：
        把 history_messages 换成「降序返回 + 丢脱敏」的坏实现，
        再跑同一套用例 —— **期望出现失败（红）**。
        红了，才证明这批测试真的守住了「升序恢复 + 出口脱敏」。
"""
import os, sys, tempfile, argparse, unittest

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

import memory  # noqa: E402


def _fresh_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    memory.DB_PATH = path
    memory._conn().close()  # 触发建表
    return path


class ChatHistoryTest(unittest.TestCase):
    def setUp(self):
        self.db = _fresh_db()
        self.sid = "s_test"
        # 直接往 messages 表塞 5 条（含一条未经脱敏的手机号原文，模拟历史脏数据）
        for i, (role, text) in enumerate([
            ("user", "学校有没有麦当劳"),
            ("assistant", "有的宝子～『麦当劳』就在第二食堂"),
            ("user", "那它几点开门"),
            ("assistant", "我的手机是 13800138000，联系我"),   # 脏数据：落库时未脱敏
            ("user", "谢谢宝子"),
        ]):
            memory.add_message(self.sid, "u_test", role, text)

    def tearDown(self):
        try:
            os.remove(self.db)
        except OSError:
            pass

    def test_history_ascending_with_ids(self):
        rows = memory.history_messages(self.sid)
        self.assertEqual(len(rows), 5)
        ids = [r["id"] for r in rows]
        self.assertEqual(ids, sorted(ids), "历史必须升序返回")
        self.assertEqual(len(set(ids)), 5, "id 必须唯一")
        self.assertEqual(rows[0]["content"], "学校有没有麦当劳")
        self.assertEqual(rows[-1]["content"], "谢谢宝子")
        for r in rows:
            self.assertIn(r["role"], ("user", "assistant"))
            self.assertTrue(r["created_at"])

    def test_history_limit_keeps_latest_in_ascending_order(self):
        rows = memory.history_messages(self.sid, 2)
        self.assertEqual([r["content"] for r in rows],
                         ["我的手机是 13800138000，联系我", "谢谢宝子"],
                         "取最近 k 条，但仍按升序排")

    def test_history_empty_session(self):
        self.assertEqual(memory.history_messages("s_none"), [])

    def test_history_bad_limit(self):
        self.assertEqual(memory.history_messages(self.sid, 0), [])
        self.assertEqual(len(memory.history_messages(self.sid, -3)), 0)

    # ---------- 端点层：出口脱敏 + limit 夹取 ----------
    def test_endpoint_desensitizes_and_orders(self):
        import app
        out = app.api_chat_history(user_id="u_test", session_id=self.sid, limit=50)
        msgs = out["messages"]
        self.assertEqual(len(msgs), 5)
        joined = "".join(m["content"] for m in msgs)
        self.assertNotIn("13800138000", joined, "出口必须再过一遍脱敏（防历史脏数据回流）")
        self.assertIn("[手机号]", joined)
        contents = [m["content"] for m in msgs]
        self.assertEqual(contents[-1], "谢谢宝子", "端点同样升序")

    def test_endpoint_limit_clamped(self):
        import app
        out = app.api_chat_history(user_id="u_test", session_id=self.sid, limit=1000)
        self.assertEqual(len(out["messages"]), 5, "limit 上限 200，但不超过实际条数")
        out1 = app.api_chat_history(user_id="u_test", session_id=self.sid, limit=1)
        self.assertEqual(len(out1["messages"]), 1)
        self.assertEqual(out1["messages"][0]["content"], "谢谢宝子", "limit=1 给最新一条")

    def test_endpoint_empty_session(self):
        import app
        out = app.api_chat_history(user_id="u_test", session_id="s_missing")
        self.assertEqual(out["messages"], [])


def _reverse_main():
    import app as _app

    # 坏实现 A：降序返回（模拟"忘了 reversed"）
    def bad_descending(sid, k=50):
        rows = []
        c = memory._conn()
        got = c.execute(
            "SELECT id, role, content, created_at FROM messages WHERE session_id=? "
            "ORDER BY id ASC LIMIT ?", (sid, max(k, 0))).fetchall()
        c.close()
        return [{"id": r[0], "role": r[1], "content": r[2], "created_at": r[3]}
                for r in got]   # 忘了倒序 → 最近一条反而排最后

    # 坏实现 B：出口不脱敏（模拟"忘了 desensitize"）
    def bad_endpoint(user_id="anon", session_id="default", limit=50):
        rows = memory.history_messages(session_id, max(1, min(limit, 200)))
        return {"messages": [
            {"id": r["id"], "role": r["role"], "content": r["content"],
             "created_at": r["created_at"]} for r in rows]}

    memory.history_messages = bad_descending
    _app.api_chat_history = bad_endpoint

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ChatHistoryTest)
    result = unittest.TextTestRunner(verbosity=0).run(suite)
    red = result.failures or result.errors
    print("\n反向验证：坏实现下 %s（红 = 测试有效）" % ("出现失败 ✅" if red else "全部通过 ❌ 这套测试是摆设"))
    return 0 if red else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reverse", action="store_true")
    args = parser.parse_args()
    if args.reverse:
        sys.exit(_reverse_main())
    unittest.main(verbosity=1)
