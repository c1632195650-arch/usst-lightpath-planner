# 梨宝排程交互智能化优化方案（详细版）

> 2026-10-02 · 依据：用户真机反馈三张截图 + 两轮代码探索报告（解析层/交互层 + 知识库/数据基础）
> 落地线：beta-v2 实现 → 门禁 → delta 合并 integration-full → 双树（5173/5174）真机验收
> 纪律：**每次最多开两个智能体**；只动 CY 名下文件（`features/libao/**`、`server/plan_dialog.py`、新增 `features/libao/taxonomy.ts`、`docs/`）；`src/types.ts` 与队友禁区零改动；每批门禁全绿才进下一批。

---

## 〇、回归保护（硬约束：不影响已调通的排程功能）

**原则：所有新能力都是加法通道——输入里没有新要素（钟点词/长期语义）时，代码路径与当前已调通版本逐位一致。**

1. **改前先锁现状（characterization tests）**：动手前先把本次已调通剧本的关键中间值固化为自动化断言，写进 `tests/`（如 `tests/libao-regression-anchor.test.ts`）：
   - 「周四晚上出去玩一小时」→ parseIntentSlots 输出 `durationMin=60`、`window=晚上(1080-1380)`、`weekday=4`、`missing=[]`；草稿卡含「单次：60 分钟」
   - 「下周一开始；一共10小时」→ `totalHours=10` 并入、`missing=[]`、撞车 verdict.kind='conflict'、blocked 编号选项含 `reduce_total`
   - 协商答"1"（parseOptionChoice）→ runGoalSlots 收到降档槽位；确认后落盘层含任务
   - **改任何解析代码前先跑绿**，此后每批必跑；红 = 停下修复，不许"顺手改断言"。
2. **全量回归门禁**：每批提交前跑 `typecheck` 0 错 + `test:engine`（459+ 全过）+ `test:ui`（321+ 全过）+ e2e（`scripts/e2e-sched-session.mjs` 77 断言，**必须离线跑**）+ golden 5/5。
3. **文案变更申报制**：批次 2 会改 describeVerdict/blocked 文案——实施前先 grep e2e/golden/测试是否锚定旧文案，锚定处同步更新并在 commit message 逐条申报；golden 只增不改。
4. **逃生门**：新钟点通道加环境开关（`LIBAO_CLOCK=0` 回退旧行为），沿用项目 `'0'` 逃生门惯例——真机异常时一行回退，不回滚代码。
5. **双剧本真机**：旧剧本（本次调通的 1-3，回归）+ 新剧本（本轮目标）在 5173/5174 双树都过，才验收。
6. **变更面白名单**：只动 `src/features/libao/**`（含新 taxonomy.ts）、`server/plan_dialog.py`、`docs/`、测试文件；`src/types.ts`、`src/lib/planner/**`、`src/features/week/**`、`src/components/**` 零改动；引擎侧零改动（钟点只经既有 window/notBeforeMin/notAfterMin 通道进引擎）。
7. **加法通道设计细则**（每处的"现状不变"论证）：
   - clock 字段：句中无钟点词 → clock=undefined → goalToTasks/描述/追问全部走原分支（空值短路）
   - 频率互斥：只改变「每天+时长单位」这一误判场景；纯「每周N次」「每天都来（无时长）」「每周3次每次2小时」路径不变
   - mergeLlmPrimary when 守卫：只在「patch 是裸 window 原话 且 规则层已有结构化 when」时生效；所有结构化 patch（weekday/relativeDays/month/day/exact）路径不变
   - ask_slot 改造：先并答案——但本地解析对无槽位信息的句子零贡献（字段 undefined 不覆盖），LLM patch 仍作主；S1 批量应答/answer 场景回归锚覆盖

---

## 一、问题清单与根因（全部真机复现 + 代码定位）

### 截图实录

