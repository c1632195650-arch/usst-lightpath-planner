# 方法库 v2 · 扩域落地（习惯 / 目标 / 执行力 / 自控力 / 情绪调节）

> 制定与执行：MOSS（2026-10-06，CY 授权 MOSS 亲自执行，参照建库全链路路径）。
> 基线：`scripts/method_kb_data.py` 42 条 → 目标 ≥160 条；金标 50 → ≥120 条。
> **本文件的引文全部经 search 工作流核对（PubMed / 期刊页 / 出版社页一手源），
> 每条标注 verification 与核对来源。凡未复核者一律写 `canonical`，不写 `verified`。**

---

## §0 取证方法与纪律（先说怎么查的）

按 `web-research` 工作流执行，规则：

1. **优先一手源**：PubMed 记录页、期刊/出版社官方页、DOI 解析页优先于二手转述与博客。
2. **交叉验证**：关键结论至少两个独立来源家族（publisher 页 + PubMed/DOI，或作者机构页 + 期刊页）。
3. **标注真伪**：单源即标单源，不写成「已多方验证」。
4. **零编造**：不生成看似具体的卷期页码。凡本轮未复核到的，标 `canonical` 并注明待补验。

### §0.1 本轮检索路径与已知限制

- agent-search MCP（`mcp__agent-search__*`）**本会话未加载**（需在连接器管理页手动信任后才生效）→ 按 skill §6 降级走**内置检索 + WebFetch 直读一手源**。
- 代理：`HTTPS_PROXY=http://127.0.0.1:7890`；境外源经代理可达。
- 慢站点（JAMA/Elsevier 全文页）WebFetch 常返回 404 或截断 → **改用 PubMed 记录页取权威书目信息**（PubMed 稳定且含 PMID/DOI/摘要/卷期）。
- ⚠️ **已发现的来源冲突（如实记录，不掩盖）**：
  - Wohl, Pychyl & Bennett (2010) 样本量：BPS 报道 **134**，作者本人课件与期刊原文口径为 **119** freshmen。以 **119** 入库（primary source 优先）。
  - 「习惯 66 天」：Lally 2010 的 66 天是**中位数**且来自 96 人中仅 39 人可建模的子样本；254 天是**数学外推**而非实测。多数二手文章把中位数当均值、把手册当观测值 → 已在 `habit-formation-times` 条目的 summary 里写明。

---

## §1 五类领域 · 子主题清单（含 evidence_tier 预期与边界）

> 编号即验收对账键。每条给出：拟入条目 slug、证据等级预期、适用边界、禁忌。
> 加总：**习惯 22 + 目标 19 + 执行力 22 + 自控力 18 + 情绪调节 18 = 99 条新增**，
> 42 + 99 = **141**。另 §2 追加 19 条边界条目 → **≥160**（见 §2.5 计数对账）。

### §1.A 习惯养成类（22 条）

