# 上理生活助手 · 「真实页面优化」任务书 v2（交 zcode 独立执行）

> 委托人：CY。制定：MOSS（2026-10-07 00:4x，基于**当日真实浏览器实测** + 逐行代码定位）。
> 前序任务书：`outputs/真实页面修批任务书-交zcode-2026-10-06.md`（其 Wave1/2/3 与 P1-3/P1-4 **全部继承**，本版不重复论证、只标「继承」，条目号保留）。
> 本版新增：CY 2026-10-07 00:29 的 8 条反馈（3 张截图）+ 「功能总原则」一条。
> 工作树：`D:/WORKBUDDY DATA/学术部/_work_dev`，分支 `beta-v2`。
> 门禁基线（10-06 末实测）：`tsc` 0 错 / engine 709 pass / ui 432 pass / E2E 见 §三。
> **本任务书自包含。遇未覆盖决策点 → 写 `BLOCKERS.md` 停下等 CY，不擅自裁决。**

---

## 一、本轮 8 条反馈 → 逐条归因（先对齐「问题」，再谈「方案」）

| # | CY 原话（10-07 00:29） | 端 | 根因（代码级，已定位） |
|---|---|---|---|
| ① | 「梨宝还是有问题啊，之前不是修了好一会吗」（排程模式下说「我明天打算去吃大餐」→ 回了一大段口语闲聊、被裁掉，**没出排程草稿**） | 共有 | 输入先过 `LbaoChat.tsx:1858` `parseGoalIntent`，只有 `outcome.action && (title‖hold‖add_deadline‖replanDays)` 才进排程；否则掉 `:1882` 泛泛分支 → 再掉校园问答 `/api/chat`（RAG）→ 长闲聊。判不出的诱因：规则层 `libaoIntent.ts:290 LEGACY_RECOMMEND = /(安排\|规划\|计划一下\|怎么过\|排一下\|帮我排\|给我排)/` **不含「打算/想去/准备/准备去」这类自然陈述**；且 `TITLE_STOP`（`libaoIntent.ts:~330`）把 `打算` 列为停用词。**且聊天侧对回复长度零约束**（`LbaoChat.tsx` 无任何截断/结构化）。 |
| ② | 「现实里面大家正常都是用前一种讲话方式的好吗…谁没事一直讲帮我排一下啥啥的」 | 共有 | UI **在教**命令式话术：`LbaoChat.tsx:151` QUICK=`['四六级什么时候报名','帮我安排这周', …]`；`:207` 开场白「也可以说『帮我安排这周』」；`:2296` placeholder「问梨宝，或说『帮我安排这周』…」。话术与识别口径都要「去命令化」。 |
| ③ | 「添加的待办没有在日程安排中体现出来」 | 共有 | 待办→排程**已接线但不可见**：`WeekPlanView.tsx:1374-1428` 只在**生成/重算周计划**时才把未完成待办（`memoLogic.todosToPendingTodos`）喂进引擎（recent→📌activity 块、longterm→可拆 study Commit）；`scheduledBlockId` 回填（`webMemo.ts:149-165`）**只在排程后**发生。⇒ 新增待办不触发重算、不提示「下一步」、无任何「已排进/未排」回显 → 用户看不到闭环。 |
| ④ | 「账号位置之前不一直在左上角吗？」 | 共有 | `_work_dev` 的 `CloudAccountCard` 渲染在 **两处**（`App.tsx:179` Welcome footer、`:319` 我的画像页底），**顶栏一个账号位都没有**；而姊妹树 `_integration_full` 的顶栏本来就有 `AccountMenu`（`_integration_full/src/features/auth/AccountMenu.tsx`，其注释直指「CY 走查：右上没有账号菜单」）⇒ 合流/换肤时把顶栏账号入口丢了。 |
| ⑤ | 「功能的一切原则…两个窗口或按钮内容一模一样就保留合适位置的那个…不要让页面臃肿…在使用场景逻辑顺畅的位置」 | 共有 | 一条**跨端去重/收敛总原则**，落成 S4 checklist：课表/周计划子标签（继承 W3）、账号卡（S1）、周视图双入口（M3）、通知/评估的重复入口等。 |
| ⑥ | 「手机端…最严重的是压根没有待办目标的设置区域！！！」 | 手机端 | 设置区**存在**（`GoalTodoCard.tsx`：随手记一条 + 记最近/记长期 + 里程碑）但被埋掉：① 挂在 `TodayPage.tsx:120` 的 `d.phase==='ready'` 分支内；② **首屏 4 秒自动淡出**（`GoalTodoCard.tsx:99-104`，无 attention → `setVisible(false)`）；③ 淡出后**没有常驻再唤出入口**（`visible` 不持久）。⇒ 感知 = 「压根没有」。 |
| ⑦ | 「手机端待办同步有问题」 | 手机端 | `useTodayData.ts:288-314` 的 memoHandlers **在 `setState` updater 里做副作用**（`saveMemo`）—— 反模式（React StrictMode 双调用 → 重复生成 id / 重复写）；上行靠 `:276-285` 的 1s debounce；且 `syncToCloud` 在 **`!accepted`（LWW 被拒）时只采纳 `userOverrides`，不采纳云端 `todos/goals`**（`:160-167`）→ 云端更新在手机端被拒后**不回落**，只给一个笼统「同步失败」。 |
| ⑧ | 「手机端只能看到今天的排程，要求能看到一星期…箭头…回到现在」「看不到通知效果以及执行状态完成后的趋势和方法建议…要样例但必须走真实生成渠道」 | 手机端 | a) `WeekGlance.tsx` 是**只读计数**（`本周剩余（只读）`，只列 todayDow→7，只给「N 件」），无切周/无展开/无回到今天；b) 通知在 **Web 环环境恒 no-op**（`notifyBridge.ts::isNative()` 恒 false；`NotifyStatus.tsx` 只诚实显示「浏览器环境：用页内横幅提醒」）→ 手机**网页版永远看不到真通知**；c) `EvalPanel.tsx:102-104` 冷启动只有一句空态文案，**无真实样例**。 |

