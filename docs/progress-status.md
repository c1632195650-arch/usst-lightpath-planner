# 项目进度对齐 · 上理生活助手 USST（光溯 · 梨宝）

> 更新：2026-10-02（梨宝排程交互智能化优化方案批次0-3 终验通过后重写；此前 2026-09-15 版本中 PR 合入 / lbaoRecommend 等口径已作废）
> 本文只讲「**现在做到哪了**」。定位以 `docs/project-core.md` 为准；上手与纪律见 `teammate-onboarding.md` 与 `AGENTS.md`。
> **逐批明细以 `docs/wp-ledger-v2.md`（台账）+ `BLOCKERS.md` 为准**——本文是快照，不是流水账。

---

## 0. 一句话现状

> **前端（光溯）+ 后端（梨宝 · RAG 问答 + 分层记忆 + 对话管理器）+ 排程真引擎 + 数据资产全部就绪；梨宝线重构已完成**（旧规则模板 `lbaoRecommend` 已删，对话/排程收敛到真引擎一条链路，S/T/D 批追问链路整改 + 对话管理器 + 终验全绿，E 批知识/空间/画像接线 + G 批三开关全开，**H：交互升级批次0-3 终验 7 条真机剧本 19/0**）。
> 剩下的是：**beta-v2 → dev 人工合并评审**（unrelated histories，见 BLOCKERS）、四处 PARTIALS 契约扩展、待立项项（方案 §5.3「频率→持续到何时」追问链）、决赛材料（PPT / 申报书 / 演示视频）。

---

## 1. 一条主线 + 一个角色

| 项 | 名字 | 是什么 | 形态 |
|---|---|---|---|
| **主线** | 光溯 | **懂上理的智能决策伙伴**：知识问答（L1）→ 场景引导（L2）→ 画像建议（L3）→ 排程（L3 的一种输出形式） | 前端 + FastAPI 后端 + 本地 RAG |
| **角色** | 梨宝 | 承载上述全部能力的统一人格入口（"宝子 / 咱上理"人格） | 前端 Tab「梨宝」+ 后端 |

> 不碰教务账号密码这条红线仍然成立（采集的是官网公开栏目 + 公众号公开推文，见 §7）。

---

## 2. 当前进度快照（2026-10-01）

| 模块 | 状态 | 一句话说明 |
|---|---|---|
| 前端壳（三 Tab） | ✅ 跑通 | 顶栏「总览 / 梨宝 / 我的画像 / 课表」，卡通风 |
| 画像问卷 | ✅ 跑通 | 8–10 题（含 WP2 年级分层 + 上理场景化、WP1 基础信息前置），非 MBTI |
| 排程真引擎 | ✅ 跑通 | `buildWeekPlan`（`src/lib/planner/`）：两遍法 + 增量滚动 / 锁定 / 涟漪预览 / 跨校区转场 buffer；**`lbaoRecommend` 规则模板已于 2026-09-19 删除** |
| 梨宝对话 | ✅ 跑通 | D0 问答/排程双模式 + S 批追问链路（collect 状态机 / 保留式追问 / 分号位置对应应答）+ T 批语义换向（在线全消息过 `/api/plan/understand`）+ D 批对话管理器（ActExecutor，`DIALOG_ENABLED` 总回退开关） |
| 引擎知识接线 | ✅ 全开 | E 批接方法库/健康库、空间库步行排序、画像块级偏好（三灰度开关）；**G 批（2026-10-01）起缺省全开**（env `'0'` 逃生门），golden 实测零漂移 |
| 周视图呈现层 | ✅ 跑通 | E4 块卡片 L0 减字 / 时间轴撑满 + E5 原生 dialog 详情抽屉（零依赖），设计规范 `docs/week-view-design.md` |
| 后端 API | ✅ 跑通 | FastAPI `/api/health` `/api/search` `/api/chat` `/api/route` `/api/weather` `/api/poi` `/api/nearby` + **`/api/plan/understand`**（`server/plan_dialog.py`，D 批 dialog 组） |
| 校园知识层 | ✅ 147 地点 | tags/func/emoji 齐备，支持学生黑话检索 |
| 数据资产 | ✅ **520 主条目** | **515 篇**入 FTS，**1873** 向量块；详见 §3 |
| 测试 / 验收体系 | ✅ 就绪 | engine 458 + ui 319 + golden 快照 5 份 + wiring/源码锁 RV + E2E `e2e-sched-session.mjs` 77 断言 + 理解金标 100 条双通道评测（见 §4.4） |
| 决赛材料（PPT/申报书/视频） | ⬜ 未开始 | 10 月底决赛 |

