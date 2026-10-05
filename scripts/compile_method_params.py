# -*- coding: utf-8 -*-
"""
方法论 → 排程引擎的编译器（构建期执行）
==========================================
把 `data/method_kb.db` 里**机器可消费**的 parameters 抽出来，编译成
`src/data/methodParams.generated.ts`。

为什么走编译而不是运行时查库：
  排程引擎是**纯函数、不 fetch、不读时钟**（scheduler-v2-spec 铁律）。知识要影响排程，
  必须在**构建期**就变成常量，运行时引擎才能保持确定性与可测性。

编译纪律：
  · 每个映射都必须**显式声明来源条目 slug + 参数键**，缺条目或缺键 = 直接报错退出
    （宁可不编译，不许静默产出空参数 —— 对应项目「审计工具自身会骗人」的教训）。
  · 产物是 **.ts 而非 .json**：项目 tsconfig 不需要开 resolveJsonModule，
    且 .ts 自带类型推断。
  · 幂等：同库同内容 → 产物逐字节一致（时间戳除外，已刻意不放）。

用法： python scripts/compile_method_params.py
"""
import os, sys, json, sqlite3, datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "..", "data", "method_kb.db")
OUT_PATH = os.path.join(BASE, "..", "src", "data", "methodParams.generated.ts")