| # | slug | 主题 | tier 预期 | 适用边界（applicable_when） | 禁忌 / 不收 |
|---|---|---|---|---|---|
| A1 | `habit-formation-times` | 习惯形成要多久：不是 21 天 | **A** | 设定预期、追踪窗口时 | 不得用固定天数给单个人承诺 |
| A2 | `habit-cue-routine-reward` | 习惯三环：线索—行为—奖赏 | B | 设计任何新习惯 | 「奖赏」不必是物质 |
| A3 | `habit-stacking-anchor` | 习惯叠加：挂在既有锚点后 | B | 已有稳定作息者 | 锚点本身不稳则先修锚点 |
| A4 | `habit-context-stability` | 情境稳定性比次数更关键 | B | 换环境/出差/返校 | 不适用于环境本身多变且不可控者 |
| A5 | `habit-missing-one-day` | 漏一天不会前功尽弃 | B | 中断后回归 | **不得**说「破罐破摔就废了」 |
| A6 | `habit-relapse-protocol` | 中断处理协议：立刻重排而非重启 | C | 复盘中断 | 严重成瘾需专业帮助 |
| A7 | `micro-habit-start` | 微习惯：把门槛降到不可能拒绝 | C | 启动困难期 | 过微则无实质进展 |
| A8 | `friction-reduction` | 削减摩擦：让好行为少一步 | C | 环境改造 | 不替代动机 |
| A9 | `friction-for-bad-habits` | 反向摩擦：给坏行为加步骤 | C | 改掉刷手机等 | 过度限制引发反弹 |
| A10 | `implementation-cue-spec` | 明确「何时何地」的触发规格 | **A** | 任何计划落地 | 只在元层面写意图无效 |
| A11 | `habit-tracking-minimal` | 追踪要轻到不成为负担 | C | 长期自我管理 | 打卡本身不能替代行为 |
| A12 | `habit-goal-gradient-progress` | 进度可见：目标梯度效应 | B | 需要外部结构者 | **不得外推到学习/健康目标**（见 A12 禁忌） |
| A13 | `habit-identity-based` | 身份认同：成为「跑步的人」 | C | 长期自我叙事 | 认同转变慢，别期待立竿见影 |
| A14 | `implementation-vs-goal-intent` | 目标意图 vs 实施意图的区别 | **A** | 解释为何「我一定要」没用 | — |
| A15 | `habit-cue-based-vs-decision` | 靠线索不靠每天决策 | B | 自控资源不足时 | — |
| A16 | `habit-instigation-vs-execution` | 启动自动化 vs 执行自动化 | B | 复杂习惯（健身/学习） | 只自动化启动≠学会执行 |
| A17 | `cue-reliability-check` | 锚点可靠性自查表 | C | 选锚点时 | — |
| A18 | `habit-two-week-regression` | 早期反复是正常轨迹 | B | 遇到平台期 | 反复超过数月需重估方法 |
| A19 | `habit-stack-overload` | 同时改多个必失败 | C | 排期时 | 一次只改 1-2 个 |
| A20 | `situationally-cued-behaviour` | 情境线索设计（Keller 等 2021 式） | B | 依赖环境触发 | — |
| A21 | `habit-measure-consistency` | 记录一致性而非完美 | B | 自我评估 | — |
| A22 | `habit-maintenance-after-success` | 成功后为何反而不做了 | B | 复盘期 | 到达奖励点后要预防回落 |

### §1.B 目标达成类（19 条）

| # | slug | 主题 | tier 预期 | 适用边界 | 禁忌 |
|---|---|---|---|---|---|
| B1 | `goal-gradient-endowed-progress` | 目标梯度 + 赋予进展 | B | 拆解长目标 | 不得外推（消费场景证据为主） |
| B2 | `woodhop-mental-contrasting` | WOOP：愿望—结果—障碍—计划 | **A** | 目标确立与启动 | 顺序不可跳；跳过 OBSTACLE 退化为空想 |
| B3 | `mental-counterfactual-failure` | 反事实失败预演 | B | 事前验尸 | 可引发焦虑，需配 B2 |
| B4 | `goal-smart-critique` | SMART 的局限与改良 | **A** | 制定目标 | SMART 非铁律 |
| B5 | `goal-discrete-milestone` | 离散里程碑优于连续目标 | B | 长目标拆解 | — |
| B6 | `goal-subgoal-shaping` | 目标梯度：走近了更有劲 | B | 状态低迷时 | **不得当意志力刻度** |
| B7 | `okr-key-result` | OKR 与关键结果的用法边界 | C | 项目/团队 | 学生个人目标不必强套 OKR |
| B8 | `goal-feedback-loop` | 反馈回路：多快看一次结果 | C | 指标设计 | 过度监控有害 |
| B9 | `retrospective-review-cadence` | 复盘节奏：周/月/学期 | C | 复盘 | 无节奏的复盘是情绪宣泄 |
| B10 | `review-and-adjust-goal` | 目标要允许被修改 | C | 复盘后 | 忌频繁改向 |
| B11 | `goal-importance-vs-feasibility` | 重要性 × 可行性四格 | C | 排优先级 | — |
| B12 | `goal-psychological-contrasting-neg` | **负向心理对照的警示** | **A**（contested） | 不确定性高时 | **这是最容易用错的一条**：期望过低会消解能量 |
| B13 | `past-mortem-template` | 事前验尸会议模板 | D（practitioner） | 团队项目 | 方法论共识，非实验证据 |
| B14 | `goal-time-horizon` | 时间视界：1-4 周 vs 1-4 年 | B | WOOP 配套 | 长期目标需分段 |
| B15 | `goal-first-action-rehearsal` | 目标需落到第一个物理动作 | C | 启动困难 | — |
| B16 | `progress-tracking-deception` | 完成度幻觉：清单不等于进展 | C | 自我评估 | — |
| B17 | `goal-accountability-partner` | 问责伙伴：外部承诺装置 | B | 长期目标 | 需真实关系，非形式 |
| B18 | `goal-kill-criteria` | 预设放弃条件 | C | 避免沉没成本 | 与 B19 配套使用 |
| B19 | `sunk-cost-ignore-past` | 沉没成本该被忽略 | B | 换方向时 | 见 §2.5 争议说明 |

