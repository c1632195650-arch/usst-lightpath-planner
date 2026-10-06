# 习惯与方法库（method_kb v2）· 全面深度验收报告

> 验收执行：MOSS 独立验收批（2026-10-06，zcode /goal）。
> 验收基线：beta-v2 @ b6bc413。范围 = `docs/method-kb-plan-v2.md`（习惯/目标/执行力/自控力/情绪调节扩域）的**内容配套 + 应用接线**全链路。
> 纪律：**全部证据当场独立取证**（不采信交付方自述与历史报告）；关键判据做**反向验证**（拆实现须变红）。

---

## 〇、验收结论：**通过（主体）**——4 项遗留已逐条登记，无阻塞级缺陷

| 维度 | 判定 |
|---|---|
| 内容层（160 条条目、引文、争议标注、黑名单） | ✅ 通过 |
| 检索层（金标 126 条评测 + 守门） | ✅ 独立复跑 GATE PASS |
| 编译链（db → methodParams.generated.ts → methods.ts） | ✅ 零漂移 |
| 应用接线（引擎 knowledge / 移动端 tips / 服务端 study_ctx / 梨宝依据行） | ✅ 通过 |
| 反向验证（守门非假覆盖） | ✅ 2 条红绿实证 |
| 遗留（题库内容、过期注释、v1 禁忌字段、口径数） | ⚠️ 4 项，见 §六 |

---

## 一、内容层审计（独立取证）

### 1.1 计划对账：160/160 全入库 ✅

- `data/method_kb.db` `entries` 表实测 **160 条**（计划目标 ≥160，恰达下限）。
- 任务书 §1（99 条）+ §2（19 条）+ v1 存量（42 条）逐一核对 slug：**全部命中**。
  其中 4 处为**改名入库**（验收时已按语义+引文确认对应关系，非遗漏）：
  | 计划 slug | 实际入库 slug |
  |---|---|
  | `woodhop-mental-contrasting`（B2） | `woop-mental-contrasting` |
  | `goal-psychological-contrasting-neg`（B12） | `psychological-counterfactual-neg`（§3 C-4 同名） |
  | `choice-architecture-default`（D11） | `default-option-effect` |
  | `situationally-cued-behaviour`（A20） | `habit-cue-based-planning`（seg_text 含 Keller 2021 引证） |
- ⚠️ 口径更正：BLOCKERS.md 曾记「161 条」，实测 **160 条**（ AUTOINCREMENT seq=161 含已删条目，非库存量）。
- 结构分布：type principle 92 / method 59 / playbook 3 / discipline 3 / exam 2 / behavior 1；domain 以 psych 79 / behavior 38 / cognitive 19 为主；scope 通用 154。

### 1.2 证据分级与争议纪律 ✅

- tier 分布：**A 28 / B 66 / C 51 / D 15**（与任务书预期结构一致）。
- **contested 9 条**，全部对应任务书 §3 要求：`ego-depletion-contested`、`decision-fatigue-contested`、`habit-research-selfcritique`、`psychological-counterfactual-neg`、`wills-power-model-avoid`、`cold-calls-priming`、`induction-vs-deduction`、`growth-mindset(-small-effect)`。status 字段在编译产物中被**如实保留**（守护测试断言「不得被编译成 verified」——实测绿）。
- 引文完整性：160/160 条 `citation` 均含 `verification` 字段，**零缺失**。分布：verified 36 / canonical 96 / practitioner 28——符合「未复核不写 verified」的纪律（§0）。
- 关键结论抽查：`habit-formation-times` 的 summary 明确写「66 天是中位数、个体差异极大」，与任务书 §0.1 的来源冲突记录一致；`ego-depletion-contested` 写明 Vohs 2021 d=0.06 不显著。**未发现编造卷期页码式引文**。

### 1.3 伪科学黑名单 ✅

`scripts/method_rag.py` `PSEUDO_PATTERNS` 实测 **34 词**（v1 18 + v2 16）≥ 任务书要求的 ≥23；含词形变体补充（`补充葡萄糖`/`两餐之间` 等，源自台架实测假阴性的修正）。配套 `pseudo_correction()` 纠正口径文案在库。

---

## 二、检索层评测（独立复跑，不采信 `_last_run.json`）

```
python evals/method/run.py --gate      # 2026-10-06 验收批独立复跑
golden=126 条（hit=97 reject=18 pseudo=11）
  recall@5         1.0     gate>=0.9  ✅
  mrr              0.7771  gate>=0.6  ✅
  rejection_acc    1.0     gate>=0.85 ✅
  pseudo_block_acc 1.0     gate>=1.0  ✅
[eval:method] GATE PASS ✅
```

- 金标实测 **126 条**（计划 §5 说 124——多 2 条，方向为增，符合「只增不改」纪律；内部自洽 97+18+11=126）。
- 评测台架本身的两次假覆盖修复均已验证在位：①`pseudo_block_acc` 单列（阈值兜底不再冒充黑名单拦截）；②`adversarial_acc` 门禁收紧到 1.0。

---

## 三、编译链一致性 ✅

- 现场重跑 `python scripts/compile_method_params.py` → 与已提交的 `src/data/methodParams.generated.ts` **逐字节零漂移**（唯一差异为 `generated_at` 时间戳）。
- `blocks` 66 个机器参数全部带 provenance（来源条目 slug + 参数键 + tier）；**`FORBIDDEN_STATUS={'contested'}` 编译期硬拦**（compile_method_params.py:166-193）：争议条目不得变成引擎硬参数——代码路径实测存在。
- 「无 willpower 硬参数块」决策按 §3 C-1 落地：methods.ts 无任何「意志力资源量」常量（有守护测试）。
- v2 参数块（habit 12 项 / goal 12 项 / execution 16 项 / WOOP 4 项）与任务书 §6 设计一致，且 `woopRequireObstacle=true` 为硬要求。