> **已经交付的真实样例（本轮随任务书一起给出，满足 ⑧ 的「真实生成渠道」要求）**：
> `outputs/手机端真实样例-通知与执行状态-2026-10-07.html` + 生成脚本 `_work_dev/_moss_mobile_sample.mjs`。
> 该页**没有一个手写结果**：五维数值/趋势/「本周最该改的一件事」由**上线代码** `computeExecutionProfile` / `dailySeries` / `tipForSlug` 算出，通知清单由**上线代码** `planTodayNotifications` 算出，输入是一份**标注过的样例数据集**（脚本内 `DEMO*` 常量）。
> 本次实跑输出（供对照）：完成率 71%｜拖延 平均晚 1 天｜连续 8 天｜时间纪律 平均晚开始 10 分钟｜自评 54 分｜focus = 拖延是情绪调节问题，不是时间管理问题。

---

## 二、任务拆分总览（共有 / 网页端 / 手机端）

> 规则：**两端都会改到的 → 共有**；只动 `src/App.tsx` + `src/features/{memo,persona,week,libao,cloudSync}/` → 网页端；只动 `src/features/mobile/**` + `mobile/**` → 手机端。
> **依赖顺序**：S1/S2/S3 先做（跨端契约）→ W 批 → M 批（M 批消费 S2/S3 的产物）。**W3 会删 `WeekView.tsx`，M 批不得引用它。**

### 共有（Shared）
| WP | 标题 | 对应反馈 | 预估 |
|---|---|---|---|
| **S1** | 账号/身份入口唯一化 + 回到顶栏 | ④⑤ | 中 |
| **S2** | 梨宝：自然语句 → 排程意图（识别升级 + 去命令化话术 + 回复长度纪律） | ①② | **大** |
| **S3** | 待办 → 日程的**可见闭环**（回显 + 触发 + 跨端一致） | ③ | 中 |
| **S4** | 跨端去重/收敛总原则落地（checklist + 3 处具体收敛） | ⑤ | 小 |

### 网页端（Web）
| WP | 标题 | 对应反馈 | 备注 |
|---|---|---|---|
| **W1** | 待办/目标输入闭环：回车即提交 + 云端失败不静默 | 继承 10-06 ① | **继承**（原 P0-1 / P0-2，步骤照旧） |
| **W2** | 画像结果页文案重写 | 继承 10-06 ② | **继承**（原 Wave2，定稿表照抄） |
| **W3** | 课表/日程收敛 + 总览单日定位 | 继承 10-06 ③ | **继承**（原 Wave3） |
| **W4** | API 基址统一（`resolveApiBase()`） | 继承 10-06 P1-3 | **继承**（P1-3b 仍需 CY 裁决） |
| **W5** | 梨宝聊天页的**呈现面**（长回复折叠 + 引导话术 + 模式切换文案） | ①② | 与 S2 分工：S2 管「听懂」，W5 管「怎么说/怎么显示」 |
| **W6** | 【需 CY 裁决】「选择想安排的日期」死开关 | 继承 10-06 P1-4 | **继承**，只上报不改引擎 |

### 手机端（Mobile）
| WP | 标题 | 对应反馈 | 备注 |
|---|---|---|---|
| **M1** | 待办/目标**常驻设置区**（不再靠 4 秒浮现） | ⑥ | 依赖 S3 的回显口径 |
| **M2** | 待办同步修复 + 条目级同步态 | ⑦ | 依赖 M1 的 UI 出口 |
| **M3** | 本周视图：周切换箭头 + 「回到现在」 + 点天展开 | ⑧a | 依赖 S4 去重（与 `WeekGlance` 二选一） |
| **M4** | 真实渠道样例**内建**（通知 + 执行状态）——把本轮样例做成 dev 开关 | ⑧bc | 本轮已给静态样例；M4 = 让它在页面里随时可看 |
| **M5** | 通知可见性的诚实口径（Web / APK 两条路说清楚） | ⑧b | 与 M4 同批 |

---

## 三、验收标准（DoD，全绿才算完成）

