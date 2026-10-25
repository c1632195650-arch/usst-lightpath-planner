# 剩余代码项 · 全量工作单集（2026-10-25）

> 范围：**技术/代码上所有未做项**（行政与材料类——决赛三件套、软著提交、校方洽谈、ICP 备案——见上一轮口头清单，不在本文）。
> 生效链：章程（`execution-charter-2026-10-24.md`）→ 本工作单集 → 各批 kickoff 按 §8 模板。逐批界限表未重抄的，以各工作单"改动清单"行为准（表外禁触）。
> 契约申报点汇总：**C1** `SyncState` schemaVer=3 + `deadlines?`（W3）；**C2** `articles.effective_to` 迁移（W7，L2）；**C3** campuskit 引擎契约副本 `CampusId` 放宽（K2，快照协议内变更）。三处均需 CY 显式拍板后才开工。

---

## 0. 总览与排期建议

| 批 | 内容 | 线 | 估时 | 前置 | 契约 |
|---|---|---|---|---|---|
| W1 | 56 篇公众号慢跑回填（含止损门） | 上理 | 1d+6天cron | 无 | 无 |
| W2 | 单页采集模式 single_page（两线通用） | 上理+框架 | 1.5d | 无 | 无 |
| W3 | F5 两接线：deadlines[] 同步 + D-3/D-1 通知 | 上理 | 3d | 无（软著材料别撞期） | **C1** |
| W4 | pins 防三犯（向量重建路径刷指纹） | 上理 | 0.5d | 无 | 无 |
| W5 | openapi 快照补 405/422（ST204 销项） | 上理 | 0.5d | 无 | 快照只增 |
| W6 | 玄学问句检索调优（否定金标+阈值） | 上理 | 1d | 无 | evals 只增 |
| W7 | effective_to 时效体系（迁移+降权+角标） | 上理 | 1.5d | **C2 拍板** | DB 迁移 |
| W8 | 落地仪表盘 v1（码上式指标） | 上理 | 1d | 无 | 无 |
| W9 | 组件库接入批（13 处手写表单收敛） | 上理 | 1.5d | 无 | 无 |
| W10 | 安全工程尾部四件 | 上理 | 2d | 无 | 无 |
| W11 | 半代办「盯一件事」（H1 落地） | 上理 | 2d | W3 | 无 |
| W12 | prefLearn v1.5（两条全局权重规则） | 上理 | 0.5d | F4 已毕 | 无 |
| K1 | campuskit M2b 收尾（install+测试首跑+CI 首绿+登记表） | 框架 | 0.5d | 无 | 无 |
| K2 | M2c CampusId Profile 化 | 框架 | 2d | K1 | **C3** |
| K3 | M3 服务骨架 profile 驱动 + pipeline demo 跑通 | 框架 | 3d | K2 | 无 |
| K4 | M4 第二校试点工具包 + 实跑计时 | 框架 | 2d+人工窗 | K3 | 无 |
| K5 | M5 开源检查清单执行 | 框架 | 1d | 软著名义答复 | 无 |
| K6 | MCP server 三工具（mcp/） | 框架 | 1.5d | K3 | 无 |
| K7 | 评测基准包发布（脱敏+技术报告） | 框架 | 1d | 无 | 无 |

**排期建议**：决赛周（10-25→10-31）代码零开工（唯一例外 W1 的 cron 是机器自己跑）；决赛后第一周 = W4/W5/W6/W9（全部零契约小批）+ W1 收尾 + K1；第二周 = W3（C1 拍板后）+ W2 + K2；之后 W7-W12 与 K3-K7 按窗口 C 排。**并行会话分配**：上理线与 campuskit 线零文件冲突，可两会话并行；W3 与 W11 必须串行（同一契约族）。

---

## 1. 上理线工作单

### W1 · 56 篇公众号慢跑回填（止损门版）

