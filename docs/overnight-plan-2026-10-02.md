# 通宵执行方案 · RAY 反馈修复批（2026-10-02 夜）

> **执行者**：无人值守 agent（ZCode `/goal` 或闲时任务）。本方案自包含：与 AGENTS.md §八冲突时，**以 §八为准**。
> **白天前置（2026-10-02 已完成并提交）**：
> 1. 项目转单人负责，AGENTS.md §二/§8.1 已更新（原 RAY 禁区作废；`src/types.ts`、`data/` 二进制、golden 既有条目仍为夜间硬禁区）；
> 2. `gate_overnight.mjs` 基线抬至 **engine ≥458 / ui ≥321**，禁区门名单清空（机制保留），实测全绿；
> 3. 离线理解评测基线已记录：**action F1 = 0.868**（规则先行口径的长期已知状态，见 `docs/eval-libao-understand-2026-09-27.md` 9-27 同值多轮；生产聊天的 LLM 主理解通道当时 F1=1.0）。
> 4. 现状证据与路线依据：`docs/ray-feedback-routes-2026-10-02.md`（commit `c0535c7`）。

---

## 一、总纪律（每批开工前重读一遍）

1. **顺序执行批 1→6，不跳批、不并批**；每批做完在批边界收工是合法状态，不强求全部做完。批 6 仅当前 5 批全绿且时间富余才开。
2. **每批收尾必跑**：`node scripts/gate_overnight.mjs`。全绿才许 commit。不过 → 修复 → 仍不过 → **写 `BLOCKERS.md` 并停手**（不再开新批，§8.2）。
3. **新断言一律「先红后绿」**：先写测试、在实现前跑出红（§8.4 要的反向验证），再实现转绿；commit message 注明 `reversed-verified`。
4. **金标纪律**：`evals/golden/plan_understand.jsonl` 只增不改；新增条目的期望值**手算自规约**（如 termStart+7×(N−1)+weekday−1 的日期数学），**禁止跑一遍实现抄输出**（防循环论证）。
5. **UI 改动的验收方式**：本仓无 DOM 测试设施，一律配**源码锁测试**（读 tsx 源码文本断言关键结构/文案存在，参照 `tests/wp7.test.ts` 的既有写法）；若改动撞上既有源码锁断言，同步更新该断言并在 commit message 注明「源码锁随实现演进」（这不是改断言凑绿，是 wp7 既有维护方式）。
6. **禁改/禁做**（夜间硬红线，撞上即 BLOCKER）：`src/types.ts` 结构性改动；`data/` 二进制；golden 既有条目；新第三方依赖；后台常驻进程（vite/后端/e2e 一律不跑）；删任何文件；`git push/reset --hard/rebase/clean/branch -D`；改 `.env`。
7. **提交粒度**：每个任务一个 commit（可独立回滚），前缀 `feat/fix/chore/docs(scope)`；只 commit 不 push。
8. **环境**：全部离线完成，不需要后端、不需要 Key、不需要起服务。Python 用 `C:\Users\CY\.workbuddy\binaries\python\envs\default\Scripts\python.exe`（Git Bash 路径 `/c/Users/CY/.workbuddy/...`）。
9. 台账（wp-ledger-v2）与 progress-status 的批次登记**留给早上人工做**，夜里不碰这两个文件（降低文档漂移风险）。

---

## 二、批次总览

| 批 | 内容 | 主要文件 | 预计 | 风险 |
|---|---|---|---|---|
| 1 | 理解层快赢包：7 条固有 FN 修复 + weekNo 槽位 + 月锚/滚年 + 学期词挂校历 + perWeek 幻觉防护 + 超时重试 | libaoIntent.ts / LbaoChat.tsx / api.ts / plan_dialog.py / golden 增补 | 2.5h | 低 |
| 2 | 铺块节奏：有截止目标的后程加长 | weekPlanForChat.ts | 45m | 低 |
| 3 | 梨宝单日重排（5A-②） | weekPlanForChat.ts / libaoIntent.ts / LbaoChat.tsx | 2h | 中 |
| 4 | 小 UI 包：周计划切周按钮 + demo 横幅 + persona 透传 | WeekPlanView.tsx / App.tsx / planner/schedule.ts | 1.5h | 中 |
| 5 | 画像解释面板（7A） | planner/profilePrefs.ts / persona/PersonaResult.tsx | 1.5h | 中 |
| 6 | （进取批）summarizeIssues 接线 + 列头日期/今天高亮 + actualLoadByDow 映射 + 周计划「只重排这天」按钮 | WeekPlanView.tsx / planner | 2h | 高 |

