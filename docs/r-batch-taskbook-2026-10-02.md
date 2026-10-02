# 光溯 · R 批排程体验整改任务书（交 zcode 独立执行）

> 委托人：CY。制定：MOSS（2026-10-02 晚，基于 CY 13 张真机截图复盘 + 代码级根因定位）。
> 前置：白天批已验收（`integration-full @ 02ae028`，tsc 0 / engine 620 / ui 415 / 后端 8 套 Python 回归全绿）。
> 背景路线稿：`outputs/改进技术路线-2026-10-02.html`（本文 §三 各条「依据」栏与之对应，根因已实测）。
> **本任务书自包含。遇未覆盖决策点 → 写 `BLOCKERS.md` 停下等 CY，不擅自裁决。**

---

## 一、背景一句话

CY 用真机走查报出 10 条排程体验问题。经代码级定位：**9 条是「已实现但没做到位」（功能存在，条件没满足或口径错了），只有 1 条是新增能力**。典型如「右上没有账号菜单」——`AccountMenu.tsx` 早已挂载，只是条件写成了「已登录」（`App.tsx:380`），而本机 serve.py 未启动走 `offline` 降级，菜单就不渲染。**本批的任务是把这些"差一点"补齐，外加新做「日程评估引擎」。**

范围分三波：**Wave 1 = 对话与排程的正确性**（P0，最伤体验）→ **Wave 2 = 语义与信任**（P1）→ **Wave 3 = 新能力**（P2）。每完成一项即单独提交；Wave 之间可连续做，但遇到 §三 标【需 CY 裁决】的子项**必须停下写 BLOCKERS**。

## 二、验收标准（DoD，全绿才算完成）

| 门 | 基线（**只增不减**） |
|---|---|
| `npm run typecheck` | 0 |
| `npm run test:engine` | ≥620 pass / 0 fail |
| `npm run test:ui` | ≥415 pass / 0 fail |
| 后端 `scripts/test_*.py`（8 套） | 全绿；其中 `test_campus` ≥254、`test_direct` ≥39（本批不许退化） |
| **golden**（`tests/golden-compare.ts` + `tests/golden/`） | **全 5/5**（红线 1：红了 = 停，禁止重拍快照） |
| E2E（`scripts/e2e-journey.mjs` / `scripts/e2e-sched-session.mjs`） | 按新动线更新后全过 |
| 变异体反向验证 | 引擎 / 解析类改动**每项 ≥1 条**（删实现 → 恰红 → 还原 sha256 一致） |

交付物：①每个 WP 单独提交（中文 message，写明任务书条目号）②`docs/wp-ledger-v2.md` 新组落节 ③逐项验收证据（命令 + 输出）④push `origin/integration-full`（**只准推这个分支**）。

---

## 三、执行项（按波次与优先级，每项独立提交）

### Wave 1 · P0：对话与排程的正确性

#### P0-1 · R4 替换链路修复（**最伤体验，第一优先**）

**现象**：说「把下周二的饭后消食替换成打篮球」→ 梨宝列出 5 条候选（**含周一的**）；接着回「饭后消食」→ 梨宝答「记下了——还差一点：大概占多久？」，**把候选回复当成全新事项重问时长**。

**依据（两条独立根因，已实测）**：
1. **候选不看时间**：`src/features/libao/weekPlanForChat.ts:1035-1083` 的 `findCancelTargets` 用 `title.includes(needle) || needle.includes(title)` 匹配，「**下周二的**」这个时间约束完全没有参与过滤 → 周一 / 周二的同名块全进来。
2. **候选回复被 LLM 抢答**：`src/features/libao/LbaoChat.tsx:1749` 先跑 `tryDialogAct`（LLM 对话管理器，`DIALOG_ENABLED = true` 见 `:202`）；若 LLM 裁成 `new_intent`，进入 `:1520` 分支——该分支的「续答」条件只认 `phase === 'collect'`，而挑块相位是 `picking`（`src/features/libao/dialogManager.ts:118-135`）→ 两不匹配 → 落到 `:1571 runGoalSlots(create)` → 缺 `durationMin` → **重问时长**。而确定性兜底 `clarifyPicking`（`:1755`）**排在 LLM 之后**，永远抢不到。

