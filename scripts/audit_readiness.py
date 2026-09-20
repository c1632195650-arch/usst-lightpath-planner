# -*- coding: utf-8 -*-
"""空间数据库 · 就绪度探针（产品口径，与 audit_spatial_quality.py 分工互补）

audit_spatial_quality.py 回答「数据符不符合 ISO 19157」——**合规**口径。
本脚本回答「这套数据对产品意味着什么」——**产品**口径：

  --base       字段完备度：哪些字段撑不起哪类问题（hours 覆盖率决定「现在开吗」可答率）
  --coverage   学生高频需求 × 图谱覆盖矩阵；对 MISS 项**溯源**是「数据没有」还是「检索不到」
  --scenarios  点对点问路抽样成功率 / 就近推荐能力 / 跨校区分组 / 不编造行为
  --qa         真实口吻提问的空间注入率、注入体量构成、多轮追问能否救回
  --all        全部（默认）

设计原则（照抄本项目纪律）：
  · 直接调用**生产代码路径**（server/campus.py），不重实现、不 mock —— 测的是用户真正会走的代码
  · **不经 LLM**，所以零成本、可重复、可在 CI 里跑
  · 每条结论都带**分母**，不给「覆盖率很高」这种没分母的话
  · ⚠️ 判「假阳性」前必须回数据里查（实测教训：`match_brands("麦当劳")` 看着像假阳性，
    其实 `第二食堂.alias` 里就写着「麦当劳（二食堂左侧）」）

用法：
    python scripts/audit_readiness.py --out ../_readiness.txt
    python scripts/audit_readiness.py --coverage
"""
import argparse
import collections
import json
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "server"))
import campus  # noqa: E402

M = campus.load_map()
ALL = M["pois"] + M["landmarks"]
_N = len(ALL)


def key(v):
    """func 可能是 list[str]，不可哈希 —— 归一化成可计数/可读的字符串。"""
    return "/".join(map(str, v)) if isinstance(v, (list, tuple)) else v


def hr(w, t):
    w("\n" + "=" * 76)
    w(t)
    w("=" * 76)


# ------------------------------------------------------------------ A. 字段完备度
def sec_base(w):
    hr(w, "A. 字段完备度 —— 决定「能不能答得准」")
    w(f"总数 {_N}（pois {len(M['pois'])} + landmarks {len(M['landmarks'])}）")
    w(f"校区：{dict(collections.Counter(p.get('campus') for p in ALL))}")
    w(f"功能：{dict(collections.Counter(key(p.get('func')) for p in ALL))}")
    w(f"类型 {len({p.get('type') for p in ALL})} 类｜needs_check {len(M.get('needs_check') or [])}"
      f"｜off_campus {len(M.get('off_campus') or [])}｜walk_minutes {len(M.get('walk_minutes') or [])}")
    FIELDS = [("tags 口语标签", lambda p: bool(p.get("tags"))),
              ("zone 片区", lambda p: bool(p.get("zone"))),
              ("alias 别名", lambda p: bool(p.get("alias"))),
              ("note 贴心说明", lambda p: bool(p.get("note"))),
              ("verified 已核验", lambda p: p.get("verified") is True),
              ("hours 营业时间", lambda p: bool(p.get("hours"))),
              ("signature 招牌", lambda p: bool(p.get("signature"))),
              ("features 特色", lambda p: bool(p.get("features")))]
    for label, f in FIELDS:
        n = sum(1 for p in ALL if f(p))
        flag = "  🔴" if n / _N < 0.2 else ""
        w(f"  {label:<16} {n:>4}/{_N} = {n / _N * 100:5.1f}%{flag}")
    h = sum(1 for p in M["pois"] if p.get("hours"))
    w(f"    └ hours：pois {h}/{len(M['pois'])}｜landmarks "
      f"{sum(1 for p in M['landmarks'] if p.get('hours'))}/{len(M['landmarks'])}")
    st = collections.Counter(str(campus.open_now(p).get("open")) for p in ALL)
    w(f"  open_now 三态：{dict(st)}  ← 'None' = 「时间未收录，不做判断」（不猜，正确）")
    w(f"  ⇒ 「现在开吗」实际可答 = {_N - st.get('None', 0)}/{_N}")


