# -*- coding: utf-8 -*-
"""
评测系统 · Silver 生成器（2026-09-18 P0）
==========================================
评测体系三段式 bootstrap 的第一段（silver → golden → live）：
**让知识库自己出题**，把「问不完」变成「抽样不完」——AI 应用评测的标准做法
（RAGAS 的 synthetic test set generation 是同一思路）。

真值来源（两个，都可本地校验，不需要 LLM）：
  A) data/campus_map.json —— 147 地点图谱 → 存在性 / 位置 / 营业时间三类事实
  B) data/usst_articles.db —— 520 篇公众号文章 → 数值事实 + 主题文档召回

产出的每个候选都带 `truth`（期望值）与 `source`（真值出处），
下游 `curate.py` 会**逐条回源校验**后才允许进入 golden 集。

用法：
  python evals/gen_silver.py                    # 生成到 evals/silver/silver_<日期>.jsonl
  python evals/gen_silver.py --out /tmp/x.jsonl
"""
import argparse
import datetime
import json
import os
import re
import sqlite3
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP_PATH = os.path.join(ROOT, "data", "campus_map.json")
DB_PATH = os.path.join(ROOT, "data", "usst_articles.db")

# 品牌：已在图谱 features/note 里验证过的事实（麦当劳→第二食堂 等）
BRANDS_PRESENT = [("麦当劳", "第二食堂"), ("全家", "全家便利店"), ("1906", "1906咖啡厅")]
# 反例（对抗分层）：常被问、但图谱与语料里都没有 —— 用来测「诚实说没有」
BRANDS_ABSENT = ["瑞幸", "星巴克", "肯德基", "库迪", "蜜雪冰城", "喜茶",
                 "必胜客", "海底捞", "罗森", "711便利店"]

# 从图谱里抽「位置 / 营业时间」问法的抽样对象（挑有 hours 字段的）
WHERE_SAMPLE = ["第二食堂", "图书馆（图文信息中心）", "1906咖啡厅", "菜鸟驿站",
                "第五食堂", "校医室（卫生科）", "农业银行ATM", "心理健康中心"]
HOURS_SAMPLE = ["第一食堂", "第二食堂", "第五食堂", "图书馆（图文信息中心）",
                "第一浴室", "红塔打印"]

# 主题词 → 期望命中的文档（用关键词在标题里找，找不到就跳过）
KB_TOPICS = [
    "四六级", "医保", "奖学金", "重修", "体测", "校历", "寒假", "心理咨询",
    "体育馆", "借阅", "超期", "自习", "断电", "门禁", "空调", "浴室",
    "交换生", "宿舍消防", "邮箱", "统一身份认证", "校园网", "WeLink",
    "光电杯", "就业报告", "宿舍指南", "迎新", "选课", "报到", "助学金", "户口",
]

_BAD_LABEL = re.compile(r"(执行|规定|如下|以上|以下|共计|其中|截止|时间|说明|要求)")
_VAL_RE = re.compile(r"([\u4e00-\u9fffA-Za-z0-9]{2,10})[:：]\s*"
                     r"(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d+(?:\.\d+)?[万元分天周]+)")


def load_pois():
    m = json.load(open(MAP_PATH, encoding="utf-8"))
    return list(m.get("pois", [])) + list(m.get("landmarks", []))


def kb_titles_like(keyword, limit=2):
    """在文章标题里找与主题词相关的文档（返回标题列表，用于「任一命中即算召回」）。"""
    c = sqlite3.connect(DB_PATH)
    rows = c.execute(
        "SELECT title FROM articles WHERE is_dup=0 AND title LIKE ? LIMIT ?",
        (f"%{keyword}%", limit)).fetchall()
    c.close()
    return [r[0] for r in rows]


def numeric_facts(limit=40):
    """从 ★ 核心速查块抽 label：value（与 fact_probe 同一抽取口径，保持两处一致）。"""
    out, seen = [], set()
    c = sqlite3.connect(DB_PATH)
    rows = c.execute(
        "SELECT title, full_text FROM articles WHERE is_dup=0 AND full_text LIKE '%★%'"
    ).fetchall()
    c.close()
    for title, ft in rows:
        for m in _VAL_RE.finditer((ft or "")[:1500]):
            label, val = m.group(1), m.group(2)
            if _BAD_LABEL.search(label) or label in seen:
                continue
            seen.add(label)
            core = re.sub(r"[年月日]", "", val)
            if re.fullmatch(r"\d{4}", core):
                continue
            out.append({"label": label, "value": val, "doc": title,
                        "quote": m.group(0)[:60]})
            if len(out) >= limit:
                return out
    return out


