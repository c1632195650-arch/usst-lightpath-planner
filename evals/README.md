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
| L0 确定性单测（**双端**） | 图谱/拼音/路网/排程/模板直答（后端）+ UI/引擎/类型（前端） | 代码断言，0 成本 | ✅ 已接入 `--suite l0` |
| L1 检索评测 | 实体召回、文档 recall@5 / MRR、模板直答正确性 | 代码断言，0 成本 | ✅ 已接入 `--suite l1` |
| L2 生成评测 | 忠实度 / 相关性 / 完整性 | LLM 裁判 | 🟡 rubric 已固化，接口待接（P1） |
| L3 对话级评测 | 多轮、工具选择、记忆、人设与分寸 | 终态+轨迹+rubric | 🟡 现有 `test_libao.py` 作为雏形 |
| L4 线上监控 | 真实流量漂移 | 采样 1~5% 过裁判 | ⬜ P2 |

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
python evals/run.py --suite all --gate      # ③ 提交前：双端 L0 + L1（0 成本，≈1 分钟）
python evals/run.py --suite l1 --update-baseline   # 指标提升后确认新基线
python evals/run.py --suite e2e --base http://127.0.0.1:8000   # 夜间档（花 LLM 的钱）
```

npm 别名：`npm run eval:l0` / `eval:l1` / `eval:gate` / `eval:all`

## 目录

```
evals/
├── gen_silver.py     silver 生成器（知识库自己出题）
├── curate.py         策展器（回源校验 + 分层配额 + 版本化）
├── run.py            台架（L0/L1/e2e，门禁与基线对比）
├── silver/           候选（append-only，每次生成带日期）
├── golden/           golden_v1.jsonl ← CI 依赖的唯一数据集
├── judges/           裁判纪律 + rubric（P1 接模型）
└── runs/             每次运行的 metrics 与逐题明细 + baseline.json
```

## 与既有脚本的关系（不重复造）

| 既有 | 在体系里的位置 |
|---|---|
| `scripts/test_campus.py` / `test_direct.py` / `test_rag.py` | L0 子套件，由 `run.py` 统一调用 |
| `npm test:ui` / `test:engine` / `typecheck` | L0 前端半边，同上 |
| `scripts/fact_probe.py` | 高权重幻觉门禁（`--gate`），选题逻辑已抽到 `gen_silver.py` |
| `scripts/test_libao.py` | L3 对话套件雏形，P1 升级为「终态断言 + pass^k」 |
| `LIBAO_DEBUG` trace | Transcript 标准格式，P2 落 JSONL 供 L4 采样 |

## 下一步（P1）

1. 接 DeepEval（Apache-2.0，pytest 原生）把所有 L0 套件包成 `pytest evals/`
2. `run.py --suite e2e --judge local`：本地 Ollama 裁判 + 20 条人工标注做校准（一致率 >70%、ρ>0.75 方可进 CI）
3. L3 加终态断言与用户模拟器（多轮追问、对抗输入）
4. trace 落 JSONL（含 tokens/成本），出周报