# 显式映射：目标键 <- (条目 slug, 条目 parameters 里的键)
MAPPING = {
    "studyDurations":        ("pomodoro", "durations"),
    "focusMin":              ("pomodoro", "focusMin"),
    "breakMin":              ("pomodoro", "breakMin"),
    "deepBlockMin":          ("deep-work", "deepBlockMin"),
    "maxDeepBlocksPerDay":   ("deep-work", "maxDeepBlocksPerDay"),
    "maxConsecutiveBlockMin": ("cognitive-load-theory", "maxConsecutiveBlockMin"),
    "maxNewConceptsPerBlock": ("cognitive-load-theory", "maxNewConceptsPerBlock"),
    "reviewIntervalsDays":   ("spaced-repetition-tool", "intervalsDays"),
    "dailyReviewCapMin":     ("spaced-repetition-tool", "dailyReviewCapMin"),
    "minSleepHours":         ("sleep-memory-consolidation", "minSleepHours"),
    "napMin":                ("sleep-memory-consolidation", "napMin"),
    "napMaxMin":             ("sleep-memory-consolidation", "napMaxMin"),
    "ultradianCycleMin":     ("ultradian-rhythm", "cycleMin"),
    "ultradianBreakMin":     ("ultradian-rhythm", "breakMin"),
    "examSprintLeadDays":    ("exam-strategy", "sprintLeadDays"),
    "examMockIntervalDays":  ("exam-strategy", "mockIntervalDays"),
    "examMinMockCount":      ("exam-strategy", "minMockCount"),
    "examErrorTaxonomy":     ("mock-exam-analysis", "errorTaxonomy"),
    "habitExpectDays":       ("habit-formation-loop", "expectDays"),
    "mcmTotalHours":         ("mcm-3day-timeline", "totalHours"),
    "mcmDecideTopicByHour":  ("mcm-3day-timeline", "decideTopicByHour"),
    "mcmWritingBlockHours":  ("mcm-3day-timeline", "writingBlockHours"),
    "mcmSleepMinHours":      ("mcm-3day-timeline", "sleepMinHours"),

    # ---- v2 扩域（2026-10-06）：习惯 / 目标 / 执行力三块 ----
    # ⚠️ **故意没有 willpower 块**：自控肌力（ego depletion）已进入复制危机
    #   （Vohs 2021 36实验室 N=3531 确认性 d=0.06 不显著），按任务书红线 8，
    #   contested 条目**不得编译成硬参数**。诱惑捆绑等可观察行为参数放在
    #   execution 块里，不设独立的「意志力」语义块。
    #   详见 docs/method-kb-plan-v2.md §6 与 §3 C-1。

    # 习惯养成块
    "habitMinCueDays":       ("habit-formation-loop", "minCueDays"),
    "habitTrackingWindowDays": ("habit-formation-times", "trackingWindowDays"),
    "habitReviewIntervalDays": ("habit-formation-times", "reviewIntervalDays"),
    "habitOneCuePerHabit":   ("habit-cue-routine-reward", "oneCuePerHabit"),
    "habitAnchorRequired":   ("habit-stacking-anchor", "anchorRequired"),
    "habitMissGracePerWeek": ("habit-missing-one-day", "missGracePerWeek"),
    "habitRelapseResumeHours": ("habit-relapse-protocol", "relapseResumeHours"),
    "habitNoJudgeBeforeDays": ("habit-two-week-regression", "noJudgeBeforeDays"),
    "habitConsistencyWindowDays": ("habit-measure-consistency", "consistencyWindowDays"),
    "habitAnchorCheckDays":  ("cue-reliability-check", "anchorCheckDays"),
    "habitStableContextRequired": ("habit-context-stability", "stableContextRequired"),

    # 目标达成块
    "goalMilestoneMax":      ("goal-discrete-milestone", "milestoneMax"),
    "goalCheckInIntervalDays": ("goal-discrete-milestone", "checkInIntervalDays"),
    "goalWishHorizonDays":   ("goal-time-horizon", "wishHorizonDays"),
    "goalWishHorizonMinDays": ("goal-time-horizon", "wishHorizonMinDays"),
    "goalReviewIntervalDays": ("review-and-adjust-goal", "reviewIntervalDays"),
    "goalAllowDirectionChange": ("review-and-adjust-goal", "allowDirectionChange"),
    "goalKillCriteriaCount": ("goal-kill-criteria", "killCriteriaCount"),
    "goalKillRequireObjective": ("goal-kill-criteria", "requireObjective"),
    "goalIgnorePriorInvestment": ("sunk-cost-ignore-past", "ignorePriorInvestment"),
    "goalShowRemaining":     ("goal-gradient-endowed-progress", "showRemaining"),
    "goalNextMilestoneOnSuccess": ("post-reward-reset", "planNextMilestoneOnSuccess"),
    "goalPlanningBufferRatio": ("planning-fallacy", "bufferRatio"),

    # 执行力块
    "execTwoMinuteThreshold": ("two-minute-start", "twoMinuteThreshold"),
    "execMinActionFloorMin": ("minimum-action-floor", "minActionFloorMin"),
    "execFallbackDefined":   ("minimum-action-floor", "fallbackDefined"),
    "execBufferRatio":       ("task-timeline-friction", "bufferRatio"),
    "execBatchMin":          ("interrupt-batch-handling", "batchMin"),
    "execObserveDays":       ("energy-not-time-task-match", "observeDays"),
    "execFirstActionStartMin": ("goal-first-action-rehearsal", "firstActionStartMin"),
    "execIfThenMax":         ("implement-if-then-obstacle", "ifThenMax"),
    "execRequireInnerObstacle": ("implement-if-then-obstacle", "requireInnerObstacle"),
    "execBundlingSteps":     ("temptation-bundling", "bundlingSteps"),
    "execBundlingRestrictAccess": ("temptation-bundling", "restrictAccess"),
    "execTaskTypeCount":     ("procrastination-task-types", "taskTypeCount"),
    "execFrictionStepsMax":  ("friction-reduction", "frictionStepsMax"),
    "execForgetgivenessForgives": ("self-forgiveness-cycle-break", "forgivenessForgives"),
    "execNameEmotionFirst":  ("procrastination-mood-repair", "nameEmotionFirst"),
    "execReduceAversion":    ("task-aversion-reduction", "reduceAversion"),

    # WOOP / 心理对照（含**期望调节**的正确用法）
    "woopSteps":             ("woop-mental-contrasting", "woopSteps"),
    "woopOutcomeImagerySec": ("woop-mental-contrasting", "outcomeImagerySec"),
    "woopWishMaxWords":      ("woop-mental-contrasting", "wishMaxWords"),
    "woopRequireObstacle":   ("positive-visualisation-backfire", "requireObstacle"),
}