**目标**：6 天内分批补齐 56 篇缺全文文章的 `full_text`；首批成功率 <60% 即自动停，转人工搬运通道。
**改动清单**：新增 `scripts/fulltext_backfill_slow.py`（编排器）；服务器 crontab 追加一行；`_logs/backfill_run.jsonl`（产物）。
**步骤**：① 脚本入参 `--batch 10 --min-success 0.6`：从库里选 `is_dup=0 AND (full_text IS NULL OR length(full_text)<50)` 的公众号文章按 pub_time 降序取 10 篇；② 每篇前跑既有 token 哨兵（复用 crawl_cron 的探测函数），失效即本批中止；③ 逐篇调 `fulltext.py` 的抓取函数，记录 `{id,title,ok,reason}`；④ 批末算成功率：≥60% → 写下一批计划并退出 0；<60% → 写 `_logs/backfill_alert.jsonl` 告警并停止后续（不自动重试——设计缺口定性不变，慢跑只是低成本试探）；⑤ 成功批次后跑 `rag.py build`（chunks 重建 + pins 刷新，W4 修好前手动核一次 pins）。⑥ crontab：`47 6 * * *`（避开 5:17/17:17 两趟采集）。
**验收**：6 天后覆盖率报告（full_text 非空 88%→目标 ≥96%）；公网 `/api/search` 实测命中一篇原缺口文章的正文片段；`data_pins` 与 DB 一致。**止损演练**：mock 哨兵失败路径必产 alert 且零写入（pytest 一条）。
**估时**：1 天（脚本+cron）+ 6 天机器自跑 + 0.5 天收尾报告。

### W2 · 单页采集模式（single_page，两线通用）

**目标**：信息化办 c68xx 系列静态服务指南单页（不在任何列表页内）可入库；同一模式即 campuskit pipeline 的通用源类型。
**改动清单**：上理侧 `scripts/crawl_cron.py`（增 single_page 源处理）+ 新增 `data/sources_single.json`（单页清单：`[{id,url,keyword,title_hint}]`，首版 25 条 c68xx 页）；框架侧 `campuskit/pipeline/sources/` schema 增 `type:"single_page"`（K3 时正式并入，本批先在上理侧定型语义）。
**步骤**：① sources_single.json 人工整理 25 个 URL（信息化办官网服务指南栏目逐页点开取址——一次性人工 0.5 天）；② crawl_cron 读单页清单：`parse_page(url)` 复用 → 按 source_url 去重入 `pending_review.jsonl`（keyword 填"信息化办公室"）；③ 审核仪式照旧（approve 才入库）；④ 域覆盖复评脚本 `analyze_coverage.py` 跑一次对比。
**验收**：25 页全部入队；approve 后"校园卡怎么办/VPN 怎么连"类问句公网检索命中；`data_pins` 对齐。
**估时**：1.5 天（含人工整理 URL）。

### W3 · F5 两接线：deadlines[] 同步 + D-3/D-1 通知（契约 C1）

**目标**：网页端重要日（deadlineStore）经云同步到达手机，晨报与通知覆盖"后天截止的物理实验报告"这类场景——F5 设计里的 v2 部分。
**契约设计（C1 申报口径）**：`SyncState` schemaVer 2→3，增 `deadlines?: DeadlineLite[]`；`DeadlineLite = { id; title; dueAt(ISO 日期); source:'user'|'event'; updatedAt?; archived? }`。合并语义**抄 todos[] 现成模式**：`server/sync.py` 的 `SCHEMA_VER=3` + `MERGED_ARRAY_KEYS` 追加 `"deadlines"`（by-id LWW 并集，删除=archived）+ `PRESERVE_KEYS` 同步追加；`MIN_SCHEMA_VER` 维持 1（v2 老 APK 不带 deadlines 上传→服务端保留；v3 响应老 APK 忽略未知字段，天然兼容——与 schemaVer 2 升级时的既有先例同构）。
**改动清单**：
| 文件 | 动作 |
|---|---|
| `server/sync.py` | SCHEMA_VER=3、两个 KEYS 元组各加一项、兼容测试 |
| `src/features/mobile/lib/memoTypes.ts` | 增 `DeadlineLite`（独立文件内新类型，types.ts 零改动——沿 schemaVer2 手法） |
| `src/features/mobile/lib/memoStore.ts` | deadlines 的并集/归属章（抄 todos 模式） |
| `src/features/cloudSync/`（网页端推送侧） | `loadUserDeadlines()` 序列化为 DeadlineLite 随 PUT 上行；`UserDeadline→DeadlineLite` 映射函数（`deadlineStore.ts` 旁新增导出，**calendar/ 目录只增不改**） |
| `src/features/mobile/lib/morningBrief.ts` | warnings 数据源扩：`upcomingDeadlines`（本地已有）之外吃同步来的 deadlines（72h 内且未 archived） |
| `src/features/mobile/lib/notifyBridge.ts` | `planBriefNotifications` 扩 D-3/D-1 两条/deadline（id=stableHash('ddl'+id+d)，幂等覆盖式重排既有机制不动） |
| `tests/syncContract.test.ts` + `server/tests/test_sync_v3.py` | 兼容矩阵：v2 载荷上行不清 deadlines、v3 往返、archived 并集、双端并发 LWW |
**步骤**：① 服务端 v3 + Python 测试先行（含 v2 兼容）→ ② memoTypes/Store 移动端 → ③ 网页端序列化推送 → ④ 晨报/通知消费 → ⑤ 真机联调（网页建 deadline→手机 2s 内同步→次日晨报含 ⚠）。
**验收**：兼容矩阵全绿 + RV 两组（摘 MERGED 清理→恰红；摘 D-3 排程→恰红）；真机剧本一条留痕。
**估时**：3 天。**Kickoff 前置**：C1 契约申报待 CY 拍板（建议随软著问询一并，无紧急性）。

