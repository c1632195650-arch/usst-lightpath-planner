# 上理生活助手 · 「真实页面修批」任务书（交 zcode 独立执行）

> 委托人：CY。制定：MOSS（2026-10-06，基于当日**真实浏览器实测** + 逐行代码定位）。
> 前置：工作树 `D:/WORKBUDDY DATA/学术部/_work_dev`，分支 `beta-v2 @ 28bb240`（含 B0-B5 扁平2.0换肤）。
> 门禁基线（**本批开工前实跑，2026-10-06 24:0x**）：`tsc` **0 错**｜engine **709 pass / 0 fail**｜ui **432 pass / 0 fail**｜E2E 见 §二（本批实跑，非旧记忆）。
> 背景来源：CY 2026-10-06 23:46 的 4 条现场反馈（含 2 张截图）+ MOSS 的复现取证（Playwright 实测 + curl 实测）。
> **本任务书自包含。遇未覆盖决策点 → 写 `BLOCKERS.md` 停下等 CY，不擅自裁决。**

---

## 一、背景一句话

CY 在**真实页面**上遇到三类体验缺陷：①待办/目标的输入**回车不提交**（他本人确认「输完直接按回车」），且云端失败时**静默丢输入**；②画像结果页文案过于武断、且右栏「会影响什么」不知所云；③「课表 / 周计划」两个并列窗口冗余，且「选择想安排的日期」在总览里无法单独调整某一天。

**本批性质 = 修正 + 收敛 + 文案重写**（无新增产品能力，除一处标注的裁决项）。**范围波次**：Wave1 待办/目标输入闭环（P0）→ Wave2 画像文案（P1）→ Wave3 课表/日程收敛（P1）→ Wave4 一个待裁决项（不计入本批 DoD）。

---

## 二、验收标准（DoD，全绿才算完成）

| 门 | 基线（本批开工前实跑） | 完成后要求 |
|---|---|---|
| `tsc --noEmit` | **0 错** | 0 错 |
| engine 套件（`tests/**/*.test.ts`） | **709 pass / 0 fail** | ≥ 709 pass / 0 fail（Wave2 应 ≥ 710） |
| ui 套件（`scripts/**/*.test.ts`） | **432 pass / 0 fail** | ≥ 432 pass / 0 fail |
| E2E 全量（`playwright test`，离线打桩） | 见 §二·备注（本批实测值） | ≥ 基线 + 3（本批新增 3 条）/ 0 fail |
| 反向验证（变异体） | — | ≥ 1 条：删掉「回车提交」实现 → 新增 E2E 恰红 → 还原后 sha256 一致 |

**新增 E2E 必须包含的 3 条语义断言**（写进 `e2e/memo-smoke.spec.ts`，沿用文件内 `stubSyncApi` / `gotoWebWithIdentity` 夹具）：
1. **回车提交待办**：`memo-add` → 填 `todo-editor-title` → `press('Enter')` → `todo-list` 出现该标题（**不得**依赖点按钮）。
2. **回车提交目标**：`goal-add` → 填 `goal-form-title` → `press('Enter')` → `goal-item-*` 出现该标题。
3. **云端失败不再静默**：`page.route('**/api/sync/state', 500)` 后点 `memo-add` → 填标题 → 点 `todo-editor-submit` → **该条仍出现在列表**（本地兜底）+ `memo-write-error` 可见 + `memo-sync-state` 文案含「未同步」。

**交付物**：① 每个 WP **单独一次提交**，中文 message 写明条目号（如 `fix(memo): P0-1 回车即提交待办/目标（Wave1）`）② 台账落 `BLOCKERS.md`/`RUNBOOK.md` ③ 验收证据（上述命令实跑输出）④ 只推 `origin/beta-v2`。

---

## 三、执行项

### Wave 1 · P0 —— 待办 / 目标的输入闭环（CY 反馈第 ① 条）

#### P0-1 · 回车即提交（4 个输入点全部补齐）

**现象（CY 原话）**：「待办添加不进去，输入完成之后没反应，目标也是」；追问后他明确：**「输完直接按回车」**。

