# 任务三（移动端执行层重造）· 深层验收报告

> 验收人：zcode（Second 夜批会话）。验收基线：commit `d9eaf13`（M3-W1..W6 一体批）+ 其依赖批（5884027 契约 / 74f59a4+f7b8bd6 方法库 / 887823e SSE / 7a0085f..5ce51a4 任务二 / 33ac42a e2e）。
> 验收方式：**门禁实跑 + 代码逐文件深查 + 变异体亲测红绿 + 行为实测（e2e/截图/四库问答）**，逐条对任务书 §九 验收清单。
> 证据文件：`_accept-gates.log`、`_accept-e2e.log`、`_accept-shots/01..08.png`、`_second-night-gates.log`。
>
> **2026-10-06 09:40 更新：三项缺陷已全部处置完毕（修复+验证），详见文末「§七 缺陷处置附记」。**

## 一、总评

**有条件通过（CONDITIONAL PASS）**：任务书的 40 项验收清单，**36 项实测通过、3 项缺陷、1 项口径待裁决**。三区信息架构、燃烧条、梨宝抽屉、待办两类分流、通知可见性、SSE 端点等核心交付全部真实落地且证据齐全；但评估窗口「完成率」维存在**铁律 2 违规（冷启动显示 0%）**、P6-2 的 ICS 空值提示缺失、移动端总行数超上限——三项需 CY 裁决后由责任批修复。

## 二、门禁实测（acceptance 当日 08:20 实跑）

| 门 | 基线 | 实测 | 判定 |
|---|---|---|---|
| tsc | 0 | **0 错** | ✅ |
| test:engine | ≥496/0 | **593 pass / 0 fail**（含 golden 快照测试） | ✅ |
| test:ui | ≥413/0 | **413 pass / 0 fail** | ✅ |
| 移动端单测 | ≥40/0 | burnBar 7 + memoStore 10 + notify 12 + tipsSlot 3 = **32** + syncContract 23 = **55 / 0**（注：目录式传参会出假 fail，须逐文件跑） | ✅ |
| e2e | ≥8 | **18 passed / 0 failed**（本批 9 + 甲扩 9；含甲对 W6-2 的适配） | ✅ |
| 黄金口径 | 零漂移 | `evals/golden/` **零 diff**；`src/lib/planner/` 仅任务一新增独立叶 `methods.ts`（引擎核心零触碰）；`src/types.ts` **零改动** | ✅ |
| capability-map | 更新 | `--check` 通过（103 测试 / 95 源文件 / 56 RV 锚点） | ✅ |

## 三、硬指标逐条（任务书 §3.2）

| 指标 | 要求 | 实测证据 | 判定 |
|---|---|---|---|
| TodayPage.tsx 行数 | ≤260 | **193 行**（逻辑全在 useTodayData 钩子） | ✅ |
| 当前块标题 | ≥28px | `NowBlock.tsx:34` `text-[28px]`；截图 01 目检 | ✅ |
| 地点字号 | ≥16px | `text-base`（16px） | ✅ |
| 当前块占屏 | ≈40% | 截图 01 竖持 390×844：当前块卡约 380×330px ≈ 37% 视口 | ✅ |
| 接下来字号 | ≤14px | `text-xs`（12px） | ✅ |
| 燃烧条 | 比例+百分比+三色 | 截图 01：「还剩 45 分钟 · 47%」琥珀色实条；纯函数 `burnRatio` 与 §3.3 逐字吻合 | ✅ |
| 大按钮 | ≥44px | `h-11`（44px）两枚 | ✅ |
| 主交互层级 | 1 层 | 完成/顺延在当前块卡上直接可点，不进二级页 | ✅ |
| 既有 testid | 一个不删 | 26 项逐一 grep 存活（`m-shift-15` 为模板字符串动态生成，非删除） | ✅ |
| **移动端总行数** | **≤2600** | **4266 行**（39 文件，含任务二 eval/ 计算层 5 文件） | ❌ 待裁决 |

## 四、功能逐条（任务书 §九 清单摘真）

