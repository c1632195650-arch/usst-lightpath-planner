# 任务四 · 网页端待办工作区与排程闭环 · 台账（append-only）

> 任务书：`docs/任务四-网页端待办工作区与排程闭环-交zcode-2026-10-06.md`（MOSS 制定，CY 委托）。
> 执行：zcode M4 批（2026-10-06 起）。基线实测：**tsc 0｜engine 593/0｜ui 413/0**（任务书写的 496 为移动端批提交前口径，按「只增不减」以实测为准）。

---

## 2026-10-06 · W0（P0-1 并行冲突排查 + 前置）

- **做了什么**：`git status` 确认工作树无未提交跟踪改动；移动端批（M3-W1..W6）已整体提交 `d9eaf13`，**无活跃并行会话**。任务书 §1.0 契约与 `src/features/mobile/lib/memoTypes.ts` 实测逐字段核对一致（含其台账申报的 `updatedAt` / `Todo.archived` 两处扩展）；`server/sync.py` 的 `SCHEMA_VER=2` / `MERGED_ARRAY_KEYS` / `PRESERVE_KEYS` 确认在位。
- **可碰/禁碰清单**：已写入 `BLOCKERS.md` 任务四节。
- **证据命令**：`git status --short`；`git log --oneline -8`；对照读 `memoTypes.ts` / `sync.py`。
- **剩余风险**：preflight 报 unrelated histories（BEHIND origin/dev 150）——已知硬闸状态，本批只在 beta-v2 提交，承 BLOCKERS 既有条目待人工合并。

## 2026-10-06 · W1（待办工作区）

- **做了什么**：新建 `src/features/memo/`：
  - `memoLogic.ts` —— 纯逻辑：筛选/搜索/标签、`plannedDoneToDueAt`（**确定规则**：该旬最后一天 21:00；下旬在 30 天月收敛到月末；学期前 → null）、`todosToPendingTodos`（done/archived 不参与；交期周 ≠ 目标周的中长期不进本周）、`blockIdForTodo`（endsWith 整块优先、includes 续段退回）、`scheduledLabel` 回显、`setScheduledBlock`（可写可清）、`updateTodoTitle`。
  - `webMemo.ts` —— 云通道（只复用既有契约，不改 `server/sync.py` / `mobile/**`）：`fetchCloudMemo` / `pushMemo` / `withCloudMemo`（**单项操作标准路径** = GET 最新 → 纯函数 mutate → PUT 回显 state 其余字段 → 被拒重拉不刷屏）；块位置注册表（`registerPlanBlocks`/`resolveBlock`）；`syncScheduledBlockIds` 回填。
  - `MemoPanel.tsx` / `TodoList.tsx` / `TodoEditor.tsx` / `GoalPanel.tsx` / `milestonePicker.ts` —— 面板与两列表（**两类完成流程不同**：recent 直勾不弹窗；longterm 弹粗粒度时段确认，未选不能完成）、目标 1-3 + 里程碑 + why + 挂待办、长文本 note + 标签 + 筛选/搜索、归档不删除。
  - `src/App.tsx`：主导航加「待办」tab（网页端入口）。
  - `src/lib/api.ts`：`API_BASE` 改为 export（memo 云通道同源复用，语义不变）。
  - `src/lib/planner/schedule.ts`：`TodoLike` 类型 + `BuildWeekPlanInput.pendingTodos?` + `toPlanRequest` 映射（**唯一引擎扩展点**；pendingTodos 缺省/空 ⇒ tasks/commits 与旧行为逐字段一致）。
- **证据**：`scripts/memo-web-workspace.test.ts` **19 用例全绿**（node --test，输出见 W4 汇总）；`npm run typecheck` 0 错。
- **关键裁决留痕**：两类待办行为差异有 4 个专用用例锁定；`plannedDone → dueAt` 规则确定性有 3 个用例锁定（红线 12）。

## 2026-10-06 · W2（同步往返）