- [ ] **R4.1 候选带时间**：解析原句的「下周二的」→ 拿到 `dayOfWeek=2`，`findCancelTargets` 增加 day 维度过滤（只留该天的块）；
- [ ] **R4.2 同名多块两级收窄**：命中 >1 且都有 day 时，**先问「哪一天」**（一天一个按钮），**再问「哪一段」**（该天的时段）。这正是 CY 的原话要求「先问想目标时间嘛；或者简单的早中晚也可以」；
- [ ] **R4.3 相位纪律**：`dialogManager.ts` 的校验里加一条——`topic.phase === 'picking'` 时**只允许** `pick_candidate / cancel / confirm`，禁止 `new_intent` 接管；
- [ ] **R4.4 确定性优先**：`clarifyPicking`（`:1755`）在场时，候选回复**先过确定性匹配**（把该分支提到 `:1749` 之前，或让 `tryDialogAct` 在 picking 相位直接让位）；
- [ ] **R4.5 按类目推荐替换目标**（CY 要求）：用 `classifyGoal`（`src/features/libao/taxonomy.ts`）给用户意图分类；若目标是健康类，候选里**优先列健康类块**（晨跑 / 健身 / 饭后消食…）作为可替换目标；
- [ ] **验收**：新增 E2E 两条——①说「把下周二的饭后消食替换成打篮球」→ 候选**只含周二**；②回「饭后消食」→ 命中唯一 → **直接出替换草稿，不再问时长**。

#### P0-2 · R2 排程必问「时段」

**现象**：「明天我要去打球」→ 只问了「大概占多久」，然后直接排出 **09:00–10:00** 与 **18:20–19:20** 两个落点。CY：「所有的排程你都没问具体时间…可以是空闲时间」。

**依据**：
- `src/features/week/TimeAskDialog.tsx` 是**做好的组件**，但**全仓只有一个调用点**：`src/features/week/WeekPlanView.tsx:2163`（周计划页手动补块）——**对话链路零接入**；
- `src/features/libao/weekPlanForChat.ts:340-365` 的 `goalToTasks` 注释明写「刻意**不给** `startMin`：给了就成了 hard 锁定的固定块，引擎再也动不了它」。**这个设计本意是对的**，缺的是「先问过用户偏好」这一步。

- [ ] **R2.1 对话内时段问句**：把「什么时候」做成**一级追问**，选项 = 语义化时段 + **「空闲时间，你来安排」**；
      → 选中「空闲时间」时**保持现状**（不给 `startMin`，引擎自由落位）——把「自由」变成**用户显式授权**的结果，而不是默认猜测；
- [ ] **R2.2 时段粒度**：`早上 / 上午 / 中午 / 下午 / 晚上 / 自定义`（自定义展开 `TimeWheelPicker`）。口径**必须与** `src/features/libao/libaoIntent.ts:315-322` 的 `PERIOD_WORDS` 统一，禁止出现第二套时间词表；
- [ ] **R2.3 `AddTaskPanel` 时间字段一级化**：现状 `src/features/week/AddTaskPanel.tsx:92-100` 是「选了具体日期才渲染时间轮盘」——改为**两个并列单选**：「**我来定时间**」（立即展开轮盘）/「**让引擎找空档**」；
- [ ] **R2.4 草稿卡字段来源标注**：每个字段旁标 `你说` / `引擎推断` / `库建议`。**背景**：草稿上的「只在：晚上」CY 从没说过，是时段窗被静默赋值的（`libaoIntent.ts:95`）——凡是用户没说过的字段都必须标来源；
- [ ] **验收**：`test:engine` 新增用例——给「打球」必须产出 when 追问，且选项含「空闲时间」档；`test:ui` 新增 AddTaskPanel 两单选断言。

#### P0-3 · R3 选项与依据对齐

**现象**：选「45 分钟」→ 次行写「60 分钟 ≈ 半场 3v3 / 操场 8-10 圈」；选「90 分钟」→ 写「每周中高强度累计 ≥150 分钟」（这是**周总量**，跟「单次多久」无关）。

