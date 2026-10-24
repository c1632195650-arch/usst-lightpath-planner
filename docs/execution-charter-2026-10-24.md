# 执行章程 · 技术路线锁定 / 提交规范 / 开发界限（2026-10-24）

> **性质**：`docs/new-features-tech-plans-2026-10-24.md`（F1-F8）及此后所有批次的**开工前置文件**。与 `AGENTS.md` 并行生效，冲突时以 AGENTS.md 为准。
> **为什么要有这份文件**：CY 于 2026-10-24 提出硬性要求——"技术路线清晰明确；遵守 commit 规范与项目开发界限，**不得影响破坏既有开发版本、进度与功能**"。仓库历史已发生过：并行会话 `git add -A` 把他人 11 个在途文件混入提交（2026-10-08）、`npm run build` 冲掉已构建 APK（2026-10-06）、测试断言漂移险情（2026-09-28）。现行 **v0.4.10 是决赛演示基线**，任何回归都直接伤比赛。
> **一句话原则**：**每批改动 = 只增不删优先 + 逐文件边界 + path-scoped 提交 + 四闸门自证 + 逃生开关在手。**

---

## 0. 保护对象清单（碰坏任何一项 = 红线事故）

| 保护对象 | 纪律 | 监护机制 |
|---|---|---|
| golden 语料（`tests/golden/`、`evals/golden/*.jsonl`） | **只增不改**；存量逐字节一致是多数批次的验收项 | `golden-lib.test.ts` / golden-compare / gate |
| 既有测试断言 | **禁止改断言/删测试换绿**；断言漂移必须申报并 CY 认可 | RV 反向验证纪律、`capability_map --check` |
| 契约面：`src/types.ts`、`BuildWeekPlanInput/Result`（`schedule.ts`）、`SyncState`（schemaVer）、`data/openapi_snapshot.json` | **只增可选字段，不改既有字段语义**；变更须 commit message 显式申报 | typecheck + `contract:fuzz` + 申报模板（§2.4） |
| 发布链：`package.json`/`version.json`/`build.gradle`/APK 签名 | 三处版本号走 `release_version.mjs` 校验；签名件永不入库 | CI 版本校验（已阻断项） |
| 数据资产：`data/*.db` | 不手改、不提交运行库；schema 迁移 = L2 白天拍板 | gitignore + 备份 cron |
| 公网服务 `43.142.141.186` | 部署必走 `dist_pre_*` 备份 + `.bak` 惯例 + 双侧 md5；回滚三步 | RUNBOOK/BLOCKERS 惯例 |
| 移动端已装机用户 | 任何 server 响应变更必须**向后兼容**（老 APK 不炸）；API 字段只增 | openapi snapshot 只增 + 真机抽查 |

---

## 1. 技术路线裁决表（已锁定——不再开放选项，执行批不得另选）

| 功能 | ✅ 已锁定路线 | ❌ 被否的备选（及原因） | 工作单 |
|---|---|---|---|
| A1 偏好学习 v1 | **建议卡 + 用户一键确认**，经既有 corrections/画像接线生效；零引擎改动 | 在线权重微调（黑箱、违"讲理由"）；LLM 记忆反思（慢、有错判）；权重微调仅作 v1.5 小步随 F4 | F3 |
| A2 一键多方案 | **固定三档预设**（均衡/紧凑/松弛）+ 新权重键 `blockLengthOverrun/windowViolation` **默认 0**（零漂移钥匙）+ 预算闸 ≤600ms | 自助滑杆调参（选择疲劳）；改默认权重（必动 golden） | F4 |
| A4 场景模式 | policy 补丁**钳制在引擎安全档内**，应用层打补丁 | 引擎内建模式枚举（改引擎） | F6 |
| B1 引用溯源 | 答案尾部**来源卡片**（后端已带 sources 字段，做共享组件） | 逐句标注（合成层改造，贵，留论文版） | F2 |
| B2 不确定分级 | server 端**一处计算** confidence 四态，前端徽章 | 前端自行推断（口径分裂） | F2 |
| C1 晨报 | **本地拼装骨架**（零 LLM、离线可用）+ 通知复用 notifyBridge"纯函数+全量重排"模式；LLM 只作可选点缀且默认关 | 每日 LLM 生成（成本/依赖网络） | F5 |
| C2 周报复盘 | **规则模板句为主**，数据复用 behaviorLog 纯函数 | 全 LLM 总结（贵、不可解释） | F5 |
| D3 数据自动更新 | **jsonl 审核队列**（零 DB 迁移）+ 哨兵前置 + approve 才入库重建 | 直接入库无审核（版权+质量风险）；建 pending 表（L2 迁移） | F1 |
| A3 习惯块 | 应用层展开为**既有 Commit/UserTask 语义**（splittable+minAcceptableMin） | 引擎加 Habit 类型（改契约） | F7-1 |
| D1 课表导入 | `timetable_parser` 加 **WakeUp JSON / ICS 解析器**，输出既有 course_records 格式 | 前端解析（与 PDF 链路分裂） | F7-2 |
| B3 时效标注 | `effective_to` 迁移 = **L2 白天拍板后执行**，审核 CLI 是维护入口 | 跳过拍板直接迁移（违 §8.4） | F7-3 |
| C3 小组件 | **v0 = 既有 F15 常驻通知**（零工作）；v1 原生 widget 决赛后按需 | 立即做原生（决赛前动 mobile 原生层） | F7-4 |
| C4/D2 | **暂缓**（重启条件见工作单 F8） | — | F8 |

