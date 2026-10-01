# ZCode 工作单 · 对话管理器化通宵重构包（D 批 · 全量）

> 交付人：MOSS ｜ 2026-09-27 夜 ｜ 授权：CY 拍板「一次性推完、不要留等 MOSS 的中间任务、保质保量不许敷衍」
> **基线对账（MOSS 21:55 原子命令实测）**：`_work_dev` beta-v2 @ **0b35275**；tracked 工作树仅 `BLOCKERS.md` 未提交（前批两条遗留记录，可直接续写，提交时一并落盘不算夹带）；gate md5 **7190ca67**（未动）；**tsc 0 / ui 319/319 / engine 408/408**（实测复跑）。
> 权限变更（CY 2026-09-27 21:48 授权）：**`lib/planner/`（construct.ts/templates.ts）本次可直接修改**——引擎修复并入本包，不再出提案等 Ray；但 commit message 与台账必须高亮「动了 Ray 文件及原因」，golden/断言漂移逐条申报。其余红线不变：`features/week/`、`components/`、`lib/persona.ts` 仍禁改。

---

## §0 背景：为什么重构（三截图 + 两类误判）

1. **议题断层**：「把操场跑步替换掉」隐含「用刚才排失败的出去玩替换」——失败草稿不进状态，下一句当独立消息重解析，replace 无新事情 → 重复审问。
2. **候选消歧无能**：replace 多候选走 clarify 通道（LbaoChat.tsx:818），用户答「明天的那个」→ extractTarget（只认「把X挪/取消X」）解析失败 → 反复追问；matchCandidate（:750-757）只比 title 子串，「明天的那个」结构上不可命中。
3. **引擎不协商**：verdict 无「哪块挡路」字段，describeVerdict（:525-541）硬编码「①挪下一周②降一档目标量③让一块」——对「出去玩」说「降目标量」荒谬。
4. **引擎真 bug（已定位到行）**：goalToTasks（weekPlanForChat.ts:260）丢 window.toMin 只留 notBeforeMin；非 essential custom 块受 construct.ts:495/531 `activityBudget=min(120, usable*0.4)+essentialMin` 与 :527 custom 每日 1 块上限 → 操场跑步吃光预算 → 用户点名「出去玩 1 小时」静默跳过 → placed=0 →「排不进去」。
5. **两类误判**：非排程问题被当排程（关键词闸门残留）＋ 问答 RAG「关键词命中就套用」（grounded 路由对假命中无防护）。

**总方案**：输入框显式双模式切换（问答/排程硬区分，消灭揣测用意）＋ 排程模式内由 **LLM 对话管理器**接管理解与状态（状态文档 + act 白名单，前端收缩为动作执行器）＋ 引擎修复与协商话术（真排得明白）＋ 问答侧相关性门（假命中防线）。离线/失败一律回退现有规则链路（S/T 批产出全保留为 fallback）。

## §1 批次总览（按序推进，每批小步 commit；通宵做不完的如实进 BLOCKERS，不硬凑）

| 批 | 内容 | 优先级 |
|---|---|---|
| D0 | 基线对账 + 双模式按钮（问答/排程切换 + 提示不静默改道） | 高 |
| D1 | dialogManager.ts（DialogState v3 + 快照迁移） | 高 |
| D2 | /api/plan/understand 扩 scene='dialog'（act 白名单+防编造+金标扩 40 条） | 高 |
| D3 | ActExecutor + send() 优先级链 + runGoalSlots/runReplace topic 出口 | 高（最重） |
| D4 | 引擎修复（construct/templates/weekPlanForChat）+ golden/断言申报 | 高 |
| D5 | 问答相关性门（server/app.py） | 中 |
| D6 | E2E 剧本 K/L/M/N + 台账 §D + 全量门禁 | 高 |
| D7 | replan 协商循环（LLM 提议→引擎校验） | 余力批：做不完如实 BLOCKER |

