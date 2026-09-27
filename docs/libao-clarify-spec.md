# 梨宝追问链路 · 排程会话设计定稿（S 批）

> 2026-09-27 ｜ 基线 beta-v2 @ 6799511 ｜ 本文是工作单《梨宝追问链路整改包（S 批）》§3 的**落地定稿版**。
> 实施记录见 `AGENTS.md` §S 台账；评测数据见 `docs/eval-libao-understand-2026-09-27.md`。

## 1. 五个病灶与修法（对照）

| # | 病灶（改前） | 修法 | 落点 |
|---|---|---|---|
| P1 | 追问态答非所问即蒸发（`contributed=false` 就清态 → 掉 RAG） | 保留式追问：missStreak<2 时保留会话 + 有声提醒 | `schedSession.ts` + `LbaoChat.send()` |
| P2 | 追问应答整句重解析，多问多答错位 | 分号批量应答协议：第 i 段 ↔ asked[i] | `libaoIntent.splitAnswers/applyClarifyAnswers` |
| P3 | LLM 理解钩子从未接线 | `/api/plan/understand` + `llmExtractor` 通电 | `server/plan_dialog.py` + `api.planUnderstand` |
| P4 | 每句都过 looksLikeAction 关键字闸门 | 显式排程会话（collect 态直接进应答通道） | `schedSession.ts` 状态机 |
| P5 | 追问话术与应答解析两套账 | 提问时记 asked 清单，一处生成一处消费 | `topQuestionPairs` + 快照 v2 |

## 2. 排程会话状态机

```
idle ──(动作句出草稿前需追问/挑块/hold缺when)──▶ collect
collect ──(补齐→草稿卡 pending)──▶ idle
collect ──(显式退出词)──▶ idle        ← 出口①，回执「好，先不排了」
collect ──(新动作句)──▶ collect(新)   ← 出口②，有声打断（说明旧追问作废）
collect ──(连续 2 轮完全无关)──▶ idle ← 出口③，作废前先说明（不静默）
```

collect 态 `send` 优先级（写死，不再逐句判动机）：
1. 显式退出词（`isExitCommand`，归一后**整句相等**才命中，防「算了一下」误伤）；
2. `clarifyPicking` 存在 → `matchCandidate` 挑块（未命中诚实重列，不掉 RAG）；
3. `clarify` 存在 → `applyClarifyAnswers`（规则没接住再走 LLM 定位救援）；
   contributed → 补一半只重问 failed；完全无关 → missStreak+1 保留，≥2 作废并说明；
4. 兜底 `parseGoalIntent`（新动作句可打断旧追问，以新句为准）。

UI 信号：collect 态消息区顶部徽章「排程中 · 退出」+ 输入框 placeholder 换排程文案。

## 3. 分号批量应答协议

- `splitAnswers(q)`：按 `；` `;` 换行切分 + **行内编号切分**（`1. x 2. y`、`（1）x（2）y`、`①x②y`）；
  编号前缀剥离（`1.` `1、` `（1）` `①` `1️⃣` `第一问`，`(?!\d)` 防「1.5小时」被腰斩）；空段丢弃。
- `applyClarifyAnswers(q, prev, asked, today)`：第 i 段 ↔ asked[i]；段内用既有单槽抽取器；
  段多于问 → 多余段拼全句按剩余空位兜底；解析失败段进 `failed`，**只重问 failed**；
  asked 为空（v1 兼容）→ 整体退回旧协议 `applyClarifyAnswer`（新函数是旧路径的超集）。
- 追问渲染统一带编号 + 尾注「可以用分号一起答，如：周五下午；每天两小时」。
- 快照 v2：`{clarify: {slots, asked}, schedMode, missStreak}`；读 v1 兼容（按 `missing` 推 asked，schedMode=idle）。

## 4. LLM 理解端点（纪律①：规则优先，LLM 只补空）

`POST /api/plan/understand`（`server/plan_dialog.py`；HTTP 恒 200，失败一律 `{ok:false}`）：

```
请求: { scene: 'intent'|'answer', q, asked?: ["slot: 话术"], slots?: 规则已抽槽位, today?, history? }
intent  响应: { ok, action, intent?, patch?, confidence }   // patch 只补规则没抽到的
answer  响应: { ok, answers?: {slot: 原话片段}, confidence } // LLM 只做语义定位
```

- DeepSeek：temperature 0.1、`json_object`、max_tokens 300、**8s 超时**；前端 9s AbortSignal。
- 输出白名单 + 数值防御（`_clean_patch`/`_clean_answers`）：LLM 输出不可信，越界数值一律丢弃。
- 前端接线：
  - 意图：`parseGoalIntent(q, { today, llm: llmExtractor })` —— 钩子只在**规则确有缺口**时被调用；
    片段经 `mergeSlots` 合并（规则字段永不被覆盖），结构化（时间换算/时段窗）留在规则层。
  - 应答：规则 `applyClarifyAnswers` 没接住时才调 `scene=answer` 救援，片段经
    `applyClarifyFragments` 回规则抽取器；救援失败静默走规则结论（保留式追问）。
- 降级矩阵：LLM 挂/超时 → 规则全链路兜底（E2E 剧本 G 用 route.abort 验证）；后端整体未启动 → 纯前端状态机照常。

## 5. 验收数据（2026-09-27 实测）

| 项 | 结果 | 门槛 |
|---|---|---|
| 在线 action P/R/F1 | 1.0 / 1.0 / **1.0** | ≥0.95 ✅ |
| 在线 intent 槽位 EM | **0.923**（逐槽）/ 0.862（逐条） | ≥0.90 ✅（逐槽口径） |
| 在线 answer 槽位命中 | 0.926（25/27） | — |
| 离线规则对照 action F1 | 0.868（FN 7 条即 LLM 增量价值所在） | — |
| E2E 10 剧本 42 断言 | 42 过 / 0 挂 | 全过 ✅ |
| 单测 | ui 309/0（+29）、engine 408/0、tsc 0 | 全绿 ✅ |

已知缺口：intent **逐条** EM 0.862（个别条目仍差 1 槽，明细见评测报告）；金标 60 条为 zcode 起草稿，**CY 复核后才算定稿**——复核意见直接改 `evals/golden/plan_understand.jsonl` 后重跑：
`python scripts/eval_plan_understand.py http://127.0.0.1:8001`（离线对照加 `LLM_EVAL_OFFLINE=1`）。

## 6. 产品边界（不变）

决策层不替用户拍板：追问/草稿/确认三层结构原样保留；LLM 建议一律过 mergeSlots + 草稿确认卡，
不直接落盘；挑块多命中不硬猜；退出/作废/打断全部**有声**（不静默丢用户输入）。
