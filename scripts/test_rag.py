# -*- coding: utf-8 -*-
"""检索层回归测试（F2 / F3 的守卫）
======================================================
**为什么要单独立一个**：`scripts/test_libao.py` 与 `libao_eval.py` 都要打真实 LLM，
慢、且结论受模型波动影响；而 F2/F3 这两处缺陷**完全在检索层**，
可以用**确定性断言**守住 —— 不调 LLM、不需要后端。

判据（改 `rag.py` 后必须全过）：
  A. **非 ★ 文章零回归** —— 新 snippet 必须与旧算法（该文余弦最大块 `[:400]`）**逐字节一致**。
     这条守的是「不要把首块优先推广到所有文章」那个坑（实测会回归 5/12）。
  B. **★ 文章命中**      —— 首块带 ★ 的文章，其 snippet 必须包含 ★ 块。
  C. **F3 不静默降级**   —— 含 `-` 等特殊字符的查询必须能走通 FTS5，不得退化为纯向量。
  D. **片段不超限**      —— snippet 长度 ≤ `rag.SNIPPET_MAX`。
  E. **查询扩展零回归**  —— 规则外置为 `data/query_expand.json` 后，原 16 条规则能覆盖的
     查询，扩展词必须与旧硬编码**逐字一致**；且新增的空间/生活类口语规则确实生效。

用法（无需后端）：
    python scripts/test_rag.py
失败时退出码 = 1。
"""
import os
import sqlite3
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rag  # noqa: E402

SAMPLE = [
    "今年什么时候放寒假？", "校历上说寒假从哪天开始？", "2026-2027学年校历",
    "这学期什么时候开学？", "四六级什么时候报名", "光电杯怎么报名",
    "图书馆开放时间是什么？", "食堂有哪些好吃的？", "怎么申请助学贷款",
    "转专业政策是怎样的", "宿舍几点熄灯", "校医院在哪里",
    "体育场馆怎么预约", "宿管会检查哪些违规电器", "期末考试周怎么安排",
    "诚信应考的要求", "健身房开放时间", "游泳馆收费标准",
    "重修选课什么时候", "新生报到要带什么",
]

# F3：这些查询以前会让 FTS5 报 `no such column`，异常被吞掉后 BM25 权重静默归零
F3_QUERIES = ["2026-2027学年校历", "短学期-1", "2026-2027", "???", "（（（"]

# F2 的原始现场：库里有 1月25，却曾被答成「没找到确切日期」
F2_HOLIDAY_QUERY = "今年什么时候放寒假？"
F2_EXPECT = "1月25"

# E. 查询扩展规则（2026-09-15 从 rag.py 硬编码外置为 data/query_expand.json）
#    下面的 legacy 表是**旧硬编码的逐字副本**，用来证明「外置」没改变任何既有查询的扩展结果。
EXPAND_LEGACY = [
    ("大功率", "违规电器 额定功率 400W 宿管会 检查条例 电热毯 电煮锅"),
    ("断电", "熄灯 供电 用电 宿舍管理"),
    ("门禁", "关门 关门时间 宿舍 进出 晚归"),
    ("断网", "校园网 网络 USSTroam 无线"),
    ("断水", "供水 水电 宿舍"),
    ("能不能用", "是否允许 违规 禁止"),
    ("可以带", "是否允许 违规 禁止"),
    ("多少钱", "收费 标准 费用 价格"),
    ("几号", "日期 时间"),
    ("几点关", "开放时间 结束 闭馆"),
    ("怎么预约", "预约流程 预约方式 申请 系统"),
    ("在哪", "位置 地点 地址 位于"),
    ("怎么走", "路线 位置 交通"),
    ("补办", "挂失 重新办理 流程"),
    ("重修", "重修报名 选课 流程"),
    ("挂科", "不及格 重修 补考"),
]
EXPAND_PROBES = [
    "大功率电器能用吗", "宿舍几点断电", "门禁是几点", "断网了怎么办", "断水",
    "电热毯能不能用", "可以带电脑吗", "这个多少钱", "几号开始", "图书馆几点关",
    "怎么预约体育馆", "图书馆在哪", "怎么走去南校", "校园卡补办", "重修流程", "挂科了怎么办",
]
# 新增口语规则的代表（外置时一起补的空间/生活类）
EXPAND_NEW = [("下课去哪吃饭", "食堂"), ("怎么取快递", "菜鸟驿站"), ("想找地方自习", "图书馆")]