**依据（实测 + 代码定位）**：
- MOSS 用 Playwright 在真实页面复现（`_moss_enter_probe.mjs`，dev + 线上各跑一次），结果：
  `场景1 待办弹窗按回车 → 弹窗还在=1 条数 3→3 命中=0`；`场景2 目标表单按回车 → 表单还在=1 goal 2→2 命中=0`。
  **同一次会话里改成点按钮 → 立刻成功**（`3→4 命中=1`、`goal 2→3 命中=1`）。⇒ 回车路径 100% 失效。
- 根因：这 4 处输入控件**都不在 `<form>` 里、也没有 `onKeyDown`**，提交只绑在按钮 `onClick` 上。
  - `src/features/memo/TodoEditor.tsx:48` 根节点是 `<div data-testid="todo-editor">`（非 `form`）；提交按钮 `:107-115` 只有 `onClick={submit}`。
  - `src/features/memo/GoalPanel.tsx:49` 目标表单也是 `<div data-testid="goal-form">`；标题 `:50-57`、why `:58-65`；提交按钮 `:68-76` 只有 `onClick`。
  - `src/features/memo/GoalPanel.tsx:118-125` 里程碑输入 + `:126-139` 「加」按钮：同样只绑 `onClick`。
  - `src/features/memo/MemoPanel.tsx:232-275` 中长期待办「什么时候办成的？」弹窗：确认只绑 `:263-272` 的 `onClick`。

- [ ] **P0-1a** `TodoEditor.tsx`：把模态内容包进 `<form onSubmit={(e)=>{e.preventDefault(); submit();}}>`，提交按钮改 `type="submit"`；`textarea`（备注）保留回车换行（**不要**让它在备注里回车就提交）。标题 `input` 回车走浏览器默认表单提交即可。
- [ ] **P0-1b** `GoalPanel.tsx`：目标表单包 `<form>`，`goal-form-submit` 改 `type="submit"`；里程碑那一行（`input` + 「加」）同样包 `<form>`，`goal-ms-add-*` 改 `type="submit"`。
- [ ] **P0-1c** `MemoPanel.tsx` 中长期完成弹窗：包 `<form>`，`planned-done-confirm` 改 `type="submit"`；「还没办成」保持 `type="button"`（不能回车误触）。
- [ ] **P0-1d** 加一条**纯逻辑/组件级**测试并接线到 ui 套件（`scripts/memo-web-workspace.test.ts` 内不需要 DOM，可只做 E2E 覆盖；若加 DOM 测试需引入 jsdom，**不要**为它新增依赖 —— 以 §二 的 E2E 3 条为准）。
- [ ] **验收**：§二 新增 E2E 第 1、2 条绿；`data-testid` 一个都不改名（`todo-editor` / `todo-editor-title` / `todo-editor-submit` / `goal-form` / `goal-form-title` / `goal-form-submit` / `goal-ms-input-*` / `goal-ms-add-*` / `planned-done-dialog` / `planned-done-confirm`）。

#### P0-2 · 云端失败不再静默、不再丢输入（本地兜底 + 显式提示）

**现象**：登录态下若任一网络/服务调用失败，点「添加」后**弹窗关闭、列表不变、页面零提示** —— 用户输入的内容凭空消失，表现为「添加不进去」的第二种形态。MOSS 实测复现：拦截 `**/api/sync/state` → 500 后点添加 → `弹窗还在=0 条数 4→4 命中=0`；`同步状态灯：未同步（本地）`（一个 10px 小 chip，几乎不可见）；`页面是否出现任何错误提示：0`。

**依据**：
- `src/features/memo/MemoPanel.tsx:53-67` `mutate`：登录态走 `withCloudMemo`，失败时 `if (!r) return;`（`:62`）——**不写本地、不报错、不改文案**。
- `src/features/memo/webMemo.ts:99-118` `withCloudMemo`：GET 失败 / PUT 失败 / LWW 被拒三条路都可能返回 `null` 或 `accepted:false`。
- `src/features/memo/MemoPanel.tsx:93-108` `onSubmitEditor`：`:107` **无条件** `setEditorFor(null)`，与成败无关。
- `src/features/memo/GoalPanel.tsx:72`：`onClick` 里先 `onAddGoal(...)` 再立刻 `setTitle('')`、`setWhy('')`、`setAdding(false)` —— 同理失守。
- 数据面佐证：云端账号 `秃头披风侠` 在 `PUT /api/sync/state` 上**是通的**（MOSS 用探针账号端到端实测 `GET 200 → PUT 200 accepted:true → GET 读回原样`），所以**不是服务端问题**，是前端把失败吞了。