### W4 · pins 防三犯

**事实**：同一根因两次（手动/向量侧重建不刷 pins——昨天 1937、今天又 1937）。
**改动清单**：`scripts/rag.py` 抽 `refresh_pins(db_path)` 公共函数（数三表→写 pins，幂等）；两个调用点：全量 build 尾部（已有 bc2096e 逻辑收编进函数）+ **向量块写入路径尾部**（chunks 重建函数末尾同样调用）。新增 `scripts/test_refresh_pins.py`：临时库造数→跑向量重建→断言 pins 与三表真值一致（RV：摘调用→恰红）。
**验收**：真库演练一次向量重建后 pins 自动对齐；pytest 绿。
**估时**：0.5 天。

### W5 · openapi 快照补 405/422（ST204 销项）

**事实**：schemathesis 193 例唯一发现 = ST204×10（未声明方法回 405，快照未声明）。
**改动清单**：新增 `scripts/gen_openapi_snapshot.py`：拉活后端 `/openapi.json`（FastAPI 自带）→ 后处理为每个 path 注入 `405`（与 `422` 若缺）响应声明 → 写 `data/openapi_snapshot.json`（快照**只增**纪律不变：不删既有声明）。此后快照从"手工维护"转"生成+入库"。
**验收**：`uvx schemathesis run ... --checks all` 0 failures；`npm run contract:fuzz` 绿；快照 diff 只见新增响应段。
**估时**：0.5 天。

### W6 · 玄学问句检索调优

**事实**：campus 空间检索对玄学类问句模糊命中（本次被相关性门兜住降级）；`campus.py:802 has_space_intent` 词表过宽。
**改动清单**：① `evals/golden/` 只增否定金标 ~15 条（"我最近水逆怎么办""考试拜锦鲤有用吗"含场馆/地名字样的闲聊句，期望=不命中空间路由）；② `campus.py` 词表收紧：空间意图词从"单字命中"改"短语级命中+排除表"（如"图书馆"在"像图书馆一样安静"的比喻式上下文降权——实现从简：否定前缀窗口检查）；③ 阈值若仍宽，`space_context` 候选数下限收紧。④ 跑 `eval_relevance_gate.py` 全量回归。
**验收**：否定金标 15/15 过门 + 存量空间类金标零回归 + RV（摘排除表→否定金标恰红）。
**估时**：1 天。

### W7 · effective_to 时效体系（L2，C2 拍板后）

**改动清单**：① `scripts/migrate_effective_to.py`（`ALTER TABLE articles ADD COLUMN effective_to TEXT`——可空、幂等、迁移前自动 `VACUUM INTO` 备份）；② `scripts/rag.py` 检索：`effective_to < today` 的条目分数 ×0.6 且返回带 `stale:true`；③ `server/app.py` confidence：含 stale 来源 → 降 `inferred`；④ `src/components/SourceChips.tsx` 增"可能已过期"角标（读 stale 字段）；⑤ `review_queue.py` 增 `set-expiry <id> <date>` 子命令（审核时顺手标失效）。
**步骤**：本地库迁移演练（备份→迁移→回滚脚本验证）→ CY 过目 → 服务器执行（同一序列）→ 代码批。
**验收**：造一条已过期条目 → 检索降权可见、confidence 降级、角标呈现；迁移演练留痕。
**估时**：1.5 天 + 拍板窗口。

### W8 · 落地仪表盘 v1（码上式指标）

**目标**：从今天起积累"累计用户/问答数/排程生成量"——所有后续申报材料的硬通货。
**改动清单**：`server/metrics.py`（新增）：三个计数事件埋点（注册成功、/api/chat 完成、排程生成——**只计数与日期，零内容**，与脱敏纪律同向）写 `data/metrics_events.jsonl`；`scripts/metrics_aggregate.py`（cron 每日 04:37）：聚合为 `data/metrics_daily.json`（{date, new_users, chats, plans, cumulative_*}）；查询口径：暂不做线上端点（零新增攻击面），报告由脚本打印/入仓。
**验收**：埋点三处在真实请求后各 +1；聚合脚本幂等重跑；隐私自检（jsonl 内无任何用户内容/ID 明文——只有哈希过的事件类型与计数）。
**估时**：1 天。

