# -*- coding: utf-8 -*-
"""
R批 Wave3（H2）· 后端日程复核 —— /api/plan/review 的纯逻辑层
=============================================================
H1 是纯前端评估（阈值来自编译期 kbParams，EvalBasis.tier 是本地查静态表）。
本模块把**库检**搬到后端：对每个维度调健康库 / 方法库的真检索，给每条建议
配上 source（库名 + slug + tier + 引用原文）——tier 不再是本地静态表查出来的，
而是检索命中的知识库条目自带的证据等级。

── 设计要点 ─────────────────────────────────────────────────────────────
1. **数值判定在前端 digest 里已经算好**（moderateMin 等是摘要事实），本模块
   只做「事实 vs 阈值」的比较与组织 —— 不在前端/后端各写一套块分类启发式
   （那是双轨问题的翻版）。阈值数值镜像编译期 kbParams（注释指向库条目），
   引用原文（quote）则**运行时从库里检索**，检索不到才回退静态文案并标
   `retrieved: false`。
2. **检索失败不报错**：库缺失 / 检索异常 → 该维度 source 降级为静态口径并
   标 `retrieved: false`，findings 照出（判定不依赖检索）。
3. **unknown 语义与前端一致**：digest 事实 `confident=false` → 该规则 unknown，
   绝不冒充 0 分。
4. **只建议不改日程**（L4 边界）：输出 findings + advice，采纳走前端既有草稿流。
"""
import datetime

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

# ------------------------------------------------------------------
# 阈值表：数值与编译期 kbParams（src/data/*Params.generated.ts）同源，
# 每条带库条目 slug —— quote 运行时检索，检索不到回退这里的静态文案。
# ------------------------------------------------------------------
RULES = [
    # —— 运动（健康库 exercise 域）——
    {"id": "aerobic-150", "dim": "exercise", "lib": "健康库", "slug": "aerobic-150", "tier": "A",
     "quote": "每周中高强度有氧 ≥150 分钟（或高强度 ≥75 分钟）", "kind": "aerobic"},
    {"id": "strength-2days", "dim": "exercise", "lib": "健康库", "slug": "strength-2days", "tier": "A",
     "quote": "力量训练 ≥2 天/周", "kind": "min", "fact": "strengthDays", "target": 2},
    # —— 睡眠（健康库 sleep 域）——
    {"id": "sleep-duration-adult", "dim": "sleep", "lib": "健康库", "slug": "sleep-duration-adult", "tier": "A",
     "quote": "成年人每晚睡眠机会 7-9 小时", "kind": "range", "fact": "sleepOpportunityHours",
     "lo": 7, "hi": 9, "floor": 7},
    {"id": "sleep-regularity", "dim": "sleep", "lib": "健康库", "slug": "sleep-regularity", "tier": "B",
     "quote": "作息规律：不晚于自己设定的就寝", "kind": "zero",
     "fact": "bedtimeConflictDays",
     "zero_ok": "每天收尾都在你设置的就寝之前", "zero_bad": "排到了你设置的就寝之后"},
    # —— 饮食（健康库 nutrition 域）——
    {"id": "regular-meals-breakfast", "dim": "nutrition", "lib": "健康库", "slug": "regular-meals-breakfast", "tier": "A",
     "quote": "规律三餐（日程里以用餐块天数为上限代理）", "kind": "min", "fact": "mealDays", "target": 5},
    # —— 学习（方法库）——
    {"id": "ultradian-rhythm", "dim": "study", "lib": "方法库", "slug": "ultradian-rhythm", "tier": "C",
     "quote": "单次深度工作 ≤90 分钟", "kind": "zero", "fact": "overlongStudyBlocks",
     "zero_ok": "没有超长学习块", "zero_bad": "个超过 90 分钟的学习块"},
    {"id": "spacing-effect", "dim": "study", "lib": "方法库", "slug": "spacing-effect", "tier": "A",
     "quote": "分散复习优于集中突击（复习类排程覆盖天数）", "kind": "min_soft", "fact": "reviewDays", "target": 2},
]

_DIM_LABEL = {"exercise": "运动", "sleep": "睡眠", "nutrition": "饮食", "study": "学习", "growth": "成长"}

# 检索 query：每维度一条（后端库里真搜，命中条目的 title/tier 作为 source）
_DIM_QUERY = {
    "exercise": ("健康库", "每周中高强度有氧运动 力量 分钟"),
    "sleep": ("健康库", "睡眠时长 作息规律 就寝"),
    "nutrition": ("健康库", "规律三餐 早餐"),
    "study": ("方法库", "分散复习 深度工作 单次时长"),
    "growth": ("方法库", "习惯养成 目标 时间线"),
}

