# 白天补 batch 执行报告 · 2026-09-27（beta-v2）

> 范围 = WP7 / ModeSetupDialog(H2) / WP12。验收口径：gate 5 门 + golden-compare 5 快照 + 逐条反向验证。
> 现状对账：分支 beta-v2，开工时 HEAD=a7c8725（WP6），门禁锚 7190ca67…，基线 engine 368 / ui 271 —— 全部相符。

## 批 0 · libaoIntent 在途改动处置 —— commit `f98de25`

- `src/features/libaoIntent.ts`（+15/-3：GOAL_NOUNS 增面试/答辩等 8 词；TITLE_STOP 收口增「一次/一个/一段/个/时间/出」；looksLikeAction 增「我…有+目标名词」陈述句兜底）+ `scripts/libaoIntent.test.ts`（+43 新用例）
- 自洽验证：tsc 0 错；libaoIntent 50/50；门禁 5/5 PASS（engine 368 / ui 271）
- 单独提交，未夹带其它文件（AGENTS.md 他人改动未碰）

## 批 A · WP7 编辑模式 + 七天一行/满溢度条 —— commit（WP7:）

**改动文件与关键行号**

| 文件 | 改动 |
|---|---|
| `src/features/week/WeekPlanView.tsx` | editMode state + setEditModePersisted（函数体内 toasts 前，~:470）；开关按钮 aria-pressed+data-testid="edit-mode-toggle"（阶段头，~:1352）；网格绑定 editMode（浏览=overflow-x-auto + grid-cols-7 min-w-[1120px]，编辑=四档自适应，~:1645）；面板区 AddTaskPanel→LearnedPreferencesPanel 整体 `{editMode && (<>…</>)}`（~:1570）；BlockCard editable 门控（draggable + hover 工具容器）+ 调用点 editable={editMode}（:168/:1755）；列头 SaturationBar（自习 Xh 旁，:1713） |
| `src/features/week/saturation.ts`（新） | daySaturation 纯模型（从预置 SaturationBar.tsx 抽出 —— node --test 跑不了 JSX，模型可测） |
| `src/features/week/SaturationBar.tsx`（MOSS 预置） | 改为 模型→JSX 薄映射，re-export daySaturation |
| `tests/wp7.test.ts`（新） | 7 用例：daySaturation 口径/四档/capacity=0/确定性 + 源码接线断言×4 |

**命令实据**：tsc 0 错；wp7 7/7；golden-compare 5/5；gate 5/5（engine 375 / ui 271）；锚 7190ca67 未变

**反向验证**：RV1 删面板包裹 + RV2 阈值位移（批量 fail 2）；RV3 draggable 门删除（fail 1）→ 恢复 → 7/7


## 批 B · ModeSetupDialog（H2 六模式问询） —— commit（H2:）

**改动文件与关键行号**

| 文件 | 改动 |
|---|---|
| `src/features/libao/weekPlanForChat.ts` | 尾部新增 `modeSetupRequest`（buildPhases 校历链→PlanRequest）/ `modePreview`（复制 req+lifeModeExtrasOf 注入→construct 同步干跑→stats{studyHours,blankHours,sportCount,extraMealCount}；抛错→{error}）；:33 增 PlanRequest 类型 import |
| `src/features/libao/modeSetup.ts`（新） | re-export 干跑模型 + MODE_OPTIONS 模式卡元数据（守接缝红线：construct 只在防腐层 import） |
| `src/features/libao/ModeSetupDialog.tsx`（新） | 六模式卡（aria-pressed+data-testid）→ 点选即干跑 → MiniWeekPreview compact（caption「预览 · 未落盘，以实际为准」）+ 三个人话数字 → 「就这么过/再看看」；L4：确认前零写入 |
| `src/features/week/WeekPlanView.tsx` | 增 onOpenModeSetup prop + 工具条「换个节奏」按钮（data-testid="open-mode-setup"） |
| `src/App.tsx` | modeSetupOpen state；ImportTester onApply 落盘后打开；确认 → patchState({ lifeMode: id })（buildPhases 链 deps 含 lifeMode → 自动重排） |
| `scripts/modeSetup.test.ts`（新） | 8 用例 |

**命令实据**：tsc 0 错；modeSetup 8/8；golden-compare 5/5；gate 5/5（engine 375 / ui 279；WeekPlanView 例外申报）

**反向验证**：RV1 去 extras 注入 + RV2 删 try/catch → 批量 fail 4（sport/snack/faraway/error 四条红）→ 恢复 → 8/8


## 批 C · WP12 导入正式化 + 双向记忆回写 —— commit（WP12:）

**改动文件与关键行号**

| 文件 | 改动 |
|---|---|
| `src/App.tsx` | C1：`SHOW_IMPORT = true`（:26，正式构建常驻导入入口）；onApply 增 `addTimetableFacts(s, getUserId()).catch(()=>{})`（失败静默） |
| `server/memory.py` | C2：`add_pending_fact()`（只落 pending，source='timetable'，状态机闸门注释）；C3：`summarize_plan_events()` 纯函数（计数+最近一次转述，unknown/非法形状忽略） |
| `server/app.py` | `POST /api/memory/facts`（MemoryFactReq，extra=forbid）；ChatReq 增 `recent_plan_events: list = None`；api_chat 档案段注入（desensitize 后 [:1200]） |
| `src/lib/api.ts` | `lbaoChat` 增第 4 参 recentPlanEvents → body.recent_plan_events（undefined 时省略键，向后兼容）；`addTimetableFacts()`（N 门课/每周 X 节/晚间课占比，无坐标） |
| `src/features/week/userPlanStore.ts` | `PlanEvent` + ring buffer（≤20，pushPlanEvents/getRecentPlanEvents）+ `diffPlanEvents` 纯函数（tasks 增删 / excluded 差 / moves 增量） |
| `src/features/week/WeekPlanView.tsx` | updateLayer 用 layerRef 投影算 diff → pushPlanEvents（updater 外，StrictMode 不重发） |
| `src/features/libao/LbaoChat.tsx` | lbaoChat 调用传 `getRecentPlanEvents()` |
| `tests/wp12.test.ts`（新） | 6 用例：diff/上限 20/SHOW_IMPORT/注入源码/无坐标 |
| `scripts/test_plan_events.py`（新） | 6 用例 + `--reverse`（add_pending_fact 直落 applied → 红） |

**命令实据**：tsc 0 错；wp12 6/6；test_plan_events.py 6/6 OK 且 --reverse 红（failures=2）；golden-compare 5/5；gate 5/5（engine 381 / ui 279；WeekPlanView+userPlanStore 例外申报）；锚 7190ca67 未变

**反向验证**：RV1 updateLayer 摘掉发事件 + RV2 diffPlanEvents 删 excluded 分支 → 批量 fail 2；RV3 python --reverse → failures=2；恢复后全绿

**遗留**：① 课表回写确认后进画像的 key 为 `objective.timetable_summary`（_merge_into_profile 原样存 key）；② MemoryPanel 对该条目的文案显示走 factLabel 的兜底，样式一般但可用；③ app.py 检出 CRLF 行尾（白天批次带入），本次未整文件归一（守行尾纪律：不碰他人文件）。