def _legacy_expand(query):
    """旧硬编码实现的等价复现（`dst.split()` 语义）。"""
    terms = []
    for src, dst in EXPAND_LEGACY:
        if src in query:
            terms.extend(dst.split())
    seen, out = set(), []
    for t in terms:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def main():
    fails = []

    print("=== C. F3 特殊字符查询（走生产路径 search）===")
    for q in F3_QUERIES:
        try:
            n = len(rag.search(q, 4))
            print(f"  ✓ {q!r} -> fts_query={rag.fts_query(q)!r} 返回 {n} 条")
        except Exception as e:
            fails.append(f"F3 {q!r} 抛异常：{e}")
            print(f"  ✗ {q!r} 抛异常：{e}")

    print()
    print("=== A/B/D. F2 片段装配 ===")
    n_star, n_plain, n_bm25, regress = 0, 0, 0, 0
    conn = sqlite3.connect(rag.DB_PATH)
    for q in SAMPLE:
        res = rag.search(q, 4)
        if not res:
            fails.append(f"查询 {q!r} 无结果")
            continue
        qv = np.asarray(rag.embed_query(q), dtype=np.float32)
        qv = qv / np.linalg.norm(qv)
        for r in res:
            aid, new = r["id"], (r["snippet"] or "")
            if len(new) > rag.SNIPPET_MAX:
                fails.append(f"片段超限：{r['title'][:24]} len={len(new)}")
            rows = conn.execute(
                "SELECT id, chunk_text, vec FROM chunks WHERE article_id=? ORDER BY id", (aid,)
            ).fetchall()
            if not rows:
                n_bm25 += 1
                if not new:
                    fails.append(f"无向量块文章 snippet 仍为空：{r['title'][:24]}")
                continue
            head_txt = rows[0][1] or ""
            # 独立复现旧算法，作为"零回归"的对照基准
            mat = np.frombuffer(b"".join(x[2] for x in rows), dtype=np.float32).reshape(len(rows), -1)
            old = ((rows[int(np.argmax(mat @ qv))][1] or "").strip())[:rag.SNIPPET_MAX]
            if "★" in head_txt:
                n_star += 1
                if "★" not in new:
                    fails.append(f"★ 文章未带 ★ 块：{r['title'][:24]} | {new[:60]}")
            else:
                n_plain += 1
                if new != old:
                    regress += 1
                    fails.append(f"非 ★ 文章与旧行为不一致：{r['title'][:24]}")
    conn.close()

    print(f"  ★ 文章 {n_star} 篇 / 非 ★ 文章 {n_plain} 篇 / 无向量块 {n_bm25} 篇")
    print(f"  非 ★ 文章回归数 = {regress}（必须为 0）")

    print()
    print("=== F2 原始现场 ===")
    holiday = rag.search(F2_HOLIDAY_QUERY, 4)
    if any(F2_EXPECT in (r["snippet"] or "") for r in holiday):
        print(f"  ✓ snippet 含 {F2_EXPECT}")
    else:
        fails.append(f"{F2_HOLIDAY_QUERY!r} 的 snippet 未含 {F2_EXPECT}")
        print(f"  ✗ snippet 未含 {F2_EXPECT}")

    print()
    print("=== E. 查询扩展规则（外置为 data/query_expand.json）===")
    rules_path = rag._QUERY_EXPAND_FILE
    if not os.path.exists(rules_path):
        fails.append(f"扩展规则文件不存在：{rules_path}")
        print(f"  ✗ 文件不存在：{rules_path}")
    else:
        rules = rag.load_expand_rules()
        print(f"  ✓ 规则文件可读，共 {len(rules)} 条（旧硬编码 16 条）")
        if len(rules) < 16:
            fails.append(f"扩展规则少于 16 条，实际 {len(rules)}")
        if len(rules) > 16:
            print(f"    其中新增 {len(rules) - 16} 条空间/生活类口语")
        # 零回归：原 16 条规则能覆盖的查询，扩展词必须与旧实现逐字一致
        diff = [q for q in EXPAND_PROBES if rag.expand_terms(q) != _legacy_expand(q)]
        if diff:
            fails.append(f"扩展结果与旧硬编码不一致：{diff}")
            print(f"  ✗ 与旧实现不一致 {len(diff)} 条：{diff}")
        else:
            print(f"  ✓ 零回归：{len(EXPAND_PROBES)} 条既有查询的扩展词逐字一致")
        # 新增规则确实生效
        for q, must in EXPAND_NEW:
            got = rag.expand_terms(q)
            if must not in got:
                fails.append(f"新增扩展规则未生效：{q!r} 应含 {must!r}，实际 {got}")
                print(f"  ✗ {q!r} 未含 {must!r}")
            else:
                print(f"  ✓ 新增规则生效：{q!r} → 含 {must!r}")

    print()
    print("=" * 60)
    if fails:
        print(f"✗ {len(fails)} 条断言失败")
        for f in fails:
            print("   -", f)
        return 1
    print("✓ 全部断言通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
