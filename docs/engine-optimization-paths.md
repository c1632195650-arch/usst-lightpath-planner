# 排程引擎 · 优化路径与验收口径（2026-09-19）

> 作者：CY（学术部）｜面向读者：B（引擎 owner）与后续接手者
> 所有数字都可复现；命令都写在条目里。**这不是意见清单，是量出来的。**

## 一、起点：引擎现在的代价结构（5 语料 × 2 档合计 770.3 分）

| 代价项 | 分数 | 占比 |
|---|---|---|
| **transferRisk** | **690.0** | **90%** |
| switchCost | 74.3 | 10% |
| placeMismatch | 6.0 | 1% |
| studyShortfall / blankDeficit / dueOverdue / churn | **0 / 0 / 0 / 0** | 0% |

复现：`node --import ./scripts/register-alias.mjs <探测脚本>`（临时探测，口径见下）

### 发现 1：90% 的代价是「度量假象」

`objective.ts::transferPenalty` 原实现只有三档：同地点 0、`slack<0` 罚 10、`slack<5` 罚 3、
**其余一律罚 1**（×权重 2.0）。它**不看步行距离**。实测分布（179 个相邻对）：

- **170 对是「地点变了」→ 每对固定罚 1**；`slack<5` **0 对**；`slack<0` **0 对**
- 同时注入真实转场分钟后：**真正紧张的（slack < 分钟+5）0 对**

也就是说：它罚的是「换了几次地点」，不是「这段路赶不赶得上」。**1km 与 100m 同价**，
真正危险的跨校区排布会被淹没。

### 发现 2：一只眼睛看路 —— construct 用真实数据，improve 不用

| 模块 | 是否用真实转场 |
|---|---|
| `construct.ts` | ✅ `travelNeed(transfer, from, to)` 参与放置 + `attachTransfers` 挂提示 |
| `objective.ts` | ❌（改前）只有静态三档；`block.transfer.minutes` 只被 UI 显示 |
| `improve.ts` | ❌ 494 行里 **零处** 出现 `transfer` |

**实证**（PR-A 之后）：把转场成本设为 25 分钟，legacy 档与新档产出的计划**逐块完全相同**，
但同一份计划在旧口径下 119 分、新口径下 **185 分** —— 新度量暴露了旧度量藏住的风险，
而搜索完全没动。→ **P1 必须配 P2 才有意义。**

### 发现 3：两遍法比单遍贵 20~30×

`as-is` p50 **0.2~0.4ms** vs `transfers` 档 p50 **6~9ms**。需要 profile 才能定论是
provider 调用次数还是 improve 迭代变长。

> ⚠️ **计时口径（2026-09-19 实测教训）**：`engine_baseline.json` 里的毫秒数是在**机器空闲**时测的；
> 同一天下午再测，同样的代码整体慢 2~3×（包括与本改动无关的 `as-is` 档）。
> 因此**跨时间比 p95 会得出错误结论**。正确做法：
> ① 判断"改动是否变慢"要用**同机同刻对照**（把改动前的树另建一份、同一轮各跑一次，比值 0.5~1.7 属噪声）；
> ② 只看 p50 且 ≥9 轮；③ 性能结论请写清测量条件。

### 发现 4：自习/空白目标已饱和

`studyShortfall = 0`、`blankDeficit = 0`、`studyMin` **恒等于目标 600**。这两个项
**当前不提供任何优化信号** —— 继续在这上面花时间是白费。

### 发现 5：`churn` 对 free 块恒 0

`lockFactorOf`: `hard=100 / soft=1 / free=**0**` → 「改计划别乱动」目前**没有度量支撑**。

---

## 二、路径清单与状态

| # | 路径 | 状态 | 验收口径 |
|---|---|---|---|
| P1 | transferRisk 接真实分钟 + 可信度折扣 + 灰度开关 | ✅ **PR-A 已完成**（默认仍 legacy） | `tests/scoring-transfer.test.ts` 13/13（含 5 条冻结锚点、单调性、反向验证）；legacy 逐位等于快照 |
| P2 | improve 对转场有感（算子里用真实分钟） | ⬜ **下一步**（已有实证说明必要性） | 新测试：构造"能省 10 分钟步行但需重排"的场景，断言确实重排；关掉剪枝必须变红 |
| P3 | churn 落地（free 非零因子） | ⬜ | `tests/churn.test.ts` 扩：free 被挪 ⇒ churn>0；不动 ⇒ 0；`eval:l3 --repeat 3` pass^3=1.0 |
| P4 | 两遍法性能（先 profile） | ⬜ | `eval:engine` transfers 档 p50 下降 ≥30% 且不变量全过 |
| P5 | transferRisk 与 placeMismatch 分工 | ✅ 随 P1 解决 | 有真实分钟时不再用固定罚分 → 同一次跨校区不会"按次数再罚一遍"；placeMismatch 只管"整天校区一致性" |
| P6 | 「自习/空白已饱和」结论固化 | ✅ 本文档（发现 4） | — |
| P7 | 数据可信度折扣（可撤销） | ✅ 随 P1 实现 | `TRANSFER_TRUST = 0.8`（OSM 系统性偏长 30~100%，见 `audit:transfer`）、估算再 × `ESTIMATE_TRUST = 0.75`；路网修好后改回 1.0 |

## 三、PR-A 具体做了什么（2026-09-19）

1. `model.ts`：新增 `ScoringMode = 'legacy' | 'transfer-aware'`、`DEFAULT_SCORING = 'legacy'`、
   `TRANSFER_TRUST = 0.8`、`ESTIMATE_TRUST = 0.75`；`SolverConfig` 增 `scoring` / `transferTrust`
2. `objective.ts`：`transferPenalty(prev, next, minutes?)` 增分档（走不到 10 / 踩点 3 / 长距离 2 / 其余 1）；
   新增 `effectiveTransferMinutes(next, trust)`（**只看 `next.transfer`** —— 它是"进入本块"的转场，2026-09-18 核对过）；
   `EvalContext` 增 `scoring` / `transferTrust`
3. `types.ts` + `construct.ts`：`TransferHint` 正式补入 `reliable?` / `source?`
   （此前只写成一句中文 `note`，机器读不到）
4. `improve.ts` + `solver.ts`：口径**必须一致地**透传给 improve 与 evaluate，否则"改进"会朝旧目标爬
5. `tests/scoring-transfer.test.ts`（13 条）：5 条**冻结锚点**（cost 与 2026-09-15 快照逐位一致）
   + 分档语义 + 单调性 + 折扣 + 端到端

**为什么默认仍是 legacy**：`tests/golden/*.json` 是冻结语料，新口径会改 cost 数值。
灰度档让新旧并存：legacy 保快照有效，新档另拍基线，验证充分后再翻默认。

## 四、发布到 engine beta 的验收清单

- [ ] P2 / P3 / P4 完成（P5/P6/P7 已随 PR-A 落地）
- [ ] `npm run eval:gate` 全绿（双端 L0 + L1 + 引擎不变量）
- [ ] `npm run eval:l3 --repeat 3` → pass^3 = 1.0（改评分后计划稳定性不许退化）
- [ ] `tests/` ≥ 99 全绿、`scripts/` 145 全绿、`typecheck` 0 错
- [ ] 新档基线快照另存（`evals/runs/engine_baseline.json` 更新 + 记录 scoring 档位）
- [ ] 决策记录（`docs/decisions.md`）：口径开关、可信度折扣、快照策略
