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
