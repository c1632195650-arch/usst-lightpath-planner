# 光溯 · 综合维护与优化计划（2026-10-11）

> **本文是什么**：一次全项目体检（完整性 / 鲁棒性 / 安全性 / 工程化）+ 同类权威开源方案对标 + 分阶段维护优化路线。
> **最高前提（不可违反）**：**不随意改动当前已有的、已完善的功能。** 全部动作按 §1.3 的变更分级（L0/L1/L2）执行，凡触碰既有行为路径的改动，一律走「守卫先行 + 开关逃生 + 人工评审」。
> **证据来源**：2026-10-11 三路只读审计（后端安全 / 前端与移动端 / 文档与流程），全部结论附 `file:line` 证据（附录 A）；外部对标来自公开检索（附录 B）。

---

## 0. TL;DR —— 一页结论

### 0.1 总评

| 维度 | 评级 | 一句话结论 |
|---|---|---|
| 完整性 | **B+** | 主线（L1 知识问答 → L2 场景引导 → L3 画像/排程）与移动端 M1-M5 均已跑通；缺口集中在数据补全、合规材料、决赛材料与若干「文档说有、实际待核实」项 |
| 鲁棒性 | **B-** | 测试体系（150 个测试文件、90 个反向验证锚点、golden 只增不改）是同规模项目罕见的长板；但**运维面近乎裸奔**：零备份、零日志留存、零 CI、无 ErrorBoundary、出站请求无重试 |
| 安全性 | **C** | 密码学选型与 SQL 参数化等「内功」扎实，但**公网暴露面上有三个高危**：部分端点零鉴权可横向越权（IDOR）、全链明文 HTTP、登录无限速。必须在校园推广前止血 |
| 工程可维护性 | **B+** | 自研四闸门（preflight / impact / gate_overnight / capability_map）+ 契约层纪律非常出色；短板是版本号四处手工同步、lint 只覆盖 a11y、无 CI 兜底 |

### 0.2 本周必须做的七件事（P0 止血，详见 §7.1）

1. 公网 `/api/chat/history`、`/api/memory/*`、`/api/import_pdf` 补属主校验（当前任意人可读任意会话、删改任意用户画像事实）。
2. 公网登录加失败限速（当前可无限撞库，且 PBKDF2 200k 轮被用作 CPU 放大）。
3. ICS token 增加重置端点（当前永久有效且明文进各级访问日志）。
4. sync PUT 加 payload 大小上限（当前可无界写库）。
5. `memory.py` 打开 WAL + busy_timeout（主链路每轮对话都写库，并发下易锁死）。
6. 生产进程日志落盘（当前 `launch_be.py` 把 stdout/stderr 丢进 DEVNULL，出事无法审计）。
7. 处理演示弱口令账号（gigity/123456）+ 确认服务器续费（**2026-10-25 到期**，卡决赛前）。

### 0.3 一个必须上报的存量风险

`BLOCKERS.md` 已登记：git 历史中存在误提交的 `data/lightpath.db`（含本机口令哈希）。在仓库公开化 / 决赛评审前，必须人工 `git filter-repo` 清理（L2，见 §7.2 P2-6）。

---

## 1. 评估范围、方法与总约束

### 1.1 范围与方法

- **代码侧**：`server/`（app/account/sync/memory/plan_dialog/websearch/agent/serve）、`src/`（全部 feature 与 lib）、`mobile/`（Capacitor 壳、AndroidManifest、签名）、`m.html`、根配置（package.json / tsconfig / vite / eslint）。
- **流程侧**：AGENTS.md、BLOCKERS.md、docs/progress-status.md、docs/decisions.md、docs/mobile-line-alignment-2026-10-03.md、docs/campus-promotion-assessment-2026-10-11.md、tests/README.md、capability-map.json、四个门禁脚本。
- **外部对标**：检索 RAG 框架、LLM 网关、FastAPI 工程化、本地优先同步、SQLite 运维、移动安全标准、LLM 应用安全标准等领域的权威开源方案（§6）。
- **基线快照**：分支 `beta-v2`，HEAD `c70840d`，v0.4.9（versionCode 15），与 `origin/beta-v2` 有共同祖先、ahead 2。preflight 通过。

### 1.2 现状基线（引以为傲、必须守住的部分）

**这些是资产，任何优化动作都不许把它们优化掉：**

- 测试与守护：150 个测试文件（engine 113 + ui 37），守护 144 个源文件、11 个功能域、90 个反向验证（RV）锚点、零孤立测试；实测规模 engine 842+ / ui 448+ 用例。
- golden 快照「只增不改」纪律 + 快照器默认拒绝覆盖。
- 类型面干净：`strict: true`，全 src/ 零 `any`、零 `@ts-ignore`。
- SQL 全参数化（server/、serve.py、rag.py 零拼接注入点）；出站请求超时齐全（8s~120s 分级）。
- 认证内功：PBKDF2-HMAC-SHA256 200k 轮 + 随机盐；token 只存 sha256；`secrets.compare_digest` 恒时比较；登录失败同形 401。
- 隐私纪律：账号表只存用户名+口令派生物；聊天/画像入库前双向脱敏（手机号/学号/邮箱→占位符）；telemetry 本地优先零上报；云同步默认关。
- 签名 keystore 严格不入库（`.gitignore:92-93`）。
- ICS 输出按 RFC 5545 转义折行；静态文件服务有 normpath+startswith 防穿越。
- 无人值守纪律：preflight / impact / gate_overnight / capability_map 四闸门 + BLOCKERS 记录制。

### 1.3 变更分级（本计划的执行语义）

