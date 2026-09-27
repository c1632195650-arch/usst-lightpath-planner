# WP 台账 · 2026-09-27 通宵批次（beta-v2）

> 台账规则：本文件与代码同一个 commit 提交，永不脱节。
> 「完成」四要件：① 门禁五门全 PASS；② 反向验证逐条记录（红/绿+验证点）；
> ③ 假绿自查三连通过；④ 改动文件清单与 commit 文件列表逐一对得上。

## §0 基线（活文档，每批收尾更新）

- 起点：`03a11b5`（master，2026-09-22 合流后修复提交）
- 分支：`beta-v2`（扁平名；本机安全软件会拦带斜杠分支名，故不用 feat/*）
- 当前基线（批 6 收尾）：**tsc=0 / engine=350 / ui=267 / intent=69+8(含于 ui) / golden=v1**
  - 批 0 开工：tsc=0 / engine=326 / ui=237 / intent=69；批 1：engine=328 / ui=246；批 2：ui=254；批 3：engine=336；批 5a：ui=267；批 6：engine=350
  - 注：`scripts/gate_overnight.mjs` 内置下限为旧值 312/219；台账以实测更高值为「只增」基线。
- 门禁脚本指纹：`md5(scripts/gate_overnight.mjs) = 7190ca671e5c6e5b6d409aac4e10cd92`（夜里禁改，收尾必核）

## §R 规则抄录（夜班铁律）

- golden 只增不改（v1 冻结）；既有测试期望值不许改（除非台账单独申报改了哪文件哪行+理由）。
- 每条新断言必须反向验证：关掉实现/还原旧代码 → 断言红 → 恢复 → 回绿。没做反向验证的断言按不存在处理。
- 测试基线只增不减（engine ≥326 / ui ≥237 / intent ≥69）。
- 只 `git add` 台账列出的文件；禁 `git add -A` / `git add .`（工作区有他人杂物：M AGENTS.md、
  `.openclaw/`、`.cluster/`、`HEARTBEAT.md`、`IDENTITY.md`、`SOUL.md`、`TOOLS.md`、`USER.md`、
  `.tyc-proxy-capability.json` 等，一律不碰、不提交）。
- 禁：push / reset --hard / rebase / clean / checkout -- . / 切回 master / 删除文件 / 改门禁脚本 /
  起后台进程 / 新依赖 / 改 schema / 改 .env / 碰 data/*.db。
- 遇阻塞：写 BLOCKERS.md（格式：`- [时间] 批次n·阻塞点：<一句话>｜已排除：<试过什么>｜需要人决定：<具体二选一或确认项>`），该批标 [~]，跳下一批。
- 断线恢复协议：对账 `git log --oneline -8` + 重读本台账 + 跑门禁 ≥ 台账值 → 从最后一个 [x] 之后继续。

## §B 批次状态表

| 批 | 内容 | 状态 | commit |
|---|---|---|---|
| 0 | beta-v2 分支 + 台账 | [x] | cc901b5 |
| 1 | WP1 基础信息前置 BasicInfoStep | [x] | bf123f7 |
| 2 | WP2 题库年级分层 + 上理场景化 | [x]（分层口径已拍板 (b)，见 §WP2） | f93fe5d |
| 3 | WP4b 四 bug（B2/B3/B5/B6） | [x] | cfdcf44 |
| 4 | WP11 重要日体系 | [x] | c86549a |
| 5 | WP8-mini + WP9 梨宝改排程 + 预览卡（5a-5d 四小步） | [x]（5b-5d 合并 commit，见 §WP9 申报） | 4294318 + 04e7673 |
| 6 | WP10 拖拽合规（仅余力） | [x] | 20303b5 |

状态图例：[ ] 未开始 / [~] 进行中(含卡点) / [x] 完成(含会话证据)

## §WP1 基础信息前置

- 状态：[x] 完成（2026-09-27 夜，commit 见 WP1:）
- 改动文件清单：
  - `src/lib/identity.ts` — BasicInfo 扩 campus('军工路本部'|'1100')/dorm/sleepMin/exercisePerWeek；grade 收窄为 1-4 数字（Grade 类型 + gradeFromLabel + GRADE_LABELS + CAMPUS_OPTIONS）；loadBasicInfo 逐字段白名单校验 + 旧版「大二」字符串迁移；applyObjectiveFact 年级走解析、解析不了不写入；basicInfoContext 增校区、年级出标签
  - `src/features/welcome/basicInfo.ts`（新）— 纯逻辑：initialView 冷启动闸门 / validateBasicInfo 必填+值域 / parseBasicInfo 草稿解析
  - `src/features/welcome/BasicInfoStep.tsx`（新）— 引导第 1 步 UI；必填缺失禁「下一步」（touched 后禁用+alert）
  - `src/App.tsx` — 净改 8 行（≤10 达标）：View 增 'basicinfo'；:39 改 `useState<View>(() => initialView(state.onboarded))`；Welcome.onStart → basicinfo；新增 basicinfo 渲染分支；handleComplete 去掉 onboarded 写入；PersonaResult.onEnter 加 `patchState({ onboarded: true })`（写入点移到全流程完成）
  - `src/features/persona/personaCopy.ts` — makeEpithet 年级经 gradeLabel 出「大二」式标签（兜底兼容字符串）
  - `src/features/persona/PersonaResult.tsx` — 基础信息卡 grade 输入经 gradeFromLabel 转数字，非法不写入；显示 GRADE_LABELS
  - `scripts/basicInfo.test.ts`（新，10 用例）
  - `tests/identity.test.ts` — 见下方申报
- 反向验证记录（关实现 → 红 → 恢复 → 绿）：
  - RV1 initialView 恒 return 'welcome'（删 onboarded 读取）→ basicInfo.test.ts fail=5（含「onboarded=true 冷启动直进 main」）→ 恢复 → 全绿
  - RV2 validateBasicInfo 改为恒 return {}（删全部必填/值域校验）→ fail=4（必填四项+campus+数字域+坐标）→ 恢复 → 全绿
  - RV3 仅删 campus 值域检查 → fail=2（「campus 非法值被拒」用例红）→ 恢复 → 全绿
  - RV4 applyObjectiveFact 删 gradeFromLabel 解析分支 → identity.test.ts fail=2（「解析不了的年级不写入」「只覆盖对应单字段」红）→ 恢复 → 全绿
  - 恢复字节一致性：md5(identity.ts)=17c4177d…、md5(basicInfo.ts)=29c27bd5…，与改动前备份完全一致
- 既有断言调整申报（假绿自查 3b）：
  - `tests/identity.test.ts` 3 处（「基础信息保存与读取闭环」「applyObjectiveFact 只覆盖对应单字段」「闸门：偏好类 key」）：grade 期望值由字符串「大一/大二」改为数字 1/2 —— 理由：v2 方案 WP1 把 BasicInfo.grade 契约从自由字符串收窄为 1|2|3|4（题库分层 WP2 依赖数字年级），旧字符串在 loadBasicInfo 自动迁移，断言随契约演进；未删任何用例，另新增「WP1 新字段」「解析不了的年级不写入」2 条。
- 门禁：tsc=0 / engine=328(≥326) / ui=246(≥237) / 禁区零改动 / 风格 8 项 — 5/5 PASS
- 遗留：Welcome「先浏览应用」跳过引导不置 onboarded（刷新会再回欢迎页）——符合「未完成引导」语义，不改；如需改动请人拍板。

## §WP2 题库年级分层 + 上理场景化

- 状态：[x] 完成（分层口径已拍板 (b)＝夜班实现，2026-09-27 CY）
- 改动文件清单：
  - `src/data/personaBank.ts` — 全题库上理场景化改写（只动 text，35/35 题面命中场景词）；每题加 sceneTag；10 题加 grades 分层标签；新增 `TieredPersonaItem`（本地扩展 types.ts 的 PersonaItem，**未动契约层**）、`PersonaGrade`、`buildPersonaSequence(grade)`（含 A03 锚定恒插入）；PERSONA_VERSION → 2026.09.27
  - `src/features/persona/PersonaFlow.tsx` — 出卷改 `buildPersonaSequence(loadBasicInfo().grade)`；没填年级（跳过引导）→ 全库 35 题，与分层前一致
  - `src/features/welcome/Welcome.tsx` — 「35 个日常选择」→「按你年级定制的日常选择」（硬编码数字随分层失效）
  - `scripts/personaTiering.test.ts`（新，8 用例：结构冻结/序列差异/A03 恒插入/分层数/标签值域/场景词覆盖/固定作答回归×2）
- **分层口径（已拍板：CY 选 (b) 维持夜班实现，2026-09-27；BLOCKERS.md 有记录）**：方案书测试④「分层后总题数 8~14」存在两种读法：
  (a) 每份年级卷总题数 8~14；(b) 带 grades 标签的分层题总数 8~14。
  夜班按轴覆盖数学核算：若取 (a)，PLAN/RAT/BOLD 等轴的高权重输入题（C01-C05/D01-D05）必然大面积缺席，
  6 个以上轴塌到兜底值 50 —— buildProfile 名义可用、实际失真，且违反「dim 与计分逻辑一个字符都不许动」的
  精神。**故取 (b) 保守口径**：10 题分层（B01[2,3,4] C01[3,4] C02[2,3,4] C05[1,2] D01[1,2] D02[3,4]
  D03[1,2,3] E03[1,2] E08[1,2] A12[1,2]），每份卷 29~33 题，轴覆盖完整。若 CY 确认 (a)，只需改
  personaBank 的 grades 标签（纯数据，revert/重标无涟漪）。
- 反向验证记录（关实现 → 红 → 恢复 → 绿）：
  - RV1 buildPersonaSequence 还原成全库按 order 排列（无年级过滤）→ ST-SEQ 红（pass 7/fail 1）→ 恢复 → 全绿
  - RV2 A03 误挂 grades[2,3] 且删恒插入分支 → fail 2（ST-A03 红）→ 恢复 → 全绿
  - RV3 16 题题面还原成改写前文案 → 仅 ST-WORD 红（pass 7/fail 1，隔离验证）→ 恢复 → 全绿
  - 恢复字节一致性：md5(personaBank.ts)=6bc47991… 与改动前一致（×3 次）
- 固定作答回归（测试⑤）：改写前后同一组固定作答的 buildProfile 轴值**逐值一致**
  （EXP66/PLAN76/SOC84/RES81/ACH75/HEA80/RAT86/BOLD82，原型 healthy，quality ok）
  —— 用 git HEAD 旧题库实测比对，非推断。
- 门禁：tsc=0 / engine=328(持平) / ui=254(+8) / 禁区零改动 / 风格 8 项 — 5/5 PASS
- 遗留：
  - 换年级重测时旧答卷仍留在 answers 里，buildProfile 会吃到非当前卷面的旧答案（buildProfile 属 Ray 属地 + 计分铁律，夜班不碰）；建议白天在 handleComplete 里按当前卷面过滤答卷。
  - Welcome 的「先浏览应用」跳过引导用户没有 grade → 全库出卷（行为正确，仅提示）。

## §WP4b 四 bug

- 状态：[x] 完成（触碰 Ray 属地 2 文件，已走 GATE_ALLOW_FORBIDDEN 显式申报留痕）
- 改动文件清单：
  - `src/features/week/WeekPlanView.tsx` — B2：updateLayer 的 pushUndoSnapshot 移出 setState updater（layerRef 镜像，:449-456 附近）；B3：调用点改传 `overrideAffectedDays(schedule, derived.schedule, weekNo)`（:1277 附近），本地 localizedDaysFor 删除（改用 lib 版）；B5：列级 onDragOver 接 `updatePreview(day, dropTargetMin(null, day, baseBlocks), …)` + onDrop 改用 `dropTargetMin(preview, day, baseBlocks)`
  - `src/lib/planner/localizedReplan.ts` — B3：新增 `localizedDaysFor(layer, overrideDays, weekNo)`（融合天集 = 用户改动天 ∪ 调课天）与 `overrideAffectedDays(base, derived, weekNo)`（原/派生课表逐节比对），均纯函数
  - `src/features/week/dragPreview.ts`（新）— B5：`dropTargetMin` / `columnTailMin` 纯函数（预览与落点同一来源，所见即所得）
  - `server/memory.py` — B6：college 正则加主语前缀非捕获组 `我?(?:是|叫|在|来自|就读(?:于)?|考[进入]了?)?` + 右边界 `(?=$|[，。；,;\s大一二三四五])`（:74-79 附近）
  - `tests/wp4b.test.ts`（新，8 用例）
  - `scripts/test_memory_facts.py` — 补 4 条 B6 口语变体用例
- 实现口径备注（B6）：方案书只写「加右边界」，但右边界单独加**修不了**其自举示例（「我是光电学院」在句尾仍会整段被左端吞入）——故实现为「左端主语前缀吃进非捕获组 + 右边界」，实测修复示例且 15/15 通过。**CY 已确认接受扩口径（2026-09-27）。**
- 反向验证记录（关实现 → 红 → 恢复 → 绿）：
  - RV-B2 快照挪回 updater 内 → B2 源码断言红（pass 4/fail 4 批量实验）→ 恢复 → 8/8 绿
  - RV-B3 localizedDaysFor 去 overrideDays 合并 → B3 两条用例红（同上批量实验）→ 恢复 → 绿
  - RV-B5 onDrop 还原旧口径 + 删 dragover 兜底 → B5 源码断言红（同上批量实验）→ 恢复 → 绿
  - RV-B6 还原旧 college 正则 → 4 条口语变体全 FAIL（Ran 15, failures=4）→ 恢复 → 15/15 OK
  - 恢复一致性：WeekPlanView/localizedReplan/memory.py 均从实验前备份恢复
- 门禁：tsc=0 / engine=336(+8) / ui=254(持平) / 禁区（2 文件显式申报例外 + dragPreview.ts 新增） / 风格 8 项 — 5/5 PASS
- 遗留：B2 的 layerRef 镜像在同一事件内连调两次 updateLayer 时第二次快照可能取到旧值（当前代码无此调用形态；StrictMode 双调用已消除）。

## §WP11 重要日体系

- 状态：[x] 完成（WeekPlanView 1 文件走 GATE_ALLOW_FORBIDDEN 申报）
- 改动文件清单：
  - `src/features/calendar/deadlineStore.ts`（新）— UserDeadline + localStorage 读写（addUserDeadline title 归一、同 title+date 去重）/ mergeDeadlines（去重键 title+date，用户版优先，按日期排序）/ userDeadlineToDeadline（无准备参数=纯提醒，不编准备块）/ upcomingDeadlines（未来 n 个 + 剩余天数）
  - `src/features/libao/libaoIntent.ts` — GoalIntent 增 'add_deadline'；INTENT_PATTERNS 追加触发词（放最后，取消/改时间优先）；REQUIRED 增 ['title','when']；looksLikeAction 增 DEADLINE_MARK 门（在 ADVICE 门后，「怎么备赛」仍走 RAG）；detectIntent 守门：带排程动词/投入信号（安排|规划|排|每周|每天|小时|分钟）→ 仍归 create；新增 `deadlineProposal(slots)` 纯函数（缺 date 或明说没定 → needDate，不猜）；describeSlots 增动词映射
  - `src/features/libao/LbaoChat.tsx` — runGoalSlots 顶部 add_deadline 分流：缺 date → 追问（补 'when' 进追问清单使接续答案可被收）；有 date → 建议卡「要不要按 MM.DD 建立「X」重要日？我会提前 N 天开始帮你安排准备」+ 确认/放弃按钮；confirmDeadline 写 deadlineStore，**不触发任何重排**（铁律）
  - `src/features/week/WeekPlanView.tsx` — expandDeadlines 喂 mergeDeadlines(DEADLINES, loadUserDeadlines())（只在既有重排时机自然参与）；「接下来」横排未来 3 节点（≤3 天红 / ≤7 天黄）
  - `scripts/deadlineStore.test.ts`（新，8 用例）
- 反向验证记录（关实现 → 红 → 恢复 → 绿，批量实验 fail 4）：
  - RV1 mergeDeadlines 还原成只返回静态 → 合并/展开两条红
  - RV2 删 add_deadline 意图条目 → 口令用例红
  - RV3 deadlineProposal 缺日期时返回猜测值 → 「缺 date 必追问」红
  - 恢复 → 8/8 绿 + tsc 0 错
- 门禁：tsc=0 / engine=336 / ui=262(+8) / 禁区（WeekPlanView 1 文件申报例外）/ 风格 8 项 — 5/5 PASS
- 遗留：
  - 重要日建议卡确认后的重排参与时机 = 下一次既有重排（手动「重新排一遍」或新编辑），这是铁律要求的行为；真机演示时需口头说明。
  - 「重要日建议卡」消息未接跨会话恢复（history 恢复的行没有 pendingDeadlines），刷新后按钮消失但不丢数据（已确认的进 store）。
  - WP12 的 deadlineStore→服务端同步不在本批范围。

## §WP8-mini + WP9 梨宝改排程执行器 + 预览卡

- 状态：[x] 完成（5a 独立 commit WP8:；5b-5d 因同文件交织合一个 commit WP9: —— 与「逐小步 commit」的偏差在此申报）
- 改动文件清单：
  - 5a：`src/features/week/miniWeekPreviewModel.ts`（新，纯视图模型）+ `src/features/week/MiniWeekPreview.tsx`（新，零状态零 handler）+ `scripts/miniWeekPreview.test.ts`（新，5 用例）。注：方案书的 `WeekDraft` 类型本仓不存在，草稿/落盘同为 `WeekPlan`，语义由 caption 承载
  - 5b/5c/5d：`src/features/libao/weekPlanForChat.ts` — 执行器纯函数层（防腐层内，合红线）：`findCancelTargets`（user 待办优先 → activity/study 块；课程不进取消通道）/ `applyCancel`（removeTask | excludeBlock）/ `findMoveTargets`（非课程）/ `planReschedule`（走 ripple.dragTo 同一条合规校验，产出 move + 涟漪清单）/ `DraftKind`
  - `src/features/libao/LbaoChat.tsx` — runGoalSlots 按 intent 分流 cancel/reschedule/replace（不再全塞 create 通路）；找不到/命中多个/缺信息一律追问不硬猜；confirmGoal 按 kind 分发落层（每路径一次 undo 快照）；5d：侧栏 MiniWeekPreview（xl+ 显示），落盘 bumpPlanVersion 重算引擎，有未确认草稿时按草稿态算（pending 任务喂 planWeekWithTasks）caption「草稿 · 未落盘」/「本周排程 · 已落盘」
  - `tests/wp9.test.ts`（新，6 用例）
- 反向验证记录（关实现 → 红 → 恢复 → 绿）：
  - 5a RV：删除排序 → 红（pass4/fail1）→ 恢复 → 5/5
  - 5b RV：applyCancel 还原 no-op → 红；5c RV：planReschedule 丢 displaced → 红（批量 pass4/fail2）→ 恢复 → 6/6
- 门禁：tsc=0 / engine=342(+6) / ui=267 / 禁区（本批未动既有禁区文件）/ 风格 8 项 — 5/5 PASS
- 遗留：
  - LbaoChat 的目标匹配基于「planWeekForChat 当周重算」，不含已 excluded/moves 的影响 —— 块 id 与周计划页引擎一致（同 construct），但极端情况下预览可能与页面显示有出入；对齐留 WP12。
  - 侧栏 undo/redo 在周计划页操作时不会实时 bump（聊天页只在自身落盘时刷新）。
  - ModeSetupDialog（依赖 WP5 六模式）按任务书不做，白天批次接入 MiniWeekPreview compact。

## §WP10 拖拽合规

- 状态：[x] 完成（ripple.ts + WeekPlanView 2 文件走 GATE_ALLOW_FORBIDDEN 申报）
- 改动文件清单：
  - `src/lib/planner/ripple.ts` — RippleOptions 增 `compliance?: DragCompliance`（opt-in）；dragTo 落位前两道闸：① 撞用户不可时段 → 「这是你说过没空的时段，我帮你避开它」② 转场余量：相邻块跨校区查 campusLookup 保守转场表、同校区/认不出按 10 分钟 → 「来不及走到 —— 两段安排之间要留出路上的时间」。**引擎主流程不传 compliance，行为与旧版逐字节一致**
  - `src/features/week/WeekPlanView.tsx` — 拖拽用户路径（updatePreview 预览 + handleDrop 落盘）传同一份 `dragCompliance`（本周生效的 layer.slots），预览=落盘口径
  - `tests/wp10.test.ts`（新，8 用例：四类拒绝 + 放行 + 不传 compliance 行为不变 + 文案风格）
- 反向验证记录（关实现 → 红 → 恢复 → 绿）：
  - RV：compliance 闸禁用（置 undefined）→ ①②③ 三条拒绝用例红（pass5/fail3）→ 恢复 → 8/8 绿
- 门禁：tsc=0 / engine=350(+8) / ui=267 / 禁区（2 文件申报例外）/ 风格 8 项 — 5/5 PASS
- 遗留：
  - 「同校区 10 分钟」是保守二值（方案书允许）；真实路网步行分钟依赖后端 route()，留 WP-OP/H6。
  - 转场校验按地点字符串查 campusLookup 关键字，认不出的地点不猜跨校区（只按同校区 10 分钟）——与「不猜」纪律一致，但意味着部分地点的跨校区时长未被强制。

## §WP7 编辑模式 + 七天一行/满溢度（2026-09-27 白天批 A）

- 状态：[x] commit e26efd4；门禁 5/5（engine 375/ui 271）+ golden 5/5
- 反向验证：RV1 面板包裹删除+RV2 阈值位移（fail 2）/ RV3 draggable 门删除（fail 1）→ 恢复 7/7
- 细节：docs/day-batch-report-2026-09-27.md 批 A 节

## §H2 ModeSetupDialog（2026-09-27 白天批 B）

- 状态：[x] commit 1f1a471；门禁 5/5（engine 375/ui 279）+ golden 5/5
- 反向验证：RV1 去 extras 注入 + RV2 删 try/catch → fail 4 → 恢复 8/8
- 细节：docs/day-batch-report-2026-09-27.md 批 B 节

## §WP12 导入恒开 + 双向记忆回写（2026-09-27 白天批 C）

- 状态：[x] commit 44c4543；门禁 5/5（engine 381/ui 279）+ golden 5/5
- 反向验证：RV1 摘发事件 + RV2 删 excluded 分支（fail 2）；RV3 python --reverse（failures=2）
- 申报：server/app.py 整文件 CRLF→LF 归一（CY 属地，白天批次带入 CRLF 违反全仓 LF；真实内容改动 +29/-1 已逐行核对）
- 细节：docs/day-batch-report-2026-09-27.md 批 C 节

## §V 组 · 全量交互复刻（2026-09-27，goal 包 V0-V3）

- 基线演进：开工 1aa3156（engine 381 / ui 280）→ 收官 044e08d（engine 406 / ui 280）；golden v1 零重拍（每批 compare 5/5）；门禁锚 7190ca67 未变；既有断言零改动
- 批 V0（commit e8986dc）：重看引导按钮（replay-onboarding）/ 结果页首落点=导入（无课表）/ 总览 checklist 卡（纯模型 checklist.ts + 全完成自隐藏 + 梨宝 seedQuestion 预填）
  - RV1 checklist done 翻转 + RV2 删重看引导按钮 → fail 4 → 恢复 6/6（tests/v0.test.ts）
- 批 V1（commit c8b61cc）：AchievementPanel 常驻（editMode 门之外）/ SaturationBar detail hover 浮层（dayBreakdown 纯函数）/ urgencyLevel 三档（≤3红≤7橙）/ 换节奏提权第一顺位 / 删除留空白→blankTaskFor 留白块实体（kind:blank 固定任务，daySaturation 不计）
  - RV1 kind 改 activity + RV2 阈值位移 + RV3 挪回包裹内 → fail 3 → 恢复 7/7（tests/v1.test.ts）
- 批 V2（commit c548f8f）：matchCandidate 候选匹配 + clarifyPicking 挑块接续（cancel/reschedule 多命中→按名匹配→草稿卡）/ hold 意图（别排从 cancel 让位，台账申报）+ holdSlotFrom/holdToUnavailableSlot + 确认落 slots + usst:replan 广播重排 / 我的卡文案核对通过（不改）
  - RV1 模糊匹配删 + RV2 hold 条目删（fail 2）/ RV3 缺天猜整天（fail 1）→ 恢复 6/6（tests/v2.test.ts）
- 批 V3（commit 044e08d）：scripts/e2e-journey.mjs（playwright 手动资产 ≥20 断言）+ tests/v3.test.ts（21 断言旅程连线锁）；纯逻辑锁已在 v0/v1/v2 入 ui 门禁
- 细节：docs/v-batch-report-2026-09-27.md

## §TODO 汇总（下一会话第一站）

- 今晚批次（0-6）全部 [x]。白天人工事项：
  1. WP2 分层口径复核（§WP2 的 (a)/(b) 二选一，选 (a) 只需重标 personaBank 的 grades）
  2. 真机走查：WP1 引导流程 / 批3 四 bug 手感 / 梨宝「取消 XX」「把 XX 挪到周五」/ 重要日建议卡 / 侧栏预览卡
  3. beta-v2 → dev 合并评审（人工；注意 AGENTS.md 的他人改动从未被本分支触碰）
- 待后续 WP：WP3(E7·PR)、WP4a(golden v2)、WP5(六模式·golden v3)、WP6(就近食堂·golden v4)、WP7(E5+E6)、WP12(H7 导入+回写)、ModeSetupDialog(依赖 WP5)、WP-OP

### 🔒 2026-09-27 09:05 门禁 fail-open 修复（白天批次）
- `gate_overnight.mjs` 旧版 spawnSync 失败（status===null，如沙箱禁 cmd.exe → EBUSY）时把空输出当成功：
  **禁区门会静默假 PASS**（读不到 git status = 零改动误判）。
- 修复：run() 对 `r.error || r.status === null` 一律返回 code=1；禁区门对 `git status` 读取失败显式 FAIL。
- 门禁脚本新指纹：`md5 = 7190ca671e5c6e5b6d409aac4e10cd92`（旧锚 eb43ce60… 已废止，历史 commit 可查）。

## §WP4a 引擎语义修复（白天批次 2026-09-27）

- 状态：[x] 完成
- 改动文件：
  - `src/lib/planner/model.ts` — 新增 `isRippleBarrier()`（makeRoom/fillGap 统一「不动针」口径：course+meal）
  - `src/lib/planner/ripple.ts` — B1：tail 顺延跳课改 while(changed) 收敛（maxIter 50，修未排序课程数组的漏检）；B4：movable 排除三餐 + `blockedByMeal` + 结果组装回填 fixed（修「只回填 courseBlocks 会把饭弄丢」）；dragTo 撞饭点给人话理由；canMakeRoom 含 blockedByMeal；fillGap 改用统一谓词（语义逐字等价）
  - `src/lib/planner/longLocks.ts` — S1 定住撞饭点 → 同课程款「本周跳过」处置
  - `tests/wp4a.test.ts`（新，4 用例）
- 反向验证：RV-B1（收敛→单遍）红 fail=1 ✓；RV-B4（movable 还原只排课程）红 fail=1 ✓（首版断言咬不住变异——变异产出双份午餐块被 find 掩盖，补「不得出现在顺延清单+块不重复」两条断言后红）。
- golden：**v2 免拍（实证）**——makeRoom 仅被 solver/longLocks/用户路径消费，construct 不引用；`tests/golden-compare.ts` 五快照 ⓪/AC-1/AC-2/AC-3 全 PASS，零漂移。
- 门禁：tsc 0 / engine **354**/354（350+4）/ ui 267 / 禁区（planner 3 文件白天人工操作）/ 风格 8/8。
- 教训：恢复未提交改动**严禁 `git checkout HEAD -- <file>`**（会把 WP4a 改动一起清掉，已重放修复）；用 python 精确反向替换。

