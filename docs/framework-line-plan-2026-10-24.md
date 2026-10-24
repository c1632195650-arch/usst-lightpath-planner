# 方案 A · 校园助手框架线（新仓库）建设方案

> 生成：2026-10-24（zcode，承 `docs/framework-pivot-research-2026-10-24.md` 裁决落地）
> **性质**：可执行建设方案。本文件同时是**新仓库的奠基文档**——建仓时原样复制为该仓第一份 docs。
> **姊妹篇**：`docs/usst-line-plan-2026-10-24.md`（上理线方案，含两线关系契约的镜像表述）。
> **工作名**：`campuskit`（备选：`lightpath-core` / `campus-fabric`；中文名"校园底座"。定名前全文以 campuskit 指代，改名只动仓库名与本文件头部）。

---

## A0. 定位与总原则

**一句话目标**：把光溯的可移植核心（排程引擎 / 评测体系 / 数据流水线 / 知识库构建链 / 工程纪律）抽成一个**开源自托管的校园生活助手框架**，用虚构演示校跑通端到端，再用**第二校试点 ≤1 人日**实测 go/no-go，2027-02 前具备开源发布条件。

**五条总原则**（每条都是硬的，违反任何一条就停下写 BLOCKERS）：

1. **单向抽取，零回流**：campuskit 从 `_work_dev` **只读复制**代码资产；campuskit 的任何工作**不得改动 `_work_dev` 的任何文件**。两仓 git 历史完全独立（新仓从零 init，禁止嫁接历史）。
2. **引擎算法主权在上理线**：`src/lib/planner/` 的**算法演进**（新算子/新目标项/调参）只发生在上理线（它是引擎的第一用户与验证场，有 golden + 880 断言守护）；campuskit 只做**包化/解耦/profile 化**这类工程改造。算法类改动想进框架 → 先回上理线评审合入 → 打 tag → campuskit 按快照同步（§A8）。
3. **数据永不跨界**：上理的四类数据（资讯库 / 地点路网 / 账号记忆库 / 校历黑话）**一个字节都不进 campuskit**；campuskit 只带虚构的 demo-school 档案与试点校档案（且试点校数据不回灌上理线）。
4. **时序让位比赛**：上理线决赛（2026-10 底）与 4C 备赛（2027-01~04）优先；campuskit 开工日 = **决赛结束后**（预计 2026-11-02 那周），4C 备赛期 M4/M5 可放缓但不中断基建。
5. **独立部署**：campuskit 开发期全部本地跑（Node + Python venv + SQLite）；不共用上理线服务器（`43.142.141.186` 属上理线），不共用端口与常驻进程。

**与上理线的关系一句话**：同源代码、两个产品——campuskit 是"任何人可自托管的校园助手框架"，上理助手是"框架的第一个真实学校部署 + 参赛产品"。对外叙事（比赛/开源）允许说"同源、上理为参考实现"，但**代码层面在可预见的窗口内互不依赖**（上理线何时改为消费 `@campuskit/engine` 是上理线的独立决策，见姊妹篇 B1）。

---

## A1. 仓库蓝图

### A1.1 目录结构（npm workspaces + Python 目录）

