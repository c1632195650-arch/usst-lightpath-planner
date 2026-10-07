# Ray 周页批次接入（feat/ux-round4 → 本树）· 交接说明（2026-10-08）

> **一句话**：RAY 在 `feat/ux-round4` 上 23:22–23:23 连推的 5 个 commit 已按用户口径
> 全量接入本树；**2026-10-08 00:4x 已合并进 `beta-v2`**（merge commit `e600510`，零冲突，
> 合并后 gate_overnight 全绿），并完成前后端接线（`serve.py` 托管新构建 + `/api/*` 同源转发，
> `/api/health` 实测返回梨宝脑真实响应）。

---

## 1. 五个 commit 的接入落点（按 Ray 的顺序）

| # | Ray commit | 内容 | 本树对应提交 |
|---|---|---|---|
| 1 | `019336e` | 「导入课表」引导步（可跳过）+ 问卷「暂时跳过」改真跳过 | `32408c9` |
| 2 | `b0657f6` | 反馈批：相对日解析 + 意图词族 + 按标题删除 + 不可时段可见可删 | `9a1709d` |
| 3 | `e7df736` | 周页交互批：七列时间轴 + 右键空档加事 + 拖拽修复 + 内嵌梨宝抽屉 + 最新要求优先 + 不可时段硬排除 + 目标待生效修复 | `c386363` |
| 4 | `c5295b9` | 目标批：后补截止日期（分段输入）+ 唯一落库修补 + 「10.31前/月底/年底」 | `b068b4c` |
| 5 | `b6d28d6` | serve.py 梨宝脑转发加固（UA 透传 + 全路径容错） | `234654b` |
| — | 收尾 | 图标两处遗漏（编辑面板把手 / 画像影响折叠） | `4618b46` |

## 2. 用户口径的落地方式

- **底层与实现逻辑以 Ray 的提交为准**：周页整套架构按 Ray 版落地
  （`WeekPlanView` 重写为「阶段头 + 操作条 + 七列时间轴 + 诊断区」的组件化结构；
  新增 `WeekTimelineGrid` / `WeekDayColumn` / `BlockCard` / `useWeekPlan` /
  `useWeekPlanDrag` / `useWeekPlanStore` / `WeekToolsPanel` / `WeekDiagnostics` /
  `GapAddPopover`+`gapAdd` / `PendingEditsBar` / `AdjustDrawer` 等 20+ 文件）。
- **当日流水保留**：一键还原（`8b5fca4`）、梨宝时间定位（`802adb1`）、移动端批次
  （`93bacb4` / `9280aa9`）等已在本次接入的**基线**里（分支基于 `64141e9`），未受破坏。
- **UI 图标换本树图鉴（Icon 组件）**：`⚙️ / ⛔ / 📍 / 🗑 / ✏️ / 📝 / ⠿ / 🚫 / ✕ / ▶`
  等 chrome 图标全部换 `@/components/icons/Icon`；`↩ ↪ ‹ › ⋯ ▾ ▸ ✓ ✗ 🆕 🔒 ⏱ 🌧⛅☀`
  等本树既有习惯保留（与本地老周页一致）。顺带修了 Ray 文件的两处缺陷：
  `PendingEditsBar.tsx` 的 U+FFFD 坏字符（「原��是」→「原来是」）、两处缺失的量测锚
  （`week-timeline` / `issue-summary-bar`）。
- **课表接入放在输入完个人信息之后**：`App.tsx` 引导链改为
  欢迎 → 个人信息 → **导入课表（可跳过）** → 问卷 → 画像结果 → 主界面；
  解析/网络走本树既有 `@/lib/timetableClient`（127.0.0.1:8765 独立解析服务），
  不引 Ray 的 serve.py 版；离线文案改本树口径。

## 3. 有意「不随批带入」的项（都已评估，写在这里备查）

