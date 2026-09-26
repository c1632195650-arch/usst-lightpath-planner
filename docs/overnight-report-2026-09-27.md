# 通宵执行报告 · 2026-09-27（beta-v2 分支）

> 执行体：ZCode 无人值守夜间批次。任务书：`docs/plan-v2-2026-09-26.md` 批次子集。
> 本报告只写有命令实据的结论；每批改动文件带行号、命令带关键输出。
> 台账（批次状态/反向验证/断言申报）：`docs/wp-ledger-v2.md`。阻塞项：`BLOCKERS.md`（如有）。

## 环境对账（开工时）

- `git rev-parse --abbrev-ref HEAD` → master；`git log --oneline -1` → `03a11b5`
- `md5sum scripts/gate_overnight.mjs` → `eb43ce60816d4691a8b209f3904dcb3b`（每批收尾复核，未变）
- 开工门禁：tsc=0 / engine=326 / ui=237 / 禁区零改动 / 风格 8 项 → 5/5 PASS

## 批 0 · beta-v2 分支 + 台账 —— commit `cc901b5`

- `git checkout -b beta-v2`；`git rev-parse --verify refs/heads/beta-v2` → 存在（扁平名通过）
- 新建 `docs/wp-ledger-v2.md`（基线/规则抄录/批次状态表/各 WP 节），单独提交，未夹带任何杂物
- 收尾门禁 5/5 PASS（engine=326 / ui=237）

## 批 1 · WP1 基础信息前置

**改动文件与关键行号**

| 文件 | 改动 |
|---|---|
| `src/lib/identity.ts` | BasicInfo 增 campus/dorm/sleepMin/exercisePerWeek；grade 收窄 1-4（`Grade`/`gradeFromLabel`/`GRADE_LABELS`/`CAMPUS_OPTIONS`，:16-56 附近）；loadBasicInfo 白名单校验+旧字符串迁移（:100-129 附近）；applyObjectiveFact 年级解析（:135-155 附近）；basicInfoContext 增校区/年级标签（:180 附近） |
| `src/features/welcome/basicInfo.ts`（新） | `initialView` / `validateBasicInfo` / `parseBasicInfo` / `EMPTY_DRAFT` |
| `src/features/welcome/BasicInfoStep.tsx`（新） | 引导第 1 步 UI：必填四项（称呼/年级/学院/校区），缺禁「下一步」；campus 只认 军工路本部/1100；宿舍禁坐标；sleepMin 0-1440 / exercisePerWeek 0-7 |
| `src/App.tsx` | 净改 8 行：View 增 'basicinfo'（:17）；`useState<View>(() => initialView(state.onboarded))`（:40）；onStart→basicinfo（:151）；basicinfo 渲染分支（:157-159）；handleComplete 去 onboarded（:108）；result onEnter 写 onboarded（:172） |
| `src/features/persona/personaCopy.ts` | makeEpithet 年级经 gradeLabel 标签化（:187-196 附近） |
| `src/features/persona/PersonaResult.tsx` | 基础信息卡 grade 转数字写入/标签显示（:25-44、:49-53 附近） |
| `scripts/basicInfo.test.ts`（新） | 10 用例：冷启动闸门/必填/campus 值域/数字域/宿舍禁坐标/草稿解析 |
| `tests/identity.test.ts` | 3 处 grade 期望值 字符串→数字（已申报，见台账 3b 节）+ 新增 2 用例 |

**命令实据**

- `npm run --silent typecheck` → TSC-OK
- `node --import ./scripts/register-alias.mjs --test scripts/basicInfo.test.ts tests/identity.test.ts scripts/personaCopy.test.ts` → tests 28 / pass 28 / fail 0
- 反向验证 4 组（RV1-RV4，详见台账 §WP1）：关实现 → 红（fail 5/4/2/2）→ 恢复 → 绿；恢复后 md5 与改动前一致
- 收尾门禁：**tsc=0 / engine=328 / ui=246 / 禁区零改动 / 风格 8 项 → 5/5 PASS**；`md5sum scripts/gate_overnight.mjs` → `eb43ce60…` 未变

**遗留**：Welcome「先浏览应用」跳过引导不置 onboarded（刷新回欢迎页）——语义正确，未改；如需改请人拍板。

---
## 批 2 · WP2 题库年级分层 + 上理场景化 —— commit（WP2:）

**改动文件与关键行号**