- [ ] **P0-2a** `mutate` 返回 `Promise<'ok'|'offline'>`：未登录 = 本地写（不变）；登录成功 = 云端权威数据落地（不变）；**登录失败 = 本地兜底**：`const next = fn(data); setData(next); writeCachedMemo(next); setSync('offline')`（`adoptCloudMemo` 是并集 LWW，本地新条目的 `updatedAt` 更新，**下一次任意成功的读-改-写会把它带上行**，所以兜底安全，不需要重试队列）。
- [ ] **P0-2b** 新增显式错误条：`data-testid="memo-write-error"`，文案固定为
  `这次没连上云端，已先存在本机 —— 联网后会自动补传。`
  右侧带一个「重试」按钮（重新执行最近一次的 `mutate`）；下一次成功时自动清除。错误条位置：`memo-panel` 顶部、`memo-add` 那一行下面，样式用现有 amber 语义（参考 `App.tsx:255-268` 的 demo 横幅配色）。
- [ ] **P0-2c** `TodoEditor` / `GoalPanel` 的提交回调改为 `() => Promise<'ok'|'offline'>`；`await` 期间按钮 disabled + 文案 `…`；**若 'ok'** → 关闭并清空；**若 'offline'** → **同样关闭清空**（因为条目已本地入列，用户看得见），但错误条必须常驻。禁止出现「关闭了又什么都没发生」的组合。
- [ ] **P0-2d** 里程碑添加（`onAddMilestone`）走同一套：失败时里程碑**本地入列** + 错误条。
- [ ] **验收**：§二 新增 E2E 第 3 条绿；手工复核：断网状态点添加 → 列表立刻多一条 + 错误条出现；恢复网络后再点一次「重试」→ 错误条消失、`memo-sync-state` 回「已同步」，且 `PUT` 体里带上那条本地兜底的待办。

#### P1-3 · 【需 CY 裁决】两个 API 基址解析不一致（Wave1 末尾，**不阻塞 P0-1/P0-2**）

**现象**：dev 环境下「登录成功」与「待办存得进去」可能分属两个后端 —— MOSS 实测踩到：登录跑到 `127.0.0.1:8001`（dev 代理），而待办云通道跑到 `127.0.0.1:8000`（默认写死），表现就是「登录好了但待办永远存不进去，且毫无提示」。

**依据**：
- `src/lib/api.ts:8`：`API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000'`（**绝对地址**，且 8000 端口在本机已有另一个后端在用，见 DETAIL 红线「8000 端口别杀」）。待办云通道 `webMemo.ts:16` 就用它。
- `src/features/mobile/lib/api.ts:43-44`：`API_BASE = VITE_MOBILE_API_BASE ?? (isInlinePackage() ? 'http://101.35.253.143' : '')`（**同源相对路径**）。网页端登录卡片 `CloudAccountCard.tsx:15,41` 用的是这一套。

- [ ] **P1-3a** 抽出唯一基址解析：新增 `src/lib/apiBase.ts` 导出 `resolveApiBase()`，优先级 `VITE_MOBILE_API_BASE || VITE_API_BASE` → 包内兜底 → **同源相对路径 `''`**；`src/lib/api.ts` 与 `src/features/mobile/lib/api.ts` 都改为调用它（各自文件内原来的 `API_BASE` 导出名保留，避免大面积改名）。
- [ ] **P1-3b** 【需 CY 裁决】默认值从写死 `http://127.0.0.1:8000` 改为「同源相对路径」会**改变 dev 环境里梨宝的落点**（从 8000 变成 5173 的 `/api` 代理 → 8001）。这是行为变更，**zcode 在此必须停下写 `BLOCKERS.md`**，给出两条路线的取舍（A：只在 memo/登录两处统一，梨宝继续吃 8000 默认；B：三处都收敛到同一解析函数），等 CY 拍板再动。**P1-3a 可先做、单独提交；P1-3b 未拍板前不得改默认值。**

---