```
campuskit/
├─ AGENTS.md                    # 精简版协作纪律（从上理线移植骨架，独立演化）
├─ README.md                    # 中英双语，M5 前中文先行
├─ LICENSE                      # Apache-2.0（M5 发布时落地；建仓即放，见 A6.3）
├─ package.json                 # workspaces: ["packages/*", "apps/*"]
├─ tsconfig.base.json           # strict、零 any（沿用上理线标准）
├─ .gitattributes               # * -text（字节精确，沿用）
├─ .github/workflows/ci.yml     # CI（移植上理线 P1-6 workflow）
│
├─ packages/                    # TS 包（node --test 零依赖测试纪律，沿用）
│  ├─ engine/                   # @campuskit/engine —— 排程引擎 npm 包（§A2.1）
│  │  ├─ src/…                  #   model/construct/solver/objective/improve/… 全量
│  │  ├─ core/                  #   契约类型自持副本（LockLevel/TimeBlock/WeekPlan/…）
│  │  ├─ tests/ + golden/       #   引擎守护测试 + golden 快照（零漂移验收）
│  │  └─ package.json
│  ├─ profile/                  # @campuskit/profile —— Campus Profile 规范（§A3）
│  │  ├─ schema/                #   places/term/courses/sources/persona/vocab 的 JSON Schema
│  │  ├─ src/                   #   校验器 + 加载器 + demo 数据生成
│  │  └─ examples/              #   demo-school（虚构校）
│  ├─ ui/                       # @campuskit/ui —— 组件库（19 组件 + 令牌 preset，§A2.5）
│  └─ sync/                     # @campuskit/sync —— SyncState schemaVer=2 契约与 LWW 合并纯函数
│
├─ server/                      # profile 驱动的 FastAPI 骨架（§A2.4）
│  ├─ app.py  account.py  sync.py  memory.py  plan_dialog.py
│  ├─ campus.py  campus_network.py  campus_vocab.py   # 全部改为读 Campus Profile
│  ├─ envconfig.py  requirements.txt
│  └─ tests/                    # Python 测试（auth/memory/sync/ics 等迁移 + 新增）
│
├─ pipeline/                    # 数据流水线（§A2.3，从 scripts/ 抽的泛化版）
│  ├─ sources/                  #   sources.json（demo-school + 试点校的源清单）
│  ├─ collect_web.py  collector.py  fulltext.py  clean_text.py  dedup_db.py
│  ├─ rag.py                    #   建索引（FTS5 + bge-small，模型缓存机制沿用）
│  ├─ spatial/                  #   fetch_osm / build_graph / osm_route / …（bbox 参数化）
│  └─ quality/                  #   analyze_coverage / gate_data / token 哨兵
│
├─ kb/                          # 通用知识库构建链（§A2.3）
│  ├─ method/                   #   build/compile/rag + 金标评测（schema + 构建脚本先行）
│  └─ health/
│
├─ evals/                       # 评测框架（run/judge/calibrate/report，§A2.2）
├─ campuses/                    # 校园档案包目录
│  └─ demo-school/              #   虚构演示校（§A3.3）
├─ apps/playground/             # 最小演示前端（Vite+React+Tailwind，M4）
├─ tools/                       # 四闸门移植版（§A2.6）：preflight/impact/gate/capability_map
│                               #   + normalize_eol / check_style_drift / a11y-check / release_version
├─ docs/                        # 本文件 + 新校接入指南 + ADR + profile 规范文档
└─ mobile-recipe/               # 不搬代码，只写 Capacitor 打包配方文档（品牌/签名留在各校自己）
```

### A1.2 技术选型（与上理线同构，不引入新栈）

| 项 | 选择 | 理由 |
|---|---|---|
| 包管理 | npm workspaces | 零新工具；上理线同款 |
| TS 测试 | `node --import <alias-hook> --test` | 上理线验证过的零依赖纪律，禁 tsx/ts-node |
| Python | venv + fastapi/uvicorn/jieba/fastembed/bge-small-zh-v1.5 | 与上理线一致，模型缓存路径机制照搬 |
| 前端 | Vite + React + TS + Tailwind | playground 用；令牌体系进 `@campuskit/ui` 的 tailwind preset |
| 存储 | SQLite + FTS5 + 向量表 | 单文件自托管是框架卖点 |
| 门禁 | tools/ 四闸门 + GitHub Actions | 上理线最独特的工程资产，整体移植 |
| 许可证 | Apache-2.0 | 拾光/上课先例，利于推广；治理承诺见 A6 |

---

## A2. 资产抽取清单（从 `_work_dev` → campuskit，逐目录对照）

> 抽取源基准：`beta-v2@抽取当日 HEAD`（建仓当天登记 commit 号进上理线《借出登记表》，见姊妹篇 B1）。
> 抽取方式一律**复制后改造**，源仓不动。下表"改造点"是抽取时必须做的最小改动。

### A2.1 排程引擎 `src/lib/planner/`（37 文件）→ `packages/engine/`