> 用户前提「不可随意改动既有功能」落成三条铁律 + 一个分级：

- **铁律 1（只增不删）**：新能力一律以新增文件 / 新增端点 / 新增脚本 / 新增测试落地，不重写、不搬移既有实现。
- **铁律 2（守卫先行）**：动任何被 `capability-map.json` 守护的文件之前，先确认对应守护测试；改完跑 `node scripts/impact.mjs` 反查，零红才收。
- **铁律 3（契约申报）**：`src/types.ts`、`BuildWeekPlanInput/Result`、数据库 schema 的结构性改动，commit message 显式申报并人工评审（AGENTS.md 红线 1/6、§8.4）。

| 分级 | 含义 | 是否可直接做 | 例子 |
|---|---|---|---|
| **L0** | 纯增量：不进入既有执行路径 | ✅ 直接做，照常走门禁 | 新增测试、新增备份脚本、CI workflow、文档 |
| **L1** | 触碰既有路径，但有开关逃生（env/flag），默认行为不变或可通过一行回退 | ⚠️ 做之前登记 BLOCKERS，带反向验证的守护测试 | 登录限速（`LIBAO_RATELIMIT`）、memory 开 WAL |
| **L2** | 行为/契约/部署级变更：用户可见、跨端协同或不可逆 | ❌ 先写 BLOCKERS 交 CY 拍板，白天人工做 | 公网端点强制鉴权（需 APK 配套发版）、TLS+域名、filter-repo 清史 |

---

## 2. 完整性评估（B+）

### 2.1 功能完整性

对照 `docs/project-core.md` 的定位（懂上理的智能决策伙伴：L1 问答 → L2 场景引导 → L3 画像建议/排程，梨宝统一人格，L4 不做）：**主线全部落地且有金标评测与 E2E 守护**；移动端 M1-M5（账号/云同步/ICS/今日页/APK）公网可用。智能边界（梨宝不替用户拍板）在架构上有 `DIALOG_ENABLED`、G 批三开关等逃生门，符合设计。

### 2.2 缺口清单（按出处核实）

| # | 缺口 | 出处 | 影响面 | 计划项 |
|---|---|---|---|---|
| C1 | beta-v2 → dev → main 合并链未完成（beta-v2 已 push 95 commits，但 dev/main 未合） | progress-status §8 / mobile-line §7.6 | 协作与发布口径 | P2-1 |
| C2 | 数据缺口：生活服务（食堂/宿舍/校园卡）、数字校园条目偏少 | progress-status §8 | L1 问答命中率 | P2-2 |
| C3 | 57 篇公众号文章缺全文（搜狗 token 过期） | progress-status §8 | 检索召回 | P2-3 |
| C4 | 决赛材料（申报书/PPT/视频）未启动，10 月底截止 | progress-status §8 | 比赛 | P2-4 |
| C5 | FOCUS DAYS「选择想安排的日期」是死开关（`selectedDays` 无引擎消费方），需在三选一方案里拍板 | BLOCKERS 2026-10-07 | 交互诚实性 | P2-5 |
| C6 | `public/my_schedule.json` 公网 404（演示课表回落） | BLOCKERS | 演示效果 | P1-7 |
| C7 | 组件库 19 个组件仅 5 处引用、13 处手写表单 | BLOCKERS | 维护成本 | P3 决策项 |
| C8 | 公网侧无用户注销/数据导出（serve.py 有，FastAPI 公网侧没有）；无隐私政策/用户协议 | 推广评估 §5 | 合规 | P3-1 |
| C9 | 软著、ICP/App 备案均未办理；裸 IP+HTTP+APK 侧载是推广合规硬伤 | 推广评估 §5 | 推广/上架 | P3-1 |
| C10 | 云同步是单向上推，「手机改→网页实时」的双向同步宣发不成立 | BLOCKERS 04:15 条 | 宣发口径 | P3-3 |
| C11 | 方法库尾巴：QUESTION_BANK 空题库（≥60 道）、contraindications 为空、注释过期（写 42 实际 160） | BLOCKERS 2026-10-06 | L2 引导质量 | P2-7 |

### 2.3 文档与实现的漂移（完整性的一种：文档完整性）

- 门禁基线数字过期：`gate_overnight.mjs:32` 基线 458/321，实测已 842+/448+（BLOCKERS 已登记）。**2026-10-11 复核**：gate 实跑输出已是动态基线（engine ≥874 / ui ≥448），该条目实际已落地，BLOCKERS 对应条可销案。
- `docs/mobile-line-alignment-2026-10-03.md` §5 仍写 v0.4.8/versionCode 14，代码已 0.4.9/15 → 随 P1-8 版本单源一并修。
- `docs/decisions.md` ADR-008 整段重复出现两次（132-176 行）→ 文档微修（L0）。
- progress-status §8 仍写「四处 PARTIALS 待 CY+RAY 确认」，代码侧注记已收官销案 → 文档更新（L0）。
- 推广评估引用的「PDF 导入不可用」已被 10-08 的修复推翻 → 需实测核实后更新（P2-8 走查时顺带）。

### 2.4 体验完整性

- 移动端真机走查（Mate 40E）始终未做（mobile-line §7）→ P2-8。
- 弱网韧性：API 层除 `/api/plan/understand` 外无超时无重试（`src/lib/api.ts:175-199`），弱网可无限挂起 → P1-3。
- 单组件抛错即白屏：两个入口（`src/main.tsx:8`、`src/features/mobile/main.tsx:9`）均裸 `createRoot`，无 ErrorBoundary、无全局错误监听 → P1-2。

---

## 3. 鲁棒性评估（B-）