| 文件 | 改动 |
|---|---|
| `src/data/personaBank.ts` | 35 题题面全量上理场景化（军工路食堂/图书馆通宵区/1100通勤/光电杯/体育大课/校园跑/早八/社团…）；每题加 sceneTag；10 题加 grades 分层标签；新增 `TieredPersonaItem`/`PersonaGrade`/`buildPersonaSequence(grade)`（A03 锚定恒插入）；PERSONA_VERSION → 2026.09.27。**未动 types.ts**（本地 interface extends） |
| `src/features/persona/PersonaFlow.tsx` | :27 出卷改 `buildPersonaSequence(loadBasicInfo().grade)`；goNext 不变 |
| `src/features/welcome/Welcome.tsx` | 「35 个日常选择」→「按你年级定制的日常选择」 |
| `scripts/personaTiering.test.ts`（新） | 8 用例，含结构冻结机械比对（保证只动题面） |

**关键决策（待 CY 复核）**：测试④「分层后总题数 8~14」取保守口径 (b)（分层题总数 10 ∈ 8~14），
弃口径 (a)（每份卷 8~14 题）——(a) 会使多数轴塌到兜底值 50。详见台账 §WP2。

**命令实据**

- `npm run --silent typecheck` → TSC-OK
- `node --test scripts/personaTiering.test.ts` → 8/8；`npm run test:ui` 全量 254/254
- 回归⑤：`git show HEAD:src/data/personaBank.ts`（旧库）vs 新库，同一固定作答 → 8 轴逐值一致
  （EXP66/PLAN76/SOC84/RES81/ACH75/HEA80/RAT86/BOLD82，healthy，ok）
- 反向验证 RV1/RV2/RV3（序列还原/A03 恒插入/场景词）均 红→恢复→绿，恢复后 md5 一致
- 收尾门禁 5/5 PASS：tsc=0 / engine=328 / ui=254；门禁脚本 md5 未变

**遗留**：换年级重测时旧答卷未按当前卷面过滤（buildProfile 属 Ray 属地+计分铁律，夜班不碰）。

---
## 批 3 · WP4b 四 bug —— commit（WP4b:）

**改动文件与关键行号**

| 文件 | 改动 |
|---|---|
| `src/features/week/WeekPlanView.tsx` | B2 updateLayer 快照移出 updater（layerRef，:449-456）；B3 调用点传 overrideAffectedDays（:1280 附近）；B5 列级 onDragOver 接影子兜底 + onDrop 统一 dropTargetMin（:1630 附近） |
| `src/lib/planner/localizedReplan.ts` | B3 新增 `localizedDaysFor`（融合天集 ∪ 调课天）与 `overrideAffectedDays`（原/派生课表比对）纯函数 |
| `src/features/week/dragPreview.ts`（新） | B5 `dropTargetMin`/`columnTailMin`：影子与落点同一来源 |
| `server/memory.py` | B6 college 正则：主语前缀非捕获组 + 右边界（:74-79） |
| `tests/wp4b.test.ts`（新） | 8 用例（B3 端到端含「apply 后切周再切回覆写仍在」对拍） |
| `scripts/test_memory_facts.py` | B6 补 4 条口语变体 |

**命令实据**

- `npm run --silent typecheck` → TSC-OK；`tests/wp4b.test.ts` → 8/8
- `python scripts/test_memory_facts.py` → Ran 15, OK（含 4 条新变体）
- 反向验证 RV-B2/B3/B5（批量实验 fail 4）与 RV-B6（failures=4）均 红→恢复→绿
- 收尾门禁 5/5 PASS：tsc=0 / engine=336 / ui=254；**禁区例外已按门禁机制显式申报**
  （`GATE_ALLOW_FORBIDDEN="src/features/week/WeekPlanView.tsx,src/lib/planner/localizedReplan.ts"`，
  输出留痕「人工批准的例外 2 个」）；门禁脚本 md5 未变

**实现口径备注**：B6 方案书的「只加右边界」修不了其自举示例（句尾「我是光电学院」仍整段吞入），
实现扩为「主语前缀吃进非捕获组 + 右边界」，示例实测修复。

---
## 批 4 · WP11 重要日体系 —— commit（WP11:）

**改动文件与关键行号**

