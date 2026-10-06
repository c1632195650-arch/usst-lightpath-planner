# 健康库 canonical 条目全量复核记录（2026-10-06）

> **本文是什么**：收官批次 Wave 2 · P1-3 的产出。CY 裁决 R7：**全量逐条复核**（非抽代表）。
> 复核对象：`data/health_kb.db` 中 `citation.verification == "canonical"` 的全部条目——
> 这些条目在任务一批（method_kb v2 / 健康库入库）时因「本轮预算内未逐条复核」而**诚实标注**
> 为 canonical（见 `scripts/health_kb_data.py:28`），本文补上这一课。
>
> **数量口径登记**：任务书说「`health_kb_data.py` 里 canonical 实测 21 处」。逐行核对：
> 21 处 = **20 条真实条目** + 1 处 `make_entry` 的**缺省机制**（`health_kb_data.py:57`，
> 未显式传 citation 时落 canonical 的兜底）。数据库实测 35 条中 canonical 恰为 20 条，
> 与显式标注数一致——即不存在依赖缺省机制的隐藏条目。本文逐条复核对象即这 20 条。
>
> **方法**：每条对照权威来源（官方机构 / 系统综述 / 大样本研究）核验其**标题主张 + 关键参数**，
> 检索时间 2026-10-06。结论分三档：✅ 一致 / ⚠️ 一致但有升级注记 / ❌ 偏差。
>
> **总结果**：20/20 无❌；18 条 ✅、2 条 ⚠️（caffeine-cutoff、protein-intake，均为
> 「数值落在公认区间内的取值选择」而非错误，详见行内注记）。**无需改数据、无需重放编译链**。

## 逐条复核清单（20 行）