**Wave 0/1（三区+燃烧条）**：7 组件拆分齐（NowBlock/BurnBar/GoalTodoCard/NextList/LbaoDrawer/EvalPanel+EvalSection/NotifyStatus+QuickBar）；burnRatio 单测 7 条含跨午夜/钳制/三相位；tips 插槽已接任务一真接口（`nowTipForBlock` 适配层 + tipsSlot 3 测试），无 tip 不渲染 ✅

**Wave 2（通知可见性）**：权限前置在 useTodayData（`ensurePermissionOnce`，拒绝落 PERM_DENIED_KEY 本周期不再弹）；「已排 N 条 · 下一条 HH:MM」真实读 getPending；一键重排幂等（重排后重读 pending）；重启恢复提示只提示一次、文案「点重排提醒立即恢复」不说「已恢复」✅；notify 单测 12 条含反验 ✅

**Wave 3（梨宝抽屉）**：底部滑入 max-h-[70vh]；多轮（session_id）+ 历史加载（/api/chat/history）+ visualViewport 键盘适配 + 自动滚底；**排程权已砍**（抽屉内无任何改计划入口）✅。SSE 端点实测：`text/event-stream` + meta→delta\*→done 逐块中文推送、`is_disconnected` 断开检测、无 Key 降级 _chat_core；**ChatReq extra="forbid" 实测 422 extra_forbidden 未放宽** ✅。⚠️ 注记：「逐 token」实为管线算毕后分块推（与「复用而非重写」约束自洽，真 token 级流需重写 LLM 调用，记 stretch）。

**Wave 4（待办与目标）**：三列表（目标+里程碑/最近/中长期）+ 首屏 4s 淡出 + 逾期转常驻 + 收起不持久 ✅；左滑露出完成/收起（截图 02）；**两类完成流程行为不同**——recent 即勾、longterm 强制弹粗粒度选择器（年月+上/中/下旬，截图 03），memoStore 测试锁（longterm 未填 → `need-planned-done` 拒绝）；正反馈「✓ 办完一桩心事」1.8s 不遮挡 ✅

**Wave 5（评估窗口）**：底部折叠不干扰执行；五维独立迷你柱（null 天留空不补 0）；「本周最该改的一件事」指向习惯库方法（截图 08）；铁律 1（无总分）由源码锁测试剥注释守护；铁律 3（confident 哨兵）测试在位；采集弹窗每天一次（hasOfferedToday/recordShown 日期戳）+ ≤5 题 + 可跳过 ✅。🔴 **铁律 2 违规见 §五 缺陷-1**。

**Wave 6（persona/引导/F11）**：persona 随 schemaVer=2 上车，`s.persona ?? null` 缺省与旧行为逐字节一致 ✅；ICS/白名单降级至「提醒与帮助」折叠 ✅；F11 快捷条零延迟本地应答、输入统一归抽屉（无重复输入框）✅；台账 `docs/mobile-exec-layer-plan.md` 四段在位 ✅

**四库问答（live 实测，端口 8002 本地后端）**：
| 问 | route | 命中 | 回答质量 |
|---|---|---|---|
| 为什么总是拖延 | llm | used_study（方法/学习域） | 给出可执行反拖延方法 |
| 晚上睡不着怎么办 | llm | **used_health** | 校园语境睡眠建议 |
| 从宿舍到图书馆怎么走 | llm | **used_space** | 分校区具体路线 |
| 教务处最近有什么通知 | hybrid | 上理库 | 列出真实教务通知 |

**变异体反向验证（验收人亲测，红→绿双输出）**：
1. `burnRatio` 比例硬编码 0.5 → burnBar 测试 **3 pass / 4 fail（红）** → 还原 **7/0（绿）**
2. EvalPanel 混入「总分」→ eval-tips 源码锁 **5 pass / 1 fail（红，断言「出现总分——违反铁律 1」）** → 还原 **6/0（绿）**
3. `completeTodo` 删 longterm 必填守卫 → memoStore **9/1（红）** → 还原 **10/0（绿）**

## 五、缺陷清单（需 CY 裁决）