### W9 · 组件库接入批（表单收敛）

**事实**：19 个 ui 组件仅 5 处产品引用、13 处手写 `<input|select|textarea>`（BLOCKERS 2026-10-08 实测；F 批新增页面可能又添——批首 re-grep 定名单）。
**步骤**：三小批按页推进（basicinfo → 课表导入/设置 → 移动端 web 表单），每批：替换为 `ui/FormControls` + 44px/外环聚焦/外置 label 形态 → axe 双闸 → 手写清单 -N。**接受前提**（沿 B3-5 登记）：视觉几乎不变，收益是 loading/error/disabled 状态成体系。
**验收**：全仓 `features/**` 手写表单控件降至 0（白名单：mobile 原生 WebView 例外逐一登记）；a11y 0 FAIL。
**估时**：1.5 天。

### W10 · 安全工程尾部四件

| # | 内容 | 文件 | 验收 | 估时 |
|---|---|---|---|---|
| a | ICS 重置 UI 入口（端点 7199247 早已就绪，缺入口） | `src/features/mobile/MeTab.tsx` 增「重置订阅链接」按钮 + 二次确认弹层 | 真机点按→旧 ICS 404、新 ICS 可拉 | 0.5d |
| b | sync LWW 独立 Python 单测（P1-5 残项） | `server/tests/test_sync_lww.py`：未来时间戳钳制、by-id 并集、archived 语义、并发双写 | 全绿 + RV 一组 | 0.5d |
| c | log_event JSONL 统一出口（P1-4 残项） | `server/logutil.py` 新增，替换 app/memory/plan_dialog 散点 print（**只增不改语义**） | grep 服务端 print 降至白名单内 | 0.5d |
| d | `LIBAO_REQUIRE_OWNER=1` 开启 | 运维序列：抓样本验证网页端请求带 X-Identity-Key → 服务器 env 置 1 → restart → 观察旧 APK 401 率 | 一轮观察零异常回执 | 0.5d |

### W11 · 半代办「盯一件事」（H1 上理线落地）

**目标**：用户说"帮我盯着光电杯"→ 梨宝建 deadline（现有 deadlineStore）→ 自动进 W3 同步与 D-3/D-1 提醒 →（可选第二步）在截止前一周的周计划里预留准备块（走既有 `pendingTodos`→引擎通道，零引擎改动）。
**改动清单**：`src/features/libao/` 追问状态机增 `watch` 意图（识别"盯着/提醒我/别让我忘"）→ 落 `addUserDeadline`；回复话术走防腐层新增纯函数；**每步确认**（建前展示卡片、可一键撤销）——L3 边界：替用户记事可以，替用户决定不行。
**验收**：剧本"帮我盯着六级报名"→卡片确认→deadlineStore 落条→晨报含提醒；RV 识别规则一组。
**估时**：2 天。**依赖 W3**（提醒通道）。

### W12 · prefLearn v1.5（两条全局权重规则）

F4 已打通 `weights` 透传；把 F3 登记的两条全局微调接上：高频删除活动块 → `blankDeficit` 微降；高频整周重排 → `churn` 微升。`prefLearn.ts` 增两个规则 + `weekPlanForChat`/`WeekPlanView` 调用侧在用户确认建议后传个性化 weights。golden 不动（weights 只在用户显式采纳后注入，缺省路径零漂移）。估时 0.5 天。

---

## 2. campuskit 线工作单

### K1 · M2b 收尾（首跑绿是硬门槛）

**事实**：tests/ 31 文件 + golden 六份已移植、ci.yml 已建——但**无 install/测试首跑绿的记录**（仓内无 node_modules）。
**步骤**：① `campuskit && npm install`（workspaces）；② 跑 `node --import ./tools/… --test tests/`（或 package.json test script——确认 M2a 是否已配）；③ golden 对照脚本跑一次，与 `_work_dev` golden **逐字节 diff 留痕**（快照零漂移最终证据）；④ push 后看 GitHub Actions 首绿；⑤ 回 `_work_dev`：打 `engine-snapshot-20261024` tag 并在借出登记表补首行（源 commit=今日 HEAD）。
**验收**：测试全绿数字留痕 + CI 首绿截图/状态 + diff 报告。
**估时**：0.5 天。

### K2 · M2c CampusId Profile 化（契约 C3）