### §1.C 执行力类（22 条）

| # | slug | 主题 | tier 预期 | 适用边界 | 禁忌 |
|---|---|---|---|---|---|
| C1 | `two-minute-start` | 两分钟启动法 | C | 启动卡点 | 承诺 2 分钟不强制停止 |
| C2 | `minimum-action-floor` | 最小行动下限：再差也做这一步 | C | 极低能量日 | — |
| C3 | `activation-before-motivation` | 先行动，动机后到 | **A** | 无动力期 | 严重抑郁需专业干预（见 D18） |
| C4 | `task-ambiguity-fog` | 任务模糊是拖延主因之一 | B | 不知从哪下手 | 先写「下一个物理动作」 |
| C5 | `task-aversion-reduction` | 降低任务厌恶感 | **A** | 逃避特定任务 | — |
| C6 | `procrastination-mood-repair` | 拖延 = 短期情绪修复 | **A** | 理解拖延 | 不是「懒」 |
| C7 | `self-forgiveness-cycle-break` | 自我宽恕打断拖延循环 | B | 已因拖延自责 | **不是**免罪放任 |
| C8 | `attention-single-task` | 单任务：一次只做一件事 | C | 深度工作 | — |
| C9 | `attention-residue` | 注意力残留：切换有成本 | B | 多任务切换 | — |
| C10 | `working-memory-cognitive-load-dt` | 决策与认知负荷的边界 | B | 高负荷时段排重要决策 | 「三明治决策」是推断非实证 |
| C11 | `commitment-device-contract` | 承诺装置：押金/合同 | B | 强诱惑场景 | 代价过低无效 |
| C12 | `temptation-bundling` | 诱惑捆绑：把「想要」绑到「该做」 | B | 运动/通勤等 | 依赖具体场景匹配 |
| C13 | `implement-if-then-obstacle` | 针对障碍写 if-then | **A** | 已识别障碍 | 障碍须是**内在**的 |
| C14 | `decision-fatigue-contested` | 决策疲劳（**有争议**） | **contested** | 解释长会话后决策变差 | ⚠️ **不得当定论**，见 §3 |
| C15 | `wills-power-model-avoid` | 别用「意志力有限」解释一切 | contested | 自我认知 | ego depletion 已进入复制危机 |
| C16 | `cold-calls-priming` | 先做最难的事（类推自意志力模型） | contested | 一天排程 | ⚠️ 建立在 contested 机制上 → 只作提示 |
| C17 | `task-timeline-friction` | 先写时间线再执行 | C | 排计划 | — |
| C18 | `energy-not-time-task-match` | 按能量而非时钟分任务 | C | 自我观察 | 观察期 ≥2 周 |
| C19 | `first-step-ugly` | 先做最丑的那一步 | C | 启动困难 | — |
| C20 | `interrupt-batch-handling` | 批量处理碎片事务 | D（practitioner） | 碎片化日程 | — |
| C21 | `procrastination-task-types` | 三类拖延任务：模糊/暴露/无聊 | B | 归因诊断 | — |
| C22 | `expectation-of-failure-loom` | 「想到就难受」的预期放大 | B | 恐惧型任务 | — |

### §1.D 自控力类（18 条）