1. 🔴 **铁律 2 违规：完成率维冷启动显示 0%**（截图 05：全新用户首次打开即「任务完成率 —— 0%」，应为「数据累积中」）。根因在接线层：`eval/units.ts` 的 `completionUnits` 为**从未使用 App 的过去天**虚构 `done=false` 统计单元 → `spanDaysFrom` 恒得 7 → 恒 `confident`；纯函数 `completionRate` 本身无错（其测试「空数据→累积中」只覆盖 units 为空的场景）。加重证据（截图 08）：注入 7 天真实块完成事件后仍显示 0%（分母被虚构单元淹没）——**第一周内该指标对真实行为基本无响应**。同屏拖延/连续性两维正确显示「数据累积中（0/7 天）」，对照鲜明。修法建议（白天决策）：完成率只统计**首个行为事件当天及之后**的日子（或 doneKeys 空时直接 accumulating）。
2. **P6-2 子项缺失：ICS 空值提示**。任务书要求「web-only 用户第一次要靠移动页同步一次才有 ICS → 界面补这句」；实测 `IcsGuide.tsx` 在 `!icsToken` 时整体 `return null`，用户什么也看不到（`webSync.ts:15` 注释自认此缺口）。补一行空值提示即可。
3. **移动端总行数 4266 > 2600 上限**。口径待裁决：三方批次叠加所致，其中任务二 `eval/` 计算层 5 文件（约 600+ 行）与 UI 组件是否计入上限、上限是否按「UI 层/计算层」拆分——需 CY 定口径，不排除放宽或分层管理。
4. （注记，非缺陷）SSE 为算毕分块推流，非 LLM 真 token 级；e2e 曾随 W6-2 迁移出现 ICS 步骤临时挂（甲已适配，现 18/18 绿）。

## 六、结论

任务书主体交付**真实、可验证、质量良好**：CY 的核心诉求（当前块要大、燃烧条、接下来要小、待办卡片浮现、梨宝全上手机砍排程权、通知可见、诚实文案）逐条有代码与截图证据。放行条件：缺陷 1（铁律 2）必须修——它是本项目明文红线；缺陷 2/3 与注记 4 由 CY 定优先级。修复后建议重跑：`tsc + test:engine + test:ui + 移动端逐文件 + 全量 e2e`，并重截 05/06/07 三态图复核「数据累积中」。

## 七、缺陷处置附记（2026-10-06 09:40，CY 授权修复后）

| 缺陷 | 处置 | 验证证据 |
|---|---|---|
| ① 铁律 2 违规（完成率冷启动 0%） | **已修**：`eval/units.ts` 新增 `inUseDays` + `eval/behaviorLog.ts` 新增 `firstEventDayKey`，`EvalSection` 统计窗按「首个行为事件当天起」截断 | 重截图：冷启动「数据累积中（0/7 天）」、三天种子「（4/7 天）」；新增 `tests/mobile/evalWiring.test.ts` 7 条（含端到端缺陷复现）；变异体④退化 inUseDays → 红(5/2) → 还原 → 绿(7/0) |
| ② ICS 空值提示缺失 | **已修**：`IcsGuide.tsx` 删「!icsToken return null」，空值展开显示 `m-ics-empty` 行动指引（网页端排计划 → 手机同步一次 → 链接生成） | 新增 `tests/mobile/icsHint.test.ts` 3 条源码锁；e2e 20/20（带 token 断言不受影响） |
| ③ 总行数 4266 > 2600 | **裁决已执行**：分层核算——eval/ 计算层 871 行（任务二属地）不入任务三账；任务三 UI+lib 3445 行，主约束改「单文件 ≤320 + TodayPage ≤260」（实测最大 316 ✓ / 193 ✓），层上限 3600 备案供 CY 追认；拒绝机械删行凑数 | `wc -l` 分层统计；BLOCKERS 结案条 |

**修复后门禁（09:35 实跑）**：tsc 0 ｜ engine **608/0** ｜ ui **432/0** ｜ e2e **20/0** ｜ capability-map --check 过（105 测试/96 源文件/58 RV 锚点）。
**总评升级：CONDITIONAL PASS → PASS（附 1 项待 CY 追认的行数口径裁决）。**