# ------------------------------------------------------------------ B. 需求 × 覆盖
NEEDS = [
    ("吃饭/食堂", "下课去哪吃饭"), ("打印/复印", "学校哪里能打印"),
    ("快递/取件", "取快递"), ("超市/便利店", "买瓶水"),
    ("饮水/开水", "哪有开水"), ("卫生间", "附近有厕所吗"),
    ("ATM/银行", "取钱"), ("医务/药店", "生病了去哪看"),
    ("自习室", "去哪自习"), ("图书馆", "图书馆在哪"),
    ("运动/操场", "打球"), ("体育馆", "健身房"),
    ("理发", "理发"), ("洗衣", "洗衣服"),
    ("浴室/澡堂", "洗澡"), ("校门", "校门"),
    ("宿舍", "回宿舍"), ("教学楼", "上课"),
    ("电动车/充电", "电动车充电"), ("咖啡", "喝咖啡"),
    ("水果", "买水果"), ("文具", "买笔"),
    ("眼镜店", "配眼镜"), ("手机维修", "修手机"),
    ("邮局", "寄信"), ("菜市场", "买菜"), ("住宿/招待所", "家长来了住哪"),
]
KEYMAP = {"买瓶水": ["超市", "便利店", "暖屋", "教育超市"],
          # ⚠️「哪有开水」**刻意不含「热水」**：第一浴室的 tags 里有『热水』，
          #    但那是**洗澡热水**，与「直饮/开水房」不是一回事 —— 收进来会把
          #    「数据也没有」误判成「数据有·检索不到」，从而诱导去加一个不该加的标签。
          "哪有开水": ["开水", "直饮"],
          "附近有厕所吗": ["卫生间", "厕所"], "生病了去哪看": ["医", "医务", "卫生科", "门诊", "药"],
          "理发": ["理发", "美发"], "洗衣服": ["洗衣"], "电动车充电": ["充电", "电动", "车棚"],
          "买笔": ["文具", "超市"], "配眼镜": ["眼镜"], "修手机": ["维修"], "寄信": ["邮"],
          "家长来了住哪": ["招待", "住宿", "宾馆"]}

# 检索面字段：**只有这些**算「用户真的检索得到」。note/signature 是给人读的散文，
# 不参与检索 —— 这是 2026-09-19 收紧的那条口径（见下面 sec_coverage 的注释）。
SEARCH_FIELDS = ("name", "alias", "tags", "func", "type")
PROSE_FIELDS = ("signature", "note")

# 声明「本次不收」的高频需求（2026-09-19）。与「数据也没有」区分开：
# 这些是**产品口径上决定不做**，不是遗漏 —— 照 SCOPE_OUT「声明即已管理」的哲学。
# ⚠️「哪有开水」OSM 里其实**有具名『开水房』**（距农业银行 ATM 33.7 m），
#    属「可收但本次不收」，别写成「数据也没有」。
DECLARED_NOT_COLLECTED = {
    "附近有厕所吗": "卫生间是**面状分布**（一栋楼里好几处），与现有『一地点一条目』模型不合，需先定建模方式",
    "哪有开水": "OSM 有具名『开水房』实体 → **可收但本次不收**（缺图谱条目定义）",
    "电动车充电": "库内有《470号地下车库充电桩》《特来电充电桩》通知 → **可收但本次不收**",
    "配眼镜": "校内无稳定门店 → 本次不收",
    "修手机": "校内无稳定门店 → 本次不收",
    "寄信": "校内无邮政网点 → 本次不收",
    "家长来了住哪": "属校外住宿 → 本次不收",
}


def _hit_fields(p, kws):
    """关键词命中在**哪些字段**上。用于区分「真检索不到」与「只是散文里提过」。"""
    where = []
    for f in SEARCH_FIELDS + PROSE_FIELDS:
        v = p.get(f)
        if not v:
            continue
        s = " ".join(map(str, v)) if isinstance(v, (list, tuple)) else str(v)
        if any(k in s for k in kws):
            where.append(f)
    return where


