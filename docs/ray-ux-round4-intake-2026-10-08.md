# Ray 周页批次接入（feat/ux-round4 → 本树）· 交接说明（2026-10-08）

> **一句话**：RAY 在 `feat/ux-round4` 上 23:22–23:23 连推的 5 个 commit 已按用户口径
> 全量接入本树，落在**独立 worktree** 的分支 `feat/ux-round4-intake` 上，各项门禁全绿。
> 未并入 `beta-v2`（原因见 §4「为什么没直接并入」）。

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

## 4. 为什么没直接并入 `beta-v2`（重要）

接入期间，本仓 `_work_dev` 上有**另一个会话在活动**（通宵批次：`b2abdb8` 后
又推 `e5aa116`，仍在写文件）。若把本分支 merge 进 `beta-v2`，
`_work_dev` 工作树里的 `src/features/week/**` 等文件会**在对方会话脚下被换掉**，
可能打断其在途工作。故本分支停在工作区外（独立 worktree，互不干扰），交由人工合并。

**合并步骤（建议白天做，确认通宵会话已停）**：

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