| # | 现象（截图） | 根因（文件:行号） |
|---|---|---|
| 1 | 答「周六晚上大概6点左右；大概打到8点」→ 仍重问「大概占多久？」 | **钟点时刻通道整体缺失**：`WhenHint`（libaoIntent.ts:69-93）只有 month/day/weekday/relativeWeeks 等**日粒度**字段，无 hour/minute；唯一认识钟点的 `spanDurationMin`（:1226-1239）把「6点到7点」**只折算成时长**、不产起止，且只在 effort 追回答答语境生效；`extractWindow`（:761-771）只认 `18:00` 数字冒号形态，不认「晚上6点」「6点到8点」「打到8点」「大概6点左右」 |
| 2 | 「周五下午；每天两小时」→ 草稿出现「**频率：每周 7 次**」 | `extractFrequency`（:739-747）的 `/每天\|每日\|天天/` **无条件全句命中** → perWeekCount=7；`extractEffort` 同时产 durationMin=120。两套正则无互斥，`parseIntentSlots`（:1426-1427）两个都收。「每天两小时」是**时长节奏**，不是「每周来 7 次」的长期频率承诺 |
| 3 | 用户点明周六晚 6-8 点，草稿却排到**周五下午 15:30** | 钟点丢失后只剩 window（晚上 18-23）+ 频率 7 次泛排；goalToTasks（weekPlanForChat.ts:193-275）按 window+频率铺块，原始时刻意图全丢 |
| 4 | 冲突反馈一大长串（4 条挡路块全列） | blockingBlocks 扫描最多 5 条**全部平铺**（weekPlanForChat.ts:480-495），caveats 逐条罗列，无「最相关」筛选、无类型标签 |
| 5 | 「回编号（如「1」）」要打字，简陋 | 无多选项按钮卡：编号方案拼进 planPoints 纯文本（LbaoChat.tsx:1114-1117），编号回答靠 `parseOptionChoice` 打字兜底；pick_candidate 挑块同样是打字 |
| 6 | "真排得上的路"只有 1 条，没有选择余地 | `proposeReplanOptions`（weekPlanForChat.ts:635-700）仅 4 类方案（swap/move_next_week/reduce_duration/reduce_total），干跑后常只剩 1 条 |
| 7 | "打篮球要多久"没概念 | 无类目分类、无权威时长建议接线、无本周已安排量统计 |

### 引擎合法性判断的现状（回答"这个不用 llm 做，不知是否做过？"）

**已做过，且完全是引擎侧、不经 LLM**：`checkGoalFeasibility`（weekPlanForChat.ts:360-578）干跑四关——
- 关一：槽位缺口 → needs_clarification
- 关二：goalToTasks 展开 0 块 → infeasible
- 关三：**逐周引擎干跑对比**（planWeekV2 before/after）→ 碰撞/转场/容量 issues diff + 挡路块矩形扫描（dayOfWeek × notBeforeMin/notAfterMin 重叠，含 blockId 与 `周X(M.D) HH:MM–HH:MM` hint）
- 关四：落块数 0 / 新增 error → conflict；容量上限 `wantMin > gotMin` → conflict；studyDelta < -60 → tight；否则 ok

**本轮不改判断层，只改呈现层与选项生成层。**

---

## 二、现状可复用资产盘点（探索结论）

| 资产 | 位置 | 可复用点 |
|---|---|---|
| TimeWindow {fromMin,toMin,text} | libaoIntent.ts:96-101 | 钟点解析后的落点——窄化 window 即可驱动引擎（D4 已接 notAfterMin） |
| spanDurationMin 的中文钟点正则（六点半/中文数字） | libaoIntent.ts:1226-1239 | 直接改造为 `extractClockRange`（产 startMin/endMin 而非时长） |
| goalAsk 双按钮卡 + pendingSeq key 机制 | LbaoChat.tsx:107-119, 1887-1906 | 多选项按钮卡的现成骨架 |
| blockingBlocks（含 blockId） | GoalVerdict | 协商按钮卡的数据源 |
| 干跑式方案生成 proposeReplanOptions | weekPlanForChat.ts:635-700 | 扩容的基础设施（`feasible()` 干跑闸直接复用） |
| 健康库 tier A 参数（已编译进前端常量） | health.ts:28-40 | ACTIVITY：每周中高强度≥150min / 力量≥2天 / 单次≥10min；SEDENTARY：60min 打断、6000 步——**推荐依据的数据源，现成** |
| 方法库学习类条目 | method_kb.db（42 条） | deep-work 90min、pomodoro [25,50]、mcm-3day-timeline（竞赛 72h）、spacing-effect（tier A） |
| 画像/记忆输入 | PersonaProfile.axes+scenarios、BasicInfo.exercisePerWeek、profilePrefs | 个性化推荐的可解释输入 |
| 类目分钟统计范式 | summarizeWeekPlan（weekPlanForChat.ts:107-137）的 minutesOf 模式 | `categoryMinutesOfWeek` 照此实现 |