| 门 | 基线（10-06 末实测） | 完成后要求 |
|---|---|---|
| `tsc --noEmit` | 0 错 | 0 错 |
| engine 套件（`tests/**/*.test.ts`） | 709 pass / 0 fail | ≥ 709 / 0（S2 应新增意图用例；M2 应新增同步用例） |
| ui 套件（`scripts/**/*.test.ts`） | 432 pass / 0 fail | ≥ 432 / 0 |
| E2E 全量（`playwright test`，离线打桩） | 见 §九 | ≥ 基线 + 本批新增 / 0 fail |
| 反向验证（变异体） | — | ≥ 2 条（① 删「回车提交」→ E2E 恰红；② 删 S3 的待办回显 → 对应用例恰红），还原后 sha256 一致 |

**本批必增的语义断言**（写进对应 spec，沿用既有夹具）：
1. `e2e/memo-smoke.spec.ts`：**回车提交待办 / 目标**（继承 10-06 §二 的第 1、2 条）+ **云端 500 不静默**（第 3 条）。
2. `e2e/week-*`：**总览点周三 → 进日程页 → 该天带 `focus-day-you-clicked`**（继承 W3）。
3. **S2**：`scripts/libao-intent-natural.test.ts`（新）—— 断言 `detectIntent/parseIntentSlots('我明天打算去吃大餐')` 产出 `intent==='create'` 且 `title` 含「吃大餐」；再断言 `'周末想去看电影'`、`'打算去健身房'` 同族命中；并且**旧口径一条不丢**（`帮我安排这周` 等仍命中）。
4. **S3**：`scripts/memo-web-workspace.test.ts` 追加 —— 待办 → `todosToPendingTodos` → 计划块 → `blockIdForTodo` → `scheduledLabel` 的**端到端纯函数闭环**，回显文案含「已排进周X」。
5. **M2**：`tests/mobile/memoStore.test.ts` 追加 —— `!accepted` 时 `adoptCloudMemo` 必须把云端 `todos/goals` 合并进本地（不得只采纳 `userOverrides`）。

**交付物**：① 每个 WP 单独一次提交，中文 message 带条目号（`S1` / `S2` / `W5` / `M3`…）；② 台账落 `BLOCKERS.md`（凡「需 CY 裁决」项）；③ 验收证据（上述命令实跑输出）；④ **只推 `origin/beta-v2`**。

---

## 四、共有（Shared）

### S1 · 账号/身份入口唯一化 + 回到顶栏（CY 反馈 ④⑤）

**现象**：账号卡在「我的画像」页最底部，且 Welcome 页又有一个 —— 两处内容一模一样；顶栏没有账号位。CY 记得「（账号）之前不一直在左上角吗」。

**依据**：
- `App.tsx:18` import `CloudAccountCard`；渲染两处：`:179`（`Welcome` 的 `footer`）、`:318-320`（`profile` tab 底部）。
- 姊妹树已验证的位置：`_integration_full/src/App.tsx:377-414` —— 顶栏在 `Logo + 标题 + nav` 之后挂 `AccountOfflineMenu` / `AccountMenu`；组件 `_integration_full/src/features/auth/AccountMenu.tsx`（「当前用户名 + 退出登录 + 注销账号」）。

- [ ] **S1a** 在 `_work_dev` 顶栏加入**唯一账号入口**：位置 = **`Logo` 右侧、标题下方一行**（即「左上角」区域，按 CY 原话；**不放 nav 右侧**以免与主导航争位）。形态：
  - 未登录：`data-testid="header-account-login"` 的小 chip「连接手机端」→ 点击展开 CloudAccountCard（popover/抽屉）；
  - 已登录：`data-testid="header-account-chip"` 的小 chip「✓ {username}」→ 点击展开菜单（CloudAccountCard 的已登录分支：同步开关 + 退出登录）。
  - 桌面 `sm:` 以上显示；窄屏（`<sm`）折叠进「…」或保持在标题行下方（不新增一行高度，避免臃肿）。
- [ ] **S1b** **删除** `App.tsx:318-320`（`profile` tab 底部那份 `CloudAccountCard`）—— 画像页只留「重看引导」按钮。**保留** `:179` Welcome footer 那份（onboarding 场景没有顶栏，且 CY 明确要求引导阶段可登录）。
- [ ] **S1c** `CloudAccountCard` 改造成「可复用 + 可收进 popover」：抽出**内容**（现状组件保留为默认导出，内部包一层 `details`/popover 容器），**不改文案与 `data-testid`**（`cloud-*` 相关锚点一个都不动，避免打断既有 E2E）。
- [ ] **S1d** ⚠️ **需 CY 确认（写进 `BLOCKERS.md`）**：账号 chip 的默认位置按 CY 原话取「左上（Logo 右侧）」。若 CY 改为「右上」，只需移动 S1a 那一个 DOM 节点 —— **在提交信息里注明「单点可移」**。
- [ ] **验收**：全站 `CloudAccountCard` 出现次数 = 2（Welcome footer + 顶栏 popover 内部），`profile` tab 内为 **0**；顶栏在未登录 / 已登录两态都能看到 chip；E2E 里 `gotoWebWithIdentity` 夹具不受影响。

### S2 · 梨宝：自然语句 → 排程意图（CY 反馈 ①②）【本批最大项】

**现象**：排程模式下说「我明天打算去吃大餐」→ 梨宝回一大段口语闲聊（不是草稿），直到补一句「2小时」才出草稿。