| 步骤 | 内容 | 验收 |
|---|---|---|
| E1 依赖清点 | 建仓第一件事：`grep -h "from '@/" src/lib/planner/*.ts \| sort -u` 列出全部仓内依赖。预期三类：`@/types`（契约类型）、`@/lib/date` 等少量工具、`@/lib/api`（仅 `transfer.ts`） | 清单落 docs，无遗漏 |
| E2 契约自持 | 把引擎用到的契约类型（`LockLevel`/`TimeBlock`/`WeekPlan`/`PlanIssue`/`PlanIssueCode`/`PhasePolicy`/`Schedule`/`Course`/`PersonaProfile`/`ScenarioFields`/`BlockKind`/`CampusId`/`DayOfWeek` 等，以 E1 清单为准）复制进 `packages/engine/core/types.ts`，包内 re-export。**注意：这是副本不是真源**——真源仍在上理线 `src/types.ts`，两边语义漂移靠 §A8 同步协议管理 | `tsc` 0 错；包内 import 零 `@/` 残留 |
| E3 网络解耦 | `transfer.ts` 对 `@/lib/api` 的依赖按上理线 spec §4.5.2 既定方案处理：`planWeek` 已支持注入 `TransferProvider` 桩——把对 api 的 import 收敛到包的可选入口（或直接以注入为唯一方式，api 版留上理线） | Node 单测可加载全部模块 |
| E4 测试与 golden 迁移 | 用 `node scripts/capability_map.mjs` + `grep -l "lib/planner" tests/*.test.ts` 圈定引擎守护测试集（预计 60+ 文件：construct/solver/objective/improve/churn/ripple/fatigue/places*/focus-days/p2-*/wp-*/property/…），连同 `tests/golden/`、`golden-lib`、`register.mjs` 钩子整体迁入 `packages/engine/tests/` | `npm test` 全绿；**golden 与源仓逐字节一致**（diff 校验留痕） |
| E5 包化 | `package.json`（name `@campuskit/engine`、exports、types）、README、`npm pack` 演练；**可发布但暂不发布**（发布是 M5 的事） | `npm pack` 成功且 tarball 能被 demo 项目安装运行 |

**关键有利条件**（写进引擎包 README）：引擎的 `PlanRequest` 本来就是注入式设计——`places`（地点表）、`transfer`（路网 provider）、`weights`、`config`、`persona` 全是可选注入点，缺省值只是内置兜底。**框架化不需要改引擎算法，只需要在调用侧注入 Campus Profile**。这是 M2 成本低的根本原因。

### A2.2 评测框架 `evals/` → `evals/`

- 迁移：`run.py`/`judge.py`/`calibrate.py`/`report.py`/`gen_silver.py`/`curate.py` + `engine/`/`golden/`/`judges/`/`tasks/` 结构。
- 迁移：`scripts/eval_plan_understand.py`（100 条理解金标评测器）与 `evals/method/`（方法库金标评测）。
- 改造点：路径改相对包根；`evals/golden/*.jsonl` 按"只增不改"纪律原样带走（**数据内容属通用评测资产，可公开**——这本身是开源的大卖点）。
- 验收：对 demo-school 语料跑通一次 `eval:gate`（分数可以低，链路必须绿）。

### A2.3 数据流水线 + 知识库构建链 → `pipeline/` + `kb/`

| 源（_work_dev） | 去向 | 改造点 |
|---|---|---|
| `scripts/collector.py` / `collect_keywords.py` / `collect_web.py` / `fetch_wx_fixed.py` / `ingest_wx.py` | `pipeline/` | 采集源从硬编码关键词/栏目改为读 `sources.json`（每源：type=web\|wechat、url 模式、栏目名、更新频率、许可模式） |
| `scripts/fulltext.py` / `backfill_web.py` / `clean_text.py` / `dedup_db.py` | `pipeline/` | 泛化加 `--campus` 参数；**新增 token 哨兵**（采集前探针，失效即中止并报告，不产半截数据） |
| `scripts/rag.py` | `pipeline/rag.py` | 库名参数化（`articles_{campus}.db`）；fastembed 缓存机制原样 |
| `scripts/fetch_osm.py` / `build_graph.py` / `merge_osm_pois.py` / `build_bike_minutes.py` / `build_relative_bearing.py` / `build_pinyin_index.py` / `osm_route.py` / `audit_network_quality.py` / `audit_spatial_quality.py` / `overlap_accuracy.py` | `pipeline/spatial/` | 全部改 `--bbox/--campus` 参数化（这些脚本本来就是数据驱动的，改造是参数化不是重写） |
| `server/campus_network.py` / `campus_vocab.py` | `server/`（随骨架） | 路网与词表从 Campus Profile 加载 |
| `scripts/build_method_kb.py` / `method_kb_data*.py` / `compile_method_params.py` / `build_health_kb.py` / `health_kb_data.py` / `compile_health_params.py` / `method_rag.py` / `health_rag.py` / `hhem_gate.py` | `kb/method` `kb/health` | **构建链与 schema 先行**；`method_kb.db`/`health_kb.db` 的**内容**随 M5 发布前合规过审后进入（引文与出处复核），此前只随私有分支/内部分发 |
| `scripts/analyze_coverage.py` / `gate_data.py` / `significance.py` / `probe_contamination.py` | `pipeline/quality/` | 直迁 |
| `scripts/timetable_parser`（server/ 下） | `server/timetable_parser/` | 直迁（PDF 解析天然跨校） |