**纪律（token 节制版）**：每批只跑受影响测试并附命令实据；**收尾（D6）跑一次全量门禁**；禁 skip/only、禁 `git add -A`（精确列文件）；改门禁脚本必须申报并更新 md5 锚；BLOCKERS 做不了的如实记；`8000` 端口常驻进程禁杀，dev 用 `PORT=8001`；curl 探测 `--noproxy '*'`；Key 只从 server/.env 读。

## §2 D0 · 双模式按钮

- UI：输入框上方 segmented 切换「问答 ｜ 排程」（默认问答；快照恢复时若有活跃 topic 自动落排程态）。徽章「排程中」保留。
- **排程模式**：所有输入走排程流（dialog 裁决 → 执行器；离线走规则链）；chit_chat 动作照常走 RAG 回答但**议题保留**；切回问答 = 显式退出（复用 isExitCommand/按钮）。
- **问答模式**：维持 T 批 parseGoalIntent(llmJudge) 主干，但 `action=true` 时**不静默改道**——渲染提示条「看起来你要排程 → [切到排程模式并继续]」，点击 = 切模式 + 原句自动重发进排程流。
- 快照 v3 增 `mode: 'chat' | 'sched'`。
- DoD：问答模式问「图书馆几点开门」零排程动作；问「我要报名数学建模备赛」出现切换提示不自动排；排程模式内 RAG 问题也能得到回答且议题不清。

## §3 D1 · DialogState（新文件 `src/features/libao/dialogManager.ts`，纯逻辑层）

```ts
export interface DialogState { v: 3; mode: 'chat' | 'sched'; topic: DialogTopic | null; missStreak: number; }
export type TopicPhase = 'collect' | 'picking' | 'draft' | 'blocked';
export interface PickOption { idx: number; title: string; origin: 'user' | 'plan'; hint: string; target: CancelTarget; }
export interface BlockingFacts { kind: 'no_placement' | 'partial_placed' | 'conflict'; verdict: GoalVerdict; blockingBlocks: PickOption[]; }
export interface DialogTopic {
  phase: TopicPhase; intent: GoalIntent; slots: IntentSlots; asked: SlotKey[];
  candidates?: PickOption[]; pickKind?: 'cancel' | 'reschedule' | 'replace';
  draftKey?: number; blocking?: BlockingFacts;
  priorFailed?: { title: string; slots: IntentSlots };   // B①：议题续用
  createdAt: number; turns: number;                      // turns>8 自动作废并说明
}
```

- **吸收**：clarify→topic{collect}、clarifyPicking→topic{picking}；**保留**：missStreak、pending/pendingDeadlines（确认卡红线）、全部 run* 执行器。
- **零断言破坏技巧**：组件内派生 `const clarifyPicking = topic?.phase === 'picking' ? topic : null;`（candidates 同名同型）→ tests/v2.test.ts:73-93 源码字面量断言原样通过。
- 快照：写 `usst.libao.chat.v3`；读失败回读 v2 合成（clarify→collect、clarifyPicking→picking、mode 推导），v1 链保留；坏数据当没有。

## §4 D2 · 端点 scene='dialog'（沿用 understand 端点，不加新路由）

**请求**：`{ scene:'dialog', q, today, history≤6条×80字, state:{ topic|null, missStreak } }`；序列化白名单（slots 9 键、candidates/blocks ≤5 条每条 idx+title+hint 必含 `周X(M.D) HH:MM–HH:MM`、体 ≤4KB）。
**响应**：`{ ok:true, act, args, reply_note≤80字, confidence }`；失败恒 `{ok:false}`（HTTP 200）。

**act 白名单 8 个**：

| act | args | 前端分发（现有函数） |
|---|---|---|
| ask_slot | slot∈{title,when,effort,target} | 追问 + topic{collect} |
| pick_candidate | candidate_idx? / target_text? / pick_kind | 命中→runCancelWithTarget / runRescheduleWithTarget / replace 分支；未命中→matchCandidate 兜底→重列 |
| confirm_draft | — | **双闸**→ confirmGoal(topic.draftKey) |
| discard_topic | — | topic=null + 回执 |
| resume_topic | — | priorFailed.slots 拉起（B①） |
| new_intent | intent∈7 枚举 + patch（复用 _clean_patch） | mergeLlmPrimary → runGoalSlots（打断回执） |
| negotiate_block | option∈{swap_block,move_next_week,reduce_scope,give_time} | 见 §6 D7 |
| chit_chat | — | RAG 通路（排程模式下议题保留） |