**依据（链条上的三个断点）**：
1. **规则层不认自然陈述**：`libaoIntent.ts:290` `LEGACY_RECOMMEND = /(安排|规划|计划一下|怎么过|排一下|帮我排|给我排)/`；`INTENT_PATTERNS`（`:305-315`）只覆盖 hold/cancel/reschedule/replace/query/add_deadline —— **没有**「打算/想去/准备/要去/约」这一族。
2. **标题抽取易碎**：`TITLE_STOP`（`libaoIntent.ts` 约 `:330`）含 `打算`、`主意`、`想法` 等，抽标题时会把这些词当停用词 break；`我明天打算去吃大餐` 里「打算」在前，可能导致 `title` 抽空 → `LbaoChat.tsx:1858` 的门 `(slots.title || …)` 判假 → 掉进泛泛分支。
3. **后端裁决没兜住**：`server/plan_dialog.py:108-160`（scene=dialog 的 act 骨架）对「与议题有关的含糊回答」要求走 `ask_slot`，但**新开的自然陈述**（无 topic）应走 `new_intent`；若给了 `chit_chat` 就会掉到校园问答 → 长闲聊。且 dialog 场景的 prompt 未把「口语化计划陈述」列为 `new_intent` 的证据。

- [ ] **S2a** 规则层扩族（`libaoIntent.ts`）：
  - 新增 `NATURAL_PLAN_RE = /(打算|准备|计划|想去|要去|约了|想去看|想去吃|想吃|想喝|要去吃|要去玩)/` 作为**动作识别**的补充证据（与既有 `LEGACY_RECOMMEND` 并列，**不改它的口径** —— 纪律④要求「新入口必须是老行为超集」）。
  - 在 `detectIntent`（`:473-483`）里：当「有自然计划词 + 有时间/地点/事由线索」时返回 `'create'`；**不带时间词的**（如「我最近想去健身」）也要返回 `'create'` 但 `when.kind='vague'`，由既有槽位追问补齐（复用现有 collect 相）。
  - `TITLE_STOP` 里对**动词性**的 `打算/准备/计划` 做**位置敏感的豁免**：仅当它出现在句首且其后紧跟「去/要」时不停（`我打算去吃大餐` → 标题「吃大餐」）；`打算` 作为名词（「我的打算」）仍停。**该规则必须有单测**。
- [ ] **S2b** 后端 `server/plan_dialog.py`：dialog 场景 prompt 增补一条证据规则 —— 「用户以第一人称陈述一个**带时间或事由**的个人安排（即使没有『安排/排』这类动词）→ `new_intent`，`intent=create`」；并把「无 topic 时的自然陈述」从 `chit_chat` 明确排除。**同步补 `server/plan_dialog.py` 的一处离线用例**（沿用 `scripts/eval_plan_understand.py` 风格）。
- [ ] **S2c** **保底**（不依赖 LLM）：`LbaoChat.tsx` 在 `parseGoalIntent` 返回 `action===null` 时，若命中 `NATURAL_PLAN_RE`，**不要**直接掉校园问答，而是回一条**同一种「切换/澄清」卡片**：「听出来你像是要安排一件事 —— 我来排：{抽到的标题}，什么时间？」并**直接进 collect 相追问时间**（而不是让用户回答「帮我排一下」）。这样即使 LLM 挂了，自然语句也不会变成闲聊。
- [ ] **S2d** 验收：`scripts/libao-intent-natural.test.ts` 全绿（见 §三·3）；手工：排程模式下输入「我明天打算去吃大餐」→ **第一条回复就是草稿/追问**，不是闲聊。

### S3 · 待办 → 日程的可见闭环（CY 反馈 ③）

**现象**：「添加的待办没有在日程安排中体现出来」。

**依据（已有链路 + 缺口）**：
- 已有：`WeekPlanView.tsx:1380-1387`（读云端 todos → `todosToPendingTodos`）→ `:1428 pendingTodos` → `schedule.ts:131-165`（recent→`UserTask 📌`，longterm→可拆 `Commit`）；排后回填 `webMemo.ts:149-165` → `memoLogic.scheduledLabel` 给待办卡一枚 chip。
- 缺口：① **新增待办不触发重算**，也不提示；② 待办卡 chip 只在「本页刚排过」时精确（`resolveBlock` 靠内存注册表，`:144-146`），刷新后退回「已排进周X」（可接受，但要**明确**）；③ **完全没排上**的待办**零提示**（用户无从知道为什么）。

- [ ] **S3a** `MemoPanel.tsx`：每条未完成待办右侧**常驻一枚状态 chip**（`data-testid="memo-todo-sched-state"`）：
  - `scheduledLabel(...)` 有值 → 「已排进周X 15:00」；
  - 无值且未登录 → 「登录后可自动排进日程」；
  - 无值且已登录 → 「未排进本周 · [排进本周 →]」（按钮跳到 `mainTab='calendar'`）。
