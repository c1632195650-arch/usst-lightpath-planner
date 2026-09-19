# 项目进度对齐 · 上理生活助手 USST（光溯 · 梨宝）

> 更新：2026-09-15（§0/§2/§3 数字已按**实测**刷新）｜ 适用对象：刚加入 / 接手本项目、想快速对齐现状的同学。
> 本文只讲「**现在做到哪了**」。定位以 `docs/project-core.md` 为准；上手与纪律见 `teammate-onboarding.md` 与 `AGENTS.md`。

---

## 0. 一句话现状

> **前端（光溯）已跑通，后端（梨宝 · RAG 问答 + 分层记忆 + 画像注入）已跑通，数据已到 520 主条目（515 篇入检索索引）/ 1873 向量块。**
> 剩下的是：**把 4 个 PR（#2 → #3 → #4 → #5）按顺序合入主干**、补演示可见性、以及决赛材料（PPT / 申报书 / 演示视频）。
> ⚠️ **旧数字「255 篇 / 910 向量块」已过期，勿再引用。**

---

## 1. 一条主线 + 一个角色

| 项 | 名字 | 是什么 | 形态 |
|---|---|---|---|
| **主线** | 光溯 | **懂上理的智能决策伙伴**：知识问答（L1）→ 场景引导（L2）→ 画像建议（L3）→ 排程（L3 的一种输出形式） | 前端 + FastAPI 后端 + 本地 RAG |
| **角色** | 梨宝 | 承载上述全部能力的统一人格入口（"宝子 / 咱上理"人格） | 前端 Tab「梨宝」+ 后端 |

> ⚠️ 旧口径说本项目是「双线（光溯主线 + 梨宝副线）」「纯前端、无后端」——**均已过时**。现为**有后端**架构，梨宝是统一人格入口而非副线。
> 但**不碰教务账号密码**这条红线仍然成立（采集的是官网公开栏目 + 公众号公开推文，见 §7）。

---

## 2. 当前进度快照

| 模块 | 状态 | 一句话说明 |
|---|---|---|
| 前端壳（三 Tab） | ✅ 跑通 | 顶栏「月历 / 梨宝 / 画像」三 Tab，卡通风（Logo120、sticker 组件） |
| 画像问卷 | ✅ 跑通 | 8–10 题规则映射（`buildProfile`），**不用 MBTI**，产出人格画像 |
| 学期阶段 / 周排程 | ✅ 跑通 | `WeekView` 周视图 + `lifeMode` 生活模式 + 规则推荐 |
| 梨宝对话 | ✅ 跑通 | 意图分流：**推荐走本地规则，问答走后端 RAG** |
| 后端 API | ✅ 跑通 | FastAPI（8000 端口）`/api/health` `/api/search` `/api/chat` `/api/route` `/api/weather` `/api/poi` `/api/nearby`（后两个 2026-09-15 新增） |
| 校园知识层 | ✅ 147 地点 | 每条补 `tags`（口语同义词）`func`（五类功能）`emoji`；检索支持「图文 / 取快递 / 看病」这类学生黑话 |
| 数据资产 | ✅ **520 主条目** | 其中 **515 篇**入 FTS 检索索引，全文 487 篇；详见 §3 |
| 向量 / 检索索引 | ✅ 就绪 | FTS5 全文 + **1873** 个向量块，混合排序 |
| 决赛材料（PPT/申报书/视频） | ⬜ 未开始 | 参赛类目，P4 阶段 |

**前端流程**：`Welcome → PersonaFlow（问卷）→ PersonaResult → Main（月历/梨宝/画像）`。

---

## 3. 数据资产（这是最近最大的一块工作）

数据存在 `data/usst_articles.db`（单文件 SQLite + FTS5）。

| 指标 | 数值（2026-09-15 实测） |
|---|---|
| **主条目** | **520 篇**（`is_dup=0`；全表 612 条含已软合并的重复） |
| **入 FTS 检索索引** | **515 篇**（`articles_fts`） |
| 有全文 | **487 篇**（`full_text` 非空） |
| 向量块 | **1873** 个（`chunks` 表，bge-small-zh-v1.5） |