### Wave 2 · P1 —— 画像结果页文案重写（CY 反馈第 ② 条）

**现象（CY 原话）**：「这一段文案写的太臭了，会影响什么的这个模块简直不知所云，然后给的标签有点太绝对了，不能因为人家答一个题目就这么武断的下结论，可以稍微模糊一点，朦胧一点，一句话要么有趣，要么文艺一点」。

**依据**：
- 原型标签与「产品策略味」的 desc：`src/lib/persona.ts:47-78`（6 条 `ARCHETYPES`）。
  例：`planner` → `name:'卷王本王'` / `tagline:'连吃饭都提前一周排好'` / `desc:'提前排课表、要确定性，脑子里住着一张 Excel。适合推政策通知、保研竞赛、效率工具。'`
  ← 最后一句是**给产品/评审看的定位语**，直接出现在学生面前，这就是「不知所云」的来源之一。
- 主文案与右栏：`src/features/persona/PersonaResult.tsx:93`（h1 `你的节奏，已经有了轮廓。`）、`:94`（epithet）、`:95`（blurb）、`:96-103`（原型块）、`:107-111`（secondary 句）、`:114-127`（右栏 dl）、**:125**（`会影响什么` / `本周的学习、休息和校园生活建议；不会用于排名。`）、`:131`（页脚 `这是一份可随使用慢慢校准的排程输入。`）。
- 文案红线（机械扫描，**必须继续满足**）：`scripts/personaCopy.test.ts:27-30` —— `BANNED = ['焦虑','摆烂','内卷','落后','拖延','效率低','挂科','失败','垃圾','差','废','烂']`；禁 markdown（`**` / `__` / 反引号 / `#`）；禁 emoji。

- [ ] **P2-1a** 重写 `ARCHETYPES` 6 条的 `name` / `tagline` / `desc`。**`id` 与 `axes` 一字节不动**（`:242-251` 的原型匹配依赖 `id`，改 `axes` 会动 golden）。定稿如下（直接照抄，避免二创漂移）：

| id | name | tagline | desc |
|---|---|---|---|
| `planner` | 提前一点的人 | 把明天先摆好，再安心睡 | 你做事喜欢先有个轮廓，心里才踏实。梨宝会顺着这一点，把要紧的事排前一些，也给留白留位置。 |
| `social` | 总被想起的人 | 一句「一起？」，一天就活了 | 你的日程常常从一次邀约开始。梨宝会把人和事靠近一点，替你留出能约上的空当。 |
| `explorer` | 自己找路的人 | 地图之外，还有一条 | 比起现成答案，你更信自己走一趟。梨宝会多给你几个选项，而不是替你定死一条路。 |
| `healthy` | 天亮就醒的人 | 身体先醒，一天就稳了 | 你把作息过成了习惯，身体也跟着安分。梨宝会把运动和睡眠放进排程的底座。 |
| `spontane` | 临场发挥的人 | 计划留白，精彩补上 | 你不爱被排满，喜欢到了再看。梨宝会给你留出空白格，而不是把一天填死。 |
| `steady` | 慢慢来的人 | 不追热闹，挑值得的 | 你偏爱确定、怕折腾。梨宝会把变动收小，把步骤说清，让你走得不慌。 |

- [ ] **P2-1b** h1 加一层「不绝对」：`:93` 改为 `你的节奏，先有了一层轮廓。`，并在 `:95`（blurb）之后新增一行柔性说明（`data-testid="persona-soft-note"`，样式 `text-white/55 text-sm leading-6`）：
  `这只是此刻的你 —— 答案会变，轮廓也会跟着变。`
- [ ] **P2-1c** 原型块前加引导语：在 `:96-103` 的 `primary` 分支里，`name` 那一行（`:99`）上方新增一行小字
  `<p className="text-xs text-white/45">更偏这一类的节奏（不是标签，只是此刻更像的一侧）</p>`。
  原 `name`/`tagline`/`desc` 的排版不动。
- [ ] **P2-1d** 右栏「会影响什么」（`:123-126`）正文改为：
  `只影响梨宝替你排这一周的顺序 —— 先做什么、几点吃饭、什么时候歇。不参与评比，也不会给谁看。`
  同时 `:117` 的画像状态文案 `可用于推荐` → `可以拿来参考`（`建议复测` 保留）。