**校验（双层）**：后端 `_clean_dialog` + 前端 `validateDialogAct`——act 枚举、slot/option/intent 枚举、**candidate_idx 必须存在于 state.candidates（防编造）**、confidence∈[0,1]、negotiate_block 仅 blocking 存在时放行；任一失败视同 ok:false → 规则链路。
**confirm_draft 双闸**：confidence≥0.8 **且** q 归一后整句命中确认词表 `/^(好|好呀|好啊|行|可以|对|确认|就这么排|就这么办|排吧|嗯+)[吧呢啊。！!]*$/`；不满足 → 重列草稿要点。
**prompt 骨架（_SYSTEM_DIALOG）**：act 表逐条 + 状态读法（candidates/blocks 的 idx 与 title 是唯一可信引用）+ 防编造三约束（idx 只取清单 / title 照抄 / 拿不准 ask_slot·chit_chat 且低 confidence）+ 「决策权在用户，confirm 只在用户明确同意时输出」。dialog 场景 max_tokens 400（per-scene 拆分）。
**金标**：`evals/golden/plan_understand.jsonl` 追加 dialog 组 ≥40 条（act 分类 25 + idx 消歧 8 + 防编造负例 7）；zcode 起草+自验，**MOSS 终验复核**。评测脚本 eval_plan_understand.py 扩 dialog 组（act 分类 F1≥0.9、非法输出拦截率 100%）。

## §5 D3 · ActExecutor 与 send() 优先级链

```
send(q)：
1. isExitCommand（确定性，不耗 LLM）
2. mode==='sched' && 在线 → planUnderstand(scene:'dialog')（每轮恰 1 次）
     ok → validateDialogAct → ACT_EXECUTORS[act](args, ctx)
     !ok/超时/校验失败 → 3
3. 规则链路 fallback（现 send 逻辑原样保留）：picking 接续 → clarify 接续
   （applyClarifyAnswers + rescueClarifyAnswer + parseGoalIntent 打断 + missStreak）
   → parseGoalIntent 主分流 → runGoalSlots
4. mode==='chat' → T 批主干；action=true → 渲染切换提示（D0），不自动排
```

- **删除**：PickingState 接口、clarifyPicking useState、updatePicking（写入点改 updateTopic(picking)，含 :657/:731/:818）。
- **runReplace 多候选改道**（:818）：updateTopic(picking, pickKind:'replace', candidates:带日期 PickOption[])——B② 根治。
- **topic 生命周期**：出草稿 → topic{draft,draftKey}；conflict/infeasible → topic{blocked,blocking} + priorFailed 记录；确认/作废/退出/missStreak≥2/turns>8 → null。

## §6 D4 · 引擎修复（本次获授权直接改 Ray 文件）

1. `templates.ts`（UserTask）增字段：`budgetExempt?: boolean`（用户点名块豁免活动预算，不入 study 统计、不改 kind）、`notAfterMin?: number`（与 notBeforeMin 对偶）。
2. `construct.ts:492-495`：essentialMin 累计含 `t.budgetExempt`；`:527` CATEGORY_PER_DAY 对 budgetExempt 的 custom 块豁免每日 1 块上限；placeTemplate 候选空档需满足 `endMin ≤ notAfterMin`（约束放置上界）。
3. `weekPlanForChat.ts` goalToTasks（:193-265）：产出带 `budgetExempt: true`、`notAfterMin: slots.window?.toMin`（window.toMin 不再丢）；note 保留原话。
4. `checkGoalFeasibility` 增 `blockingBlocks`：placed=0 或部分未落时，扫候选块落周 × weekday（无则全周）× window（无则全天）内 kind∈{activity,study} 既有块 ≤5 条（带 `周X(M.D) HH:MM–HH:MM`）。
5. `describeVerdict` 去硬编码模板：有 blockingBlocks 列事实（「明天 17:55–18:55 已有操场跑步…」）；无 effort 槽位的诉求不出现「降一档目标量」。
6. placed 计数（:437-439）改按 id（`goal-` 前缀+周次）匹配，防同名误认领。
7. **golden/断言申报**：放置行为会变——engine/ui 门禁、golden 截图凡漂移者逐条列出（前后对比），预期更新须在 commit message 附原因；**不许静默改断言**。
- DoD：「明天晚上出去玩 1 小时」**能真排上**（引擎级验证）；「操场跑步+出去玩」同日共存；剧本 M 协商话术基于事实。