---

## 三、逐批任务书

### 批 1 · 理解层快赢包（价值最高：日期理解硬伤 + 兜底层补漏）

**开工先跑一次并记录**：`LLM_EVAL_OFFLINE=1 python scripts/eval_plan_understand.py` → 基线 F1=0.868、FN=[i02,i15,i21,i23,i25,i29,i30]。

#### 任务 1.1 修复规则层 7 条固有 FN（fix(libao)）

金标期望（都是规则词表/模式缺口，逐条归因）：

| id | 原话 | 期望 | 缺口归因 |
|---|---|---|---|
| i02 | 我周五下午要在学生会面试 | create，「学生会面试」+ 周五下午 | 「要在+动词」隔开了「我要」，第一人称意愿正则没接住 |
| i15 | 明天下午两点到四点在图书馆自习 | create，place=图书馆 | 「在+地点+活动名词」不在动作句模式 |
| i21 | 我这周忙不忙 | query | query 意图词表有「忙不忙」，但 looksLikeAction 快筛在前面把它拦了（老口径列表没有「忙不忙」） |
| i23 | 周五晚上班级聚餐 | create | 纯名词陈述句，无第一人称无动词 |
| i25 | 期末周之前把实验报告写完 | create | 「把…写完」的「写完」不在 ACTION_VERBS |
| i29 | 下周一起我每天要晨跑 | create，perWeek=7 | 「我每天要」隔开「我要」 |
| i30 | 隔天去一次健身房，每次一小时 | create，perWeek=4，60min | 「去一次」不在动词表；「隔天」无频率映射 |

- 改动：`src/features/libao/libaoIntent.ts` 的 `looksLikeAction` / `INTENT_PATTERNS` / `ACTION_VERBS` / 频率词表：
  - 意愿句放宽：「我+(时间词)*+要|想|打算|准备」允许中间隔时间词；
  - 名词陈述兜底：`(时间词)?+地点词?+目标名词$` 且无疑问词 → create（对齐 i23）；
  - 「把…写完/弄完/做完/交」进 ACTION_VERBS；「在+POI+活动」模式（对齐 i15，place 从 `在X` 抽取）；
  - query 词（忙不忙/有没有空/排得开）进 looksLikeAction 放行集（对齐 i21）；
  - 「隔天/隔一天」→ perWeekCount=4、「每天」→ 7（对齐 i30/i29）。
- 测试（先红后绿，新文件 `scripts/libao-intent-fn-fix.test.ts`）：上述 7 句逐条断言 `parseIntentSlots`（纯规则层）产出的 action/intent/title/when.text/perWeekCount/durationMin/place 与金标期望一致；另加 3 条**防误伤负例**（「学生会面试一般什么时候？」→ action=false；「聚餐去哪吃」→ action=false；「忙不忙是怎么算的」→ action=false）。
- DoD：`LLM_EVAL_OFFLINE=1` 重跑 → **action F1 ≥ 0.95 且 EM ≥ 0.90**；负例不破；engine/ui 全绿。

#### 任务 1.2 weekNo 槽位：「第10周周五」不再错 4 周（feat(libao)+feat(server)）

