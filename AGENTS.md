# AGENTS.md

本文件供参与本项目的 **AI 助手与协作者（含人类开发者）** 阅读。
**任何 agent 在本仓库动手前，必须先读完本文件**，并严格遵守下方红线。

> 📌 **四个入口，按顺序读**：
> 0. **`docs/project-core.md`** ← **先看这个**：项目是什么、为什么这么做、智能边界四层、记忆点。**这是定位的唯一权威。**
> 1. **`docs/progress-status.md`** ← 当前做到哪了、数据资产状态、遗留问题。
> 2. `docs/scheduler-v2-spec.md` ← 排程引擎 v2 规格、字段与裁决（改排程必读）。
> 3. `docs/decisions.md` ← 为什么这么选（注意 ADR-002 / 003 / 005 顶部的修正注）。
>
> 本文是**协作护栏**（红线 + 纪律 + 分工），不是开发总纲。
>
> ⚠️ **已归档**：`docs/PRD.md`、`docs/roadmap.md`、`docs/product-vision.md`、`docs/project-intro.md`。
> 其中的**产品定位与核心主张口径一律作废**，以 `docs/project-core.md` 为准。

---

## 〇、当前进度快照 · 动手前必读（2026-09-15）

### 项目是「一条主线 + 一个角色」，不是双线

| 项 | 名字 | 是什么 | 形态 |
|---|---|---|---|
| **主线** | 光溯 | **懂上理的智能决策伙伴**：知识问答（L1）→ 场景引导（L2）→ 画像建议（L3）→ 排程（L3 的一种输出形式） | 前端 + FastAPI 后端 + 本地 RAG |
| **角色** | 梨宝 | 承载上述全部能力的统一人格入口（"宝子 / 咱上理"） | 前端 Tab「梨宝」+ 后端 |
| **红线** | 智能边界 | 梨宝**可以递地图、陪走一段、指方向，但绝不替用户拍板**（L4 不做） | 见 `docs/project-core.md` §4 |

> ⚠️ **旧口径已废**：不再把项目描述成"排程工具 + 配角助手"的双线结构；「反内卷 / 留白率」**已从核心卖点降为排程引擎的一个可调软参数**（`blankDeficit`），不得再出现在对外材料的主叙事里。

> **2026-09-15 起的分工**：梨宝线由 **CY 单独推进**，B 专注**排程引擎与排程内容**（见 §二）。

### ⚠️ 已经实现、不要重复造轮子的清单

**以下能力均已跑通并通过实测。动手前先确认你要做的东西是否已在列——是就直接复用/扩展，不要重写一遍。**

| 已实现 | 位置 | 状态 |
|---|---|---|
| 前端三 Tab 壳（月历 / 梨宝 / 画像） | `src/App.tsx` | ✅ 跑通 |
| 欢迎页 → 画像问卷 → 画像结果 → 主界面流程 | `src/features/welcome/`、`features/persona/` | ✅ 跑通 |
| 画像规则映射（8–10 题，非 MBTI） | `src/lib/persona.ts` `buildProfile()` | ✅ 跑通 |
| 月历 + 截止事项看板 | `src/features/calendar/` | ✅ 跑通 |
| 周排程视图 + 生活模式 | `src/features/week/WeekView.tsx` | ✅ 跑通 |
| 规则推荐引擎 `lbaoRecommend()`（硬编码时间模板，非真引擎） | `src/lib/lbao.ts` + `features/libao/LbaoPlanView.tsx`（渲染） | ⚠️ **收敛中**：真引擎入口是 `buildWeekPlan`。周计划页接入在 **PR #3**，梨宝对话侧并轨在 **PR #4**。`features/week/WeekView.tsx:53` 仍调 `lbaoRecommend`，待清理 |
| 梨宝对话（意图分流：排程走真引擎 / 问答走后端 RAG） | `src/features/libao/LbaoChat.tsx` + `weekPlanForChat.ts` | ✅ 跑通（PR #4） |
| 后端 API：`/api/health` `/api/search` `/api/chat` | `server/app.py` | ✅ 跑通 |
| 检索：jieba → FTS5 BM25(0.4) + bge-small-zh-v1.5 向量(0.6) × 时效因子 | `scripts/rag.py` | ✅ 就绪 |
| 问答：脱敏网关 → RAG → DeepSeek 合成（梨宝人格），无 Key 自动降级抽取式 | `server/app.py` | ✅ 实测 `mode:"llm"` |
| **校园资讯数据资产：520 主条目（515 篇可全文检索）+ 1873 向量块** | `data/usst_articles.db` | ✅ **已就绪，不要重新爬取** |
| 数据工程流水线（采集/抓全文/清洗/去重/建索引，五步可单独重跑） | `scripts/*.py` | ✅ 齐全 |