---

## 2. 提交规范（commit convention）

### 2.1 前缀与粒度
- 前缀：`feat(scope)` / `fix(scope)` / `chore(scope)` / `docs(scope)` / `test(scope)` / `refactor(scope)`；scope 用模块名（`week`/`libao`/`mobile`/`server`/`pipeline`/`plan`）。
- **粒度 = 一个可独立回滚的项**。一个批次含多个独立项时拆多笔 commit（先例：收官批逐项提交）。
- 混合性质时拆开：代码一笔、文档一笔、BLOCKERS 登记可并入同批文档笔。

### 2.2 暂存纪律（历史事故条款，最高优先级）
- **强制 path-scoped `git add <显式路径>`；禁止 `git add -A` / `git add .`**（2026-10-08 事故：add -A 把并行会话 11 个在途文件混入提交）。
- 提交前 `git status --porcelain` 对账：暂存区**只含本批清单内文件**；发现非本批文件（并行会话在途产物）→ 不 add、不删、不动，在 BLOCKERS 登记归属。
- `_*` 前缀文件（临时产物）已被 gitignore 覆盖，永不入库。

### 2.3 无人值守纪律（/goal、闲时、通宵批）
沿用 AGENTS.md §八：**只 commit 不 push**；禁 `push/reset --hard/rebase/clean -fd/checkout -- ./branch -D`；禁删任何文件；每批收尾跑四闸门；拿不准写 BLOCKERS 停手。白天人工窗口才可 push。

### 2.4 契约申报模板（五处申报点对应批次的 commit message 必含此段）
```
契约申报: <字段路径> 增 <字段名?>（可选/opt-in，缺省=旧行为逐字段一致）
零漂移证明: <golden 逐字节一致 / 存量断言全绿 的实测口径>
逃生: <env 开关或回退路径>
```
示例（F4）：
```
feat(week): 一键三方案 + 目标函数补项（§13.8 算子激活）

契约申报: BuildWeekPlanInput 增 variants?: boolean；BuildWeekPlanResult 增
variants?: VariantSummary[]（均 opt-in）。Weights 增 blockLengthOverrun/
windowViolation，DEFAULT 均为 0。
零漂移证明: 变体关闭时全套存量 golden 逐字节一致（golden-compare 实测）；
新增变体语料快照 5 份（只增）。RV: 新权重默认改 1 → 存量 golden 红。
逃生: PLAN_VARIANTS=0
```

### 2.5 提交前检查单（顺序固定）
```
node scripts/preflight.mjs        # 站在最新版上
（批内开发，逐文件边界见 §3）
node scripts/impact.mjs           # 守护测试反查，零红
node scripts/gate_overnight.mjs   # tsc 0 / engine·ui 只增不减 / 禁区零改动
git status --porcelain            # 暂存对账 → path-scoped add → commit
```
涉服务器部署：另走 `dist_pre_*` 备份 + 双侧 md5 + `.bak` 惯例（RUNBOOK）。涉 API 响应新增字段：`data/openapi_snapshot.json` **只增**并跑 `npm run contract:fuzz`。

---

## 3. 开发界限

### 3.1 全局界限
1. **双线纪律**：本仓（上理线）不做框架化改造、不依赖框架仓包；框架仓（campuskit）不回写本仓任何文件。跨线事项白天人工裁决（usst-line-plan §B0）。
2. **接缝红线**：`features/libao/**` 禁止 import `@/lib/planner/*`，唯一例外 `weekPlanForChat.ts`。新组件放 `src/components/`（共享层），不放接缝两侧。
3. **夜间禁区**（无人值守）：`src/types.ts`、`data/` 二进制、`evals/golden` 既有条目——"看起来必须改"即停手写 BLOCKERS。
4. **变更分级**：L0 直接做 / L1 带开关+RV / L2 先写 BLOCKERS 白天拍板（B3 的 DB 迁移、schemaVer=3、TLS 均为 L2）。
5. **新增优先**：所有 F 批默认以新文件/新字段/新端点落地；触碰既有文件限于工作单"改动清单"列出的行级小改。

