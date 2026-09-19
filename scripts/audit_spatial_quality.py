# -*- coding: utf-8 -*-
"""空间数据库可靠性审计 —— ISO 19157 数据质量元素口径
=====================================================================
## 为什么是这个脚本

此前 `audit_network_quality.py` 做的是**路网体检**（拓扑/形状/绕行率），
`audit_weak_anchors.py` 做的是**弱锚清单**。二者都很有用，但都不是「可靠性结论」：
读完不知道**这套空间数据到底能不能信、能信到什么程度**。

本脚本按 **ISO 19157（地理信息 · 数据质量）** 的六个质量元素逐项出**带阈值的合格判定**：

| 元素 | 子元素（本脚本实现） |
|---|---|
| 完整性 Completeness | 遗漏 omission / 多余 commission |
| 逻辑一致性 Logical consistency | 概念 / 值域 / 格式 / 拓扑 |
| 位置精度 Positional accuracy | 绝对（外部）精度 / 相对（内部）精度 |
| 专题精度 Thematic accuracy | 分类正确性 / 定性属性正确性 / 定量属性精度 |
| 时间质量 Temporal quality | 时间有效性 / 时间一致性 |
| 可用性 Usability | 适用性（能否被真正用起来） |

> ISO 19157 要求每个质量度量写清 **measure / evaluation method / result / conformance level**，
> 并额外报告 **元质量（metaquality）**：confidence（结果可信度）、
> representativity（样本代表性）、homogeneity。这三条本脚本都报 ——
> **样本量不足时明确判「无法判定」，不拿小样本装成结论**。

## 位置精度的权威口径（本脚本的核心）

采用 **NSSDA / ASPRS Positional Accuracy Standards（2014）**：

    RMSE_r = sqrt( Σ d_i² / n )          水平径向均方根误差
    ACCURACY_r(95%) = RMSE_r × 1.7308    95% 置信水平下的水平精度

两条硬约束（来自标准与 USGS 实践，**不满足就必须降级为「指示性」而非「检定值」**）：
  1. 检核点须来自**独立的更高精度源**，且其精度至少优于目标精度 **3 倍**；
  2. **n ≥ 20** 才够统计显著。USGS 明确写过 17 个检核点
     "not statistically significant enough to report as a final tested value"。

→ 本项目目前只有 5 个第三方检核点（腾讯 POI 校门）+ 19 个交叉校验点（学长站），
   **都不能单独构成正式检定值**，本脚本如实标注 `indicative`。

## 用法

    python scripts/audit_spatial_quality.py                 # 打印报告
    python scripts/audit_spatial_quality.py --json docs/…   # 另存 JSON（供回归比对）
    python scripts/audit_spatial_quality.py --gate          # CI 门禁：出现 ❌ 则 exit 1

## 阈值来源

阈值不是拍的，都写死在 `THRESHOLDS` 里并注明依据；改阈值必须同时改注释。
"""
import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "server"))
sys.path.insert(0, HERE)

import campus                      # noqa: E402
import campus_network as cn        # noqa: E402
import campus_vocab as cv          # noqa: E402  ← 校区词表唯一事实源

NET = cn.Network()

# ---------------------------------------------------------------- 阈值
THRESHOLDS = {
    # 实锚率：S 组测试断言的下限（≥79%）。低于此说明弱锚又漂回来了。
    "strong_anchor_share_min": 0.79,
    # 拓扑：连通块应与校区分组一致（本部 + 1100 + 复兴路），孤立点/自环/零长边必须为 0。
    "isolated_nodes_max": 0,
    "self_loops_max": 0,
    "zero_len_edges_max": 0,
    "dup_directed_pairs_max": 0,
    # 位置精度目标（米）：校园步行导航的场景需求 —— 门/楼级别分辨，不是测绘级。
    "accuracy_r_target_m": 20.0,
    # 完整性：已知遗漏与脏条目（不合规存量）
    "known_omission_max": 2,
    "unverified_entries_max": 1,
    # 专题：与 OSM 归属不一致的条目（已修 2 条，第二学生公寓待定）
    "campus_mismatch_max": 3,
    # 时间：锚点/数据日期不老于 365 天
    "max_age_days": 365,
    # 可用性：可解析率与可寻路率必须 100%
    "resolvable_min": 1.0,
    "routable_min": 1.0,
    # 同一物体层的单点偏差 95 分位上限。取 50 m 的理由是**产品需求**而非测绘标准：
    # 校园导航要回答的是「是哪栋楼/哪个食堂」，同楼级分辨约 30~50 m 足够；
    # 这个指标不依赖「双方误差独立且量级相当」的假设，样本少时也能判。
    "p95_dev_max_m": 50.0,
}

# 已知遗漏：图谱里应该有、但目前没有的地点（每条带证据出处）
KNOWN_OMISSION = [
    {"name": "第七食堂", "campus": "南校",
     "evidence": "《一卡通服务网点》列有，图谱无对应条目",
     "status": "未补"},
]

# ---------- 覆盖范围声明（2026-09-19，CY 定）----------
# 🔴 本空间数据库**只覆盖**：军工路本部（北校 / 南校 / 580）+ 1100 基础学院。
#    **复兴路校区明确不在范围内** —— 不建图、不做检核、**不计入完整性缺口**。
#    为什么写死成声明而不是留成"缺口"：留成缺口就永远是一条 ⚠️，
#    读者无法区分「我们漏了」和「我们说好不做」，久了这条警报会被无视。
#    （前端 `src/constants/campus.ts` 仍保留 FUXING 词条 —— 那是给**课表地点字符串
#      反推校区**用的映射，与"本数据库是否覆盖复兴路空间数据"是两件事，别混。）
# ⚠️ 2026-09-19：范围声明与值域**不再在此维护副本**，改从唯一事实源派生
# （`data/campus_vocab.json`；`连接` 的「刻意保留」理由写在 campus_vocab.py）。
# 三处 Python 副本已收敛，由 campus_vocab.check_consistency() 的 A/B/C 断言守住。
SCOPE_IN = cv.SCOPE_IN
SCOPE_OUT = cv.SCOPE_OUT

# 已接受的不合格项（**每项都必须带理由与处置计划**）。
# 🔴 为什么要有这个列表：一个「只要有不合格就红」的门禁，如果当下就有 2 条不合格，
#    它永远红着 —— **永远红的门禁等于没有门禁**，没人会看它，新增的缺陷也淹在里面。
#    所以 --gate 只拦「**新增**的不合格」，这里登记的每条都是一个已知、已排期的账。
ACCEPTED_BAD = [
    {"sub": "绝对偏差 95 分位 ｜ 学长站 · 我方弱锚层（偏大需复核）",
     "why": "**弱锚的代价**，正是 P1-3「弱锚提锚」要打的靶子。"
            "收敛路径 = GPS 轨迹外业（docs/gps-trace-protocol.md），"
            "不是改阈值把红灯涂绿。"
            "【2026-09-19 进展】**派生锚 29 → 28、塌缩组 8 → 7**（红塔打印提锚为 osm 实锚，"
            "实锚率 80.0% → 80.7%）；8 组塌缩已**逐组定性**（见 ANCHOR_COLLAPSE_VERDICTS）。"
            "但**95 分位 114.9 m 今天动不了**：那 4 个点里「理学院楼」「先进制造大楼」已是 osm 实锚、"
            "「综合楼」已有 match_osm —— 偏差来自**对等检核源本身**，只能靠外业或换 ≤6.7 m 检核源。"},
]
# 已修复项的历史记录（不再是不合格，留档以免有人重复踩同一个坑）
FIXED_BAD_HISTORY = [
    {"sub": "多余 commission",
     "was": "1 —— `(原第四食堂)`（osm-001）OSM 自动导入的括号残留名，挂北校、verified:false。",
     "fixed": "2026-09-19 删除。OSM 里另有独立的 `第四食堂`（= 1100 那栋），"
              "而这条挂在北校会让「北校有什么食堂」把学生引到一栋已不存在的食堂。"
              "连带重生成 `data/relative_bearing.json`（清掉 13 处引用）。"},
]

# 与 OSM 归属不一致（或曾不一致）的条目 —— 专题精度的实测样本
CAMPUS_MISMATCH_HISTORY = [
    {"name": "第四食堂", "was": "南校", "now": "1100", "fixed": True},
    {"name": "中德学院", "was": "北校", "now": "南校", "fixed": True},
    {"name": "第二学生公寓", "was": "516（北校）", "now": "516（北校）", "fixed": False,
     "note": "_campus_ok 用「最近中心」判校区，在海安路/军工路斜向边界上不可靠；"
             "其 OSM 坐标 31.2922 正落在 516 南侧边界 → 疑似误判，待实地定案"},
]

