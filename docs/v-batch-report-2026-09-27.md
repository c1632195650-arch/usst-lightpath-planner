# V 批次执行报告 · 2026-09-27（beta-v2）

> 全量交互复刻 goal 包：V0 演示通道与动线闭环 → V1 界面形态收口 → V2 梨宝闭环补口 → V3 E2E 锁。
> 开工对账：beta-v2 @ 1aa3156、门禁锚 7190ca67、基线 tsc 0 / engine 381 / ui 280 —— 全部相符。

## 批 V0 —— commit `V0:`（V0-1/V0-2/V0-3 三项同落 App.tsx，合并一个 commit——与逐项 commit 的偏差在此申报，与批5 先例同口径）

| 项 | 改动 |
|---|---|
| V0-1 重看引导 | `src/App.tsx`：画像 tab PersonaResult 下加次级按钮 `data-testid="replay-onboarding"` → `patchState({ onboarded: false }) + setView('welcome')`（完整重走 ①→⑦） |
| V0-2 首落点 | `src/App.tsx` 结果页 onEnter：`setMainTab(state.schedule ? 'calendar' : 'import')` —— 没导入过直达「课表」tab；老用户维持总览 |
| V0-3 checklist | 新 `src/features/onboarding/checklist.ts`（纯模型）+ `OnboardingChecklist.tsx`（三条待办、全完成整卡隐藏）；`OverviewPage` 增 `onboardingCard` 槽位渲染于页首；「加个重要日」→ 跳梨宝并预填「帮我记一个重要日：」（LbaoChat 增 seedQuestion prop，App 用 nonce 作 key 防重复预填） |

**命令实据**：tsc 0 错；v0 6/6；golden-compare 5/5；gate 5/5（engine 387 / ui 280）

**反向验证**：RV1 done 判定翻转 + RV2 删重看引导按钮 → 批量 fail 4 → 恢复 → 6/6

## 批 V1 —— commit `V1:`（五项落 WeekPlanView/SaturationBar/userPlanStore/deadlineStore，合并一个 commit——申报同批 V0）

| 项 | 改动 |
|---|---|
| V1-1 成就常驻 | `WeekPlanView.tsx`：AchievementPanel 移出 `{editMode && …}` 包裹（包裹闭合后常驻渲染） |
| V1-2 hover 详情 | `saturation.ts` 增 `dayBreakdown` 纯函数；`SaturationBar.tsx` 增 `detail?` prop（group-hover 纯 CSS 浮层，`data-testid="saturation-detail"`）；列头传 课程/自习/活动/留白 四行 |
| V1-3 紧急度三档 | `deadlineStore.ts` 增 `urgencyLevel`（≤3 红/≤7 橙/其余灰）；「接下来」横排卡左缘 3px 色条 + 现有天数文案 |
| V1-4 换节奏提权 | 工具条第一顺位（编辑按钮之前、浏览态可见） |
| V1-5 留白块 | `userPlanStore.ts` 增 `blankTaskFor` 纯函数；onKeepGap → layer.tasks 落 `kind:'blank'` 固定任务（⬚ 留白，weeks=[weekNo]，construct 落 locked blank 块，重排不动；daySaturation 不计 occupied） |

**命令实据**：tsc 0 错；v1 7/7；golden-compare 5/5；gate 5/5（engine 394 / ui 280；week/ 4 文件例外申报）

**反向验证**：RV1 kind 改 activity + RV2 阈值位移 + RV3 挪回包裹内 → 批量 fail 3 → 恢复 → 7/7