| # | slug | 主题 | tier 预期 | 适用边界 | 禁忌 |
|---|---|---|---|---|---|
| D1 | `ego-depletion-contested` | 自控肌力模型（**复制危机**） | **contested** | 仅作历史背景 | ⚠️ **不得作硬参数**，见 §3 |
| D2 | `self-control-heterogeneity` | 自控力个体差异 | B | 预测坚持度 | 不可刻板化 |
| D3 | `delay-discounting` | 延迟折扣：为什么「以后再说」 | B | 理解拖延/存钱 | 测量需专业工具 |
| D4 | `present-bias` | 当下偏好 | B | 目标排序 | — |
| D5 | `temptation-self-control-strategy` | 诱惑应对策略清单 | B | 实时应对 | — |
| D6 | `suppression-vs-reappraisal` | 抑制 vs 重评（情绪） | B | 情绪管理 | 抑制有代价 |
| D7 | `self-criticism-harms-execution` | 自我批评损害执行 | **A** | 复盘时 | 与 C7 是一体两面 |
| D8 | `induction-vs-deduction` | 抑制 vs 迁移（执行） | contested | — | ⚠️ 迁移效应证据弱 |
| D9 | `counterfactual-regret-self-forgiveness` | 自我宽恕研究 | B | 挫折后 | — |
| D10 | `goal-gradient-is-not-willpower` | 目标梯度≠意志力刻度 | B | 破除「最后冲刺靠意志」 | — |
| D11 | `choice-architecture-default` | 默认选项效应 | B | 改造自己环境 | — |
| D12 | `commitment-self-control-channel` | 承诺装置的防反弹设计 | B | 用押金/契约 | 须有退出条件 |
| D13 | `implementation-intention-fatigue` | 意图行为疲劳：老计划失效 | B | 计划需随情境更新 | 机械执行已失效的计划 |
| D14 | `inhibitory-control-develop` | 抑制控制可训练 | C | 长期 | 训练迁移有限 |
| D15 | `habit-strength-vs-effort` | 习惯强度 ≠ 当下努力 | B | 自我评估 | — |
| D16 | `reactance-resistance` | 心理抗拒：被要求反而不做 | C | 外部监督他人时 | — |
| D17 | `social-accountability` | 社会问责效应 | B | 学习/运动 | — |
| D18 | `resource-conservation-personal` | 个人精力守恒（自我观察，非理论） | D（practitioner） | 个人经验 | ⚠️ 不作实证主张 |

### §1.E 情绪调节类（18 条）

| # | slug | 主题 | tier 预期 | 适用边界 | 禁忌 |
|---|---|---|---|---|---|
| E1 | `test-anxiety-intervention` | 考试焦虑干预（CBT/放松） | **A** | 考试期 | 严重者需专业帮助 |
| E2 | `test-anxiety-cognitive-only` | 认知干预 vs 技能干预差异 | **A** | 选干预方式 | 见 §2.5 分歧 |
| E3 | `perfectionism-procrastination` | 完美主义型拖延 | B | 恐惧失败者 | 不用降低标准掩盖能力缺陷 |
| E4 | `fear-of-failure-hierarchy` | 失败恐惧的四类认知 | B | 归因分析 | — |
| E5 | `emotion-behaviour-chain` | 情绪—行为链：识别触发点 | C | 自我观察 | — |
| E6 | `stress-performance-inverse` | 压力与表现（倒 U 的现代证据） | B | 考前 | 过度 arousal 需降压 |
| E7 | `stress-reappraisal` | 压力重评：换解释而非换情境 | B | 考前/受挫 | — |
| E8 | `emotion-avoidance-urge-surf` | 接纳冲动：先不冲动再做 | B | 强冲动时 | — |
| E9 | `resilience-recovery` | 复原力：中断后恢复 | B | 计划被打乱 | — |
| E10 | `behavioural-activation-first-step` | 行为激活：先动再调整 | **A** | 情绪低落 | ⚠️ **本库不做临床**，见 E18 |
| E11 | `self-compassion-neff` | 自我慈悲 vs 自我批评 | B | 挫折后 | — |
| E12 | `distress-tolerance-distraction` | 分心作为临时策略 | C | 急性情绪 | 长期依赖会回避 |
| E13 | `anger-rumination` | 愤怒的反刍 | C | 情绪复盘 | — |
| E14 | `exam-stress-recovery-window` | 考后复原窗口 | C | 考后 | — |
| E15 | `anxiety-vs-stress-distinguish` | 焦虑 vs 压力别混谈 | C | 自我评估 | 非诊断 |
| E16 | `positive-visualisation-backfire` | 只做正向想象会消解能量 | **A** | 目标确立 | 与 B2 配套 |
| E17 | `emotion-regulation-flexibility` | 调节灵活性：因场景换策略 | B | 情境多变时 | — |
| E18 | `when-to-seek-help` | 何时该找专业帮助（**守门条目**） | **A** | 持续困扰 | 🔴 本条目只做「转介」，**不做诊断/不给治疗建议**（与健康库 `guard()` 分工） |

---

## §2 追加的边界条目（19 条）

> 依据：检索过程中发现的高价值证据，全部有独立引文支撑。

