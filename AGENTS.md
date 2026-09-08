# AGENTS.md

本文件供参与本项目的 **AI 助手与协作者（含人类开发者）** 阅读。
**任何 agent 在本仓库动手前，必须先读完本文件**，并严格遵守下方红线。

> 📌 **三个入口，按顺序读**：
> 1. **`docs/progress-status.md`** ← **先看这个**：当前做到哪了、有哪些能力已实现、数据资产状态、遗留问题。
> 2. `docs/PRD.md` ← 产品与技术总纲（定位/需求/技术路线/数据契约/验收标准）。
> 3. `docs/roadmap.md` ← 功能分类 × 实现顺序 × HTML→App 策略。
>
> 本文是**协作护栏**（红线 + 纪律 + 分工），不是开发总纲。

---

## 〇、当前进度快照 · 动手前必读（2026-09-08）

### 项目是「双线」，不是单线

| 线 | 名字 | 是什么 | 形态 |
|---|---|---|---|
| **主线** | 光溯 | 生涯规划：课表 → 画像 → 学期五阶段 → 周/日排程（含留白） | 纯前端，数据存 localStorage |
| **副线** | 梨宝 | 校园生活问答 + 生活推荐（"宝子/咱上理"人格） | 前端 Tab「梨宝」+ FastAPI 后端 + 本地 RAG |

### ⚠️ 已经实现、不要重复造轮子的清单

**以下能力均已跑通并通过实测。动手前先确认你要做的东西是否已在列——是就直接复用/扩展，不要重写一遍。**

| 已实现 | 位置 | 状态 |
|---|---|---|
| 前端三 Tab 壳（月历 / 梨宝 / 画像） | `src/App.tsx` | ✅ 跑通 |
| 欢迎页 → 画像问卷 → 画像结果 → 主界面流程 | `src/features/welcome/`、`features/persona/` | ✅ 跑通 |
| 画像规则映射（8–10 题，非 MBTI） | `src/lib/persona.ts` `buildProfile()` | ✅ 跑通 |
| 月历 + 截止事项看板 | `src/features/calendar/` | ✅ 跑通 |
| 周排程视图 + 生活模式 | `src/features/week/WeekView.tsx` | ✅ 跑通 |
| 规则推荐引擎（周程页与梨宝共用同一入口） | `src/lib/lbao.ts` `lbaoRecommend()` + `features/libao/LbaoPlanView.tsx` | ✅ 已收敛为单入口 |
| 梨宝对话（意图分流：推荐走本地规则 / 问答走后端 RAG） | `src/features/libao/LbaoChat.tsx` | ✅ 跑通 |
| 后端 API：`/api/health` `/api/search` `/api/chat` | `server/app.py` | ✅ 跑通 |
| 检索：jieba → FTS5 BM25(0.4) + bge-small-zh-v1.5 向量(0.6) × 时效因子 | `scripts/rag.py` | ✅ 就绪 |
| 问答：脱敏网关 → RAG → DeepSeek 合成（梨宝人格），无 Key 自动降级抽取式 | `server/app.py` | ✅ 实测 `mode:"llm"` |
| **校园资讯数据资产：255 主条目（官网 148 + 公众号 107）+ 910 向量块** | `data/usst_articles.db` | ✅ **已就绪，不要重新爬取** |
| 数据工程流水线（采集/抓全文/清洗/去重/建索引，五步可单独重跑） | `scripts/*.py` | ✅ 齐全 |

### 数据资产说明（重要）

- 数据库 `data/usst_articles.db`（约 9 MB，**已在仓库中，开箱即用**）。
- 主条目 **255 篇**（`is_dup=0`；另有 21 篇重复已软合并），官网 148 + 公众号 107，全文 204 篇，向量块 910 个。
- **不要重新爬取**。要新增数据请复用 `scripts/` 里的脚本增量采集，然后跑 `python scripts/rag.py build` 重建索引。
- 重建索引需 `fastembed`（bge-small-zh-v1.5 ONNX，CPU），模型缓存在 `~/.workbuddy/cache/fastembed`。

### 遗留 / 可以接手的活（按优先级）

1. **补数据缺口**：生活服务（食堂/宿舍/校园卡）仅 5 篇、数字校园仅 1 篇 → 找后勤保障处 / 信息化办公室官网补爬。
2. **重采全文**：约 57 篇公众号文章因搜狗 token 过期缺全文，仅标题+摘要可检索 → 跑 `scripts/fulltext.py` 补抓。
3. **决赛材料**：申报书 / PPT / 演示视频（9/28 报名截止，10 月底决赛）。
4. 前端：周排程算法打磨（留白策略、跨校区转场 buffer）。

> 详细清单见 `docs/progress-status.md` §8–§9。

---

## 一、通用注意事项（每次改动都要做到）

- 每次改动完成后，都必须创建一个对应的 Git commit，以便后续追踪和回滚。
- 每次改动后，都必须编写或更新相关测试，并在交付给用户前，确保所有测试和验证全部通过。
- 提交前必须运行 `npm run typecheck`，确保类型检查全绿，禁止带红字提交。
- **不要重写已实现的能力**（见 §〇 清单）。要扩展就复用现有模块，或先提 PR 讨论。

## 二、角色与文件所有权（防冲突的第一道闸）

本项目由两人协作，**严格按文件所有权分工，绝不直接修改对方拥有的文件**。

| 成员 | 负责目录 | 内容 |
|---|---|---|
| **A（项目负责人 CY）** | `src/features/persona/`、`src/features/libao/`、`src/features/calendar/`、`server/`、`scripts/`、`docs/` | 画像、梨宝、月历、后端、数据工程、文档 |
| **B（队友）** | `src/features/week/`、`src/lib/`（`lbao.ts`/`persona.ts`/`api.ts`）、`src/components/` | 周排程算法与视图、规则/接口封装、UI 组件 |

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

## 四、分支模型

```
main      ← 受保护，只合「能跑、能演示」的版本（当前 = 2026-09-08 进度快照）
dev       ← 日常集成分支，两人都往这合
feat/xxx  ← 各自的功能分支（feat/week、feat/data、feat/libao ...）
```

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
| `AGENTS.md`（本文） | 协作护栏 + **进度快照 + 已实现清单** | **agent 第一入口** |
| `docs/progress-status.md` | 当前进度、数据资产、已打通能力、遗留问题 | 所有人（尤其新加入者）|
| `docs/PRD.md` | 产品与技术总纲 | 开发前 |
| `docs/roadmap.md` | 功能分类 × 顺序 × PDF 导入 | 排期时 |
| `docs/features.md` | 模块级契约（M0–M9） | 写具体模块前 |
| `docs/decisions.md` | 决策记录（为什么这么做） | 想改架构前 |
| `docs/teammate-onboarding.md` | 环境/克隆/每日动作/冲突处理 | 人类队友 |
