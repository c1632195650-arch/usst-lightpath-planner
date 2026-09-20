# 方法知识库（method_kb）· 方案与落地记录

> 2026-09-20 定稿。状态：**M0–M4 全部落地，eval:method 门禁 PASS**。
> 代码位置：`scripts/method_kb_data.py`（数据）｜`scripts/method_rag.py`（检索）｜
> `scripts/build_method_kb.py`（建库）｜`scripts/compile_method_params.py`（编译）｜
> `src/data/methodParams.generated.ts` + `src/lib/planner/methods.ts`（引擎消费层）｜
> `evals/method/`（金标 + 台架）。

## 0. 为什么需要它

产品唯一核心是排程，而排程背后是时间规划的科学：怎么学理科、怎么备赛（数模）、
底层是脑科学 / 心理学 / 认知科学。上理库（`usst_articles.db`）回答「学校有什么」，
**方法库回答「该怎么学」** —— 两者的时效语义、可信度体系、检索粒度全部不同。

## 1. 关键决策：独立存储，不与上理库合并

| 冲突点 | 上理库 | 方法库 |
|---|---|---|
| 时效语义 | 越新越好（90 天内不衰减） | 经典不衰减（间隔效应 1885 年依然成立） |
| 路由阈值 | 0.68/0.56 | 0.60/0.50（15 条查询实测校准） |
| chunk 粒度 | 通知细切 | 整条保结构（原理/步骤/参数一体） |
| 可信度 | 来源即可信 | evidence_tier A–D + verified/contested |

**实证（evals/method/_mutation2_contaminate.py，2026-09-20）**：把 42 条方法条目以
「今日文章」灌进上理库副本 → 3/20 方法类查询被上理库路由劫持（top3 raw_vec 0.68+），
库外校园查询不受影响 ⇒ **合并 = 上理库把学习方法当官方知识直答**，分离是正确性要求。

## 2. 数据模型（42 条 + 12 元能力 + 5 任务）

- 层级：L0 认知原理 20 ｜ L1 学习方法 11 ｜ L2 学科方法 3 ｜ L3 竞赛打法 5 + L3 任务权重 5。
- 字段：slug / type / domain / discipline_scope / title / summary / principle / steps /
  **parameters**（机器可消费参数）/ applicable_when（phase/task）/ contraindications /
  **evidence_tier（A 元分析 · B 一致实证 · C 教科书共识 · D 从业者经验）** /
  citation（含 verification: verified/canonical/practitioner）/ status（verified/contested/deprecated）。
- **伪科学黑名单不入库**：学习风格(VAK)、左右脑、10%大脑、学习金字塔百分比、
  莫扎特效应、速成神话 —— 见 `method_rag.PSEUDO_PATTERNS`（词面守门，宁枉勿纵，
  误伤率由金标集盯着）。

## 3. 运行时链路（两条，互不干扰）

**对话侧（知识解释）**：`method_rag.search()`（FTS5 0.4 + 向量 0.6，无衰减，
阈值 0.60/0.50 独立）→ `app.py::study_context()`（低于 METHOD_RAW_LOW 不注入）→
`llm_answer(study_ctx=…)` 注入「学习方法参考」块（只可引用给定文献、争议条目只作提示、
**不是上理官方口径**）。路由 `route` 语义不变；命中方法库时 `llm → hybrid`，
返回 `used_study / study_sources`。

**引擎侧（参数决策，构建期）**：`compile_method_params.py` 显式映射
（缺条目/缺键/类型错/deprecated ⇒ **直接报错，不许静默缺省**）→
`methodParams.generated.ts`（勿手改）→ `methods.ts` 纯消费层
（STUDY_DURATIONS / REVIEW_INTERVALS / EXAM_SPRINT / SLEEP_GUARD / DEEP_WORK / POMODORO +
methodSlugsForPhase / methodCardsForPhase / examSprintStep 等纯函数）。
为什么走编译：引擎铁律 = 纯函数、不 fetch、不读时钟 ⇒ 知识必须在**构建期**变常量。

## 4. 评测门禁（eval:method，0 LLM 成本，~2s）

金标 `evals/method/golden_v1.jsonl` 50 条 = 正常 20 / 边缘 12 / 对抗 10（伪科学拒答 6 + 刁钻必中 4）/ 库外拒答 8。

| 指标 | 基线 | 门禁 |
|---|---|---|
| recall@5 | 0.9722 | ≥0.90 |
| MRR | 0.7963 | ≥0.60 |
| rejection_acc | 1.0000 | ≥0.85 |
| adversarial_acc | 1.0000 | ≥0.90 |

已知未达标条目（真缺口，如实记录）：`m-edge-06 完全提不起学习的劲` —— 口语化动机
表述召回不到 自我决定论/拖延 条目（recall@5 0.97 里的唯一 miss）。

**三处反向验证（关实现必变红，均已执行）**：
1. **编译链**：改 `method_kb_data.py` 番茄 durations 25/50→30/10 → 重灌 → 重编译 →
   `tests/method_params.test.ts` 红（actual [30,10]）→ 恢复 → 绿 5/5。
2. **分离必要性**：42 条灌进上理库副本 → 3/20 路由劫持（见 §1）。
3. **拒答护栏**：`METHOD_RAW_LOW=0` → 8/8 库外泄漏，rejection_acc 0.43，GATE FAIL。
   附：伪科学词卫兵独立生效（LOW=0 下 adversarial_acc 仍 1.0）。

## 5. 归属与待办

- ⚠️ `src/lib/planner/methods.ts` 位于 Ray 所有目录 —— CY 新增叶子模块（不 import templates），
  **需与 Ray 打招呼复核归属与命名**。
- P3 待办（**2026-09-20 晚全部完成**）：
  ① **纠正口径** ✅ —— `method_rag.py::pseudo_correction()`（LLM 提示块）+
     `pseudo_correction_plain()`（extractive 降级直拼）；`app.py` 注入【纠正口径】块、
     响应加 `study_pseudo` 字段。文案由 `_PSEUDO_FACTS` 常量驱动，不让 LLM 自由发挥。
  ② **显式消费点** ✅ —— `weekPlanForChat.ts::methodAdviceForChat()`（phaseToMethod
     映射 + `methodCardsForPhase` + 冲刺周 `examSprintStep`）；`LbaoChat.tsx` 排程回复
     追加方法建议。周计划页方法卡（WeekPlanView，Ray 目录）留待协调。
  ③ **口语扩展** ✅ —— `COLLOQUIAL_EXPAND` 5 组确定性映射 + `expand_query()`。
     终态金标 **recall@5 1.0｜MRR 0.8287｜rejection 1.0｜adversarial 1.0**。
     教训：「记不住」扩展在 抽象/概念/原理/理解 语境不触发（否则劫持 m-normal-14）。
  ④ **_full 门禁** ✅ —— 全部产物同步进 `_full`；`evals/run.py` 加 `method` 套件
     （进 `--suite all`）+ l0 加 `test:method_params`；`eval:method` npm 脚本 +
     alias-hook 同款修复。`--suite method --gate` 全绿 exit 0。