- [ ] **P2-1e** 页脚 `:131` 改为：`这份轮廓会随你用起来慢慢校准 —— 不必现在就相信它。`
- [ ] **P2-1f** 新增稳定锚点：h1 加 `data-testid="persona-result-title"`。
- [ ] **P2-1g** 扩测试：把 `ARCHETYPES` 的 `name/tagline/desc` **也纳入** `scripts/personaCopy.test.ts:39-46` 的 BANNED / MARKDOWN / EMOJI 扫描（现在只扫了 blurb 池）。这是防止下一轮文案回潮的唯一锁。
- [ ] **P2-1h** **同步修掉硬编码文案的测试锚点**（否则 E2E 全红）：把 `getByText('你的节奏，已经有了轮廓')` 全部改为 `getByTestId('persona-result-title')`：
  - `e2e/mobile-smoke.spec.ts:497`
  - `scripts/e2e-journey.mjs:59, 65`
  - `scripts/e2e-libao-live.mjs:41`
  - `scripts/e2e-sched-session.mjs:53, 64`
  （`_` 开头的临时脚本不管。）
- [ ] **验收**：ui 套件 ≥ 433 pass / 0 fail（新增扫描用例）；6 条原型名的旧字符串 `卷王本王 / 社交悍匪 / 独行侠 / 早八战神 / 随缘选手 / 佛系躺平家` 在 `src/` 下 `grep` 为 **0 命中**；`python -c` 或 node 脚本逐条跑 BANNED 词表，0 命中。

---

### Wave 3 · P1 —— 课表/日程收敛 + 总览单日定位（CY 反馈第 ③ 条）

**现象（CY 原话）**：「课表窗口没有存在的意义在，统一就留一个日程就行，想安排的日期在总览中也没实现单独调整一周里的一天」。
**CY 已书面裁决（2026-10-06 23:52）**：
- 「课表窗口」= **总览下面与周计划并列的那个窗口**（即 `App.tsx` 周视图里的「课表 / 周计划」子标签，截图里高亮的那格）→ **合成一个「日程」**；
- 「单独调整一周里的一天」想要的手势 = **点那一天 → 进周视图并高亮该天**。

**依据**：
- 子标签定义与分支：`src/App.tsx:31`（`type WeekSubTab = 'timetable' | 'plan'`）、`:55`（默认 `'plan'`）、`:322-368`（`:325-338` 子标签按钮行；`:339-351` 周计划分支；`:352-366` 课表分支）。
- 两个并列视图：`src/features/week/WeekView.tsx`（周次头 `:102-112` / FOCUS DAYS `:114-142` / TIMETABLE `:144-200` / PACE `:202-230` / 梨宝建议 `:232-275`）与 `src/features/week/WeekPlanView.tsx`（阶段头自带周次切换 `:1616-1650`、自带走「换个节奏」入口 `:1653-1662`、自带时间轴 `:2026`）。
- 总览的七天条：`src/features/overview/WeekStrip.tsx:43-51`（`onClick={() => onSelectDay(iso)}`，`aria-label` 已写「点击查看该周安排」）；`OverviewPage.tsx:55-61` 直接把 `onSelectDay={onOpenWeek}`；`App.tsx:140-143` `openWeek` 只 `setWeekMonday + setMainTab('calendar')` —— **点击的那一天被丢掉**。
- 🔴 **额外发现（必须在 BLOCKERS 里如实上报，见 P1-4）**：`selectedDays`（= 「选择想安排的日期」的数据）**根本没有进排程引擎**。全仓 grep 的消费方只有 `App.tsx:145-163`（读写 state）、`src/features/week/WeekView.tsx:15,31,49,127`（只用来给按钮上色）、`src/lib/storage.ts:51-53`（容错）、`src/types.ts:437,451`（类型）。`src/lib/planner/` 下 `BuildWeekPlanInput`（`schedule.ts:58+`）**没有** `activeDays`/`focusDays`/`days` 之类字段 ⇒ 点 FOCUS DAYS 目前**只改变按钮颜色，对计划零影响**。