- 规约：`第N周(+周X)?` → `weekNo=N`（1–30）；有周X → exact 日 = `termStart + 7*(N-1) + (weekday-1)`；无周X → 以该周周一为窗（from=周一, to=周日）。
- 改动：
  - `libaoIntent.ts`：`WhenHint` 加 `weekNo?: number`；`extractConcreteWhen` 加正则（注意放行「第N周」且不与裸「周X」冲突）；`resolveWhen(hint, today, opts?: { termStart?: string })` 第三个可选参——有 termStart 按 above 数学换算（**手算锚点**：termStart=2026-08-31 时第10周周五 = 2026-11-06），无 termStart 维持 window 并在 slots.unclear 注明；`mergeLlmPrimary` 接受 weekNo patch（数字 1–30 越界丢弃）。
  - `LbaoChat.tsx`：把 `schedule?.termStart` 传进 resolveWhen 调用点（先 grep 调用点，最小侵入）；`mapUnderstandPatch`（:146）把 `p.weekNo` 并进 when。
  - `server/plan_dialog.py`：`_SLOT_SPEC` 加 `weekNo(1-30)`；`_clean_patch` 白名单加 `weekNo`；intent 场景任务定义一句话说明「第N周」抽 weekNo（**不改 8s/300 tokens 预算**）。
  - `src/lib/api.ts`：`PlanSlotPatch` 加 `weekNo?: number`。
- 测试：`scripts/libao-intent-weekno.test.ts`——resolveWhen 三例（含手算 2026-11-06）、无 termStart 降级例、mergeLlmPrimary 越界丢弃例；server 侧新脚本 `scripts/plan_dialog_patch_check.py`（纯 assert：import plan_dialog 后 `_clean_patch` 保留 weekNo=10、丢弃 31；跑通即绿，不进 gate）。
- golden 增补（只增）：追加 3 条 intent 用例：`第10周周五要交开题报告`（weekNo:10, weekday:5）、`第3周周一班级开会`、`第15周周四组会汇报`——期望值手写。先确认 `scripts/eval_plan_understand.py` 的槽位归一是否字段白名单（:184-185、:231-239 附近），是则把 `weekNo` 加进白名单（scripts/ 允许改）。
- DoD：探针句「第10周周五要交开题报告」resolveWhen 出 2026-11-06；离线评测不低于任务 1.1 后的水平（新 3 条 EM 不失分）。

#### 任务 1.3 相对月锚 + 过去月滚年（fix(libao)）

- 「下月底/月底/月初/月中/下月初」：`WhenHint` 加 `relativeMonths?: number`（本月=0/下月=1），与 decade（上/中/下旬）正交；resolveWhen month 分支支持 relativeMonths → `base 年月 + relativeMonths` 的旬窗口。
- 过去月滚年：month 窗口分支与 exact 分支的「90 天内取最近」规则改为「**结果早于今天 → 年 +1**」（原 90 天规则对「过去不久的月份」会返回过去日期，铺块会落进已过去的周）。⚠️ 动手前先 grep 既有测试是否 pin 旧 90 天行为：若有且与新决策冲突 → **按 §8.4 记 BLOCKER，不要改断言**。
- 测试：resolveWhen 六例（今天 2026-10-02 口径手算：9月→2027-09 窗口、12月→2026-12 不变、3月（未来）→2027-03、下月底→2026-11 旬窗、月底→本月下旬窗、月初→上…按规约写清）。
- DoD：探针句「我要报名数学建模，九月中旬比赛」dateFrom ≥ 今天；「论文答辩在下月底」落在 2026-11。

#### 任务 1.4 学期词挂校历（feat(libao)）

- 「期中(考试)?/期末(考试)?/学期末/结课/开学」→ `resolveWhen` opts 加 `termAnchors?: { midterm?: string; finalsFrom?: string; finalsTo?: string }`；`LbaoChat` 从 `src/constants/term.ts` 的 `TERM_CALENDAR['2026-2027-1']`（结构动手前先读）+ `schedule.termStart` 构造传入；certainty='window'，from/to = 锚点窗口；词表补「期中」（现只认「期中考试」）。
- 测试：五例（期中之前→midterm 前窗；期末考试前→finals 窗；无锚点降级为现状 window）；term 常量缺失时安全降级。
- DoD：探针句「期末考试前我要把高数复习完」dateTo = 校历期末窗起点附近（手算锚点写进断言）。