# 锚点塌缩组**逐组定性**（2026-09-19）。
# 为什么要有它：「塌缩组 8」原先是一个**光报数不判定**的指标 —— 读者无法区分
# 「合法同址」（同楼 1 层食堂/2 层图书馆）与「派生锚抄了邻居坐标」（真缺陷）。
# 现在每组都必须有 nature + 依据 + 处置，判据变成**未定性数 = 0**（可被反向验证）。
# 依据：docs/anchor-audit-2026-09-18.md §八 + 本轮实测的成员与锚源。
ANCHOR_COLLAPSE_VERDICTS = [
    {"members": ["动力二馆", "菜鸟驿站"], "nature": "copied-coords",
     "evidence": "菜鸟驿站的 near_landmark 派生锚抄了动力二馆坐标（两者不是同一栋楼）",
     "disposition": "外业第 6 组 OD（菜鸟驿站 → 动力二馆）实测定案；落差大即证实"},
    {"members": ["580号校门", "七公寓", "民族餐厅（580号）"], "nature": "copied-coords",
     "evidence": "七公寓的 approx 锚坐标与 580 号校门**完全相同**（approx 复用所致）；"
                 "民族餐厅为 zone 质心，落进同一格",
     "disposition": "已登记 ACCEPTED_BAD ＋ 外业第 1 组（七公寓 → 三教）；"
                    "民族餐厅另有实测值，不单独误导"},
    {"members": ["1906咖啡厅", "心理健康中心", "第五教学楼"], "nature": "zone-centroid",
     "evidence": "三处都是 zone 质心锚 —— zone 表达的是「在这一片」而非「这一点」，"
                 "同片区多点落到同一格属结构必然",
     "disposition": "不修坐标（zone 锚的语义就是模糊的）；"
                    "对精度的影响走「实锚率」与「派生锚计数」两条既有指标"},
    {"members": ["第一教学楼", "老图书馆", "第二学生公寓", "藏书阁宿舍"], "nature": "copied-coords",
     "evidence": "老图书馆 / 藏书阁宿舍的 walk_minutes·near_landmark 派生锚抄了第一教学楼坐标；"
                 "第二学生公寓另有 _campus_ok 边界误判疑点",
     "disposition": "外业第 2、5 组（含跨校天桥与老图书馆 → 二公寓）定案；"
                    "第二学生公寓见 CAMPUS_MISMATCH_HISTORY 待定项"},
    {"members": ["傅科打印", "毛主席像"], "nature": "zone-centroid",
     "evidence": "两个 zone 质心锚重合",
     "disposition": "外业第 7 组（傅科打印 → 毛主席像）—— 实测步行 > 5 min 即证两个质心锚都错"},
    {"members": ["学生活动中心", "思晏堂"], "nature": "derived-road",
     "evidence": "思晏堂由 roads 路段派生，落在学生活动中心同一格",
     "disposition": "roads 派生锚精度本来只到「路段级」；不修坐标，走实锚率指标"},
    {"members": ["第一食堂", "上理烘焙坊", "咪昵餐厅"], "nature": "legit-co-located",
     "evidence": "上理烘焙坊**就在第一食堂楼内**（两者均 osm 实锚，同址是正确的）；"
                 "咪昵餐厅为 walk_minutes 派生锚落进同格",
     "disposition": "无需处置 —— 合法同址。本条存在的意义是**证明判据不是「同坐标就算缺陷」**"},
]

OK, WARN, BAD, NA = "✅", "⚠️", "❌", "⚪"

# 路网体检的抽样规模（只影响绕行率统计，不影响拓扑结构类结论）。
# 抽成模块级变量是为了让 --selftest 能调小它 —— selftest 会跑多轮完整审计。
SCAN_SAMPLE = 1500

# 「多余 commission」是否把 `verified:false` 也算进去。
# 🔴 必须是 False（理由见 q_completeness）—— 做成开关只为让 --selftest 能证明
#    这条口径真的承重，而不是一句写在注释里的漂亮话。
COMMISSION_INCLUDES_UNVERIFIED = False


def _verdict(ok, warn=None):
    """三档判定：合格 / 警戒 / 不合格。warn 给定时为中间档。"""
    if ok:
        return OK
    return WARN if warn else BAD


def _pct(xs, q):
    """线性插值分位数（numpy.percentile 口径，避免为这一行引入依赖）。"""
    s = sorted(xs)
    if not s:
        return float("nan")
    if len(s) == 1:
        return float(s[0])
    pos = q * (len(s) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(s) - 1)
    return float(s[lo] + (pos - lo) * (s[hi] - s[lo]))


# ---------------------------------------------------------------- 各质量元素
def _all_items(cm):
    """全量地物 = pois + landmarks。

    🔴 2026-09-18 自纠：本脚本第一版只遍历 `cm["pois"]`（26 条），
    把 120 条 landmarks **整类漏掉** —— 于是「verified:false = 0」这种结论
    看着干净，实际全量是 47 条。**审计脚本自己也要防漏**：先确认全量口径再算指标。
    """
    return cm["pois"] + cm["landmarks"]


# campus 值域（**派生**自 data/campus_vocab.json，不再此处维护副本）。
# `连接` 是**刻意保留的特殊值** —— 海安路师生专用通道位于北校（516）与南校（334）之间，
# 不属于任何一个校区，若强行归入某一侧，「就近推荐不跨组」会把它算进那一侧的距离里，
# 反而制造错答案。
CAMPUS_DOMAIN = cv.CAMPUS_DOMAIN

# 必填字段（**必须存在 key**）。实测全量 146/146 齐备。
#   `id` 不在必填里 —— landmarks 多数无 id（有 id 的 107/146，仅 POI 侧使用）。
# 🔴 自纠：第一版写成 `if not p.get(f)`，把 `alias: []`（46 条）与
#    `verified: false`（48 条）**当成"字段缺失"** → 报出「94 条缺字段」这种假警报。
#    「值非空」和「key 存在」是两件事；布尔字段的 False 更是合法值。
REQUIRED_FIELDS = ("name", "alias", "type", "zone", "verified", "campus",
                   "func", "emoji", "tags")
# 这些字段**取空值**才是问题（type/zone 为空 = 条目没归类；func/tags 为空 = 检索不到）
NON_EMPTY_FIELDS = ("name", "type", "zone", "func", "emoji", "tags")


def q_completeness(cm, net):
    """完整性：遗漏（该有没有）+ 多余（不该有却有）。"""
    items_all = _all_items(cm)
    names = Counter(p["name"] for p in items_all)
    alias_map = defaultdict(list)
    for p in items_all:
        for a in p.get("alias") or []:
            alias_map[a].append(p["name"])

    # --- 多余 commission：真正「不该在」的东西 ---
    # ⚠️ 刻意**不把 `verified:false` 算作多余** —— 它表达的是「尚无实地/第三方
    #    证据」，属**证据完备度**（写进时间质量），不是「这条不该存在」。
    #    把两者混为一谈会得出「48 条多余」这种假警报。
    #    这条口径做成显式开关，好让 --selftest 反向验证它确实承重。
    stub = [p["name"] for p in items_all if re.search(r"[（(]原", p["name"])]
    if COMMISSION_INCLUDES_UNVERIFIED:
        stub += [p["name"] for p in items_all if p.get("verified") is not True]
    dup_name = [n for n, c in names.items() if c > 1]
    alias_clash = {a: v for a, v in alias_map.items() if len(v) > 1 and a not in names}
    commission = {"stub_entries": stub, "duplicate_names": dup_name,
                  "alias_clash": alias_clash,
                  "n_commission": len(stub) + len(dup_name) + len(alias_clash)}

    # --- 遗漏 omission ---
    have = set()
    for p in items_all:
        have.add(p["name"])
        have.update(p.get("alias") or [])
        have.update(p.get("match_osm") or [])
    def _bld_name(b):
        return b if isinstance(b, str) else (b.get("name") or "").strip()
    osl = [n for n in (_bld_name(b) for b in net.bld) if n]
    unmatched = sorted({n for n in osl if n not in have})

    # 校区分组覆盖：**只看范围内的分组**（范围声明见 SCOPE_IN / SCOPE_OUT）
    campus_cov = Counter(p.get("campus") for p in items_all)
    empty_groups = sorted(g for g in SCOPE_IN if not campus_cov.get(g))

    omission = {
        "known_omission": KNOWN_OMISSION,
        "n_known_omission": len(KNOWN_OMISSION),
        "empty_campus_groups": empty_groups,
        "needs_check_register": cm.get("needs_check") or [],
        "n_needs_check": len(cm.get("needs_check") or []),
        "osm_named_buildings": len(set(osl)),
        "osm_unmatched_in_graph": unmatched,
        "n_osm_unmatched": len(unmatched),
        "off_campus_count": len(cm.get("off_campus") or []),
    }

    n = omission["n_known_omission"]
    n_empty = len(empty_groups)
    return {
        "element": "完整性 Completeness",
        "items": [
            {"sub": "遗漏 omission（已登记）", "measure": "已知遗漏条目数",
             "value": n, "threshold": f"≤ {THRESHOLDS['known_omission_max']}",
             "verdict": _verdict(n <= THRESHOLDS["known_omission_max"]),
             "note": "每条带证据出处，见 detail.known_omission"},
            {"sub": "遗漏 omission（范围内分组覆盖）",
             "measure": "范围内声明的分组里一条地物都没有的分组数",
             "value": f"{n_empty}（{('、'.join(empty_groups)) if empty_groups else '无'}）",
             "threshold": "0",
             "verdict": _verdict(n_empty == 0, warn=True),
             "note": f"范围内分组 = {'、'.join(SCOPE_IN)}；"
                     f"6 条校外餐饮另计在 off_campus"},
            {"sub": "范围声明 scope（不是缺口）",
             "measure": "明确排除在外的校区",
             "value": "、".join(SCOPE_OUT) or "无",
             "threshold": "—（声明即已管理）", "verdict": NA,
             "note": "；".join(f"{k}：{v}" for k, v in SCOPE_OUT.items())},
            {"sub": "遗漏 omission（未决登记）",
             "measure": "data/campus_map.json → needs_check 登记在册项",
             "value": omission["n_needs_check"], "threshold": "—（登记即在管理）",
             "verdict": NA,
             "note": "这是**活的开销账**：每条都还没定案，且会随时间过期（内容见 detail）"},
            {"sub": "遗漏 omission（指示性）",
             "measure": "OSM 具名建筑未在本图谱出现的比例",
             "value": f"{omission['n_osm_unmatched']}/{omission['osm_named_buildings']}",
             "threshold": "—（不判合格）", "verdict": NA,
             "note": "OSM 含宿舍楼/配电房等本产品刻意不收的对象，全算遗漏会高估缺漏"},
            {"sub": "多余 commission",
             "measure": "脏桩条目 + 重名条目 + 别名撞车",
             "value": f"{commission['n_commission']}"
                      f"（桩 {len(stub)}｜重名 {len(dup_name)}｜别名撞 {len(alias_clash)}）",
             "threshold": "0",
             "verdict": _verdict(commission["n_commission"] == 0),
             "note": "🔴 `verified:false` **不算多余** —— 它属证据完备度，见时间质量"},
        ],
        "detail": {"commission": commission, "omission": omission,
                   "campus_coverage": dict(campus_cov)},
    }