# 任务骨架（task）只描述「采纳后加什么块」；weeks 由 review_plan 按被评周回填。
# 没有 action 的建议（睡眠类=要挪不要加、超长块=要拆不要加）→ 前端不出采纳按钮。
_ADVICE = {
    "aerobic-150": {"text": "每周再补 1-2 次 30 分钟以上的有氧（快走/慢跑都算）",
                    "action": {"kind": "add_task", "task": {"title": "有氧锻炼", "kind": "activity", "durationMin": 45}}},
    "strength-2days": {"text": "每周补 2 天力量练习（自重/器械均可，隔 48 小时）",
                       "action": {"kind": "add_task", "task": {"title": "力量训练", "kind": "activity", "durationMin": 45}}},
    "sleep-duration-adult": {"text": "把最后一件事提前，给睡眠机会留足 7 小时以上"},
    "sleep-regularity": {"text": "对照「我的作息」里设置的就寝收尾；排不开就让我按新节奏重排"},
    "regular-meals-breakfast": {"text": "把没排到用餐的日子补上三餐块（食堂时段可从地点库看）",
                                "action": {"kind": "add_task", "task": {"title": "用餐", "kind": "meal", "durationMin": 30}}},
    "ultradian-rhythm": {"text": "把超长学习块拆成 ≤90 分钟的两段，中间休息"},
    "spacing-effect": {"text": "把集中复习拆成每周 2-3 次的分散安排（间隔效应，A 级）",
                       "action": {"kind": "add_task", "task": {"title": "复习", "kind": "study", "durationMin": 45}},
                       "multi": True},
}


def _fact(digest, key):
    """digest 事实统一读取：缺键 = unknown（不冒充 0）。"""
    f = (digest or {}).get(key)
    if not isinstance(f, dict) or "value" not in f:
        return {"value": None, "confident": False, "evidence": []}
    return {
        "value": f.get("value"),
        "confident": bool(f.get("confident")),
        "evidence": [str(x) for x in (f.get("evidence") or [])][:10],
    }


# ------------------------------------------------------------------
# 三库检索（惰性导入 + 全异常兜底：库缺失 = 降级，不崩）
# ------------------------------------------------------------------
_RETRIEVERS = None


def _retrievers():
    """按需加载健康库 / 方法库检索器（sys.path 约定由 app.py / 测试保证）。"""
    global _RETRIEVERS
    if _RETRIEVERS is None:
        import health_rag  # noqa: E402
        import method_rag  # noqa: E402
        _RETRIEVERS = {"健康库": health_rag, "方法库": method_rag}
    return _RETRIEVERS


def retrieve(query, lib, k=2):
    """真检索：返回 [{slug, title, tier, snippet}]；失败返回 []（调用方降级）。"""
    try:
        mod = _retrievers()[lib]
        rs = mod.search(query, k)
        out = []
        for r in (rs or [])[:k]:
            if not isinstance(r, dict):
                continue
            out.append({
                "slug": r.get("slug") or r.get("id") or "",
                "title": r.get("title") or "",
                "tier": r.get("evidence_tier") or r.get("tier") or "",
                "snippet": (r.get("summary") or "")[:120],
            })
        return out
    except Exception as e:  # 库缺失 / 索引损坏 / 任何异常 → 降级
        print("[plan_review] 检索降级（%s）：%s" % (lib, e))
        return []


def _source(rule, hits):
    """规则的 source：检索命中同 slug / 同库条目 → 用库里的 tier+title（真检索）；
    否则回退规则表静态口径并标 retrieved=False。"""
    for h in hits:
        if h.get("slug") and h["slug"] == rule["slug"]:
            return {"lib": rule["lib"], "slug": rule["slug"],
                    "tier": h.get("tier") or rule["tier"],
                    "quote": h.get("title") or rule["quote"], "retrieved": True}
    for h in hits:
        if h.get("title"):
            return {"lib": rule["lib"], "slug": rule["slug"],
                    "tier": h.get("tier") or rule["tier"],
                    "quote": h["title"], "retrieved": True}
    return {"lib": rule["lib"], "slug": rule["slug"], "tier": rule["tier"],
            "quote": rule["quote"], "retrieved": False}


def _static_source(rule):
    return {"lib": rule["lib"], "slug": rule["slug"], "tier": rule["tier"],
            "quote": rule["quote"], "retrieved": False}


