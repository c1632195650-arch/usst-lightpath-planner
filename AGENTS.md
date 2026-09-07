# AGENTS.md

本文件供参与「光溯 · 上理生涯规划助手」项目的 AI 助手与协作者（含人类开发者）阅读。
**任何 agent 在本仓库工作前，必须先读完本文件并严格遵守下方红线。**

## 一、通用注意事项（每次改动都要做到）

- 每次改动完成后，都必须创建一个对应的 Git commit，以便后续追踪和回滚。
- 每次改动后，都必须编写或更新相关测试，并在交付给用户前，确保所有测试和验证全部通过。
- 提交前必须运行 `npm run typecheck`，确保类型检查全绿，禁止带红字提交。

## 二、角色与文件所有权（防冲突的第一道闸）

本项目由两人协作，**严格按文件所有权分工，绝不直接修改对方拥有的文件**。

| 成员 | 负责目录 / 分支 | 内容 |
|---|---|---|
| **A（项目负责人 CY）** | `src/features/quiz/`、`src/components/ui/`、`src/features/plan/`（UI 部分）、`feat/quiz`、`feat/ui`、`feat/ai` | 问卷与画像、UI 组件、AI 解读、文档 |
| **B（队友）** | `src/features/schedule/`、`src/lib/planner/`、`feat/import`、`feat/planner` | 课表导入、排程算法引擎 |

> 要改对方的文件？先发消息沟通，或提 PR 让对方 review。**不要默默改。**

## 三、协作红线（agent 必读，违反即回滚）

1. **`src/types.ts` 是契约层，锁死。** 任何字段改动必须两人当面确认；**禁止用 `any` 绕过类型**——那是崩盘的开始。
2. **禁止直接 push 到 `main` 或 `dev`。** 一律开 `feat/*` 分支开发，合并入 `dev`，`dev` 稳定后再合 `main`。
3. **禁止提交敏感/垃圾内容：** `.env.local`、任何密钥/Token、大文件（演示视频等）、`node_modules/`、`dist/` 一律不进仓库（已写入 `.gitignore`，不要手滑 `git add .` 把它们加进来）。
4. **大文件（如演示视频、模型）不要进 git。** 放 Vercel/Netlify 或单独提交，仓库只留代码。
5. **小步提交，每 commit 可独立回滚。** 不要把一天的工作揉成一个巨无霸 commit。

## 四、分支模型

```
main      ← 受保护，只合“能跑、能演示”的版本，最终参赛提交用
dev       ← 日常集成分支，两人都往这合
feat/quiz  feat/ui  feat/ai   ← A 开
feat/import  feat/planner     ← B 开
```

## 五、每日标准动作（每人）

```bash
git checkout dev
git pull origin dev            # ① 开工先拉最新
git checkout -b feat/xxx       # ② 开自己的功能分支
# ……写代码（AI 帮你写）……
npm run typecheck              # ③ 提交前必过
git add .
git commit -m "feat(quiz): 完成15题问卷"
git push origin feat/xxx       # ④ 推到远程
# 在 GitHub 提 PR 合到 dev
```

## 六、出事了怎么办

- **冲突（merge 报 conflict）**：别无脑 accept。看清楚哪边是你、哪边是对方，手动合并。同一文件冲突几乎只发生在 `types.ts` 或共享常量——所以上面的锁死规则最关键。
- **误提交密钥/大文件**：立刻从 git 历史删除并作废该密钥。
- **`main` 被弄脏**：用 `git revert` 回滚单个 commit，不要 `reset --hard` 丢掉别人的工作。

## 七、与本项目的关系

本文件是给 agent 的「护栏」。更完整的协作说明（含队友加入步骤、冲突处理、参赛时间轴）见 `docs/teammate-onboarding.md`。
