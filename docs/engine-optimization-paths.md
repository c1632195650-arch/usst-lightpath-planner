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
| P2 | improve 对转场有感（算子里用真实分钟） | ✅ **PR-B 已完成** | `tests/improve-transfer.test.ts` 3/3（含反向验证：关掉 aware 开关必须变红） |
| P3 | churn 落地（free 非零因子） | ✅ **PR-C 已完成**（规格 §5.5 已修订） | `tests/churn.test.ts`：free 被挪 ⇒ churn>0；`p0-check` / `objective-evaluate` 同步更新并注明修订 |
| P4 | 两遍法性能（先 profile） | 🟡 **已做结构性优化，量化待稳定环境复测** | 行为指纹逐字一致 + 全量套件绿；**本机噪声 ±7×，不能下性能结论**（见下） |
| **P8** | improve 校验粒度（查清，**不需要立刻改**） | ✅ **已查清并回退** | 整份校验恒 false（掩盖而非致因）；实测改粒度后计划不变但慢 2× → 保持现状，风险点记入 ADR-010 |
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

## 三·五、PR-B 具体做了什么（2026-09-19）

`improve` 原来**三层都缺**，缺一层都不生效：

1. **没有数据源** → `ImproveContext` 新增 `transfer?: TransferProvider`，由 `solver` 注入
   （`n.req.transfer`；两遍法的 pass2 正好已把真实 provider 放进 req）
2. **候选排序与路程无关** → `relocateCandidates` / `reassignCandidates` 在 aware 档改为
   **按"与左右邻居的步行分钟"升序**再截断（`MAX_CANDIDATES_PER_BLOCK=6`，
   原来是按时间顺序 / 按**字母序**取前 6 个地点），并把**走不到的位置直接剪掉**；
   legacy 档一行不改（逐位保持）
3. 🔴 **度量在搜索中"看不见"自己的移动** —— 最深的坑：
   `evaluate` 是按块上的 `block.transfer.minutes` 打分的，而 improve 移动块后**没有任何地方重挂提示**
   （`reattachTransfers` 只在 improve 结束后跑一次）。于是无论度量多准，**候选的分数都基于旧位置的数据**
   → 一个移动都不会被接受。修法：aware 档在评估候选前先 `withFreshTransfers()`（复用 `construct.attachTransfers`，
   并**给基线也重挂**一次，否则基线与候选口径不同，移动一律显得"更差"）。

> 为什么 golden 语料测不出这个问题：那些语料里 `construct` 本身就是转场感知的，计划一开始就局部最优
> （实测迭代数 = 1、接受 0 处）。所以本改动用**白盒构造"确实坏掉的初始计划"**（课在远楼、自习紧贴其后）
> 来验证 —— 真实世界里这种坏计划来自「用户锁定块写回后 construct 看不见」或「第一遍用兜底估算」。
>
> 代价与取舍：`improve` 原本声明「与 `construct.ts` 无耦合」，PR-B 有意打破它（只为复用 `attachTransfers`），
> 理由写在 import 处：抄一份必然漂移的副本更糟。

## 三·五、PR-B 具体做了什么（2026-09-19）

`improve` 原来**三层都缺**，缺一层都不生效：

1. **没有数据源** → `ImproveContext` 新增 `transfer?: TransferProvider`，由 `solver` 注入
   （`n.req.transfer`；两遍法的 pass2 正好已把真实 provider 放进 req）
2. **候选排序与路程无关** → `relocateCandidates` / `reassignCandidates` 在 aware 档改为
   **按"与左右邻居的步行分钟"升序**再截断（`MAX_CANDIDATES_PER_BLOCK=6`，
   原来是按时间顺序 / 按**字母序**取前 6 个地点），并把**走不到的位置直接剪掉**；
   legacy 档一行不改（逐位保持）
3. 🔴 **度量在搜索中"看不见"自己的移动** —— 最深的坑：
   `evaluate` 是按块上的 `block.transfer.minutes` 打分的，而 improve 移动块后**没有任何地方重挂提示**
   （`reattachTransfers` 只在 improve 结束后跑一次）。于是无论度量多准，**候选的分数都基于旧位置的数据**
   → 一个移动都不会被接受。修法：aware 档在评估候选前先 `withFreshTransfers()`（复用 `construct.attachTransfers`，
   并**给基线也重挂**一次，否则基线与候选口径不同，移动一律显得"更差"）。

> 为什么 golden 语料测不出这个问题：那些语料里 `construct` 本身就是转场感知的，计划一开始就局部最优
> （实测迭代数 = 1、接受 0 处）。所以本改动用**白盒构造"确实坏掉的初始计划"**（课在远楼、自习紧贴其后）
> 来验证 —— 真实世界里这种坏计划来自「用户锁定块写回后 construct 看不见」或「第一遍用兜底估算」。
>
> 代价与取舍：`improve` 原本声明「与 `construct.ts` 无耦合」，PR-B 有意打破它（只为复用 `attachTransfers`），
> 理由写在 import 处：抄一份必然漂移的副本更糟。

## 三·六、PR-C 具体做了什么（2026-09-19）

**规格级变更**：`lockFactorOf('free')` 由 `0` 改为 `FREE_CHURN_FACTOR = 0.08`（§5.5 已同步修订）。

- 原值 0 的后果：`free` 覆盖**引擎自排的软块**（自习/三餐/活动）→ churn **代价恒为 0**
  →「最小扰动」只有度量、没有驱动力，用户改一次计划仍然全盘重排
  （实测：`tests/churn.test.ts` 里被挤走的块 `churnMin > 0` 而 `cost.parts.churn === 0`）。