def _stamped_action(adv, week_no, total_weeks=None, recurring=False, title=None, kind=None, duration_min=None):
    """把任务骨架回填成可执行 action：weeks=被评周（周级重复块铺到学期末）。"""
    if "action" not in adv:
        return None
    task = dict(adv["action"]["task"])
    if title:
        task["title"] = title
    if kind:
        task["kind"] = kind
    if duration_min:
        task["durationMin"] = duration_min
    if recurring:
        task["recurring"] = True
        end = total_weeks if isinstance(total_weeks, int) and total_weeks > 0 else week_no
        task["weeks"] = list(range(week_no, end + 1))
    else:
        task["weeks"] = [week_no]
    return {"kind": "add_task", "task": task}


def _ok_headline(rule, v):
    return {
        "aerobic-150": "本周中高强度有氧 %d 分钟，达标" % v,
        "strength-2days": "本周力量训练 %d 天，达标" % v,
        "sleep-duration-adult": "睡眠机会约 %.1f 小时，在建议区间" % v,
        "sleep-regularity": "每天收尾都在你设置的就寝之前",
        "regular-meals-breakfast": "%d 天有明确用餐安排" % v,
        "ultradian-rhythm": "没有超长学习块",
        "spacing-effect": "复习类安排覆盖 %d 天" % v,
    }.get(rule["id"], rule["quote"])


def _gap_headline(rule, v):
    return {
        "aerobic-150": "本周中高强度有氧 %d 分钟，低于 150" % v,
        "strength-2days": "本周力量训练 %d 天，不足 2 天" % v,
        "sleep-duration-adult": "睡眠机会只有 %.1f 小时，低于 7 小时" % v,
        "sleep-regularity": "有 %d 天排到你设置的就寝之后" % v,
        "regular-meals-breakfast": "只有 %d 天有明确用餐安排" % v,
        "ultradian-rhythm": "有 %d 个超过 90 分钟的学习块" % v,
        "spacing-effect": "复习类只覆盖 %d 天，集中突击记不牢" % v,
    }.get(rule["id"], rule["quote"])