def sec_coverage(w):
    hr(w, "B. 学生高频需求 × 图谱覆盖（问句原样丢给 rank_pois，再溯源）")
    miss = []
    tally = collections.Counter()
    for label, q in NEEDS:
        hits = campus.rank_pois(q, limit=3, min_score=1)
        if hits:
            w(f"  [OK  ] {label:<12} ← 「{q}」 → {[h[0]['name'] for h in hits]}")
            continue
        miss.append((label, q))
        kws = KEYMAP.get(q, [])
        found = [(p["name"], _hit_fields(p, kws)) for p in ALL]
        found = [(n, wh) for n, wh in found if wh]
        solid = [(n, wh) for n, wh in found if set(wh) & set(SEARCH_FIELDS)]
        prose = [(n, wh) for n, wh in found if not (set(wh) & set(SEARCH_FIELDS))]
        # 🔴 2026-09-19 收紧：旧版把 note/signature 散文也拼进检索面 ⇒ 散文里**提到**
        #    就算「数据有·检索不到」，会诱导出「为了修一个不存在的缺口去加标签」。
        #    实测反例：「哪有开水」只命中第一浴室的 tags『热水』（开水 ≠ 洗澡热水）；
        #    「理发」只命中第一学生公寓的 note（『北楼同楼：理发店…』）。
        if solid:
            cat = "检索不到"
            why = "**数据有·检索不到**（零采集，补 tags/alias 即可）"
            detail = str([n for n, _ in solid][:5])
            if prose:
                detail += f"｜另有仅散文提及：{[n for n, _ in prose][:3]}"
        elif prose:
            cat = "只是散记"
            why = "数据有·但只是**散记**（仅 note/signature 提到，检索面不含散文 ⇒ 实际仍答不出）"
            detail = str([n for n, _ in prose][:5])
        elif q in DECLARED_NOT_COLLECTED:
            cat = "声明不收"
            why = "**声明不收**（非遗漏）"
            detail = DECLARED_NOT_COLLECTED[q]
        else:
            cat = "数据也没有"
            why = "数据也没有（需先定产品口径：收 or 明确声明不收）"
            detail = "（无）"
        tally[cat] += 1
        w(f"  [MISS] {label:<12} ← 「{q}」 → {detail}\n           ⇒ {why}")
    w(f"\n  未覆盖 {len(miss)}/{len(NEEDS)} 项｜分类：{dict(tally)}")
    w("  ⚠️ 四类 MISS 的处置完全不同：")
    w("     · 检索不到      → 改 tags/alias 即可（**零采集**，性价比最高）")
    w("     · 只是散记      → 要把散文里的信息**提到 tags**，否则检索永远够不着")
    w("     · 声明不收      → 不改数据，写清理由（声明即已管理）")
    w("     · 数据也没有    → 先定产品口径：收，还是明确声明不收")


# ------------------------------------------------------------------ C. 空间场景
def sec_scenarios(w, seed=20260919, n=300):
    hr(w, f"C1. 点对点问路（{n} 组随机抽样）")
    random.seed(seed)
    names = [p["name"] for p in ALL]
    ok = rel = 0
    mins = []
    fails = []
    t0 = time.perf_counter()
    for _ in range(n):
        a, b = random.sample(names, 2)
        r = campus.route(a, b)
        if r:
            ok += 1
            rel += bool(r.get("reliable"))
            mins.append(r.get("minutes", 0))
        elif len(fails) < 6:
            fails.append(f"{a}→{b}")
    dt = (time.perf_counter() - t0) * 1000
    w(f"  成功 {ok}/{n} = {ok / n * 100:.1f}%｜标注 reliable {rel}/{max(ok, 1)} = {rel / max(ok, 1) * 100:.1f}%")
    w(f"  单次 route() 平均 {dt / n:.2f} ms")
    if mins:
        mins.sort()
        w(f"  分钟数 min {mins[0]:.1f} / 中位 {mins[len(mins) // 2]:.1f} / max {mins[-1]:.1f}")
    w(f"  失败样例：{fails}")

    hr(w, "C2. 就近推荐（/api/nearby 起点覆盖）")
    origins = [p["name"] for p in ALL if "teach" in (key(p.get("func")) or "") or "life" in (key(p.get("func")) or "")]
    cnt = collections.Counter()
    for o in origins[:45]:
        cnt[len(campus.nearby_by_walk(o, limit=5).get("results", []))] += 1
    w(f"  {len(origins)} 个候选起点，取样 45：返回条数分布 {dict(sorted(cnt.items()))}")
    for g in ("北校", "南校", "1100"):
        gs = [p["name"] for p in ALL if p.get("campus") == g][:8]
        tot = sum(len(campus.nearby_by_walk(x, limit=5).get("results", [])) for x in gs)
        w(f"  {g:<5} 平均 {tot / max(len(gs), 1):.1f} 条/起点（取样 {len(gs)}）")

    hr(w, "C3. 跨校区分组 + 不编造行为")
    GR = collections.defaultdict(list)
    for p in ALL:
        GR[p.get("campus")].append(p["name"])
    for a_g, b_g in [("北校", "南校"), ("北校", "580"), ("北校", "1100"), ("南校", "1100")]:
        if not GR[a_g] or not GR[b_g]:
            continue
        a, b = GR[a_g][0], GR[b_g][0]
        r = campus.route(a, b)
        if r:
            w(f"  {a_g}→{b_g}: {a} → {b} = "
              f"{r['meters']:.0f} m / {r['minutes']:.1f} min reliable={r.get('reliable')}")
        else:
            # route() 跨组恒 None 是**设计**（排程/就近不跨组）；但 2026-09-19 起
            # 空间上下文会补一条**带「估算」标记**的兜底话术 —— 不再是沉默。
            ctx = campus.space_context(f"从{a}到{b}怎么走")
            has = "跨教学区" in ctx and "沿军工路" in ctx
            w(f"  {a_g}→{b_g}: {a} → {b} = ❌ route() 算不出（跨组，设计使然）"
              f"｜兜底话术={'有（沿军工路 · 标「估算」）' if has else '无'}")

    hr(w, "C4. 不存在的对象：会不会硬编")
    for q in ["星巴克", "蜜雪冰城", "肯德基", "海底捞", "第三浴室", "麦当劳", "东华大学食堂"]:
        hits = [h[0]["name"] for h in campus.rank_pois(q, limit=2, min_score=1)]
        ctx = campus.space_context(q)
        w(f"  「{q}」 rank_pois={hits or '无'}｜注入 {len(ctx)} 字符｜有意图={campus.has_space_intent(q)}")
    w("  ⚠️ 命中≠假阳性：必须回数据里查。实测 `麦当劳` → 第二食堂 是**正确**的")
    w("     （`第二食堂.alias` 含「麦当劳（二食堂左侧）」）。")


