# tests/ —— 引擎测试（零依赖）

本目录归 **B**（见规格书 §7.3 / §7.2）。**全仓唯一测试钩子**就在这里，
**不得再新增第二个**（曾经的 `scripts/register-alias.mjs` 是临时脚手架，已合并到此处）。

## 跑法

```bash
# 引擎测试（本目录）
node --import ./tests/register.mjs --test "tests/**/*.test.ts"

# CY 侧既有的数据工程测试（目录仍在 scripts/，只是换钩子运行）
node --import ./tests/register.mjs --test "scripts/**/*.test.*"
```

`package.json` 对应两条脚本（由 CY 改指向）：

```json
"test:ui":     "node --import ./tests/register.mjs --test \"scripts/**/*.test.*\"",
"test:engine": "node --import ./tests/register.mjs --test \"tests/**/*.test.ts\""
```

## P0 验收脚本

```bash
node --import ./tests/register.mjs tests/p0-check.ts     # 全部通过 → 退出码 0；有失败 → 1
```

`p0-check.ts` 是 P0 的**断言式验收脚本**（26 条，对应规格书 §9 的 T0.1~T0.4），
原在仓库外 `_devtools/`，2026-09-15 迁入此处（路径由文件位置推导，clone 后可直接跑）。

- 文件名**刻意不带 `.test`**：它自带按任务分组的打印与汇总、用退出码汇报，不参与 `node --test` 自动发现。
- 它与 `tests/*.test.ts` 的断言**有部分重叠**，属有意保留的双保险：一条守「任务验收口径」，一条守「回归」。

## 原理

- `register.mjs` → `node:module` 的 `register()` 装上 `alias-hook.mjs`。
- `alias-hook.mjs` 把 `@/xxx` 解析到 `<仓库根>/src/xxx.ts`，**由本文件位置推导**，不写死绝对路径。
- 依赖 Node 22 的**原生 TS 类型剥离**，`.ts` 可直接运行。
- ⚠️ **禁止引 `tsx` / `ts-node`**（零新增依赖纪律，规格书 §7.3）。
- ⚠️ `src/lib/api.ts` 用了 `import.meta.env`，**Node 里加载不了**；任何 import 它的模块
  （如 `planner/transfer.ts`）**不能直接 import**，测试请注入桩 provider。

## 目录约定

| 路径 | 内容 |
|---|---|
| `tests/*.test.ts` | 单元 / 验收测试（`node --test` 自动发现） |
| `tests/p0-check.ts` | P0 验收脚本（断言式 + 退出码，用 `node` 直跑，不走自动发现） |
| `tests/golden/` | golden baseline 快照（`week-*.json`）。**已拍**（2026-09-15，见下方「偏差说明」） |
| `tests/golden-lib.ts` | golden 工具库：构造等价口径（AC-2）/ 硬违反（AC-1）/ 指标（cost 等）。**纯函数** |
| `tests/golden-inputs.ts` | golden **输入语料**（`week-*`）。⚠️ 拍过快照后**只增不改** |
| `tests/golden-snapshot.ts` | 快照拍摄器（CLI）。默认拒绝覆盖，确需重拍加 `--force` |
| `tests/golden-compare.ts` | 快照对比器（CLI）。规格书 §10.4 第 3 条入口 |
| `tests/construct.test.ts` | **T1.1**：构造等价（AC-2）、语义键 id（§6.4）、确定性（AC-6）、提交项 pinned/window/deps（AC-9） |
| `tests/solver.test.ts` | **T1.4**：AC-1 硬约束零违反、AC-3 成本不劣、AC-5 硬块不动、诊断恒等式、环依赖降级 |
| `tests/explain.test.ts` | **T1.5**：QL-2「软块 100% 有 reason」、文案不自相矛盾、issues 分级 |
| `tests/planweek.test.ts` | **§4.5.2 两遍法**：注入工厂→走两遍、取数失败→降级单遍、可被 Node 直载 |

## Golden baseline（AC-1 / AC-2 / AC-3）