**合规缺省**（写进 pipeline README 与接入指南）：公众号源缺省**只存标题+摘要+原文链接+关键事实字段**，不落全文（上理线的全文库是历史存量 + 内部使用口径；框架对外形态从摘要模式起步，见调研报告 §3.8 版权判例）。

### A2.4 后端骨架 `server/` → `server/`

| 源文件 | 去向 | 改造点 |
|---|---|---|
| `app.py` | `server/app.py` | 启动时加载 Campus Profile：CORS/品牌字段/默认校历/Prompt 人格片段全部出自档案；**不带任何上理字面量** |
| `account.py` / `sync.py` / `memory.py` | 直迁 | 无校特定内容（账号/同步/记忆机制通用）；随迁安全批成果（限速/属主闸/413/WAL——这些是上理线 10-11 维护批修好的，抽的就是修好的版本） |
| `plan_dialog.py` | 直迁+模板化 | understand 端点逻辑通用；提示词中的校名/昵称/口癖改 `{school}`/`{persona.nickname}` 占位符，由 persona.md 注入 |
| `envconfig.py` / `websearch.py` / `agent.py` / `direct.py` / `plan_review.py` | 直迁 | — |
| `server/.env` | **不抽** | 新仓自己配 `.env.example` |
| Python 测试 `scripts/test_*.py`（auth/memory/sync/ics/privacy/identity 等 16 份） | `server/tests/` | 直迁，pytest/node 口径不变 |

验收：`uvicorn server/app:app` 以 demo-school 档案启动，`/api/health` OK、`/api/search` 用 demo 语料可查、`/api/plan/understand` 通用句可用。

### A2.5 组件库与前端基建 → `packages/ui/`

- `src/components/ui/`（19 组件 + toastModel）+ `tests/ui-cmp-*.test.ts`（16 份）整体迁入；Tailwind 令牌（`tailwind.config.js` 的色彩/圆角/动效四档）抽成 `@campuskit/ui/tailwind-preset`。
- `src/components/AppErrorBoundary.tsx` + `errorCopy.ts` + `globalErrors`（`src/lib/globalErrors.ts`）随迁。
- **不抽**：`LightpathMark/Logo120`（品牌）、`src/features/**`（应用层留下理线；playground 用最小自写壳）。
- `src/lib/` 中通用工具的处置：`date.ts`/`storage.ts` 模式/`telemetry.ts`（本机零上报）/`behaviorLog.ts` → 视 E1 依赖清单按需以**复制**方式带入相应包（真源留上理线，同 §A8 漂移管理）。
- **不抽**：`api.ts`/`apiBase.ts`（含上理 IP 兜底）、`identity.ts`、`lbao.ts`、`persona.ts`、`parseSchedule.ts`、`today.ts`——全是应用/校特定层。

### A2.6 工程纪律（四闸门）→ `tools/`

- `preflight.mjs` / `impact.mjs` / `gate_overnight.mjs` / `capability_map.mjs` + `check_style_drift.py` / `a11y-check.mjs` / `normalize_eol.py` / `release_version.mjs` + `tests/register.mjs`/`alias-hook.mjs` 模式 + `.github/workflows` + `stryker.config.json` 思路。
- 改造点：gate 基线从零起（新仓自己的动态基线）；preflight 的远端基线逻辑简化（新仓远端即主仓）。
- **这是框架的隐形卖点**：别的学生项目给一个 README，campuskit 给一套带机器门禁的贡献纪律（对社区 PR 质量是降维打击）。

### A2.7 明确不抽清单（留在上理线，一个字节不过来）

