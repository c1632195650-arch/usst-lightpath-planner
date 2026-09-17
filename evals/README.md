# 评测系统（Eval System）· 梨宝

> 2026-09-18 P0 落地。**目标：把「改完有没有变好」从体感问题变成数字问题。**
> 方法论骨架参考 Anthropic《Demystifying evals for AI agents》，指标定义参考
> RAGAS（faithfulness / context precision / context recall / answer relevancy），
> 判分纪律参考 LLM-as-Judge 综述（偏差、校准、置信区间）。

## 一句话总结

**每个真实 bug 变一条永久 task；每次提交跑免费门禁；每晚跑裁判档；每周看趋势。**
（能力集分数应上升；回归集应恒为 100%。）

## 术语（全项目统一，别再造同义词）

| 术语 | 含义 | 我们的对应物 |
|---|---|---|
| Task 任务 | 一条输入 + 期望 | `evals/golden/*.jsonl` 一行 |
| Trial 试次 | 一次尝试（LLM 非确定，需 k 次） | `run.py --repeat k`（P1） |
| Grader 判分器 | 打分逻辑 | `run.py` 规则判分 / `judges/rubrics.md` |
| Transcript 轨迹 | 全过程记录 | `LIBAO_DEBUG=1` 的 trace 行 |
| Outcome 终态 | 环境真实状态 | `mode` / `tools` / 记忆落盘 / 图谱命中 |
| Harness 台架 | 跑评测的基础设施 | `evals/run.py` |
| Suite 套件 | 一类任务集合 | `l0` / `l1` / `e2e` |

**铁律：评结果，不评路径。** 不锁死 agent 必须先调哪个工具，只判答对没有、有没有编、证据对不对。

## 五层金字塔与现状

| 层 | 内容 | 判分 | 状态 |
|---|---|---|---|
| L0 确定性单测（**双端**） | 图谱/拼音/路网/排程/模板直答（后端）+ UI/引擎/类型（前端）+ 判分器回归 | 代码断言，0 成本 | ✅ `--suite l0` |
| **L0+ 引擎独立验收** | 排程引擎不变量（几何/不重叠/课程不漏/转场合规/确定性）+ 性能与转场覆盖 | **CY 侧独立口径**，0 成本 | ✅ `--suite engine` |
| L1 检索评测 | 实体召回、文档 recall@5 / MRR、模板直答正确性 | 代码断言，0 成本 | ✅ `--suite l1` |
| L2 生成评测 | 忠实度 / 相关性 / 完整性 / 分寸 | LLM 裁判 | 🟡 适配器与 rubric 就位（`judge.py`，默认免费档），待人工标注校准 |
| L3 对话级评测 | 多轮、指代、终态（mode/tools/used_space）、诚实性、分寸 | 终态断言 + pass^k | ✅ `--suite l3`（花钱档，5 场景） |
| L4 线上监控 | 真实流量漂移 | 采样过裁判 | 🟡 trace 已落 JSONL + `report.py` 出趋势；采样调用待接 |

### 引擎独立验收（`evals/engine/acceptance.ts`）

**立场**：引擎的实现归 B，但验收不该也交出去。本台架**不复用** `tests/golden-lib.ts` 的校验辅助
（复用等于用被测方的尺子量自己），只借冻结语料与引擎入口，用自己的尺子查不变量：

| 不变量 | 内容 |
|---|---|
| I1 几何合法 | `startMin < endMin` 且落在 [0,1440) |
| I2 日内不重叠 | 同一天任意两块区间不相交 |
| I3 课程不漏 | 本周有课的课程每门至少一个 course 块 |
| I4 转场合规 | `transfer.minutes` 为整数（铁律①）且 ≤ 实际间隔（铁律②）；`tight` 必须为 0 |
| I5 确定性 | 同一输入两次运行可比较内容完全一致 |
| I6 转场覆盖 | 相邻两块地点不同时必须有转场提示（**只在注入 provider 的档位检查**） |
| I7 slack 一致 | `slackMin == 实际 gap − 转场分钟`（防「转场数据与实际排布不一致」） |