### 3.1 数据持久化与备份 —— 最大单点

- 三库（`data/libao_account.db`、`data/libao_memory.db`、`data/lightpath.db`）全在单机单盘，**全仓无任何备份逻辑**（grep backup/.bak 零命中）；10-06 的 dist 事故是靠本地备份侥幸恢复的，`/opt/usst/backup` 定期快照仍缺失（BLOCKERS 已登记）。
- 服务器 **2026-10-25 12:17 到期**，恰在决赛前——数据与服务的存续风险叠加。
- 对标方案：Litestream（Apache-2.0）对 SQLite 做 WAL 流式复制到对象存储并支持 PITR，是单机 SQLite 应用的标准灾备答案（§6.5）；最低配也要先有定时 `sqlite3 .backup` 快照脚本 + 异地副本 → **P1-1**。

### 3.2 错误处理与降级

- 出站请求超时齐全（LLM 40s / 天气 12s / agent 45s / 代理 120s 等），websearch 有 Tavily→Bing 降级链——**但全线无重试**，瞬时抖动直接变成用户可见失败 → P1-3（前端超时+幂等重试）。
- 异常处理模式清一色 `except Exception: print + 降级`，不会崩但**故障完全静默**，叠加生产日志进 DEVNULL（`launch_be.py:20-21`），线上排障能力≈0 → P0-6（日志落盘）+ P1-4（轻量错误聚合）。
- `app.py:853` trace 写盘失败被 `except Exception: pass` 吞掉；`plan_dialog.py:497` 把内部异常文本回传客户端（信息泄露 + 排障线索矛盾）→ P0-6 顺带修。

### 3.3 并发与一致性

- `account.py` 与 `serve.py` 开了 WAL+busy_timeout，**`memory.py` 没有**（`memory.py:54-69`），而它是主链路每轮必写 → P0-5。
- 同步用字段级 LWW + todos/goals 按 id 并集，策略自洽；弱点是完全信任客户端 `clientUpdatedAt`（`sync.py:143-186`，单调钳制只防回退不防未来），且 PUT 无 payload 大小上限可无界写库（`sync.py:60-71`）→ P0-4（上限）+ P3-3（时钟钳制与冲突 UI 一并演进）。
- SQLite 单写者 + 单进程 uvicorn（无 workers）目前是自洽的；若未来多 worker，memory 库会先撞锁——P0-5 先把 WAL 补上是廉价保险。

### 3.4 测试体系的缺口（长板上的短板）

| 已有（强） | 缺口 |
|---|---|
| engine 842+ / ui 448+、golden 快照、RV 反向验证、fast-check 性质测试、stryker 变异、a11y 双闸、E2E 77 断言 | ① 公网 FastAPI 端点**零授权/越权类测试**（IDOR 这类问题正是漏网之鱼）；② sync.py LWW 无 Python 单测（e2e 全程 mock 后端，`e2e/mobile-smoke.spec.ts:70-96`）；③ account.py 无单测；④ 后端端到端冒烟依赖人工 `python server/app.py` |

→ **P1-5**：新增「授权与越权」守护测试 + sync LWW 单测（全部 L0 纯新增，`capability_map.mjs --write` 纳入守护）。

### 3.5 发布与回滚

- 好的一面：发版留痕（BLOCKERS 每版一条）、`version.json` 指回旧 APK 即回退、部署前 `dist_pre_*` 备份、双侧 md5 校验、独立 release worktree。
- 风险：版本号**四处人工同步**（`package.json:4`、`server/version.json:2-3`、`mobile/android/app/build.gradle:17-18`、APK 文件名），已出过一次忘同步 → P1-8 单源化（生成器脚本，不改发布流程本身）。
- 无 CI：`.github/` 不存在，质量完全依赖本地自研门禁，「换机器、忘跑、绕跑」都无兜底 → P1-6。

---

## 4. 安全性评估（C）

### 4.1 红旗清单（按严重度排序，全部有 file:line 证据）