### 3.2 逐批次界限表（允许触碰 = 改动清单；表外文件一律禁触）

| 批 | 允许触碰 | 明确禁触 | 新增产物 | 逃生开关 |
|---|---|---|---|---|
| F1 | 新增 `scripts/crawl_cron.py`/`review_queue.py`/`test_crawl_queue.py`；服务器 crontab | 前端任何文件；`rag.py` 检索逻辑；articles 既有行 | `data/pending_review.jsonl`、`_logs/crawl_*.jsonl` | 摘掉 crontab 一行 |
| F2 | `scripts/rag.py`（仅 url 投影兜底）；`server/app.py`（confidence+kb 标记）；新增 `SourceChips/ConfidenceBadge`；`LbaoChat.tsx`/`LbaoDrawer.tsx` 挂载点小改；`openapi_snapshot.json` 只增 | 引擎全部；既有响应字段语义；其他 feature 文件 | 两组件+测试 | 组件不渲染即回退 |
| F3 | `src/lib/behaviorLog.ts`（可选字段）；新增 `src/lib/prefLearn.ts`；新增建议卡组件；`usst.preflearn-v1` key；测试 | **`lib/planner/**` 全部**；`types.ts`；梨宝对话逻辑 | 建议卡+面板 | 面板总开关+逐条 dismiss+清除 |
| F4 | `lib/planner/{model,objective,planWeek,solver,schedule}.ts` 限定五文件；`WeekPlanView.tsx`；`weekPlanForChat.ts`；`tests/golden/` **只增** | `construct.ts` 等其余引擎文件；既有 golden 任何修改；`types.ts` | `tests/variants.test.ts`+新语料快照 | `PLAN_VARIANTS=0` |
| F5 | `mobile/lib/{morningBrief,notifyBridge}.ts`；`TodayTab/MeTab` 挂载；新增 `src/lib/weeklyReview.ts`+周报卡；测试 | `server/sync.py`（schemaVer=3 属 v2 另立项）；引擎 | 两模块+两卡+测试 | 通知 flag；卡片可收起 |
| F6 | 新增 `src/lib/scenarioModes.ts`；overview 模式卡；调用侧 patch 接线 | `lib/planner/**`（补丁在应用层） | 模式定义+测试 | 不选模式=零漂移 |
| F7-1 | 新增 `src/lib/habitStore.ts`；GoalTodoCard 增行；behaviorLog 增 `habitDebt()` | 引擎；契约 | HabitDef+测试 | 习惯卡隐藏 |
| F7-2 | `server/timetable_parser/` 新增 wakeup.py/ics.py+端点+fixtures | 既有 import_pdf 逻辑 | 解析器+测试 | 新端点独立，不并旧路 |
| F7-3 | **L2 拍板后**：DB 迁移+rag 过滤+chip 角标+审核 CLI 增字段 | 未拍板前一切 | 迁移脚本 | 迁移可空跑（字段可空） |
| F7-4 | 仅决赛后：`mobile/android` 原生层 | 决赛前禁动 | widget 原生码 | 不启用 |

### 3.3 与偿债批（报告一 D1-D12）的交错规则
偿债批与新功能批**不混批**：D4（构建解耦）先于一切要发版的批；D1-批1（libaoIntent 拆分）先于 F3 收尾与 F5-C2 的"最爱挪时段"统计；D2（周视图下沉）先于 F4 的 UI 部分。同一天可多批，但各自独立提交、独立过闸。

---

## 4. 零回归判据（每批的"没破坏"证明，逐批钉死）

| 批 | 必须逐字节/全绿不变 | 允许的变化 |
|---|---|---|
| F1 | 前端零改动 → engine/ui/golden 全套与批前一致 | 服务器 `_logs/` 与队列产物 |
| F2 | engine/golden 无关；ui 存量断言全绿；`contract:fuzz` 通过 | ui 断言只增；openapi snapshot 只增 |
| F3 | **全套 golden 逐字节一致**（引擎输入未变，实测留痕）；behavior 既有测试绿 | prefLearn 测试新增 |
| F4 | 变体关闭时全套存量 golden **逐字节一致**；`p0-check`/`churn` 等既有断言绿 | golden **新增**变体语料；objective 新项 RV（默认改 1 → 红） |
| F5 | engine/golden 无关；mobile 既有测试全绿 | 新测试只增 |
| F6 | 模式关闭时 policy 逐字段一致（专测断言） | 模式映射测试新增 |
| 偿债批 | 对应模块行为不变：D1/D2 迁移前后 golden 与 E2E 全绿 | 文件组织变化 |