**前端流程**：`Welcome（含基础信息前置）→ PersonaFlow（问卷）→ PersonaResult → Main（月历/梨宝/画像）`。

---

## 3. 数据资产

数据存在 `data/usst_articles.db`（单文件 SQLite + FTS5）。

| 指标 | 数值 |
|---|---|
| **主条目** | **520 篇**（`is_dup=0`；全表 612 条含已软合并的重复） |
| **入 FTS 检索索引** | **515 篇**（`articles_fts`） |
| 向量块 | **1873 个**（`chunks` 表，bge-small-zh-v1.5） |

> 领域覆盖明细跑 `scripts/analyze_coverage.py` 重算；「奖学金、体质健康测试、心理咨询等原本空白领域已命中」的结论仍然成立。

---

## 4. 已打通的能力（核心逻辑）

### 4.1 检索（`scripts/rag.py`）
- jieba 分词 → **FTS5 BM25（权重 0.4）** + **bge-small-zh-v1.5 向量余弦（权重 0.6）** 混合排序。
- **时效因子**：3 个月内不衰减，之后每 90 天 ×0.9，下限 0.5。
- 索引只收 `is_dup=0` 主条目。

### 4.2 问答（`server/app.py` → `/api/chat`）
- **脱敏网关** → RAG → 有 `LLM_API_KEY` 走 DeepSeek「梨宝人格」合成，无 Key 自动降级抽取式。
- D5 问答相关性门（grounded/hybrid 假命中防线）已上线。
- 三层记忆 + 身份分离（user_id / session_id，`src/lib/identity.ts`），双向记忆回写（WP12）。

### 4.3 排程（`src/lib/planner/` —— 真引擎）
- 入口 `buildWeekPlan`：两遍法构造 + 求解 + 改进；P2 增量滚动（previousPlan/lockLevels/lockedPlacements）。
- 知识接线（E1/G 批全开）：方法库自习档位 25/50、久坐安全档、深度工作钳制——**人群底线输给用户明确说过的话**（corrections 层在其后生效）。
- 空间接线（E2/G 批全开）：自习点按步行分钟排序、估算留余量、超预算挪后不删。
- 画像接线（E3/G 批全开）：HEA 作息 → 自习块时段亲和度。
- 遗留未接线（`*_PARTIALS` 已登记，需契约双方确认）：睡眠保底窗口（`identity.sleepMin` 进 PlanRequest）、每周活动量下限、三餐消费步行预算、画像变更「受影响天」集合。

### 4.4 梨宝对话链路（S/T/D/E 批产出）
- **意图分流**：问答走 RAG；排程意图走真引擎（防腐层 `weekPlanForChat.ts` 是 `features/libao` 与 `lib/planner` 的唯一接缝）。
- **追问状态机**：collect/picking/draft/blocked 四相统一落在 topic 单容器（`dialogManager.ts`）；保留式追问（连续 2 轮无关才作废）、退出词表、分号位置对应应答。
- **语义层**：`/api/plan/understand`（`server/plan_dialog.py`）三场景（intent/answer/dialog）；在线全消息过端点（T 批换向），规则链路全量保留为离线兜底。
- **评测体系**：理解金标 `evals/golden/plan_understand.jsonl`（100 条，CY 复核定稿）+ `scripts/eval_plan_understand.py` 在线/离线双通道；E2E `scripts/e2e-sched-session.mjs`（77 断言，**必须离线跑**，见脚本头注）。

---

## 5. 怎么跑起来

### 前端（React）
```bash
npm install && npm run dev   # http://127.0.0.1:5173
```