| 文件 | 改动 |
|---|---|
| `src/features/calendar/deadlineStore.ts`（新） | UserDeadline 存储 + mergeDeadlines（title+date 去重、用户优先）+ upcomingDeadlines |
| `src/features/libao/libaoIntent.ts` | 'add_deadline' 意图（触发词放最后）+ looksLikeAction DEADLINE_MARK 门 + detectIntent 排程信号守门 + deadlineProposal 纯函数（缺 date 必追问） |
| `src/features/libao/LbaoChat.tsx` | runGoalSlots add_deadline 分流 → 追问 / 建议卡 + confirmDeadline（只落库不重排） |
| `src/features/week/WeekPlanView.tsx` | expandDeadlines 吃合并表；「接下来」横排 3 节点（≤3 天红/≤7 天黄） |
| `scripts/deadlineStore.test.ts`（新） | 8 用例 |

**关键决策**：「备赛」触发词与既有 create 流冲突（旗舰句「帮我规划一下备赛安排」会被抢）——
在 detectIntent 加守门：带排程动词/投入信号的仍归 create，262 条既有用例全绿佐证。

**命令实据**

- `npm run --silent typecheck` → TSC-OK；`npm run test:ui` → 262/262
- 反向验证 RV1/RV2/RV3（批量 fail 4）→ 恢复 → 8/8 绿
- 收尾门禁 5/5 PASS：tsc=0 / engine=336 / ui=262；禁区例外 1 个已申报留痕；md5 未变

---
## 批 5 · WP8-mini + WP9（四小步独立 commit）

### 5a · MiniWeekPreview 纯组件 —— commit（WP8:）

- `src/features/week/miniWeekPreviewModel.ts`（新）：纯视图模型（分组/排序/紧凑/空态/确定性）。
  node --test 跑不了 JSX，验收做在模型层；`MiniWeekPreview.tsx` 只是薄映射。
- `src/features/week/MiniWeekPreview.tsx`（新）：零状态零 handler（`data-testid="mini-week-preview"`）。
- `scripts/miniWeekPreview.test.ts`（新，5 用例）；反向：删除排序 → 红（pass4/fail1）→ 恢复 → 5/5 绿
- 门禁 5/5 PASS（tsc=0 / engine=336 / ui=267）；禁区仅新增文件（未动既有）
- 注：方案书的 `WeekDraft` 类型在本仓不存在，草稿态与正式排程同为 `WeekPlan`，语义由 caption 承载。

---
### 5b-5d · cancel / reschedule / replace 执行器 + 预览侧栏 —— commit（WP9:）

- `src/features/libao/weekPlanForChat.ts` — 执行器纯函数层（放在防腐层内以守住
  「features/libao 禁 import lib/planner」红线）：`findCancelTargets`（user 待办优先 →
  activity/study 块，课程不进取消通道）/ `applyCancel`（removeTask | excludeBlock）/
  `findMoveTargets` / `planReschedule`（走 ripple.dragTo 同一条合规校验 + 涟漪清单）+ `DraftKind`
- `src/features/libao/LbaoChat.tsx` — runGoalSlots 按 intent 分流；找不到/多个/缺信息一律追问；
  confirmGoal 按 kind 分发落层（每路径一次 undo 快照）；侧栏 MiniWeekPreview（xl+），
  落盘 bumpPlanVersion 重算，草稿态 caption「草稿 · 未落盘」
- `tests/wp9.test.ts`（新，6 用例）
- 反向验证：RV-5b applyCancel no-op → 红；RV-5c 丢 displaced → 红（批量 pass4/fail2）→ 恢复 → 6/6
- 门禁 5/5 PASS：tsc=0 / engine=342 / ui=267 / 禁区零改动 / md5 未变
- 偏差申报：5b-5d 改动交织在同一组文件，合并为一个 commit（5a 已独立 WP8: commit）

---
## 批 6 · WP10 拖拽合规 —— commit（WP10:）

- `src/lib/planner/ripple.ts` — `RippleOptions.compliance`（opt-in）+ dragTo 两道闸：
  ① 撞用户不可时段拒「这是你说过没空的时段，我帮你避开它」；② 转场余量
  （跨校区查 campusLookup 保守表 / 同校区 10 分钟）拒「来不及走到 —— 两段安排之间
  要留出路上的时间」。引擎主流程不传 → 行为与旧版一致（golden 不受扰）。
- `src/features/week/WeekPlanView.tsx` — 预览与落盘传同一份 `dragCompliance`（所见即所得）
- `tests/wp10.test.ts`（新，8 用例：四类拒绝/放行/不传不变/文案风格）
- 反向验证：compliance 闸禁用 → 红（pass5/fail3）→ 恢复 → 8/8
- 门禁 5/5 PASS：tsc=0 / engine=350 / ui=267；禁区例外 2 文件申报留痕；md5 未变

---
