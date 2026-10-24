# 重构偿债 wave1（r1–r7）验收报告

> 验收时间：2026-10-24 16:0x–16:3x（zcode 验收批，独立于执行批）
> 验收对象：`docs/refactor-execution-plan-2026-10-24.md` wave1 七批（r1–r7）+ 驱动器 `scripts/refactor_run.mjs`
> **独立性声明**：不采信执行方自述。取证手段 = 台账解析 + 文件级核对 + 全套门禁独立复跑 + golden 独立对照 + 禁区文件 mtime 审计 + **验收方亲做变异反向验证 4 组**（字节哈希保护还原）。

---

## 1. 总裁决

**✅ 通过（附 2 条 drain 前必修 + 1 项白天必补）。** 七批产物真实在位、五步门禁可独立复现、行为零漂移成立（golden 5/5 逐字节过）、反向验证有牙齿、禁区零触碰；r8/r9 按计划正确未动。**但 drain 补交前必须修 r4/r5 两条失真的 commit message（§5 P2/P3），r5/r6 的完全验收还差离线 E2E 77 断言复跑（白天人工窗）。**

## 2. 独立复跑数据（全部验收方亲跑）

| 项 | 结果 | 判定 |
|---|---|---|
| typecheck | 0 错 | ✅ |
| test:engine | **881-0**（基线 880，只增：r6 表驱动锁 +1） | ✅ |
| test:ui | **489-0**（基线 459；wave1 六个新测试文件 +约 22，其余为并行 F 批在途新增） | ✅ |
| golden 对照 | `golden-compare` **5/5 快照 PASS**（正确钩子 scripts/register-alias.mjs） | ✅ 零漂移实证 |
| capability_map --check | ✅ 一致 | ✅ |
| 双后端地址互查 | 三处全 `43.142.141.186`（serve.py / apiBase / version.json） | ✅ |
| 禁区 mtime 审计 | `src/types.ts`(10-08)、`evals/golden/*.jsonl`(9-21~10-08)、`tests/golden/*.json`(9-21)、`data/*.db`(9-11~10-08)——**全部早于今日，零触碰** | ✅ |
| 驱动器 status | 7 批 🟡待补交、r8/r9 ⚪未开始，与申报一致 | ✅ |

> 期间出现一次 ui 489/488 瞬态红——并行 F 批会话正在写测试文件被 runner 撞上半写状态，**复跑即 489-0 绿**，非 wave1 回归（并行纪律：不碰、登记）。

## 3. 逐批核验表

| 批 | 台账 | 文件实况（验收方亲测） | 独立验证 | 结论 |
|---|---|---|---|---|
| r1 D4 构建解耦 | GREEN 14:50 | `dist-apk/` 含 0.4.10/0.4.9 两包、`dist/apk/` 已空、`.gitignore` 含 `dist-apk/`、stage_apk.mjs 纯函数+invoked 守卫质量好 | **变异 RV：摘掉 isInsideDist 拒写逻辑 → apk_stage.test 恰 1 红 → 还原复绿** | ✅ |
| r2 D1批1 时间解析拆出 | GREEN 15:42 | timeParse.ts 802 行、libaoIntent 2134→1420、import/export 双块结构在位、时间族符号 re-export 齐 | **变异 RV：export 块删 clockChannelOn → 恰 1 红 → 复绿**（注：前两次误中 import 块，见 §4） | ✅ |
| r3 D9 快照刷新 | GREEN 14:47 | AGENTS.md §〇 已刷至 2026-10-24（新机 IP/0.4.10/执行章程链接在位）；数字为 r3 时点值 880/459（现 881/489，见 P7） | 文本抽查 | ✅ |
| r4 D6 serve 定位 | GREEN 15:54 | serve.py 文件头定位声明在位；**CY_API_TARGET 已从旧机对齐 43.142.141.186**（迁移漏网修复，见 §6 价值项）；互查脚本=地址三处一致性版 | 互查脚本真跑 ✅ 三处一致 | ✅（消息失真 P2） |
| r5 D2 编辑动作下沉 | GREEN 16:03 | weekEditActions.ts 83 行（撤销/重做/回执/键盘簇，忠实搬运）；WeekPlanView 1341→**1309（仅 -32）** | 行为锁+RV 标注在位；E2E 复跑待白天 | ✅（完成度口径 P3；删除组遗留已申报） |
| r6 D3 动线表 | GREEN 15:59 | appFlow.ts 69 行（VIEW_FLOW/canEnter/startPersonaOrOnboardingView/firstMainTab，旧语义忠实转录）；v3.test.ts +表驱动锁 | **变异 RV：welcome.next 改错 → 恰 1 红 → 复绿** | ✅ |
| r7 D7 存储网关 | GREEN 15:56 | storageGateway.ts 85 行 + storage.ts 指路注释；老键读路径未动 | storage.test 存量 8 断言绿 | ✅ |

