# -*- coding: utf-8 -*-
"""为 147 个地点生成拼音检索字段（一次性数据生成，**不是运行时依赖**）
=====================================================================
产出的字段（`|` 分隔）

    pyf  全拼（音调略去、只留字母数字）—— 名字与各别名各一段
    pyi  首字母（声母缩写）            —— 名字与各别名各一段
    pyt  类型的拼音（全拼 + 首字母两段）—— 让「shitang」能列食堂、「sushe」能列宿舍
    pyg  口语同义词（tags）的拼音      —— 让「dahuo」能查到学生活动中心、「chifan」能列食堂

例：`图书馆（图文信息中心）`
    pyf = "tushuguantuwenxinxizhongxin|tushuguan|tuwenxinxizhongxin|tushuguanzongguan"
    pyi = "tsg|tsg|twxxzx|tsgz"

> `pyt` / `pyg` 的分值刻意低于名字与别名 —— 类别词与口语词是「浏览」，具体名字才是「找那一个」。

## 为什么做成「生成一次、把结果存成数据」

学长那个站点把 **210KB 的拼音词典塞进前端包**（占首页包 60%）。我们把这件事挪到
**离线生成**：运行时只需要在 JSON 里查字符串，**后端与前端都不新增任何依赖**。
`pypinyin` 只在**重新生成索引**时才需要 —— 装它请用：

    pip install pypinyin
    python scripts/build_pinyin_index.py

没有 pypinyin 时本脚本会明确报错退出，不会写出半截数据。

## 匹配策略（在 server/campus.py 里实现）

只做**整段相等**与**前缀**两种匹配，**不做子串**：
`disanjiaoxuelou` 里含有 `sanjiao`，但 `xue` 也"含有"于很多名字 ——
子串匹配会带来大量假命中，前缀匹配则正好对应「用户拼音还没打完」这个真实场景。

用法：
    python scripts/build_pinyin_index.py            # 生成并写回
    python scripts/build_pinyin_index.py --check    # 只看覆盖率，不写
"""
import argparse
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
MAP_PATH = os.path.join(HERE, "..", "data", "campus_map.json")

_CJK = re.compile(r"[\u4e00-\u9fff]")
_KEEP = re.compile(r"[^a-z0-9]")

NOTE = ("【拼音检索·2026-09-15】`pyf` / `pyi` / `pyt` 为**离线生成**的拼音索引"
        "（名字与各别名的全拼 / 首字母、类型拼音、口语同义词拼音；`|` 分隔），由 `scripts/build_pinyin_index.py` 产出。"
        "生成需 `pypinyin`，**运行时不需要任何依赖** —— 检索只是查字符串。"
        "匹配只做「整段相等」与「前缀」，不做子串（子串假命中太多）。")


def segments(p):
    """要转拼音的候选串：主名 + 全部别名，去掉不含中文的（纯数字/纯英文没意义）。"""
    out, seen = [], set()
    for s in [p.get("name", "")] + list(p.get("alias", [])):
        s = (s or "").strip()
        if not s or s in seen or not _CJK.search(s):
            continue
        seen.add(s)
        out.append(s)
    return out


def to_pinyin(pypinyin_mod, s):
    """→ (全拼, 首字母)。非字母数字字符一律丢掉（括号、斜杠、空格…）。"""
    lazy_pinyin, Style = pypinyin_mod.lazy_pinyin, pypinyin_mod.Style
    full = _KEEP.sub("", "".join(lazy_pinyin(s)).lower())
    ini = _KEEP.sub("", "".join(lazy_pinyin(s, style=Style.FIRST_LETTER)).lower())
    return full, ini


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只报告覆盖率，不写回")
    args = ap.parse_args()

    try:
        import pypinyin
    except ImportError:
        print("❌ 需要 pypinyin（仅用于生成拼音索引，运行时不需要）：\n   pip install pypinyin",
              file=sys.stderr)
        return 1

    with open(MAP_PATH, encoding="utf-8") as f:
        m = json.load(f)
    items = m["pois"] + m["landmarks"]

    have, missing = 0, []
    for p in items:
        if p.get("pyf") and p.get("pyi") and p.get("pyt") and p.get("pyg"):
            have += 1
        else:
            missing.append(p["name"])

    if args.check:
        print(f"已生成拼音：{have}/{len(items)}")
        if missing:
            print("缺：", "、".join(missing[:12]), ("…" if len(missing) > 12 else ""))
        return 0

    for p in items:
        segs = segments(p)
        fulls, inis = [], []
        for s in segs:
            f, i = to_pinyin(pypinyin, s)
            if f and f not in fulls:
                fulls.append(f)
            if i and i not in inis:
                inis.append(i)
        p["pyf"] = "|".join(fulls)
        p["pyi"] = "|".join(inis)
        # 类型拼音：让「shitang」「sushe」「zixidian」这类**类别词**也能用拼音搜到。
        # 只有约 20 个不同取值，数据量可忽略。
        tf, ti = to_pinyin(pypinyin, p.get("type", ""))
        p["pyt"] = "|".join([x for x in (tf, ti) if x])
        # 口语同义词（tags）的拼音：让「dahuo」→ 学生活动中心、「chifan」→ 食堂。
        # 这是「说人话」在**拼音输入**侧的延伸 —— 学生用英文输入法时同样该查得到。
        gfulls, ginis = [], []
        for g in p.get("tags", []):
            f_, i_ = to_pinyin(pypinyin, g)
            if f_ and f_ not in gfulls:
                gfulls.append(f_)
            if i_ and i_ not in ginis:
                ginis.append(i_)
        p["pyg"] = "|".join(gfulls + ginis)

    m["_meta"]["pinyin"] = NOTE
    m["_meta"]["updated"] = "2026-09-15"

    with open(MAP_PATH, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=1)
        f.write("\n")

    empty = [p["name"] for p in items if not p.get("pyf")]
    print(f"✅ 已写回 {MAP_PATH}")
    print(f"   条目 {len(items)}｜有拼音 {len(items) - len(empty)}｜无拼音 {len(empty)}")
    if empty:
        print("   无拼音：", "、".join(empty[:12]))
    print("   抽样：")
    for want in ["图书馆（图文信息中心）", "第三教学楼", "第一食堂", "菜鸟驿站"]:
        for p in items:
            if p["name"] == want:
                print(f"     {p['name']:<22} pyf={p['pyf'][:64]}")
                print(f"     {'':<22} pyi={p['pyi']}   pyt={p['pyt']}")
                print(f"     {'':<22} pyg={p['pyg'][:72]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
