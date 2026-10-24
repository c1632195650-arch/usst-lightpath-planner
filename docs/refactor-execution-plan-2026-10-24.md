# 重构偿债 · 一键执行方案（报告一 §4 偿还顺序的执行细化）

> 生成：2026-10-24 14:3x（zcode 偿债执行批）
> **生效链**：[报告一](refactor-and-optimization-assessment-2026-10-24.md)（为什么还债、还哪几笔）→ **本文档**（逐批工作单）→ [执行章程](execution-charter-2026-10-24.md)（commit 规范 / 界限 / 零回归判据，冲突以 AGENTS.md 为准）。
> **与并行产物的关系**：一键驱动器 `scripts/refactor_run.mjs` 已由并行会话于 14:12 先行落库（本文档 §2 总表与其 `BATCHES` 清单逐字同源，**改任何一边必须同步另一边**）；本会话贡献 = 本工作单 + 14:2x 全链路真跑验证（§0.4 两处待修缺陷即实测发现）。
> **一键程度**：修掉 §0.4 两处两行级缺陷后 = 真一键（全套门禁真跑 ~25s）；修前 `finish` 可用但**看台账 verdict，别信退出码**。

---

## 0. 一键执行总则

### 0.1 环境实况矩阵（2026-10-24 14:2x 实测，本机）

| 项 | 状态 | 说明 |
|---|---|---|
| node / npm | ✅ v24.14.0 / 11.9.0 | 门禁可真跑（spawn 正常，无沙箱拦截） |
| git | ❌ | PATH 与四处绝对路径候选全灭；`.git` 在，分支 `beta-v2`，本地 `0be6e9c` 领先 `origin/beta-v2`(`4b57fa4`) 未推送（10-11 维护批之后未推，push 属白天人工） |
| python | ✅ 两路 | `.venv\Scripts\python.exe` 与 workbuddy 3.13.12 均可用；**PATH 裸 `python` 是 Store 占位（静默失败），禁用** |
| 套件基线 | engine **880/0** · ui **459/0** · tsc 0 | 版本 0.4.10；线上 `43.142.141.186` |
| 门禁耗时 | typecheck 4s · impact 0s · engine 4s · ui 2s · gate_overnight 11s | 一键全链 ~25s，随时可跑 |

### 0.2 标准流（每批三步，全部一条命令）

```
node scripts/refactor_run.mjs start <批id>          # ① 自动写 BLOCKERS 开工声明（章程 §6.1/§8 模板）
……按 §3 该批工作单改文件（先跑批内 recon 步骤）……
node scripts/refactor_run.mjs finish <批id> [--extra 追加文件]
                                                    # ② 五步门禁 → 台账登记 →（有 git 时）path-scoped 提交
                                                    #    红了自动写 BLOCKERS 停手，修完重跑
node scripts/refactor_run.mjs status                # ③ 随时看全景
白天收账：node scripts/refactor_run.mjs drain --plan # 出章程 §7 形态命令块；有 git 的终端跑 drain 真提交
```

### 0.3 commit 规范如何不被破坏（本方案的立身之本）

- **消息不手敲**：九条的 subject/body 预写在驱动器清单里，过章程 §2.1 前缀白名单正则后才许用；`drain` 逐字取用。
- **path-scoped 强制**：`finish`/`drain` 只 `git add --` 清单文件（+ `--extra` 白名单），清单内出现禁区路径（`src/types.ts`、`data/`、`evals/golden/`、`*.env`）直接拒绝——2026-10-08 `add -A` 混入 11 个他人文件的事故在机制上不可再现。
- **无 git 不产生半成品**：本机 `finish` 只落台账（`docs/refactor-ledger-2026-10-24.jsonl`，GREEN 才计入待补交），白天 `drain` 按台账顺序逐笔提交——顺序、分组、消息与夜间完全一致，进度不受本机缺 git 影响。
- **只 commit 不 push**（AGENTS §8.3）；每批一笔独立 `git revert` 可回滚；契约类改动（本方案 wave1 无）仍走章程 §2.4 申报模板。