- [ ] **P1-5a** **周视图单窗口化**：删掉 `App.tsx:325-338` 的子标签按钮行与 `weekSubTab` 状态（`:31, :55`）；`:322-368` 收敛为**单一「日程」页**，直接渲染 `WeekPlanView`。
- [ ] **P1-5b** `WeekView.tsx` 里要保住的三件东西搬进「日程」：
  1. **FOCUS DAYS 段**（`:114-142`，含「整周 / 清空」）→ 原样搬为 `WeekPlanView` 顶部第一个 section（新 props：`selectedDays` / `onToggleDay` / `onSelectWholeWeek` / `onClearDays`，`App.tsx:357-360` 已有现成回调）。
  2. **「返回总览」**（`:103`）→ `WeekPlanView` 阶段头（`:1616`）左侧补一个 `data-testid="weekplan-back-overview"` 的「返回总览」按钮（`onBack` prop）。
  3. **TIMETABLE 网格**（`:144-200` + 辅助函数 `activeThisWeek` / `courseStartingAt` / `isCovered` 与 `PERIODS` 常量）→ 抽成新组件 `src/features/week/WeekTimetable.tsx`，在「日程」页**最底部**以**默认折叠**的 `<details data-testid="week-timetable-details">「本周课表（只读）」</details>` 挂载。
     ⚠️ 这一格是 CY「窗口没有存在意义」的直接对象：**它不再是一个并列窗口**，只是一个折叠只读块；若 CY 说连折叠块也不要，删掉那 1 个 `<details>` 即可（**在提交信息里注明该块是单点可删的**）。
  4. **PACE 段（`:202-230`）与「梨宝建议」段（`:232-275`）**：**删除** —— 前者与 `WeekPlanView:1653-1662` 的「换个节奏」重复，后者与「日程」本身就是引擎产物重复。
- [ ] **P1-5c** 删掉 `WeekView.tsx` 整文件（`App.tsx:22` 的 import 与 `:353` 的使用一并删）。删前确认 `grep -rn "WeekView" src tests scripts e2e` 只剩注释（`src/features/libao/weekPlanForChat.ts:10` 那行历史注释可保留或顺手改）。**注意别误删 `MiniWeekPreview` / `miniWeekPreviewModel`**（名字像但无关）。
- [ ] **P1-5d** **总览点某天 → 进周视图并高亮该天**：
  - `App.tsx` 新增 `const [focusedDay, setFocusedDay] = useState<string | null>(null)`；`openWeek(iso)`（`:140-143`）里 `setFocusedDay(iso)`；点「总览」tab（`:240`）时清掉 `focusedDay`。
  - 把 `focusedDay` 传进「日程」页 → 传给 FOCUS DAYS 段。
  - FOCUS DAYS 里对应那格加**显著高亮**：`ring-2 ring-brand ring-offset-1` + 右上角一枚小角标 `data-testid="focus-day-you-clicked"` 文案「你点的那天」；若该天**当前不在** `selectedDays` 里，角标右侧再给一枚可点的小字按钮 `data-testid="focus-day-add"` 文案「加进想安排的日期」（点它 = 调 `onToggleDay(iso)`）。
  - `WeekStrip.tsx:46` 的 `aria-label` 改为 `\`${iso}，${count} 节课，点击进入该周并定位到这一天\``（文案要与新行为一致，旧文案「点击查看该周安排」已不准确）。
  - 「今日卡」的 `onOpenWeek={() => onOpenWeek(todayIso)}`（`OverviewPage.tsx:51`）保持不变 —— 它等同于「点今天」。
- [ ] **P1-5e** 修掉被删子标签打断的测试锚点：
  - `e2e/mobile-smoke.spec.ts:511-519` 的 `desktopGoWeek()`：删掉「点 `周计划` 按钮」那两句，改为「打开本周安排 → 等 `week-timeline` 可见」。
  - `scripts/e2e-sched-session.mjs:102` 的 `const plan = page.getByRole('button', { name: '周计划' })` 同款处理。
- [ ] **验收**：
  - 新增 E2E：①总览点周三 → 进周视图 → FOCUS DAYS 里周三格带 `focus-day-you-clicked`；②页面内 `grep` 不到「周计划」子标签按钮（`page.getByRole('button', { name: '周计划' })` count = 0，除非时间轴里另有同名元素 —— 若有，请改断言为「子标签容器不存在」并在提交信息里说明）。
  - `e2e/mobile-smoke.spec.ts` 的评估动线（`:522+`）仍绿。
  - engine 套件 **不得下降**（本波不碰引擎）。