**缺口**：method_kb/health_kb 均无「运动项目→强度类目」「学习类目→周投入」映射（需轻量新增，见批次 3）；PlanEvent 不带 kind/minutes（本轮不动，改用 WeekPlan.blocks 聚合）；usst.ts 运动模式「每周四次」与健康库 `sessionsPerWeek:5` 口径不一致（本轮统一引用健康库口径）。

---

## 三、设计总则（交互原则）

1. **减文字密度**：单条消息正文 ≤3 行；细节进 planPoints；冲突反馈 ≤6 行且首条必是最相关冲突。
2. **多轮次换低密度**：一轮只问/只说一件事，宁可多一轮对话。
3. **能按钮不打字**：每个追问/选择都给 2-4 个快捷按钮 + 永远保留自由输入框；按钮点击 = 走对应选项文本（编号兜底 parseOptionChoice 继续保留，双保险）。
4. **推荐必须带依据**：任何"建议 X 分钟"后面跟一行来源（知识库条目 + tier + 用户本周已排量），≤1 行。
5. **分类不过细**：运动二分（有氧/力量）、学习二分（课程学习/研究探索），关键词映射不穷举，未知 → 通用默认。
6. **始终给自定义空间**：所有按钮卡必含「其他/自定义」路径（即自由输入）。

---

## 四、批次 1 · 解析层（消灭重问与误判）

### 4.1 钟点时刻通道

**数据结构**（libaoIntent.ts，不动 types.ts）：

```ts
/** IntentSlots 新增 */
clock?: { startMin: number; endMin: number; text: string };  // 钟点起止（分钟数 0-1440）
```

**新函数 `extractClockRange(q: string)`**：

- 重构自 `spanDurationMin` 的中文钟点正则，但**产起止不产时长**：
  - 钟点原子：`(\d{1,2})` / 中文数字 / `N点半`（+30）/ `N点X分`；「晚上6点」→ 18:00（PERIOD_WORDS 语境提升）；「下午3点」→ 15:00；24 小时歧义（"6点"无语境 → 按 06:00 并在草稿卡 caveat 说明）
  - 区间连接词：`到|至|—|打到|玩到|学到|弄到`；「打到/玩到/弄到」后的钟点标记为 **end**
  - 「大概/左右/前后」容词忽略
  - 单端点：只给 end（「打到8点」）→ startMin 取已有 window 起点（晚上=18:00）或 undefined；只给 start → endMin undefined
- 接入 `parseIntentSlots`；clock 与 window 并存取**交集**，交集为空（钟点在时段窗外）→ **以 clock 为准**，unclear 加一行「你给的钟点与『下午』不一致，按你说的钟点排」
- LLM 通道：`server/plan_dialog.py` `_SLOT_SPEC` 增 `startMin/endMin`（"6点到8点"=1080/1200，"晚上6点左右"=1080），`_clean_patch` 白名单放行；前端 `mapUnderstandPatch` 透传为 clock；prompt 补「多信息自然句式（不必分号隔开）」

### 4.2 时长自动推导（消灭重问的钥匙）

`parseIntentSlots` 末尾：有 `clock.endMin-startMin` 且 `durationMin/totalHours` 均缺 → `durationMin = endMin - startMin`。
→ 用户一句「周六晚上6点到8点我要打球」同时补齐 when + effort，**直接出草稿/冲突卡，零追问**（截图 1 的直接解药）。
反向验证：删掉推导逻辑 → 该句仍触发 effort 追问 → 用例红。

### 4.3 频率互斥（"每周7次"根因）

