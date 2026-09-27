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