| # | 红旗 | 证据 | 触碰 OWASP | 计划项 |
|---|---|---|---|---|
| S1 | **公网多端点零鉴权 + IDOR**：任意人可读任意 `session_id` 的聊天历史；按全局自增 id 确认/拒绝/删除任意用户的记忆事实；重置任意会话画像；无鉴权覆盖全局 `course_records.json` | `app.py:1198-1221`、`app.py:1258-1275`、`app.py:1186-1196`、`app.py:1300-1331` | API Top10 BOLA/BFLA；LLM04（记忆可被投毒，间接污染画像） | **P0-1** |
| S2 | **全链明文 HTTP**：`serve.py` 把 /api/chat 等明文转发 `http://101.35.253.143`；APK 更新走 http 明文（可被中间人替换木马包）；前端兜底 baseURL 也是裸 IP；AndroidManifest `usesCleartextTraffic="true"` + capacitor `cleartext:true`+`allowMixedContent:true` | `serve.py:64`、`server/version.json:3`、`src/lib/apiBase.ts:24`、`mobile/android/.../AndroidManifest.xml:43` | API/传输；MASVS-NETWORK；App 备案前置条件 | **P0-2 / P3-1**（L2 部署级） |
| S3 | **公网登录无限速无锁定**，且 PBKDF2 200k 轮可被当 CPU 放大器打 | `account.py:203-223`（仅本地 serve.py 有锁 `serve.py:99-103`） | API Top10 资源消耗/暴力破解 | **P0-3** |
| S4 | ICS token 永久有效、token 即凭据明文在 URL（进各级日志）、**无重置端点**（作者已自知，注释「重置接口留白天做」至今未做） | `sync.py:355-362`、`sync.py:17`、`account.py:185,200` | 凭据生命周期 | **P0-7** |
| S5 | sync PUT 无 payload 上限 + 信客户端时间戳 | `sync.py:60-71,143-186` | API Top10 无限制资源消耗 | **P0-4** |
| S6 | `memory.py` 无 WAL/busy_timeout（可用性）+ PDF 上传 `await request.body()` 无界（内存 DoS） | `memory.py:54-69`、`app.py:1303` | 韧性/资源 | **P0-5 / P0-4** |
| S7 | 生产进程 stdout/stderr→DEVNULL，零日志留存，出事无法审计入侵 | `launch_be.py:14-22` | 可审计性 | **P0-6** |
| S8 | 登录 token 明文存 localStorage + `allowBackup="true"`（adb backup 可整体提取） | `src/features/mobile/lib/auth.ts:13,50`、`AndroidManifest.xml:34` | MASVS-STORAGE | P1-9 |
| S9 | 真实 DeepSeek key 明文在 `server/.env`（未入 git，`_load_env` 在 app/memory/plan_dialog **三处重复实现**，重构时易泄漏）；异常文本回传客户端 | `server/.env:4`、`app.py:93-104`、`memory.py:38-51`、`plan_dialog.py:41-56`、`plan_dialog.py:497` | 密钥管理；LLM07 | P1-10 |
| S10 | git 历史含误提交的 `data/lightpath.db`（本机口令哈希） | BLOCKERS 已登记 | 存量泄露 | **P2-6**（L2） |
| S11 | 演示弱口令账号 gigity/123456 公网可登录 | 推广评估 §5 | 弱凭据 | **P0-8** |
| S12 | 无 TrustedHost 中间件、CORS 白名单依赖 env 但无默认收紧校验 | `app.py:82-90` | 加固项 | P1-10 |

### 4.2 安全强项（保留并写进验收）

SQL 全参数化；SSRF 面≈0（出站 URL 全部硬编码主机，无用户可控 URL）；无 subprocess/eval/pickle；路径穿越有防护；密码哈希与 token 存储选型正确；CORS 无 `*`+credentials 组合；账号与密码错误同形 401；脱敏网关双向过滤（手机号/学号/邮箱）。

### 4.3 AI 特有安全（对照 OWASP Top-10 for LLM Apps 2025）

| OWASP LLM 2025 | 本项目现状 | 判定 | 动作 |
|---|---|---|---|
| LLM01 提示注入 | 梨宝双模式+追问状态机，工具面窄（天气/检索），agent 权限受限；但 S1 意味着**记忆库可被未鉴权写入/重置**→ 等于开放了间接注入与画像投毒通道 | ⚠️ | P0-1 修 S1 即封堵主要通道 |
| LLM02 敏感信息泄露 | 脱敏网关（入库前双向脱敏）是亮点；但聊天历史可被任意读取（S1）= 泄露通道 | ⚠️ | P0-1 |
| LLM03 供应链 | Python/Node 依赖无审计（pip-audit / npm audit 从未跑） | ⚠️ | P1-6 进门禁/CI |
| LLM05 输出处理 | React 默认转义，markdown 渲染需确认不开 raw HTML | 待核 | P2-8 走查时确认 |
| LLM06 过度代理 | 智能边界四层「L4 不做」是产品级约束，天然对齐 | ✅ | 保持 |
| LLM07 系统提示泄露 | 异常文本回传客户端（`plan_dialog.py:497`）；人格模板未见暴露 | ⚠️ | P0-6 顺带收敛 |
| LLM08 向量/嵌入弱点 | chunks 表只读、无用户写入向量通道 | ✅ 低风险 | 保持 |
| LLM10 无界消费 | 无任何限速/预算；LLM 40s 超时是唯一闸 | ⚠️ | P0-3 一并做轻量全局限速 |

### 4.4 移动端（对照 OWASP MASVS，mas.owasp.org）

- MASVS-NETWORK：明文流量贯穿（S2）——上域名+TLS 后一并关 `usesCleartextTraffic` 与 `cleartext`。
- MASVS-STORAGE：token 明文 localStorage（S8）；策略是「登出即清」的最小化思路，可接受为过渡，P1-9 评估迁移到 Capacitor Preferences + `allowBackup=false`。
- MASVS-RESILIENCE/PLATFORM：keystore 不入库 ✅；APK 侧载更新无签名校验 UI（TLS 后自然缓解）。

### 4.5 合规（推广前置）

推广评估文档已把路径写清：域名 → ICP 备案（2-4 周）→ App 备案；软著走版权保护中心官方免费通道（材料建议 `src/lib/planner/` + `server/app.py` 前 30 后 30 页 + 用户手册）。**HTTPS + 域名是备案与对校沟通的双重前置**，所以 S2 的整改不是「可选优化」而是推广时间线的关键路径 → P3-1 与推广日历绑定。

---

## 5. 对标检索：同类项目的权威开源方案

> 原则：**这些项目是「对标与借鉴源」，不是「替换目标」。** 本项目自研引擎与护栏体系已被测试证明有效，引入任何重框架都属于 §8「不做清单」。

### 5.1 RAG / 校园知识库