def review_plan(digest, user_id="anon", week_no=0):
    """主入口：digest（前端摘要）→ findings + advice（每条带 source）。

    纯函数 + 检索：不写库、不改日程（L4 边界）——评估只建议，采纳走前端既有草稿流。
    """
    digest = digest or {}
    now = datetime.datetime.now().isoformat(timespec="seconds")

    # 每维度一次真检索（库缺失 → hits=[] → source 静态降级，findings 照出）
    rules = [dict(r, _source=_static_source(r)) for r in RULES]
    retrieval_ok = {}
    for dim, (lib, query) in _DIM_QUERY.items():
        hits = retrieve(query, lib)
        retrieval_ok[dim] = len(hits) > 0
        for r in rules:
            if r["dim"] == dim:
                r["_source"] = _source(r, hits)

    findings, advice = [], []

    def add(status, rule, headline, fact=None, severity="info"):
        findings.append({
            "id": rule["id"], "dim": rule["dim"], "status": status, "severity": severity,
            "headline": headline, "evidence": (fact or {}).get("evidence", []),
            "source": rule["_source"],
        })

    def judge(rule, fact, is_good, gap_headline=None, gap_severity="warn"):
        if not fact["confident"]:
            add("unknown", rule, "日程里判断不了这一项", severity="info")
            return
        if is_good(fact["value"]):
            add("good", rule, _ok_headline(rule, fact["value"]), fact)
        else:
            add("gap", rule, gap_headline or _gap_headline(rule, fact["value"]), fact, gap_severity)
            adv = _ADVICE.get(rule["id"])
            if adv:
                advice.append({"text": adv["text"], "dim": rule["dim"], "source": rule["_source"],
                               "action": _stamped_action(adv, week_no)})

    for r in rules:
        if r["kind"] == "aerobic":
            # 中强度 150 或高强度 75，二者取达标者（与前端口径一致）
            mod = _fact(digest, "moderateMin")
            vig = _fact(digest, "vigorousMin")
            if not (mod["confident"] or vig["confident"]):
                add("unknown", r, "日程里判断不了有氧运动量", severity="info")
                continue
            m = mod["value"] if mod["confident"] else 0
            v = vig["value"] if vig["confident"] else 0
            ok = m >= 150 or v >= 75
            combined = dict(mod, value=m + v, evidence=list(mod["evidence"]) + list(vig["evidence"]))
            if ok:
                add("good", r, "本周中高强度有氧 %d 分钟，达标" % (m + v), combined)
            else:
                add("gap", r, "本周中高强度有氧 %d 分钟，低于 150" % (m + v), combined)
                adv = _ADVICE[r["id"]]
                advice.append({"text": adv["text"], "dim": r["dim"], "source": r["_source"],
                               "action": _stamped_action(adv, week_no)})
        elif r["kind"] == "min":
            judge(r, _fact(digest, r["fact"]), lambda x, t=r["target"]: x >= t)
        elif r["kind"] == "min_soft":
            # 软目标：不足只是 info 级提示，不算硬 gap —— 但 advice 照给（带 action）
            f = _fact(digest, r["fact"])
            if not f["confident"]:
                add("unknown", r, "日程里判断不了这一项", severity="info")
            else:
                ok = f["value"] >= r["target"]
                add("good" if ok else "gap", r,
                    _ok_headline(r, f["value"]) if ok else _gap_headline(r, f["value"]),
                    f, severity="info")
                if not ok:
                    adv = _ADVICE[r["id"]]
                    advice.append({"text": adv["text"], "dim": r["dim"], "source": r["_source"],
                                   "action": _stamped_action(adv, week_no)})
        elif r["kind"] == "range":
            f = _fact(digest, r["fact"])
            if not f["confident"]:
                add("unknown", r, "日程里判断不了睡眠窗口", severity="info")
                continue
            lo, hi, floor = r["lo"], r["hi"], r["floor"]
            if lo <= f["value"] <= hi:
                add("good", r, _ok_headline(r, f["value"]), f)
            elif f["value"] < floor:
                add("gap", r, _gap_headline(r, f["value"]), f, severity="serious")
                adv = _ADVICE[r["id"]]
                advice.append({"text": adv["text"], "dim": r["dim"], "source": r["_source"],
                               "action": _stamped_action(adv, week_no)})
            else:
                add("good", r, "睡眠机会 %.1f 小时，偏长但不是问题" % f["value"], f)
        elif r["kind"] == "zero":
            judge(r, _fact(digest, r["fact"]),
                  lambda x: x == 0,
                  "%d " % (_fact(digest, r["fact"]).get("value") or 0) + r["zero_bad"],
                  gap_severity="warn")

    # —— 成长维度（H4 数据随 digest 一起来：habitSpans / goals）——
    growth_findings, growth_advice = [], []
    spans = digest.get("habitSpans") or []
    if spans:
        for h in spans:
            title = h.get("title") or "习惯"
            covered = h.get("weeksCovered") or 0
            total = h.get("totalWeeks")
            ratio = (covered / total) if isinstance(total, int) and total > 0 else None
            src = next((r["_source"] for r in rules if r["slug"] == "spacing-effect"), _static_source(RULES[-1]))
            src = {"lib": "方法库", "slug": "habit-formation-loop", "tier": "B",
                   "quote": "习惯靠稳定的线索-行为-奖励循环固化", "retrieved": retrieval_ok.get("growth", False)}
            if ratio is None:
                growth_findings.append({"id": "growth-habit-%s" % title, "dim": "growth", "status": "good",
                                        "severity": "info", "headline": "「%s」是每周重复安排（覆盖 %d 周）" % (title, covered),
                                        "evidence": [], "source": src})
            else:
                pct = round(ratio * 100)
                if ratio >= 0.8:
                    growth_findings.append({"id": "growth-habit-%s" % title, "dim": "growth", "status": "good",
                                            "severity": "info", "headline": "「%s」覆盖学期 %d%%（%d/%d 周）" % (title, pct, covered, total),
                                            "evidence": [], "source": src})
                else:
                    growth_findings.append({"id": "growth-habit-%s" % title, "dim": "growth",
                                            "status": "gap" if ratio < 0.5 else "good",
                                            "severity": "warn" if ratio < 0.5 else "info",
                                            "headline": "「%s」只覆盖学期的 %d%%（%d/%d 周）" % (title, pct, covered, total),
                                            "evidence": [], "source": src})
                    if ratio < 0.5:
                        growth_advice.append({"text": "习惯要整段跑道 —— 说「把「%s」延续到学期末」我就补齐" % title,
                                              "dim": "growth", "source": src,
                                              "action": _stamped_action(
                                                  {"action": {"kind": "add_task",
                                                              "task": {"title": title, "kind": "activity", "durationMin": 30}}},
                                                  week_no, total_weeks=total, recurring=True)})
    else:
        growth_findings.append({"id": "growth-habit-unknown", "dim": "growth", "status": "unknown",
                                "severity": "info", "headline": "还没有长期重复的安排", "evidence": [],
                                "source": _static_source({"lib": "方法库", "slug": "habit-formation-loop",
                                                          "tier": "B", "quote": "习惯形成循环"})})
    for g in (digest.get("goals") or []):
        title = g.get("title") or ""
        if not title:
            continue
        left = g.get("weeksLeft")
        related = g.get("relatedBlocks") or 0
        src = {"lib": "方法库", "slug": "mcm-3day-timeline", "tier": "D",
               "quote": "先搭时间线再铺块", "retrieved": retrieval_ok.get("growth", False)}
        if related > 0:
            left_txt = ("还有约 %d 周" % left) if left is not None else "未设截止"
            growth_findings.append({"id": "growth-goal-%s" % title, "dim": "growth", "status": "good",
                                    "severity": "info", "headline": "目标「%s」%s，本周排了 %d 个相关块" % (title, left_txt, related),
                                    "evidence": [], "source": src})
        elif left is not None and left <= 6:
            growth_findings.append({"id": "growth-goal-%s" % title, "dim": "growth", "status": "gap",
                                    "severity": "serious" if left <= 2 else "warn",
                                    "headline": "目标「%s」还有约 %d 周到期，本周没有相关安排" % (title, left),
                                    "evidence": [], "source": src})
            growth_advice.append({"text": "说「帮我排「%s」」，我把准备块铺进接下来的周" % title,
                                  "dim": "growth", "source": src,
                                  "action": _stamped_action(
                                      {"action": {"kind": "add_task",
                                                  "task": {"title": title, "kind": "study", "durationMin": 60}}},
                                      week_no)})
        else:
            growth_findings.append({"id": "growth-goal-%s" % title, "dim": "growth", "status": "unknown",
                                    "severity": "info", "headline": "目标「%s」本周暂无相关安排（不等于没推进）" % title,
                                    "evidence": [], "source": src})
    if not (spans or digest.get("goals")):
        growth_findings.append({"id": "growth-goal-unknown", "dim": "growth", "status": "unknown",
                                "severity": "info", "headline": "目标页还没有目标", "evidence": [],
                                "source": _static_source({"lib": "方法库", "slug": "mcm-3day-timeline",
                                                          "tier": "D", "quote": "先搭时间线再铺块"})})

    dims = {}
    for f in findings + growth_findings:
        d = dims.setdefault(f["dim"], {"key": f["dim"], "label": _DIM_LABEL.get(f["dim"], f["dim"]),
                                       "findings": [], "advice": []})
        d["findings"].append(f)
    for a in advice + growth_advice:
        dims.setdefault(a["dim"], {"key": a["dim"], "label": _DIM_LABEL.get(a["dim"], a["dim"]),
                                   "findings": [], "advice": []})["advice"].append(a)  # 整条透传（含 action/dim）
    for d in dims.values():
        known = [f for f in d["findings"] if f["status"] != "unknown"]
        d["coverage"] = round(len(known) / max(1, len(d["findings"])), 2)

    return {
        "ok": True,
        "user_id": user_id,
        "week_no": week_no,
        "generated_at": now,
        "dimensions": [dims[k] for k in ("exercise", "sleep", "nutrition", "study", "growth") if k in dims],
        "retrieval": retrieval_ok,
        "caveats": [
            "阈值数值与编译期知识库参数同源；引用条目运行时从库检索，检索缺失时降级为静态口径（retrieved=false）",
            "这是日程结构层面的参考，不是医学评估",
        ],
    }


# ------------------------------------------------------------------
# HTTP 端点（H2）：与 plan_dialog 同模式——router 由 app.py include
# ------------------------------------------------------------------
class PlanReviewReq(BaseModel):
    """入参：plan_digest（前端摘要，DigestFact 形状的 JSON）+ user_id + week_no。"""
    model_config = ConfigDict(extra="forbid")
    user_id: str = "anon"
    week_no: int = 0
    # digest 必填且非空（R批验收：缺 digest 曾静默 200 全 unknown —— 与
    # MemoryFactReq 的 pydantic 校验纪律对齐，缺字段/空对象一律 422）
    digest: dict = Field(min_length=1)


router = APIRouter()


@router.post("/api/plan/review")
def api_plan_review(body: PlanReviewReq):
    """对前端摘要逐维度调三库检索，产出 findings + advice（每条带 source=库名+tier）。

    只建议不改日程（L4 边界）；检索失败降级为静态口径（retrieved=false），不报错。
    """
    try:
        return review_plan(body.digest, body.user_id, body.week_no)
    except Exception as e:  # 复核是增强能力，绝不挡主流程
        print("[plan_review] 复核失败：", e)
        return {"ok": False, "error": "review failed"}