| 资产 | 原因 |
|---|---|
| `data/usst_articles.db(+json)`、`data/osm/`、`campus_map.json`、`campus_vocab.json`、`access_policy.json`、`query_expand.json` | 上理数据资产，涉版权与侦察成本，且违反原则 3 |
| `data/libao_account.db` / `libao_memory.db` / `lightpath.db` | 真实用户数据，绝不复制 |
| `src/features/**`（含 libao 对话、persona 问卷、week 视图、mobile） | 应用层 = 上理产品本体；框架只到组件/引擎/协议层 |
| `mobile/`（Android 壳、签名、图标） | 品牌与签名属各校自己；框架只写打包配方文档 |
| 梨宝人格文案、"宝子/咱上理"口癖、光溯/Lightpath 品牌、`constants/term.ts` 上理校历 | 校特定 |
| `_work_dev` 根目录全部 `_*` 临时产物、`dist*`、服务器配置 | 无关 |
| `method_kb.db`/`health_kb.db` 的**内容**（暂缓而非永不） | M5 前做引文合规过审；构建链与 schema 先行 |

---

## A3. Campus Profile 规范 v0（`packages/profile`）

### A3.1 档案结构（目录即规范）

```
campuses/<school-id>/
├─ profile.json          # 元信息：id/名称/校区列表/经纬度 bbox/时区/品牌色/联系方式
├─ places.json           # 地点表：Place[]（id/name/campus/hours/category/tags/func/emoji）
│                        #   ——直接对齐引擎 PlanRequest.places 的注入类型
├─ network/              # 路网：osm 提取产物 + 预计算的步行分钟矩阵（pipeline/spatial 生成）
├─ term.json             # 学期结构：termStart/totalWeeks/节次表/校历事件（假期/考试周）
├─ courses/              # 课表导入产物（PDF 解析或 WakeUp JSON/ICS 换算后的统一格式）
├─ sources.json          # 资讯源清单（pipeline 消费）
├─ articles/             # 采集产物 DB（articles_<school>.db，gitignore，可重建）
├─ persona.md            # 人格模板：{school}/{nickname}/{口癖示例} 占位符 + 分寸红线声明
├─ vocab.json            # 校园黑话/同义词表（campus_vocab 模式）
└─ README.md             # 该校接入记录：谁、何时、各步耗时（试点计时就记在这里）
```

### A3.2 校验器 DoD

- 每个	json 文件有对应 JSON Schema（`schema/*.schema.json`），`@campuskit/profile` 提供 `validateProfile(dir): Report`（错误逐字段定位）。
- 加载器 `loadProfile(dir): CampusProfile` 供 server 与 playground 共用。
- 单测：demo-school 过检；故意破坏每类字段各一例必红（反向验证纪律照搬）。

### A3.3 demo-school（虚构演示校）

- 1 个虚构校（如"临港示范大学"，2 校区），30 地点、5×7 节次表、16 周学期、**30 篇手写演示文章**（覆盖教务/奖助/生活场景，纯虚构）、人格模板填演示值。
- 作用：CI 数据（所有端到端测试跑它）、开源 README 的演示截图、接入指南的对照样本。
- 红线：demo 文章内容不得改写自上理真实通知（防数据间接泄漏）。

---

## A4. 里程碑（1 人 + AI 协作，按每周 8-10 小时估）

| 里程碑 | 内容 | DoD（验收） | 估时 | 日历（决赛 2026-10-31 结束） |
|---|---|---|---|---|
| **M0 建仓与纪律** | 建仓（§A10 命令级步骤）；tools 四闸门移植跑通；AGENTS.md/LICENSE/CI/EOL 就位；抽取源 commit 登记 | `tools/gate.mjs` 全绿（空仓基线）；CI 首 绿；源仓零改动 | 0.5 周 | 2026-11 第 1 周 |
| **M1 引擎包** | §A2.1 E1-E5 全部 | golden 与源仓逐字节一致；engine 测试全绿（预计 700+ 断言）；`npm pack` 可用 | 1.5 周 | 11 月中 |
| **M2 Profile 规范** | §A3 全部（schema+校验器+demo-school） | demo-school 过检；**用 demo places 注入引擎排一周计划成功**（引擎零改动） | 1 周 | 11 月底 |
| **M3 服务骨架 + 流水线** | §A2.3/A2.4：server 读档案启动；pipeline 以 demo sources 跑通采集→清洗→建索引（哪怕 30 条） | demo-school 端到端：网页问一个 Demo 问题出带来源答案 + 排程出块 | 2 周 | 12 月 |
| **M4 Playground + 第二校试点** | 最小前端（登录/问答/周视图，用 `@campuskit/ui`）；《新校接入指南》v1；找一所外校按指南实测并计时 | **试点报告**（§A5 计时表）；go/no-go 判定落 docs | 2 周 | 2027-01（4C 备赛让路可拖到 02 月初） |
| **M5 开源发布** | §A6 检查清单全过；README 中英/文档站/接入指南/issue 模板/贡献指南 | 公开仓库 + demo CI 绿 + 第二校接入者本人可复现 | 1-2 周 | 2027-02 |