## §7 D5 · 问答相关性门（server/app.py）

- api_chat 的 grounded/hybrid 路由：检索命中后、合成/抽取前，加一次廉价 LLM 门 `{relevant: bool, reason≤40字}`（问题 + top3 标题+摘要）；`relevant=false` → 路由降级 `'llm'`（边界外诚实口径）；LLM 不可用时保持现状（如实申报，不加伪门）。同问题短 TTL 缓存防重复花费。
- 评测：`scripts/test_libao.py` 或新脚本加 5 条「关键词相近但不相关」负例（如问「大功率」宿舍规定 vs 问「功率自行车」），断言不再套用无关命中。
- DoD：负例 5/5 走 llm 诚实口径；正例命中不受影响（既有 44 轮对话测试回归）。

## §8 D6 · E2E 与全量收口

新剧本（scripts/e2e-sched-session.mjs 追加块，照 A-J 模式）：
- **K（B①）**：出去玩 1 小时 → blocked →「把操场跑步替换掉」→ **≤2 轮**出 replace 草稿卡（goalAsk + planPoints 含「取消：操场跑步」），不重复追问时长/时间。
- **L（B②）**：replace 多候选 →「明天的那个」→ **1 轮**命中唯一候选出草稿卡（无第二次「替换哪个」）。
- **M（B③）**：blocked 协商回复含「操场跑步」+「17:55」，不含「降一档目标量」。
- **N（模式按钮）**：问答模式排程句出提示不自动排；切换后重发原句直达排程流；排程模式内 RAG 问题可答且议题保留。
- 收尾全量门禁：tsc / ui / engine / E2E A-N 计数如实入台账 §D；golden 漂移清单；BLOCKERS 汇总。

## §9 D7 · replan 协商循环（余力批，做不完如实 BLOCKER）

blocked 时基于 blockingBlocks 生成 ≤3 个候选方案（①与阻塞块 swap（replace 语义）②引擎搜索本周下一个空闲晚窗 ③降 duration），**每个方案必须过一次引擎干跑**，可行的才呈现为编号选项——只提议不落盘，确认卡照旧。禁止 LLM 直接编「排好了」。

## §10 MOSS 终验标准（zcode 交付后一次性验收；发现每条缺陷=返工项）

1. 基线对账复现：HEAD/门禁 md5/golden 状态与台账一致。
2. 全量门禁独立复跑：tsc 0、ui/engine/E2E 计数与声称一致；断言/golden 变更逐条有申报。
3. RV 抽查 ≥3 条重放变红、还原 sha256 一致。
4. dialog 金标 40 条复核（act F1≥0.9、防编造负例拦截 100%）。
5. 8002 隔离实例真机重放：三截图原句（含「明天的那个」「把操场跑步替换掉」）+ 模式切换 + 离线降级（route.abort）。
6. 「明天晚上出去玩 1 小时」真实排上且可确认落盘（↩ 可撤销）。
7. 台账 §D、BLOCKERS、commit 链完整性；BLOCKERS 里的未完成项有如实说明。

## §11 风险与回退

LLM 错 act → 校验失败落规则链路；confirm 误触 → 双闸；状态膨胀 → 序列化白名单+上限+turns≤8；快照迁移 → v3 只写 v2 读合成；引擎行为漂移 → 申报制+golden 重拍留痕；**总回退开关 `DIALOG_ENABLED=false`**（send 直落规则链路，一行回 S/T 批行为）。