| 项目 | 定位 | 对我们的启示 | 采用方式 |
|---|---|---|---|
| **RAGFlow**（Apache-2.0） | 深度文档理解 RAG 引擎，强项是引用溯源与复杂文档 QA | 「答案必须带出处」的引用呈现范式，可强化梨宝回答的可信度呈现 | 借鉴理念（L0） |
| **Dify**（Apache-2.0） | 低代码 LLM 应用平台，内置 RAG 与工作流 | 提示词版本管理、评测驱动迭代的工作流组织方式 | 借鉴理念，不引入平台 |
| **FastGPT** | 知识库问答编排，中文生态成熟 | 知识库分块/召回评测的运营化（坏例回流） | 借鉴理念 |
| **LlamaIndex**（MIT）/ **Haystack**（Apache-2.0） | 代码级 RAG 框架 | 若未来自研检索升级（重排序、混合权重调优），可只借其**评测组件**思路（RAGAS 式指标），不整体换引擎 | P3 评估（L2，需立项） |

### 5.2 LLM 网关与对话应用

| 项目 | 定位 | 启示 | 采用方式 |
|---|---|---|---|
| **LiteLLM**（MIT） | 统一 LLM 网关：key 管理、限流、预算、日志 | 「无界消费」（OWASP LLM10）的标准解法是网关层预算与限流；我们用轻量自研限速先顶，规模大了再评估 | 先自研轻量（P0-3），后评估 |
| **Open WebUI** | 自托管对话前端 | 会话管理/历史的鉴权边界做法（history 必须绑定属主） | 借鉴做法（P0-1） |

### 5.3 FastAPI 工程化与认证

| 项目 | 定位 | 启示 | 采用方式 |
|---|---|---|---|
| **tiangolo/full-stack-fastapi-template**（MIT，官方） | JWT 认证、注册邮件、SQLModel、Docker、CI/CD 的官方样板 | 认证依赖注入（`Depends(get_current_user)`）的标准化写法——S1 的正解就是让鉴权成为依赖注入而非每端点手写 | P0-1 照此模式改 |
| **zhanymkanov/fastapi-best-practices** | 社区公认的项目结构与约定 | 路由/服务分层、middleware 组织 | 借鉴，不搬家 |
| **OWASP API Security Top 10**（safeguard.sh 等指南） | BOLA 排第一 | 本项目 C 评级的直接对照表（§4.1 的「触碰 OWASP」列） | 逐条对照销项 |

### 5.4 本地优先同步与冲突处理（云同步演进方向）

| 项目 | 定位 | 启示 | 采用方式 |
|---|---|---|---|
| **SuperProductivity**（MIT） | 本地优先任务/时间盒应用，可选 PouchDB/CouchDB 复制同步（支持加密文件同步） | 「本地-first + 同步可选 + 服务端处理冲突」正是光溯云同步的目标形态；CouchDB 复制协议的 revision 树思想值得抄 | P3-3 设计输入 |
| **Joplin**（AGPL-3.0） | 笔记 + 多端同步，支持端到端加密同步目标 | 同步目标抽象（可插 S3/WebDAV/Joplin Server）与 E2E 加密可选层 | P3-3 设计输入 |
| **AppFlowy**（AGPL-3.0）/ **思源笔记**（AGPL-3.0） | 本地优先 Notion 类 | 增量快照 + 冲突版本可视化 | P3-3 设计输入 |
| **Loop Habit Tracker** | 离线优先、零账号习惯应用 | 证明「无账号也能好用」是可行产品路线——与本项目「本地优先默认关同步」的隐私主张一致 | 口径印证 |

### 5.5 SQLite 运维与备份

| 项目 | 定位 | 启示 | 采用方式 |
|---|---|---|---|
| **Litestream**（Apache-2.0，litestream.io） | 后台进程流式复制 SQLite WAL 到 S3/本地，支持 PITR | 单机 SQLite 灾备的事实标准；备选 rqlite（分布式化，过重） | **P1-1 首选**；最低配先上定时 `.backup` 快照脚本 |
| SQLite 官方 `VACUUM INTO` / `.backup` | 内置能力 | 无外部依赖的兜底方案 | P1-1 的最低配实现 |

### 5.6 同类学生/排程应用（功能面参照）

Vikunja（自托管任务管理，服务端权威模型）、SuperProductivity（深度工作流/时间盒，MIT）、Loop Habit Tracker——共同点：**离线可用是底线，同步是增强，冲突处理宁可保守**。这与本仓「本地重算 + 缓存续命 + LWW」的现状同构，验证了路线；差异点是我们多出「排程引擎 + 画像」这一层，无直接对标物，是差异化资产。

### 5.7 安全与供应链工具链（全部可 L0 进门禁）

| 工具 | 用途 | 落点 |
|---|---|---|
| **gitleaks**（MIT） | 密钥扫描（防 S9/S10 重演） | P1-6 进 gate_overnight 新增检查项（L0 增量） |
| **pip-audit**（Apache-2.0）/ **npm audit** | Python/Node 依赖漏洞审计 | P1-6 CI + 门禁 |
| **Bandit**（Apache-2.0） | Python SAST（裸 except、弱随机等） | P1-6 CI |
| **Semgrep** / **CodeQL** | 规则化代码审计（可写「memory 端点必须校验属主」自定义规则） | P2 评估 |
| **Trivy**（Apache-2.0） | 镜像/文件系统综合扫描 | P3（若容器化） |

### 5.8 可观测性

Sentry（现 FSL 许可，SaaS 或自托管）/ GlitchTip（AGPL，Sentry 兼容自托管）做前后端错误聚合；轻量替代 = 结构化 JSON 日志 + 每日错误摘要。决策点在「是否愿意引入外部上报」（与 telemetry 零上报的隐私主张有张力）→ **P1-4 先做无上报的自托管日志方案，P3 再议**。

### 5.9 CI/CD 与版本发布