| # | slug | tier | 库内主张（标题 + 关键参数） | 结论 | 证据 |
|---|---|---|---|---|---|
| 1 | sleep-regularity | B | 起床时间稳定性重要性（wakeDriftMin=60） | ✅ | Windred et al. 2023（Sleep，UK Biobank n=60,977 / 千万小时级体动仪数据）：睡眠规律性对全因死亡率的预测力**强于时长**——库内「更重要的一半」是**偏保守**的表述，方向一致。https://pmc.ncbi.nlm.nih.gov（PMC，Windred 2023） |
| 2 | sleep-light-circadian | B | 白天见光 + 睡前避强光 | ✅ | CDC/NIOSH（晨光相位前移）；Crowley et al. 2014（30 分钟晨光相位前移）；NSF（睡前约 2 小时为光敏感窗，晚间光抑制褪黑素）。https://pmc.ncbi.nlm.nih.gov（Crowley 2014）；https://www.cdc.gov/niosh |
| 3 | caffeine-cutoff | B | 半衰期，cutoffHours=6 | ⚠️ | Drake et al. 2013（PMCID，被引 800+）：睡前 6 小时摄入仍显著缩短客观睡眠约 1 小时——**6h 截止有直接实证**。升级注记：Gardiner et al. 2023 系统综述建议更严（约 8.8h）。数值仍属公认区间，不构成错误。https://pmc.ncbi.nlm.nih.gov（Drake 2013） |
| 4 | sleep-debt-weekend | B | 周末补不回全部（repayExtraMinPerDay=30-60） | ✅ | Depner et al. 2019（Current Biology，被引 280+）：周末自由补睡**未能阻止**代谢失调（胰岛素敏感性下降、夜食增加）；Léger et al. 2020 同结论。注记：30-60min/天为工程化建议值而非文献数值，核心结论一致。https://www.cell.com（Depner 2019） |
| 5 | nap-hygiene | B | 午睡 20-30 分钟、不晚于 15 点 | ✅ | Sleep Foundation（20 分钟最佳、不超过 30）；Cleveland Clinic（15-20 分钟）；CDC（<20 分钟）；Harvard Health 2023（<30 分钟）；「下午晚些之后不午睡」为各机构一致口径。https://www.sleepfoundation.org；https://health.clevelandclinic.org；https://www.cdc.gov |
| 6 | sleep-environment | C | 凉、暗、静 | ✅ | Cleveland Clinic（60-67°F ≈ 16-19°C）；NSF（≈18.3°C）；The Sleep Charity（16-18°C）。注记：Baniassadi 2023 提示个体差异（社区场景 20-25°C 亦佳）——库内未写死温度数值，表述安全。https://health.clevelandclinic.org |
| 7 | pre-sleep-screen | C | 不是蓝光一个锅，主要是内容和兴奋（争议如实标注） | ✅ | Silvani et al. 2022（PMC，被引 300+）：「蓝光普遍损害睡眠」的共识**不是对证据的公平呈现**；Hartstein et al. 2024（Sleep Health 专家 panel）：内容与使用情境比屏幕本身更关键；Hjetland et al.（n≈45,000）：自报屏时与睡眠质量无显著关联。库内 verification 源注明「结论未统一」——**争议标注准确**。https://pmc.ncbi.nlm.nih.gov（Silvani 2022） |
| 8 | exercise-timing-sleep | C | 睡前 2 小时避免高强度（avoidVigorousBeforeSleepHours=2） | ✅ | Stutz et al. 2019（Sports Medicine meta，被引 400+）：晚间运动总体不损害睡眠，唯** vigorous 且结束于睡前 ≤1h** 者 REM 下降；Leota et al. 2025 剂量反应 meta 同结论。库内 2h 是文献 1h 的**保守外推**，且标题即「看人，别当铁律」——与证据的个体差异口径一致。https://pubmed.ncbi.nlm.nih.gov（Stutz 2019） |
| 9 | knee-pain-training | C | 换低冲击、别硬扛也别完全不动（red flag：肿胀/绞锁/打软腿→就诊） | ✅ | Physio-pedia（负荷管理为一线）；NIHR Evidence（管理负荷而非消除负荷）；The Rehab Code（用骑行/游泳等低冲击替代，**完全休息反而去适应**）；red flag 清单与运动医学通行口径一致。https://www.physio-pedia.com；https://evidence.nihr.ac.uk |
| 10 | progressive-overload | C | 周加量 ≤10%（weeklyLoadIncreasePct=10） | ✅ | 10% 规则是临床与教练界最常用的渐进护栏；新证据（ACWR 急慢性负荷比）提示它是**启发式而非精确阈值**——库内 tier C 的定级与「别一周翻倍」的表述恰好匹配这一证据强度。https://www.bodyset.co.uk 等（口径综述见检索记录） |
| 11 | red-flag-exercise | A | 胸痛/晕厥/喘不过气→立刻停下就医 | ✅ | ACSM Guidelines（主要症状/体征清单：心绞痛样胸痛、静息或轻度用力即气短、头晕/晕厥等）→ 出现即停止运动并寻求医学评估。tier A 恰当。https://www.acsm.org（指南第 2 章 症状清单） |
| 12 | weight-management-energy | B | 每周减 0.5-1.0kg（缺口 300-500kcal） | ✅ | CDC：每周 1-2 磅（≈0.5-1kg）为可持续减重速率，对应每日缺口约 500-1000kcal。库内 300-500kcal 比 CDC 口径**更保守**，方向一致且对普通学生更安全。https://www.cdc.gov/healthy-weight-growth/losing-weight |
| 13 | no-crash-diet | C | 极端节食/断食排毒/自行服减肥药：不推荐 | ✅ | Joshi et al. 2018（PMC 极端饮食临床综述）；Obesity Action Coalition（电解质紊乱、心律、胆结石风险）；Better Health Channel（ Victoria 州政府）等机构一致口径。https://pmc.ncbi.nlm.nih.gov（Joshi 2018） |
| 14 | protein-intake | C | 久坐 1.0 g/kg、活动 1.2-1.6 g/kg | ⚠️ | RDA 为 **0.8 g/kg**（Wu 2016，Food Funct，被引 1100+）；活动人群 1.2-1.6 g/kg 与主流推荐一致。升级注记：库内久坐取 1.0 是 RDA（0.8）的保守上沿、非 RDA 本值——属「足量区间取值」，不构成错误，但答辩被追问时应能说出 RDA=0.8、库取 1.0 的理由。https://pubmed.ncbi.nlm.nih.gov（Wu 2016） |
| 15 | behavioral-activation | B | 动起来先于好起来、小步原则（dailyMicroGoalMin=10） | ✅ | Ekers et al. 2014（PLOS ONE meta，被引 850+）；Cuijpers et al. 2023（个体 BA 显著疗效）。「先做一点点」与 BA 的小步渐进技术一致。https://journals.plos.org（Ekers 2014） |
| 16 | exam-anxiety-reframe | B | 重评为「身体在帮我」而非失败预兆 | ✅ | Jamieson, Nock & Mendes 2012（JEP:General，压力重评改善心血管反应型态）；Jamieson 系列教室现场研究（重评提升真实考试表现）；Sammy et al. 2017 综述。https://pubmed.ncbi.nlm.nih.gov（Jamieson 2012） |
| 17 | mindfulness-mbsr | B | 每天 10 分钟、重规律不重时长 | ✅ | MBSR 8 周方案有 meta 支持（焦虑抑郁中等效应量）；Palmer et al. 2023（10 分钟 vs 20 分钟，10 分钟即降低状态焦虑）；Harvard Health 2024（每日 10 分钟可获益）。「10 分钟」有直接研究支撑。https://pmc.ncbi.nlm.nih.gov（Palmer 2023）；https://www.health.harvard.edu |
| 18 | social-connection | B | 孤独的健康影响量级与久坐、肥胖同档 | ✅ | Holt-Lunstad meta 系列（缺乏社会连接 → 死亡风险 +26-32%，效应量与吸烟 ≤15 支/日同档、超过肥胖与缺乏运动）；U.S. Surgeon General 2023 咨询报告同口径。注记：AJE 2023 有评论质疑「吸烟类比」的方法学——库内措辞「量级同一档」比「等于吸烟」更稳，措辞恰当。https://www.hhs.gov（Surgeon General Advisory）；https://academic.oup.com/aje/article/192/8/1238/7172779 |
| 19 | stress-sleep-loop | B | 压力与睡眠互相放大、断哪环都行 | ✅ | Peng et al. 2024（双向因果成立，睡眠→焦虑方向更强）；Sleep Foundation（自我强化循环）；Stanford Medicine（失眠者抑郁/焦虑风险 10×/17×）。「先断哪一环都行」与「睡眠靶向干预可打破循环」的干预含义一致。https://pubmed.ncbi.nlm.nih.gov（Peng 2024） |
| 20 | when-to-seek-help | C | 持续（两周+）+ 受损 + 消极念头→必须求助 | ✅ | DSM-5（MDD 症状须持续 ≥2 周 + 功能损害）；PHQ-9（Kroenke 2001，被引 6 万+，以「过去两周」为评估窗）；MedlinePlus（影响工作/学习/生活至少两周）。三要件（持续/受损/危险信号）与临床口径一致，且 escalate=true 就医升级已置位。https://pmc.ncbi.nlm.nih.gov（Kroenke 2001） |