# ------------------------------------------------------------------ D. 问答链路
QS = ["第三教学楼在哪", "下课去哪吃饭", "五食堂现在开吗", "取快递在哪",
      "从三教到五食堂怎么走", "南校图书馆和北校图书馆有什么区别", "有没有蜜雪冰城",
      "我下节课快开始了，哪个最快？", "附近有什么好吃的", "学校有健身房吗",
      "第一食堂有什么招牌菜", "晚上十点还能打印吗", "食堂几点关门", "北校有什么食堂",
      "光电楼怎么走", "哪里有开水", "学校能配眼镜吗", "宿舍楼下有便利店吗"]
FOLLOWUPS = ["那附近有吃的吗", "远不远", "走过去要多久", "还有别的吗", "哪个最近"]
HIST = "第一教学楼 第三教学楼 从三教到五食堂"


def sec_qa(w):
    hr(w, "D1. 真实口吻提问 → 空间上下文注入")
    tot = 0
    inj = 0
    t0 = time.perf_counter()
    for q in QS:
        ctx = campus.space_context(q)
        tot += len(ctx)
        inj += bool(ctx)
        w(f"  {'[注入]' if ctx else '[空]  '} {len(ctx):>5} 字符｜{q}")
    dt = (time.perf_counter() - t0) * 1000
    w(f"\n  注入率 {inj}/{len(QS)} = {inj / len(QS) * 100:.0f}%｜平均 {tot / len(QS):.0f} 字符"
      f"｜space_context {dt / len(QS):.1f} ms/次")
    w("  ⇒ 空间侧**不是性能瓶颈**；瓶颈在它之后的 LLM 调用。")

    hr(w, "D2. 多轮追问：拼上历史能否救回")
    for q in FOLLOWUPS:
        solo = len(campus.space_context(q))
        withh = len(campus.space_context(HIST + " " + q))
        w(f"  「{q}」 单句 {solo:>5} → 带历史 {withh:>5} 字符")

    hr(w, "D3. 注入体量构成（token 成本）")
    cen = campus.canteen_overview()
    nonfood = "第三教学楼在哪"
    food = "下课去哪吃饭"
    ctx_n = campus.space_context(nonfood)
    ctx_f = campus.space_context(food)
    w(f"  『食堂全览』块本体 {len(cen)} 字符")
    w(f"  非吃类「{nonfood}」 注入 {len(ctx_n):>5} 字符｜含食堂全览={'本部食堂全览' in ctx_n}")
    w(f"  吃类　「{food}」 注入 {len(ctx_f):>5} 字符｜含食堂全览={'本部食堂全览' in ctx_f}")
    w("  ✅ 按需注入（2026-09-19 已落地）：食堂全览只在问题与「吃」相关时才附。")
    w("     此前它**无条件附加**（连诚实兜底分支也塞），占注入体量 73% ——")
    w("     同一句「第三教学楼在哪」由 2242 → 584 字符（−74%）。")


def main():
    ap = argparse.ArgumentParser(description="空间数据库就绪度探针（产品口径）")
    for f in ("base", "coverage", "scenarios", "qa"):
        ap.add_argument(f"--{f}", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--out", default=None, help="输出写到该文件（避免 PowerShell GBK 二次解码）")
    a = ap.parse_args()
    pick = [f for f in ("base", "coverage", "scenarios", "qa") if getattr(a, f)]
    if not pick or a.all:
        pick = ["base", "coverage", "scenarios", "qa"]

    if a.out:
        fh = open(a.out, "w", encoding="utf-8")
        w = lambda *x: print(*x, file=fh)          # noqa: E731
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        w = print                                    # noqa: E731

    hr(w, "空间数据库 · 就绪度探针（产品口径）")
    w(f"生成 {time.strftime('%Y-%m-%d')}｜数据 campus_map.json（{_N} 条）")
    w("对照 audit_spatial_quality.py：那份是**合规**口径，本脚本是**产品**口径。")
    sec = {"base": sec_base, "coverage": sec_coverage, "scenarios": sec_scenarios, "qa": sec_qa}
    for k in pick:
        sec[k](w)
    if a.out:
        fh.close()
        print("已写出：" + a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