#### 任务 1.5 perWeek 幻觉防护 + understand 单次重试（fix(libao)+fix(server-ui)）

- `mergeLlmPrimary`：`patch.perWeekCount` 仅当**规则层已有**或**原话命中频率正则**（每[一二三四五六七八九十\d]*(天|周)|每天|天天|隔天|每周）才采纳，否则丢弃并 push 到 `unclear`。测试：构造「这学期我想养成晨跑的习惯」+ LLM patch perWeek=7 → 被拒（先红后绿）。
- `src/lib/api.ts` `planUnderstand`：`scene==='intent'` 且失败（网络异常 / ok:false 且 reason 含 timeout）→ **重试一次**（同 9s 超时；对话异步可接受，trade-off 写进注释）。测试：node:test 替换 `globalThis.fetch`（第一次 reject、第二次 200）→ 断言返回 ok 且 fetch 调用 2 次；负例：两次失败 → 返回 ok:false。
- DoD：两组单测先红后绿；真实探针句「这学期我想养成晨跑的习惯」不再幻觉出 perWeek=7（离线口径下规则层本来不幻觉，此断言打在 mergeLlmPrimary 单测上）。

**批 1 收尾**：5 个 commit（每任务一个）；gate 全绿；离线评测 F1 ≥ 0.95 且 EM ≥ 0.90；在 commit message 记录 F1 前后值。

---

### 批 2 · 铺块节奏：有截止目标的后程加长（feat(libao)，6C）

- 范围：`weekPlanForChat.ts` `goalToTasks`——仅当 `totalHours` 且 `dateTo`（有截止）时启用**块长递增**：窗口按天序三等分，块长 前 1/3=60 / 中 1/3=90 / 后 1/3=120（若用户显式给了 durationMin 则尊重用户不加权）；nBlocks 按 avgBlock=90 重算保总量守恒；`note` 追加「临近截止的块已加长」。
- 测试（新文件 `scripts/goal-pace.test.ts`，先红后绿）：六级 30h 案例（dateFrom 2026-10-05 / dateTo 2026-12-12 / 30h）→ ①总时长 = 1800min（±90 容差）；②后 1/3 窗口的块平均时长 > 前 1/3；③同输入两次完全一致（确定性）；④无 totalHours 的习惯目标块长不变（不加权）；⑤带显式 durationMin 的目标不加权。**反向验证**：新测试先在旧实现上跑红。
- DoD：gate 全绿；`_/probe_engine.mjs` 手工复跑（夜跑可跑 node 纯函数探针，不起服务）输出显示后程块长递增。

---

### 批 3 · 梨宝单日重排（feat(libao)，5A-②）

- **纯函数层**（weekPlanForChat.ts，唯一接缝内，import localizedReplan 合法）：
  ```ts
  // 非目标天保位：next 相对 prev 在这些天发生位移的块 → 产出 hard MoveRecord 钉回 prev 位置
  export function dayReplanPins(prev: WeekPlan, next: WeekPlan, changedDays: number[]): MoveRecord[]
  // 整周重排 + localizedPlan(prev, next, days) 融合 + 产出保位 pins；previousPlan 缺失 → 整周直接用 next、pins 为空
  export async function replanDaysForChat(args: {
    schedule: Schedule; profile: PersonaProfile; weekNo: number; tasks: UserTask[];
    days: number[]; previousPlan: WeekPlan | null;
  }): Promise<{ plan: WeekPlan; pins: MoveRecord[] } | null>
  ```
  语义：`localizedPlan` 的 changedDays 返回值就是「真的变了的天」，pins 只对 **changedDays 之外**且被挪动的块生成（source 用 `'edit'` = hard，语义：用户已确认的「其余天保持原样」）。