**依据**：`src/features/libao/weekPlanForChat.ts:845`：
```ts
hint: i === 1 && evidence ? evidence : catTips[i % catTips.length],   // ← 按数组索引轮换
```
`catTips` 是 `taxonomy.ts` 里该**类别**的通用提示数组（如 sport-strength 的 `['力量日健康建议每周 ≥2 天（A级）', '每次 6-8 个动作 × 2-3 组', '同一肌群隔 48 小时再练']`）。按 `i % length` 轮换 → **第 i 个档位配到第 i 条类别提示**，两者无语义关系。

- [ ] **R3.1** tips 从「类别数组」改为「**档位 → 说明**」映射：45 →「≈ 半场 3v3 的一半 / 操场 4-5 圈」；60 / 90 / 120 各给该档语义；
- [ ] **R3.2** 依据行（`evidenceLine`）只出现在**推荐档**（现状 `i===1` 保留），其余档禁止复用类别 tip；
- [ ] **R3.3** 数据源改造：`src/features/libao/taxonomy.ts` 的 `tips: string[]` → `tipsByDuration?: Record<number, string>`（缺失档回退为「该类别推荐档」一句话，**不轮换**）；
- [ ] **验收**：`test:engine`——`quickOptionsFor('effort', {title:'健身'})` 的 4 个档位 hint **互不相同**，且单次档不含「每周 / 总量」字样。

#### P0-4 · R6 意图识别补词 + 未识别显式化

**现象**：「跟梨宝说一句：周六晚上要出去吃自助餐」→ 梨宝没看懂。

**依据**：`src/features/libao/libaoIntent.ts:209-229` 的 `GOAL_NOUNS` 有「大餐 / 聚餐 / 庆功 / 生日」，**没有「自助餐」**；该句也无动作动词、无第一人称 → `looksLikeAction`（`:453-469`）判否 → `parseGoalIntent` 返回 `action:false` → **静默转 RAG**（`src/features/libao/LbaoChat.tsx:1927`）。
另：真正的「没看懂」文案在 `src/features/feedback/CorrectionCapture.tsx:220-240`，**不在对话解析层**——放错了层。

- [ ] **R6.1** 补 `GOAL_NOUNS`：自助餐、火锅、烧烤、聚会、生日会、看电影、逛街、KTV、演出、观赛…；
- [ ] **R6.2** 补一条**动宾模式**：`吃 / 去 / 参加 / 看 + 名词` → 视为生活事件（不再依赖名词表穷举）；
- [ ] **R6.3** **未识别必须显式**：`action:false` 且置信低时不再静默 RAG，而是回「这句我没排进日程，你要 ① 加进日程 ② 只是问事」——把 `CorrectionCapture` 的兜底**前移到对话层**；
- [ ] **R6.4** 词表**单一来源**：把 `GOAL_NOUNS` 抽到共享常量，供 feedback 层复用（防两处漂移）；
- [ ] **验收**：E2E 三句生活事件必须进「改日程」链路；未识别句必须出现二选一按钮。

---

### Wave 2 · P1：语义与信任

#### P1-1 · R5 长期 vs 单次（习惯不是一天两天）

**现象**：「这学期想养成健身的习惯」→ 答「45分钟」→ 草稿：**时间：今天 / 只在：晚上 / 排到 第5周 周五 18:00–18:45 + 18:50–19:35**。CY：「养成习惯这个怎么能是一天两天的事情？」

**依据**：
- `isSingleDayEvent`（`src/features/libao/libaoIntent.ts:1236`）按 slots 有没有 day/clock 判定——「这学期想养成…」**无具体日期 + 含长期词**，却被归到单日 → 走 45/60/90 单次档；
- **同一句式两次分叉**：走查图 7「想养成晨跑的习惯」走了 `when` 分支（问「什么时候开始」），图 8「想养成健身的习惯」走了 `effort` 单日分支 → slots 填充不稳定；
- 长期诉求落盘后是「**一次性两块**」，不是「每周重复」。