- [ ] **S3b** `MemoPanel` 顶部加一行**诚实的状态条**（`data-testid="memo-plan-link"`）：`本次排程带上了 N 条待办` / `待办还没进本周计划 —— 去「日程」页生成一次`。数据来自 `todosToPendingTodos(data.todos, termStart, weekNo)` 的**条数**（纯函数，可测）。
- [ ] **S3c** 新增待办成功后（`onSubmitEditor` 成功分支）给一条**轻提示**（不弹窗）：「已加入待办 —— 去『日程』页就会带上它」，并把 `memo-plan-link` 的计数刷新。
- [ ] **S3d** E2E：`e2e/memo-smoke.spec.ts` 增 1 条 —— 加待办后 `memo-plan-link` 计数 +1。纯函数闭环走 §三·4 的 ui 用例。
- [ ] **S3e** 手机端消费同一条口径 → 见 **M1c**（手机端只读展示「已排进周X」）。

### S4 · 跨端去重/收敛总原则（CY 反馈 ⑤）

**原则**（原话）：「如果两个窗口或者按钮涉及到的内容一模一样，那么就保留在合适位置的那个；合适位置 = 不让整个页面太臃肿 + 使用场景逻辑顺畅」。

- [ ] **S4a** 落一份 `docs/ui-dedup-checklist.md`（新），逐条列「重复源 → 保留哪个 → 理由」，至少覆盖：
  1. `课表 / 周计划` 子标签 → **留「日程」单窗**（继承 W3）；
  2. `CloudAccountCard` 两处 → **留顶栏一个**（S1）；
  3. 手机端 `WeekGlance`（只读计数）vs **M3 新周视图** → **只留 M3**（删 `WeekGlance` 或降级为 M3 内的一个折叠小节）；
  4. 手机端 `NotifyStatus` 的「重排提醒」按钮 vs `WhitelistGuide` 的权限引导 → **权限引导留 `WhitelistGuide`**，`NotifyStatus` 只留计数与重排；
  5. `WeekView` 的 PACE 段 vs `WeekPlanView` 的「换个节奏」→ **留后者**（继承 W3）；
  6. 网页端 `memo` tab 与 手机端 GoalTodoCard 的「新增待办」→ **各自保留**（不同场景、不同端），但**文案口径统一**（S3a）。
- [ ] **S4b** 每删一处**必须在同一提交里**更新受影响的 `data-testid` / E2E 断言，并注明「单点可还原」。
- [ ] **验收**：`docs/ui-dedup-checklist.md` 存在且 6 条都有「保留理由」；本批删除的重复源在 `grep` 下不再出现。

---

## 五、网页端（Web）

### W1 · 待办/目标输入闭环 —— 【继承 10-06 任务书 P0-1 / P0-2】
照 `outputs/真实页面修批任务书-交zcode-2026-10-06.md` §三 Wave1 原文执行（P0-1a~d / P0-2a~d / §二 新增 E2E 第 1-3 条 / 变异体反向验证）。**本版不重复论证。**

### W2 · 画像结果页文案重写 —— 【继承 10-06 Wave2】
照原书 §三 Wave2 执行：**P2-1a 的 6 行表格是终稿，直接照抄**；`id`/`axes` 一字节不动；BANNED 词表/禁 markdown/禁 emoji 继续生效；`P2-1h` 的 5 处测试锚点同步改。

### W3 · 课表/日程收敛 + 总览单日定位 —— 【继承 10-06 Wave3】
照原书 §三 Wave3 执行（P1-5a~e + `WeekView.tsx` 删除）。**注意**：本版 M 批不得引用 `WeekView`；删除前 `grep -rn "WeekView" src tests scripts e2e` 只允许剩注释。

### W4 · API 基址统一 —— 【继承 10-06 P1-3】
`P1-3a` 可直接做；`P1-3b`（改默认值）**未拍板前不得动**，先写 `BLOCKERS.md`。

### W5 · 梨宝聊天页的呈现面（CY 反馈 ①②）

**分工**：S2 负责「听懂」；W5 负责「怎么说、怎么显示」。

- [ ] **W5a** 引导话术**去命令化**：
  - `LbaoChat.tsx:151` QUICK 改为自然口语句式（示例，可微调但不得出现「帮我排/排一下」）：
    `['我明天打算去吃大餐', '这周六想去看电影', '四六级什么时候报名', '下周要交实验报告']`；
  - `:207` 开场白改为：「我是梨宝，咱上理的校园助手。可以问我四六级、选课、放假这些校园事；也可以直接说「我明天想去打球」—— 你怎么说，我就怎么接。」；
  - `:2296` placeholder 改为：`说一句话就行，比如「我明天想去打球」…`；
  - `:2278` 模式说明保留（`排程模式：说要排的事，梨宝出草稿、你确认才落盘`），但把「说要排的事」改成「说一件想安排的事」。
- [ ] **W5b** **回复长度纪律**（解决「长回复被裁」）：RAG/闲聊回复在渲染层加**软上限**：> 320 字时**默认折叠**（`data-testid="lbao-msg-collapsed"`，露出前 4 行 + 「展开全文」）；排程草稿卡**不折叠**（它是结构化卡片）。
- [ ] **W5c** **口吻纪律**：闲聊首句不得使用「宝子」等强亲密称呼（改为「哎」/直接陈述）；**新增一条 ui 用例**扫描 `LbaoChat.tsx` 源码，禁止 `宝子` 字面量（防回潮）。
- [ ] **W5d** 模式切换提示卡（`:1871` / `:1889`）文案统一为**自然陈述版**：「听着像要排一件事 —— 切到排程模式我就接手」，并把「继续」按钮文案从「切到排程模式并继续」改短为「好，去排」。
- [ ] **验收**：ui 套件 ≥ 435 / 0（新增 W5c 用例）；手工：排程模式输入自然语句 → 首条即草稿/追问（与 S2 同测）。