### 数据资产说明（重要）

- 数据库 `data/usst_articles.db`（约 17 MB，**已在仓库中，开箱即用**）。
- 主条目 **520 篇**（`is_dup=0`；全表 612 条含已软合并的重复），其中 **515 篇**进入 FTS 全文索引；向量块（`chunks` 表）**1873** 个。
- **不要重新爬取**。要新增数据请复用 `scripts/` 里的脚本增量采集，然后跑 `python scripts/rag.py build` 重建索引。
- 重建索引需 `fastembed`（bge-small-zh-v1.5 ONNX，CPU），模型缓存在 `~/.workbuddy/cache/fastembed`。

### 遗留 / 可以接手的活（按优先级）

1. **补数据缺口**：生活服务（食堂/宿舍/校园卡）、数字校园条目偏少 → 找后勤保障处 / 信息化办公室官网补爬。
2. **重采全文**：部分公众号文章因搜狗 token 过期缺全文，仅标题+摘要可检索 → 跑 `scripts/fulltext.py` 补抓。
3. **决赛材料**：申报书 / PPT / 演示视频（9/28 报名截止，10 月底决赛）。
4. 前端：周排程算法打磨（增量滚动、锁定、截止驱动、跨校区转场 buffer）。

> 详细清单见 `docs/progress-status.md` §8–§9。

---

## 一、通用注意事项（每次改动都要做到）

- 每次改动完成后，都必须创建一个对应的 Git commit，以便后续追踪和回滚。
- 每次改动后，都必须编写或更新相关测试，并在交付给用户前，确保所有测试和验证全部通过。
- 提交前必须运行 `npm run typecheck`，确保类型检查全绿，禁止带红字提交。
- 同时运行测试入口：`npm run test:ui`（全仓 UI/脚本测试）；引擎相关改动另跑 `npm run test:engine`。
  （这两个入口随 **PR #3** 合入——它引入 `scripts/register-alias.mjs` 作为 `@/` 别名的加载钩子。）
- **需要活后端的两个入口**（**不是 CI 测试**，跑前先 `python server/app.py` 且配好 Key）：
  - `npm run test:libao` → 45 轮真实对话，判**路由 + 内容**双判据
  - `npm run eval:libao` → 9 维度 / 25 项答案质量评测（找坏法用，产出失败模式原始数据）
    可用 `LIBAO_BASE=http://127.0.0.1:8001` 指定端口，便于与别人的实例隔离。
- **不要重写已实现的能力**（见 §〇 清单）。要扩展就复用现有模块，或先提 PR 讨论。

## 二、角色与文件所有权（防冲突的第一道闸）

本项目由两人协作，**严格按文件所有权分工，绝不直接修改对方拥有的文件**。