**领域覆盖**：⚠️ 下面是 2026-09-08（255 篇时）的旧快照，数据翻倍后**已过期**，需跑 `scripts/analyze_coverage.py` 重算：
~~教学科研 28 · 帮困助学 24 · 教务管理 17 · 奖学金 12 · 慈善公益 11 · 生涯教育 10 · 赋能筑梦 9~~
→ 但"原本空白的**奖学金、体质健康测试、心理咨询**等领域已全部命中"这个**结论仍然成立**。

---

## 4. 已打通的能力（核心逻辑）

### 4.1 检索（`scripts/rag.py`）
- jieba 分词 → **FTS5 BM25（权重 0.4）** + **bge-small-zh-v1.5 向量余弦（权重 0.6）** 混合排序。
- **时效因子**：3 个月内的资讯不衰减，之后每 90 天 ×0.9，下限 0.5（避免报名/考试类旧闻压新闻）。
- 索引只收 `is_dup=0` 主条目，用独立 FTS5 表避免重复行污染。

### 4.2 问答（`server/app.py` → `/api/chat`）
- **脱敏网关**：手机号/学号/邮箱/长数字编号先替换占位符，再进检索与 LLM。
- **可降级**：有 `LLM_API_KEY` → DeepSeek 以「梨宝人格」合成 150 字内口语回答；无 Key → 抽取式（直接引用检索到的最相关原文片段）。
- 梨宝人格常量 `LIBAO_PERSONA`（数字闷骚梨 / 口头禅 / 反内卷 / 括号小声 bb / 表情包文字化）作为 system prompt 注入。

### 4.3 推荐（前端 `src/lib/lbao.ts` + `LbaoPlanView.tsx`）
- 周程页的 `lifeMode` 与梨宝对话里的推荐逻辑已**收敛到同一套**：`lbaoRecommend(profile, schedule, days, modeId?)` + 共享卡片组件 `LbaoPlanView`。

---

## 5. 怎么跑起来

### 前端（React）
```bash
cd usst-planner
npm install        # 项目内置 .npmrc 走国内镜像
npm run dev        # 浏览器打开 http://127.0.0.1:5173
```

### 后端（FastAPI —— 梨宝问答、空间路由、天气聚合都需要）
```bash
# 用管理版 Python（C:/Users/CY/.workbuddy/binaries/python/versions/3.13.12/python.exe）
# 依赖：fastapi、uvicorn、requests、jieba、fastembed（需装进 envs/default 的 venv）
python server/app.py          # 监听 http://127.0.0.1:8000
```
- 环境变量在 `server/.env`（**已 gitignore，勿提交**）：`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`。
- 不配 Key 也能跑——问答自动降级为「抽取式」，功能完整。

### 数据 / 索引
- 数据已就绪（`data/usst_articles.db`），一般**不用重跑**。
- 要重建检索索引：`python scripts/rag.py build`（重算 FTS5 + 向量，需 CPU 跑一阵）。

---

## 6. 文件地图（关键文件）