## §WP5 六模式重做（白天批次 2026-09-27）

- 状态：[x] 完成
- 改动文件：
  - `src/lib/planner/lifeModePolicy.ts` — LifeModeFactor 扩 `sportSessions/extraMeals/blankBlocks`；新六模式因子表（grind 内卷/balance 均衡/faraway 远方/sport 运动/snack 小馋猫/mine 我的）；旧 id 迁移表 `normalizeLifeModeId`（slack→faraway/food→snack/health→sport/social→balance）；`lifeModeExtrasOf()`
  - `src/data/usst.ts` — LIFE_MODES 换新六模式 + `normalizeLifeMode` 转出口
  - `src/lib/planner/templates.ts` — `EXTRA_MEAL_SLOTS`（下午茶 15:30 / 夜宵 21:00）
  - `src/lib/planner/model.ts` — `PlanRequest.lifeModeExtras?`（opt-in，缺省不生效）
  - `src/lib/planner/construct.ts` — 三参数消费：运动周配额（forceSport 绕过画像触发+隔天分布）/ 加餐窗口（复用 placeMeal 机器，placeMeal 的 meal 类型放宽）/ 自由格（attachTransfers 之后插入防「缺地点盲区」误报，blank 不进 filled 口径）+ notes 诚实汇报
  - `src/features/week/WeekPlanView.tsx` — req 下发 `lifeModeExtras: lifeModeExtrasOf(lifeMode)`
  - `src/App.tsx` — lifeMode 读取口归一（旧 localStorage id 不失效）
  - `tests/wp5.test.ts`（新，9 用例）；`tests/lifeModeAndSocial.test.ts`（申报：2 处「猛攻」→「内卷」，模式重命名的行为级变更）