def main():
    ap = argparse.ArgumentParser(description="生成 silver 评测候选")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    out_path = args.out or os.path.join(
        ROOT, "evals", "silver", f"silver_{datetime.date.today():%Y%m%d}.jsonl")

    pois = load_pois()
    names = [p["name"] for p in pois]
    items = []

    def add(**kw):
        kw["id"] = f"{kw['src']}-{len(items)+1:03d}"
        items.append(kw)

    # A1 存在性 · 肯定（26 个 POI 本名）
    for p in pois:
        add(src="poi_exist", layer="l1", kind="exists", truth=True,
            q=f"学校有没有{p['name']}",
            expect={"entity": p["name"], "must_include": [p["name"]]},
            source=f"campus_map:pois[{p['name']}]", verified="auto")

    # A2 存在性 · 措辞翻转（同一事实换问法）
    for nm in WHERE_SAMPLE[:6]:
        if nm in names:
            add(src="poi_flip", layer="l1", kind="exists", truth=True,
                q=f"学校里有{nm}吗",
                expect={"entity": nm, "must_include": [nm]},
                source=f"campus_map:pois[{nm}]", verified="auto")

    # A3 位置 / A4 营业时间
    for nm in WHERE_SAMPLE:
        if nm in names:
            add(src="poi_where", layer="l1", kind="where", truth=nm,
                q=f"{nm}在哪",
                expect={"entity": nm, "must_include": [nm]},
                source=f"campus_map:pois[{nm}]", verified="auto")
    for nm in HOURS_SAMPLE:
        if nm in names:
            add(src="poi_hours", layer="l1", kind="hours", truth=nm,
                q=f"{nm}几点开门",
                expect={"entity": nm, "must_include": [nm]},
                source=f"campus_map:pois[{nm}]", verified="auto")

    # A5 品牌（嵌在 features 里，靠品牌反向索引召回）
    for brand, holder in BRANDS_PRESENT:
        add(src="brand_exist", layer="l1", kind="exists", truth=True,
            q=f"学校有没有{brand}",
            expect={"entity": holder, "must_include": [holder, brand]},
            source=f"campus_map:pois[{holder}].features", verified="auto")

    # A6 反例（对抗分层）：库里真没有 → 必须如实说没有、不许给位置
    for b in BRANDS_ABSENT:
        add(src="brand_absent", layer="l1", kind="absent", truth=False,
            q=f"学校有没有{b}",
            expect={"must_not_include": [b + "在"], "forbid_position": True},
            source="campus_map+usst_articles.db（确证不存在）", verified="auto")

    # B1 数值事实（真值 = ★ 块原文值）
    for nf in numeric_facts():
        if re.search(r"[万元]", nf["value"]):
            q = f"咱们学校的{nf['label']}是多少钱？"
        else:
            q = f"咱们学校{nf['label']}是什么时候？"
        add(src="kb_numeric", layer="l1", kind="numeric", truth=nf["value"],
            q=q, expect={"must_include": [re.sub(r"[年月日]", "", nf["value"]),
                                          nf["value"]],
                         "docs": [nf["doc"]]},
            source=f"usst_articles.db:{nf['doc']}｜{nf['quote']}", verified="auto")

    # B2 主题召回（期望「任一相关文档进 top5」；期望较软 → 归 capability 分层）
    for kw in KB_TOPICS:
        docs = kb_titles_like(kw, limit=2)
        if not docs:
            continue
        add(src="kb_topic", layer="l1", kind="doc_recall", truth=kw,
            q=f"{kw}相关的事怎么弄？",
            expect={"docs": docs, "must_include": []},
            source="usst_articles.db（标题关键词匹配，需人工复核）", verified="soft")

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")

    from collections import Counter
    print(f"✅ silver 生成完成：{len(items)} 条 → {out_path}")
    for k, v in Counter(i["src"] for i in items).most_common():
        print(f"   {k:<12} {v:>3}")
    print("\n下一步：python evals/curate.py   （逐条回源校验 → golden）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
