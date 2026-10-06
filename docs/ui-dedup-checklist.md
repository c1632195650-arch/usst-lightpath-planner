# UI 去重 / 收敛清单（S4 · 2026-10-07）

> 总原则（CY 2026-10-07 00:29 原话）：
> 「功能的一切原则……两个窗口或按钮内容一模一样就保留合适位置的那个……不要让页面臃肿……在使用场景逻辑顺畅的位置。」
>
> 合适位置 = ① 不让整个页面臃肿 + ② 使用场景逻辑顺畅。
> 本清单逐条登记「重复源 → 保留哪个 → 理由」。**每删一处，同提交内更新受影响的
> data-testid / E2E 断言，并注明「单点可还原」。**

| # | 重复源 | 保留哪个 | 删除/收敛哪个 | 理由（按总原则） | 状态 |
|---|---|---|---|---|---|
| 1 | 总览下「课表 / 周计划」两个并列子窗口（继承 10-06 Wave3） | 单一「日程」页（WeekPlanView，含折叠只读课表块） | 子标签按钮行；`WeekView.tsx` 整文件 | 排程计划是主场景（默认落在 plan）；课表降为折叠只读块，页面少一层并列窗口 | 本批 W3 执行 |
| 2 | `CloudAccountCard` 两处（Welcome footer + 画像页底） | 顶栏 AccountChip（popover 内含卡片）+ Welcome footer（onboarding 无顶栏） | 画像页底那份 | 「账号在左上」是 CY 的记忆锚点；画像页底部是浏览动线的死角落，且与顶栏内容一字不差 | 本批 S1 已执行（a69509c） |
| 3 | 手机端 `WeekGlance`（只读计数）vs M3 新周视图 `WeekBoard` | `WeekBoard`（含周切换/回到现在/点天展开） | `WeekGlance.tsx` 及其挂载 | WeekGlance 只能给「N 件」计数、无切周无展开 —— 被 WeekBoard 完全覆盖；并列两张周卡是典型臃肿 | 本批 M3 执行 |
| 4 | 手机端 `NotifyStatus` 的「重排提醒/权限引导」 vs `WhitelistGuide` 的权限引导 | 权限引导留 `WhitelistGuide`；`NotifyStatus` 只留计数、状态与重排动作 | NotifyStatus 里的引导性长文案 | 权限引导是「怎么开」的教程（WhitelistGuide 场景），NotifyStatus 是「开了没/排了几条」的状态面；两件事不重复，重复的是引导文案 | 本批 M5 收敛口径 |
| 5 | `WeekView` 的 PACE 段 vs `WeekPlanView` 的「换个节奏」 | `WeekPlanView` 的「换个节奏」 | WeekView PACE 段（随 #1 一并删除） | 同一功能两个入口，WeekPlanView 的入口在使用场景里（正看着计划要调强度） | 本批 W3 执行 |
| 6 | 网页端 memo tab「新增待办」 vs 手机端 GoalTodoCard「记一条」 | **各自保留**（不同端、不同场景），但**文案口径统一**（S3a/M1c 同一套排程状态话术） | 不删 | 跨端场景无法互相替代；要收敛的是文案口径，不是入口 | 口径已统一 |