### 0.4 🔴 驱动器两处待修缺陷（14:2x 真跑发现；属主=并行会话，改前先对 BLOCKERS 确认无人动刀）

| # | 现象（实测证据） | 后果 | 修复建议（两行级） |
|---|---|---|---|
| A | `finish` 第五步 `gate_overnight` 在本机恒 FAIL：其"禁区文件"检查 `git status` 不可达按失败处理（今日 BLOCKERS 五轮 7/8 绿同款环境限制） | verdict 恒 RED → 台账永无 GREEN → `drain` 空转，一键断在第五步 | `runGates` 对 `gate_overnight` 步单列：输出中红项**仅**"禁区文件/未能判定"时按 WARN（章程 §4 已有"等价人工复核"先例，本方案 §1 落实） |
| B | `main()` 丢弃 `cmdGate`/`cmdFinish` 返回值，从不 `process.exit(非0)`——实测 gate 输出 RED 但进程退出码 **0** | CI/agent `&&` 串联时红门禁被静默放行 | `main()` 末尾 `process.exit(返回值)` |
| C（小） | `COMMIT_RE` 的 `\S.+` 要求 subject 冒号后 ≥2 字符 | 单字符 subject 误拒（现九条不受影响） | `\S.*` 即可 |

**修 A/B 前的过渡口径**：`finish` 照跑，判定以**台账 verdict**为准（RED 会自动登记 BLOCKERS，不会污染待补交队列）；串联命令禁止依赖其退出码。

### 0.5 中止条件（任何批命中即停手写 BLOCKERS，章程 §4 变红流程）

需要改既有测试断言 / 重拍既有 golden 才能变绿；需要动 `src/types.ts` 或 `BuildWeekPlanInput/Result` 语义；需要新增第三方依赖；recon 发现工作单事实基线与现场不符（以现场为准，登记后等裁决）。

---

## 1. 零回归判据与交错规则（沿用章程，逐条落到本方案）

- **行为不变搬运**（r2/r5/r6/r8/r9 全部适用）：存量断言逐条绿、golden 零漂移、新测试只增、每条新断言反向验证（关掉实现必红）。允许的变化只有**文件组织**。
- **只增不改**（r1/r4/r7）：新模块/新脚本/新测试落地，既有文件改动限于工作单列出的行级小改（r4 的 serve.py 仅加文件头声明）。
- **与 F 批交错**（章程 §3.3）：r1（D4）先于一切要发版的批；r2（D1批1）先于 F3 收尾与 F5-C2"最爱挪时段"统计；r5（D2）先于 F4 的 UI 部分。偿债批与新功能批**不混批**，同一天可多批但各自独立提交、独立过闸。
- **排期裁决**（报告一 §4 顺序）：wave1 = r1→r7（决赛周内可安全插入 r1/r2 两个半天批；r3-r7 决赛后第一周治理批顺带消化）；wave2 = r8/r9（4C 备赛期 2027-01，依赖 r2 完成）。
- **禁区与行尾**：夜间禁区三处零触碰；本仓全 LF，新文件写 LF（写完 `finish` 前驱动器/人工复核 CRLF=0）。

---

## 2. 批次总表（与驱动器 `BATCHES` 同源——改任一侧必须同步另一侧）