### W6 · 「选择想安排的日期」死开关 —— 【继承 10-06 P1-4，只上报不改引擎】
照原书 §三 P1-4：zcode **必须**写 `BLOCKERS.md` 给三条路线（A 硬约束 / B 软偏好 / C 诚实文案）取舍，等 CY 拍板；**拍板前禁止任何「假装生效」**。

---

## 六、手机端（Mobile）

> 全部改动集中在 `src/features/mobile/**`（+ `mobile/**` 若涉及原生）。**不得引用 `WeekView` / `App.tsx` 的网页端组件。**

### M1 · 待办/目标**常驻设置区**（CY 反馈 ⑥）

**依据**：`GoalTodoCard.tsx:99-104`（4 秒淡出）、`TodayPage.tsx:118-120`（挂在 ready 分支）、`GoalTodoCard.tsx:135-137`（只有「收起」，没有再打开）。

- [ ] **M1a** 把 `GoalTodoCard` 从「浮现卡」改为**常驻 section**：
  - 默认**展开**；`visible` 状态**持久化**（`localStorage['usst.mobile.goalCardOpen']`），用户点「收起」后保持收起，**但标题行常驻**（`data-testid="m-goal-card"` 始终渲染，标题行可点开）；
  - 保留「逾期/将到期 → 自动展开 + 角标」的行为（`memoNeedsAttention` 不变）。
- [ ] **M1b** 标题行加**显式入口**：`data-testid="m-goal-card-toggle"`（「目标与待办 (N) ▾/▴」）+ 右侧 `data-testid="m-todo-quick-add"` 的「+ 记一条」按钮 —— 点击**直接聚焦输入框**（不依赖展开动画），确保「任何时候都能记」。
- [ ] **M1c** 每条待办右侧加**排程状态回显**（与 S3a 同一口径）：`scheduledBlockId` 存在 → 「已排进周X」（复用 `memoLogic.dayFromBlockId` + `DAY_CN`，**只需 id 即可**，手机端不存整周计划）；不存在 → 不显示（避免噪音）。**抽成纯函数 `todoScheduleHint(todo)` 放 `memoStore.ts` 或 `memoTypes.ts`，加单测。**
- [ ] **M1d** 空态文案改为可操作：「还没有待办 —— 点『+ 记一条』随手记下，网页端排计划时会带上它。」
- [ ] **验收**：`tests/mobile/memoStore.test.ts` 覆盖 `todoScheduleHint`（有 id / 无 id / 坏 id 三态）；手测：打开 App 后 10 秒内仍能看到并操作待办区。

### M2 · 待办同步修复 + 条目级同步态（CY 反馈 ⑦）

**依据**：`useTodayData.ts:288-314`（updater 内做副作用）、`:160-167`（`!accepted` 不合并 todos/goals）、`:276-285`（debounce 上行）。

- [ ] **M2a** **副作用移出 updater**：`memoHandlers` 改为「纯函数算出 next → `setMemo(next)` → `saveMemo(...)`」三步（`onComplete` / `onArchive` / `onAddTodo` / `onToggleMilestone` / `onAddMilestone` 五处全改）。**理由**：React StrictMode 会双调用 updater，现值实现会重复生成 id / 重复写盘。
- [ ] **M2b** `syncToCloud` 的 **`!accepted` 分支补合并**：在采纳 `userOverrides` 之外，加
  `const merged = adoptCloudMemo(memoRef.current, r.state?.todos ?? null, r.state?.goals ?? null); saveMemo(...); setMemo(merged);`
  （需要新增 `memoRef`，与既有 `layerRef`/`displayedRef` 同款）。**理由**：LWW 被拒 = 服务端版本更新，必须把云端 todos/goals 回落，否则手机端本地与服务端永久分叉。
- [ ] **M2c** **条目级同步态**：`GoalTodoCard` 的操作完成后，若 `syncStatus==='error'`，在该条目上闪一条「未同步 · 已存在本机」（`data-testid="m-todo-sync-warn"`），与网页端 W1-P0-2 的 amber 口径一致（**不新增第二套文案体系**）。
- [ ] **M2d** **探针**：新增 `_moss_mobile_sync_probe.mjs`（临时，不入库）—— 用探针账号在 `http://101.35.253.143` 上：手机端 PUT 一条待办 → 网页端 GET 应能读到 → 网页端改 note → 手机端再 PUT（模拟 LWW 被拒）→ 断言本地已合并云端 note。**跑完删脚本，输出贴进提交信息。**
- [ ] **验收**：`tests/syncContract.test.ts` 追加 1 条「LWW 被拒 → 本地合并云端 todos」；`tsc` 0 错。

### M3 · 本周视图：周切换箭头 + 「回到现在」 + 点天展开（CY 反馈 ⑧a）

**依据**：`WeekGlance.tsx`（只读、只列 todayDow→7、无切周）。

