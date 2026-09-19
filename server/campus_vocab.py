# -*- coding: utf-8 -*-
"""校区词表的 Python 侧读取器 —— 只读 `data/campus_vocab.json`，不持有任何自己的副本。

为什么要有这个模块（2026-09-19）：
    同一个「校区」概念此前在四处各写一遍、彼此零校验，后果**不是报错而是静默算错**：
    `campus.py::_CAMPUS_CN`｜`campus_network.py::_WALK_GROUP`｜
    `src/constants/campus.ts::CampusId`｜`src/lib/planner/templates.ts::CampusName`。
    典型活样本：`scheduler.test.ts` 断言 `campusOfPlace('第四食堂') === 'JG334'`，
    而 `data/campus_map.json` 与 `test_campus.py` 都说是 `1100` —— **两套测试同时是绿的**。

设计（见 data/campus_vocab.json 的 `_meta.how`）：
    Python 运行时导入本模块；TS 侧保持硬编码（places.ts 明令不 import JSON），
    由 `tests/campus-vocab.test.ts` 读同一份 JSON 逐条比对 —— 镜像被机器校验。
"""
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_PATH = os.path.join(_HERE, os.pardir, "data", "campus_vocab.json")

with open(_PATH, encoding="utf-8") as _f:
    VOCAB = json.load(_f)

CODES = VOCAB["codes"]                  # 后端 campus 值域 → 元数据
FRONTEND_ONLY = VOCAB["frontend_only"]  # 无后端对应码的 CampusId
FRONTEND_IDS = VOCAB["frontend_ids"]    # 前端 CampusId 全集

# 码 → 中文全称（原 campus.py::_CAMPUS_CN）
CN = {code: v["cn"] for code, v in CODES.items()}

# 码 → 值域说明（原 audit_spatial_quality.py::CAMPUS_DOMAIN）
CAMPUS_DOMAIN = {code: v["domain_note"] for code, v in CODES.items()}

# 码 → 可步行分组（原 campus_network.py::_WALK_GROUP）。
# ⚠️ 这里是**全量**映射（含 1100/复兴路 → 各自独立分组），
#    与旧实现的区别只是把「dict 缺省回落到码本身」显式写了出来，行为完全一致。
WALK_GROUP = {code: v["walk_group"] for code, v in CODES.items()}

# 码 → 前端 CampusId（`campusFromLabel(label)` 的口径）
LABEL_TO_ID = {code: v["label_to_id"] for code, v in CODES.items()}

# 范围声明
SCOPE_IN = tuple(code for code, v in CODES.items() if v["in_scope"])
SCOPE_OUT = {code: v["out_reason"] for code, v in CODES.items() if not v["in_scope"]}


def check_consistency():
    """词表自身的三条不变式（规格见 docs/spatial-optimization-2026-09-19.txt §3.3）。

    返回 (ok: bool, problems: list[str])。

    ⚠️ **这里能查什么、不能查什么（踩过一次坑，记下来）**：
        本模块**不能**验证「运行时模块是否真的用了 SSOT」—— 那需要 import
        `campus` / `campus_network`，而它们反过来 import 本模块（会成环）。
        更早的一版把 C 写成「WALK_GROUP 是否与 CODES 同构」，那是**同义反复**：
        WALK_GROUP 本身就是从 CODES 派生的，怎么改都同构 ⇒ **永远绿**，
        属于本项目已抓到多次的「假覆盖」。反向验证逮住了它（改坏 walk_group 不变红）。
        真正的「有没有被重新硬编码」由 `scripts/audit_spatial_quality.py` 的 C 断言守：
        它同时能 import 两端，查的是「对象是不是同一个」+「运行时函数与词表是否逐条一致」。

    本函数只做**文件内部**就能判定的事：
      A. 每个 `label_to_id` 必须是前端认识的 CampusId
      B. 「后端映射 ∪ 前端独有」必须完整覆盖前端 CampusId 全集（抓悬空，如营口路）
      C. 声明完备性：每个码必须声明 walk_group；范围外的必须写明 out_nature/out_reason
    """
    problems = []

    # A. 每个 label_to_id 必须是前端认识的 CampusId
    unknown = sorted({i for i in LABEL_TO_ID.values() if i not in FRONTEND_IDS})
    if unknown:
        problems.append(f"A 后端映射指向了前端不存在的 CampusId：{unknown}")

    # B. 前端所有 CampusId 必须被「后端映射 ∪ 前端独有」完整覆盖
    covered = set(LABEL_TO_ID.values()) | set(FRONTEND_ONLY)
    missing = sorted(set(FRONTEND_IDS) - covered)
    extra = sorted(covered - set(FRONTEND_IDS))
    if missing:
        problems.append(f"B 悬空的 CampusId（既无后端映射、也未声明）：{missing}")
    if extra:
        problems.append(f"B 声明了前端不存在的 CampusId：{extra}")

    # C. 声明完备性（不是同义反复：这些字段缺失是真的会让下游拿不到口径）
    for code, v in CODES.items():
        if not v.get("walk_group"):
            problems.append(f"C 码『{code}』没有声明可步行分组")
        if not v.get("label_to_id"):
            problems.append(f"C 码『{code}』没有声明前端映射")
    for code, v in CODES.items():
        if not v["in_scope"] and not v.get("out_reason"):
            problems.append(f"C 范围外的『{code}』没有写 out_reason（声明即已管理，理由必须留痕）")
    for fid, v in FRONTEND_ONLY.items():
        if not v.get("nature") or not v.get("out_reason"):
            problems.append(f"C 前端独有的『{fid}』缺 nature/out_reason")

    return (not problems), problems


def module_drift(backend_cn, network_walk_group, walk_group_fn):
    """运行时漂移检查（**只能在能同时 import 两端的脚本里调用**，见上面的坑说明）。

    传进来而不是 import：避免 `campus_vocab ← campus_network ← campus_vocab` 成环。

      · `backend_cn`          = campus._CAMPUS_CN
      · `network_walk_group`  = campus_network._WALK_GROUP
      · `walk_group_fn`       = campus_network.walk_group

    查的是「有没有人又硬编码了一份」——用 `is`（同一对象），不是 `==`。
    反向验证：把 campus_network.py 的 `_WALK_GROUP = _vocab.WALK_GROUP`
    改回字面量字典 → 本检查必红。
    """
    problems = []
    if backend_cn is not CN:
        problems.append("C campus._CAMPUS_CN 不是 SSOT 对象（有人又复制了一份？）")
    if network_walk_group is not WALK_GROUP:
        problems.append("C campus_network._WALK_GROUP 不是 SSOT 对象（有人又复制了一份？）")
    for code in CODES:
        got = walk_group_fn(code)
        if got != CODES[code]["walk_group"]:
            problems.append(
                f"C 运行时 walk_group('{code}') = {got}，词表声明 {CODES[code]['walk_group']}")
    return problems


if __name__ == "__main__":
    ok, probs = check_consistency()
    print("✅ 校区词表自洽（A/B/C 三条断言通过）" if ok else "❌ 校区词表不一致：")
    for p in probs:
        print("   ·", p)
    raise SystemExit(0 if ok else 1)