**变红处理流程（固定）**：停手 → 定位（impact/golden-compare 报告）→ 修复或按 commit 回退 → **禁止改断言、删测试、重拍既有 golden** → 修不动写 BLOCKERS 交 CY。四闸门的"禁区 FAIL（沙箱无 git）"属环境限制：按先例做等价人工复核（`git status` 对账 + 本批文件清单核对）并留痕。

---

## 5. 回滚机制（每批开工前先确认逃生门在手）

- **既有开关**：`DIALOG_ENABLED`（对话管理器回退）、`KNOWLEDGE_WIRED/SPATIAL_WIRED/PROFILE_PREFS_WIRED`（env `'0'`）、`LIBAO_RATELIMIT=0`、`LIBAO_MAX_*_MB=0`、`LIBAO_REQUIRE_OWNER`、`WEEK_VIEW_V3=false`。
- **新增开关**：`PLAN_VARIANTS=0`（F4）、prefLearn 面板总开关（F3）、晨报/周报通知 flag（F5）、场景模式不选即失效（F6）。
- **代码回滚**：按 commit 粒度 `git revert`（禁 reset 丢历史）。
- **服务器回滚**：`cp -r /opt/usst/backup/dist_pre_*/. /opt/usst/app/dist/` + 还原 `.bak` + `systemctl restart usst-api`（三步，RUNBOOK 口径）。
- **APK 回滚**：`version.json` 指回旧版本 apkUrl（0.3.2 起全部保留在服务器）。

---

## 6. 并行会话纪律（事故驱动条款）

1. **开工声明**：任何会话开工前读 BLOCKERS 尾部 ≥30 行，确认无在途批占用本批文件；本批文件清单作为第一条写进 BLOCKERS（先例：ed3af05 所有权划分）。
2. **全程 path-scoped**；发现他人未提交改动与本批同文件 → **等待或改道**，不覆盖、不代提交。
3. **撞车处置**：重复交付并存不覆盖，登记对照表交 CY 裁决（2026-10-24 软著双批先例）；共享文件（App.tsx/TodayPage 系）只能串行改。
4. **一台服务器一个写者**：部署窗口互相错开，部署前后留 `dist_pre_*` 与 md5 留痕。

---

## 7. 当前积压补交清单（给 CY 的 git 命令块，白天人工执行）

> 本机沙箱无 git（2026-10-22 起多批登记），以下在**有 git 的终端**、仓库根目录执行。先跑 ① 对账，未知路径以 `git status` 实际清单 + BLOCKERS 172/176/180-183 条归组，**禁止 add -A**。

```
cd "D:\WORKBUDDY DATA\学术部\_work_dev"
git status --porcelain                      # ① 对账：未跟踪清单应与下面分组吻合

git add docs/framework-pivot-research-2026-10-24.md `
        docs/framework-line-plan-2026-10-24.md `
        docs/usst-line-plan-2026-10-24.md `
        docs/refactor-and-optimization-assessment-2026-10-24.md `
        docs/new-features-menu-2026-10-24.md `
        docs/beyond-framework-horizons-2026-10-24.md `
        docs/new-features-tech-plans-2026-10-24.md `
        docs/execution-charter-2026-10-24.md
git commit -m "docs(plan): 调研报告+双线方案+三报告+技术方案集+执行章程（2026-10-24）"

git add scripts/softcopyright_pdf.mjs docs/finals-application-skeleton-2026-10-24.md
git commit -m "chore(softcopy): 软著源程序生成脚本+申报书骨架（B9 批，BLOCKERS 172）"
# ↑ 另一会话的 build_softcopy_pdf.mjs / 申报书骨架-2026-10-24.md / softcopy 政策检索
#   等（BLOCKERS 176/182/183 提及）按 git status 实名归入此组或另起一笔

git add BLOCKERS.md
git commit -m "docs(blockers): 2026-10-24 各批登记与软著名义裁决留痕"

node scripts/preflight.mjs && node scripts/gate_overnight.mjs   # ⑤ push 前全量门禁
git push origin beta-v2                                       # ⑥ 白天人工 push
```

`_软著V1.0/`、`_softcopy/`、根目录 `_*.html/md` 均为 `_*` 忽略产物，不入库。

---

## 8. 生效与修订
本章程自 commit 起生效；修订走一笔 docs commit 并在 §0 保护对象表同步。执行批 kickoff 模板：**"本批工作单=Fx；界限=章程 §3.2 行；零回归判据=§4 行；逃生=§5"**——写进批次 BLOCKERS 首条。