## 四、应用接线 ✅（逐点实测）

| 接线点 | 证据 |
|---|---|
| 引擎消费层 `src/lib/planner/methods.ts` | 34 项参数常量 + `methodTipForBlock`（宁缺毋滥返 null / contested 恒置底 / 情境优先级）/ **`methodTipForTimeBlock` 显式 BlockKind 映射**（修掉了 `as never` 真事故：course/meal/commute/blank 不映射） |
| 引擎接线 `knowledge.ts` | import `STUDY_DURATIONS`/`DEEP_WORK` 替代拍脑袆档位 |
| 移动端 tips | `nowTip.ts` → `methodTipForTimeBlock`；`TodayPage.tsx:128` 真实传入当前块；无匹配→插槽不渲染。TIP_TABLE 14 个 slug 实测**全在库** |
| 移动端守护 | `tests/mobile/tipsSlot.test.ts` 6/6 绿；`tests/mobile/evalWiring.test.ts` 7/7 绿 |
| 服务端 | `server/app.py` study_ctx 走 `method_rag.search()`，`METHOD_RAW_LOW` 阈值拒答 + `pseudo_correction()` 纠正口径（代码路径在位；检索质量由金标评测覆盖） |
| 梨宝接缝 | `taxonomy.ts`/`weekPlanForChat.ts` 按红线 6 只引**方法库结论**（deep-work ≤90min、spacing-effect、mcm 72h）作依据行，不直连 db |
| 题库接线 | `questionBank.ts` 机制就绪（sourceSlug 红线、六类≥10 设计），**内容未补**（见 §六-①） |
| 引擎引用完整性 | generated 的 byPhase/byTask 引用 slug 实测**全部存在于库**（无悬垂引用） |

---

## 五、反向验证（红绿实证，验收批亲测）

1. **黑名单守门**：临时删除 `莫扎特` 词 → `evals/method/run.py --gate` 立即 **GATE FAIL**（`pseudo_block_acc` 1.0→0.909，m-adv-03 精确点名「黑名单未命中」）→ 还原复绿。证明伪科学拦截是**词卫兵主动拦截**，不是阈值兜底的假覆盖。
2. **tips 接线**：把 `BLOCK_KIND_TO_METHOD.study` 从 `'assignment'` 改为 `null`（模拟接线断裂）→ `tests/mobile/tipsSlot.test.ts` **2 例变红**（6→4）→ 还原复绿。
   - 附带发现：`tests/eval-tips.test.ts` + `tests/method_params_v2.test.ts`（21 例）在**同款变异下不红**——它们只测方法库自身枚举（与 methods.ts 头注记录的「测自己、不测接线」历史事故同构）。**接线守护当前仅 tipsSlot.test.ts 一处**，建议补 `methodTipForTimeBlock` 直测（§六-④）。
3. 测试还原后全量复核：tipsSlot 6/6、eval-tips+method_params_v2 21/21、method_params_v2+eval-tips+knowledge-wiring+method_params 34/34 绿。

---

## 六、遗留 / 缺陷清单（不阻塞验收主体，逐条登记）

| # | 级别 | 事项 | 状态 |
|---|---|---|---|
| ① | ⚠️ 已知 BLOCKED | **每日弹窗题库内容为空**：`QUESTION_BANK = []`（机制就绪）。任务二/任务四 BLOCKERS 已登记「任务一验收通过后补 ≥60 道」——**本报告即为该前置验收**，题库补做已解锁 | 待补 |
| ② | cosmetic | `questionBank.ts:6` 注释仍写「method_kb.db 现仅 42 条」——实际已 160 条 | 待顺手修 |
| ③ | minor（v1 存量） | v1 老 42 条中 **23 条 `contraindications` 为空**（spacing-effect、pomodoro、deep-work 等）——v2 新条目该字段全满；建议随下次数据批补齐 | 待补 |
| ④ | minor（测试面） | `methodTipForTimeBlock` 的映射守护只有移动端 tipsSlot 一处；方法库自有测试文件对真实 BlockKind 断链不报警（见 §五-2） | 建议补直测 |
| ⑤ | 口径 | 金标 126 vs 计划 124；BLOCKERS「161 条」vs 实测 160——均为记录口径偏差，非数据缺陷 | 本报告已更正 |

**环境注记（非缺陷）**：验收期间 typecheck 出现一过性红字（`EvalSection.tsx` ↔ `units.ts` 的 `inUseDays`），复跑即绿——为**并行会话写盘竞态**（该两文件属另一会话在途修复任务三验收缺陷①，未提交状态）。`preflight` 的 UNRELATED_HISTORIES 为已登记常设阻塞（BLOCKERS.md 2026-10-06 移动端验收条），本批只读+文档提交，未触碰合并。

---

## 七、验收证据索引

- 评测复跑：`evals/method/run.py --gate` 输出（§二，独立于 `_last_run.json`）
- 数据审计：sqlite 直查 `data/method_kb.db`（分布/对账/引文/字段完整性）
- 编译链：重跑 `compile_method_params.py` diff（零漂移）
- 测试：`node --test` method_params(34) / tipsSlot(6) / evalWiring(7)；`npm run typecheck` 0 错；`node scripts/impact.mjs` PASS（受影响 20 测试 0 挂）
- 变异体：§五两条红绿记录（现场执行、现场还原）