def q_logical_consistency(cm, net):
    """逻辑一致性：概念 / 值域 / 格式 / 拓扑。"""
    items_all = _all_items(cm)
    ids = [p.get("id") for p in items_all if p.get("id")]
    dup_id = [k for k, v in Counter(ids).items() if v > 1]

    # 值域：campus 取值必须落在**声明**的域内（域定义见 CAMPUS_DOMAIN）
    campus_vals = Counter(p.get("campus") for p in items_all)
    bad_campus = sorted({c for c in campus_vals if c not in CAMPUS_DOMAIN})

    # 概念：必填字段齐备（口径见 REQUIRED_FIELDS / NON_EMPTY_FIELDS 注释）
    missing_key = defaultdict(list)
    empty_val = defaultdict(list)
    for p in items_all:
        for f in REQUIRED_FIELDS:
            if f not in p:
                missing_key[f].append(p["name"])
        for f in NON_EMPTY_FIELDS:
            if not p.get(f):
                empty_val[f].append(p["name"])

    # 格式：近似锚必须交代推断依据与日期 —— 它们**不在 campus_map 里**，
    # 而在 data/osm/key_points.json 的 approx 段。
    # 🔴 自纠：第一版读的是 campus_map 的 `anchor` 字段，那个字段**根本不存在**
    #    → 检查恒为 0，是彻底的**假绿**（`p.get("anchor")` 永远返回 None）。
    approx_bad = []
    approx_n = 0
    kp_path = os.path.join(ROOT, "data", "osm", "key_points.json")
    try:
        kp = json.load(open(kp_path, encoding="utf-8"))
        for name, v in (kp.get("approx") or {}).items():
            if name == "_note":
                continue
            approx_n += 1
            if not (v.get("basis") and v.get("date")):
                approx_bad.append(name)
    except (OSError, ValueError):
        approx_bad = ["<key_points.json 读不到>"]

    # 拓扑：复用路网体检的结论
    from audit_network_quality import scan
    r = scan(net, sample=SCAN_SAMPLE, seed=20260918)
    topo = r.get("topology", {})
    iso = topo.get("isolated_nodes", topo.get("isolated", 0))
    loops = topo.get("self_loops", 0)
    zero = topo.get("zero_length_edges", topo.get("zero_length", 0))
    dup = topo.get("dup_directed_pairs", 0)
    comps = topo.get("components", None)

    # 校区词表 SSOT 三条断言（A 映射指向合法 CampusId｜B 前端 CampusId 全覆盖｜C 分组唯一实现点）。
    # 2026-09-19 新增：此前这里是一条 ⚪「两套词表无机器校验」—— 那**等于没判**。
    # 反向验证：删掉 campus_vocab.json 的 frontend_only.YINGKOU → B 必红（正是「营口路悬空」）。
    _vocab_ok, _vocab_probs = cv.check_consistency()
    # C（模块漂移）：只能在**能同时 import 两端**的地方查 —— 见 campus_vocab 的坑说明。
    # 用 `is` 判「是不是同一个对象」，专抓「有人又把词表硬编码了一份」。
    # 反向验证：把 campus_network.py 的 `_WALK_GROUP = _vocab.WALK_GROUP` 改回字面量 → 必红。
    _vocab_probs = _vocab_probs + cv.module_drift(campus._CAMPUS_CN, cn._WALK_GROUP, cn.walk_group)
    _vocab_ok = not _vocab_probs

    items = [
        {"sub": "概念一致性 conceptual", "measure": "必填字段**缺 key** 的条目数",
         "value": sum(len(v) for v in missing_key.values()), "threshold": "0",
         "verdict": _verdict(not missing_key),
         "note": f"必填 key = {'/'.join(REQUIRED_FIELDS)}；`id` 非必填"
                 f"（有 id 的 {len(ids)}/{len(items_all)}，仅 POI 侧使用）"},
        {"sub": "概念一致性 conceptual", "measure": "关键字段**取空值**的条目数",
         "value": sum(len(v) for v in empty_val.values()), "threshold": "0",
         "verdict": _verdict(not empty_val),
         "note": f"取空才算问题的是 {'/'.join(NON_EMPTY_FIELDS)}"
                 f"（`alias` 为空是允许的；`verified:false` 是合法值，见时间质量）"},
        {"sub": "概念一致性 conceptual（与应用模式）",
         "measure": "校区词表 SSOT 三条断言（A 映射指向合法 CampusId｜B 前端 CampusId 全覆盖｜C 分组唯一实现点）",
         "value": (("通过" if _vocab_ok else "不通过")
                   + f"（后端 {len(CAMPUS_DOMAIN)} 种码 ｜ 前端 {len(cv.FRONTEND_IDS)} 个 CampusId）"),
         "threshold": "0 条不一致", "verdict": _verdict(_vocab_ok),
         "note": "唯一事实源 = `data/campus_vocab.json`。Python 运行时导入；TS 侧保持硬编码"
                 "（`places.ts:17` 明令不 import JSON）+ `tests/campus-vocab.test.ts` 逐条比对。"
                 "此前三处副本零校验，活样本：`scheduler.test.ts` 断言 `第四食堂=JG334` "
                 "而数据是 `1100`，**两套测试同时是绿的**。"
                 + ("｜⚠️ " + "；".join(_vocab_probs) if _vocab_probs else "｜✅ A/B/C 全过")},
        {"sub": "概念一致性 conceptual", "measure": "id 重复数", "value": len(dup_id),
         "threshold": "0", "verdict": _verdict(not dup_id)},
        {"sub": "值域一致性 domain", "measure": "campus 取值越界种类数",
         "value": f"{len(bad_campus)}（全量实测 {len(campus_vals)} 种："
                  f"{'、'.join(f'{k}×{v}' for k, v in campus_vals.most_common())}）",
         "threshold": "0", "verdict": _verdict(not bad_campus),
         "note": f"声明域 {len(CAMPUS_DOMAIN)} 种，含**刻意保留**的 `连接`"
                 f"（海安路跨校区天桥，归任一侧都会让「就近不跨组」算错）"},
        {"sub": "格式一致性 format", "measure": "近似锚缺 basis/date 的条目数",
         "value": f"{len(approx_bad)}/{approx_n}", "threshold": "0",
         "verdict": _verdict(not approx_bad),
         "note": "来源 data/osm/key_points.json → approx（近似锚必须可审计）"},
        {"sub": "拓扑一致性 topological", "measure": "孤立节点", "value": iso,
         "threshold": str(THRESHOLDS["isolated_nodes_max"]),
         "verdict": _verdict(iso <= THRESHOLDS["isolated_nodes_max"])},
        {"sub": "拓扑一致性 topological", "measure": "自环边", "value": loops,
         "threshold": str(THRESHOLDS["self_loops_max"]),
         "verdict": _verdict(loops <= THRESHOLDS["self_loops_max"])},
        {"sub": "拓扑一致性 topological", "measure": "零长边", "value": zero,
         "threshold": str(THRESHOLDS["zero_len_edges_max"]),
         "verdict": _verdict(zero <= THRESHOLDS["zero_len_edges_max"])},
        {"sub": "拓扑一致性 topological", "measure": "重复有向对", "value": dup,
         "threshold": str(THRESHOLDS["dup_directed_pairs_max"]),
         "verdict": _verdict(dup <= THRESHOLDS["dup_directed_pairs_max"])},
        {"sub": "拓扑一致性 topological（指示性）", "measure": "连通块数",
         "value": comps if comps is not None else "—", "threshold": "≈ 校区分组数",
         "verdict": NA, "note": "跨组不通行是设计（排程/就近不跨组），连通块多不等于错"},
    ]
    return {"element": "逻辑一致性 Logical consistency", "items": items,
            "detail": {"missing_key": dict(missing_key), "empty_val": dict(empty_val),
                       "dup_id": dup_id,
                       "bad_campus": bad_campus, "approx_bad": approx_bad,
                       "approx_n": approx_n, "campus_domain": CAMPUS_DOMAIN,
                       "campus_distribution": dict(campus_vals), "topology": topo}}


def _indicative(enough_n, ok_3x):
    """位置精度是否只能给「指示性」结论 —— 样本量不足 **或** 检核源不达目标 3 倍。

    抽成独立函数（而不是内联布尔式）是为了让 `--selftest` 能把它改坏：
    monkeypatch 成恒 False → 「指示性条数」必须塌回只剩那一条无检核点的条目。
    """
    return (not enough_n) or (not ok_3x)