| 批 id | wave | 债 | 估时 | 前置 | 触及面（=path-scoped add 清单） |
|---|---|---|---|---|---|
| r1-d4-build-decouple | 1 | D4 | 0.5天 | 无 | .gitignore、scripts/stage_apk.mjs（新）、scripts/apk_stage.test.ts（新）、docs/真机走查准备清单-2026-10-06.md |
| r2-d1a-libao-time-split | 1 | D1批1 | 0.5天 | 无 | libaoIntent.ts、libao/timeParse.ts（新）、scripts/libao-time-split.test.ts（新） |
| r3-d9-snapshot-refresh | 1 | D9+D5 | 0.5天 | 无 | AGENTS.md、docs/progress-status.md、tests/README.md |
| r4-d6-serve-positioning | 1 | D6 | 0.5天 | 无 | serve.py、scripts/check_backend_consistency.mjs（新）、scripts/backend_consistency.test.ts（新） |
| r5-d2-week-edit-extract | 1 | D2 | 1天 | 无 | WeekPlanView.tsx、week/weekEditActions.ts（新）、scripts/weekEditActions.test.ts（新） |
| r6-d3-route-table | 1 | D3 | 0.5天 | 无 | App.tsx、src/appFlow.ts（新）、tests/v3.test.ts（只增断言） |
| r7-d7-storage-gateway | 1 | D7 | 0.5天 | 无 | lib/storage.ts、lib/storageGateway.ts（新）、scripts/storageGateway.test.ts（新） |
| r8-d1b-chat-ui-split | 2 | D1后续 | 1.5天 | r2 | LbaoChat.tsx（+批内 recon 定名的新组件/hook，--extra 声明） |
| r9-d1b-weekforchat-split | 2 | D1后续 | 1天 | r2 | weekPlanForChat.ts、libao/chatVerdict.ts（新） |

> 各批完整 commit subject/body 见驱动器 `BATCHES[].message`（单一事实源）；本文档不复制正文，防止两处漂移。

---

## 3. 逐批工作单

> 每批格式：**事实基线**（2026-10-24 侦察实录，行号可点）→ **步骤** → **验证** → **回滚/逃生**。
> 执行前必须跑 `start <批id>`（BLOCKERS 开工声明）；recon 结果与基线不符 → §0.5 停手。

### r1 · D4 构建解耦（APK 暂存目录与 vite 输出分家）

**事实基线**：`vite.config.ts:82` `build.outDir='dist'`（未关 emptyOutDir，`npm run build` 清空 dist）；本地 `dist/apk/` 现存 lightpath-0.4.10/0.4.9 两个安装包（BLOCKERS 2026-10-06 实录：build 冲掉 APK 致公网短暂 404）；`release_version.mjs` 只校验 apkUrl **文件名**不涉路径（本批无需动）；`.gitignore:11-13` 已有 `dist/ dist-mobile/ dist-ssr/`。已知关联问题（**不在本批**）：`prep_mobile_dist.py:89` 全量拷贝 dist→dist-mobile 时 apk/ 会搭车进 APK webDir——登记不扩大行为面。
**步骤**：① 新建 `scripts/stage_apk.mjs`：把 `mobile/android/app/build/outputs/apk/release/app-release.apk` 复制为 `dist-apk/lightpath-<package.json version>.apk`，**拒绝**任何写入 `dist/` 的调用形态（参数或硬编码命中 `dist/apk` 即 exit 1）；② `.gitignore` 增 `dist-apk/`；③ 把现存 `dist/apk/*.apk` 移入 `dist-apk/`（本地文件搬家，两者本就 gitignore，无提交影响）；④ 源码锁测试 `scripts/apk_stage.test.ts`：stage_apk 拒写 dist（RV：摘掉拒绝逻辑必红）+ `.gitignore` 含 `dist-apk/` + scripts 目录内不得再出现把 APK 写入 `dist/apk` 的字符串；⑤ `docs/真机走查准备清单-2026-10-06.md` §8 重出 APK 命令改走 stage_apk；⑥ `node scripts/capability_map.mjs --write`。
**验证**：`npm run build` 后 `dist-apk/` 文件数不减（人工一条命令）；`finish r1-d4-build-decouple` 五步门禁绿。
**逃生**：整批新增，`git revert` 单笔；旧手工拷贝惯例仍可用（只是不被守护）。