- [ ] **M3a** 新建 `src/features/mobile/WeekBoard.tsx`（替换 `WeekGlance`）：
  - 顶部一行：`‹`（`data-testid="m-week-prev"`）+ 「第 N 周 · 10/05–10/11」（`data-testid="m-week-label"`）+ `›`（`data-testid="m-week-next"`）；
  - 右侧一枚「回到现在」（`data-testid="m-week-today"`）：回到当前周并展开今天；**不在当前周时**该按钮**高亮**（表示可回）；
  - 七天列表（`data-testid="m-week-day-${d}"`）：每行「周X · 日期」+ 未完成件数 + **点击展开当日块**（标题 + `HH:MM–HH:MM`），复用 `applyLayerToBlocks`（与今日页同源，只读）；
  - 非当前周需要另一周的 plan → 复用 `planCompute.recomputeWeek`（异步，加载态给骨架）；
  - 「今天」那一行加 `ring` 高亮。
- [ ] **M3b** **去重**（S4-3）：删掉 `WeekGlance.tsx` 与 `TodayPage.tsx:155` 的挂载，改为挂 `WeekBoard`；若 CY 想保留「本周剩余」计数，把它作为 `WeekBoard` 内的一个**折叠小节**（不新增并列卡片）。
- [ ] **M3c** ⚠️ 手机端**只读** —— 不在周视图里做编辑（编辑仍走 `EditSheet`）；切周**不写**云端（只本地浏览态）。
- [ ] **验收**：`tests/mobile/` 新增 `weekBoard.test.ts`（纯逻辑：给定 plan+layer → 7 天计数与展开项；切周偏移计算）；手测：`‹ ›` 切到下周再「回到现在」两次点击内回到今天。

### M4 · 真实渠道样例**内建**（通知 + 执行状态）（CY 反馈 ⑧bc）

**本轮已交付**：`outputs/手机端真实样例-通知与执行状态-2026-10-07.html`（由 `_moss_mobile_sample.mjs` 走**真**函数生成）。M4 = 把这条**真实生成渠道**搬进页面，让它随时可看。

- [ ] **M4a** 新建 `src/features/mobile/eval/demoInput.ts`（**仅 dev 生效**）：导出 **`DEMO_EVAL_INPUT`（输入样例，不是结果样例）** + `DEMO_DAY_BLOCKS`。文件头注释必须写明：「这是**输入**样例；结果由 `computeExecutionProfile` / `planTodayNotifications` 现场算出。**禁止**把结果写死在此文件。」
- [ ] **M4b** `EvalSection` 增加 dev 通道：当 `import.meta.env.DEV && new URLSearchParams(location.search).has('demoEval')`（或 `localStorage['usst.mobile.demoEval']==='1'`）时，用 `DEMO_EVAL_INPUT` 走**原样的** `computeExecutionProfile` / `dailySeries` 交给 `EvalPanel` 渲染。**UI 上必须带一枚「样例数据」角标**（`data-testid="m-eval-demo-badge"`），不得伪装成真实数据。
- [ ] **M4c** 通知样例：在 `NotifyStatus` 下加一个 dev-only 折叠块 `data-testid="m-notify-demo"`，用 `planTodayNotifications(DEMO_DAY_BLOCKS, nowMin, todayKey)` 渲染「如果今天有这些块，会排这几条通知」清单（id/时刻/标题/动作按钮）。**这条路径与 APK 内完全同源**，满足「真实生成渠道」。
- [ ] **M4d** **不提交任何手写结果**：检查项 —— `grep -rn "71%\|54 分\|平均晚 1 天" src/` 必须 **0 命中**（结果只能算出来，不能写死）。
- [ ] **验收**：dev 下带 `?demoEval` 打开 → 面板出现五维数值 + 迷你趋势 + 「本周最该改的一件事」+ 方法建议，且带「样例数据」角标；通知折叠块列出 5 条（与 `_moss_mobile_sample.mjs` 的实跑输出一致）。

### M5 · 通知可见性的诚实口径（CY 反馈 ⑧b）

**依据**：`notifyBridge.ts:isNative()` 在 Web 恒 false → `rescheduleToday` 直接返回 `{ok:true, scheduled:0}`；`NotifyStatus.tsx:79-81` 只显示「浏览器环境：用页内横幅提醒（App 内才有时点通知）」。

- [ ] **M5a** 把「为什么看不到通知」说清楚（三段式，`NotifyStatus` 内）：
  - Web：「当前是**网页版**：浏览器不发本地通知。到点前 10 分钟会在页内顶部弹一条横幅（下面有预览）。要**真·通知**需装 APK。」+ 一个「看看通知长什么样」→ 展开 **M4c** 的样例清单；
  - APK 未授权：「通知没开 → 去系统设置打开，回来点『重排提醒』」；
  - APK 已授权：「已排 N 条 · 下一条 HH:MM」。
- [ ] **M5b** Web 下**页内横幅**要真的存在（现在只有文案）：确认 `TodayPage`/`NotifyStatus` 在「块开始前 10 分钟」真的弹一条页内横幅（若无，则补一个基于 `useNow(30s)` 的纯前端实现 + 单测）。
- [ ] **验收**：`tests/mobile/notify.test.ts` 追加「Web 分支的横幅触发时刻」纯函数用例。

---

## 七、暂缓 / 不做（本批明确排除）

