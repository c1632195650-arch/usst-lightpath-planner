# ZCode 工作单 · 梨宝追问链路整改包（S 批）

> 交付人：MOSS ｜ 2026-09-27 ｜ 基线：`_work_dev` beta-v2 @ **6799511**，门禁指纹 **7190ca67…**，基线 tsc 0 / engine 381 / ui 280（今日 13:26 验收值）
> 需求来源：CY 原话——①梨宝没法完整追问，追问中一插话就掉回文本回答；②想单独拆一个排程模式，不再靠识别用户动机；③理解排程意图要语义级，不能只匹配关键字；④一次可多问几个问题，用户用分号分隔回答；⑤先过 LLM 理解再继续追问；⑥多跑几轮测试确保功能健全。

---

## §0 现状诊断（病灶清单，逐条有实据）

梨宝排程链路今天已具备：意图层（`libaoIntent.ts`，7 种动作 + 槽位抽取 + 缺口自报）、追问接续（`applyClarifyAnswer`）、多目标挑块（`clarifyPicking`）、草稿确认落盘。**但以下 5 个结构性缺口正是 CY 抱怨的根源**：

| # | 病灶 | 实据 |
|---|------|------|
| P1 | **追问态答非所问即蒸发**。`clarifySlots` 分支里 `contributed=false` 就 `setClarifySlots(null)`，用户插一句别的（问完想回来）→ 追问态静默丢弃 → 下一句掉 RAG 文本回答 | `LbaoChat.tsx:918-919` |
| P2 | **追问应答是「整句重解析」**：`applyClarifyAnswer` 把整句重新过规则解析器，没有「第几问 ↔ 第几段答案」的位置对应。一次问两问、用户分号分开答（「周五下午；每天两小时」）会错配或漏收 | `libaoIntent.ts:845-895`（只扫全句）；`topQuestions` 一次问 ≤2 条但不记 asked 清单 |
| P3 | **LLM 理解钩子从未接线**：`parseGoalIntent(q, { today })` 没传 `opts.llm`，`LlmExtractor` 接口和 `mergeSlots`（规则字段不被 LLM 覆盖）都写好了但空转。意图判定 100% 靠词表/正则 | `LbaoChat.tsx:922`；`libaoIntent.ts:149,983,1021-1023` |
| P4 | **没有显式排程会话**：每条消息都要过 `looksLikeAction` 关键词闸门，闸门漏一句就整句掉 RAG（「理解用户动机」这个不可靠环节被放在了主干上） | `LbaoChat.tsx:858-930` 整个 send 流程无状态机 |
| P5 | **追问话术与解析器两套账**：问题由 `topQuestions`/`checkGoalFeasibility.questions` 生成，但应答解析不知道当时问了什么 | `weekPlanForChat.ts:371` vs `libaoIntent.ts:845` |

## §1 目标与验收标准（量化，逐条对 CY 诉求）

| 诉求 | 验收项 | 门槛 |
|------|--------|------|
| 完整追问 | collect 态下用户任何回复**不再静默掉 RAG**（保留式追问） | E2E 剧本 S4-3 断言通过 |
| 分号批量回答 | 「周五下午；每天两小时」型多问多答正确落槽 | 金标 ≥95% 落槽正确 |
| 语义理解 | LLM 理解上线；无关键词句（如「我周五下午要在学生会面试」）在 LLM 在线时被判 action | 意图金标 F1 ≥ 0.95，槽位 EM ≥ 0.90 |
| 单独排程模式 | collect 态消息**不过** `looksLikeAction` 闸门，直接进应答通道 | 单元 + E2E 各 1 条守卫 |
| 健全性 | LLM 离线/超时全链路可用（规则兜底）；老能力零丢失 | 超集测试全绿 + 离线 E2E 通过 |
| 回归 | tsc 0 / engine / ui 门禁、gate md5 未动、RV 全红复现 | 按既有门禁口径 |

## §2 技术路线对比与选型

| 路线 | 内容 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| **A（本包）** | 前端排程会话状态机 + 分号批量应答 + 后端 LLM understand 端点（LLM 优先、规则兜底） | 增量小；离线可用；现有 `mergeSlots` 纪律直接复用 | 状态在前端（快照已解决） | ✅ 采纳 |
| B | 状态机整体搬后端（server 对话管理器，前端无状态） | 多端一致 | 快照/恢复/离线全要重做；与 E8 恢复机制冲突 | 暂缓，A 的端点契约按可迁移设计 |
| C | LLM function-calling agent loop（后端全权调引擎） | 最智能 | 强依赖在线；「决策层不拍板」边界难守；测试面爆炸 | 远期，不做 |

选型理由：P1–P5 全是**接线缺口**而非能力缺口——钩子都在，接上就行。LLM 是增强不是依赖：断网时规则兜底把功能保住（与项目「规则优先、LLM 只补空」纪律①一致）。

## §3 设计

### 3.1 排程会话状态机（修 P1/P4）