# 每个键的期望类型（编译期校验，防止数据写错类型仍被编译进去）
TYPE_OF = {
    "studyDurations": list, "focusMin": int, "breakMin": int,
    "deepBlockMin": int, "maxDeepBlocksPerDay": int,
    "maxConsecutiveBlockMin": int, "maxNewConceptsPerBlock": int,
    "reviewIntervalsDays": list, "dailyReviewCapMin": int,
    "minSleepHours": int, "napMin": int, "napMaxMin": int,
    "ultradianCycleMin": int, "ultradianBreakMin": int,
    "examSprintLeadDays": int, "examMockIntervalDays": int, "examMinMockCount": int,
    "examErrorTaxonomy": list, "habitExpectDays": int,
    "mcmTotalHours": int, "mcmDecideTopicByHour": int,
    "mcmWritingBlockHours": int, "mcmSleepMinHours": int,

    # ---- v2扩域类型声明 ----
    # 布尔型在下面用 bool 统一处理（`want is bool` 分支）。
    "habitOneCuePerHabit": bool, "habitAnchorRequired": bool,
    "habitStableContextRequired": bool,
    "habitMinCueDays": int, "habitTrackingWindowDays": int,
    "habitReviewIntervalDays": int, "habitMissGracePerWeek": int,
    "habitRelapseResumeHours": int, "habitNoJudgeBeforeDays": int,
    "habitConsistencyWindowDays": int, "habitAnchorCheckDays": int,

    "goalMilestoneMax": int, "goalCheckInIntervalDays": int,
    "goalWishHorizonDays": int, "goalWishHorizonMinDays": int,
    "goalReviewIntervalDays": int, "goalAllowDirectionChange": bool,
    "goalKillCriteriaCount": int, "goalKillRequireObjective": bool,
    "goalIgnorePriorInvestment": bool, "goalShowRemaining": bool,
    "goalNextMilestoneOnSuccess": bool, "goalPlanningBufferRatio": float,

    "execTwoMinuteThreshold": int, "execMinActionFloorMin": int,
    "execFallbackDefined": bool, "execBufferRatio": float,
    "execBatchMin": int, "execObserveDays": int,
    "execFirstActionStartMin": int, "execIfThenMax": int,
    "execRequireInnerObstacle": bool, "execBundlingSteps": int,
    "execBundlingRestrictAccess": bool, "execTaskTypeCount": int,
    "execFrictionStepsMax": int, "execForgetgivenessForgives": bool,
    "execNameEmotionFirst": bool, "execReduceAversion": bool,

    "woopSteps": int, "woopOutcomeImagerySec": int,
    "woopWishMaxWords": int, "woopRequireObstacle": bool,
}

# 🔴 v2 新增红线：contested 条目**禁止**编译成引擎硬参数。
# 理由（CY 红线8 / 任务书 P1-2）：争议条目不得只取一方结论包装成确定事实。
# 本库最典型的例子是 ego-depletion-contested（自控肌力，复制危机）——
# 若它被编译成参数，引擎会据此排程，等于把「未获预注册复制的机制」
# 变成产品行为。故这里在**编译期**直接拦住，而不是靠 code review 自觉。
# ⚠️ 注意：本块只拦 status == "contested"，不拦 evidence_tier 低（D 级仍可编译，
#    因为「番茄钟属从业者方法」是明确的诚实标注，不是不确定）。
FORBIDDEN_STATUS = {"contested"}


def _params(conn, slug):
    row = conn.execute("SELECT parameters, evidence_tier, status FROM entries WHERE slug=?", (slug,)).fetchone()
    if not row:
        raise SystemExit(f"[compile] 缺少来源条目：{slug}（先跑 build_method_kb.py）")
    try:
        p = json.loads(row[0]) if row[0] else {}
    except Exception:
        p = {}
    return p, row[1], row[2]