- [ ] **R5.1 长期优先**：`detectScope`（`src/features/feedback/parseCorrection.ts:42`）的 `LONG_WORDS` 与「想养成 / 想坚持 / 这学期 / 保持」打通；`scope === 'long'` 时 `isSingleDayEvent` **必须返回 false**；
- [ ] **R5.3 频率→时长→时段串联**：长期诉求的追问顺序 = 先问「多久一次」（周频率）→ 再问「每次多久」→ 最后问「偏好时段」（接 R2）；
- [ ] **R5.4 学期跨度**：用 `schedule.termStart / totalWeeks` 生成跨度，草稿卡显示「**覆盖到第 N 周**」；
- [ ] **R5.2 重复块（recurring slot）** —— 【**需 CY 裁决，见下方**】：
      > **裁决点**：长期习惯要落盘成「每周重复」的块，这是**新的数据结构**，会波及引擎重排、`src/features/plan/planLock.ts`、`src/features/week/userPlanStore.ts` 的序列化与旧数据兼容。
      > **zcode 在此必须停下**：先写 `BLOCKERS.md` 陈述 ①兼容层设计（旧数据读成一次性、新写入带 recurring 标记）②受影响的文件与测试清单 ③两条实现路线（A: 块级 recurring 标记 / B: 独立 recurring 表 + 展开）的取舍，**等 CY 拍板再动**。
      > R5.1 / R5.3 / R5.4 **不依赖此项，可先做**。
- [ ] **验收**：E2E「这学期想养成晨跑的习惯」→ 追问顺序 = 频率 → 时长 → 时段；落盘块覆盖周数 > 1。

#### P1-2 · R1 账号与入口可见性

**现象**：「右上没有账号菜单」＋「没有账号和导入课表」。

**依据（两条，都不是「没做」）**：
1. `src/features/auth/AccountMenu.tsx` **已存在且已挂载**于 `src/App.tsx:380-389`，条件 `auth.status === 'logged-in'`。本机 serve.py 未启 → `fetchMe()` 返回 `offline`，设计为「跳过登录照常运行」（`App.tsx:95`）→ 菜单不渲染；
2. 导入课表入口**在** `navTabs`（`App.tsx:352`），但顶栏 `<header>` 只在 `view==='main'` 渲染（`App.tsx:356`）；引导态 `welcome / basicinfo / persona / result` 在 `290-344` 行**提前 return**，压根没有顶栏 → 落在引导页时两个入口都「看不见」。

- [ ] **R1.1 offline 态保留账号位置**：渲染「未连接账号服务」占位入口，点击展开说明 + 「重试连接」（重新 `fetchMe()`）。**这类"功能做了但用户以为没做"必须消除**；
- [ ] **R1.2 引导页加轻量顶栏**（Logo + 账号位）；至少在 Welcome 页给一行「已有账号？去登录」；
- [ ] **R1.3 offline 语义写进界面**：离线 = 单机模式，数据仅存本机、记忆不与账号同步；
- [ ] **验收**：serve.py 未启动 → 顶栏出现账号入口且点击有解释；`test:ui` 新增 2 条。

#### P1-3 · R7 梨宝记忆

**现象**：「梨宝的记忆」面板：待你确认（0）· 已生效（0）。

**依据（两条）**：
1. **台账分裂（真隐患）**：`src/lib/identity.ts:101-116`——未登录用**随机设备 id**，登录后用**账号名**。若「先离线用、后登录」（或反之），读写指向两个不同台账 → 记忆**凭空消失**；
2. **写入时机**：只有「对话里说了自我信息」（`server/app.py:895 → server/memory.py:410`）或「导入课表回写」（`server/app.py:1177`）才写；纯排程不写。0/0 在这层**正常**，但界面**不解释为什么是 0**，看起来像坏了。

- [ ] **R7.2 空态解释**（**先做，零风险**）：MemoryPanel 空态写清「还没有记忆——你在对话里说过的**年级 / 学院 / 专业**、导入的**课表**会出现在这里」；
- [ ] **R7.3 长期偏好入记忆**：排程产出的长期偏好（如「每周三打球」）也可入记忆（preference 类，自动生效、可撤销）；
- [ ] **R7.1 user_id 归一** —— 【**需 CY 裁决**】：
      > **裁决点**：「登录后以账号为唯一台账」时，设备台账是**迁移合并**还是**弃置**？两者对隐私与实现复杂度影响不同。
      > **zcode 在此必须停下**写 `BLOCKERS.md`，给出两个方案的影响面（迁移：需一次合并确认 UI + 冲突策略；弃置：实现简单但用户感知为"登录后记忆清零"），等 CY 拍板。
