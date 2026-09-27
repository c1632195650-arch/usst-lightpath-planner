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