**三档变体**（第一版只跑一档时转场恒为 0、I4 形同虚设 —— 这是必须记住的教训）：
`as-is`（语料声明）/ `campus`（跨校区兜底）/ `transfers`（`planWeek` + 注入确定性 provider，唯一真正验到转场的档）。

```bash
npm run eval:engine          # = python evals/run.py --suite engine（含门禁）
node --import ./scripts/register-alias.mjs evals/engine/acceptance.ts --runs 9 --update-baseline
```

- 基线：`evals/runs/engine_baseline.json`（B 每次推「优化」后重跑，看块数/学习时长/转场数/p95 变化）
- ⚠️ **计时对比**：5 轮以内噪声大，Δ<50% 不下结论；定论用 `--runs 9` 看 p50
- ⚠️ **要在干净检出上跑**（B 推送产物 ≠ 你本地工作区）：`git archive <SHA> | tar -x -C <空目录>` 后借 `node_modules`，再在此目录跑上面那条命令 —— 否则你验的是自己的旧磁盘状态

## Golden Set 怎么来的（三段式）

```
gen_silver.py          curate.py              人工（P1）
知识库出题  ──silver──▶  逐条回源校验 ──golden──▶  抽检 20 条 + 补软期望
（150+ 条候选）        （准入 4 规则）        （此后每次真实 bug 回填一条 task）
```

- **回源校验**：POI 名必须真在图谱、★ 数值必须在正文里逐字出现、否定样本必须在图谱与语料**双向**确证不存在。
- **分层配额**：正常路径 20 / 边缘 16 / 对抗 10 / 高权重失败 12（防止题集退化成简单题大集合）。
- **两种 split**：
  - `regression` 真值硬、可本地校验 → **进 CI 门禁**（必须 100%）
  - `capability` 期望较软（如主题召回）→ **只记录趋势，不门禁**
- **版本化**：`golden_v1.jsonl`，与 prompt / 模型版本一起记录；改动即升版本。

## 门禁阈值

| 门禁 | 阈值 | 跑在 |
|---|---|---|
| L0 双端套件 | **100%** | 每次提交 |
| 实体召回 entity_recall | **1.00** | 每次提交 |
| 模板直答 template_acc | **1.00** | 每次提交 |
| 文档 recall@5 | **≥ 0.90** | 每次提交 |
| 违禁词命中（must_not_include） | **0** | 每次提交 |
| 忠实度 faithfulness | ≥ 0.95 | 每晚（P1） |
| P95 延迟 / 单次成本 | 不超基线 20% / 30% | 每晚 |

对用户可见路径用 `pass^k`（k 次**全**对）而不是 `pass@k` —— 校园助手「多试几次能对」没有意义。

## 命令

```bash
python evals/gen_silver.py                 # ① 生成 silver 候选
python evals/curate.py                     # ② 校验 → golden_v1.jsonl
python evals/run.py --suite all --gate      # ③ 提交前：双端 L0 + L1（0 成本，≈25 秒）
python evals/run.py --suite l1 --update-baseline   # 指标提升后确认新基线
python evals/run.py --suite l3 --repeat 3 --gate   # 夜间档：对话级 pass^3（花钱）
python evals/run.py --suite e2e --base http://127.0.0.1:8000   # 夜间档（花钱）
python evals/judge.py --selftest            # 裁判自检（不发请求）
python evals/calibrate.py --init            # 生成 20 条待人工标注 → 填 human 字段
python evals/calibrate.py --provider ollama # 校准（一致率 >70%、ρ>0.75 才可进 CI）
python evals/report.py                      # 趋势报告（门禁指标 + 流量分位数）
```

npm 别名：`eval:l0` / `eval:l1` / `eval:l3` / `eval:gate` / `eval:all` / `eval:silver` / `eval:curate` / `eval:judge` / `eval:calibrate` / `eval:report`

### 裁判（L2/L4）怎么开

默认 `--provider none`：**一分钱不花**，只跑通管线。要真判分时二选一：

| provider | 成本 | 前置 |
|---|---|---|
| `ollama` | 免费 | 自行安装 Ollama（默认 `qwen2.5:7b-instruct`） |
| `deepseek` | 付费 | 复用 `server/.env` 的 Key；受 `JUDGE_MAX_CALLS`（默认 30）硬上限保护 |