#### P1-4 · 【需 CY 裁决 / 只上报，不计入本批 DoD】「选择想安排的日期」是死开关

**依据（已在上面 P1-5 的「额外发现」里给出 grep 证据）**：`selectedDays` 不进 `BuildWeekPlanInput`，排程引擎读不到它。所以现在这个开关**只上色、不生效**，与 CY 的期待（「想安排的日期」= 排程约束）不符。

- [ ] **P1-4a** zcode **在本批必须**写 `BLOCKERS.md`，给出三条路线的取舍，**等 CY 拍板，本批不动实现**：
  - A（硬约束）：未选中的天不排自习/任务块（只留课程与三餐）。需给 `BuildWeekPlanInput` 加 `activeDays?: number[]` → **会动 golden，必须走「golden 红 = 停 + 报 CY」流程**。
  - B（软偏好）：选中的天优先排、其余天尽量空，走现有偏好/代价权重 → 大概率不动 golden。
  - C（不改引擎）：把 FOCUS DAYS 的文案改为**诚实**的说法（例如「标出这几天，用于查看与对焦」，去掉任何「会影响排程」的暗示），或直接移除该段。
- [ ] **P1-4b** 拍板前**禁止**任何「假装生效」的处理（例如把 `selectedDays` 塞进 `state` 就宣称已接线）。

---

### 暂缓 / 不做（本批明确排除）

| 项 | 理由 |
|---|---|
| 顶部导航「课表」（`App.tsx:42` `import` → `ImportTester`） | CY 已裁决指的不是它；课表导入是必需能力，本批不动。 |
| 移动端 `m.html` / `features/mobile/**`（除 `lib/api.ts` 的基址解析） | 本批反馈全部来自桌面端；动移动端会放大回归面。 |
| `WeekPlanView` 的排程引擎、用户覆盖层（`userPlanStore`）、拖拽/锁块 | 与三条反馈无关，动它等于重排风险。 |
| `server/**`、`schemaVer`、`/api/sync/state` 契约 | 服务端已实测无问题（`PUT 200 accepted:true` + 读回一致）。 |
| `WeekView` 里 TIMETABLE 网格的**彻底删除** | 采用「默认折叠的只读块」保守处理（P1-5b.3）；CY 若要彻底删，是单点删除。 |
| `personaCopy.ts` 的 blurb 池 / `makeEpithet` 槽位 | CY 未投诉，且 blurb 已符合「有趣/文艺」口径；乱改会动 `scripts/personaCopy.test.ts` 里 `makeEpithet` 的期望短语断言。 |
| `AXIS_META` 的 emoji 标签 | 未投诉；且它不在文案红线扫描范围内，改动收益低。 |

---

## 四、红线（不可越）

1. **golden 红 = 停**：任何 golden/快照变红，写 `BLOCKERS.md` 报 CY；**严禁重拍快照掩盖漂移**。本批 P1-4 触及引擎，未拍板前**不得动引擎**。
2. **只推 `origin/beta-v2`**：`main` / `dev` / `integration-full` **零接触**，不 merge、不开跨分支 PR。
3. **每个 WP 单独提交**，中文 message 带条目号（`P0-1` / `P0-2` / `P2-1a` …）。
4. **`data-testid` 改名 = 禁止**：本批所有新增锚点只增不改（改动的 anchor 已在 P2-1h / P1-5e 明确列出）。
5. **文案红线继续生效**：`BANNED` 词表、禁 markdown（含 `#`）、禁 emoji（`scripts/personaCopy.test.ts:27-30`）。
6. **文案定稿照抄**：§三 P2-1a 的表格就是终稿，允许改错别字，不允许改口径（CY 已就「要朦胧/有趣/文艺、不要太绝对」给过明确方向）。
7. **变异体反向验证 ≥ 1 条**：删掉 P0-1 的回车实现 → §二 新增 E2E 第 1 条必须恰红 → 还原后原文 sha256 一致（记录到提交信息）。
8. `src/types.ts` 禁 `any`；`_` 开头 = 临时产物不入库；`.env` / 大文件不入库。
9. **不要 gitignore 掉的东西别动**：`public/my_schedule.json`、`mobile/android/**`。