- 反向验证：RV-1（extras 置 null）红 fail=5 ✓；RV-2（删 forceSport 绕过）红 fail=1（精确命中 bypass 用例）✓。
- golden：**v3 免拍（实证）**——extras 走 opt-in，golden 语料不带 lifeMode → construct 默认路径零改动；compare 5/5 PASS 零漂移 + construct.test（冻结 JSON 比对）全绿。
- 门禁：tsc 0 / engine **363**/363（354+9）/ 禁区（planner+data 人工操作）/ 风格 8/8。
- 遗留：WeekView 模式卡配图（N1-5）；「我的」模式的三滑杆自调（当前=画像+校正原样，不加戏）。

## §WP6 三餐自动就近食堂 + 删「常去食堂」（白天批次 2026-09-27）

- 状态：[x] 完成
- 改动文件：
  - `src/lib/planner/construct.ts` — 新增导出 `pickCanteen()`（候选=主导校区食堂池、排除教职工食堂；规则：饭后有课→「食堂→下节课教学楼」步行分钟最少者；没课→priority 最高者；平局按 priority+名字，确定性）+ placeMeal 集成（`autoCanteen` 参数：显式 mealPlaces 仍最优先；未核实候选如实标 unverified）+ `PlanRequest.mealAutoPlace` 开关消费
  - `src/lib/planner/model.ts` — `PlanRequest.mealAutoPlace?`（opt-in，缺省 = T2 行为）
  - `src/features/week/WeekPlanView.tsx` — req 改传 `mealAutoPlace: true`；**删 MealPlaceSetting 三处接线**（import/handleMealPlacesChange/渲染行）+ 删 MealPlaces 导入
  - `src/features/week/userPlanStore.ts` — `setMealPlace` 废弃为 no-op 存根（防旧数据/旧调用方断裂，下下版删）
  - `src/lib/lbao.ts` — HEADLINES/focusAxis 迁移到新六模式 id + 入口归一（lbaoShell 吃旧 id 也不崩）
  - `tests/wp6.test.ts`（新，5 用例）；`tests/userPlanStore.test.ts`（申报：R2 两条 setMealPlace 断言迁移为「存根不写入」）