```
usst-planner/
├─ src/
│  ├─ App.tsx                      # 三 Tab 壳 + 路由（welcome/persona/result/main）
│  ├─ features/
│  │  ├─ calendar/                 # 月历 MonthCalendar + DeadlineBoard
│  │  ├─ week/WeekView.tsx         # 周排程（lifeMode → lbaoRecommend）
│  │  ├─ persona/                  # 画像问卷 + 结果页
│  │  ├─ libao/LbaoChat.tsx        # 梨宝对话（意图分流）
│  │  ├─ libao/LbaoPlanView.tsx    # 共享推荐卡片
│  │  └─ welcome/Welcome.tsx       # 首页
│  ├─ lib/
│  │  ├─ lbao.ts                   # 规则推荐（lbaoRecommend）
│  │  ├─ persona.ts                # 画像映射 buildProfile
│  │  ├─ api.ts                    # 后端 /api 调用
│  │  ├─ storage.ts / date.ts      # 本地存储 / 日期工具
│  ├─ data/usst.ts                 # 模拟课表 + 校历事件
│  └─ types.ts                     # 契约层（锁死，改动需两人确认）
├─ server/app.py                   # FastAPI 后端（health/search/chat + 梨宝人格）
├─ scripts/                        # 数据工程（见 §7）
│  ├─ rag.py                       # 检索：FTS5 + 向量 + 时效
│  ├─ collector.py                 # 公众号按号采集
│  ├─ collect_keywords.py          # 公众号关键词采集
│  ├─ collect_web.py               # 官网 webplus 栏目采集
│  ├─ backfill_web.py              # 官网 PDF 回补
│  ├─ fulltext.py                  # 搜狗 /link 解真链 + 抓全文
│  ├─ clean_text.py                # 清洗（引流尾巴 / 低价值标记）
│  └─ dedup_db.py                  # DB 软合并去重
├─ data/usst_articles.db           # 主库（520 主条目 / 515 篇入 FTS5 / 1873 向量块）
└─ docs/                           # PRD / roadmap / decisions / features / prompts / 本文件
```

---

## 7. 数据工程流水线（新人接手数据时看）

按顺序五步，每一步都可单独重跑：

1. **采集**：`collector.py`（公众号按号）→ `collect_keywords.py`（按领域关键词，搜狗搜索）→ `collect_web.py`（官网 webplus 三栏目）。
2. **抓全文**：`fulltext.py`（搜狗 `/link` 用会话 Cookie 解真链）→ `backfill_web.py`（官网 PDF 用 pypdf 提取正文）。
3. **清洗**：`clean_text.py`（`reclean_db()` 回溯清洗；删"脱单/排行榜/offer"等低价值 + 引流尾巴正则）。
4. **去重**：`dedup_db.py`（软合并：`is_dup`/`dup_of` 标记，官方号优先、全文更长者为主条目）。
5. **建索引**：`rag.py build`（独立 FTS5 表 + 向量 `chunks`，仅索引 `is_dup=0`）。

> 采集只碰**公开**的官网栏目与公众号推文，**不碰教务账号密码**（架构红线仍成立）。

---

## 8. 遗留问题 / 待办

| # | 问题 | 影响 | 建议动作 |
|---|---|---|---|
| 1 | **生活服务（5 篇）、数字校园（1 篇）偏薄** | 问"食堂/宿舍/校园卡"类问题命中率低 | 找到后勤保障处 / 信息化办公室官网域名补爬 |
| 2 | **57 篇公众号文章缺全文** | 搜狗 token 过期，这批只有标题+摘要可检索 | 重采这批全文（跑 `fulltext.py` 补抓） |
| 3 | **GPU 不可用** | RTX 5070 的 NVML 报错，向量只能走 CPU ONNX | 无碍，仅影响建索引速度 |
| 4 | 决赛材料未开始 | 9/28 报名截止，10 月底决赛 | 补完数据后转 P4（PPT/申报书/演示视频） |

---

## 9. 下一步建议（2026-09-15 重排）

**当前第一位不是补数据，是打通合入链** —— 数据工程已冻结；远程 `dev` / `main` 已同步到 `cb3f39e`（脚手架 → 周调度器都在远程），
但 **4 个功能 PR 全 OPEN**：排程 v2、校历事件、梨宝接线、天气都还没进 `dev`。

> ⚠️ 更正（2026-09-15 18:10 实测）：此前本文与评估报告写「远程落后 38 个提交 / 停在 `b899ffa`」，
> 系本地 remote-tracking ref 陈旧导致的误判。实测 `git ls-remote origin` = `dev`、`main` 均为 `cb3f39e`。
> **真正的问题不是"没推"，而是"没合"** —— 成果在 `feat/*` 分支上等合入。

