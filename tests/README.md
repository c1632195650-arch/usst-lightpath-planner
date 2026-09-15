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
| `tests/golden/` | golden baseline 快照（`week-*.json`）。**只在 CY 分支合入后拍一次**，见规格书 §9 T1.6 |
| `tests/golden-lib.ts` | golden 工具库：构造等价口径（AC-2）/ 硬违反（AC-1）/ 指标（cost 等）。**纯函数** |
| `tests/golden-inputs.ts` | golden **输入语料**（`week-*`）。⚠️ 拍过快照后**只增不改** |
| `tests/golden-snapshot.ts` | 快照拍摄器（CLI）。默认拒绝覆盖，确需重拍加 `--force` |
| `tests/golden-compare.ts` | 快照对比器（CLI）。规格书 §10.4 第 3 条入口 |

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