- 标定：`soft = 1` 比它强 12.5 倍、`hard = 100` 仍等价于禁止移动；60 分钟挪动 ≈ `0.8 × 0.08 × 60 = 3.84 分`
  —— 远小于一次地点变更（2.0）的破坏力，**不阻止真正的改进**（如省下 20 分转场风险），
  但足以让 improve 在**等价方案**间挑「少动」的那个。
- 与快照的关系：churn 只在**给了 `previousPlan`** 时才计（§5.5），golden 语料不传 → 5 份冻结快照不受影响 ✅
- 测试同步：`tests/churn.test.ts` 断言翻转（free 被挪 ⇒ churn > 0）、
  `tests/p0-check.ts` 期望值更新（`free = 0.08`）、
  `tests/objective-evaluate.test.ts` 改为三级秩序 hard ≫ soft ≫ free > 0，三处都注明「本次修订」。

## 三·七、PR-D（P4）做了什么 —— 以及一个更重要的发现（P8）

### 已完成（行为逐字不变，已用 10 用例指纹对拍 + 109/153 套件验证）

1. **干掉「每个候选重挂一遍转场提示」**：PR-B 时为让评分看见候选的新位置，我在每个候选上调用
   `withFreshTransfers()`（整份计划克隆 + 按天排序 + 重挂提示，O(n log n)）。改为让 `objective`
   **直接向 provider 现算分钟数**（`EvalContext.transfer`）→ 候选评估不再需要任何重挂，
   也**彻底消灭了「提示过期」这一整类问题**（提示只留给 UI 展示用）。
2. 无损微优化：`relocate` 的 `others` 提到候选循环外；`swap` 改为先按天建表（原来每对都要
   `filter` 全表并展开成新数组）。

### 🔴 更重要的发现（P8）：`improve` 在这 5 份语料上**根本没在工作**

排查性能时做了定点二分，结果反转了结论：**保留 `planIsValid` 比换成"只看被改块"快 2.2×**
（5.3ms vs 11.7ms）—— 因为 `planIsValid` **把每一个候选都判为非法**，于是根本不进 `evaluate`。

**证据**（`_probe_p8.ts`，可复现）：

| 语料 | weekendWork | 周末软块（违规） | 整份计划校验 |
|---|---|---|---|
week-04-typical / week-06-practice / week-19-exam / week-04-usertasks | false | **8（违规 8）** | ❌ false |
week-12-crosscampus | false | **10（违规 10）** | ❌ false |

`respectsPolicy` 只对 study/meal/activity 生效，检查「周末 / 18 点后」——而 `construct` 排出的计划
**本来就含周末三餐块**（8~10 个）⇒ 任何候选（哪怕只动一个周三的自习）都会被判非法
⇒ **improve 迭代 1、接受 0 处**。此前那条「常规周已局部最优，接受 0 是正常的」的解释**不成立**：
真实原因是**被校验挡死**。

**我的判断被自己的实验推翻了一次（如实记录）**：我先把校验改成「只看候选改动的块」并在
aware 档启用，预期"改进阶段终于会开始动计划"。**结果：接受数仍为 0、计划逐块不变、cost 完全相同**
（5/5 语料），只是运行时间 ~2×。⇒ 结论修正：

- ✅ 这些计划**确实已经局部最优** —— 「常规周接受 0 是正常的」这个旧解释**成立**；
- ✅ 恒 false 的整份校验**掩盖**了它，而不是致因（它让"无改进"与"没在找"看起来一样）；
- ❌ 所以**不该**为此改校验：没有质量收益，只有 2× 代价。

**真正该警惕的（P8 的保留价值）**：将来若 `construct` 产出「**可改进**」的计划
（例如新算子、锁定块写回后产生坏排布），这个恒 false 的校验会**静默**把改进阶段整个关掉，
而日志上只是"迭代 1、接受 0"，看不出区别。届时的改法（已写进 ADR-010）：
候选级校验 + 保留整份校验作接受前兜底，并**重拍 golden 快照**。

### 量化说明（诚实版，两条独立测量都不支持"大幅提速"）

1. **墙钟计时不可信**：同一份代码连续两次跑差到 **7×**（transfer-aware 一次 64ms、一次 9.8ms）。
2. **确定性指标也不支持**：统计「一次求解里 provider 被调用多少次」——
   **前后完全相同**（如 week-04-typical：legacy 175 / transfer-aware 3561，改动前后一致）。
   原因：provider 是 O(1) 查表，我消掉的是**每候选的整份计划克隆 + 按天排序 + 挂提示**这类
   分配与簿记开销，而 provider 调用次数本身没变（`evaluate` 每候选仍要逐对问一次）。

⇒ 结论：**P4 是行为无损的结构清理（已证明等价），但提速幅度未能量化**；
当前 `improve` 的主要成本仍是「每候选一次 `evaluate`（O(n log n)）」，
真正的下一步是**候选级剪枝**（先用局部代价下界筛掉不可能改进的候选，再决定要不要 `evaluate`），
属于新工作量、且需要与 P8 的校验粒度一起设计。**验收应在空载机器上复测**，口径见「计时口径」小节。

## 四、发布到 engine beta 的验收清单

- [ ] P2 / P3 / P4 完成（P5/P6/P7 已随 PR-A 落地）
- [ ] `npm run eval:gate` 全绿（双端 L0 + L1 + 引擎不变量）
- [ ] `npm run eval:l3 --repeat 3` → pass^3 = 1.0（改评分后计划稳定性不许退化）
- [ ] `tests/` ≥ 99 全绿、`scripts/` 145 全绿、`typecheck` 0 错
- [ ] 新档基线快照另存（`evals/runs/engine_baseline.json` 更新 + 记录 scoring 档位）
- [ ] 决策记录（`docs/decisions.md`）：口径开关、可信度折扣、快照策略