| 项 | 理由 |
|---|---|
| 顶部导航「课表」（`ImportTester`）本身 | CY 已裁决指的不是它；导入是必需能力 |
| 排程引擎（`src/lib/planner/**`）内部算法 | 除 W6 的裁决项外，本批不动引擎；动它会动 golden |
| 服务端契约（`schemaVer` / `/api/sync/state` 字段） | 本批只在**前端消费**层修；服务端只改 S2b 的 dialog prompt |
| `_integration_full` 树的任何文件 | 本批唯一工作树 = `_work_dev`；S1 只**参考**其 `AccountMenu` 形态 |
| 手机端真机 APK 重打包 / 签名 | 不在本批；M4/M5 用 dev 样例与纯函数替代 |
| `personaCopy.ts` 的 blurb 池 / `AXIS_META` | 未投诉，改了反而动既有断言 |

## 八、红线（不可越）

1. **golden 红 = 停**：任何 golden/快照变红 → 写 `BLOCKERS.md` 报 CY；**严禁重拍快照掩盖漂移**。W6 未拍板前**不得动引擎**。
2. **只推 `origin/beta-v2`**：`main` / `dev` / `integration-full` 零接触。
3. **每个 WP 单独提交**，中文 message 带条目号；S2 拆成 `S2a` / `S2b` / `S2c` 三提交。
4. **`data-testid` 只增不改**：本批明确要改的锚点已在 W2（P2-1h）/ W3（P1-5e）/ M3（新锚点）逐条列出，其余一律不动。
5. **文案红线继续生效**：BANNED 词表、禁 markdown（含 `#`）、禁 emoji（`scripts/personaCopy.test.ts:27-30`）；W5 新增「禁『宝子』」一条。
6. **样例数据不得伪装成真实数据**：M4 的一切样例结果必须现算 + 带「样例数据」角标；`grep` 到写死的结果数字 = 直接不通过。
7. **变异体反向验证 ≥ 2 条**（见 §三），记录到提交信息。
8. `src/types.ts` 禁 `any`；`_` 开头 = 临时产物**不入库**；`.env` / 大文件不入库；`public/my_schedule.json` / `mobile/android/**` 不动。
9. **手机端改动不得引用网页端组件**（`WeekView` / `App.tsx` 内的视图），保持两端可独立构建。

## 九、环境备注与执行顺序

- **仓库（origin）**：`c1632195650-arch/usst-lightpath-planner`
- **工作树 / 分支**：`D:/WORKBUDDY DATA/学术部/_work_dev` @ `beta-v2`（`_integration_full` 本批零接触，仅 S1 参考其文件**内容**）。
- **执行顺序（强依赖）**：`S1 → S2a → S2b → S2c → S3 → S4 → W5 → W1 → W2 → W3 → W4(仅 a) → M1 → M2 → M3 → M4 → M5 → W6(只写 BLOCKERS)`
  - S2 先行，因为 W5 的文案与 S2 的识别口径必须同一套；
  - W1/W2/W3 是**继承项**，可在 S 批之后并行；
  - M 批最后（M1c 依赖 S3a 的口径；M3b 依赖 S4-3 的删减决定）。
- **门禁命令**：
  ```
  <node> ./node_modules/typescript/bin/tsc --noEmit
  <node> --import ./scripts/register-alias.mjs --test "tests/**/*.test.ts"      # engine
  <node> --import ./scripts/register-alias.mjs --test "scripts/**/*.test.ts"    # ui
  VITE_API_BASE="http://101.35.253.143" VITE_MOBILE_API_BASE="http://101.35.253.143" <node> ./node_modules/@playwright/test/cli.js test
  ```
  ⚠️ 跑 build 前**必须注入两个基址**（只给 `VITE_API_BASE` 会让登录与待办云通道打到两个后端，症状「登录了但待办存不进去且毫无提示」）。
- **代理**：`HTTPS_PROXY=http://127.0.0.1:7890`、`HTTP_PROXY=同`；`gh` 只认环境变量（另需 `APPDATA="C:/Users/CY/AppData/Roaming"`）。**测本地端口务必 `curl --noproxy '*'`**。
- **运行时**：node `C:\Users\CY\.workbuddy\binaries\node\versions\24.14.0\node.exe`；python `C:\Users\CY\.workbuddy\binaries\python\versions\3.13.12\python.exe`。
- **提交/推送唯一入口**：
  ```
  python _gh_api_push.py --repo c1632195650-arch/usst-lightpath-planner \
    --base-sha <父提交> --branch beta-v2 --message-file _msg.txt --files <相对工作区根的路径...>
  ```
  脚本：`D:/WORKBUDDY DATA/学术部/_gh_api_push.py`（`--force` 用于分支已存在时强更）。
- **不要杀 CY 本机的 8000 / 8001 / 5173 端口**；要另开端口用 5174。
- **本轮附带的现成资产**（zcode 可直接复用，勿重复造）：
  - `_work_dev/_moss_mobile_sample.mjs` —— 真实样例生成器（跑法：`node --import ./scripts/register-alias.mjs _moss_mobile_sample.mjs`）；
  - `outputs/手机端真实样例-通知与执行状态-2026-10-07.html` —— 其产物（M4 的验收对照）。