- 反向验证：RV-1（拆 auto 分支）红 fail=1 ✓；RV-2（最近比较还原取第一个）红 fail=1 ✓（各自精确命中）。
- golden：**v4 免拍（实证）**——mealAutoPlace 走 opt-in，golden 语料不带该开关 → construct 默认路径（place 空）零改动；compare 5/5 PASS。
- 门禁：tsc 0 / engine **368**/368（363+5）/ ui **271**/271（267+5 wp6 -1 迁移）/ 禁区（planner+week 人工操作）/ 风格 8/8。
- 遗留：图片识别课表（N2-1）；真机手感验收（三餐 place 显示、自由格卡渲染）。

## §S 梨宝追问链路整改（无人值守批次 2026-09-27，工作单：MOSS《梨宝追问链路整改包（S 批）》）

- 状态：[x] 完成（S1–S4 四批全落；**金标已 CY 复核定稿 2026-09-27 晚**，见评测报告 🔒 段）
- 诉求→落点：①完整追问=保留式追问(missStreak 双闸)；②单独排程模式=collect 状态机(退出词/打断/作废全有声)；③语义级意图=/api/plan/understand LLM 端点+llmExtractor 通电(规则字段永不覆盖)；④分号批量回答=splitAnswers+applyClarifyAnswers 位置对应协议；⑤先过 LLM 再追问=应答规则先行+LLM 定位救援(结构化始终在规则层)；⑥多轮测试=E2E 10 剧本 42 断言+在线/离线双通道金标评测
- 改动文件（全 CY 名下）：
  - `src/features/libao/libaoIntent.ts` — splitAnswers/stripAnswerNumbering/applyClarifyAnswers/applyClarifyFragments/topQuestionPairs/questionsForSlots（applyClarifyAnswer 保留为单段路径，新协议是其超集）
  - `src/features/libao/schedSession.ts`（新）— 退出词表(归一后整句相等)/nextMissStreak/作废线=2/回执话术
  - `src/features/libao/LbaoChat.tsx` — clarify 态 {slots,asked}、schedMode/missStreak、updateClarify/updatePicking 唯一写入口、send 优先级(退出>挑块>应答>打断>保留)、徽章+placeholder、快照 v2、llmExtractor/rescueClarifyAnswer 接线、send 门补 add_deadline 无 title 放行（S4 E2E 抓到的 V 批同族缺口）
  - `src/lib/api.ts` — planUnderstand 客户端（9s AbortSignal，失败恒 ok:false 不弹错）
  - `server/plan_dialog.py`（新）+ `server/app.py`（include_router 注册；**动前申报**：既有 WIP=PORT env 1 行+CRLF 行尾，已单独 commit 1a12c53 隔离）
  - `evals/golden/plan_understand.jsonl`（新，60 条=30 intent+20 answer+10 boundary，**zcode 起草稿**）；`scripts/eval_plan_understand.py`（在线/离线双通道）、`scripts/eval_understand_offline.mjs`（规则对照 harness）；`scripts/schedSession.test.ts`（新 9 用例）；`scripts/libaoIntent.test.ts`（+20 用例）
  - `scripts/e2e-sched-session.mjs`（新，10 剧本 42 断言，与 e2e-journey 同级手动验收资产）；`docs/libao-clarify-spec.md`（新，设计定稿）；`docs/eval-libao-understand-2026-09-27.md`（新，评测原始数据）