| 成员 | 负责目录 | 内容 |
|---|---|---|
| **A（项目负责人 CY）** | `src/features/persona/`、`src/features/libao/`、`src/features/calendar/`、`server/`、`scripts/`、`docs/`、**`src/lib/api.ts`、`src/lib/lbao.ts`** | 画像、**梨宝（含其接口封装与规则层）**、月历、后端、数据工程、文档 |
| **B（队友 RAY）** | `src/features/week/`、**`src/lib/planner/`**、`src/lib/persona.ts`、`src/components/` | 周排程算法与视图、**排程引擎（含 v2）**、UI 组件 |

> **2026-09-15 调整**：梨宝线改由 CY 单独推进，B 专注排程引擎与排程内容。据此把 `src/lib/api.ts`、`src/lib/lbao.ts` 从 B 名下划归 CY；`src/lib/` 的其余部分（`planner/`、`persona.ts`）留在 B 名下。
> 梨宝**天然跨人**的接缝由此收敛为**一个点**：`features/libao/ ↔ lib/planner/`，见 §三 红线 6。

> 分工可按实际协商调整，但**调整后必须同步更新本表**。
> 要改对方的文件？先发消息沟通，或提 PR 让对方 review。**不要默默改。**
> 完整文件地图见 `docs/progress-status.md` §6。

## 三、协作红线（agent 必读，违反即回滚）

1. **`src/types.ts` 是契约层，锁死。** 任何字段改动必须两人确认；**禁止用 `any` 绕过类型**。
2. **禁止直接 push 到 `main`。** 一律开 `feat/*` 分支开发，合入 `dev`，`dev` 稳定后再合 `main`。
3. **禁止提交敏感/垃圾内容：** `.env`、任何密钥/Token、演示视频、`node_modules/`、`dist/`（已写入 `.gitignore`）。
   - 后端 DeepSeek Key 在 `server/.env`，**已 gitignore，绝不提交**；仓库只留 `.env.example`。
4. **不要把预处理产物当源码反复提交**：向量索引、FTS5 索引等由 `rag.py build` 生成，改数据后重建即可，不要手工编辑 `data/` 里的二进制。
5. **小步提交，每 commit 可独立回滚。**
6. **`features/libao/**` 与排程引擎之间只允许一个接缝（接口冻结）。**
   - `features/libao/**` **禁止直接 `import '@/lib/planner/*'`**；唯一例外是防腐层 `src/features/libao/weekPlanForChat.ts`。
   - `buildWeekPlan` 的输入 `BuildWeekPlanInput` 与输出 `BuildWeekPlanResult`（其 `plan: WeekPlan`）视为**跨模块契约**，与 `src/types.ts` 同级：字段增删**必须双方确认**，**禁止用 `any` 绕过**。
   - 引擎侧重构（抽 `construct`、改内部数据结构、换 block id 生成方式）**不得改变这两个类型的语义**。要改语义就先同步，别让对话层被动跟着炸。

## 四、分支模型

```
main      ← 受保护，只合「能跑、能演示」的版本
dev       ← 日常集成分支，两人都往这合
feat/xxx  ← 各自的功能分支（feat/week、feat/data、feat/libao ...）
```

> ⚠️ **栈式 PR 的合并顺序**：`feat/events-and-diversity`（#3）与 `feat/weather`（#5）在**内容上叠在** `feat/planner-v2-p0`（#2）之上。
> 合并必须按 **#2 → #3 → #4 → #5** 的顺序；先合后置的会把前置内容一并带进来，让前置 PR 变空。

## 五、每日标准动作（每人）

```bash
git checkout dev
git pull origin dev            # ① 开工先拉最新
git checkout -b feat/xxx       # ② 开自己的功能分支
# ……写代码（AI 帮你写）……
npm run typecheck              # ③ 提交前必过
git add .
git commit -m "feat(week): 加入跨校区转场缓冲"
git push origin feat/xxx       # ④ 推到远程
# 在 GitHub 提 PR 合到 dev
```

### 本地启动

```bash
npm install && npm run dev                    # 前端 → http://127.0.0.1:5173
python server/app.py                          # 后端 → http://127.0.0.1:8000（可选，梨宝问答需要）
```

