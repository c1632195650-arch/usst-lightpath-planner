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

## 2026-10-06 · W2（同步往返）—— 占位，完成后补

## 2026-10-06 · W3（排程消费待办）—— 占位，完成后补

## 2026-10-06 · W4（门禁与反向验证）—— 占位，完成后补