1. **打通合入链**：按 **#2 → #3 → #4 → #5** 顺序合入 `dev`（顺序错会让前置 PR 变空；#4 依赖 #3 引入的 `scripts/register-alias.mjs`，先合 #4 会让 `test:ui` 直接红）。
2. **补演示可见性**：留白率滑块 / 阶段时间轴等旧载体已废，改为体现「会记住你的确认、知轻重缓急、改动不外溢」的可视化；并补 **PDF 课表导入**（现依赖外部 `timetable_parser:8765`，本机未装 → 演示风险）。
3. **梨宝 beta 硬化**：端到端联调、多轮记忆一致性、降级链（见 `outputs/梨宝beta路线图.md`）。
4. **转决赛材料**：**9/28 报名截止**，申报书 → PPT → 演示视频，不要拖到最后一刻。
5. 补数据缺口（生活服务 / 数字校园偏薄）、重采缺全文的文章 —— 属长期优化，**不再是当前阻塞项**。

---

## 10. 2026-09-18 增量：空间数据校准 + 评估基线（本批 PR）

> 上面 §0–§9 写于 09-15，PR 计数与 dev 位置已过期。本节只记这一批做了什么。
> 详细证据：`docs/anchor-audit-2026-09-18.md`、`docs/network-health-2026-09-18.json`、
> `docs/gps-trace-protocol.md`、`docs/valhalla-assessment.md`。

**先纠一条自己的错**：此前判「学长站坐标不准、仅 35% 落在 50 m 内」，是拿**残缺索引**
（OSM relation 未加载，建筑索引只有 121）量出来的。修好索引后同一批点 **23/23 ≤ 50 m、中位 13.6 m**
—— 量出来的偏差是**我方 bug**，不是对方的。剩下的「严重不一致」实为**同名两地归属争议**
（外语学院/理学院南北校、516 门、医务室），不是精度差。**对外比较前先自检本侧索引完整性。**

| 项 | 内容 | 落点 |
|---|---|---|
| P1-2 | L3 相对方位 + L5 骑行假设表（12 km/h + 取放车 120 s，标注 est） | `data/relative_bearing.json`、`data/access_policy.json`、`scripts/build_bike_minutes.py` |
| P1-3 | 弱锚提锚：实锚 **100 → 117/146（80%）**；两条有据可查的校区纠错 | `data/campus_map.json`、`scripts/audit_weak_anchors.py` |
| P2-1 | 路网体检（拓扑/形状/方向熵/绕行率/锚源分布，ISO 19157 口径） | `scripts/audit_network_quality.py` |
| P2-2 | GPS 轨迹 OA 验证协议（噪声上限，不是拍脑袋的 90%） | `scripts/overlap_accuracy.py`、`docs/gps-trace-protocol.md` |
| P2-3 | Valhalla 可行性：**不替换**自建路由（A 离线矩阵 / B 轨迹吸附可用，C 换引擎不可行） | `docs/valhalla-assessment.md` |
| P2-4 | **空间可靠性报告**（ISO 19157 六元素 + NSSDA 位置精度） | `scripts/audit_spatial_quality.py`、`docs/spatial-quality-2026-09-19.{txt,md,json}` |
| P2-5 | 数据收尾：删 OSM 脏桩、正名范围、重生成派生表 | `data/campus_map.json`（**145 条**）、`data/relative_bearing.json` |

### 🔴 覆盖范围（2026-09-19 CY 定）
**只覆盖军工路本部（北校 / 南校 / 580）+ 1100 基础学院。**
**复兴路校区明确不在范围内** —— 不建图、不检核、不计缺口。
（前端 `constants/campus.ts` 仍保留 FUXING 词条，那是给**课表地点字符串反推校区**用的映射，
与「本数据库是否覆盖复兴路空间数据」是两件事，别混。）

### 空间可靠性结论（`npm run audit:quality`，纯文本版 `docs/spatial-quality-2026-09-19.txt`）

按 **ISO 19157** 报六元素，位置精度按 **NSSDA / ASPRS**：`ACCURACY_r(95%) = RMSE_r × 1.7308`。
当前 **✅ 23 ｜ ⚠️ 1 ｜ ❌ 1 ｜ ⚪ 12**，其中 ⚪ 全部是「样本或参照源达不到标准，如实降级为指示性」。

