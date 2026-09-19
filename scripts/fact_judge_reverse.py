# -*- coding: utf-8 -*-
"""
判分器反向验证（变异测试）· P0，2026-09-19
==========================================
回答一个问题：**判分器的测试（evals/test_judge_rules.py）是真的能抓错，还是永远为绿的装饰？**

机制：对判分器实现做 10 个**定点变异**（字符串定位 → 破坏函数体 → 跑测试 → 期望变红 → 还原）。
  · 每个变异点必须让测试**变红**——不变红 = 那条覆盖是假的（本项目连续四轮踩过的坑）。
  · 变异点靠**字符串定位**：源码一改定位就失败并明确报「定位失败」（刻意保留的维护成本，
    宁可人工维护定位串，也不要脆弱的 AST 依赖）。
  · 全程在**内存里改写源文件**，finally 强制还原并校验字节数一致；崩溃也不留破坏。

⚠️ 只覆盖**离线**可跑的判分内核（fact_probe.judge / run._honest_about 及其正则）——
   要活后端的路径（suite_l1/l3/e2e）不在本工具射程内。

用法：
  npm run probe:reverse          # = python scripts/fact_judge_reverse.py
  python scripts/fact_judge_reverse.py --list    # 只列变异点不执行
"""
import argparse
import io
import os
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RULES_CMD = [sys.executable, os.path.join(ROOT, "evals", "test_judge_rules.py")]

# 每个变异 = (编号, 目标文件, 定位串, 破坏后的替换, 会抓到它的用例)
MUTATIONS = [
    ("R1", "scripts/fact_probe.py",
     r'(?<!现在)(?<!还)没开',
     r'没开',
     "「现在没开」被误判否定（2026-09-16 事件的守卫失效）"),
    ("R2", "scripts/fact_probe.py",
     'return "摇摆", "既提到又出现否定表述"',
     'return "对", "mutated"',
     "「既提到又否定判摇摆」失效"),
    ("R3", "scripts/fact_probe.py",
     "if neg or soft:",
     "if neg and soft:",
     "「否定样本如实回答判对」失效"),
    ("R4", "scripts/fact_probe.py",
     'LOC = re.compile(r"(在|位于|就在|开在|设在|走).{0,12}(楼|层|食堂|超市|店|驿站|隔壁|旁边|门口|路|号|侧|区)")',
     'LOC = re.compile(r"(在.{0,3}超市)")',
     "「否定样本编出处所判伪造幻觉」失效"),
    ("R5", "scripts/fact_probe.py",
     'return ("对", "命中真值") if ev else ("错", "答案未包含真值")',
     'return ("对", "mutated")',
     "「数值事实答错判错」失效"),
    ("R6", "scripts/fact_probe.py",
     "if truth is True:",
     "if truth is not False:",
     "数值事实掉进错误分支（第一版真实 bug 的回归守卫失效）"),
    ("R7", "evals/run.py",
     'neg = re.compile(rf"(没有|没|未收录|查无|没查到|没搜到|没收录|不确定|说不定|"',
     'neg = re.compile(rf"(没有|未收录|查无|没查到|没搜到|没收录|不确定|说不定|"',
     "「也没星巴克」判诚实失效（2026-09-18 假红修复的回归）"),
    ("R8", "evals/run.py",
     "return (not fab.search(a)) and bool(neg.search(a))",
     "return (not fab.search(a))",
     "「含糊不表态判不诚实」失效"),
    ("R9", "scripts/fact_probe.py",
     'NEG = re.compile(r"(没有(?!(?:精确|数据|细节|具体|明确|说|提|一|任|查))|没得|无此|查无|并没有|"\n'
     '                 r"好像没有|应该没有|(?<!现在)(?<!还)没开|没设|没这|没有这家|没有这个|不存在)")',
     'NEG = re.compile(r"(?!)")',
     "NEG 整体失能（真否定仍被抓 / 既提到又否定 / 否定样本如实回答 三例连锁变红）"),
    ("R10", "scripts/fact_probe.py",
     'ev = any(e in a for e in probe["evidence"]) if probe["evidence"] else False',
     "ev = False",
     "证据命中判定失效（「数值事实命中真值判对」等连锁变红）"),
]


def run_rules():
    p = subprocess.run(RULES_CMD, cwd=ROOT, capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def main():
    ap = argparse.ArgumentParser(description="判分器反向验证（变异测试）")
    ap.add_argument("--list", action="store_true", help="只列变异点不执行")
    args = ap.parse_args()

    if args.list:
        for mid, f, old, _, why in MUTATIONS:
            print(f"  {mid}  {f:<24} {why}")
        return 0

    # 前置：测试当前必须是绿的（红着跑变异没有意义）
    rc, out = run_rules()
    if rc != 0:
        print("❌ 前置失败：test_judge_rules 当前就是红的，先修再验：")
        print("\n".join(out.strip().splitlines()[-8:]))
        return 2

    paths = sorted({f for _, f, _, _, _ in MUTATIONS})
    originals = {f: open(os.path.join(ROOT, f), "rb").read() for f in paths}
    passed, failed = 0, []

    try:
        for mid, f, old, new, why in MUTATIONS:
            path = os.path.join(ROOT, f)
            src = originals[f].decode("utf-8")
            if src.count(old) != 1:
                failed.append(f"{mid} 定位失败（出现 {src.count(old)} 次，应为 1）：{why}")
                continue
            open(path, "w", encoding="utf-8", newline="").write(src.replace(old, new))
            try:
                rc, out = run_rules()
                if rc != 0:
                    passed += 1
                    print(f"  ✅ {mid} 破坏后测试变红（守卫有效）：{why}")
                else:
                    failed.append(f"{mid} 破坏后测试仍绿（假覆盖！）:{why}")
            finally:
                open(path, "wb").write(originals[f])  # 无条件还原
    finally:
        for f in paths:  # 兜底：任何异常路径都还原
            path = os.path.join(ROOT, f)
            if open(path, "rb").read() != originals[f]:
                open(path, "wb").write(originals[f])
                print(f"  ⚠️ {f} 曾被破坏，已还原")

    # 还原后测试必须回到绿（证明还原成功）
    rc, out = run_rules()
    restored_ok = rc == 0

    print("\n" + "=" * 60)
    print(f"反向验证：{passed}/{len(MUTATIONS)} 通过（破坏实现 → 测试必须变红）")
    if failed:
        print("失败明细：")
        for f in failed:
            print("  ❌", f)
    if not restored_ok:
        print("❌ 还原后测试没有回到绿 —— 源文件还原出了问题，立即检查！")
        return 3
    print("✅ 还原校验：源文件字节一致，测试回到绿")
    print("=" * 60)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