def compile_params():
    conn = sqlite3.connect(DB_PATH)
    blocks, provenance = {}, {}
    for key, (slug, pkey) in MAPPING.items():
        params, tier, status = _params(conn, slug)
        if pkey not in params:
            raise SystemExit(f"[compile] 条目 {slug} 缺参数键 {pkey}（不允许静默缺省）")
        if status == "deprecated":
            raise SystemExit(f"[compile] 条目 {slug} 已 deprecated，不得编译进引擎")
        if status in FORBIDDEN_STATUS:
            raise SystemExit(
                f"[compile] 条目 {slug} 为 {status}，**不得编译成引擎硬参数**"
                f"（红线：争议条目不得只取一方结论包装成确定事实）"
            )
        val = params[pkey]
        want = TYPE_OF[key]
        # ⚠️ 顺序很重要：bool 是 int 的子类，所以必须先判 int 排除 bool，
        #    否则 `True` 会被当成合法的 int 静默通过（值1），编译出错误参数。
        if want is bool:
            if not isinstance(val, bool):
                raise SystemExit(f"[compile] {key} 期望 bool，得到 {type(val).__name__}")
        elif want is int:
            if isinstance(val, bool) or not isinstance(val, int):
                raise SystemExit(
                    f"[compile] {key} 期望 int，得到 {type(val).__name__}"
                    + ("（bool 是 int 子类，需显式转成0/1）" if isinstance(val, bool) else "")
                )
        elif want is float:
            if isinstance(val, bool) or not isinstance(val, (int, float)):
                raise SystemExit(f"[compile] {key} 期望 float，得到 {type(val).__name__}")
        elif want is list and not isinstance(val, list):
            raise SystemExit(f"[compile] {key} 期望 list，得到 {type(val).__name__}")
        blocks[key] = val
        provenance[key] = {"slug": slug, "param": pkey, "tier": tier}

    # 分阶段索引：phase -> 该阶段适用的条目（供 methods.ts 做 L3 主动建议）
    by_phase, by_task = {}, {}
    for slug, aw, title, status in conn.execute(
        "SELECT slug, applicable_when, title, status FROM entries WHERE status='verified'"
    ).fetchall():
        try:
            aw = json.loads(aw) if aw else {}
        except Exception:
            aw = {}
        for ph in (aw.get("phase") or ["any"]):
            by_phase.setdefault(ph, []).append(slug)
        for t in (aw.get("task") or []):
            by_task.setdefault(t, []).append(slug)

    # 提示索引（前端/L3 展示用；不进引擎计算路径）
    hints = []
    for slug, title, summary, tier, status in conn.execute(
        "SELECT slug, title, summary, evidence_tier, status FROM entries ORDER BY id"
    ).fetchall():
        hints.append({"slug": slug, "title": title, "summary": summary or "",
                      "tier": tier, "status": status})
    conn.close()

    doc = {
        "_meta": {
            "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "source": "data/method_kb.db",
            "hint_count": len(hints),
            "provenance": provenance,
            "note": "由 scripts/compile_method_params.py 生成 —— 勿手改；改条目后重跑编译。",
        },
        "blocks": blocks,
        "byPhase": by_phase,
        "byTask": by_task,
        "hints": hints,
    }
    return doc


TS_HEADER = """/**
 * ⚠️ 生成文件 —— 由 scripts/compile_method_params.py 从 data/method_kb.db 编译而来。
 * 手改无效：下次编译会被覆盖。要改参数请改 scripts/method_kb_data.py 里对应条目的
 * parameters 字段，然后重跑 `python scripts/compile_method_params.py`。
 *
 * 每个值的出处见 `_meta.provenance`（哪个条目 / 哪个参数键 / 证据等级）。
 */
"""


def _ts_val(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ", ".join(_ts_val(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{ " + ", ".join(f"{json.dumps(k, ensure_ascii=False)}: {_ts_val(x)}" for k, x in v.items()) + " }"
    return repr(v)


def emit(doc):
    lines = [TS_HEADER, "export const METHOD_PARAMS = {"]
    m = doc["_meta"]
    lines.append(f"  _meta: {{ generated_at: {json.dumps(m['generated_at'])}, "
                 f"source: {json.dumps(m['source'])}, hint_count: {m['hint_count']} }},")
    lines.append("  blocks: " + _ts_val(doc["blocks"]) + ",")
    lines.append("  byPhase: " + _ts_val(doc["byPhase"]) + ",")
    lines.append("  byTask: " + _ts_val(doc["byTask"]) + ",")
    lines.append("  hints: [")
    for h in doc["hints"]:
        lines.append("    " + _ts_val(h) + ",")
    lines.append("  ],")
    lines.append("} as const;")
    lines.append("")
    lines.append("export type MethodParams = typeof METHOD_PARAMS;")
    return "\n".join(lines)


def main():
    doc = compile_params()
    src = emit(doc)
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)
    print(f"[compile] {OUT_PATH}")
    print(f"[compile] blocks={len(doc['blocks'])} hints={len(doc['hints'])} "
          f"phases={list(doc['byPhase'])} tasks={list(doc['byTask'])}")


if __name__ == "__main__":
    main()