### r2 · D1批1 libaoIntent 时间解析拆出（纯搬运）

**事实基线**：`libaoIntent.ts` 2134 行；时间解析族 = 类型 `TimeCertainty(59)/WhenHint(69)/TimeWindow(96)/ClockHint(110)` + 函数 `extractWhen(737)/extractEffort(762)/extractFrequency(818)/extractPlace(833)/extractWindow(844)/clockChannelOn(869)/extractClockRange(903)/extractTarget(1019)/extractTargetWhen(1048)/extractReplanDays(1069)/termAnchorsFrom(1147)/resolveWhen(1175)/spanDurationMin(1596)`；既有守护 = `scripts/libao-intent-{clock,month,natural,term,weekno}.test.ts` + `libao-time-locator.test.ts` + `libaoIntent.test.ts`（全套 ui 套件）。
**步骤**：① recon：对上列每个函数列出其引用的**模块内私有符号**（正则/映射表/助手），形成搬运闭包清单（写进 PR 描述或台账）；② 新建 `src/features/libao/timeParse.ts`，闭包内符号**逐字节搬运**（不改一个字符，含注释）；③ `libaoIntent.ts` 删本体、顶部 re-export 同名符号——**12+ 处 import 面零变化**（含 `LbaoChat.tsx`/`weekPlanForChat.ts`/测试文件）；④ 新增 `scripts/libao-time-split.test.ts`：re-export 同一性源码锁（RV：删任一 re-export → 恰红）+ 抽 3 个时间解析行为锚（如钟点区间、周次表达）；⑤ `capability_map --write`。
**验证**：`finish` 全绿（ui 459+新增全过 = 存量断言零漂移的直接证据）；`grep -c "export" timeParse.ts` 与闭包清单一一对应。
**逃生**：`git revert` 单笔回拆分前。

### r3 · D9+D5 快照刷新（纯 docs，无源码）