> 每个里程碑独立成批，批内沿用上理线的收尾纪律：typecheck 0 / 测试只增不减 / 变异反向验证 / BLOCKERS 记录制 / 每批一 commit。**M1-M3 期间上理线照常按其自己的窗口推进，互不等待。**

---

## A5. 第二校试点手册（M4 的核心交付，go/no-go 实验）

| 步 | 做什么 | 工具 | 目标耗时 |
|---|---|---|---|
| P1 课表 | 找到该校教务课表 PDF（或 WakeUp JSON/ICS）；跑 `timetable_parser` 转统一格式；节次表对齐 | server/timetable_parser | ≤2h |
| P2 地点 | OSM 提取校园 bbox → `pipeline/spatial` 建路网；手工/半自动标 20-30 个 POI 进 places.json | pipeline/spatial | ≤3h |
| P3 资讯 | 该校官网 2-3 个公开栏目配进 sources.json → 跑采集+清洗+建索引（目标 100-300 条）；过一遍审核队列 | pipeline + quality | ≤3h |
| P4 校历与人格 | term.json 填该校学期结构；persona.md 填校名/昵称（可直接沿用模板缺省人格） | 手填 | ≤1h |
| P5 联调 | server 以该校档案启动 → playground 问答 + 排程演示；错误修一轮 | — | ≤1h |

**判定**（写进试点 README.md 的计时表）：
- 总耗时 **≤8h（1 人日）** → GO：进入 M5 开源，"框架"命题成立；
- **8-24h** → 有条件 GO：把最大耗时项写进改进清单，M5 照发但 README 如实标注接入成本；
- **>24h** → NO-GO：收缩为"开源引擎 + 评测包"（`@campuskit/engine`/`evals` 独立发布），全框架形态放弃，结论同样写进上理线决策记录。
> 无论结果如何，试点报告都是 2027 大挑/大创赛材料里的**真实实验数据**。

---

## A6. 开源发布检查清单（M5 gate，全部硬项）

1. **无密钥**：全仓 gitleaks 扫描零告警；`.env` 不在历史任何位置（新仓从零 init，天然满足——仍要扫）。
2. **无上理数据**：全仓 grep `上理|usst|USST|军工路|复兴岛|梨宝`（白名单：README 的"来自上海理工大学参考实现"致谢句、迁移来源注记）零意外命中；demo 文章人工复核非改写。
3. **KB 内容合规**：method/health 库内容逐条过引文与出处复核（evidence tier 机制现成），或 v1 只开源构建链不开内容。
4. **软著联动**：若上理线软著最终以**学校名义**登记（待教务处答复），则 engine 同源代码的 Apache-2.0 发布需学校书面同意；个人名义则无碍。**此项未决前 M5 不公开**。
5. **许可证与治理承诺**：Apache-2.0 + README 首屏三承诺（无广告 / 数据本地优先 / 即使变卦社区可 fork）+ 贡献指南（适配脚本 PR 流程，抄拾光模式）。
6. **可复现**：接入指南由第二校接入者（非作者本人）按文档盲走一遍通过。
7. **文档站**：VitePress（或等价）最小站：首页/5 分钟试跑/接入指南/profile 规范/引擎 API。

---

## A7. campuskit 工程纪律（AGENTS.md 要点，建仓时落地）