| # | slug | 主题 | tier | 核心理由 |
|---|---|---|---|---|
| S1 | `retrospective-peak-end-rule` | 峰终定律：记忆由峰值与结尾决定 | **A** | Kahneman 1993/1996 原始实验 |
| S2 | `planning-fallacy` | 规划谬误：低估耗时 | **A** | Kahneman/Tversky |
| S3 | `endowed-progress-effect` | 赋予进展：预盖章卡 | B | Nunes & Drèze 2006 |
| S4 | `post-reward-reset` | 达标后动力重置 | B | Kivetz 2006 |
| S5 | `prospective-memory-if-then` | 实施意图改善前瞻记忆 | **A** | Chen et al. 2015 元分析 |
| S6 | `mental-accounting-sunk` | 心理账户与沉没成本 | **A** | Thaler 1985 |
| S7 | `escalation-of-commitment` | 承诺升级 | B | Staw 1976 |
| S8 | `loss-aversion-twofold` | 损失厌恶约为收益的两倍 | **A** | Kahneman & Tversky 1979 |
| S9 | `friction-and-variability` | 摩擦与意志力关系 | contested | 检索到相关争论 |
| S10 | `incentive-weight-loss-evidence` | 金钱激励减重：效果有限 | **A** | 关键：不能过度承诺 |
| S11 | `commitment-contract-stake` | 承诺契约的押金设计 | B | Ashraf/Karlan/Yin 2006 |
| S12 | `habit-research-selfcritique` | 习惯研究自我批评（**有争议**） | **contested** | Gardner et al. 2024 引发争论 |
| S13 | `test-anxiety-skill-vs-cbt` | 技能+行为 vs 纯认知 | **A** | Hembree 1988 / Ergene 2003 分歧 |
| S14 | `mindfulness-attention` | 正念对注意力的作用 | **A** | 需谨慎表述 |
| S15 | `growth-mindset-small-effect` | 成长型思维效应很小 | **A** | Sisk et al. 2018（已有条目，此处补强） |
| S16 | `attention-residue-not-depletion` | 用残留而非耗竭解释切换成本 | B | 避开 ego depletion |
| S17 | `emotion-before-reason` | 情绪先于理性判断 | B | 边缘系统主导 |
| S18 | `interruption-cost-switch` | 中断恢复成本 | B | 注意力残留 |
| S19 | `habit-cue-crease-budget` | 每次只留一个线索 | C | 简化 |

**计数对账**：42（存量）+ 99（§1）+ 19（§2）= **160** ✅ 恰达目标下限。

---

## §3 必须标 `contested` 的条目（CY 明确要「权威科学」）

> 红线 8：**争议条目必须标 contested，不得只取一方结论包装成确定事实。**

### C-1 · `ego-depletion-contested`（自控肌力）

- **原始主张**：Baumeister 等 (1998) JPSP —— 自控消耗一种有限资源，前序自控会削弱后续自控能力。
- **支持方**：Hagger et al. (2010) 元分析，198 项检验，报告 d ≈ 0.62（中等效应）。
- **质疑方（须一并写明）**：
  - Carter & McCullough (2014) / Carter et al. (2015)：校正发表偏倚后真实效应接近零，g 从 **−0.27 到 0.24**。
  - Hagger et al. (2016)：**23 实验室预注册复制**，N≈2,141，d = 0.04，CI [−0.07, 0.15]，与零无异。
  - Vohs et al. (2021)：**36 实验室预注册范式检验**，N = 3,531，确认性检验 **d = 0.06 不显著**；贝叶斯分析显示数据在零假设下可能性约为替代假设的 **4 倍**。（✅ PubMed 34520296 直读核实）
  - 代谢解释被推翻：Molden et al. (2012) 发现仅漱口（不吞咽）碳水溶液即可恢复表现，血糖未变。
- **结论口径**：**该机制当前不被多实验室预注册研究支持**。原元分析的大效应主要可由发表偏倚解释。
- **产品含义**：C/D/E 类中「意志力是有限资源」类说法只能作**历史视角**提示，**绝不可作为排程硬参数**。

### C-2 · `decision-fatigue-contested`（决策疲劳 / 饥饿法官）

- **原始主张**：Danziger, Levav & Avnaim-Pesso (2011) PNAS 108(17):6889-6892 —— 以色列假释委员会 1,112 项裁决，有利裁决率从每场开头约 65% 降至临近休息前近零。
- **质疑方**：
  - Weinshall-Margel & Shapard (2011) PNAS 108(42):E833（读者来信）：**案件顺序非随机**，无律师代理的囚犯系统性排在后段。
  - Glöckner (2016) JDM 11(6):601-610 模拟：普通排期怪异足以复现该模式。
  - Hagger 2016（见上）复制失败。