**目标**：引擎去掉最后一处学校烙印——`CampusId` 从硬编码枚举变为 profile 注入。
**现状 recon**：上理线 `types.ts` 的 `CampusId` 是具体校区 id 联合类型；campuskit 契约副本（`packages/engine/core/types.ts`）当前原样照抄。
**步骤**：① `packages/profile` schema 增 `campuses: [{id, name, label?}]`（profile.json 承载）；② 引擎契约副本 `CampusId` 放宽为 `string`（**C3 申报**：这是快照副本与上理契约的**已知偏离点**，在借出登记表登记"campuskit 特有放宽"——上理线 types.ts 不动；下次快照同步时此差异属白名单）；③ `places.json` 校验：`campus` 必须引用 `campuses[].id`（校验器报错定位到条目）；④ 引擎 `campusLookup`/`places` 消费注入 campuses（构造侧 resolve 不再依赖内置枚举）；⑤ demo-school 双校区档案跑通 + **上理快照 golden 零漂移**（引擎行为在注入等价数据时不变）。
**验收**：profile 校验器双向用例；golden 零漂移；demo-school 跨校区转场正常。
**估时**：2 天。

### K3 · M3 服务骨架 profile 驱动 + pipeline demo 跑通

**步骤**：① `server/` 启动读 `--campus <dir>`（env `CAMPUS_PROFILE`）：CORS 品牌字段/校历/人格占位符全部出自档案；② `pipeline/` 以 demo-school `sources.json` 跑通 采集→清洗→建索引（30 条演示文）；③ `rag.py` 库名参数化（`articles_{campus}.db`）；④ 端到端：playground 问一个 demo 问题出带来源答案 + 排程出块（demo places 注入）。
**验收**：`uvicorn server/app:app` demo 档案启动全链绿；**全仓 grep `上理|usst|梨宝` 零意外命中**（框架仓纯洁性常检）。
**估时**：3 天（业余）。

### K4 · M4 第二校试点工具包 + 实跑

①《新校接入指南》v1 成文（课表 PDF/WakeUp JSON→places OSM→sources→persona 四步，各带估时与坑位提示）；② 试点计时表模板（campuses/<school>/README.md 固定格式）；③ 找一所外校实跑（≤1 人日=GO / 8-24h=有条件 / >24h=收缩引擎库路线——报告三 §A5 判定不变）。**人工窗为主**，代码量小。估时 2 天+实跑。

### K5 · M5 开源检查清单执行

按方案 A §A6 七项逐条：gitleaks 等价扫描（无 git 环境用自写 secrets 正则扫描器）/ grep 纯洁性 / KB 内容引文复核（或 v1 只开源构建链）/ **软著名义答复为硬前置** / Apache-2.0 与治理承诺定稿 / 第二校接入者盲走 / 文档站最小版。估时 1 天+等待项。

### K6 · MCP server 三工具（`campuskit/mcp/`）

**工具面**：`search_campus_kb(query, campus)→[{title,snippet,url}]`、`plan_week(campus, courses, commits)→WeekPlan 摘要`、`find_place(query, campus)→{name,campus,open_now}`。实现走**零依赖 stdio JSON-RPC**（MCP 最小子集：initialize/tools/list/tools/call），复用 engine 包与 pipeline rag 查询函数——能力本来就长着工具的形状（报告三 H1）。**验收**：任一 MCP 客户端（如支持 MCP 的桌面客户端）实测三工具往返。估时 1.5 天，M5 后。

### K7 · 评测基准包发布（H3 性价比之王）

① `evals/golden/*.jsonl` 脱敏复核（无上理专有信息、无个人数据）；② 基准 README（构造方法/双通道指标/我们自己的成绩=第一个榜）；③ 技术报告初稿（可与大挑学术作品版同源）。**只动文档与 evals 元数据，评测器代码零改动**。估时 1 天。

---

## 3. 依赖图（箭头=前置）

```
W1(自跑)   W4 W5 W6 W9 W10 W12 ──(零依赖，决赛后第一周任意并行)
W3(C1)──→ W11 ──→ (H2 群体智能远期)
W2 ──→ K3(pipeline 消费同一源类型语义)
K1 ──→ K2(C3) ──→ K3 ──→ K4 ──→ K5(还需软著答复) 
K3 ──→ K6
K7(独立)
W7(C2) 独立，拍板窗口到即可插队
```

## 4. 待 CY 拍板三处（开工闸）

1. **C1 schemaVer=3**（W3）：deadlines[] 通道——建议随软著问询一并拍，不急。
2. **C2 effective_to 迁移**（W7）：DB 结构变更，白天窗口执行。
3. **C3 CampusId 放宽**（K2）：campuskit 契约副本对上理契约的**已登记偏离**——需要你认可"副本放宽+登记表白名单"这个口径。