GitHub Actions（跑现有 `gate_overnight.mjs` 即可，不自造新流程）+ release-please/changesets 式「版本单源」思想 → P1-6 / P1-8。

---

## 6. 维护优化计划（分阶段路线）

> 每项标注：变更分级（§1.3）｜零回归保障｜验收标准。估时按「专注半天=0.5d」。

### 6.1 P0 —— 止血（本周内，推广前完成；除 P0-2 外全部 L0/L1）

| ID | 动作 | 涉及 | 零回归保障 | 验收 | 估时 |
|---|---|---|---|---|---|
| P0-1 | 公网端点属主校验：`/api/chat/history`、`/api/memory/facts/*`、`/api/memory/reset`、`/api/import_pdf`。带 Bearer 时 user_id 从 token 派生并比对属主；匿名模式将 memory 操作约束为「同 session_id 才可读写」。**鉴权依赖注入化**（参照 full-stack-fastapi-template 的 `Depends` 模式），不逐端点散写 | `server/app.py:1184-1331` | L1（env `LIBAO_REQUIRE_OWNER=0` 逃生门）；先补「越权必 403/404、本人必通」双向测试（RV），再改实现 | 用 A 的 token 读 B 的 session/history 返回 404；本人全链路回归绿；capability_map `--write` 纳入 | 1.5d |
| P0-2 | **TLS+域名上线**（L2 部署级，但时间上属 P0）：买域名 → Caddy/Nginx+Let's Encrypt → `serve.py` 转发目标与 `apiBase.ts` 兜底、`version.json` apkUrl 全部改 https → AndroidManifest 关 `usesCleartextTraffic`、capacitor 关 `cleartext/allowMixedContent`（随下一次 APK 发版） | `serve.py:64`、`server/version.json:3`、`src/lib/apiBase.ts:24`、`AndroidManifest.xml:43`、`capacitor.config.ts` | L2：写 BLOCKERS 拍板；分两步（服务端先双栈兼容 http+https，发新版 APK 后再关明文） | 浏览器与 APP 全走 https；`curl http://` 301；MASVS-NETWORK 对应项勾掉 | 1d+备案等待 |
| P0-3 | 登录限速：进程内滑动窗口（复用 serve.py:99-103 的 10min/5 次设计），env `LIBAO_RATELIMIT` 可关 | `server/account.py:203-223` | L1；RV：第 6 次错误密码必 429、正确密码不受影响 | 测试双态；顺带给 LLM 出站加全局并发预算（LLM10） | 0.5d |
| P0-4 | 请求体上限：sync PUT / chat / import_pdf 统一 413（如 5MB/2MB 档），uvicorn `--limit-max-requests` 不适用则用中间件 | `server/app.py:1303`、`server/sync.py:60-71` | L1；RV：超限必 413、正常载荷不受影响 | e2e 与 smoke 回归绿 | 0.5d |
| P0-5 | `memory.py` 开 WAL + busy_timeout=5000（对齐 account.py:63-65） | `memory.py:54-69` | L1（PRAGMA 变更，行为不变）；跑 memory 相关既有测试（scripts/test_memory_facts.py 等） | 并发写 smoke 不再报 database is locked | 0.5h |
| P0-6 | 生产日志落盘：launch_be.py 改为重定向到 `/opt/usst/logs/`（按日滚动），收敛 `plan_dialog.py:497` 的异常外泄（返回通用 reason，细节进日志） | `launch_be.py:14-22`、`plan_dialog.py:497` | L0/L1；不影响任何接口契约 | kill -9 后重启有完整日志；异常响应不再含内部栈信息 | 0.5d |
| P0-7 | ICS token 重置端点 `POST /api/account/ics/reset`（Bearer 鉴权），顺带文档化「token 泄露处置」 | `server/account.py`、`server/sync.py:355-362` | L0 纯新增端点；新增 smoke `_smoke_ics_reset.py` | 旧 token 失效、新 token 可拉 ICS | 0.5d |
| P0-8 | 弱口令清理：gigity 演示账号改强口令或下线；确认服务器续费（10-25 到期） | 服务器侧 | L2 运维 | 登录失败；续费回执留痕 BLOCKERS | 0.5h |

### 6.2 P1 —— 韧性与工程化（2-4 周，P0 后启动）