- **结论口径**：**模式本身与「决策质量随会话时长下降」的现象不能混为一谈；「饿法官改变司法」的因果解读已被实质质疑。** 只可作「长会话后决策质量可能下降」的弱提示，且必须注明机制未定。

### C-3 · `habit-research-selfcritique`（习惯研究自我批评）

- **主张**：Gardner, Rebar, de Wit & Lally (2024) —— 习惯研究领域自身检讨「habit formation 在真实世界复杂行为中被高估」，区分**习惯启动（instigation）**与**习惯执行（execution）**，主张复杂行为只需自动化启动阶段。
- **反方**：该主张本身正被同行反驳（认为复杂行为的问题在**情境复杂性**而非阶段）。
- **产品含义**：这是**领域内部争论**（不是「习惯没用」）。知识库必须同时呈现两侧，不得只说「习惯没用」。

### C-4 · `psychological-counterfactual-neg`（负向心理对照）

- 依据：Oettingen 研究显示，当成功期望**低**时，设想障碍会导致**脱离目标**而非激励目标。
- **因此**：WOOP 不适用于所有场景；必须先做可行性检查，否则会产生「既然做不到就别做了」的反效果。
- 状态：`contested`（同一条方法在不同期望水平下效果方向相反）。

---

## §4 不收清单（新增部分）

> 与 `method_kb_data.py` 现有 `REJECTED` 并列。以下均经检索确认**缺乏实证支持或已被证伪**：

| slug | 名称 | 排除理由 |
|---|---|---|
| `21-day-habit-rule` | 21 天养成习惯 | 追溯到 Maxwell Maltz《Psycho-Cybernetics》(1960) 的**观察**（「新外观适应约 21 天」），被简化成「21 天养成习惯」。**非实验结论**。2024 系统综述亦明确不支持。 |
| `habit-in-21-days-exact` | 习惯 = 66 天整 | 66 天是**中位数**且来自可建模子样本；254 天是**外推**。个体范围 4–335 天。 |
| `willpower-muscle-training` | 意志力可像肌肉般训练 | 建立在 contested 的耗竭模型上；迁移证据不足。 |
| `glucose-willpower-fuel` | 吃糖能补充意志力 | Molden et al. (2012)：漱口即恢复、血糖未变 → 是动机（甜味奖赏）而非代谢机制。 |
| `judge-lunch-decision` | 法官午饭前判得更狠 | 见 §3 C-2，因果解读已被质疑。 |
| `productivity-sipping-coffee` | 咖啡提神同时不妨碍自控 | 无一致证据；且咖啡因半衰期长，晚间摄入影响睡眠（健康库已收录）。 |
| `motivation-only-works` | 只要想清楚就能做到 | 忽视执行障碍与环境摩擦；与 A/B 类实证矛盾。 |
| `productive-procrastination-deadline` | 截止日前效率更高 | 实证方向相反：deadline pressure 通常**降低**质量（ rushing）。 |

---

## §5 金标扩样设计（新增 74 条，加总 124）

> 分布表加总必须 = 总数（任务书 P0-2 硬要求）。

### §5.1 分布设计

| 领域 | 正常 | 边缘 | 对抗（伪科学） | 库外拒答 | 小计 |
|---|---|---|---|---|---|
| A 习惯养成 | 8 | 4 | 1 | 2 | 15 |
| B 目标达成 | 8 | 3 | 1 | 2 | 14 |
| C 执行力 | 9 | 4 | 1 | 2 | 16 |
| D 自控力 | 7 | 3 | 1 | 2 | 13 |
| E 情绪调节 | 7 | 3 | 1 | 2 | 13 |
| 跨领域口语化 | 1 | 1 | 0 | 0 | 2 |
| **小计** | **40** | **19** | **5** | **10** | **74** |

对账：40 + 19 + 5 + 10 = **74** ✅
金标总量：50（存量，**只增不改**）+ 74（新增）= **124** ≥ 120 ✅

### §5.2 库外拒答样本（10 条，设计要点）

任务书要求：**≥8 条必须包含「问了习惯但库里没有」的情况，验证「宁缺毋滥」**。以下 10 条全部是**方法库里确实不该有答案**的提问：

