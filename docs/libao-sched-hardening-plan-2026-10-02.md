# 梨宝排程真实强化计划（2026-10-02）

> 依据：5174 融合版真机复现实录（本轮对话留痕）+ 代码根因逐条定位。
> 原则：**每个问题先在真机上复现 → 修 → 单测带反向验证 → 真机剧本逐条过 → 才提请验收**。
> 落地线：先修 `beta-v2`（CY 主力线），门禁全绿后 delta 合并进 `integration-full`，在 5174 复测。

---

## 一、问题清单（全部真机复现过，非推测）

| # | 症状（用户视角） | 根因（代码定位） | 严重度 |
|---|---|---|---|
| A | 确认草稿后梨宝说"写进日程了"，但右侧预览**退回旧计划**，新块凭空消失 | `LbaoChat.tsx` 预览重算只喂 `pending` 草稿，确认后任务进了落盘层 `userPlanStore`，`planWeekForChat(..., [])` **从不读落盘层** | P0 |
| B | 说"一小时"，实际排 90 分钟；草稿卡还自称"总投入：约 1 小时" | `extractEffort` 的正则里"每"字必需（`?` 只作用于"次/回/天/日"），裸"一小时"恒被判为**总投入**→ 块长回退 `DEFAULT_BLOCK_MIN=90`；对话 LLM 的 patch 也把时长丢了，规则层没兜住 | P0 |
| C | 确认后"草稿待确认"横幅 + 「退出」按钮**一直残留** | `confirmGoal` 只删 pending，`topic` 相位停在 `draft` 不推进 | P1 |
| D | 梨宝给出"①②③你说哪个"，用户答"1"，梨宝却回**"校园资料服务暂时未连接"**（答非所问实锤，5174 实录） | 文案承诺了编号选择，但规则层**没有任何机制接住编号回答**：blocked 态 `topic.blocking.options` 为空（`proposeReplanOptions` 只在 LLM 触发 `negotiate_block` 时才算），"1" 不匹配任何意图 → `tryDialogAct` 交 LLM → 判 `chit_chat` → 掉 RAG 兜底 | P0 |
| E | 追问/协商时输入框占位提示固定是"多个答案用分号隔开"——对"回 ①②③"这类问题毫无帮助 | placeholder 文案**不随 topic 相位变化** | P1 |
| F | "校园资料服务未连接"是**误报**（后端活着，health 接口 `ok:true`） | 8002 后端 CORS 白名单只含 5173，融合版前端跑 5174 → 页内 fetch 全被 CORS 拒 | P1（环境） |

## 二、修法（每条附验证方式）

### A. 预览读落盘层（LbaoChat.tsx 预览 effect）
- 重算任务源 = `loadUserPlan().tasks`（按 `weeks` 含当前周过滤）∪ pending 草稿；有任务才走 `planWeekWithTasks`。
- 顺带：create/cancel/replace 落盘路径补 `usst:replan` 广播（与 hold 路径对齐）。
- 验证：真机"排 → 确认 → 预览不回退"；单测锁"预览任务源必须含落盘层"（源码锁）。

### B. 时长语义（libaoIntent.ts）
- `extractEffort` 语义修正：**带总量词**（一共/总共/累计/花/投入…）→ `totalHours`；**带"每"** → `durationMin`；**裸 N 小时/分钟** → `durationMin`（单次）。备赛类总量语义不丢（有总量词才算总量）。
- `goalToTasks` 双保险：`totalHours` 有值且只够排 1 块且无 `durationMin` 时，块长直接用 `totalHours*60`。
- `server/plan_dialog.py` dialog 场景提示词补一句：用户说了单次时长必须进 `durationMin`。
- 验证：真机"一小时"→ 草稿卡"单次：60 分钟"且落盘 `durationMin=60`；单测新语义 + 反向（总量词仍归总量）。

### C. 确认后相位收口
- `confirmGoal` 各成功分支 + 「先不排」+ 语音确认 `confirm_draft`：成功后 `setTopic(null)`。
- 验证：真机确认后横幅/退出按钮消失；源码锁。

### D. 协商编号必须接得住（libaoIntent.ts + LbaoChat.tsx）
- 新增纯函数 `parseOptionChoice(q, optionCount): number | null`：识别 `1/①/方案1/第2个/就第一个/2 吧`。
- `markBlocked` 时**确定性**算好 `proposeReplanOptions` 写进 `topic.blocking.options`（不再依赖 LLM 触发）。
- `send` 规则层兜底：`topic.phase==='blocked'` 且命中编号 → 直接 `runGoalSlots(对应方案)`，**不经过 LLM**。
- 验证：真机重演"撞车 → 答 1"必须出新草稿卡；`parseOptionChoice` 单测含全部形态 + 反向（"四六级什么时候报名"不得误判为编号）。

### E. 提示按相位说话
- 输入框 placeholder 跟随 `topic`：draft →「点「就这么排」，或说「就这么排 / 先不排」」；collect → 分号多答提示（保留）；blocked →「回编号（如 1）或直接说要怎么改」；其余 → 默认。
- 验证：真机三相位各看一眼；源码锁。

### F. CORS 误报
- 起服务带 `LIBAO_CORS_ORIGINS`（含 5173/5174）；融合树 `_CORS_DEFAULT` 增加 5174 缺省。
- 验证：5174 侧栏显示"已连接"，闲聊不再回"未连接"。

## 三、真机验收剧本（修完后在 5174 逐步执行，全部通过才请验收）

1. 「周四晚上出去玩一小时」→ 草稿卡"单次：60 分钟"→「就这么排」→ 预览**不回退**、出去玩块在列、横幅消失。
2. 「帮我排个实验报告」→ 追问两问 → 答「下周一开始；一共10小时」→ 撞车协商 → 答「1」→ **出新草稿卡**（不得出现"资料未连接"）。
3. 协商态输入框提示为"回编号（如 1）或直接说要怎么改"。
4. 回归：问答模式问"四六级什么时候报名"仍正常走 RAG。
5. beta-v2（5173）同样过一遍剧本 1。

## 四、门禁

`npm run typecheck` 0 错 ｜ `test:engine` fail=0 ｜ `test:ui` fail=0 ｜ 新断言全部带反向验证 ｜ 禁区文件零改动（只动 CY 名下 `features/libao/`、`server/plan_dialog.py`、`docs/`）。