## 4. 验收方独立反向验证记录（4 组）

| # | 变异 | 结果 |
|---|---|---|
| 1 | r6 appFlow `welcome.next` 改错 | ✅ 恰 1 红，字节还原，复绿 |
| 2 | r1 stage_apk `isInsideDist` 摘除 | ✅ 恰 1 红，字节还原，复绿 |
| 3 | r2 export 块删 `clockChannelOn`（带换行锚钉住 export 块） | ✅ 恰 1 红，字节还原，复绿 |
| 4 | r2 `extractWhen` 改名/删除 | ❌ 未红——**系靶位误中**：`String.replace` 首个命中落在 import 块（同序同名），node --test 剥类型不查 import 断链；换 export 块锚后即 #3 结果。诚实记录：非锁缺陷；但顺带发现**别名盲区**（export 块内 `x as y` 改名可骗过词元 includes 检查）→ P1 加固建议 |

## 5. 问题清单（按严重度）

| # | 级 | 问题 | 处置建议 |
|---|---|---|---|
| P2 | 🔴 drain 前必修 | **r4 commit message 失真**：写的是"CORS 互查"，实际交付是"后端地址三处一致性互查 + serve.py 旧机地址对齐"（后者是 wave1 计划外价值最高的修复，反而没写进消息） | 改驱动器 `BATCHES[r4].message`（单一事实源）+ 台账 jsonl 同步；或 drain 时手改 |
| P3 | 🔴 drain 前必修 | **r5 commit message 失真**：写"WeekPlanView 预期降至 ~900"，实际 1309（-32）；删除-重排动作组未下沉未在消息体现 | 同上，按 BLOCKERS 211③ 如实口径改写 |
| P1 | 🟡 建议加固 | r2 锁别名盲区（export 块 `as` 改名不红） | 锁内加"tokens 不含 as"一行，或改运行时 `typeof ns[fn]==='function'` 断言；随 r8/wave2 顺手 |
| P4 | 🟡 流程偏差 | r5/r6/r7 无 started 事件、无 BLOCKERS 开工声明（章程 §6.1 kickoff 先行被跳过，事后总结条覆盖） | wave2 执行时恢复 kickoff 纪律；不追溯 |
| P5 | 🟢 已申报未落盘 | `scripts/refactor_run.test.ts`（方案 §5 预先标注无人认领） | 随 wave2 或 F 批补 |
| P6 | 🟢 存量暴露 | 双别名钩子并存：`tests/register.mjs` 直跑 golden-compare 会 ERR_MODULE_NOT_FOUND（spec §7.3 合并待办未做；本次验收暴露） | 收口项：统一到 scripts/register-alias.mjs 并在 tests/README 注明唯一钩子 |
| P7 | 🟢 小 | AGENTS §〇 数字为 r3 时点值（880/459），现 881/489 | drain 时一行刷新，或注"以门禁实跑为准" |

## 6. 价值确认与债务余量（wave1 后口径）

- **计划外高价值修复**：r4 发现并修复 serve.py `CY_API_TARGET` 仍指旧机 `101.35.253.143` 的迁移漏网——**旧机 10-25 12:17 到期后本地一体化"梨宝脑"转发会整体死链**。此修复 + 三处一致性互查脚本 = D6 债实际清偿超出原计划。
- D1（对话层）：三巨头 5948 → 5234 行（-714，≈12%）；时间解析域已独立成 timeParse.ts。**余量 = r8（LbaoChat 2483）+ r9（weekPlanForChat 1331），wave2。**
- D2（周视图）：1341 → 1309；撤销/回执/键盘簇已出。**余量 = 删除-重排动作组（BLOCKERS 211 已申报，r8 前评估）。**
- D4/D6/D7/D9/D3：**清偿**。D5：文档口径已立，目录归位渐进（存量不动）。D8/D10/D11/D12：不在 wave1，各归 P3-3 / F4 / B3-4 / L4，符合计划。

## 7. 未做事项清单

1. **离线 E2E 77 断言复跑**（r5/r6 触 UI 的行为不变性终验）——需隔离离线 vite（5176 惯例端口），按 §8.5 与既有先例属**白天人工窗**；跑法见 `scripts/e2e-sched-session.mjs` 头注。这是 r5/r6 完全验收的最后一项。
2. 白天收账顺序：**修 P2/P3 两条消息 → `node scripts/refactor_run.mjs drain --plan` 核对 → drain 七笔 → 全量门禁 → 与今日其他积压（章程 §7 docs、软著双批、F 批）按 git status 实名归组提交 → push**。
3. r8/r9（wave2，决赛后 2027-01）：正确未动，依赖 r2 已满足。
4. 临时件清理（白天）：`_accept_rv.mjs`（本验收驱动器）、`_r2_split.mjs`。
5. 并行提示：F1/F2 批仍在途（ui 数量持续增长），本报告数字以 2026-10-24 16:3x 时点为准。
