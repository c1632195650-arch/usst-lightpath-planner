# 项目进度对齐 · 上理生活助手 USST（光溯 + 梨宝）

> 更新：2026-09-08 ｜ 适用对象：刚加入 / 接手本项目、想快速对齐现状的同学。
> 本文只讲「**现在做到哪了**」；「怎么上手 / 协作纪律」见 `teammate-onboarding.md` 与 `AGENTS.md`。

---

## 0. 一句话现状

> **前端（光溯 · 生涯规划）已跑通，后端（梨宝 · 校园问答 RAG）已跑通，数据已补到 255 篇并可检索。**
> 剩下的是：补数据缺口、重采部分全文、以及决赛材料（PPT / 申报书 / 演示视频）。

---

## 1. 项目是「双线」，不是单线

本项目现在已经从「纯前端生涯规划」扩展成两条线，共用一套 React 前端壳：

| 线 | 名字 | 是什么 | 形态 |
|---|---|---|---|
| **主线** | 光溯 | 生涯规划助手：课表 → 画像 → 学期五阶段 → 周/日排程（含留白） | 纯前端，数据存浏览器 localStorage |
| **副线** | 梨宝 | 校园生活问答 + 生活推荐助手（"宝子/咱上理"人格） | 前端 Tab「梨宝」+ FastAPI 后端 + 本地 RAG |

> ⚠️ 旧文档说「纯前端、无后端、不做爬虫」——**这条已经过时**。副线梨宝确实接了一个本地 FastAPI 后端 + 一套爬取来的校园资讯库，但**不碰教务账号密码**这条红线仍然成立（爬的是官网公开栏目 + 公众号公开推文，见 §7）。

---

## 2. 当前进度快照

| 模块 | 状态 | 一句话说明 |
|---|---|---|
| 前端壳（三 Tab） | ✅ 跑通 | 顶栏「月历 / 梨宝 / 画像」三 Tab，卡通风（Logo120、sticker 组件） |
| 画像问卷 | ✅ 跑通 | 8–10 题规则映射（`buildProfile`），**不用 MBTI**，产出人格画像 |
| 学期阶段 / 周排程 | ✅ 跑通 | `WeekView` 周视图 + `lifeMode` 生活模式 + 规则推荐 |
| 梨宝对话 | ✅ 跑通 | 意图分流：**推荐走本地规则，问答走后端 RAG** |
| 后端 API | ✅ 跑通 | FastAPI（8000 端口）`/api/health` `/api/search` `/api/chat` |
| 数据资产 | ✅ 255 篇 | 官网 148 + 公众号 107，全文 204，可检索 |
| 向量 / 检索索引 | ✅ 就绪 | FTS5 全文 + 910 个向量块，混合排序 |
| 决赛材料（PPT/申报书/视频） | ⬜ 未开始 | 参赛类目，P4 阶段 |

**前端流程**：`Welcome → PersonaFlow（问卷）→ PersonaResult → Main（月历/梨宝/画像）`。

---

## 3. 数据资产（这是最近最大的一块工作）

数据存在 `data/usst_articles.db`（单文件 SQLite + FTS5），并导出 `data/usst_articles.json` 备份。

| 指标 | 数值 |
|---|---|
| **主条目** | **255 篇**（`is_dup=0`；另有 21 篇重复已软合并，总数 276） |
| 来源 | 官网 webplus **148**（学生处 / 教务处 / 体育部）+ 公众号 **107**（5 个号） |
| 有全文 | 204 篇（`full_text` 非空） |
| 有摘要兜底 | 109 篇（无全文文章用标题+摘要入索引） |
| 向量块 | 910 个（`chunks` 表，bge-small-zh-v1.5 512 维） |

**领域覆盖（`keyword` 分布，主条目）**：
教学科研 28 · 帮困助学 24 · 教务管理 17 · 奖学金 12 · 慈善公益 11 · 生涯教育 10 · 赋能筑梦 9 · 学籍/考试/群体工作/心理等若干。
→ 原本空白的**奖学金、体质健康测试、心理咨询**等领域已全部命中。

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

### 后端（FastAPI，可选，仅「梨宝问答」需要）
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
├─ data/usst_articles.db           # 主库（255 主条目 + FTS5 + 910 向量块）
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

## 9. 下一步建议（按优先级）

1. **补数据缺口**：查后勤保障处 / 信息化办公室官网，把「生活服务 + 数字校园」补到 300 篇左右。
2. **重采 57 篇全文**：跑 `fulltext.py` 补齐，提高问答质量。
3. **转决赛材料**：数据稳定后立刻进入 P4（申报书 → PPT → 演示视频），不要拖到报名截止。