- **做了什么**：
  - `tests/syncContract.test.ts` **追加 2 条往返断言**（只增）：① 网页端建待办 PUT → 云端并集 → 读回仍在 + 移动端并发勾选（updatedAt 更新）不被覆盖；② 移动端待办 × 网页端补 note/tags/scheduledBlockId → 回写后 kind/createdAt 不丢、完成态不变。23→**25 条全绿**。
  - `e2e/memo-smoke.spec.ts` **新增 2 条**（GUI 真实 + `/api/sync/state` 打桩模拟云端持久化）：① 网页端建待办 → PUT 契约体（schemaVer=2）→ 刷新后仍在；② 移动端写的待办 → 网页端读到 → 补长文本 note + 标签 → PUT 不丢移动端字段。**2/2 passed**。
  - 排查记录：首跑全红，根因是 e2e 全新浏览器上下文落在欢迎页（`onboarded` 缺失，主界面不渲染）——预置最小 AppState 修复；测试 2 的初版断言拿「最后一次 PUT」当编辑结果，与挂载时面板自发的空 PUT 存在竞态——改为轮询「带 note 的待办出现在 PUT 体」。两处都是测试基建问题，非实现缺陷（trace 留存 test-results/）。
- **单项操作口径（P2-1）**：无新服务端 API——`withCloudMemo(token, mutate)` = GET 最新云端 → 纯函数 mutate（只改目标条目、刷 `updatedAt`）→ PUT；并发安全由服务端 `MERGED_ARRAY_KEYS` 逐项 LWW 保证（`server/sync.py` 零改动）。
- **证据命令**：`node --import ./scripts/register-alias.mjs --test tests/syncContract.test.ts`（25/25）；`npx playwright test e2e/memo-smoke.spec.ts`（2 passed）。

## 2026-10-06 · W3（排程消费待办）

- **BLOCKERS/契约**：`BuildWeekPlanInput.pendingTodos?: TodoLike[]` 契约扩展已在 W0 写入 BLOCKERS（P3-1 草案）并于 W1 commit 显式申报（AGENTS.md §二单人负责条款）。常量：recent→UserTask priority 70 / longterm→Commit priority 92、缺省 splittable=true。
- **做了什么**：
  - `src/lib/planner/schedule.ts`：`toPlanRequest` 把 `pendingTodos` 映射进两条**既有**引擎通道（recent→`UserTask`：durationMin=档位、weeks=[weekNo]；longterm→`Commit`：kind 'study'、effortMin、splittable、dueAt 直传）。**solver/construct/objective/model 零改动**。
  - `src/features/week/WeekPlanView.tsx`：排程 effect 内 GET 云端待办（`fetchCloudTodos`，失败/未登录 → 空数组 = 旧行为）→ `todosToPendingTodos` 映射 → 进 `toPlanRequest`；排完 `registerPlanBlocks` + `syncScheduledBlockIds` 回填 `Todo.scheduledBlockId`（fire-and-forget，不阻塞排程）。
  - 回显：待办卡显示「已排进周三 15:00」（内存有块位置时精确到时刻；刷新后 web 不存整周计划，退回「已排进周三」，由 block id 的 `-d{1-7}-` 段解析）。
- **黄金口径零漂移（P3-3，🔴 关键）**：四重验证——
  1. `git diff HEAD -- evals/golden/` 逐字节干净（金标文件未动，历史只增）；
  2. 引擎 golden 快照随 `test:engine` 全绿（596/0，含 golden-lib）；
  3. 结构保证：`pendingTodos` 缺省/空 ⇒ `tasks`/`commits` 与旧行为逐字段一致（测试④锁定）；
  4. **在线评测**（2026-10-06 08:52，`python scripts/eval_plan_understand.py http://127.0.0.1:8001`，105 条金标）：action **F1=1.0**（TP35/FP0/FN0）、槽位 EM **0.987**≥0.90、dialog act 宏 F1 **0.972**≥0.90、非法输出拦截率 **1.0**——门槛 ✅ 全过，零漂移。报告已追加至 `docs/eval-libao-understand-2026-09-27.md`。
- **诚实申报（契约缺口）**：Todo 契约无「预计投入分钟」字段（已定型不可改）→ longterm 用固定档位 60 分钟、recent 30 分钟（`memoLogic` 常量，BLOCKERS 已报 CY，待追认后续批扩契约）。

## 2026-10-06 · W4（门禁与反向验证）—— 占位，完成后补