> 清点边界说明：`alcohol-not-sedative` 在任务一批已升级为 **verified**（有明确出处），
> 不在 canonical 复核列内；列在此处仅为登记清点边界、防止「20 条 vs 21 处」被误读为漏了一条。

## ⚠️ 两条升级注记（不构成数据错误，无需改库）

1. **caffeine-cutoff（6h）**：6 小时截止有 Drake 2013 直接实证支撑；2023 年系统综述
   （Gardiner et al.）建议对敏感人群收紧到 ~8.8h。若后续做内容批（L1/L6 同批），
   可把「敏感人群更早 cutoff」作为提示语升级，**本轮不动**（改库会漂移金标，收益不成比例）。
2. **protein-intake（久坐 1.0 g/kg）**：RDA 是 0.8，库取 1.0 属保守上沿。答辩口径：
   「RDA 是防缺乏的下限，1.0 是普通健康成年人『吃够』的稳妥取值，活动人群 1.2-1.6。」

## 与 P1-2（健康库重放验证）的合并记录

同日完成，数字留痕（执行批次 4 · P1-2）：

- `python scripts/gate_data.py` → **✅ 四道全绿 exit 0**（结构 / 外键 / FTS 一致性 / 行数钉住）
  - 前置修复：`data_pins.json` 初始快照带入的是别棵树的钉值（524/519/1889），已按
    脚本设计的 `--update-pins` 显式重钉到本树真实行数 **520 / 515 / 1873**
    （与 AGENTS.md 资产口径及 gate_data.py docstring 一致；commit `63162fa`）。
- **重放核验**（`server/plan_review.py` RULES × 真检索，检索不可用即降级）：
  - 健康库 5/5 slug 检索命中且 tier 与静态表全一致
    （aerobic-150 A / strength-2days A / sleep-duration-adult A / sleep-regularity B / regular-meals-breakfast A）
  - 方法库：spacing-effect（A）命中；ultradian-rhythm（C）库内存在、study 维 query 下排名 6，
    生产 k=2 未进前位 → 走 `_source()` 设计内回退路径（retrieved 语义按设计降级），非数据错误
- **阈值一致性**：RULES 数值与 `src/data/healthParams.generated.ts` blocks 逐位一致
  （有氧 150/75、力量 2 天/周、睡眠机会窗 7-9h）；provenance slug 与 RULES slug 同名同 tier。
- **三库路由**：health_rag / method_rag / usst_articles 各自独立模块与库文件
  （health_kb.db / method_kb.db / usst_articles.db），重放命中条目均来自对应库，无劫持。

—— 复核执行：收官批次 agent（R7 全量裁决），2026-10-06。