---

## 五、环境备注

- **仓库（origin）**：`c1632195650-arch/usst-lightpath-planner`
- **工作树**：`D:/WORKBUDDY DATA/学术部/_work_dev`，当前分支 **`beta-v2` @ `28bb240`**（另有 `feat/ui-skin-flat2` 已 merge 回 beta-v2；`integration-full` 是另一个 worktree `_integration_full`，本批**不碰**）。
- **推送目标**：`origin/beta-v2`（`git rev-list --count origin/beta-v2..HEAD` = 13，属同一条线；若 CY 另外要求改推 `integration-full`，按 CY 的裁决执行并在此注明）。
- **提交/推送唯一入口**（沙箱里 git 协议不稳，用 REST）：
  ```
  python _gh_api_push.py --repo c1632195650-arch/usst-lightpath-planner \
    --base-sha <父提交> --branch beta-v2 \
    --message-file _msg.txt --files <相对工作区根的路径...>
  ```
  脚本位置 `D:/WORKBUDDY DATA/学术部/_gh_api_push.py`；`--force` 用于分支已存在时强更。
- **代理**：`HTTPS_PROXY=http://127.0.0.1:7890`、`HTTP_PROXY=同`（`gh` 只认环境变量，另需 `APPDATA="C:/Users/CY/AppData/Roaming"`）。**测本地端口务必 `curl --noproxy '*'`**，否则被沙箱注入的 `HTTP_PROXY` 劫持。
- **运行时**：node `C:\Users\CY\.workbuddy\binaries\node\versions\24.14.0\node.exe`；python `C:\Users\CY\.workbuddy\binaries\python\envs\default\Scripts\python.exe`（若不存在，用 `C:\Users\CY\.workbuddy\binaries\python\versions\3.13.12\python.exe`）。
- **门禁命令**：
  ```
  <node> ./node_modules/typescript/bin/tsc --noEmit
  <node> --import ./scripts/register-alias.mjs --test "tests/**/*.test.ts"      # engine
  <node> --import ./scripts/register-alias.mjs --test "scripts/**/*.test.ts"    # ui
  <node> ./node_modules/@playwright/test/cli.js test                            # E2E（自带 build+preview:4173）
  ```
  ⚠️ 跑 build 前**必须注入基址**，否则产物会打回 `127.0.0.1:8000`（2026-10-06 已踩过一次坑）：
  ```
  VITE_API_BASE="http://101.35.253.143" VITE_MOBILE_API_BASE="http://101.35.253.143" <e2e 命令>
  ```
- **dev server（人工复核用，可选）**：
  ```
  VITE_API_BASE="http://101.35.253.143" VITE_MOBILE_API_BASE="http://101.35.253.143" \
    <node> ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173
  ```
  ⚠️ 两个变量**必须同时给**：只给 `VITE_API_BASE` 会让登录（走同源 `/api` → dev 代理 → 127.0.0.1:8001）与待办云通道（走 `101.35.253.143`）打到**两个不同的后端**，症状是「登录了但待办存不进去，且毫无提示」——这正是 P1-3 要根治的坑。
  **不要杀 CY 本机的 8000 / 8001 端口，也不要杀 5173 上已有的进程**；需要别的端口就换 5174。
- **现成的实测探针（可复跑取证，跑完请删）**：
  - `_moss_memo_probe.mjs`（添加闭环，`PROBE_BASE=` 可切线上/本地）
  - `_moss_enter_probe.mjs`（回车行为 + 云端 500 静默度）
  两者都用探针账号 `moss_probe_1006`（在**公网**后端注册，别在本机 8001 上假设它存在）。
- **线上环境（供对照验收）**：网页端 `http://101.35.253.143/`、移动端 `/m.html`、后端 `schemaVer=2`。**注意**：线上 dist 是 22:26 的旧构建，落后于 `beta-v2`（本站反馈的截图对应的是更新的一版代码），所以「线上是对的/错的」不能当作本批的判据 —— 以 `beta-v2` 本地实跑为准。