后端依赖：`fastapi` `uvicorn` `requests` `jieba` `fastembed`（装在 Python venv 里）。
不配 `LLM_API_KEY` 也能跑——梨宝问答自动降级为抽取式。

## 六、出事了怎么办

- **冲突（merge 报 conflict）**：别无脑 accept。看清楚哪边是你、哪边是对方，手动合并。冲突多发生在 `types.ts` 或共享常量。
- **误提交密钥/大文件**：立刻从 git 历史删除并作废该密钥。
- **`main` 被弄脏**：用 `git revert` 回滚单个 commit，不要 `reset --hard` 丢掉别人的工作。
- **数据/索引损坏**：`data/usst_articles.db` 可从 `scripts/` 重跑重建（采集脚本齐全），索引用 `python scripts/rag.py build` 重建。

## 七、文档地图

| 文件 | 作用 | 谁该看 |
|---|---|---|
| `docs/project-core.md` | **项目定位唯一权威**：三钩子 / 智能边界四层 / 能力地图 / 记忆点 | **开发前必读** |
| `AGENTS.md`（本文） | 协作护栏 + **进度快照 + 已实现清单** | **agent 第一入口** |
| `docs/progress-status.md` | 当前进度、数据资产、已打通能力、遗留问题 | 所有人（尤其新加入者）|
| `docs/scheduler-v2-spec.md` | 排程引擎 v2 规格、字段、裁决记录 | 改排程前 |
| `docs/decisions.md` | 决策记录（为什么这么做） | 想改架构前 |
| `docs/teammate-onboarding.md` | 环境/克隆/每日动作/冲突处理 | 人类队友 |
| ~~`docs/PRD.md`~~ / ~~`docs/roadmap.md`~~ / ~~`docs/product-vision.md`~~ / ~~`docs/project-intro.md`~~ | **已归档**，定位口径作废 | 仅查历史 |
| `docs/features.md` / `docs/engine-plan.md` / `docs/prompts.md` | 模块契约 / 引擎计划 / 提示词库 | 写具体模块前 |

---

## 八、无人值守执行协议（通宵 / 无人盯着跑时强制生效）

> 2026-09-21 新增。**当本仓库被以无人值守方式驱动（例如 ZCode 的 `/goal` 目标模式、闲时任务、定时任务）时，本节优先级高于本文其余部分和一切任务指令。**
> 这些任务在作者睡觉时执行，没有人能当场拦住一次错误操作——**所以本节的禁止项是硬的，不是建议**。

### 8.1 覆盖范围（只做这些，超出即停）

无人值守批次**只允许**改以下目录，因为它们是 CY 名下的文件（见 §二）：

```
src/features/persona/    src/features/libao/    src/features/calendar/
server/                  scripts/               docs/
src/lib/api.ts           src/lib/lbao.ts
```

**禁区（绝对不许动，哪怕任务指令要求）**：

```
src/features/week/   src/lib/planner/   src/lib/persona.ts   src/components/   src/types.ts
```

理由：这五个位置是队友 RAY 的所有权范围。无人值守时改它们 = 绕过评审直接覆盖别人的工作，且没有人在场协商。**若任务要求改到禁区，立即停止并在 `BLOCKERS.md` 记一条**（写法见 8.4），不要"顺手改了"。

### 8.2 每项任务收尾必跑门禁

```bash
node scripts/gate_overnight.mjs
```

它一次性校验四件事：`tsc --noEmit` 0 错、`test:engine` fail=0 且 pass ≥ 312、`test:ui` fail=0 且 pass ≥ 219、禁区文件零改动。

> **基线是 2026-09-21 实测值，只增不减。** 测试数量只会因为新增用例上升；若脚本报 pass 少于基线，说明**有测试被删或被跳过**，这是红灯，不是"基线记错了"。