```ts
// 「每天两小时」是节奏描述不是频率承诺：每天后面紧跟时长单位 → 不算频率
if (/(每天|每日|天天)\s*([0-9.]+|[一二两三四五六七八九十]+)?\s*(?:个)?\s*(?:小时|分钟|h)/.test(s)) return undefined;
if (/(每天|每日|天天)/.test(s) && !/(小时|分钟)/.test(s)) return 7;  // 「每天都来」无时长 → 才是频率
```

反向验证：删掉互斥 → 「每天两小时」重现 perWeekCount=7 → 用例红。
连带：describeSlots 的「频率：每周 7 次」只在 perWeekCount 真由频率语义产出时出现。

### 4.4 绝对时刻进引擎（零引擎改动）

`goalToTasks`：clock 存在 → `notBeforeMin = startMin`、`notAfterMin = endMin`（复用 D4 既有 window 通道）；与 window 交集逻辑如 4.1。
**刻意仍不给 startMin 硬锁定**（保留"软偏好、引擎可挪"的既有哲学；草稿卡如实展示排到的实际时段）。

### 4.5 批次 1 测试清单（scripts/libaoIntent.test.ts + tests/d-batch.test.ts，全带反向验证）

- 「周六晚上大概6点左右；大概打到8点」→ clock={1080,1200} + durationMin=120 + when=周六 → **missing=[]**（反向：删推导 → 重问 effort → 红）
- 「晚上6点到8点」「六点半到八点」「明天下午3点到5点」各形态
- 「周五下午；每天两小时」→ durationMin=120、perWeekCount=undefined（反向：删互斥 → 7 → 红）
- 「每天都来，不用时长」→ perWeekCount=7 仍成立；「每周3次，每次90分钟」回归不变
- clock 与 window 矛盾（「下午6点到8点」→ clock 赢 + unclear 注记）
- 「周一晚上6点」24 小时歧义 → 18:00 + caveat
- **回归锚全套（〇.1）先跑绿**

---

## 五、批次 2 · 交互层（按钮卡 + 反馈精简）

### 5.1 多选项按钮卡组件

**Msg 新增字段**（LbaoChat.tsx:76-103 处）：

```ts
options?: Array<{ idx: number; label: string; hint?: string }>;
```

渲染（goalAsk 双钮模式扩展）：按钮组纵向排布，样式复用 button-primary/button-secondary；点击 = `send(选项文本)`（走既有解析与编号兜底，双保险）。**自由输入框永远在下方。**

### 5.2 三个落点

| 场景 | 按钮 |
|---|---|
| **协商（blocked）** | proposeReplanOptions 每条方案一个按钮（"降一档到 1.5h" / "改到周四晚上 18:30-20:30" / "顶掉『图书馆自习』"…），附 1 行 hint（干跑事实） |
| **挑块（pick_candidate）** | 候选 ≤5 个全部按钮化（标题+时间 hint），不再要求打字报名字 |
| **追问（collect）** | 见 5.3 |

### 5.3 追问按钮卡（每问 2-4 个快捷项 + 自定义）

| 槽位 | 快捷项（生成器 `quickOptionsFor(slot, slots, profile)`） |
|---|---|
| when | 今晚 / 明晚 / 明天下午 / 本周六晚上（按今天日期动态算具体周几文案） |
| effort（单日，如运动） | 45 分钟 / 60 分钟 / 90 分钟 / 2 小时 —— 次行小字 tips（批次 3） |
| effort（长期） | 每周 1-2 次 / 每周 3-4 次 / 每天 30 分钟 |
| 频率语义出现时 | **只这周试一次 / 每周固定来**；选长期 → 追问「持续到什么时候」：期中前 / 学期教学周结束 / 自定义周数（默认教学周末），写 dateTo → goalToTasks weeks 覆盖 |
| 地点（place 缺失时） | 按类目给常用点（运动：操场/体育馆/健身房；学习：图书馆/空教室/宿舍） |

选项来源分层：槽位类型静态表（本轮）→ 批次 3 叠加画像/历史个性化与知识库依据。

### 5.4 反馈精简（≤6 行）

