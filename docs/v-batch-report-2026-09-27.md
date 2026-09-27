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

## 批 V2 —— commit `V2:`

| 项 | 改动 |
|---|---|
| V2-1 挑块接续 | `weekPlanForChat.ts` 增 `matchCandidate`（归一互相包含，0/1/N 分发）；`LbaoChat.tsx` 增 `clarifyPicking` 状态：runCancel/runReschedule 多命中挂候选 → 下一句按名匹配 → 单命中重进执行器出草稿卡；未命中诚实重列 |
| V2-2 hold 意图 | `libaoIntent.ts` 增 `hold`（别排/不要排/留出来/空出来/这段时间有空/没空；置于 cancel 之前——「别排」从 cancel 让位，台账申报）；`weekPlanForChat.ts` 增 `holdSlotFrom`（窗缺省整天，缺天追问）+ `holdToUnavailableSlot`（一次性，当前周）；`LbaoChat.tsx` runHold → 草稿卡确认 → addSlot 落层 + `window.dispatchEvent('usst:replan')`；`WeekPlanView.tsx` 监听 → replanToken+1 触发重排 |
| V2-3 我的卡文案 | 核对通过：desc 已讲清「梨宝按你的画像、记忆与校正记录量身定制」，不改（纯数据核对项） |

**命令实据**：tsc 0 错；v2 6/6；golden-compare 5/5；gate 5/5（engine 394 / ui 280）

**反向验证**：RV1 模糊匹配删 + RV2 hold 条目删（批量 fail 2）；RV3 缺天猜整天（fail 1）→ 恢复 → 6/6

## 批 V3 —— commit `V3:`

- `scripts/e2e-journey.mjs`（新，playwright 手动验收资产，≥20 断言）：清 storage → ①标题 → ②信息 → ③问卷自动作答 → ④结果 → ⑤导入 → ⑥模式窗「远方」预览确认 → ⑧满溢度/工具条 → ⑨编辑态切换+刷新持久化 → V1-5 留白块 → ⑫梨宝改期 → ⑬记忆面板 → F5 恢复
- `tests/v3.test.ts`（新，6 用例 21 断言）：旅程页面级连线源码锁（首访链/模式窗双入口/日程三件套/梨宝链/重看引导/E2E 资产在位）；纯逻辑锁（checklist/档位/候选匹配）已在 v0/v1/v2 入 ui 门禁
- 未运行 playwright（禁止启动服务；5173/8000 为 MOSS 验收环境）——脚本由 MOSS 手动执行对判据
- **命令实据**：tsc 0 错；v3 6/6；golden-compare 5/5；gate 5/5（engine 406 / ui 280）；锚 7190ca67 未变

## 总结

| 批 | commit | gate | golden | RV |
|---|---|---|---|---|
| 批0 对账+在途 | （无在途改动，AGENTS.md 他人改动未碰） | 5/5（381/280） | — | — |
| V0 | e8986dc | 5/5（387/280） | 5/5 | 2 组 |
| V1 | c8b61cc | 5/5（394/280） | 5/5 | 3 组 |
| V2 | c548f8f | 5/5（400/280） | 5/5 | 3 组 |
| V3 | （本 commit） | 5/5（406/280） | 5/5 | 断言锚固 |

- 基线演进：engine 381→406、ui 280 持平、tsc 0；golden v1 零重拍（5/5 每批复核）
- 既有断言改动：零（未动任何既有测试期望值）；新测试文件 v0/v1/v2/v3/wp12 等
- 19 拍覆盖：①-⑬⑮⑯⑰ 全通；⑭ 语气规范由既有门禁守；⑱ 已核（V2-3）；⑲ 接受现状（CY 拍板不立项）
- 明确不做（§6）：H6/图片识别课表/视觉大改版/运动×健康库深联 —— 未越界