- **意图层**（libaoIntent.ts）：reschedule 族补「重排|重新排」（`重排(一下|周[一二三四五六日]|这[一二三四五六日]天?)`）；`IntentSlots` 加可选 `replanDays?: number[]`；**歧义路由**：有 `targetHint`（块名）→ 老的单块 reschedule；只有天、无块名 → 单日重排。
- **执行层**（LbaoChat.tsx）：`runReschedule` 分支——`replanDays && !targetHint` → `replanDaysForChat`（previousPlan 取当前侧栏计划）→ 草稿卡（列出目标天新块数 + 「其余 N 天保持原样」+ pin 数）→ confirm 走既有 `saveUserPlan` 通道 upsertMoves(pins) + `usst:replan` 事件（复用现有 draft/confirm 机制，**不新造确认流**）。
- 测试（先红后绿，`scripts/day-replan.test.ts`）：dayReplanPins 三例（他天没动→空；他天被挪→pin 回旧位含 hard 语义；目标天变化→不 pin）；replanDaysForChat 用 MOCK_SCHEDULE 干跑 → 融合后非目标天块集与 prev 完全相等（id+起止）；意图正则 5 例 + 歧义路由 2 例；**既有 wp9 reschedule 测试零改动全绿**（路由不漂移的证据）。
- DoD：gate 全绿；wp9 不红；新测试全绿。
- 风险与止损：若 `runReschedule` 改动导致 wp9 任何用例红且 30 分钟内归因不出 → 本任务回退（git restore 该文件）、记 BLOCKER「批 3 执行层部分顺延白天」，纯函数层若已绿可独立保留（独立 commit）。

---

### 批 4 · 小 UI 包（feat(week)/feat(app)/feat(planner)，三项各一 commit）

1. **周计划页切周按钮**（2A）：WeekPlanView `Props` 加可选 `onShiftWeek?: (d: number) => void`；头部渲染 `‹ ›`（aria-label「上一周/下一周」+ data-testid）+ 一行「键盘 ←/→ 也可切周」提示；`App.tsx` 传入既有 `shiftWeekBy`。源码锁测试：按钮存在、aria-label、提示文案。
2. **示例课表横幅**（8B）：App.tsx 顶栏在 `schedule.source === 'demo'` 时渲染横幅「当前是示例课表，去『课表』页导入你的真实课表 →」+ 跳转（现有 tab 切换函数）；导入成功（source 变更）后消失。源码锁测试：条件渲染 + 文案 + 跳转调用。
3. **persona 透传**（1A-③）：`BuildWeekPlanInput` 加 `persona?`、`toPlanRequest` 带上、WeekPlanView 调用点传已有 persona prop。单测：toPlanRequest 透传断言（先红后绿）；既有 golden/wiring 测试零漂移（缺省不传 persona → 行为不变）。**commit message 显式申报契约字段新增**（§二 契约层纪律）。
- DoD：gate 全绿；三 commit 独立可回滚。

---

### 批 5 · 画像解释面板（feat(persona)+feat(planner)，7A）

- **planner 侧**：`profilePrefs.ts` 新增导出
  ```ts
  export interface ProfileExplainItem { element: string; value: string; effect: string; source: 'phase' | 'prefs' | 'template' }
  export function explainProfile(profile: PersonaProfile | null, scenarios: Scenarios | null): ProfileExplainItem[]
  ```
  聚合三处既有映射：buildPhases.applyPersona 的阈值规则（ACH/PLAN/HEA/RES）、blockPrefs（HEA→深度窗、planning→碎片、meal_radius→步行预算）、模板触发（exercise_trigger/night_supply/social_radius/event_breadth）。**行为不变要求**：两处消费点改读同一张规则表（可选；若侵入过大，第一版允许 explainProfile 独立实现但注释里双向锚定行号，留 TODO 合表）；既有 profile-prefs/knowledge-wiring 测试**零改动全绿**是硬门槛。