```
idle ──(动作句出草稿前需追问/挑块/hold缺when)──▶ collect
collect ──(补齐→草稿卡 pending)──▶ idle
collect ──(显式退出：「退出排程/算了/不排了」)──▶ idle
collect ──(连续 2 轮完全无关)──▶ idle（作废前先说一句，不静默）
```

collect 态 `send` 优先级（写死，不再逐条判动机）：
1. 显式退出词 → 清态，答「好，先不排了，要排再叫我」；
2. `clarifyPicking` 存在 → `matchCandidate` 挑块（现状保留）；
3. `clarifySlots` 存在 → `applyClarifyAnswers`（§3.2）；
   - contributed 或 failed>0 → 算回应（补一半继续问剩下的）；
   - **完全无关 → 保留状态 + missStreak+1**，回应「这条我记下了。咱们先把刚才的事定完：还差 …」；missStreak≥2 才作废并说明；
4. 兜底 `parseGoalIntent`（新动作句可打断旧追问，以新句为准——打断时回应里说明旧追问作废）。

UI：collect 态输入框 placeholder 换文案；消息区顶部小徽章「排程中 · 退出」。

### 3.2 分号批量应答协议（修 P2/P5）

`libaoIntent.ts` 新增（旧 `applyClarifyAnswer` 保留为单段路径，新函数必须是其超集）：
- `splitAnswers(q): string[]` —— 按 `；` / `;` / 换行切分；剥离编号前缀（`1.` `1、` `1️⃣` `（1）` `第一问` 等）；空段丢弃。
- `applyClarifyAnswers(q, prev, asked: SlotKey[], today)` —— 第 i 段 ↔ `asked[i]` 位置对应；段内用现有单槽抽取器（`extractWhen/extractEffort/extractFrequency/extractPlace/extractTarget`）解析；段数 > asked 数 → 多余段按全句兜底再试一次；解析失败的段进 `failed: SlotKey[]`，**只重问失败的**。返回 `{slots, contributed, failed}`。
- 追问渲染统一带编号 + 尾注「可以用分号一起答，如：周五下午；每天两小时」。

`LbaoChat` 的 `clarifySlots` state 扩为 `{ slots, asked: SlotKey[] }`——**问题清单在提问时记录**（修 P5，一处生成一处消费）。所有追问出口（needs_clarification / hold 缺 when / cancel·reschedule 缺 target / add_deadline 缺 when）统一走这个结构。

快照：`ChatSnapshot` 升 **v2**（加 `schedMode`、`asked`、`missStreak`），读取兼容 v1（无字段按 `slots.missing` 推 asked，schedMode=idle）。

### 3.3 LLM 理解端点（修 P3）

**`POST /api/plan/understand`**（新文件 `server/plan_dialog.py` + `app.py` 注册路由；沿用现成 `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`，DeepSeek）：

```
请求: {
  scene: 'intent' | 'answer',          // intent=新句子判动作; answer=追问应答抽槽
  q: string,
  asked?: string[],                     // scene=answer 时的已问槽位清单（含话术原文）
  slots?: object,                       // 当前已抽槽位（JSON 序列化的 IntentSlots 子集）
  today?: string,                       // ISO，供相对时间换算
  history?: string[]                    // 最近 ≤4 条「角色:文本」，防指代断裂
}
响应: { ok: true, action?: bool, intent?: 'create|replace|reschedule|cancel|query|add_deadline|hold',
        patch?: { title?, when_text?, month?, day?, relativeDays?, relativeWeeks?, weekday?,
                  perWeekCount?, durationMin?, totalHours?, place?, window_text?, targetHint? },
        answers?: { [slot]: 原话片段 }, confidence: 0..1 }
      或 { ok: false, reason }          // LLM 不可用/超时/解析失败 → HTTP 仍 200
```

实现约束：temperature 0.1、`response_format={"type":"json_object"}`、max_tokens 300、**timeout 8s**、异常一律返回 `ok:false`（前端视作「走规则兜底」，不算错误、不弹错误提示）。system prompt 要点：槽位定义表 + asked 清单 + 「抽不到就留空，禁止编造；不确定必须给低 confidence」+ 只输出 JSON。

**前端接线**：
- `lib/api.ts` 新增 `planUnderstand()` 客户端；
- `LbaoChat.tsx` 构造 `llmExtractor` 传入 `parseGoalIntent`（`libaoIntent.ts` 的钩子终于通电）；
- collect 态应答也走一遍 understand（scene='answer'），失败回 `applyClarifyAnswers` 规则路径；
- **纪律①不变**：`mergeSlots` 保证规则抽到的字段不被 LLM 覆盖；LLM 只补空 + 低置信度字段回显核对。

### 3.4 降级矩阵

| 场景 | 行为 |
|------|------|
| LLM 在线 | understand 判意图/抽槽 → mergeSlots 补空 → 追问或草稿 |
| LLM 超时/挂 | 现有规则层全链路兜底（P1–P5 的前端修复全部不依赖 LLM） |
| 后端整体未启动 | collect 态照常工作（纯前端状态机 + 规则解析），RAG 问答照旧降级提示 |