- [ ] **验收**：`test:ui` 空态文案存在；登录切换后 facts 不丢（裁决后补迁移用例）。

---

### Wave 3 · P2：新增能力 —— 日程评估引擎（Plan Review）

**目标**：每固定一版日程，一键让梨宝**按权威库**从健康（饮食 / 运动 / 睡眠）与成长（学习 / 习惯 / 目标）两个维度给出评价与**可执行**建议。

**触发点**：①对话侧 `confirmGoal` 落盘后（`src/features/libao/LbaoChat.tsx:734-755`）出现按钮「让梨宝评估这一版」；②周计划侧 `WeekPlanView` 顶部常驻「评估本周」。一次评估 = 对**当前层全量方案**（引擎块 + 用户块）打分 + 建议。

**现状（重要）**：后端**没有**任何 `evaluate(plan)` 类代码；三库检索（`scripts/rag.py:321` / `scripts/method_rag.py:370` / `scripts/health_rag.py:302,158`）只被注入 `/api/chat`（`server/app.py:287,329`）。**但前端已有编译期 KB 参数**（`src/lib/planner/kbParams.ts:101` + `src/data/*Params.generated.ts` + `src/features/libao/taxonomy.ts:104-123 evidenceLine`）→ **H1 可零后端起步**。

- [ ] **H1 最小闭环（先做，可独立交付）**：
  - 新增 `src/lib/planner/planDigest.ts`：输入 `TimeBlock[]`，逐块用 `classifyGoal` 打**维度标签**，聚合出指标——
    | 指标 | 算法 | 对标口径 |
    |---|---|---|
    | `aerobicMin` | Σ `sport-aerobic` 块时长（同天多块去重） | 健康库 A 级：每周中高强度 ≥150 分钟 |
    | `strengthDays` | `sport-strength` 覆盖的不同天数 | 健康库 A 级：力量训练 ≥2 天/周 |
    | `bedWindow` | 由块空隙 + basicinfo 作息反推就寝窗 | 作息一致性 |
    | `mealRhythm` | 「早餐/午餐/晚餐/饭后消食」类块的时间间隔 | 三餐规律性 |
    | `deepWorkBlocks` | 单块 > 90 分钟的学习块数 | 方法库：单次深度工作 ≤90 分钟 |
    | `habitCoverage` | 长期 slot 覆盖周数 ÷ 学期总周数 | 习惯养成（接 R5） |
    | `goalProgress` | 与 `GoalsPage` 目标里程碑比对 | 成长：目标推进 |
  - 前端本地评估（复用 `kbParams`，**0 后端**）→ 先能出「运动量够不够」一条；
  - **硬要求**：每个分数必须能**点开看"是哪几个块加出来的"**（不可解释的分数会立刻失去信任）。
- [ ] **H2 后端 `/api/plan/review`**：新增 `server/plan_review.py`；入参 `plan_digest + user_id + week_no`；对每维度调对应库阈值/建议，产出 `findings`（问题）+ `advice`（可执行建议，带 `actions`，如「把周三 18:00 的有氧挪到 07:00」）；出参结构化 `ReviewReport`，**每条建议带 source（库名 + tier）**；
- [ ] **H3 饮食 / 睡眠维度**（需作息数据）；
- [ ] **H4 成长维度**（习惯覆盖 / 目标进度，接 GoalsPage）；
- [ ] **呈现**：卡片式，健康（饮食/运动/睡眠）+ 成长 + 负荷各一行评分，展开看 findings / advice；每条建议带「采纳」按钮 → **复用 `confirmGoal` 草稿流**；底部标注「本评估依据：健康库 A 级 / 方法库 / 你的画像」；
- [ ] **边界（红线）**：**只给建议，不自动改日程**；用户点「采纳」才走既有草稿 → 确认链路（L4 边界不变）；
- [ ] **验收**：`test:engine` 对 `planDigest` 的聚合数字逐一断言；后端 pytest（库缺失 / 空 plan 的降级路径）；E2E 点「评估」出报告且建议可采纳。

