# -*- coding: utf-8 -*-
"""
R批 Wave3（H2）· 后端日程复核单测（不需要起后端、不碰真实库）
==============================================================
跑法： python scripts/test_plan_review.py
覆盖：规则判定（有氧/力量/睡眠区间/就寝/三餐/超长块/复习软目标）、
      unknown 不冒充 0、source 三态（真检索命中 / 同库命中 / 静态降级）、
      成长维度（习惯覆盖 / 目标进度）、L4 边界（纯函数，无副作用）。

--reverse：把 aerobic-150 阈值翻倍，好日程应转 gap —— 期望出现失败（红），
证明这批用例真的守住了判定逻辑。
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "server"))
sys.path.insert(0, _HERE)

import plan_review  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    if cond:
        print("  ✓ %s" % name)
    else:
        FAILS.append(name)
        print("  ✗ %s  %s" % (name, detail))


def f(value, confident=True, evidence=None):
    return {"value": value, "confident": confident, "evidence": evidence or []}


def digest(**kw):
    return kw


def find(report, rid):
    for d in report["dimensions"]:
        for x in d["findings"]:
            if x["id"] == rid:
                return x
    return None


def advs(report):
    out = []
    for d in report["dimensions"]:
        for a in d["advice"]:
            out.append(a)
    return out


# ---- 检索桩：可控的「真检索」返回 ----
class _StubHealth:
    @staticmethod
    def search(q, k=5):
        return [{"slug": "aerobic-150", "title": "有氧运动推荐量（库内）", "evidence_tier": "A", "summary": "每周≥150分钟"}]


class _StubMethod:
    @staticmethod
    def search(q, k=5):
        return [{"slug": "spacing-effect", "title": "分散复习效应（库内）", "evidence_tier": "A", "summary": "分散优于集中"}]


def main():
    print("== 1. 达标日程：全 good + source=真检索命中 ==")
    plan_review._RETRIEVERS = {"健康库": _StubHealth, "方法库": _StubMethod}
    d = digest(
        moderateMin=f(160), vigorousMin=f(0), strengthDays=f(2),
        sleepOpportunityHours=f(7.5), bedtimeConflictDays=f(0), preWakeConflictDays=f(0),
        mealDays=f(6), overlongStudyBlocks=f(0), reviewDays=f(3),
        habitSpans=[{"title": "晨跑", "weeksCovered": 16, "totalWeeks": 20}],
        goals=[{"title": "四六级", "weeksLeft": 4, "relatedBlocks": 2}],
    )
    r = plan_review.review_plan(d, "tester", 12)
    check("ok 字段", r["ok"] is True)
    check("周次回显", r["week_no"] == 12)
    a = find(r, "aerobic-150")
    check("有氧达标=good", a and a["status"] == "good", str(a))
    check("有氧 source 真检索", a and a["source"]["retrieved"] is True and a["source"]["tier"] == "A", str(a and a["source"]))
    check("力量达标", find(r, "strength-2days")["status"] == "good")
    s = find(r, "sleep-duration-adult")
    check("睡眠在区间=good", s and s["status"] == "good", str(s))
    check("就寝一致=good", find(r, "sleep-regularity")["status"] == "good")
    check("三餐达标", find(r, "regular-meals-breakfast")["status"] == "good")
    check("无超长块", find(r, "ultradian-rhythm")["status"] == "good")
    check("复习覆盖", find(r, "spacing-effect")["status"] == "good")
    gh = find(r, "growth-habit-晨跑")
    check("习惯覆盖 16/20=good(80%)", gh and gh["status"] == "good", str(gh))
    gg = find(r, "growth-goal-四六级")
    check("目标有相关块=good", gg and gg["status"] == "good", str(gg))
    check("达标日程无 advice", len(advs(r)) == 0, str([x["text"] for x in advs(r)]))

    print("== 2. 不达标日程：gap + advice 带 source ==")
    d2 = digest(
        moderateMin=f(60), vigorousMin=f(0), strengthDays=f(0),
        sleepOpportunityHours=f(5.5), bedtimeConflictDays=f(3), preWakeConflictDays=f(0),
        mealDays=f(2), overlongStudyBlocks=f(2), reviewDays=f(0),
        habitSpans=[{"title": "晨跑", "weeksCovered": 6, "totalWeeks": 20}],
        goals=[{"title": "数模国赛", "weeksLeft": 2, "relatedBlocks": 0}],
    )
    r2 = plan_review.review_plan(d2, "tester", 12)
    check("有氧不足=gap", find(r2, "aerobic-150")["status"] == "gap")
    check("力量不足=gap", find(r2, "strength-2days")["status"] == "gap")
    sd = find(r2, "sleep-duration-adult")
    check("睡眠过短=gap+serious", sd and sd["status"] == "gap" and sd["severity"] == "serious", str(sd))
    check("就寝冲突=gap", find(r2, "sleep-regularity")["status"] == "gap")
    check("三餐不足=gap", find(r2, "regular-meals-breakfast")["status"] == "gap")
    check("超长块=gap", find(r2, "ultradian-rhythm")["status"] == "gap")
    check("复习不足=info级gap", find(r2, "spacing-effect")["status"] == "gap" and find(r2, "spacing-effect")["severity"] == "info")
    gh2 = find(r2, "growth-habit-晨跑")
    check("习惯覆盖 6/20=gap(30%)", gh2 and gh2["status"] == "gap", str(gh2))
    gg2 = find(r2, "growth-goal-数模国赛")
    check("目标临期无安排=gap+serious", gg2 and gg2["status"] == "gap" and gg2["severity"] == "serious", str(gg2))
    texts = [x["text"] for x in advs(r2)]
    check("advice 覆盖 7 条缺口", len(texts) >= 7, str(texts))
    check("每条 advice 带 source", all(x.get("source", {}).get("lib") for x in advs(r2)))

    print("== 3. unknown 不冒充 0：缺事实 → unknown，不出 gap ==")
    r3 = plan_review.review_plan(digest(), "tester", 3)
    for rid in ("aerobic-150", "strength-2days", "sleep-duration-adult", "sleep-regularity",
                "regular-meals-breakfast", "ultradian-rhythm", "spacing-effect"):
        x = find(r3, rid)
        check("%s=unknown" % rid, x and x["status"] == "unknown", str(x))
    check("全 unknown → 无 advice", len(advs(r3)) == 0)
    gu = find(r3, "growth-goal-unknown")
    check("无目标 → unknown 说明", gu and gu["status"] == "unknown")

    print("== 4. 检索降级：库缺失 → findings 照出，source.retrieved=False ==")
    plan_review._RETRIEVERS = None
    orig = plan_review._retrievers
    plan_review._retrievers = lambda: (_ for _ in ()).throw(FileNotFoundError("no db"))
    try:
        r4 = plan_review.review_plan(digest(moderateMin=f(160), vigorousMin=f(0)), "tester", 1)
    finally:
        plan_review._retrievers = orig
    a4 = find(r4, "aerobic-150")
    check("降级后判定照出", a4 and a4["status"] == "good", str(a4))
    check("降级后 source.retrieved=False", a4 and a4["source"]["retrieved"] is False, str(a4 and a4["source"]))
    check("降级 quote 用静态口径", a4 and "150" in a4["source"]["quote"], str(a4 and a4["source"]))

    print("== 5. 同库命中（slug 不同）→ 用库内 tier（真检索的次级形态） ==")
    plan_review._RETRIEVERS = {"健康库": _StubHealth, "方法库": _StubMethod}
    r5 = plan_review.review_plan(digest(strengthDays=f(0), moderateMin=f(0), vigorousMin=f(0)), "tester", 1)
    st5 = find(r5, "strength-2days")
    check("strength source 引到库内 tier=A", st5 and st5["source"]["tier"] == "A" and st5["source"]["retrieved"] is True,
          str(st5 and st5["source"]))

    print("== 6. L4 边界：review_plan 纯函数（两次调用结果一致，不改入参） ==")
    d6 = digest(moderateMin=f(60), strengthDays=f(0), habitSpans=[{"title": "x", "weeksCovered": 1, "totalWeeks": 2}])
    import copy
    snapshot = copy.deepcopy(d6)
    r6a = plan_review.review_plan(d6, "tester", 1)
    r6b = plan_review.review_plan(d6, "tester", 1)
    check("入参未被改写", d6 == snapshot)
    check("两次调用确定一致", r6a["dimensions"] == r6b["dimensions"])

    print()
    if FAILS:
        print("失败 %d 项：%s" % (len(FAILS), "、".join(FAILS)))
        return 1
    print("全部通过 ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