| 结论 | 数值 |
|---|---|
| 位置精度（对照第三方校门点，n=5） | **18.1 m**（RMSE_r 10.5 m） |
| 位置精度（对照高德系点，n=9，peer 换算 √2） | **20.0 m**（RMSE_r 11.6 m） |
| 同一物体层偏差 95 分位 | **17.8 m / 27.3 m**（阈值 50 m，✅） |
| **我方弱锚层**偏差 95 分位 | **114.9 m**（❌ —— 这就是弱锚的代价） |
| 实锚占比 | 116/145 = **80.0%**（✅ ≥79%） |
| 拓扑（孤立点/自环/零长边/重复有向对） | 全 **0**（✅） |
| 可解析率 / 可寻路率 | **100% / 100%**（✅） |
| 证据完备度（verified 占比） | 98/145 = **67.6%**（指示性） |

🔴 **三条必读**：
1. **位置精度只能是「指示性」** —— 检核点 n=9 < 20，且两个检核源自身精度都达不到目标精度的
   1/3。USGS 实践里 17 个检核点都写「not statistically significant enough to report as a
   final tested value」。**升级路径 = `docs/gps-trace-protocol.md` 的外业**。
2. **「同名两地」不算位置误差** —— 6 条严重不一致（外语学院/理学院南北校、516 门、医务室等）
   是**归属争议**，按 ISO 19157 属专题精度。混进 RMSE 会得出 **267 m** 这种假数字。
   **不许用「改坐标」去掩盖** —— 那是把分类错改造成位置错。
3. **「未核验」≠「多余」** —— `verified:false`（47 条）表达的是「尚无独立证据」，
   属证据完备度。混算会得出「48 条多余」的假警报。

**审计脚本自己也做了反向验证**（`npm run audit:quality:reverse`，6/6 通过）：它在第一版就
**骗过我两次** —— 只遍历 `pois` 漏掉 120 条 landmarks、读一个根本不存在的 `anchor` 字段
导致检查恒为 0 的假绿。所以现在每处承重实现都被变异测试钉住。


**判分器硬化（梨宝事实探针）**：`scripts/fact_probe.py` 的规则判分这轮改了 5 处，每一处都是
「跑真实回答 → 发现判错 → 修实现 → 补用例」：营业状态词不再当存在性否定（原先**门禁随跑的时间红绿**）；
「命中证据串」不再等于答对（拆出**拒答=召回失败**）；疑问套话「有没有」不再被当否认；
「没有休息日」这类**属性否定**不再降级正确答案；证据串补「去括号限定语」形态（原先
「南校区有个清真食堂」被判**假含糊**）。

> 🔴 **纪律：新测试必须做反向验证。** `scripts/fact_judge_reverse.py` 逐个变异判分实现，
> 要求自检**必须变红**。首次运行就抓到一处**假覆盖**：不扩到「没有营业」时
> `STATUS.sub` 是**死代码**，变异体关掉它自检仍全绿 —— 测试看着在守、其实没守住。
> 这套变异测试已成为 `npm run probe:reverse`。

**本批测试基线（干净工作树实测）**

| 套件 | 结果 |
|---|---|
| `scripts/test_campus.py` | **242/242** |
| `test:ui` | **122/122** |
| `test:engine` | **67/67** |
| `typecheck` | 通过 |
| `scripts/test_rag.py` | 全部断言通过 |
| `scripts/fact_probe.py --gate` | **52/52 对，存在性维度零幻觉** |
| `fact_probe --selftest-judge` / `fact_judge_reverse` | **24/24** ｜ **10/10 变异体被抓住** |

**仍未做**：`docs/field-check-2026-09-16.md` 的 9 项实地核对（只能走一遍才能定案）；
第七食堂（南校，《一卡通服务网点》有、图谱无）；`(原第四食堂)` 脏桩条目（`osm-001`，
`verified:false`，被 6 条关系引用）；`_campus_ok()` 目前靠「最近中心」判校区，
在**海安路/军工路斜向边界**上不可靠（`第二学生公寓` 因此被误判到 516）。
