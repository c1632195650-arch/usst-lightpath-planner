# -*- coding: utf-8 -*-
"""
维护批 P0-5（2026-10-11）· memory 库并发护栏测试
==================================================
验证三件事（跑法：.venv/Scripts/python.exe scripts/test_memory_wal.py）：
  1. LIBAO_MEMORY_DB 环境变量能覆盖库路径（此前写死，测试只能摸真实库）；
  2. memory._conn() 打开 WAL（journal_mode=wal）—— 读写不再互斥；
  3. busy_timeout=5000 已生效 —— 写写竞争时等待而非立刻报 locked。

反向验证（RV）：把 memory.py 的两行 PRAGMA 删掉后本测试第 2/3 项必红。
"""
import os
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_SERVER = os.path.join(_HERE, "..", "server")
sys.path.insert(0, _SERVER)

_tmpdir = tempfile.mkdtemp(prefix="_memwal_")
os.environ["LIBAO_MEMORY_DB"] = os.path.join(_tmpdir, "memory_test.db")

import memory  # noqa: E402  （必须在设好环境变量之后导入）


def main():
    failures = []

    # 1) 环境变量覆盖生效
    expected = os.path.abspath(os.environ["LIBAO_MEMORY_DB"])
    if os.path.abspath(memory.DB_PATH) != expected:
        failures.append(f"DB_PATH 未被 LIBAO_MEMORY_DB 覆盖: {memory.DB_PATH}")

    # 2) WAL 生效
    c = memory._conn()
    mode = c.execute("PRAGMA journal_mode").fetchone()[0]
    if str(mode).lower() != "wal":
        failures.append(f"journal_mode={mode!r}，期望 wal")
    # 3) busy_timeout 生效
    bt = c.execute("PRAGMA busy_timeout").fetchone()[0]
    if int(bt) != 5000:
        failures.append(f"busy_timeout={bt}，期望 5000")

    # 顺带冒烟：建库后基本读写走得通（messages 落一行再读出）
    memory.add_message("sess-wal-test", "u-wal-test", "user", "你好")
    rows = memory.recent_messages("sess-wal-test", k=1)
    if not rows or rows[0][1] != "你好":
        failures.append(f"读写冒烟失败: {rows}")

    c.close()

    if failures:
        print("FAIL")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print(f"PASS  memory WAL 护栏（库={os.path.basename(memory.DB_PATH)}，journal_mode=wal，busy_timeout=5000，读写冒烟 OK）")


if __name__ == "__main__":
    main()