| 项 | 为什么不带 |
|---|---|
| `planner-cy/**` + `lib/engineMode` + 引擎 A/B 开关 | Ray 把它作为「与 CY 线比对」的移植件；本树 `@/lib/planner` 是唯一权威引擎，A/B 开关无对照对象。周页引擎接缝已直接对接本地引擎。 |
| `启动光溯.bat` / `启动光溯-开发模式.bat` | 内含 Ray 机器硬编码路径（`C:\Users\xulan\...`）且约定 GBK 编码；带进本树只会误导。需要一键脚本时按本机路径单独写。 |
| `HomeBaseSetting` / `OnboardingSetup` / `HardBoundaryCard` | 属 Ray 的「作息住处迁画像页」波次（不在这 5 个 commit 内）；本树住处/作息采集在 basicinfo + 周页 routine-entry，口径未变。 |
| `types.ts` 的 `score` 计算端（blockScore） | `score?: number` 字段已按可选加入（显式申报）；计算端（construct 末尾顺势分）属更早波次，本批不接——字段缺席时界面不显示分数，行为不变。 |
| `InterestAskDialog` 等目标池波次组件 | 属 Ray 更早/更晚的目标池批次，不在这 5 个 commit 内；本次只接 `c5295b9` 的闭包。 |

## 4. 并入 `beta-v2` 的过程（已完成）

接入期间，本仓 `_work_dev` 上有**另一个会话在活动**（通宵批次：`b2abdb8` 后
又推 `e5aa116`，仍在写文件）。若把本分支 merge 进 `beta-v2`，
`_work_dev` 工作树里的 `src/features/week/**` 等文件会**在对方会话脚下被换掉**，
可能打断其在途工作。故本分支停在工作区外（独立 worktree，互不干扰），交由人工合并。

**实际执行（2026-10-08 00:4x，确认通宵会话已停后）——零冲突完成**：

```bash
cd "D:/WORKBUDDY DATA/学术部/_work_dev"
git fetch . feat/ux-round4-intake          # 同一仓库内直接 fetch 分支即可
git merge feat/ux-round4-intake
# 预期冲突点：docs/capability-map.json（两边都会重新生成）
#   → 直接 `node scripts/capability_map.mjs --write` 重新生成后 git add 即可
# 合并后必跑：node scripts/impact.mjs && node scripts/gate_overnight.mjs
```

**已知与主树的差异**：本分支基于 `64141e9`，通宵会话其后又推了 2 个 commit
（`b2abdb8` / `e5aa116`，docs+e2e 相关，未触 src/features/week）。merge 时若有
`types.ts` / `App.tsx` / `userPlanStore.ts` 冲突，按「两边的改动都要」处置——
本侧是 Ray 接入（申报过的契约增补），对方侧是通宵批次的功能。

## 5. 门禁证据（本分支实测）

```
node scripts/gate_overnight.mjs
  PASS  typecheck    0 错误
  PASS  test:engine  pass=845 fail=0
  PASS  test:ui      pass=448 fail=0
  PASS  禁区文件零改动 / 版本纪律 / 影响面回归 / 风格漂移 / a11y对比度
```

另有 `tests/**` 层面：Ray 的 5 个新测试文件随批带入（gapAdd / weekViewUtils /
estimateRefine / restartRoll / goalDecompose）+ `feedback.test.ts` 补
`clearConflictingSlots` 三例；本地 11 个源码锁测试改锚到新架构文件（语义逐条保留，
少数不可等价移植项已在测内注释写明原因）。

---

## 6. 第二批接入：RAY 最新 4 个 commit（2026-10-08 01:47，`936fd94` 尖）

> **边界（严格区分「这批涉及 / 不涉及」）**：RAY 在本分支的**新**提交共 4 个，
> 尖为 `936fd94`，其父 `b6d28d6` 正是上一批（§1 #5）的接入点 —— 所以「最新一个 commit」
> 的实际增量 = **`5212f20 → 3826eb0 → 970686a → 936fd94`**。除这 4 个 commit 触及的文件外，
> 本批**零改动**（Ray 侧其余文件、以及并行会话的图标批，均不在本批范围内）。

| # | Ray commit | 内容 | 本树对应提交 |
|---|---|---|---|
| 1 | `5212f20` | 引擎修复：固定块碰撞顺延 + 一次性任务一周一块 + lock-conflict 不露内部 id | `5452f69` |
| 2 | `3826eb0` | 目标批：截止感知选天 + 分布天钉死 + 问题合并/切换文案纯函数 | `9faaa51` |
| 3 | `970686a` | 周页交互：顶栏 z 阶梯 + 问题清单合并同类 + 切换反馈 + 内嵌对话快层 | `b9dec0f` |
| 4 | `936fd94` | 测试：晚课冲突回归 + 目标分布补充 | `5766d0b` |

### 6.1 适配点（本树与 Ray 树的结构差异，逐条已证）