- **persona 侧**：PersonaResult 在「你给出的日常偏好」区后加折叠面板「这会如何影响你的排程」：逐条渲染 element/value/effect，每条尾部固定口径「这是我猜的，可在周计划里改」（L3 边界，week-view-design §5 同款）；空画像（未测）显示引导语。
- 测试：explainProfile 单测（HEA=70/35/80 边界、PLAN=70/35、meal_radius 两档、四模板触发、null 画像→空数组；先红后绿）；源码锁（面板存在 + 口径文案 + 折叠初始态）。
- DoD：gate 全绿；画像相关既有测试零改动。

---

### 批 6 · 进取批（仅当前 5 批全绿且时间富余；任一门禁红 → 不开本批）

1. **summarizeIssues 接线 + 列头日期 + 今天高亮**：WeekPlanView 顶部聚合条（点击展开明细，明细保留在底部面板或收进抽屉）；7 列列头补具体日期；今天列高亮（todayDow 已有）。**先读 `tests/wp7.test.ts` 网格类名断言**再动手；改到被锁类名 → 同步更新断言并注明。源码锁测试新增：聚合条、日期、高亮。
2. **actualLoadByDow 映射**（1A-①）：solveWeek 把 `req.actualLoadByDow` 写进 ConstructCtx。先写表征测试（传 req 字段 → mergeLoad source 变 'actual'，先红）；若既有引擎测试因此红 → 逐条归因：能定性为「行为按规格改进」→ 按新规格重写该断言并在 commit message 申报；**归因不出 → BLOCKER 停**。
3. **周计划页「只重排这天」按钮**（5A-①）：每列头 hover 出「只重排这天」，复用 WeekPlanView 既有 localizedPlan 管线传 `days:[d]`；源码锁 + 既有 wp4b 全绿。

---

## 四、明确不做（通宵）与理由

| 项 | 理由 |
|---|---|
| previousCommits 语义推导（1A-②） | Commit 派生口径需要人工拍板，夜里猜语义风险大 |
| sleepMin 进引擎（1C） | construct 核心手术，留给白天带监督做 + golden 复核 |
| 4B 日/三日/周视图切换、8A 首启导入步 | 大交互流改动，夜里无 e2e/浏览器验证，验收盲区大 |
| 3B 删 MealPlaceSetting.tsx | §8.3 夜间禁删文件（白天一条命令的事） |
| 6B 长目标一等公民、5B 引擎单天重排、8C 仓内 PDF 解析 | 体量大、需先定口径（见路线文档 §9） |

---

## 五、无人值守启动指令（模板）

> 读 `AGENTS.md`（§八优先级最高）与 `docs/overnight-plan-2026-10-02.md`，然后严格按方案执行：从批 1 开始按批推进，每批收尾跑 `node scripts/gate_overnight.mjs`，全绿才 commit；批边界允许收工。遵守方案 §一总纪律：types.ts/data 二进制/golden 既有条目禁改；不起任何后台服务；不删文件；不 push；新断言先红后绿；修不回来就写 BLOCKERS.md 停手。做完每批在最终汇报里列出：批次、commit 列表、gate 输出摘要、离线评测 F1 变化（批 1）。

---

## 六、早上人工验收清单（CY）

1. `git log --oneline` 过一遍批次提交；`node scripts/gate_overnight.mjs` 复跑全绿。
2. `BLOCKERS.md` 有无新增；有 → 先处理阻塞项。
3. `LLM_EVAL_OFFLINE=1 python scripts/eval_plan_understand.py` 复核 F1 ≥ 0.95。
4. **真机走查（夜里做不了的部分）**：`npm run dev` + `PORT=8001 python server/app.py` 后——
   - 梨宝输入「第10周周五要交开题报告」（应认 11-06）、「只重排周四」（其余六天不动）、「这学期想养成晨跑的习惯」（不幻觉每天）；
   - 周计划页 ‹ › 按钮、示例课表横幅、画像页解释面板；
   - `npm run test:libao`（45 轮真机对话）跑一轮看路由/内容无回退。
5. 早上顺手项：登记台账与 progress-status；删 `MealPlaceSetting.tsx` 死代码；把 1A-②（previousCommits）、sleepMin 进引擎、4B、8A 排进白天批次。