```bash
# ① 拍摄（合入 dev 后、于唯一基准上「只拍一次」）
node --import ./tests/register.mjs tests/golden-snapshot.ts
node --import ./tests/register.mjs tests/golden-snapshot.ts --only=week-04-typical   # 单条
node --import ./tests/register.mjs tests/golden-snapshot.ts --force                  # 重拍（慎用）

# ② 对照（新引擎 vs 快照）
node --import ./tests/register.mjs tests/golden-compare.ts
```

对照器逐条核验：

| 项 | 含义 | 新引擎未落地时 |
|---|---|---|
| ⓪ 基线可复现 | 旧引擎重跑 == 快照（防「旧引擎被偷改」） | 仍执行 |
| AC-2 构造等价 | `planWeekV2` 块内容 == 快照（**id 不参与**） | `SKIP` |
| AC-1 硬约束 | `planWeekV2` 的 `hardViolations === 0` | `SKIP` |
| AC-3 目标更优 | `cost_v2 <= cost_baseline` | `SKIP` |

- 新引擎入口 `src/lib/planner/index.ts::planWeekV2` 未落地时自动降级为「只做 ⓪」，
  退出码仍为 0（**不假通过、也不误报失败**）。
- 「构造等价」只比 **时间 / 类型 / 标题 / 地点**（外加 `dayOfWeek`）——
  刻意不含 `room`/`teacher`/`source`，避免无关差异把 AC-2 判红；需要看全量用 `normalizeBlockFull`。
- 快照里的 `timing.elapsedMs` **不参与比对**（否则每次拍都不同）；`meta.gitRev` 记录拍摄时的 commit。


## P1 验收（求解器重构）

```bash
node --import ./tests/register.mjs --test "tests/**/*.test.ts"   # 含 T1.1/T1.3/T1.4/T1.5 的 30 条
node --import ./tests/register.mjs tests/golden-compare.ts        # AC-1 / AC-2 / AC-3
```

| 项 | 验收对象 | 口径 |
|---|---|---|
| AC-1 硬约束零违反 | `planWeekV2`（迭代后） | 同天重叠对数 + 迟到转场数 = 0 |
| **AC-2 构造等价** | **`construct`**（迭代前） | 块内容（天/起止/类型/标题/地点）与快照逐块一致；**id 不参与** |
| AC-3 目标更优 | `planWeekV2` | `cost_v2 <= cost_baseline` |
| AC-5 锁生效 | `planWeekV2` | `hard` 块坐标 improve 前后不变 |
| AC-6 确定性 | 两者 | 连续两次运行稳定序列化逐字节相同 |
| QL-2 可解释 | `planWeekV2` | 软块 100% 有非空 `reason` |

> ⚠️ **AC-2 的比对对象是 `construct`，不是 `planWeekV2`**（规格书 §9-T1.1 原文）：
> `planWeekV2` 多了 improve，允许把块挪到更优位置（这正是 AC-3 的意图）。
> 拿迭代后的计划去断言「逐块一致」等于要求「improve 什么都不做」——那是错误口径。

### 偏差说明：快照拍摄时点

规格书 §9-T1.6 / §13.2-B3 要求快照「在 CY 的 PR 合入 `dev` 后、于唯一基准上只拍一次」。
**本次拍摄提前了**，理由与处置：

- 本分支的 `src/lib/planner/schedule.ts` 与 P0 基线 `31ddeb6` **逐字节一致**
  （`git diff 31ddeb6 HEAD -- src/lib/planner/schedule.ts` 为空），
  即「合并后基准」与「当前基准」在构造行为上**尚无可观测差异**；
- 一旦合入后确认 `schedule.ts` 有变化，**必须重拍一次**（`--force`）并同步 AC-2 —— 
  重拍是有代价的动作，故在此显式记账。

### 验收有牙齿（变异测试记录）

为证明 AC-2 不是「永远绿」，做过一次变异：把 `construct.ts` 的 `SOFT_BUFFER_MIN` 由 `5` 改成 `6`
（只差 1 分钟），预期并实测：

```text
week-04-typical  ⓪基线 FAIL  AC-2 FAIL   ← 精确报出 "startMin": 776 → 775
```

即**旧引擎的一分钟漂移都会被抓住**。改完已还原（`SOFT_BUFFER_MIN = 5`）。