| ID | 动作 | 分级 | 零回归保障 | 验收 | 估时 |
|---|---|---|---|---|---|
| P1-1 | 备份体系：首选 Litestream 常驻复制三库到本地第二盘/OSS；最低配先上 `scripts/backup_db.py`（`VACUUM INTO` + 每日计划任务 + 异地拷贝 + 恢复演练文档） | L0 | 不触代码 | 「删库演练」：从备份恢复到临时库并跑 smoke | 1d |
| P1-2 | ErrorBoundary + 全局错误监听：新增 `<AppErrorBoundary>` 包住两个入口（`src/main.tsx:8`、`mobile/main.tsx:9`），白屏变降级页 | L1（渲染层新增，不改逻辑） | 新增组件测试（抛错子组件必出降级 UI）；impact 反查 App.tsx 守护 | 手动注入抛错验证降级页 | 0.5d |
| P1-3 | `src/lib/api.ts` 统一超时（默认 15s）与幂等 GET 单次重试；对齐 understand 端点既有模式（api.ts:363-391） | L1 | 现有 ui 测试全绿；超时/重试的假计时器测试 | 弱网模拟下 UI 不挂死 | 0.5d |
| P1-4 | 轻量错误聚合：`except Exception` 统一走 `log_event(level, scope, msg)` 写 JSONL；不做外部上报（守住隐私主张） | L0/L1 | 新增脚本测试 | 日志可按 scope 检索 | 1d |
| P1-5 | 后端授权/LWW 测试补齐：越权矩阵测试（P0-1 的 RV）、sync LWW Python 单测（含未来时间戳、并集合并）、account 单测；`capability_map.mjs --write` 纳入守护 | L0 | 纯新增；先证明「关实现必红」 | capability-map orphans=0 保持 | 1.5d |
| P1-6 | CI（GitHub Actions）+ 工具链：workflow 跑 typecheck + test:engine + test:ui + `capability_map.mjs --check`；新增 gitleaks、pip-audit、npm audit、Bandit 步骤（gate_overnight 基线已是动态推导，BLOCKERS 对应条可销案） | L0 | CI 只读仓，不改产物 | PR 红绿可见；密钥扫描零告警 | 1d |
| P1-7 | 演示资产修复：`public/my_schedule.json` 补真实课表或明确回落文案；`e2e-journey.mjs` 旧锚点同步 | L0 | E2E 77 断言绿 | 演示链路无 404 | 0.5d |
| P1-8 | 版本号单源：`scripts/release_version.mjs` 从单一来源（package.json）生成/校验 version.json、build.gradle、APK 命名；发布 checklist 落 docs | L0（校验器）→ L2（下次发版切换） | 校验器不匹配即 exit 1，进 CI | 四处漂移即红 | 0.5d |
| P1-9 | 移动端存储加固：`allowBackup=false`；评估 token 迁移 Capacitor Preferences（加密存储插件评估另议） | L1（下次发版生效） | mobile 既有 7 个测试域回归 | MASVS-STORAGE 对应项 | 0.5d |
| P1-10 | Key 管理收敛：`_load_env` 三处重复实现合并为单一模块（app.py:93-104 / memory.py:38-51 / plan_dialog.py:41-56）；加 TrustedHost 中间件 | L1 | server 既有 Python 测试 + smoke 全绿 | grep 只剩一处加载实现 | 0.5d |

### 6.3 P2 —— 完整性收口（决赛前，1-2 月窗口）

| ID | 动作 | 分级 | 备注 |
|---|---|---|---|
| P2-1 | beta-v2 → dev → main 人工评审合并（合并后重跑 `capability_map.mjs --write`） | L2 | BLOCKERS G 批既定 |
| P2-2 | 数据补爬：生活服务/数字校园（找后勤保障处、信息化办官网） | L0 | 复用 scripts/ 五步流水线，勿重爬存量 |
| P2-3 | 57 篇缺全文文章跑 `scripts/fulltext.py` 补抓 | L0 | 需要 token 有效期注意 |
| P2-4 | 决赛材料（申报书/PPT/视频）：素材直接取自本文 §1.2 优势清单 + capability-map 数据 | — | 10 月底截止，建议与 P1 并行 |
| P2-5 | FOCUS DAYS 死开关拍板（A 硬约束/B 软偏好/C 诚实文案） | L2 | CY 拍板后按铁律 2/3 走 |
| P2-6 | git 历史清理：`git filter-repo` 移除历史中的 `data/lightpath.db`；**推远端/公开化之前必做** | L2 | 不可逆操作，白天人工，先全量备份 |
| P2-7 | 方法库尾巴：QUESTION_BANK ≥60 道、contraindications、注释过期修正 | L0 | 对应守护测试同步 |
| P2-8 | 真机走查（Mate 40E）：按 MASVS-NETWORK/STORAGE 清单 + markdown 渲染确认（LLM05）+ 推广评估遗留项逐条过 | L0 | 走查结果回写 mobile-line 文档 |
| P2-9 | 文档漂移清账：ADR-008 去重、progress-status PARTIALS 销案、门禁基线数字、推广评估中已被 10-08 修复推翻的条目 | L0 | 顺手项，合并前清完 |

### 6.4 P3 —— 演进项（决赛后，需立项评审）

| ID | 动作 | 分级 | 对标 |
|---|---|---|---|
| P3-1 | 合规链：域名+HTTPS（若 P0-2 未竟）→ ICP 备案 → App 备案 → 隐私政策+用户协议+公网侧注销/导出端点 → 软著登记 | L2 | 推广评估 §5 路径 |
| P3-2 | RAG 评测化：引入 RAGAS 式指标（忠实度/召回/引用准确率）建立检索回归基线；评估重排序；引用溯源 UI | L2 | RAGFlow / LlamaIndex / Haystack |
| P3-3 | 同步协议演进：服务端时钟钳制（拒绝未来时间戳）、revision 版本树、冲突对比 UI、双向同步（若宣发需要） | L2 | CouchDB 复制协议 / SuperProductivity / Joplin |
| P3-4 | 可观测性升级：自托管 GlitchTip 或结构化日志面板；APK 崩溃上报（需隐私政策先行） | L2 | Sentry/GlitchTip |
| P3-5 | 组件库接入批决策（13 处手写表单收敛） | L2 | — |
| P3-6 | 部署容器化 + Trivy（可选） | L2 | full-stack-fastapi-template |

---

## 7. 「不做」清单（防过度工程，与「不做清单」同等效力的红线）

1. **不重写排程引擎、不替换自研 RAG 管线为 Dify/RAGFlow 平台**——golden 快照与 90 个 RV 锚点守护的资产，迁移成本与回归风险远大于收益。
2. **不引入微服务/多 worker**——单机单进程 SQLite 与当前用户量自洽，先修 WAL 与备份。
3. **不引入重型前端状态库/框架迁移**——零 any + 三 Tab 壳运转良好。
4. **不上外部 SaaS 错误上报**，除非隐私政策落地并明示（P3-4 前置）。
5. **不为了「安全」顺手重构**——每个安全修复限定在 §6.1 所列文件与行为，先测试后改动。
6. **不做成绩/评教类敏感功能**，不碰教务账号密码（project-core §6 既定红线，本文再次确认）。