1. **引擎只有一支**：`5212f20` 在 Ray 侧是「双引擎同修」（`lib/planner` 与 `lib/planner-cy`）。
   本树 `lib/planner` 对应 Ray 侧 **`planner-cy`（CY 线）**，故按该版落修；Ray 的 `lib/planner`
   是另一支、本树不存在（§3 已登记不带入 `planner-cy/**`）。`solver.ts` 同此，用本树既有的
   `DAY_NAME`（Ray 的 planner-cy 版写法）。
2. **`WeekDiagnostics` 两处结构合并**：本树的「顶部聚合条」（批 6.1 `summarizeIssues`，
   有源码锁 `tests/issue-bar-ui.test.ts`）保留；Ray 的 `groupIssues` 合并落在**明细列表**层。
   聚合条报总数、明细折同类行，二者不冲突（不是二选一）。
3. **`WeekPlanHeader` 与并行会话同文件**：接入期间本仓另有会话在做图标批（emoji→`<Icon>`），
   已在 `WeekPlanHeader.tsx` 有在途改动。本批**只暂存自己的 hunk**（索引定向），
   对方在途改动原样留在工作区未提交 —— 提交后实测该文件 unstaged diff 仍为对方的
   2 增 1 删，工作区文件与其预期状态逐字节一致（md5 `d03664fc…` 已核）。
4. **`goalSpread.test.ts` 是本树既往缺口**：上一批（§1）漏带了该测试文件（`goalDecompose`
   逻辑已在，非新行为）。本批按 `936fd94` 版本**整份补入** —— 原有 4 条用例在本树既有逻辑上
   全绿，第 5 条为 `936fd94` 新增的截止感知用例。
5. **`eveningConflict.test.ts` 双引擎断言合并**：上游对两支引擎各断言一遍，本树只有一支，
   合并为一组（文件头已写明原因），语义不减。

### 6.2 ⚠️ 反向验证发现：`936fd94` 那条「截止感知选天」断言恒绿（假覆盖）

实测证据（本仓红线的要求：新断言关掉实现必须变红）：

- 把 `daysWithinDeadline(...)` 换回 `freeDays`（`decomposeGoal` 与 `decomposeGoalV2` 两处），
  `936fd94` 原文那条用例**仍然全绿** —— 它的预算只够 3 天，`days.slice(0, usedDays)` 在
  有/无截止过滤两种实现下都是 `[1,2,3]`（`usedDays = ceil(budget/120) = 2→3`），断言分辨不出。
- 故按本仓纪律补一条**有区分力的锚**（同文件，Ray 原文逐字保留在其前）：预算放大到 600 分钟
  （`usedDays = 5`），无过滤会排出 `dow=5`（落在 10/08 之后）→ 该断言必红（已实测）。

### 6.3 本批反向验证记录（全部实测，文件 sha256 逐字节还原）

| 变异 | 预期变红 | 结果 |
|---|---|---|
| 固定块顺延循环关掉（`guard < 32` → `< 0`） | eveningConflict「顺延到课程之后」 | ✅ 恰红 |
| `placedOnce` 过滤摘掉 | eveningConflict「一周恰好一块」 | ✅ 恰红 |
| `daysWithinDeadline` 两处换回 `freeDays` | 6.2 新增锚（Ray 原文故意保留，仍绿） | ✅ 新锚恰红 |
| `groupIssues` 永不合并 | groupIssues「同 code ≥2 合并」 | ✅ 恰红 |
| `fromNowSwitchCopy` 边界 `<` → `<=` | fromNowSwitchCopy「07:00 正好算已过起点」 | ✅ 恰红 |

### 6.4 门禁证据（本批实测）

```
node scripts/gate_overnight.mjs
  PASS  typecheck    0 错误
  PASS  test:engine  pass=860 fail=0（动态基线 ≥854）
  PASS  test:ui      pass=448 fail=0
  PASS  禁区文件零改动 / 版本纪律 / 影响面回归 / 风格漂移 / a11y对比度
node scripts/impact.mjs --files <本批 10 个源文件>
  PASS  engine+ui（受影响 43 个文件）pass=315 fail=0
node scripts/capability_map.mjs --write   # 4 个新测试登记（148 测试 / 141 源 / 88 RV 锚）
```

`tests/golden/` 零改动、golden 快照零漂移（引擎批 842→860 全程复跑，快照逐字节未动）。