`describeVerdict` / LbaoChat blocked 分支改造：

1. blockingBlocks 按「与目标块时间重叠度」排序取 **top1-2**（其余并入一行「另有 N 处时段被占」）；
2. 每条带类型标签：`⏰ 时间撞` / `📦 量放不下` / `🚶 转场不够` / `🪟 时段窗卡住`（按 issue code 与扫描来源映射）；
3. caveats 去重合并（默认窗口/没地点/不确定 三类各最多 1 行，并成一行）；
4. 正文压缩示例：`「打篮球」排不进去：周五下午全被占，晚上 6-8 点与你说的时段差 2 小时。给你 3 条排得上的路：` + 按钮卡；
5. planPoints 渲染升级：标签 emoji + 类型着色（轻量 span）；
6. 文案变更按〇.3 申报制处理 e2e/golden 锚点。

---

## 六、批次 3 · 推荐层（分类 + 依据 + 选项扩容）

### 6.1 类目分类 `src/features/libao/taxonomy.ts`（新文件）

```ts
export type GoalCategory =
  | 'sport-aerobic' | 'sport-strength'          // 运动：有氧 / 力量
  | 'study-course' | 'study-research'           // 学习：课程学习 / 研究探索
  | 'generic';

export const TAXONOMY: Record<GoalCategory, {
  label: string;
  keywords: string[];           // 不穷举：每类 6-10 个高频词
  reference: (ctx) => string;   // 权威建议一行文案（带依据）
  tips: string[];               // 时长概念锚，各 3-4 条
}> = { ... };
```

- 数据源注记写死在文件头：运动参考 = health_kb `aerobic-150`（每周中高强度≥150min，**tier A**）+ `strength-2days`（≥2 天/周，tier A）；学习参考 = method_kb `deep-work`（单块≤90min）+ `mcm-3day-timeline`（竞赛 72h）+ `spacing-effect`（tier A）
- `classifyGoal(title, kind)`：关键词映射（篮球/跑步/骑行/游泳→有氧；健身房/器械/力量→力量；作业/复习/考试/四六级→课程学习；竞赛/建模/项目/科研→研究探索；未知→generic）
- 分级原则：**二分粒度、有 tier A 支撑、不穷举项目**；usst.ts 运动模式口径统一改引健康库

### 6.2 已安排量统计

```ts
// weekPlanForChat.ts
export function categoryMinutesOfWeek(plan: WeekPlan, cat: GoalCategory): number
```

照 `summarizeWeekPlan` 的 minutesOf 范式，按 `TimeBlock.kind + title 关键词` 映射到 taxonomy（不改锁死的 types.ts、不加 TimeBlock 字段——分类只是读侧视图）。

### 6.3 带依据的推荐（回答篮球例子）

追问 effort / 草稿卡出现时，若分类 ∈ 运动：

> 按钮卡次行：`依据：健康库（A级）中高强度每周≥150分钟；你本周已排跑步 45 分钟 → 建议单次 60-90 分钟`

学习探索类：

> `依据：方法库：数模国赛全程参考 72 小时；单次深度工作 ≤90 分钟`

个性化输入（本轮接入最轻量的两个）：`BasicInfo.exercisePerWeek`（用户自报运动频率）与本周 `categoryMinutesOfWeek` 统计；画像轴/对话历史留下轮（PlanEvent 不带类目，改造收益不匹配本轮）。

### 6.4 时长概念锚（tips）

taxonomy.ts 每类 3-4 条，按钮卡次行轮换展示：

- sport-aerobic：`60 分钟 ≈ 半场 3v3 / 操场 8-10 圈`、`健康底线：单次至少 10 分钟才计入`
- sport-strength：`力量日健康建议每周 ≥2 天，每次 6-8 个动作×2-3 组`
- study-course：`一门课的常态化复习 ≈ 每天 25-50 分钟（番茄档）`
- study-research：`数模国赛 72 小时是全程参考线，拆到 3 周 ≈ 每天 3.5 小时`

### 6.5 协商选项扩容（目标 ≥3 条真实可行，全部过干跑闸）

