# -*- coding: utf-8 -*-
"""
风格规范漂移检查（E10，stdlib-only，不需要起后端）
==================================================
防「改了文档忘了代码 / 改了代码忘了文档」：
规范《梨宝语言风格规范》已入库为 docs/libao-style-guide.md（源文件在仓库外，
学术部/outputs/ 下），server/app.py 的人格 prompt 与 server/direct.py 的模板
注释都声明与它同步。本脚本做四件事：

  1. 规范文件存在、版本号/日期可解析；
  2. server/app.py 的 LIBAO_PERSONA 同步注释存在，且版本+日期与规范标题一致；
  3. server/direct.py 注释里引用的规范章节号（§X）在规范里都真实存在；
  4. server/direct.py / scripts/test_direct.py 都还引用着《梨宝语言风格规范》
     （防止文件改名/移动后代码引用悬空）。

跑法： python scripts/check_style_drift.py
退出码：0 = 无漂移；1 = 有漂移（输出指明是哪一条）
"""
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUIDE = os.path.join(ROOT, "docs", "libao-style-guide.md")
APP = os.path.join(ROOT, "server", "app.py")
DIRECT = os.path.join(ROOT, "server", "direct.py")
TEST = os.path.join(ROOT, "scripts", "test_direct.py")

_CN_SEC = "一二三四五六七八九十"

ok = fail = 0
fails = []


def check(label, good, detail=""):
    global ok, fail
    if good:
        ok += 1
        print(f"  PASS  {label}")
    else:
        fail += 1
        fails.append(f"{label}（{detail}）")
        print(f"  FAIL  {label}  ｜ {detail}")


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


print("\n== 风格规范漂移检查 ==")

# ---- 1. 规范文件本体 ----
try:
    guide = read(GUIDE)
except OSError as e:
    print(f"  FAIL  规范文件读取失败：{GUIDE} ｜ {e}")
    sys.exit(1)

m_title = re.search(r"^#\s*梨宝语言风格规范\s+(v\d+)\s*·\s*(\d{4}-\d{2}-\d{2})", guide, re.M)
check("规范标题含版本号与日期（v N · YYYY-MM-DD）", bool(m_title),
      "标题格式应为「# 梨宝语言风格规范 v1 · 2026-09-19」")
guide_ver = m_title.group(1) if m_title else "?"
guide_date = m_title.group(2) if m_title else "?"

sec_heads = re.findall(r"^##\s*([" + _CN_SEC + r"]+)、", guide, re.M)
check("规范章节号可解析（≥4 个中文序号章节）", len(sec_heads) >= 4,
      f"实际解析到：{sec_heads}")

hard_rules = re.findall(r"^(\d+)\.\s+\*\*", guide, re.M)
check("硬规则条目可解析（≥10 条，`N. **…**` 形态）", len(hard_rules) >= 10,
      f"实际 {len(hard_rules)} 条")

# ---- 2. app.py 同步注释 ----
app = read(APP)
m_sync = re.search(r"同步自\s*docs/libao-style-guide\.md\s+(v\d+)（(\d{4}-\d{2}-\d{2})）", app)
check("app.py 存在 LIBAO_PERSONA 同步注释", bool(m_sync),
      "应含「同步自 docs/libao-style-guide.md vN（YYYY-MM-DD）」")
if m_sync:
    check("app.py 同步注释版本与规范标题一致",
          m_sync.group(1) == guide_ver and m_sync.group(2) == guide_date,
          f"app.py={m_sync.group(1)}（{m_sync.group(2)}） vs 规范={guide_ver}（{guide_date}）")

# ---- 3. direct.py 的章节引用不悬空 ----
direct = read(DIRECT)
sec_refs = set(re.findall(r"《梨宝语言风格规范》\s*§?\s*([" + _CN_SEC + r"]+)", direct))
sec_refs |= set(re.findall(r"§\s*([" + _CN_SEC + r"]+)", direct))
missing = [s for s in sec_refs if s not in sec_heads]
check("direct.py 引用的规范章节全部存在", not missing,
      f"引用 {sorted(sec_refs)}，规范实际章节 {sec_heads}，悬空：{missing}")

# ---- 4. 代码侧引用仍指向规范 ----
check("direct.py 仍引用《梨宝语言风格规范》", "《梨宝语言风格规范》" in direct,
      "引用消失 = 模板与规范脱钩（改了代码忘了对文档）")
test = read(TEST)
check("test_direct.py 仍保留风格回归块（引用规范）",
      "风格回归" in test and "梨宝语言风格规范" in test,
      "风格回归块被删 = 规范失去回归防线")

print("\n" + "=" * 60)
print(f"汇总：{ok}/{ok + fail} 通过")
if fails:
    print("漂移明细：")
    for f in fails:
        print("  ❌", f)
else:
    print("无漂移 ✅")
print("=" * 60)
sys.exit(0 if not fails else 1)