### 暂缓 / 不做（本批明确排除）

- **不引入后端「日程版本快照表」**——现阶段 localStorage / KV（`server/auth_api.py:290-337`）足够；
- **不自动改日程**（只建议 + 采纳）；
- **不用 LLM 编排程结论**（落点仍由引擎干跑决定）；
- **不动 `_integration_full` 之外的三棵树**（`_work_dev` / `_beta2` / `_beta-wt` 只读对照，不合并）。

---

## 四、红线（不可越）

1. **golden 红 = 停**：写 `BLOCKERS.md` 报 CY，**严禁重拍快照掩盖漂移**（本批 R2/R5 会碰引擎，golden 是总裁定）；
2. **只推 `origin/integration-full`**；`dev` / `main` / `beta-v2` 零接触，不 merge 任何 PR；
3. **每 WP 单独提交**：中文 message 写明依据（任务书条目号，如 `R4.1`）；台账 `docs/wp-ledger-v2.md` 随做随记；
4. **金标只增不改**；**变异体反向验证**：引擎 / 解析类改动每项 ≥1（删实现 → 恰红 → 还原 sha256 一致）；
5. **类名锁 / 形状锁**（`tests/wp7.test.ts`、`tests/d-batch.test.ts`）动前看锁、动后申报；
6. **`types.ts` 禁 `any`**；`_` 开头 = 临时产物不入库；`.env`、大文件不入库；
7. **两处【需 CY 裁决】必须停下**（R5.2 recurring 数据结构、R7.1 user_id 台账）——**不擅自裁决**。

## 五、环境备注

- **代理**：`HTTPS_PROXY=http://127.0.0.1:7890`、`HTTP_PROXY=同`（git / gh / npm 都要）；`gh` 只认环境变量，另需 `APPDATA="C:/Users/CY/AppData/Roaming"`；
- **仓库**：`c1632195650-arch/usst-lightpath-planner`（`origin`），当前 `integration-full @ 02ae028`；
- **提交入口**：首选 `python _gh_api_push.py --repo c1632195650-arch/usst-lightpath-planner --base-sha <父提交> --branch integration-full --message-file msg.txt --files <路径...>`（绕开 git 协议，沙箱里最稳；脚本在 `D:/WORKBUDDY DATA/学术部/_gh_api_push.py`）；若 `git push` 可用则 `export GIT_TERMINAL_PROMPT=0` 后直推；
- **本文档入库**：可随第一个 WP 一并提交为 `docs/r-batch-taskbook-2026-10-02.md`（仓内留痕）；
- **工作树**：`D:/WORKBUDDY DATA/学术部/_integration_full`。**CY 本机已有活服务**（前端 5174、后端 8001 / 8002），**直接复用、勿杀**；**8000 端口不碰**（是另一个独立仓库的课表解析服务，现为 502）；
- **测试环境口径**：前端必须用 `http://localhost:5174`（后端 CORS 白名单只放行 5173 / 5174，其他端口会**静默失败**、梨宝退化成规则层）；
- **运行时**：node `C:\Users\CY\.workbuddy\binaries\node\versions\24.14.0\node.exe`；python `C:\Users\CY\.workbuddy\binaries\python\envs\default\Scripts\python.exe`；
- **可复用探针**：`_/shots_1002.mjs`（真机全流程截图）、`_/shots_now.mjs`（首启页 → 主应用）、`_/probe_brand_live.mjs`（梨宝问答端到端）、`_/shot_html.mjs`（HTML 整页截图 + 溢出检测）、`_/check_fusion_gaps.py`（多树融合缺口静态扫描）；
- **注意**：`_/xxx.mjs` 在 Git Bash 会被 MSYS 咬路径，运行用 `MSYS_NO_PATHCONV=1 node "./_/xxx.mjs"`；
- **背景文档**：`outputs/改进技术路线-2026-10-02.html`（本文来源）、`docs/wp-ledger-v2.md`（台账）、`docs/week-view-design.md`。

---

_本任务书为 R 批唯一施工依据。执行中发现的、任务书未覆盖的决策点，一律写 `BLOCKERS.md` 停下，不猜。_