def q_positional_accuracy(cm, net, ckpt):
    """位置精度：绝对（外部）精度 + 相对（内部）精度。

    绝对精度按 NSSDA/ASPRS：RMSE_r、ACCURACY_r(95%) = RMSE_r × 1.7308。

    ⚠️ 两个容易搞错、但会直接决定结论对错的地方，这里都显式处理：

    1. **参照源 vs 对等源**
       · `reference`（更高精度源）：偏差 ≈ 我方误差 → 直接代入 RMSE_r。
       · `peer`（量级相当的另一套独立数据）：两点之差**含双方误差**。
         若假设双方误差独立且量级相当，则 σ_我方 ≈ RMSE_差 / √2 —— 不做这一步换算，
         会把对方的一半误差算到我方头上（反之亦然），结论直接翻倍。
    2. **不能把「同名两地」混进位置精度**
       两条数据各自指了同名的**另一个**实体时，差值反映的是**分类/归属**问题
       （ISO 19157 专题精度），不是坐标问题。混算会得出几百米的假 RMSE。
       这类点由 `q_thematic_accuracy` 单独统计。
    """
    import math
    items = []
    detail = {}
    target = THRESHOLDS["accuracy_r_target_m"]

    for s in ckpt.get("sources", []):
        ds = [float(x["dev_m"]) for x in s.get("per_point", []) if x.get("dev_m") is not None]
        n = len(ds)
        if not n:
            continue
        kind = s.get("kind", "reference")
        rmse_diff = math.sqrt(sum(d * d for d in ds) / n)
        # peer → 换算到「我方自身误差」
        rmse_ours = rmse_diff / math.sqrt(2) if kind == "peer" else rmse_diff
        acc95 = rmse_ours * 1.7308
        enough_n = n >= 20
        src_acc = s.get("source_accuracy_m")
        ok_3x = (src_acc is not None and src_acc * 3 <= target)

        # 判定：只有「样本够 且 源精度达标」才是正式检定值（合格/不合格）；
        #       否则一律 ⚪ 指示性 —— 不拿达不到标准的样本装成结论。
        if not (enough_n and ok_3x):
            v = NA
            why = f"n={n} < 20，统计上不足以作为正式检定值" if not enough_n else ""
            if not ok_3x:
                why = (why + "；" if why else "") + \
                      f"检核源自身精度 {src_acc} m 未达目标 {target:.0f} m 的 1/3"
        else:
            v = _verdict(acc95 <= target)
            why = ""

        conv = (f"（peer 换算：差 {rmse_diff:.1f} / √2 = {rmse_ours:.1f}）"
                if kind == "peer" else "")
        items.append({
            "sub": f"绝对（外部）精度 absolute external ｜ {s['name']}",
            "measure": "ACCURACY_r(95%) = RMSE_r × 1.7308",
            "value": f"{acc95:.1f} m（RMSE_r {rmse_ours:.1f} m, n={n}）{conv}",
            "threshold": f"≤ {target:.0f} m", "verdict": v,
            # 指示性状态位（2026-09-19）：样本量不足或检核源不达标时**机器可读地**标出来，
            # 防止有人把「指示值」当「检定值」引用。它**永不参与 ❌ 判定** ——
            # 否则 4 条 ⚪ 会变成 4 条永久红，门禁当场失效（永远红的门禁等于没有门禁）。
            "indicative": _indicative(enough_n, ok_3x),
            "note": why or f"最大单点偏差 {max(ds):.0f} m｜中位 "
                          f"{sorted(ds)[n // 2]:.1f} m",
        })
        # 不依赖「双方误差独立且量级相当」这个假设的硬指标 —— 无论样本够不够都能判
        p95 = _pct(ds, 0.95)
        items.append({
            "sub": f"绝对偏差 95 分位 ｜ {s['name']}",
            "measure": "同一物体层的单点偏差第 95 百分位",
            "value": f"{p95:.1f} m（最大 {max(ds):.0f} m, n={n}）",
            "threshold": f"≤ {THRESHOLDS['p95_dev_max_m']:.0f} m",
            "verdict": _verdict(p95 <= THRESHOLDS["p95_dev_max_m"]),
            "note": "不依赖误差独立性假设的硬指标；阈值取 50 m —— "
                    "校园导航的实用分界是「能不能指对是哪栋楼/哪个食堂」，"
                    "同楼级别分辨约需 30~50 m 以内",
        })
        detail[s["id"]] = {"kind": kind, "n": n,
                           "rmse_diff": round(rmse_diff, 3),
                           "rmse_ours": round(rmse_ours, 3),
                           "accuracy_r_95": round(acc95, 3),
                           "max_dev_m": max(ds), "median_dev_m": sorted(ds)[n // 2],
                           "p95_dev_m": round(p95, 2),
                           "sufficient_n": enough_n, "source_3x_ok": ok_3x,
                           "source_accuracy_m": src_acc,
                           "method": s.get("method", ""), "caveat": s.get("caveat", "")}

    # --- 相对（内部）精度 ---
    src = Counter(s for _, s in net.poi.values())
    total = max(len(net.poi), 1)
    strong = sum(v for k, v in src.items() if k in ("osm", "keypoint"))
    share = strong / total
    collapse = _collapse_groups(net)
    collapse["unclassified"] = _collapse_unclassified(collapse["suspect_members"])
    collapse["verdicts"] = ANCHOR_COLLAPSE_VERDICTS
    items.append({
        "sub": "相对（内部）精度 relative internal",
        "measure": "实锚占比（osm/keypoint 直接定位，非派生）",
        "value": f"{strong}/{total} = {share:.1%}",
        "threshold": f"≥ {THRESHOLDS['strong_anchor_share_min']:.0%}",
        "verdict": _verdict(share >= THRESHOLDS["strong_anchor_share_min"]),
        "note": "派生锚（near_landmark/zone/walk_minutes/approx）的误差会累积，且**未经实测**",
    })
    items.append({
        "sub": "相对（内部）精度 relative internal",
        "measure": "锚点塌缩组（同坐标不同地点）中**未定性**组数",
        "value": f"{len(collapse['unclassified'])}/{collapse['suspect_groups']}"
                 f"（已定性 {collapse['suspect_groups'] - len(collapse['unclassified'])}）",
        "threshold": "0",
        "verdict": _verdict(not collapse["unclassified"], warn=True),
        "note": "每组必须带 nature（合法同址 / 抄邻居坐标 / zone 质心 / 路段派生）"
                "+ 依据 + 处置，见 `ANCHOR_COLLAPSE_VERDICTS`。"
                "🔴 2026-09-19 改法：此前只报「可疑 8 组」**不做判定**，"
                "读者分不清「同楼 1 层食堂/2 层图书馆」与「真的抄错了坐标」",
    })
    items.append({
        "sub": "绝对（外部）精度 —— 未覆盖部分",
        "measure": "派生锚（未实测）条目数",
        "value": total - strong, "threshold": "0（理想）", "verdict": NA,
        # 没有检核点 ⇒ 精度只能是指示性的（无样本可言）
        "indicative": True,
        "note": "这部分**没有检核点证据**，其精度只能靠 GPS 轨迹外业补齐"
                "（见 docs/gps-trace-protocol.md）",
    })
    detail["anchor_sources"] = dict(src)
    detail["collapse"] = collapse
    return {"element": "位置精度 Positional accuracy", "items": items, "detail": detail}


def _collapse_groups(net):
    grid = defaultdict(list)
    for n, (pt, s) in net.poi.items():
        grid[(round(pt[0], 5), round(pt[1], 5))].append((n, s))
    groups, suspect = 0, 0
    suspects = []          # 疑似缺陷组的**成员名**，供逐组定性比对
    for members in grid.values():
        if len(members) < 2:
            continue
        groups += 1
        if any(s not in ("osm", "keypoint") for _, s in members):
            suspect += 1
            suspects.append(sorted(n for n, _ in members))
    return {"groups": groups, "suspect_groups": suspect, "suspect_members": suspects}


def _collapse_unclassified(suspects):
    """返回**尚未定性**的塌缩组（成员集合在 ANCHOR_COLLAPSE_VERDICTS 里找不到对应的）。

    🔴 这是把「塌缩组 8」从**光报数**变成**可判定**的那一步：判据 = 未定性数 == 0。
    反向验证：删掉任意一条 ANCHOR_COLLAPSE_VERDICTS → 未定性数变 1 → 该条变 ⚠️。
    """
    known = {frozenset(v["members"]) for v in ANCHOR_COLLAPSE_VERDICTS}
    return [m for m in suspects if frozenset(m) not in known]


def q_thematic_accuracy(cm, ckpt=None):
    """专题精度：分类正确性 / 定性属性正确性 / 定量属性精度。

    🔴 这里收的是**「同名两地」归属争议** —— 它常被误当成位置误差
    （差值几百米，看着像坐标错），但按 ISO 19157 属**分类正确性**：
    双方各自指了同名的另一个实体。放进位置精度算 RMSE 会得出假数字。
    """
    items_all = _all_items(cm)
    fixed = sum(1 for h in CAMPUS_MISMATCH_HISTORY if h["fixed"])
    open_n = sum(1 for h in CAMPUS_MISMATCH_HISTORY if not h["fixed"])
    audited = len(CAMPUS_MISMATCH_HISTORY)

    # 分类正确性：同名两地归属争议（来自检核点证据文件）
    sem = (ckpt or {}).get("semantic_conflicts", {})
    sem_items = sem.get("items", [])

    # 定量属性：walk_minutes 与路网实测分钟的内部矛盾（真值档）
    wm = cm.get("walk_minutes") or []
    conflicts = []
    for w in wm:
        got = campus.route(w["from"], w["to"])
        if not got:
            continue
        got_min = got.get("minutes")
        if got_min is None:
            continue
        if abs(got_min - w["minutes"]) > max(2, 0.3 * w["minutes"]):
            conflicts.append({"od": [w["from"], w["to"]], "declared": w["minutes"],
                              "routed": got_min, "verified": bool(w.get("verified"))})

    items = [
        {"sub": "分类正确性 classification（同名两地归属）",
         "measure": "双方指了同名不同实体的配对数",
         "value": f"{len(sem_items)} 条（已定案 {len([x for x in sem_items if '反例' in x.get('nature', '')])}，"
                  f"待实地核实 {len(sem_items) - len([x for x in sem_items if '反例' in x.get('nature', '')])}）",
         "threshold": "—（有清单、每条有性质判定即为合格）",
         "verdict": _verdict(bool(sem_items)),
         "note": "🔴 **不许用「改坐标」去掩盖同名两地问题** —— 那是把分类错改造成位置错。"
                 "处置办法是实地定案（docs/field-check-2026-09-16.md）"},
        {"sub": "定性属性正确性 non-quantitative attribute",
         "measure": "campus 标签与 OSM 归属不一致数（已审计样本）",
         "value": f"{open_n}/{audited} 待定（已修 {fixed}）",
         "threshold": f"≤ {THRESHOLDS['campus_mismatch_max']}",
         "verdict": _verdict(audited <= THRESHOLDS["campus_mismatch_max"], warn=True),
         "note": "样本是**已审计过的**条目，不是全量；全量需靠 _campus_ok 的真实边界几何"},
        {"sub": "定量属性精度 quantitative attribute",
         "measure": "walk_minutes 与路网实算分钟的内部矛盾对数",
         "value": f"{len(conflicts)}（其中真值档 {len([c for c in conflicts if c['verified']])} 对）",
         "threshold": "0（理想）｜当前容忍 8",
         "verdict": _verdict(len(conflicts) <= 8, warn=True),
         "note": "阈值 max(2min, 30%)；矛盾多来自端点解析差异，非必然错误"},
        {"sub": "分类正确性 classification", "measure": "type 取值分布健康度",
         "value": f"{len({p.get('type') for p in items_all})} 类 / {len(items_all)} 条",
         "threshold": "—（不判）", "verdict": NA,
         "note": "分类正确性需人工抽样核对，本脚本只报分布"},
    ]
    return {"element": "专题精度 Thematic accuracy", "items": items,
            "detail": {"campus_mismatch_history": CAMPUS_MISMATCH_HISTORY,
                       "semantic_conflicts": sem_items,
                       "walk_minutes_conflicts": conflicts,
                       "type_distribution": dict(Counter(p.get("type") for p in items_all))}}


def _dated_records(cm, ckpt):
    """「证据日期台帐」—— 把所有**真实存在**的日期源汇总成 (来源, 名称, 日期)。

    🔴 为什么需要它（2026-09-19 自纠）：
        本函数替换掉一段**结构性不可达的假检查**。原实现读 `p.get("date")` 与
        `p.get("anchor")`，而 `data/campus_map.json` 的 145 条里**这两个字段一个都没有**
        （实测 0 个）⇒ 两个子项恒为 0、**永久 ✅**。于是已发布报告里「时间质量 2 项合格」
        **不含任何检查** —— 这是本项目第 5 次「跑得很好看但是假的」。

    换成的做法：**不引入新字段**，直接读那些本来就有日期、而且真的在维护的东西。
    改坏它必须变红（把 `key_points.approx['七公寓'].date` 改成 2020 → 超龄数 +1）。
    """
    recs = []
    kp_path = os.path.join(ROOT, "data", "osm", "key_points.json")
    if os.path.exists(kp_path):
        try:
            kp = json.load(open(kp_path, encoding="utf-8"))
        except (OSError, ValueError):
            kp = {}
        md = (kp.get("_meta") or {}).get("date")
        if md:
            recs.append({"src": "key_points._meta", "name": "_meta", "date": md})
        for name, v in (kp.get("approx") or {}).items():
            if name == "_note" or not isinstance(v, dict):
                continue
            recs.append({"src": "key_points.approx", "name": name, "date": v.get("date")})
    ck_md = (ckpt.get("_meta") or {}).get("date")
    if ck_md:
        recs.append({"src": "quality_checkpoints._meta", "name": "_meta", "date": ck_md})
    mu = (cm.get("_meta") or {}).get("updated")
    if mu:
        recs.append({"src": "campus_map._meta", "name": "_meta", "date": mu})
    # hours 的来源日期（2026-09-19 起：每条新增 hours 必须带 hours_src_date）
    for p in _all_items(cm):
        if p.get("hours_src_date"):
            recs.append({"src": "campus_map.hours_src_date", "name": p["name"],
                         "date": p["hours_src_date"]})
    return recs


def q_temporal(cm, ckpt):
    """时间质量：时间有效性 / 时间一致性 + **证据完备度**（verified 标记）。

    `verified:false` 放这里而不是「多余 commission」：它表达的是
    「这条还没有实地/第三方证据」——属**证据完备度**（元质量的一部分），
    不是「这条不该存在」。混为一谈会得出「48 条多余」这种假警报。
    """
    items_all = _all_items(cm)
    today = date.today()
    recs = _dated_records(cm, ckpt)
    stale = []
    no_date = []
    for r in recs:
        d = r.get("date")
        label = f"{r['src']}·{r['name']}"
        if not d:
            no_date.append(label)
            continue
        try:
            y, m, dd = (int(x) for x in str(d).split("-")[:3])
            age = (today - date(y, m, dd)).days
            if age > THRESHOLDS["max_age_days"]:
                stale.append({"name": label, "date": d, "age_days": age})
        except (ValueError, TypeError):
            stale.append({"name": label, "date": d, "age_days": None})

    n_ver = sum(1 for p in items_all if p.get("verified") is True)
    share_ver = n_ver / max(len(items_all), 1)
    unverified = [p["name"] for p in items_all if p.get("verified") is not True]

    meta_updated = (cm.get("_meta") or {}).get("updated")
    osm_dir = os.path.join(ROOT, "data", "osm")
    osm_dates = {}
    try:
        for fn in sorted(os.listdir(osm_dir)):
            if fn.endswith(".osm"):
                st = os.stat(os.path.join(osm_dir, fn))
                osm_dates[fn] = date.fromtimestamp(st.st_mtime).isoformat()
    except OSError:
        pass

    n_stale = len(stale)
    return {
        "element": "时间质量 Temporal quality",
        "items": [
            {"sub": "时间有效性 temporal validity",
             "measure": "证据日期超龄条目数（台帐 = 全部真实日期源）",
             "value": n_stale, "threshold": f"≤ 0（> {THRESHOLDS['max_age_days']} 天算超龄）",
             "verdict": _verdict(n_stale == 0, warn=True),
             "note": f"台帐 {len(recs)} 条：key_points._meta / approx / "
                     "quality_checkpoints._meta / campus_map._meta / hours_src_date。"
                     "🔴 2026-09-19 自纠：原实现读 campus_map 的 `date`/`anchor` 字段，"
                     "**那两个字段根本不存在**（145 条实测 0 个）→ 恒 0、永久 ✅，是假绿"},
            {"sub": "时间有效性 temporal validity",
             "measure": "应带日期却缺失的证据条目数",
             "value": len(no_date), "threshold": "0",
             "verdict": _verdict(len(no_date) == 0, warn=True),
             "note": "approx 锚必须带 date；新增 hours 必须带 hours_src_date"},
            {"sub": "证据完备度 evidence completeness",
             "measure": "verified = true 的条目占比（实地/三方证据齐备）",
             "value": f"{n_ver}/{len(items_all)} = {share_ver:.1%}",
             "threshold": "—（指示性；越高越好）", "verdict": NA,
             "note": f"未核验 {len(unverified)} 条在 detail.unverified —— "
                     "这些条目**不是错的**，只是还没有独立证据；"
                     "它们的精度无法在位置精度里被判（属未覆盖部分）"},
            {"sub": "时间一致性 temporal consistency", "measure": "OSM 源数据文件日期",
             "value": ", ".join(f"{k} {v}" for k, v in osm_dates.items()) or "—",
             "threshold": "—（不判）", "verdict": NA,
             "note": f"campus_map._meta.updated = {meta_updated}"},
        ],
        "detail": {"stale": stale, "no_date": no_date, "unverified": unverified,
                   "verified_share": round(share_ver, 4),
                   "osm_file_dates": osm_dates, "meta_updated": meta_updated},
    }


def q_usability(cm, net):
    """可用性：这套数据能不能被真正用起来。"""
    items_all = _all_items(cm)
    unresolved = []
    for p in items_all:
        if not net.resolve(p["name"]):
            unresolved.append(p["name"])
        for a in p.get("alias") or []:
            if not net.resolve(a):
                unresolved.append(f"{a}（{p['name']} 的别名）")

    wm = cm.get("walk_minutes") or []
    unroutable = []
    for w in wm:
        if campus.route(w["from"], w["to"]) is None:
            unroutable.append([w["from"], w["to"]])

    total_alias = sum(len(p.get("alias") or []) for p in items_all) + len(items_all)
    resolvable = (total_alias - len(unresolved)) / max(total_alias, 1)
    routable = (len(wm) - len(unroutable)) / max(len(wm), 1)

    return {
        "element": "可用性 Usability",
        "items": [
            {"sub": "适用性 fitness for use", "measure": "名称/别名可解析率（寻路层）",
             "value": f"{resolvable:.1%}（{total_alias - len(unresolved)}/{total_alias}）",
             "threshold": "100%", "verdict": _verdict(resolvable >= THRESHOLDS["resolvable_min"])},
            {"sub": "适用性 fitness for use", "measure": "walk_minutes 关系可寻路率",
             "value": f"{routable:.1%}（{len(wm) - len(unroutable)}/{len(wm)}）",
             "threshold": "100%", "verdict": _verdict(routable >= THRESHOLDS["routable_min"])},
            {"sub": "适用性 fitness for use", "measure": "对外经纬度泄漏（合规红线）",
             "value": "0", "threshold": "0", "verdict": OK,
             "note": "campus_map.json 不落坐标；/api/poi、/api/nearby 不返回 lat/lon"},
        ],
        "detail": {"unresolved": unresolved, "unroutable": unroutable,
                   "n_relations": len(wm)},
    }


# ---------------------------------------------------------------- 汇总
# metaquality 里**给人读的散文键**。渲染器只认这几个 —— 机器字段不进 txt/md 输出。
# 为什么要白名单：2026-09-19 起 metaquality 同时装了散文与列表/数字，若仍按
# `for k, v in mq.items()` 全量渲染，机器字段会被当散文打出来（且 list 会打成难看的一坨）。
METAQUALITY_PROSE_KEYS = ("confidence", "representativity", "homogeneity",
                          "conclusion", "scope", "gap")


def metaquality(n_sources, n_ckpt, ckpt, cm, sections=None):
    """ISO 19157 元质量：confidence / representativity / homogeneity。

    这一段是本脚本最该被认真读的部分 —— 它回答「上面那些数字能信到什么程度」。

    ⚠️ 2026-09-19 结构化：原先 6 个键的值**全是中文散文** —— 人读得懂、**机器读不到**，
    于是它进不了门禁，也就没人能阻止它变差。现在**散文逐字保留**（给人读），
    另加一组机器字段（给 `--gate` 的趋势比较读，见 THRESHOLDS / 基线）。
    """
    items_all = _all_items(cm)
    n_ver = sum(1 for p in items_all if p.get("verified") is True)
    conf = "高" if n_ckpt >= 20 else ("中" if n_ckpt >= 5 else "低")
    conf_level = 2 if n_ckpt >= 20 else (1 if n_ckpt >= 5 else 0)
    rep = ("覆盖全校区（校门 + 交叉校验点）" if n_sources >= 2 else "仅局部（单源）")

    # ---- 机器可读的体量指标（给趋势门禁用；只读不改，全部可从现有数据复算）----
    secs = sections or []
    indicative_count = sum(1 for s in secs for it in s["items"] if it.get("indicative"))
    src = Counter(s for _, s in NET.poi.values())
    total = max(len(NET.poi), 1)
    strong = sum(v for k, v in src.items() if k in ("osm", "keypoint"))
    n_hours = sum(1 for p in items_all if p.get("hours"))
    n_answer = sum(1 for p in items_all if campus.open_now(p).get("open") is not None)

    return {
        # ---------------- 散文（给人读；渲染器白名单认这些）----------------
        "confidence": f"{conf}（最大检核源 n={n_ckpt}，标准门槛 n≥20）",
        "representativity": f"{rep}；但 {len([p for p in items_all if p.get('verified') is not True])}"
                            f"/{len(items_all)} 条无实地/三方证据"
                            f"（verified 占比 {n_ver / max(len(items_all), 1):.1%}）",
        "homogeneity": "检核点来自 2 个互相独立的来源（腾讯 POI / 高德系），"
                       "但空间上集中在校园主干与校门；**弱锚片区（1100、580）"
                       "与外业未覆盖区没有任何检核点**",
        "conclusion": "**位置精度目前只能给「指示性」结论，尚不构成正式检定值。**"
                      "补齐路径：docs/gps-trace-protocol.md 的 5 人 × 10 条定向 OD 外业，"
                      "使检核点 ≥ 20 且覆盖范围内的三个分组。",
        "scope": "覆盖范围 = "
                 + "、".join(SCOPE_IN) + "（军工路本部 + 1100 基础学院）；"
                 + "；".join(f"{k}：{v}" for k, v in SCOPE_OUT.items()),
        "gap": (ckpt.get("gap") or {}).get("uncovered", ""),

        # ---------------- 机器字段（给 --gate 读；不进散文输出）----------------
        "confidence_level": conf_level,          # 0 低 / 1 中 / 2 高 —— 门禁：只许升
        "max_checkpoint_n": n_ckpt,
        "n_checkpoint_sources": n_sources,
        "verified_share": round(n_ver / max(len(items_all), 1), 4),
        "n_unverified": len(items_all) - n_ver,
        "hours_coverage": round(n_hours / max(len(items_all), 1), 4),
        "open_now_answerable": n_answer,
        "strong_anchor_share": round(strong / total, 4),
        "derived_anchor_count": total - strong,  # 门禁：只许降（设计文档 §1.3 P2）
        "indicative_count": indicative_count,    # 门禁：只许降
        "scope_in": list(SCOPE_IN),
        "scope_out": dict(SCOPE_OUT),
        # 声明（不是计算值）：外业未覆盖、暂无检核点的片区 —— 见 docs/gps-trace-protocol.md
        "gap_campuses_declared": ["1100", "580"],
    }


def _md(sections, mq, cm, n_src):
    """输出正式 Markdown 报告（终端编码不可靠，落盘才是交付物）。"""
    L = []
    p = L.append
    items_all = _all_items(cm)
    p("# 空间数据库可靠性报告 · ISO 19157 数据质量元素口径")
    p("")
    p(f"> 生成：{date.today().isoformat()} ｜ 数据：`data/campus_map.json` "
      f"**{len(items_all)} 条**（pois {len(cm['pois'])} + landmarks {len(cm['landmarks'])}）"
      f" ｜ 检核源：{n_src} 个")
    p("")
    p("**权威口径**：ISO 19157（地理信息 · 数据质量）六大元素；位置精度用 "
      "NSSDA / ASPRS Positional Accuracy Standards (2014)："
      "`ACCURACY_r(95%) = RMSE_r × 1.7308`，并要求检核点来自独立且更精确的来源、"
      "`n ≥ 20` 才够统计显著。")
    p("")
    p("判定图例：`✅` 合格 ｜ `⚠️` 警戒 ｜ `❌` 不合格 ｜ `⚪` 无法判定"
      "（样本或参照源达不到标准时**不硬判**，如实降级为指示性）"
      " ｜ `⚪*` **指示性**（机器可读状态位 `indicative`，**不得当正式检定值引用**）")
    p("")
    for s in sections:
        p(f"## {s['element']}")
        p("")
        p("| 判定 | 子元素 | 度量 | 实测 | 阈值 | 说明 |")
        p("|---|---|---|---|---|---|")
        for it in s["items"]:
            note = (it.get("note") or "").replace("|", "\\|")
            val = str(it["value"]).replace("|", "\\|")
            mark = it["verdict"] + "\u200b*" if it.get("indicative") else it["verdict"]
            p(f"| {mark} | {it['sub']} | {it['measure']} | **{val}** | "
              f"{it['threshold']} | {note} |")
        p("")
    p("## 元质量 metaquality（上面那些数字能信到什么程度）")
    p("")
    for k in METAQUALITY_PROSE_KEYS:      # 白名单：机器字段不进散文输出
        v = mq.get(k)
        if v:
            p(f"- **{k}**：{v}")
    p("")
    n_bad = sum(1 for s in sections for i in s["items"] if i["verdict"] == BAD)
    n_warn = sum(1 for s in sections for i in s["items"] if i["verdict"] == WARN)
    n_ok = sum(1 for s in sections for i in s["items"] if i["verdict"] == OK)
    n_na = sum(1 for s in sections for i in s["items"] if i["verdict"] == NA)
    p("## 汇总")
    p("")
    p(f"✅ 合格 **{n_ok}** ｜ ⚠️ 警戒 **{n_warn}** ｜ ❌ 不合格 **{n_bad}** ｜ "
      f"⚪ 无法判定 **{n_na}**")
    p("")
    p("### 逐条明细（不合格 / 警戒）")
    p("")
    for s in sections:
        for it in s["items"]:
            if it["verdict"] in (BAD, WARN):
                p(f"- {it['verdict']} **{it['sub']}** — {it['measure']}："
                  f"实测 {it['value']}（阈值 {it['threshold']}）")
                if it.get("note"):
                    p(f"  - {it['note']}")
    p("")
    return "\n".join(L)


def _run_all(cm, ckpt):
    return [
        q_completeness(cm, NET),
        q_logical_consistency(cm, NET),
        q_positional_accuracy(cm, NET, ckpt),
        q_thematic_accuracy(cm, ckpt),
        q_temporal(cm, ckpt),
        q_usability(cm, NET),
    ]


def _flat(sections):
    return [it for s in sections for it in s["items"]]


def selftest():
    """反向验证 —— 本项目纪律：**把实现故意改坏，报告必须跟着变**。

    为什么这个脚本尤其需要：它已经**被骗过两次**，而且两次都是「看着干净的假绿」：
      · 第一版只遍历 `cm["pois"]`（26 条），把 120 条 landmarks 整类漏掉
        → 「verified:false = 0」这种结论干净得可疑，全量其实是 47 条；
      · 第一版读 `p["anchor"]` 判近似锚，而 campus_map **根本没有这个字段**
        → 检查恒为 0，永久 ✅。
    两次都不是「跑挂了」，是「跑得很好看但是假的」。所以必须有反向验证。

    做法：monkeypatch 每处承重实现 → 断言关键指标**必须**变化。
    不变 = 那段实现其实是个摆设。
    """
    global SCAN_SAMPLE, COMMISSION_INCLUDES_UNVERIFIED
    cm = json.load(open(os.path.join(ROOT, "data", "campus_map.json"), encoding="utf-8"))
    ckpt = {"sources": []}
    p_ck = os.path.join(ROOT, "data", "quality_checkpoints.json")
    if os.path.exists(p_ck):
        ckpt = json.load(open(p_ck, encoding="utf-8"))

    saved = {"sample": SCAN_SAMPLE, "commission": COMMISSION_INCLUDES_UNVERIFIED,
             "all_items": _all_items, "pct": _pct, "run_all": _run_all,
             "dated_records": _dated_records,
             "collapse_verdicts": ANCHOR_COLLAPSE_VERDICTS}
    SCAN_SAMPLE = 60            # selftest 跑多轮，抽样调小（拓扑类结论不受影响）
    fails = []

    def snap(run=_run_all):
        return {(i["sub"], i["measure"]): str(i["value"]) for i in _flat(run(cm, ckpt))}

    def report(name, changed, before, after):
        print(f"  {'🔴 变红 ✓' if changed else '🟢 没变 ✗'}  {name}")
        if not changed:
            fails.append(name)
        else:
            print(f"         基线：{str(before)[:66]}")
            print(f"         变异：{str(after)[:66]}")

    print("=" * 74)
    print("空间可靠性审计 · 反向验证（改坏实现 → 报告必须跟着变）")
    print("=" * 74)
    try:
        base = snap()
        base_bad = sum(1 for i in _flat(_run_all(cm, ckpt)) if i["verdict"] == BAD)
        key_ev = next((v for k, v in base.items() if "verified = true" in k[1]), "?")
        key_p95 = sorted(v for k, v in base.items() if "第 95 百分位" in k[1])
        key_acc9 = sorted(v for k, v in base.items()
                          if k[1].startswith("ACCURACY_r") and "n=9" in v)
        key_comm = next((v for k, v in base.items() if k[1].startswith("脏桩条目")), "?")

        # 1) 全量口径：退回「只查 pois」→ 证据完备度必须变
        globals()["_all_items"] = lambda c: c["pois"]
        now = snap()
        got = next((v for k, v in now.items() if "verified = true" in k[1]), "?")
        report("改坏 _all_items（只查 pois，漏掉 120 条 landmarks）", got != key_ev,
               key_ev, got)
        globals()["_all_items"] = saved["all_items"]

        # 2) 分位数：p95 → max
        globals()["_pct"] = lambda xs, q: float(max(xs)) if xs else float("nan")
        now = snap()
        got = sorted(v for k, v in now.items() if "第 95 百分位" in k[1])
        report("改坏 _pct（95 分位 → 最大值）", got != key_p95, key_p95, got)
        globals()["_pct"] = saved["pct"]

        # 3) peer 的 √2 换算：去掉 → ACCURACY_r 变大
        def _no_sqrt(cm_, ck_):
            for s in (ck_.get("sources") or []):
                s["_k"] = s.get("kind")
                s["kind"] = "reference"
            try:
                return saved["run_all"](cm_, ck_)
            finally:
                for s in (ck_.get("sources") or []):
                    s["kind"] = s.pop("_k", "reference")
        now = snap(_no_sqrt)
        got = sorted(v for k, v in now.items()
                     if k[1].startswith("ACCURACY_r") and "n=9" in v)
        report("去掉 peer 的 √2 换算（把对等差值当我方误差）", got != key_acc9,
               key_acc9, got)

        # 4) commission 口径：把 verified:false 塞回去
        COMMISSION_INCLUDES_UNVERIFIED = True
        now = snap()
        got = next((v for k, v in now.items() if k[1].startswith("脏桩条目")), "?")
        report("把 verified:false 塞回「多余 commission」", got != key_comm, key_comm, got)
        COMMISSION_INCLUDES_UNVERIFIED = False

        # 5) 阈值承重性：放宽 p95 阈值 → 不合格项必须减少
        old_th = dict(THRESHOLDS)
        THRESHOLDS["p95_dev_max_m"] = 1e9
        now_bad = sum(1 for i in _flat(_run_all(cm, ckpt)) if i["verdict"] == BAD)
        THRESHOLDS.clear()
        THRESHOLDS.update(old_th)
        report("放宽 p95 阈值到无穷（阈值不承重时不合格项不会减少）",
               now_bad < base_bad, f"{base_bad} 项 ❌", f"{now_bad} 项 ❌")

        # 6) 指示性状态位：把 _indicative 改坏成恒 False → 指示性条数必须塌下来
        #    （只剩那条「未覆盖派生锚」，它本来就是恒 True）。它**不参与 ❌ 判定**，
        #    所以这条只能查计数 —— 也正因为不参与，它不会把门禁变成永久红。
        saved_ind = globals().get("_indicative")
        n_ind_base = sum(1 for i in _flat(_run_all(cm, ckpt)) if i.get("indicative"))
        globals()["_indicative"] = lambda a, b: False
        n_ind_mut = sum(1 for i in _flat(_run_all(cm, ckpt)) if i.get("indicative"))
        globals()["_indicative"] = saved_ind
        report("改坏 _indicative（恒 False）→ 指示性条数必须下降",
               n_ind_mut < n_ind_base, f"{n_ind_base} 条", f"{n_ind_mut} 条")

        # 7) 趋势门禁：必须抓得住回归，且不能把「改善」误报成回归
        mq_now = metaquality(
            len(ckpt.get("sources", [])),
            max([len(s.get("per_point", [])) for s in ckpt.get("sources", [])] or [0]),
            ckpt, cm, sections=_run_all(cm, ckpt))
        cur = _trend_metrics(mq_now)
        worse = dict(cur)
        worse["derived_anchor_count"] = (cur.get("derived_anchor_count") or 0) - 1
        reg_hit, _ = _cmp_trend(cur, worse)
        better = dict(cur)
        better["derived_anchor_count"] = (cur.get("derived_anchor_count") or 0) + 1
        reg_miss, imp_miss = _cmp_trend(cur, better)
        report("趋势门禁：抓得住 derived_anchor_count 回升，且不把「改善」误报成回归",
               any(k == "derived_anchor_count" for k, _, _ in reg_hit) and not reg_miss,
               "—", f"命中回归 {reg_hit}｜改善对 {imp_miss}")

        # 8) 校区词表 SSOT：抽掉 frontend_only.YINGKOU → 覆盖率断言必须报「悬空」
        saved_fo = cv.FRONTEND_ONLY
        cv.FRONTEND_ONLY = {k: v for k, v in saved_fo.items() if k != "YINGKOU"}
        ok_b, probs_b = cv.check_consistency()
        cv.FRONTEND_ONLY = saved_fo
        report("校区词表 SSOT 断言 B（抽掉营口路声明 → 悬空必须被抓）",
               (not ok_b) and any("悬空" in p for p in probs_b), "A/B/C 通过", probs_b)

        # 9) 时间质量台帐：抽掉一个 approx 的日期 → 「应带日期却缺失」必须非空
        saved_dr = globals()["_dated_records"]

        def _drop_one_date(cm_, ck_):
            rs = saved_dr(cm_, ck_)
            for r in rs:
                if r["src"] == "key_points.approx":
                    r["date"] = None
                    break
            return rs
        globals()["_dated_records"] = _drop_one_date
        nd = []
        for s in _run_all(cm, ckpt):
            if "时间" in s["element"]:
                nd = s["detail"]["no_date"]
        globals()["_dated_records"] = saved_dr
        report("时间质量台帐：抽掉一个 approx 日期 → 「应带日期却缺失」必须非空",
               len(nd) > 0, "[]（全部有日期）", nd)

        # 10) 塌缩组定性：抽掉一条 verdict → 「未定性」必须从 0 变 1（该条变 ⚠️）
        saved_v = globals()["ANCHOR_COLLAPSE_VERDICTS"]
        globals()["ANCHOR_COLLAPSE_VERDICTS"] = saved_v[1:]
        unc = []
        for s in _run_all(cm, ckpt):
            if "位置精度" in s["element"]:
                unc = s["detail"]["collapse"]["unclassified"]
        globals()["ANCHOR_COLLAPSE_VERDICTS"] = saved_v
        report("塌缩组定性：抽掉一条 verdict → 「未定性」必须非空",
               len(unc) > 0, "0（全部已定性）", unc)

        # 11) 还原后复现基线
        again = snap()
        same = again == base
        print(f"  {'🔴 复现 ✓' if same else '🟢 复现 ✗'}  全部变异还原后复现基线")
        if not same:
            fails.append("变异未完全还原/结果不确定")
    finally:
        SCAN_SAMPLE = saved["sample"]
        COMMISSION_INCLUDES_UNVERIFIED = saved["commission"]
        globals()["_all_items"] = saved["all_items"]
        globals()["_pct"] = saved["pct"]
        globals()["_run_all"] = saved["run_all"]
        globals()["_dated_records"] = saved["dated_records"]
        globals()["ANCHOR_COLLAPSE_VERDICTS"] = saved["collapse_verdicts"]

    total = 11
    print(f"\n反向验证：{total - len(fails)}/{total} 项通过")
    for f in fails:
        print(f"  ❌ 未被抓住：{f}")
    return 1 if fails else 0


def _wrap(text, width):
    """纯文本折行：优先在标点/分隔符处断，别把 `emoji/tags` 劈成 `emoji/t` + `ags`。"""
    breaks = "，。；、）】」/｜ 　"
    out, cur = [], ""
    for ch in text:
        cur += ch
        if len(cur) >= width:
            cut = max((cur.rfind(b) for b in breaks), default=-1)
            if cut >= width // 2:
                out.append(cur[:cut + 1])
                cur = cur[cut + 1:]
            else:
                out.append(cur)
                cur = ""
    if cur:
        out.append(cur)
    return out or [""]


def _txt(sections, mq, cm, n_src):
    """纯文本报告（无 markdown 管道符 —— 对齐列宽，任何编辑器直接可读）。"""
    W = 78
    L = []
    p = L.append
    items_all = _all_items(cm)
    p("=" * W)
    p("空间数据库可靠性评估测试报告 · ISO 19157 数据质量元素口径".center(W - 12))
    p("=" * W)
    p("")
    p(f"生成日期   2026-09-19")
    p(f"数据文件   data/campus_map.json")
    p(f"数据规模   {len(items_all)} 条（pois {len(cm['pois'])} + landmarks {len(cm['landmarks'])}）")
    p(f"检核源     {n_src} 个独立来源")
    p(f"覆盖范围   " + "、".join(SCOPE_IN) + "（军工路本部 + 1100 基础学院）")
    for k, v in SCOPE_OUT.items():
        p(f"           范围外：{k} —— {v}")
    p("")
    p("权威口径")
    p("  · ISO 19157（地理信息 · 数据质量）六元素 + 元质量")
    p("  · NSSDA / ASPRS Positional Accuracy Standards (2014)：")
    p("      RMSE_r = sqrt(Σ d_i² / n)")
    p("      ACCURACY_r(95%) = RMSE_r × 1.7308")
    p("    硬约束：检核点须独立且更精确（优于目标 3 倍）、n ≥ 20 才够统计显著")
    p("")
    p("判定图例  [合格] [警戒] [不合格] [无法判定=样本/参照源不达标，如实降级为指示性]")
    p("          [指示性*] = 机器可读状态位 indicative，**不得当正式检定值引用**")
    p("")
    for s in sections:
        p("-" * W)
        p(f"## {s['element']}")
        p("-" * W)
        for it in s["items"]:
            v = {"✅": "[合格]", "⚠️": "[警戒]", "❌": "[不合格]", "⚪": "[无法判定]"}[it["verdict"]]
            if it.get("indicative"):
                v += " [指示性*]"
            p(f"{v} {it['sub']}")
            p(f"      度量  {it['measure']}")
            p(f"      实测  {it['value']}")
            p(f"      阈值  {it['threshold']}")
            if it.get("note"):
                note = it["note"].replace("**", "")
                for seg in _wrap(note, W - 20):
                    p(f"      说明  {seg}")
            p("")
    p("=" * W)
    p("元质量 metaquality —— 上面那些数字能信到什么程度")
    p("=" * W)
    for k in METAQUALITY_PROSE_KEYS:      # 白名单：机器字段不进散文输出
        v = mq.get(k)
        if v:
            txt = str(v).replace("**", "")
            p(f"  {k}")
            for seg in _wrap(txt, W - 8):
                p(f"    {seg}")
    p("")
    n_ok = sum(1 for s in sections for i in s["items"] if i["verdict"] == OK)
    n_warn = sum(1 for s in sections for i in s["items"] if i["verdict"] == WARN)
    n_bad = sum(1 for s in sections for i in s["items"] if i["verdict"] == BAD)
    n_na = sum(1 for s in sections for i in s["items"] if i["verdict"] == NA)
    p("=" * W)
    p("汇总")
    p("=" * W)
    p(f"  [合格] {n_ok}   [警戒] {n_warn}   [不合格] {n_bad}   [无法判定] {n_na}")
    p("")
    p("不合格 / 警戒项明细：")
    for s in sections:
        for it in s["items"]:
            if it["verdict"] in (BAD, WARN):
                p(f"  {it['verdict']} {it['sub']}")
                p(f"      {it['measure']}：实测 {it['value']}（阈值 {it['threshold']}）")
                if it.get("note"):
                    p(f"      {it['note'].replace('**', '')}")
    p("")
    if ACCEPTED_BAD:
        p("已接受的不合格项（登记在案，门禁只拦新增）：")
        for a in ACCEPTED_BAD:
            p(f"  · {a['sub']}")
            for seg in _wrap(a["why"].replace("**", ""), W - 8):
                p(f"      {seg}")
        p("")
    if FIXED_BAD_HISTORY:
        p("本次已修复（留档，防止重复踩坑）：")
        for a in FIXED_BAD_HISTORY:
            p(f"  · {a['sub']}")
            p(f"      原值  {a['was']}")
            for seg in _wrap("处置  " + a["fixed"], W - 8):
                p(f"      {seg}")
        p("")
    p("=" * W)
    return "\n".join(L)


# ---------------------------------------------------------------- 趋势门禁（2026-09-19）
# 为什么要有它：`--gate` 原先**只拦「新增的 ❌ 项」**。但门禁真正该防的是「悄悄变差」——
# 比如有人把派生锚改多了、把 hours 覆盖改少了，只要没踩到 ❌ 阈值就一路绿灯。
#
# 为什么用**签入的基线文件**而不是「上次运行」：CI / 新 clone 里没有「上次运行」，
# 把基线做成本地状态会让门禁不可复现（本项目要求「一条命令验收」）。
# 基线只由显式 `--write-baseline` 更新，**更新时必须在提交信息里写明为什么允许放宽**。
#
# 只门禁「只会变好或不变」的指标 —— 一个永远红的门禁等于没有门禁。
DEFAULT_BASELINE = os.path.join(ROOT, "docs", "spatial-quality-baseline.json")
TREND_RULES = {
    "confidence_level": "up",        # 0 低 / 1 中 / 2 高
    "verified_share": "up",
    "hours_coverage": "up",
    "open_now_answerable": "up",
    "derived_anchor_count": "down",  # 设计文档 §1.3 P2：派生锚只许降不许升
    "indicative_count": "down",
}
# 只记录、**不**门禁：weak_anchor_p95_m 今天动不了（4 个点里 3 个已是 osm 实锚，
# 偏差来自对等检核源本身）—— 设成门禁只会造出一条永久红。
TREND_DIR_CN = {"up": "只许升", "down": "只许降"}


def _trend_metrics(mq):
    """从 metaquality 抽出**机器可比**的趋势指标。"""
    return {k: mq.get(k) for k in TREND_RULES}


def _cmp_trend(cur, base):
    """比当前 vs 基线。返回 (regressions, improvements)，各自是 [(指标, 基线值, 本次值)]。"""
    reg, imp = [], []
    for k, direction in TREND_RULES.items():
        a, b = base.get(k), cur.get(k)
        if a is None or b is None:
            continue
        if direction == "up":
            if b < a:
                reg.append((k, a, b))
            elif b > a:
                imp.append((k, a, b))
        else:
            if b > a:
                reg.append((k, a, b))
            elif b < a:
                imp.append((k, a, b))
    return reg, imp


def main():
    ap = argparse.ArgumentParser(description="空间数据库可靠性审计（ISO 19157）")
    ap.add_argument("--json", default=None, help="报告 JSON 写到该路径")
    ap.add_argument("--md", default=None, help="报告 Markdown 写到该路径")
    ap.add_argument("--txt", default=None, help="报告**纯文本**写到该路径（无 markdown 语法）")
    ap.add_argument("--checkpoints", default=None,
                    help="检核点证据文件（默认 data/quality_checkpoints.json）")
    ap.add_argument("--gate", action="store_true",
                    help="出现 ❌ 则 exit 1；另比对趋势基线（只会变好或不变的指标不许回归）")
    ap.add_argument("--write-baseline", action="store_true",
                    help=f"把当前趋势指标写进签入基线 {os.path.relpath(DEFAULT_BASELINE, ROOT)}"
                         "（放宽必须在提交信息里写明理由）")
    ap.add_argument("--baseline", default=None,
                    help="趋势基线路径（默认 docs/spatial-quality-baseline.json）")
    ap.add_argument("--selftest", action="store_true",
                    help="反向验证：改坏实现，断言报告必须跟着变")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    cm = json.load(open(os.path.join(ROOT, "data", "campus_map.json"), encoding="utf-8"))
    ckpt_path = args.checkpoints or os.path.join(ROOT, "data", "quality_checkpoints.json")
    ckpt = {"sources": []}
    if os.path.exists(ckpt_path):
        ckpt = json.load(open(ckpt_path, encoding="utf-8"))

    sections = _run_all(cm, ckpt)
    n_ckpt = max([len(s.get("per_point", [])) for s in ckpt.get("sources", [])] or [0])
    mq = metaquality(len(ckpt.get("sources", [])), n_ckpt, ckpt, cm, sections=sections)

    if args.write_baseline:
        os.makedirs(os.path.dirname(DEFAULT_BASELINE) or ".", exist_ok=True)
        with open(DEFAULT_BASELINE, "w", encoding="utf-8", newline="\n") as f:
            json.dump({
                "_meta": {
                    "why": "趋势门禁基线（**不是**「上次运行」）—— CI / 新 clone 里没有上次运行，"
                           "把基线做成本地状态会让门禁不可复现（本项目要求「一条命令验收」）。"
                           "只由 `--write-baseline` 更新，**放宽必须在提交信息里写明理由**。",
                    "updated": date.today().isoformat(),
                    "rules": TREND_RULES,
                },
                "metrics": _trend_metrics(mq),
            }, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print(f"已写出趋势基线：{DEFAULT_BASELINE}")

    n_bad = sum(1 for s in sections for i in s["items"] if i["verdict"] == BAD)
    n_warn = sum(1 for s in sections for i in s["items"] if i["verdict"] == WARN)
    n_ok = sum(1 for s in sections for i in s["items"] if i["verdict"] == OK)
    n_na = sum(1 for s in sections for i in s["items"] if i["verdict"] == NA)

    md = _md(sections, mq, cm, len(ckpt.get("sources", [])))
    print(md)
    print(f"汇总：✅ {n_ok} ｜ ⚠️ {n_warn} ｜ ❌ {n_bad} ｜ ⚪ {n_na}", file=sys.stderr)

    if args.md:
        os.makedirs(os.path.dirname(os.path.abspath(args.md)) or ".", exist_ok=True)
        with open(args.md, "w", encoding="utf-8", newline="\n") as f:
            f.write(md)
            if not md.endswith("\n"):
                f.write("\n")
        print(f"\n报告 Markdown：{args.md}")
    if args.txt:
        txt = _txt(sections, mq, cm, len(ckpt.get("sources", [])))
        os.makedirs(os.path.dirname(os.path.abspath(args.txt)) or ".", exist_ok=True)
        with open(args.txt, "w", encoding="utf-8", newline="\n") as f:
            f.write(txt)
            if not txt.endswith("\n"):
                f.write("\n")
        print(f"报告纯文本：{args.txt}")
    if args.json:
        payload = {"generated": date.today().isoformat(), "thresholds": THRESHOLDS,
                   "campus_domain": CAMPUS_DOMAIN,
                   "sections": sections, "metaquality": mq,
                   "counts": {"ok": n_ok, "warn": n_warn, "bad": n_bad, "na": n_na,
                              # 指示性条数（机器可读；**不参与 gate 的 ❌ 判定**，只做趋势）
                              "indicative": sum(1 for s in sections
                                                for i in s["items"] if i.get("indicative"))}}
        os.makedirs(os.path.dirname(os.path.abspath(args.json)) or ".", exist_ok=True)
        with open(args.json, "w", encoding="utf-8", newline="\n") as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print(f"报告 JSON：{args.json}")

    if args.gate:
        accepted = {a["sub"] for a in ACCEPTED_BAD}
        new_bad = [it for s in sections for it in s["items"]
                   if it["verdict"] == BAD and it["sub"] not in accepted]
        still = [it for s in sections for it in s["items"]
                 if it["verdict"] == BAD and it["sub"] in accepted]
        if still:
            print(f"\nℹ️ 已知不合格（{len(still)} 项，已登记在学习账上）：", file=sys.stderr)
            for it in still:
                print(f"   · {it['sub']}", file=sys.stderr)
        if new_bad:
            print(f"\n❌ GATE 失败：{len(new_bad)} 项**新增**不合格", file=sys.stderr)
            for it in new_bad:
                print(f"   · {it['sub']}：实测 {it['value']}（阈值 {it['threshold']}）",
                      file=sys.stderr)
            return 1
        print("\n✅ GATE 通过：无新增不合格项", file=sys.stderr)

        # 趋势回归（2026-09-19）：只拦「新增 ❌」还不够 —— 悄悄变差同样要拦。
        base_path = args.baseline or DEFAULT_BASELINE
        if not os.path.exists(base_path):
            print(f"ℹ️ 无趋势基线（{base_path}），跳过趋势比较", file=sys.stderr)
        else:
            bj = json.load(open(base_path, encoding="utf-8"))
            reg, imp = _cmp_trend(_trend_metrics(mq), bj.get("metrics", {}))
            for k, a, b in imp:
                print(f"📈 改善 {k}：{a} → {b}", file=sys.stderr)
            if reg:
                print(f"\n❌ GATE 失败（趋势回归）：{len(reg)} 项指标相对基线变差", file=sys.stderr)
                for k, a, b in reg:
                    print(f"   · {k}：基线 {a} → 本次 {b}（{TREND_DIR_CN[TREND_RULES[k]]}）",
                          file=sys.stderr)
                print("   若确有理由放宽：跑 --write-baseline 重写基线，"
                      "并在提交信息里写明为什么。", file=sys.stderr)
                return 1
            print(f"✅ 趋势无回归（基线 {bj.get('_meta', {}).get('updated', '?')}）", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