**事实基线**：AGENTS.md §〇 快照停在 10-06（测试数 458+/319+、无 10-11 维护批与移动端 0.4.10 发版、服务器地址已更新至新机）；`tests/`（=engine 套件）与 `scripts/*.test.ts`（=ui 套件）的语义分居是历史形成（连 v3 动线测试都在 tests/），capability-map 在弥合。
**步骤**：数字一律取自 §0.1 实测（engine 880 / ui 459 / tsc 0 / v0.4.10 / 43.142.141.186），禁止估算：① AGENTS.md §〇 重写进度快照（已实现清单补：10-11 维护批 14 项、移动端线 0.4.10+云同步、CI、四闸门体系、执行章程链接）；② `docs/progress-status.md` §8 遗留清单勾销已完成项；③ `tests/README.md` 开头补两行语义口径（tests/=engine、scripts/*.test.ts=ui；D5 渐进归位：存量 glob 不动，新测试进语义目录）。
**验证**：`finish`（此批 suites 为空，typecheck+LF 即过）；人工复读一遍快照与 §0.1 数字一致。
**逃生**：`git revert` 单笔文档提交。

### r4 · D6 serve.py 定位声明 + CORS 互查

**事实基线**：`serve.py` 659 行（根目录一体化：静态托管+API 转发，本地 8765/8000 习惯）与 `server/app.py`（FastAPI，公网 systemd）并存；CORS 白名单两处维护（`server/app.py::_CORS_DEFAULT` 放行 5173/5174 等），历史上"改了 A 忘了 B"多次（H 批实录）。
**步骤**：① `serve.py` 文件头加定位声明块（本地一体化开发模式；**生产行为以 server/ 为准**；两处规则漂移由互查脚本守护）；② 新建 `scripts/check_backend_consistency.mjs`：解析两文件的 CORS 源清单并比对，差异 exit 1（纯读文件零子进程，风格对齐 impact/preflight 的直读路线）；③ `scripts/backend_consistency.test.ts`：fixture 样本互查（一致→过 / 注入额外 origin→红，RV 双向）+ 对当前两实文件跑一次真比对；④ `capability_map --write`。**明确不做**：合并两后端（L2，决赛后随框架线再议）。
**验证**：`finish` 全绿；互查脚本对当前两文件 PASS。
**逃生**：互查脚本是新增告警器，摘掉零影响。

### r5 · D2 周视图编辑动作下沉（行为不变搬运）

**事实基线**：`WeekPlanView.tsx` 1341 行。撤销栈本体**已**在 `userPlanStore`（`WeekPlanView.tsx:51-52` import `undoLayer/redoLayer/useLayerStore`）；视图残留的编排 = `handleUndo(191)/handleRedo(197)/undoAction(202)`、键盘绑定 `z/y`(216-222)、删除-重排动作组（890、1278-1283 的 notify+undoAction 接线）。`week/` 已有完整分层（stores：userPlanStore/planEditsStore；hooks：useWeekPlan/useWeekPlanDrag；view-model：weekViewModel.ts 208 行）——本批沿此方向，**不做视觉层重写**（week-view-design.md 令牌刚收敛）。
**步骤**：① recon：列 WeekPlanView 内全部编辑动作 handler 及其依赖的 store/props；② 新建 `weekEditActions.ts`：handleUndo/handleRedo/undoAction/键盘映射/删除重排动作组**原样搬运**（依赖以参数注入，不新增行为分支）；③ WeekPlanView 改为调用，render 面零改动；④ `scripts/weekEditActions.test.ts`：键盘映射纯函数锚 + 动作组 notify 文案锚（RV 各一条）；⑤ `capability_map --write`。
**验证**：`finish` 全绿（planLock/userPlanStore/rollingState 存量断言 + engine 套件全过）；**白天窗补**：离线 E2E 77 断言复跑零漂移（需隔离 vite 实例，夜间不起服务不跑）。
**逃生**：`git revert` 单笔。

### r6 · D3 动线表收敛

**事实基线**：`App.tsx` 539 行；`view` useState(69) + `welcome(206)/basicinfo(217)/import(229)/persona(246)/result(266)` 五段 if 链；`startPersonaOrOnboarding(200-204)` 是 2026-10-08"绕过课表导入"bug 的统一动线修复——本批即把该思路推广全站。守护 = `tests/v3.test.ts` 既有动线锁（+ ui 套件 persona/basicInfo 等）。
**步骤**：① 新建 `src/appFlow.ts`：`FLOW: Record<View, {render 所需组件标识, canEnter(state), fallback}>` 一张表 + `nextView(current, intent, state)` 纯函数；② App.tsx if 链改查表分发（**每个落点与旧 if 链逐条对照**，含 onSkip/onBack/onRetake 全部边）；③ `tests/v3.test.ts` 只增表驱动动线锁（无真实课表→import、无基本信息→basicinfo、老用户重测→persona 直达；RV：表改错必红）。
**验证**：`finish` 全绿；新旧落点对照表附在 PR/台账。
**逃生**：`git revert` 单笔。

### r7 · D7 存储网关（只增不改）

**事实基线**：`lib/storage.ts` 125 行——主状态 `usst-life-assistant-v2`(v4) 的 `migrate` 已是纯函数好范式；散分片键：`usst.mobile.memoCache/memoOwner`、`usst.week.*` 等 feature 自管键，迁移逻辑散在各处。
**步骤**：① 新建 `src/lib/storageGateway.ts`：`REGISTRY: key→{version, migrate}` 登记表 + `gwLoad/gwSave`（store 可注入 → node:test 直测纯核），先登记主状态键与两个 mobile 键（**读路径不动存量调用**）；② `storage.ts` 仅加一行 re-export/注释指路（存量行为逐字节不变，`storage.test.ts` 8 断言零改动全绿）；③ `scripts/storageGateway.test.ts`：注册表 round-trip + 未知 key 拒绝 + 迁移登记（RV：摘掉注册校验必红）；④ `capability_map --write`。
**验证**：`finish` 全绿。
**逃生**：网关无人调用即零副作用。

### r8 · D1后续 LbaoChat 拆分（wave2，决赛后）

**事实基线**：`LbaoChat.tsx` 2483 行（双模式对话 UI + 追问链路 + 按钮卡 + 反馈条 + 评估入口，S/T/D/H 五批次叠层）。守护 = `scripts/libao-interact/chatRestore/lbaoPlan/libao-copy-guard.test.ts` 等。
**步骤**：① recon（**必做**，输出函数/组件清单+行区间进台账）：`findstr /n "^function \|^const \|export " LbaoChat.tsx`；② 按清单拆：展示组件（消息流/按钮卡/反馈条/评估入口 → `chatParts/` 子目录）与编排 hook（`useLbaoChat`）分离，**只搬运不改写**；③ 新增 chatParts 源码锁；④ `--extra` 声明全部新文件。
**验证**：`finish` 全绿；白天窗补梨宝剧本 E2E 离线复跑。
**逃生**：`git revert` 单笔。

### r9 · D1后续 weekPlanForChat 拆分（wave2）

**事实基线**：`weekPlanForChat.ts` 1331 行；话术族 = `tagLine(726)/describeVerdict(744)/categoryMinutesOfWeek(795)/quickOptionsFor(827)/proposeReplanOptions(917)/summarizeWeekPlan(209)` 等；引擎调用族 = `planWeekForChat(68)/planWeekWithTasks(84)/replanDaysForChat(159)/evaluatePlanForChat(197)/goalToTasks(295)/checkGoalFeasibility(489)`。**接缝红线**（AGENTS §三.6）：`features/libao/**` 禁 import `@/lib/planner/*`，唯一例外=本文件——拆分后**例外仍只能是本文件**。
**步骤**：① 新建 `chatVerdict.ts` 承接话术族（**不得** import planner，re-export 回 weekPlanForChat 保持导出面）；② 引擎调用族留原文件；③ re-export 同一性源码锁（同 r2 手法）+ 接缝红线源码锁复验（chatVerdict 零 planner import）。
**验证**：`finish` 全绿（lbaoPlan/schedSession/day-replan 存量断言）。
**逃生**：`git revert` 单笔。

---

## 4. 白天收账手册（CY，有 git 的终端）

```
node scripts/refactor_run.mjs status            # 看哪些批 GREEN 待补交
node scripts/refactor_run.mjs drain --plan      # ① 打印命令块（path-scoped，逐批）
                                                #   核对：每批 git add 清单 ⊆ 该批工作单触及面
node scripts/refactor_run.mjs drain             # ② 真提交（或手工执行①的命令块）
node scripts/preflight.mjs && node scripts/gate_overnight.mjs   # ③ push 前全量门禁
git push origin beta-v2                          # ④ 人工决定（注意本地尚有 10-11 批未推 + 章程 §7 今日 docs 积压）
```

与章程 §7 既有积压的关系：**互不替代**——本台账只管偿债批，今日七份 docs 与软著产物仍按章程 §7 归组提交。

## 5. 交付对照（并行会话协调，2026-10-24）

| 产物 | 属主 | 状态 |
|---|---|---|
| `scripts/refactor_run.mjs`（驱动器） | 并行会话（14:12 落库） | 已由本会话真跑验证；§0.4 两缺陷待修 |
| 本文档（逐批工作单 + 验证实录） | 本会话 | 即本文件 |
| `scripts/refactor_run.test.ts` | 无人认领 | 未落盘（驱动器头注预留；纯函数已由本会话合成事件走查通过，正式测试待认领补齐） |
| 九个批次本体（r1-r9 的代码改动） | 未开工 | `start <批id>` 即开工，全批未动 |