### 后端（FastAPI）
```bash
python server/app.py         # 默认 http://127.0.0.1:8000；PORT=8001 可换端口（多实例隔离惯例）
```
- `server/.env`（已 gitignore）：`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`；不配 Key 也能跑（抽取式降级）。
- ⚠️ 8000 端口可能有他人常驻后端，**禁杀**；自己起实例用 `PORT=8001`。

### 测试入口
```bash
npm run typecheck        # 提交前必过
npm run test:engine      # 引擎 458+
npm run test:ui          # 全仓 UI/脚本 319+
node scripts/e2e-sched-session.mjs [baseURL]   # 需隔离 vite + 离线（脚本头注）
```

---

## 6. 文件地图（关键文件）

```
├─ src/
│  ├─ features/
│  │  ├─ calendar/                 # 月历 + 重要日（WP11 deadlineStore）
│  │  ├─ week/                     # 周计划视图（WeekPlanView/weekViewModel/E5 抽屉）+ userPlanStore（落盘/撤销）
│  │  ├─ libao/                    # 梨宝对话（LbaoChat/dialogManager/libaoIntent/schedSession）
│  │  │  └─ weekPlanForChat.ts     # ← features/libao 与 lib/planner 的唯一接缝（红线 6）
│  │  ├─ persona/ welcome/         # 画像问卷（含基础信息前置、年级分层）+ 欢迎页
│  ├─ lib/
│  │  ├─ planner/                  # 排程真引擎（model/construct/buildPhases/solver/improve/schedule
│  │  │                            #   + E 批叶子 knowledge/placesPolicy/profilePrefs）
│  │  ├─ api.ts                    # 后端 /api 封装（含 planUnderstand）
│  │  ├─ identity.ts / persona.ts / lbao.ts
│  └─ types.ts                     # 契约层（锁死，改动需两人确认）
├─ server/app.py + plan_dialog.py  # FastAPI 后端 + understand 端点
├─ scripts/                        # 数据工程五步 + 评测（eval_plan_understand.py）+ E2E
├─ tests/                          # 引擎验收 + golden 快照 + wiring/RV 源码锁（README 有重拍记录）
├─ evals/golden/                   # 理解金标 jsonl（只增不改）
├─ data/usst_articles.db           # 主库
└─ docs/                           # wp-ledger-v2（台账）/ BLOCKERS / week-view-design / libao-clarify-spec 等
```

---

## 7. 数据工程流水线

五步可单独重跑（采集 `collector/collect_keywords/collect_web` → 抓全文 `fulltext/backfill_web` → 清洗 `clean_text` → 去重 `dedup_db` → 建索引 `rag.py build`）。数据已就绪，一般不用重跑。采集只碰公开栏目与推文，不碰教务账号密码。

---

## 8. 遗留问题 / 待办（2026-10-01）

| # | 问题 | 影响 | 建议动作 |
|---|---|---|---|
| 1 | **beta-v2 → dev 合并** | 本地 beta-v2 与 origin/dev 无共同祖先（unrelated histories） | 人工评审合并策略（BLOCKERS 有案） |
| 2 | **四处 PARTIALS 契约扩展** | 睡眠窗口/活动量/三餐预算/受影响天未进引擎 | CY+RAY 确认契约后立项 |
| 3 | **生活服务、数字校园条目偏薄** | 食堂/宿舍/校园卡类问答命中率低 | 补爬后勤/信息化官网 |
| 4 | **57 篇公众号文章缺全文** | 只有标题+摘要可检索 | 跑 `fulltext.py` 补抓 |
| 5 | 决赛材料未开始 | 10 月底决赛 | 申报书 → PPT → 演示视频 |

> 逐批执行明细与「谁拍板了什么」见 `docs/wp-ledger-v2.md` 与 `BLOCKERS.md`。

> **2026-10-06 收官批次补记**：收官批次（P0-0/P0-0b/P0-1a/1b/1c、Wave2/3）推进与销案明细见
> `docs/一键推进收尾方案-2026-10-06.md`（含执行记录）；canonical 复核 `docs/canonical-review-2026-10-06.md`。
> 上表第 2 项「四处 PARTIALS」中活动量下限/三餐预算两处在本批 Wave 3 接线（见方案批次 5），睡眠保底窗口
> 经 routineStore 写入端（R2）落地；余下按 §12 另立项登记。