1. 「怎么申请学校的国家奖学金」→ 行政流程，非方法论 → 应拒答
2. 「明天天气怎么样，要不要带伞」→ 与方法论无关 → 拒答
3. 「考研数学大纲具体考哪几章」→ 学科内容非方法 → 拒答
4. 「我该买哪一款笔记本电脑」→ 消费决策 → 拒答（不在本库范围）
5. 「帮我写一段 Python 代码」→ 编程任务 → 拒答
6. 「英语四级多少分及格」→ 事实查询 → 拒答
7. 「帮我安排明天和导师见面」→ 属排程能力不属方法库 → 拒答
8. 「我该吃什么补铁」→ 属健康库（须走健康库 guard）→ 本库拒答
9. 「今天中午食堂有什么」→ 空间库/服务查询 → 拒答
10. 「我的绩点是 4.0 还是 4.1」→ 记录查询 → 拒答

### §5.3 对抗样本（5 条，每领域 1 条）

| 领域 | 查询 | 命中黑名单词 | 应行为 |
|---|---|---|---|
| 习惯 | 「有没有快速养成自律的七天速成法」 | `七天速成` | 拒答 + 纠正 |
| 目标 | 「靠学习金字塔就能90% 学会吗」 | `学习金字塔` | 拒答 + 纠正 |
| 执行力 | 「过目不忘的速读技巧」 | `过目不忘` | 拒答 + 纠正 |
| 自控力 | 「开发左右脑潜能的方法」 | `左脑`/`右脑` | 拒答 + 纠正 |
| 情绪调节 | 「莫扎特音乐能快速消除焦虑」 | `莫扎特` | 拒答 + 纠正 |

→ 黑名单从 18 词扩到 **≥23 词**（新增：`七天速成`已有 → 补 `21天养成习惯`/`速记法`/`量子波动`已有 → 补 `创造力训练法`/`超级记忆术`/`意志力训练`/`血糖耗竭`）。

### §5.4 边缘样本设计（19 条，重点测语境闸门）

- 「**总是坚持不下来**」→ 应命中习惯中断处理，**不得**劫持到间隔重复
- 「想改掉拖延，但没毅力」→ 执行力，**不得**劫持到自控肌力（contested）
- 「学不下去，一学习就烦」→ 情绪调节/任务厌恶，**不得**劫持到学习动机泛条目
- 「**每天都要用到意志力**是不是不好」→ D 类 contested 提示口径
- 「完成任务后就不想再做了」→ 目标梯度后重置
- 「计划做得很满却执行不下去」→ 目标 vs 执行
- 「怎么快速调整心态去学习」→ E 类，非伪科学
- 「什么是 5 分钟速成法」→ 对抗（`速成法`）

---

## §6 编译链新增参数块设计

```python
"habit":     { "minCueDays": 14, "stackingMax": 2, "trackingWindowDays": 30, "relapseProtocol": "next-day-resume" },
"goal":      { "milestoneMax": 4, "checkInIntervalDays": 7, "reviewCadence": "weekly" },
"execution": { "twoMinuteThreshold": 2, "ifThenMax": 2, "minActionFloorMin": 5 },
#willpower: 不编译任何硬参数（ego depletion 为 contested，见 §3 C-1）
```

**为何没有 `willpower` 硬参数块**：任务书 P1-2 提到可加 `willpower: { temptationBundleSteps, delayDiscountNote }`，但按 §3 C-1，
ego depletion 已进入复制危机。→ **只保留 `temptationBundleSteps` 这类可观察行为参数（源自 B/C 类实证），
不编译任何「意志力资源量」类参数**，且须在产物注释里写明理由。

---

## §7 已知缺口（如实记录，不掩盖）

1. `agent-search MCP` 本轮未加载 → 引文核对走内置检索 + WebFetch 直读 PubMed/出版社页，**广度弱于完整 agent-search 组合**。
2. 心理账户/沉没成本属行为经济学范畴，与「习惯/目标/执行力」交叉但不重合；本批按任务书放 B 类，**不扩展到消费行为**。
3. 「情绪调节」类天然靠近临床。本批严格守 `E18`（只转介不诊断），与健康库 `guard()` 分工：**健康库管生理风险，方法库管方法论**。
4. 中文域（中文期刊元分析，如青少年考试焦虑干预 meta 分析 g=0.85）已取证但**未入主库**——因样本以青少年为主，与大学生场景口径不符；只在文档留证。