现有 4 类之外新增：

- **⑤ 换空档 `move_to:<iso>`**：在本周/下周扫 `window ∩ clock`（若有）或全天的最大空档，取前 2 个候选日 → `dateFrom/dateTo=该日` 干跑通过才出（label：「改到周四晚上 18:30-20:30」）
- **⑥ 拆分 `split`**：`durationMin` 减半 + `perWeekCount`×2（或 days 数加倍），干跑通过才出（label：「拆成 2×60 分钟，分两天」）

返回上限 3→4 条；仍不足 3 条时如实说「可选的路有限」，并给「先不排 / 我换个说法」按钮。

---

## 七、测试与验收

### 单测（每批随写，全部带反向验证）

| 批次 | 测试 |
|---|---|
| 0（回归锚） | 〇.1 的现状固化断言全套 |
| 1 | 钟点解析全形态（中文/点半/相对语境/单端点/矛盾窗/24小时歧义）；时长推导（反向：删推导→红）；频率互斥（反向：删互斥→7→红）；plan_dialog patch 白名单 |
| 2 | quickOptionsFor 各槽位生成；按钮文本与 parseOptionChoice 互通；反馈行数 ≤6 断言（源码锁 + 纯函数）；标签映射正确 |
| 3 | classifyGoal 关键词表；categoryMinutesOfWeek 聚合；推荐文案含依据行；⑤⑥ 干跑通过才出现（反向：删干跑闸 → 红） |

### 真机剧本（双树 5173/5174 各一遍，旧+新全部通过才验收）

**旧（回归，本次已调通的）**：
1. 「周四晚上出去玩一小时」→ 单次 60 分钟 → 确认 → 预览不回退 → 横幅收口
2. 「帮我排个实验报告」→ 答「下周一开始；一共10小时」→ 撞车带真编号选项 → 答"1" → 新草稿
3. 问答模式 RAG 正常

**新（本轮目标）**：
4. 「帮我规划一下我明天要打篮球」→ 首问即**按钮卡**（45/60/90/2小时 + 依据行）→ 点 90 → 草稿（明天 + 90min + 地点按钮可选）→ 确认落盘
5. 「周六晚上6点到8点我要打球」→ **零追问**直接草稿（18:00-20:00）或冲突卡
6. 冲突时反馈 ≤6 行、首条最相关冲突带类型标签、按钮 ≥3 个、无"回编号"打字要求
7. 「周五下午；每天两小时」全程无「频率：每周 7 次」

### 门禁

每批：`typecheck` 0 错 + `test:engine` fail=0（459+）+ `test:ui` fail=0（321+）+ e2e 77 断言 + golden 5/5 + 回归锚全绿 + 该批真机条目通过，才进下一批。

---

## 八、实施顺序与提交

| 批次 | 内容 | Commit |
|---|---|---|
| 0 | 回归锚测试先行（现状固化） | `test(libao): 排程回归锚——现状固化` |
| 1 | 解析层（钟点/推导/互斥/LLM 通道/逃生门） | `feat(libao): 钟点时刻通道+时长推导+频率互斥` |
| 2 | 交互层（按钮卡/追问卡/暂时长期/反馈精简） | `feat(libao): 排程对话按钮卡+反馈精简` |
| 3 | 推荐层（taxonomy/统计/依据/选项扩容） | `feat(libao): 类目推荐+协商选项扩容` |

每批落地线：beta-v2 提交并 push → delta 合并 integration-full → 门禁 → 5174 真机复测。**每次最多两个智能体。**

---

## 九、明确不做的事（防跑偏）

- 不穷举运动项目/学科类目（无止境）——二分类 + 关键词映射，未知走通用默认
- 不动 `src/types.ts`（clock 用 IntentSlots 内新字段；TimeBlock 分类用读侧映射）
- 不重做引擎合法性判断（已有四关干跑，本轮只改呈现与选项生成）
- 不引入 MET 值表等新数据工程（health_kb tier A 参数够用；需要更权威时下轮再扩库）
- 不把 PlanEvent 改造、画像轴/对话历史深度个性化纳入本轮（收益/成本不匹配，登记后续）