---

## 8. 执行纪律（谁来保证「不改坏」）

1. 每个计划项开工前过 `node scripts/preflight.mjs`；收尾过 `node scripts/impact.mjs` 与 `node scripts/gate_overnight.mjs`；每项独立 commit（`fix(server):` / `feat(mobile):` / `docs(scope):` 前缀，path-scoped add）。
2. L1 项必须先有「反向验证」测试（关实现必红）再动实现，沿用 RV 纪律；新测试后跑 `node scripts/capability_map.mjs --write`。
3. L2 项一律先写 BLOCKERS.md（格式见 AGENTS.md §8.4），白天人工拍板；无人值守期间遇到 L2 立即停手。
4. 每完成一个 P0/P1 项，在本文档对应行打勾并留 commit 号，形成可审计的销项记录。
5. 回滚预案：任何 P0/P1 项上线后异常，按 commit 粒度 revert；服务器侧部署遵循既有 `dist_pre_*` 备份惯例。

---

## 附录 A：证据索引（审计引用的 file:line）

**后端（server/）**：密码哈希 account.py:56,100-103；token 生成/校验 account.py:118-130,138-161；登录无限速 account.py:203-223；ICS token sync.py:355-362,17 与 account.py:185,200；CORS app.py:82-90；绑定 app.py:1334-1338；明文转发 serve.py:64,324-344；APK 明文 server/version.json:3；IDOR app.py:1186-1196,1198-1221,1258-1275,1300-1331；sync 信任客户端/无上限 sync.py:60-71,143-186；memory 无 WAL memory.py:54-69；出站超时 app.py:479,283,632、agent.py:73、memory.py:345、plan_dialog.py:58、websearch.py:78、serve.py:341；异常外泄 plan_dialog.py:497、app.py:637；trace 吞异常 app.py:853；PDF 无界 app.py:1303；脱敏网关 app.py:167-184,912,919,1078,1217-1220；账号表最小化 account.py:67-74；WAL 对照 account.py:63-65、serve.py:111-114；DEVNULL launch_be.py:14-22；.env 键位 server/.env:4、.env.example:7-15；SQL 参数化 account.py:123-124,146-149,189-193、sync.py:190-194,233-238,360-369、serve.py:176-194、rag.py:331,345；路径防护 serve.py:409-412；ICS 转义 sync.py:247-278。

**前端/移动端**：strict tsconfig.json:17；零 any（全 src grep）；localStorage 键 auth.ts:4,13,14,50,51,63；云同步默认关 webSync.ts:9-11、SettingsPanel.tsx:122；无重试 api.ts:175-199；understand 超时 api.ts:363-391；裸挂载 main.tsx:8、features/mobile/main.tsx:9；cleartext AndroidManifest.xml:43,34 与 capacitor.config.ts；keystore 忽略 .gitignore:92-93；版本三/四处 package.json:4、server/version.json:2-3、mobile/android/app/build.gradle:17-18；eslint 仅 a11y eslint.config.mjs:1-4；无 .github/；e2e mock 后端 e2e/mobile-smoke.spec.ts:70-96。

**流程/文档**：capability-map.json（150 测试文件/144 守护/11 域/90 RV/guards 185/orphans 0）；BLOCKERS.md（基线过期 gate_overnight.mjs:32、FOCUS DAYS、my_schedule.json、e2e 旧锚点、方法库尾巴、历史 lightpath.db、备份缺失、服务器到期、并行会话纪律）；progress-status §8；mobile-line §5/§7；campus-promotion-assessment §4/§5；tests/README golden 纪律；decisions.md ADR-008 重复。

## 附录 B：参考链接（对标检索来源）

- [Firecrawl: 15 Best Open-Source RAG Frameworks in 2026](https://www.firecrawl.dev) ｜ [Learn With Param: Dify vs RAGFlow vs Onyx](https://www.learnwithparam.com) ｜ [Turing Post: 10 RAG Frameworks Compared](https://www.turingpost.com) ｜ [Iternal: Best RAG Framework 2026](https://iternal.ai)
- [FastAPI 官方 Full Stack Template](https://fastapi.tiangolo.com) ｜ [OWASP API Security Top 10 指南](https://www.safeguard.sh) ｜ [FastAPI-Production-Boilerplate](https://github.com/iam-abbas/FastAPI-Production-Boilerplate)
- [Litestream 官网](https://litestream.io) ｜ [Litestream How it works](https://litestream.io/how-it-works) ｜ [SQLite 复制方案对比（LiteFS/Litestream/rqlite/dqlite）](https://onidel.com/blog/sqlite-replication-vps-2025)
- [OWASP Gen AI Security Project: LLM Top 10](https://genai.owasp.org/llm-top-10)（LLM01 提示注入 / LLM02 敏感信息泄露 / LLM07 系统提示泄露 / LLM10 无界消费）
- [OWASP MASVS](https://mas.owasp.org/MASVS) ｜ [OWASP MASTG](https://mas.owasp.org/MASTG)
- [SuperProductivity 官网](https://super-productivity.com)（MIT，PouchDB/CouchDB 同步）｜ Loop Habit Tracker（离线优先零账号）｜ Vikunja（自托管服务端权威模型）

---

*评估与计划生成：2026-10-11 ｜ 下次复审建议：P0 销项完成后（预计 2026-10-18 前后）*