## §4 批次拆解（沿用批次纪律：小步 commit / BLOCKERS 记录跳批 / 禁 skip·only / RV 强制 / gate md5 锚定）

### 批 S1 · 分号批量应答（纯前端，先行）
- 文件：`src/features/libao/libaoIntent.ts`（splitAnswers + applyClarifyAnswers）、`LbaoChat.tsx`（clarify 态结构 + 编号追问渲染 + 快照 v2）、`scripts/libaoIntent.test.ts`（+~40 用例：切分/编号剥离/位置对应/段数不齐/单段兼容/解析失败重问）。
- RV 变异体：删编号剥离逻辑 → 编号用例变红；删位置对应改回整句解析 → 分段用例变红。
- DoD：tsc 0 + 新用例全绿 + 旧用例零改动全绿（超集）。

### 批 S2 · 排程会话状态机（纯前端）
- 文件：`LbaoChat.tsx`（schedMode/missStreak/退出词/徽章/placeholder）、抽 `schedSession.ts`（退出词表 + missStreak 判定，纯函数便于测）、`scripts/schedSession.test.ts`、E2E 走查 3 条（追问中插话折返不丢态；连续 2 轮无关才作废；退出）。
- RV：删 missStreak 保留逻辑 → 折返剧本红；删退出词 → 退出剧本红。
- DoD：collect 态内回复 0 次静默掉 RAG（走查断言）。

### 批 S3 · LLM understand 端点 + 接线
- 文件：`server/plan_dialog.py`（新）、`server/app.py`（注册，**注意：工作树里 app.py 有未提交改动 M——动前先 diff 申报，禁夹带**）、`src/lib/api.ts`（planUnderstand）、`LbaoChat.tsx`（llmExtractor 接线 + collect 应答接入）、`scripts/eval_plan_understand.py`。
- 金标：60 条（30 动作句含无关键词陈述句 10 条 + 20 问答句 + 10 边界句：征询意见/纯事实/求建议），zcode 起草 → **CY 复核后定稿**。评测输出 P/R/混淆矩阵；门槛 action F1≥0.95、槽位 EM≥0.90；`LLM_EVAL_OFFLINE=1` 只测规则兜底并出对照报告。
- RV：删 8s 超时兜底 → 离线用例红；删 ok:false 分支 → 前端崩溃用例红。
- DoD：在线/离线双通道评测报告落 `docs/eval-libao-understand-2026-09-27.md`。

### 批 S4 · E2E 剧本 + 文档收口
- 10 条 playwright 剧本（分号批量 / 折返 / 退出 / 挑块接续 / hold / 重要日 / LLM 离线降级（route 拦截模拟）/ 草稿确认落盘 / 断言 collect 态不过 looksLikeAction / 跨 tab 快照恢复含 v2 字段）。
- 文档：`AGENTS.md` 台账 §S 落节；`docs/libao-clarify-spec.md`（本包 §3 的设计定稿版）。

## §5 红线（照抄既有约束，逐条对照）

1. **文件归属**：本包只碰 `src/features/libao/`、`src/lib/api.ts`、`server/`、`scripts/`、`tests/`、`docs/`——全在 CY 名下。**禁碰** `lib/planner/`、`features/week/`、`components/`、`lib/persona.ts`（Ray 的）；需要引擎能力一律通过 `weekPlanForChat.ts` 防腐层。`types.ts` 禁 any，新类型放 `libaoIntent.ts`/`schedSession.ts`。
2. **门禁**：gate md5 锚定 7190ca67…；动门禁必须申报并更新锚。结论必须带命令实据。
3. **后端**：8000 被常驻进程占用**禁杀**；dev 后端走 `PORT=8001`（`start_dev.cmd`）。改 server 后必须重启 8001 再验。curl 探测用 `--noproxy '*'`。
4. **LLM**：Key 只从环境变量读（后端已配），**任何 Key 不得进仓库/文档/日志**。
5. **git**：`beta-v2` 分支小步提交；工作树有他人未跟踪杂物，**禁 `git add -A`**；推送若 POST 被代理 reset，重试即过（老毛病）。
6. **产品边界**：决策层不替用户拍板——追问/草稿/确认三层结构不动；LLM 建议一律过 `mergeSlots`（规则字段不被覆盖）+ 草稿确认卡，不直接落盘。
7. 改旧协议（快照 v1→v2、追问应答签名）须在 commit message 申报迁移兼容点。

## §6 交回验收清单（MOSS 复核项）

- [ ] S1–S4 逐批独立复现：tsc 0 / engine / ui / 新增测试全绿；gate md5 未动或已申报
- [ ] RV 重放：列出的每个变异体删掉后对应用例确实变红
- [ ] 真机走查：①「帮我安排这周」→ 追问中插一句「图书馆几点开门」→ 折回后追问仍在；②追问两条 → 分号一句答完 → 草稿卡正确；③LLM 拔线全链路仍可排程；④「退出排程」生效
- [ ] 评测报告两个数：action F1、槽位 EM（在线版）
- [ ] master / dev 未动；beta-v2 新 commit 不夹带他人 WIP