**门禁不过就不许提交、不许继续下一项。** 先修回绿，修不回来就记 `BLOCKERS.md` 并停手。

### 8.3 提交纪律

- 每完成一项**独立提交一次**，粒度按"可独立回滚"切。
- 提交信息用 `feat(scope):` / `fix(scope):` / `chore(scope):` / `docs(scope):` 前缀。
- **只提交，不 push。** 远程是白天人工评审后的动作，无人值守期间一律本地提交。
- **禁止** `git push`、`git reset --hard`、`git rebase`、`git clean -fd`、`git checkout -- .`、`git branch -D`。
- **禁止删除任何文件**（含临时文件）。要清理就写进 `BLOCKERS.md` 交给白天处理。
- 提交前确认 `.env` / 密钥 / 大文件不在暂存区。`.gitignore` 已有 `_*`（下划线开头=临时产物），不要绕过它。

### 8.4 拿不准的事：写进 BLOCKERS.md，不要自己拍板

**遇到以下任何一种情况，立刻停手、写 `BLOCKERS.md`、结束本轮，不要"猜一个合理值继续推"**：

- 需求有歧义，两种实现都说得通，且选错会返工
- 需要改禁区文件（§8.1）或 `src/types.ts`
- 需要新增第三方依赖
- 需要改数据库 schema、迁移数据、或重建索引
- 需要跨目录搬运数据（例如从兄弟树 `usst-planner` 拷 `data/*.db`）
- 测试是红的，但看代码判断不出原因（不要靠改测试让它变绿）
- 发现任务指令与本节冲突

`BLOCKERS.md` 的写法（追加，一行一条）：

```
- [时间] 阻塞点：<一句话描述>｜已排除：<你试过什么>｜需要人决定：<具体二选一或确认项>
```

> ⚠️ 尤其注意：**不要用"改测试断言"来让门禁变绿**。这是本项目历史上反复强调的红线——新写的断言必须做反向验证（关掉实现要变红），否则就是假覆盖。

### 8.5 无人值守期间的其他硬性禁止

| 禁止 | 原因 |
|---|---|
| 启动后台常驻进程 / 杀进程 | 8000 端口上可能有别人的后端在跑，杀了会打断别人的工作 |
| 安装系统包或全局依赖 | 污染环境，且无人值守时无法回滚 |
| 修改 `.env` / 提交任何密钥 | §三 红线 3 |
| 使用后台子智能体（`background: true`） | ZCode 闲时任务不支持，会直接报错中断 |
| 执行三棵工作树之间的内容合并 | 见 §8.6 |
| 改动 `evals/golden/*.jsonl` 里已有条目 | golden 是 CI 唯一依赖，纪律是"只增不改" |

### 8.6 三棵树不许自动合流（重要）

本仓库当前处于**三树分叉**状态，这是人工决策题，不是自动化任务：

| 树 | 位置 | 现状 |
|---|---|---|
| `_full` | `D:\WORKBUDDY DATA\学术部\_full` | 有完整 git（分支 `integration`），但内容较旧 |
| `_work_dev` | `D:\WORKBUDDY DATA\学术部\_work_dev` | **内容最新**，但没有 `.git` |
| `usst-planner` | `D:\WORKBUDDY DATA\学术部\usst-planner` | 有 `.git` 但 `main` 是空分支、170 个文件未提交；方法库/健康库在这里 |

**无人值守期间只允许在 `_work_dev` 内部工作。** 可以在 `_work_dev` 里 `git init` + 全量快照提交（这是保险，不是合并），但**绝对不许**把另外两棵树的文件自动搬进来，也不许自动解决差异。合流必须白天人工做，因为一次错误的自动合并会**静默丢掉工作**。

> 注意：`.gitignore` 第 60 行是 `_*`，所以**必须在 `_work_dev` 目录内部 `git init`**，不要在上层 `学术部\` 目录 init——那样 `_work_dev` 整体会被忽略，快照等于没做。