- 继承上理线四闸门工作流：`node tools/preflight.mjs` → 干活 → `node tools/impact.mjs` → `node tools/gate.mjs`；测试只增不减；golden 只增不改；新测试带反向验证。
- 契约层：`packages/*/core/types.ts`（契约副本）与 `packages/profile/schema` 视同上理线 `types.ts`——结构性改动 commit 显式申报。
- 无人值守协议精简版：夜间只允许 `packages/ apps/ server/ pipeline/ kb/ docs/` 新增与改造；禁止 push、禁止改 LICENSE/契约副本；拿不准写 BLOCKERS.md（新仓自己的）。
- 行尾全仓 LF + `.gitattributes * -text`；从 Windows 复制的文件进门先跑 `normalize_eol`。
- **上理线隔离条款写进 AGENTS.md 首屏**：本仓任何批次不得改动 `_work_dev`；引擎算法改动回上理线（§A8）。

---

## A8. 引擎同步协议（防分叉的核心条款）

1. **真源与快照**：`src/lib/planner` 真源在上理线。campuskit 的 engine 包以**上理线 release tag** 为快照源（如上理线打 `engine-snapshot-2026-11-15`）。
2. **同步节奏**：上理线每次引擎合入批（有 golden 重拍或行为变化）→ 打快照 tag → campuskit 执行"快照合并"（diff 引擎目录 + 重放包化补丁 + golden 对照）。
3. **反向通道**：campuskit 侧发现/需要的算法改进（含试点校反馈的）→ 在 campuskit 开 issue 挂"upstream"标签 → 上理线按其纪律实现 → 下个快照带回。campuskit 直接改算法 = 违规。
4. **漂移检测**：campuskit CI 加一个每周 job：diff 当前 engine 与最近快照 tag 的引擎目录，差异超阈值（包化白名单文件除外）即红灯。
5. **退出条款**：若上理线停止引擎演进（如毕业后转维护态），双方书面确认"真源移交 campuskit"，从此 campuskit 为真源——这一条写死，避免自然分叉无人裁决。

---

## A9. 风险与对策

| # | 风险 | 对策 |
|---|---|---|
| R1 | 抽取发现引擎隐性耦合（E1 清单比预期长） | M1 首日只做 E1+E2，先跑通最小迁移再批量搬；`planWeek` 的注入缝（spec §4.5.2）已是既定解 |
| R2 | 引擎两线分叉 | §A8 全套（快照 tag / 漂移检测 / 退出条款） |
| R3 | 第二校拿不到数据/版权受限 | 摘要+链接缺省模式；官网公开栏目优先；试点校选"官网信息丰富的学校"（数据条件本身就是选点标准） |
| R4 | 人力被上理线比赛挤占 | A4 日历已把 M4/M5 排在 4C 备赛后；里程碑允许整体右移，不允许跳过 DoD |
| R5 | 开源被软著名义问题卡住 | A6.4 已设为 M5 硬前置；上理线窗口 A 第 2 项就是去问教务处 |
| R6 | 新仓维护承诺过重 | README 明示"参考实现 + 社区共建，非商业服务"；承诺范围只到 demo-school 与文档 |

---

## A10. 第一周开工清单（M0，命令级）

```
day 1  ①GitHub 新建私有空仓 campuskit（M5 前保持 private）
       ② git init / npm init -w / 复制 .gitattributes(* -text) / LICENSE(Apache-2.0)
       ③ mkdir tools && 从 _work_dev 复制 preflight/impact/gate_overnight/capability_map/
          normalize_eol/check_style_drift/a11y-check（改名 gate.mjs 等）→ 按新仓路径调 import
       ④ 抽取源登记：在 _work_dev docs/借出登记表 写一行
          （源=beta-v2@<当日HEAD>，抽出物=tools/8 件），登记动作本身不改代码
day 2  ⑤ AGENTS.md（按 §A7 要点）+ README 占位 + .github/workflows/ci.yml
          （typecheck + node --test + capability_map --check）
       ⑥ tools/gate.mjs 空仓基线全绿 → 首个 commit "chore: bootstrap campuskit with gates"
day 3  ⑦ M1 E1：跑依赖清点命令，清单落 docs/engine-deps.md
       ⑧ E2 起步：建 packages/engine/core/types.ts，先迁 model.ts + objective.ts 两个文件
          打样（含两份测试），验证"包内零 @/ 依赖"可行 → commit 打样记录
```

> 决赛前（2026-10-24~31）本仓**零动作**——这是原则 4；上面 day1 从 11 月第一周起算。