- 反向验证锚点（删实现必红）：splitAnswers 编号剥离→编号用例红；applyClarifyAnswers 位置对应→乱序用例红；nextMissStreak 算回应清零→折返剧本红/删无关+1→永不过期红；isExitCommand 词表→退出剧本红；plan_dialog 8s 超时→离线评测对照红。E2E 剧本 I2 是 P4 的直接守卫（collect 态非动作句不掉 RAG）。
- 评测（docs/eval-libao-understand-2026-09-27.md）：离线规则对照 action F1 0.868；在线（deepseek-chat）action P/R/F1=1.0/1.0/**1.0**、intent 槽位 EM=**0.923**（逐槽，门槛≥0.90 ✅；逐条口径 0.862）、answer 槽位命中 0.926（25/27）。评测中修复：answer scene prompt 未规定输出 JSON 形状 → 0/27，补「输出格式」后 25/27。
- E2E：A 折返(8) B 两轮无关才作废(4) C 退出(3) D 挑块接续(4) E hold(2) F 重要日(2) G LLM 离线降级(2) H 草稿落盘(2) I collect 态不过 looksLikeAction(2) J 跨刷新快照恢复含 v2 字段(4) = **42/0**（测试作用域 vite，跑完即清，端口已核释放）
- 门禁：tsc 0 / engine 408/0 / ui 309/0（280+20+9）/ 禁区零改动 / 风格 8/8（gate_overnight 全过，S2 时点实测；S3/S4 后复跑见各 commit）
- 遗留：①~~金标 60 条待 CY 复核定稿~~ → **已定稿（2026-09-27 19:50）**：CY 复核 8 处修正（1 处语义错误 i10 title 驾照→科目一、2 处 title 精确化、4 个 create 补 title、i15 补 when/i14 补 window），其余 52 条通过；定稿金标重跑在线门槛三轮全过（action F1 1.0/0.983、逐槽 EM 0.966/0.931），详见评测报告 🔒 段；②intent 逐条 EM 残留缺口与 a09「还没定」归位不稳，已记评测报告已知缺口 1–3（含改法候选）；③无人在场，真实后端 8001 的联网真机手感（含 LLM 在线的对话流畅度）待白天复验；④本批运行过程出现多次工具回显不可信（路径/内容错乱），所有结论均已用原子命令交叉核验，建议白天抽查本台账逐项（CY 复核轮已原子命令复验金标 60 行 JSONL 合法、8 处修改落盘、评测数字与报告一致）。

### §S·R CY 复核落地（2026-09-27 深夜，复核结论三条）

- ①a09 归位不稳 → **未改金标**：评测改双侧同归一（金标片段与预测片段都过规则层 canon——生产落库的本来就是归一值，「还没定→时间待定」自然互含）+ 规则先行（VAGUE_WHEN 直接命中，不依赖 LLM）。answer 0.962（25/26），a09 稳定命中。
- ②i30 隔天口径 → 金标 4 次/周维持；评测改生产忠实：规则已抽槽位随请求传端点、合并只补空（mergeSlots 语义）；EM(TP)=0.93 ≥0.90。
- ③8s 超时 → 设计行为不改码：ok:false → 生产回规则结果，评测同口径计分不重试；本轮 43/43 ok。
- harness 扩 rules/canon 两模式 + 评测脚本 v3 重写（临时文件交接 + shell=False，修 canon JSON 进 argv 被 Windows shell 搅碎的 ENOENT/NoneType 崩溃）。
- **新量化缺口（记 BLOCKERS 待拍板）**：生产链路 action F1=0.868——looksLikeAction 闸拦 7 条无关键词句（i02/i15/i21/i23/i25/i29/i30，含诉求④原句 i02），端点直判参考线 1.0（17 条规则拦下项全对，含 10 边界句）。缺口在「规则拒绝后不咨询 LLM」的接线，不在端点能力。
- 门禁：py_compile / node --check 过；改动仅 scripts/eval_* 与 docs，门禁五项复跑见下批 commit。

### §T 理解层换向（2026-09-27 20:50，MOSS 直改；CY 拍板「不可能找完所有关键词，排程问题让 LLM 先看」）

- 触发：CY 真机截图翻车——「这周我有一个面试」问投入，用户答「周二晚上；正好是操场跑步的时间」→ 对位解析失败被当无关消息 → missStreak=2 会话作废 → 「周二晚上；6点到7点」掉 RAG。zcode §S·R 的 BLOCKER（规则拒绝句是否送端点复判）由本批**落地实现**。
- 换向（commit 934a9b1）：`parseGoalIntent` 改 **llmJudge 先行**——所有消息（含关键词闸判 false 的句子）先过 `/api/plan/understand`；action=true → `mergeLlmPrimary`（LLM 槽位为主，日期换算仍走 resolveWhen）；高置信否决才交 RAG；端点挂/低置信落回规则闸（离线可用性不变）。应答侧 asked 降为「位置提示」：跨槽收编（问投入答时间收 when，whenScore 只升不降）+ when 权威替换 + 「6点到7点」时段=时长（spanDurationMin 仅回答语境）。
- 门禁：tsc 0 / ui 319/0（+10 用例；**申报 2 条 S1 断言翻转**：位置对应→跨槽收编）/ engine 408/0；RV×2 复现红（删跨槽收编恰 2 红、删时段兜底恰 1 红，还原 sha256 3bbd8bf3… 一致）。
- 截图场景探针实证（8002 隔离实例）：①asked=effort 答时间 → 端点归位 `{when:"周二晚上"}`；②作废续答 + history → `action:true, title:面试, durationMin:60`——不再掉 RAG。
- 口径申报：zcode 3d4ee9a 的 v3 harness 生产口径 = S 批模型（规则先行），T 批后生产为 LLM 先看，v3 的 7 条 FN 在生产中由 LLM 接住（其「端点直判参考线 1.0」+ 本批探针双实证）；**harness v4 对齐 LLM-first 口径待下批**（避免并发改它刚落地的 harness）。本节入库连同上方 §S·R（zcode 已提交 3d4ee9a 的配套台账，内容核对一致后一并落盘，特此申报）；BLOCKERS.md 两条未提交 WIP 原样保留未动。
- 待办：①CY 真机复测截图场景（8001 后端**需重启**才会加载 T 批 prompt——现跑的是旧代码）；②harness v4；③beta-v2 推送（934a9b1 + S 批 + 7674334 均未推远端）。

### §D 对话管理器化（2026-09-27 夜～28 凌晨，MOSS《对话管理器化通宵重构包（D 批·全量）》，zcode 执行）

- 授权对账：基线 `0b35275` ✓；gate md5 `7190ca67` 未动 ✓；tracked 仅 BLOCKERS.md 未提交 ✓；门禁复跑 tsc 0 / engine 408 / ui 319 全绿 ✓。
- **权限变更行使（申报）**：CY 21:48 授权本次可改 `lib/planner/construct.ts / templates.ts`（Ray 名下）——D4 引擎修复按工作单 §6 执行；门禁以 `GATE_ALLOW_FORBIDDEN=src/lib/planner/construct.ts,src/lib/planner/templates.ts` 显式放行（门禁脚本本身未改，md5 未动，输出留痕）；commit de9a4d4 高亮申报。
- D0（3ea5059）：双模式按钮——`mode` 状态入快照、问答模式排程意图出「切到排程模式并继续」提示卡不静默改道（原句 forceMode 重发）；切回问答=显式退出（EXIT_ACK）。
- D1（e0b4877）：`dialogManager.ts` 新建（纯逻辑）——DialogTopic 四相构造器、序列化白名单（slots 9+1 键/候选≤5/≤4KB/target 不外发）、`validateDialogAct` 防编造、快照 v3（写 `usst.libao.chat.v3`，读失败回读 v2 合成，v1 链保留，sanitizeTopic 脏数据当没有）。**与工作单偏差（申报）**：ClarifyState/PickingState 保留为派生形状类型、updateClarify/updatePicking 保留为写入口适配器（内部统一落 topic）——状态容器已单一化，12 处规则链路写入点零漂移，v2.test 源码字面量断言原样存活；新写入点（markDraft/markBlocked/ACT_EXECUTORS）直接走 topic。
- D2（8bfc028）：`scene='dialog'`（置于 answer 之前防 no_asked 守卫）+ `_SYSTEM_DIALOG` + `_clean_dialog` 白名单与 state 对账 + per-scene max_tokens(dialog 400)；金标 60→100（+40 dialog：act 25/idx 8/防编造负例 7，只增不改，起草自验通过）。
- D3（d7df363）：send() 优先级链（①isExitCommand 确定性 → ②sched+在线 tryDialogAct 每轮恰 1 次，`DIALOG_ENABLED` 总回退开关 → ③规则链路原样兜底 → ④chat 模式 D0 提示卡）；ACT_EXECUTORS×8（confirm 双闸=confidence≥0.8+整句确认词表；new_intent 续答不打断/打断有声回执/replace 隐含用 priorFailed；chit_chat 走 ragReply 共用段且议题保留）；topic 生命周期 markDraft/markBlocked 接线；runReplace 多候选改道 picking（B②）；findCancelTargets 候选带日期 hint；GoalVerdict 预置 blockingBlocks 字段。
- D4（de9a4d4）：templates/construct——UserTask/ActivityTemplate 增 `budgetExempt`（豁免活动预算闸+每日上限闸+**eveningAllowed 自律**：normal 周相 18:00 后不开新块，用户点名「晚上」否则恒被拦，DoD 前提）与 `notAfterMin`（放置上界）；essentialMin 累计含 budgetExempt；goalToTasks 产出 budgetExempt+notAfterMin（window.toMin 不再丢）；checkGoalFeasibility placed 改按 id 认领+blockingBlocks（基线 activity/study×星期×窗，≤5 条）；describeVerdict 去硬编码（有事实列事实，无投入量不说「降一档」）。**DoD 引擎级验证**：探针「明天晚上出去玩一小时」21:05-22:35 真排上、与操场跑步同日共存、窗内结束；固化为 d-batch 引擎用例 2 条（RV：撤 budgetExempt/notAfterMin 即红）。
- D5（a20f4d6 + f567a7e）：相关性门——relevance_gate（问题+top4 标题/400 字摘要→廉价 LLM 判 relevant）接 api_chat 3.8 步，irrelevant→route 降级 'llm'，响应增 `relevance` 观测字段，300s TTL 缓存，LLM 不可用保持现状不加伪门。判据两轮迭代（回答性→主题级→「同一件事/能否作依据」+证据 400 字）；**评测正例修正（申报）**：原 p1「图书馆几点开门」经 /api/search 核实库内无开放时间文章，门拦下是对的（诚实口径优先），换为检索可证正例 p1-p3。
- D6（e7d7292 + f567a7e）：E2E 剧本 K/L/M/N（LLM 边界 route.mock 定死——dialog 罐头/intent 拔线，与 G 同手法；引擎级 blocked 由 D4 用例覆盖、K/M 的 blocked 相由 v3 快照注入）：K 议题续用 1 轮出 replace 草稿不重问✓、L「明天的那个」1 轮命中✓、M 协商引用挡路事实✓、N 模式三段✓；**E2E A-N 60/0**。**断言漂移申报**：A6（出草稿徽章不消失→徽章按相位说话，草稿相位可语音确认会话未结束）、J1/J2（快照 v2 键→v3 键与字段）；findCancelTargets 顺带修既有双通道重复候选缺陷（固定用户任务在 layer.tasks 与引擎 plan 各出一候选，按 `-user-{taskId}` 去重）。
- 在线评测（8001 隔离实例，报告 docs/eval-libao-understand-2026-09-27.md）：**dialog 组门槛全过**——act 宏 F1 0.955（acc 0.95，38/40）/idx EM 1.0（8/8）/非法输出拦截率 100%（7/7）✅✅；D5 相关性门负例 5/5 拦下+正例 3/3 不受影响 ✅。**S/T 组本晚 F1 0.868 未过（申报）**：端点 ok 42/67，DeepSeek 超时率高所致——直接复验 FN 条目（i02 553ms/i03 1056ms）端点均正确应答，属环境方差非 D 批回归（D 批未触碰 intent/answer 链路代码），白天空闲时复跑即可。
- 门禁（D6 收尾）：tsc 0 / engine 421/0（408+13 新增）/ ui 319/0 / 禁区零改动（D4 两文件经显式申报放行）/ 风格 8/8。
- 遗留：①dialog 金标 40 条待 CY/MOSS 终验复核（工作单 §10.4）；②S/T 组空闲时复跑取干净门槛数据；③8002 真机重放三截图原句+离线降级待白天（§10.5）；④updateClarify/updatePicking 适配器偏差（见 D1）若 CY 拍板「彻底删除」，改动面=12 处调用点机械替换，无行为差异；⑤D7 replan 协商循环按余力批处理（见下节）。

### §D7 replan 协商循环（2026-09-28 凌晨，余力批照做，commit 9639399）

- blocked 时 negotiate_block 执行器调用 `proposeReplanOptions`（防腐层新纯函数）生成 ≤3 条编号方案：①与挡路块互换（replace 语义，干跑基线经 `excludeBlockIds` 挖掉该块——construct 排除机制复用）②顺延一周 ③降单次时长；**每个方案必须过一次引擎干跑**，排得上的才呈现——「禁止 LLM 编排好了」由两层保证（方案由引擎产出；选中后仍走 runGoalSlots→草稿卡→确认，L4 不变）。
- LLM 只做引用：blocking.options 序列化只发 id+label（slots 不进 LLM 上下文）；用户回编号 → dialog act=new_intent + replan_id（照抄 id，_clean_dialog 白名单透传）→ 执行器取干跑过的槽位直走草稿通路。
- 测试：D7 引擎级用例（blocked 夹具三块占满晚间→方案逐条干跑自洽；RV：删干跑过滤即红）engine 421→422；E2E A-N 60/0 回归；门禁五项全过。M 剧本回归时 negotiate 回复升级为「事实+可行方案」口径，M1-M3 断言不受影响。

### §D·终验自查（2026-09-28 凌晨，对应工作单 §10）

- §10.3 RV 抽查 3 条：①dialogManager 防编造 idx 校验拆除→D1 红；②proposeReplanOptions 干跑过滤拆除→D7 红；③confirm_draft 词表闸拆除→D3 红；逐一还原后 sha256 与 HEAD 一致（dialogManager/weekPlanForChat/LbaoChat），`git status` src/ 零残留。
- §10.5 真机重放（8002 隔离后端 + VITE_API_BASE 指向 8002 的 5173 实例，活 LLM）：7/0 全过——「明天晚上出去玩一小时」「把操场跑步替换掉」dialog 场景确实被调用且未掉 RAG；问答模式提示卡→切换重发直达排程流；route.abort 全断后规则兜底出草稿并确认落盘。首跑 2 挂为旧 vite 实例未死（仍指 8000）所致环境问题，非代码缺陷。
- §10.2 最终门禁见下（tsc/engine 422/ui 319/禁区/风格）。

### §E 知识融合与周视图交互升级（2026-09-28 夜，MOSS《E 批·全量》工作单，zcode 执行）

- 状态：**E0 完成；E1–E5 阻塞（缺 CY 逐项授权，未擅动）；E6 收口完成**（E2E 新剧本 O/P/Q 与附录 B 步数实测依赖 E4/E5，一并顺延）。
- 授权对账：开工基线 `4044330` ✓；gate md5 `7190ca671e5c6e5b6d409aac4e10cd92` 未动 ✓；开工时 tracked 零未提交改动 ✓；**执行中途 HEAD 前移至 `dc4bbdf`（§D·终验自查，纯文档 commit，并行会话所加，与本批零文件交集），对账后继续**。
- **E0 基线实测（本批地板线，只增不减）**：
  - 门禁五门：tsc 0 错 / engine **422** fail 0 / ui **319** fail 0 / 禁区零改动 / 风格 8 项 — 全 PASS；
  - playwright smoke（`e2e/smoke.spec.ts`）：3 用例 = 2 过 / 1 挂（「视觉基线：入口页」红——基线快照 PNG 的 IDAT 数据流截断（zlib inflate unexpected end of file），git blob `cb6a88e8` 与工作区逐字节一致 = 入库前（9/20 抓基线时）已损坏，非本批造成，申报见 BLOCKERS）；
  - E2E A–N（`scripts/e2e-sched-session.mjs`）：隔离 vite 实例（5176，测试作用域起停、端口已核释放）实测 **60 过 / 0 挂**，与 D7 收尾口径一致；
  - 排查备注：共享 5173 常驻 vite（PID 20176，非本批所起，未杀）上同脚本出 B3/B4/D3/F1 假失败——served 文件含 D7 标记确认服务本树，判定为实例陈旧状态所致（与 §D·终验自查 §10.5「旧 vite 实例未死」同类环境问题），已在 BLOCKERS 留痕。
- **E0 落地物**：
  - `docs/week-view-design.md`（新）——设计规范定稿：三原则（视觉重心唯一 / L0-L1-L2 分层 / 动效节制）、令牌表（复用 tailwind 现有色，不新造）、三处"字太多"可量化处置、E5 抽屉与动作条条款、诚实原则（`≈` 估算标注 / L3 口径）、E4/E5 DoD 引用门槛；
  - `AGENTS.md` §七 文档地图 +1 行索引（AGENTS.md 为 CY 名下协作文档，工作单 E0 明确要求，特此申报）；
  - `BLOCKERS.md` +5 条：E1–E5 授权申报（主阻塞）、依赖闸门决议（附录 A 候选待拍板，本批零新依赖成立）、smoke 快照既有损坏、`effective_to` schema roadmap 登记（P1 第二步，不动库）、5173 假失败环境备注。
- **E1–E5 阻塞详情**：五批全部触及 RAY 属地——E1 `lib/planner/knowledge.ts`（新）+ `buildPhases.ts`/`construct.ts` 接入；E2 `placesPolicy.ts`（新）+ `construct.ts`；E3 `profilePrefs.ts`（新）；E4 `features/week/weekViewModel.ts`（新）+ `WeekPlanView.tsx`（1989 行）；E5 `components/ui/` 新组件 + `WeekPlanView.tsx`。工作单 §11 要求动工前获 CY 逐项授权；本轮 /goal 未携带逐项授权，AGENTS.md §8.1（无人值守协议，优先级最高）规定禁区文件一律申报不擅动。全仓检索确认无既有 E 批授权记录（D 批先例：CY 显式逐项授权后才动 construct/templates）。**F 批建议执行顺序：E1→E2→E3（引擎线，各自独立 commit+申报+golden 对比）→E4→E5（呈现线，`WEEK_VIEW_V3=false` 回退开关）→E6 全量收口**。
- 本批改动文件清单（与 commit 逐一对得上）：`docs/week-view-design.md`（新）/ `AGENTS.md`（+1 行）/ `BLOCKERS.md`（+5 条）/ `docs/wp-ledger-v2.md`（本节）。零代码改动、零依赖改动、零禁区改动。
- 门禁（E6 收尾复跑）：五门全 PASS（数字同 E0 基线，本批纯文档无增量用例）。
