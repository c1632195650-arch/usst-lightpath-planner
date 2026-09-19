# -*- coding: utf-8 -*-
"""为 147 个地点生成拼音检索字段（一次性数据生成，**不是运行时依赖**）
=====================================================================
产出的字段（`|` 分隔）

    pyf  全拼（音调略去、只留字母数字）—— 名字与各别名各一段
    pyi  首字母（声母缩写）            —— 名字与各别名各一段
    pyt  类型的拼音（全拼 + 首字母两段）—— 让「shitang」能列食堂、「sushe」能列宿舍
    pyk  泛类别词（口语说法）的全拼      —— 「jiaoshi」→ 教学楼、「gongyu」→ 宿舍、「yongcan」→ 食堂
                                        （词表见 server/campus.py 的 _TYPE_WORDS，**只取全拼**）
    pyg  口语同义词（tags）的拼音      —— 让「dahuo」能查到学生活动中心、「chifan」能列食堂

例：`图书馆（图文信息中心）`
    pyf = "tushuguantuwenxinxizhongxin|tushuguan|tuwenxinxizhongxin|tushuguanzongguan"
    pyi = "tsg|tsg|twxxzx|tsgz"

> `pyt` / `pyg` 的分值刻意低于名字与别名 —— 类别词与口语词是「浏览」，具体名字才是「找那一个」。

> 为什么 `pyk` 要与 `pyt` 分开（2026-09-16）
> ------------------------------------------
> 「教室」和「教师」拼音都是 `jiaoshi`。此前泛类别词拼音被并进 `pyt`（48 分），
> 于是输入 `jiaoshi` 时，『阅餐厅』（别名『教师餐厅』→ `jiaoshicanting`）靠
> **名字前缀档（52 分）**把『第一教学楼』（类别词档 48 分）压了下去。
> 拆出独立档位后，规则变得可陈述：**打全了的类别词 > 没打完的名字前缀**
> —— 前者是「我要这一类」，后者是「某处名字的中间态」，类别词该赢。
> （`pyk` 只收全拼、不收首字母：`js` 这种两位缩写会大面积假命中。）

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

# 泛类别词的口语说法（「教室」「住宿」「用餐」…）由 server/campus.py 的 _TYPE_WORDS 定义，
# 那里是唯一来源 —— 这里 import 过来复用，**不另抄一份**（抄了必然漂移）。
# campus.py 只依赖 os/json/re，import 它没有副作用，也不会引入运行时依赖。
sys.path.insert(0, os.path.join(HERE, "..", "server"))
try:
    from campus import _TYPE_WORDS
except Exception:          # 退路：类型拼音只含 type 本身，不因此中断整个生成流程
    _TYPE_WORDS = {}

_CJK = re.compile(r"[\u4e00-\u9fff]")
_KEEP = re.compile(r"[^a-z0-9]")

NOTE = ("【拼音检索·2026-09-16】`pyf` / `pyi` / `pyt` / `pyk` / `pyg` 为**离线生成**的拼音索引"
        "（名字与各别名的全拼 / 首字母、类型拼音、泛类别词拼音、口语同义词拼音；`|` 分隔），"
        "由 `scripts/build_pinyin_index.py` 产出。"
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
    n_pyk = 0
    for p in items:
        if p.get("pyf") and p.get("pyi") and p.get("pyt") and p.get("pyg"):
            have += 1
        else:
            missing.append(p["name"])
        if p.get("pyk"):
            n_pyk += 1

    if args.check:
        print(f"已生成拼音：{have}/{len(items)}")
        # pyk（泛类别词）天然只覆盖几十个条目 —— 不是缺漏，只报数不报警。
        print(f"其中带泛类别词拼音(pyk)：{n_pyk}")
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
        p["pyt"] = "|".join(x for x in (tf, ti) if x)
        # 泛类别词的**口语说法拼音**单独成档：「jiaoshi」→ 教学楼、「gongyu」→ 宿舍、
        # 「yongcan」→ 食堂。与 tags 侧的「说人话」是同一件事，只是发生在英文输入法场景下。
        # ⚠️ 不并进 pyt：并进去就会被『教师餐厅』(jiaoshicanting) 的**名字前缀**压过
        #    —— 「教室」「教师」同音，详见本文件顶部说明。
        kfulls = []
        for w, types in _TYPE_WORDS.items():
            if p.get("type") in types:
                f_, _i = to_pinyin(pypinyin, w)
                if f_ and f_ not in kfulls:
                    kfulls.append(f_)
        # 空值不写字段 —— 避免给 145 个条目都挂一个 `"pyk": ""`（数据噪声）
        p.pop("pyk", None)
        if kfulls:
            p["pyk"] = "|".join(kfulls)
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
    # 🔴 用**今天**，不要硬编码 —— 硬编码会让重新生成后 `_meta.updated` 反而变旧，
    #    下游「时间质量」审计读到的日期于是与文件实际改动时间不符。
    m["_meta"]["updated"] = __import__("datetime").date.today().isoformat()

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
                print(f"     {'':<22} pyi={p['pyi']}   pyt={p['pyt']}   pyk={p.get('pyk','')}")
                print(f"     {'':<22} pyg={p['pyg'][:72]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