**未通过校准前不许把裁判接进 CI** —— 校准结论不允许靠 <10 条样本得出。

## P1 实测抓到的四个真问题（评测的价值就在这）

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| 1 | 「学校里有**图书馆（图文信息中心）**吗」白花钱走 LLM | 触发词窗口 `有.{0,8}吗` 太窄，官方长名匹配不到 | 放宽到 `{0,14}`（test_direct 固化） |
| 2 | 「三教**附近有啥**近的食堂吗」被模板拦下 → 只答单个地点，**答非所问** | `有…吗` 把就近推荐误判成存在性 | `_BLOCK` 增加 `附近/周边/最近/哪个/哪家/有啥` |
| 3 | 「那它几点开门」掉出 L0 白花钱 | 追问句本身没有实体 | 允许**借上文实体**（三道闸门：本句无实体 + 有指代词 + ≤14 字） |
| 4 | 「学校有没有瑞幸」被答成 **1906 咖啡厅** | 借上文实体时吃到了**梨宝自己上一轮回答**里的实体（上下文劫持） | ①`_ANAPHORA` 收窄 ②L3/L1 的 `session_id` 加运行号（每个 trial 干净环境） |

**断言本身也迭代了三次**（都是被假红逼出来的，值得记住）：
诚实性判定从「全局否定词」→「同句含实体+方位词」→ **「方位词必须贴着品牌才算编造」**。
中间两次都把诚实回答误判成不诚实（「也没星巴克」、「没查到瑞幸嗷，只翻到一家『1906咖啡厅』（军工路516号…）」——
后者把替代地点的地址算到了品牌头上）。结论：**编造判定从严（贴邻归属），否定判定从宽（全篇）**。

## 目录

```
evals/
├── gen_silver.py     silver 生成器（知识库自己出题）
├── curate.py         策展器（回源校验 + 双配额 + 版本化）
├── run.py            台架（l0 / l1 / l3 / e2e，门禁与基线对比、pass^k）
├── judge.py          裁判适配器（none 免费档 / ollama / deepseek，零依赖）
├── calibrate.py      裁判校准（一致率、Spearman ρ、样本不足拒绝下结论）
├── report.py         趋势报告（门禁指标趋势 + 流量分位数与成本估算）
├── test_judge_rules.py  判分器回归（14 例，含 5 条反向验证）
├── silver/           候选（append-only，gitignore）
├── golden/           golden_v1.jsonl ← CI 依赖的唯一数据集
├── tasks/            l3_scenarios.jsonl（对话级场景）
├── judges/           裁判纪律 + rubric + labels.jsonl（人工标注）
└── runs/             门禁明细与基线（baseline.json 进仓库）＋ trace_*.jsonl（gitignore）
```

## 与既有脚本的关系（不重复造）

| 既有 | 在体系里的位置 |
|---|---|
| `scripts/test_campus.py` / `test_direct.py` / `test_rag.py` | L0 子套件，由 `run.py` 统一调用 |
| `npm test:ui` / `test:engine` / `typecheck` | L0 前端半边，同上 |
| `scripts/fact_probe.py` | 高权重幻觉门禁（`--gate`），选题逻辑已抽到 `gen_silver.py` |
| `scripts/test_libao.py` | L3 对话套件雏形，P1 升级为「终态断言 + pass^k」 |
| `LIBAO_DEBUG` trace | Transcript 标准格式，P2 落 JSONL 供 L4 采样 |

## 下一步（P2）

1. `run.py --suite e2e --judge local`：把裁判接进夜间档（先装 Ollama 或接受付费），并用 `calibrate.py` 的 20 条人工标注过校准
2. L4 采样：从 `trace_*.jsonl` 按 1~5% 抽流量过裁判，点踩/追问信号回填 golden（**每个真实 bug 当天变一条 task**）
3. 能力题毕业机制：`pass^k=1` 且稳定的 capability 场景移进 regression 并长期门禁
4. 延迟/成本门禁：把 P95 与单次成本纳入 `run.py` 的阈值比较（report.py 已有数据）
