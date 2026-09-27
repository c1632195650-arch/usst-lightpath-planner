# 梨宝 understand 端点 · 金标评测报告

> 金标：`evals/golden/plan_understand.jsonl`（60 条 = 30 intent + 20 answer + 10 boundary）。
> 2026-09-27 CY 复核三条结论已落地（见「复核落地」节）；金标文件本体未改。

## 两个口径（都看，别混）

| 口径 | 含义 | action F1 | 槽位 EM | 门槛 |
|---|---|---|---|---|
| **端点能力**（直判） | 端点自身判 action/抽槽的能力 | **1.0** | 0.923（逐槽） | ✅ F1≥0.95 且 EM≥0.90 |
| **生产链路**（规则先行） | 生产真实路径：looksLikeAction 闸 → 规则槽位 → LLM 只补空 | 0.868 | 0.93（TP 条目） | F1 未过——缺口在闸门不在端点 |

- 生产链路的 7 条 FN（i02/i15/i21/i23/i25/i29/i30）全部是 `looksLikeAction` 关键字闸拦下、
  端点直判参考线 **1.0** 能接住的无关键词句（含诉求④原句 i02「我周五下午要在学生会面试」）。
  → 要不要把「规则拒绝但疑似排程」的句子送端点复判，是设计决策，已记 BLOCKERS 待 CY 拍板。
- answer 0.962（25/26，双侧归一后 a09 稳定命中）；唯一未命中 a17 是「逗号分隔两问」——
  位置协议不猜位，生产只收 when、重问 effort，属正确行为。
- ③ 端点偶发 8s 超时：ok:false → 生产回规则结果（评测同口径计分、不重试），兜底正常。

## 复核落地（CY 2026-09-27 三条）

1. **a09**：未改金标。评测改为双侧同归一（金标片段与预测片段都过规则层 canon——
   生产落库的本来就是归一值）+ 规则先行（模糊回答 VAGUE_WHEN 直接命中，不依赖 LLM）。
2. **i30**：金标 4 次/周维持（与规则层 extractFrequency 一致）；评测改为生产忠实——
   规则已抽槽位随请求传端点、合并只补空；「不传规则槽位才有的噪音」消除。
3. **8s 超时**：不改码；评测口径固化为「ok:false 回规则结果继续计分」。


## 评测运行 · 2026-09-27 18:49

### 离线对照（规则层，无 LLM）
- action P/R/F1 = 1.0 / 0.767 / 0.868（TP 23 · FP 0 · FN 7 · TN 10）
- FP: []｜FN: ['i02', 'i15', 'i21', 'i23', 'i25', 'i29', 'i30']
- intent 槽位 EM = 0.827（逐槽）/ 0.69（逐条）
- answer 槽位命中率 = 0.333（9/27）


## 评测运行 · 2026-09-27 18:53

### 在线（LLM understand）
- 端点 ok 率：0/60
- action P/R/F1 = 0.0 / 0.0 / 0.0（TP 0 · FP 0 · FN 30 · TN 10）
- FP: []｜FN: ['i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07', 'i08', 'i09', 'i10', 'i11', 'i12', 'i13', 'i14', 'i15', 'i16', 'i17', 'i18', 'i19', 'i20', 'i21', 'i22', 'i23', 'i24', 'i25', 'i26', 'i27', 'i28', 'i29', 'i30']
- intent 槽位 EM = 0.0（逐槽）/ 0.0（逐条）
- answer 槽位命中率 = 0.0（0/27）
- 门槛（action F1≥0.95 且 槽位 EM≥0.90）：❌ 未过


## 评测运行 · 2026-09-27 18:58

### 在线（LLM understand）
- 端点 ok 率：60/60
- action P/R/F1 = 1.0 / 0.967 / 0.983（TP 29 · FP 0 · FN 1 · TN 10）
- FP: []｜FN: ['i21']
- intent 槽位 EM = 0.827（逐槽）/ 0.759（逐条）
- answer 槽位命中率 = 0.0（0/27）
- 门槛（action F1≥0.95 且 槽位 EM≥0.90）：❌ 未过


## 评测运行 · 2026-09-27 19:00

### 在线（LLM understand）
- 端点 ok 率：60/60
- action P/R/F1 = 1.0 / 1.0 / 1.0（TP 30 · FP 0 · FN 0 · TN 10）
- FP: []｜FN: []
- intent 槽位 EM = 0.923（逐槽）/ 0.862（逐条）
- answer 槽位命中率 = 0.926（25/27）
- 门槛（action F1≥0.95 且 槽位 EM≥0.90）：✅ 过


## 评测运行 · 2026-09-27 19:33

### 在线（LLM understand）
- 端点 ok 率：57/60
- action P/R/F1 = 1.0 / 1.0 / 1.0（TP 30 · FP 0 · FN 0 · TN 10）
- FP: []｜FN: []
- intent 槽位 EM = 0.966（逐槽）/ 0.931（逐条）
- answer 槽位命中率 = 0.852（23/27）
- 门槛（action F1≥0.95 且 槽位 EM≥0.90）：✅ 过


## 评测运行 · 2026-09-27 19:45

### 在线（LLM understand）
- 端点 ok 率：59/60
- action P/R/F1 = 1.0 / 0.967 / 0.983（TP 29 · FP 0 · FN 1 · TN 10）
- FP: []｜FN: ['i17']
- intent 槽位 EM = 0.931（逐槽）/ 0.897（逐条）
- answer 槽位命中率 = 0.926（25/27）
- 门槛（action F1≥0.95 且 槽位 EM≥0.90）：✅ 过


## 评测运行 · 2026-09-27 19:48

### 离线对照（规则层，无 LLM）
- action P/R/F1 = 1.0 / 0.767 / 0.868（TP 23 · FP 0 · FN 7 · TN 10）
- FP: []｜FN: ['i02', 'i15', 'i21', 'i23', 'i25', 'i29', 'i30']
- intent 槽位 EM = 0.759（逐槽）/ 0.586（逐条）
- answer 槽位命中率 = 0.333（9/27）

---

## 🔒 CY 复核定稿（2026-09-27 19:50，金标就此定稿）

以上 19:33（在线①）/ 19:45（在线②）/ 19:48（离线）三轮均为**定稿金标**（`evals/golden/plan_understand.jsonl`，CY 复核后 8 处修正）重跑。在线三轮门槛全过，波动为 LLM 非确定性所致。

### 复核修正 8 处（其余 52 条通过）

| id | 修正 | 依据 |
|---|---|---|
| i10 | title `驾照` → `科目一` | **语义错误**：截止日是科目一考试；记「驾照 12.1 截止」的卡片读起来像整个驾照当天完成 |
| i02 | title `面试` → `学生会面试` | 标题精确化（互含口径下系统输出 `面试` 仍命中） |
| i17 | title `六级` → `六级复习` | 动作是「规划复习」，产物块名是六级复习（`六级` ⊂ `六级复习` 容差仍在） |
| i14 | 补 `title:背单词`、`window_text:晚上` | create 草稿卡必需 title；「晚上」是真实排程约束 |
| i15 | 补 `when_text:明天下午两点到四点` | 句子明确给了钟点区间，是排程核心槽位 |
| i26 | 补 `title:背单词` | 同 i14（create 缺 title） |
| i29 | 补 `title:晨跑` | 同 i14 |
| i30 | 补 `title:健身房` | 同 i14 |

a01–a20（answer 定位）、b01–b10（边界反例）逐条复核全部通过；i19/i22/i27/i28（gold 核心词 vs 系统带修饰抽取）在归一互含口径下均命中，不改。

### 定稿后量化结论

- **在线（LLM）**：action F1 = 1.0 / 0.983（两轮），intent 逐槽 EM = 0.966 / 0.931，逐条 0.931 / 0.897 —— 门槛（F1≥0.95 且逐槽 EM≥0.90）三轮全过 ✅。逐条口径偶差 1 槽，源于 LLM 非确定性（temperature 0.1 单轮采样）。
- **离线（规则兜底，确定性）**：action F1 0.868，FN 7 条（i02/i15/i21/i23/i25/i29/i30）即 LLM 增量价值的实证清单。

### 已知缺口（记待办，非金标问题）

1. **a09「还没定，到时候再说」归位不稳**：LLM 偶发漏答位；规则层归一成「时间待定」与原话互含不上。理想行为 = 照抄归位 → 下游标待定。改法候选：answer prompt 补一句「未定/待定类回答也要照抄归到对应槽位」+ 规则层 VAGUE_WHEN 命中时 answers.when 回原话而非改写。
2. **i30「隔天」口径**：规则层口径 = 每周 4 次（`extractFrequency` 注释明确 3–4 取 4），金标对齐规则层；生产路径该槽位由规则层填写、LLM 不参与（纪律①），在线评测不传规则槽位才出现 LLM 猜 3 的噪音。
3. **端点偶发 8s 超时**（3/60、1/60）：`ok:false` 兜底生效，属 DeepSeek 瞬时慢；如需再压，可考虑 eval 多轮取中位或 temperature 0。
4. 本报告 19:33/19:45/19:48 三轮与 19:00 前草稿金标轮不可直接互比（金标已于 19:33 起加严 6 个槽位、精确化 2 个 title）。


## 评测运行 · 2026-09-27 20:14（生产忠实口径）

### 离线对照（规则层，无 LLM）
- action P/R/F1 = 1.0 / 0.767 / 0.868（TP 23 · FP 0 · FN 7 · TN 10）｜FN: ['i02', 'i15', 'i21', 'i23', 'i25', 'i29', 'i30']


## 评测运行 · 2026-09-27 20:22（生产忠实口径 v3）

### 在线（生产忠实口径：规则先行 → LLM 补空/救援 → 双侧归一合并计分）
- 端点调用 43 次，ok 43（ok:false 含偶发 8s 超时——③口径：设计行为，生产回规则结果，评测同口径计分，不重试）
- action P/R/F1 = 1.0 / 0.767 / 0.868（TP 23 · FP 0 · FN 7 · TN 10）
- FN: ['i02', 'i15', 'i21', 'i23', 'i25', 'i29', 'i30']｜FP: []
- 槽位 EM（TP 条目）= 0.93（未命中: [('i08', 'when_text'), ('i16', 'when_text'), ('i17', 'month')]）
- answer 槽位命中（双侧归一）= 0.962（25/26）｜未命中: [('a17', 'effort')]
- 端点直判参考线（规则拦下的 17 条若直询端点的命中率）：1.0
- 门槛（action F1≥0.95 且 槽位 EM≥0.90）：❌ 未过


## 评测运行 · 2026-09-27 20:34（生产忠实口径 v3）

### 在线（生产忠实口径：规则先行 → LLM 补空/救援 → 双侧归一合并计分）
- 端点调用 42 次，ok 41（ok:false 含偶发 8s 超时——③口径：设计行为，生产回规则结果，评测同口径计分，不重试）
- action P/R/F1 = 1.0 / 0.767 / 0.868（TP 23 · FP 0 · FN 7 · TN 10）
- FN: ['i02', 'i15', 'i21', 'i23', 'i25', 'i29', 'i30']｜FP: []
- 槽位 EM（TP 条目）= 0.953（未命中: [('i08', 'when_text'), ('i16', 'when_text')]）
- answer 槽位命中（双侧归一）= 0.923（24/26）｜未命中: [('a05', 'target'), ('a17', 'effort')]
- 端点直判参考线（规则拦下的 17 条若直询端点的命中率）：1.0
- 门槛（action F1≥0.95 且 槽位 EM≥0.90）：❌ 未过


## 评测运行 · 2026-09-27 20:36（生产忠实口径 v3）

### 离线对照（规则层，无 LLM）
- action P/R/F1 = 1.0 / 0.767 / 0.868（TP 23 · FP 0 · FN 7 · TN 10）｜FN: ['i02', 'i15', 'i21', 'i23', 'i25', 'i29', 'i30']


## 评测运行 · 2026-09-27 20:37（生产忠实口径 v3）

### 在线（生产忠实口径：规则先行 → LLM 补空/救援 → 双侧归一合并计分）
- 端点调用 42 次，ok 41（ok:false 含偶发 8s 超时——③口径：设计行为，生产回规则结果，评测同口径计分，不重试）
- action P/R/F1 = 1.0 / 0.767 / 0.868（TP 23 · FP 0 · FN 7 · TN 10）
- FN: ['i02', 'i15', 'i21', 'i23', 'i25', 'i29', 'i30']｜FP: []
- 槽位 EM（TP 条目）= 0.93（未命中: [('i08', 'when_text'), ('i09', 'title'), ('i16', 'when_text')]）
- answer 槽位命中（双侧归一）= 0.923（24/26）｜未命中: [('a05', 'target'), ('a17', 'effort')]
- 端点直判参考线（规则拦下的 17 条若直询端点的命中率）：1.0
- 门槛（action F1≥0.95 且 槽位 EM≥0.90）：❌ 未过


## 评测运行 · 2026-09-28 00:26（生产忠实口径 v3）

### 在线（生产忠实口径：规则先行 → LLM 补空/救援 → 双侧归一合并计分）
- 端点调用 67 次，ok 41（ok:false 含偶发 8s 超时——③口径：设计行为，生产回规则结果，评测同口径计分，不重试）
- action P/R/F1 = 1.0 / 0.767 / 0.868（TP 23 · FP 0 · FN 7 · TN 10）
- FN: ['i02', 'i15', 'i21', 'i23', 'i25', 'i29', 'i30']｜FP: []
- 槽位 EM（TP 条目）= 0.953（未命中: [('i08', 'when_text'), ('i16', 'when_text')]）
- answer 槽位命中（双侧归一）= 0.923（24/26）｜未命中: [('a05', 'target'), ('a17', 'effort')]
- 端点直判参考线（规则拦下的 17 条若直询端点的命中率）：1.0
- 门槛（action F1≥0.95 且 槽位 EM≥0.90）：❌ 未过
### dialog 组（D 批：act 分类 25 + idx 消歧 8 + 防编造负例 7）
- act 宏 F1 = 0.0（逐 act: {'FAIL': 0.0, 'chit_chat': 0.0, 'resume_topic': 0.0, 'pick_candidate': 0.0, 'discard_topic': 0.0, 'new_intent': 0.0, 'confirm_draft': 0.0, 'ask_slot': 0.0}）｜准确率 = 0.0（0/40）
- 混淆 Top: [(('ask_slot', 'FAIL'), 9), (('pick_candidate', 'FAIL'), 8), (('new_intent', 'FAIL'), 7), (('chit_chat', 'FAIL'), 5), (('confirm_draft', 'FAIL'), 4), (('discard_topic', 'FAIL'), 4), (('resume_topic', 'FAIL'), 3)]
- idx 消歧 EM = None（0/0）｜未命中: 无
- 非法输出拦截率 = 1.0（负例 7 条；ok:false 或合法域内都算拦住——镜像后端 _clean_dialog + 前端 validateDialogAct）
- 端点拒收（dialog_act_rejected/超时等）: [('d01', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d02', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d03', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d04', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d05', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d06', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d07', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d08', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d09', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d10', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d11', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d12', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d13', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d14', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d15', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d16', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d17', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d18', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d19', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d20', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d21', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d22', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d23', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d24', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d25', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d26', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d27', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d28', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d29', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d30', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d31', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d32', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d33', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d34', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d35', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d36', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d37', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d38', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d39', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'), ('d40', 'URLError: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>')]
- 门槛（act 宏 F1≥0.90 且 拦截率 100%）：❌ 未过


## 评测运行 · 2026-09-28 00:30（生产忠实口径 v3）

### dialog 组（D 批：act 分类 25 + idx 消歧 8 + 防编造负例 7）
- act 宏 F1 = 0.754（逐 act: {'pick_candidate': 0.889, 'negotiate_block': 0.0, 'chit_chat': 0.909, 'discard_topic': 1.0, 'ask_slot': 0.714, 'resume_topic': 0.8, 'new_intent': 0.923, 'confirm_draft': 0.8}）｜准确率 = 0.85（34/40）
- 混淆 Top: [(('ask_slot', 'pick_candidate'), 2), (('new_intent', 'negotiate_block'), 1), (('resume_topic', 'confirm_draft'), 1), (('ask_slot', 'confirm_draft'), 1), (('ask_slot', 'chit_chat'), 1)]
- idx 消歧 EM = None（0/0）｜未命中: 无
- 非法输出拦截率 = 1.0（负例 7 条；ok:false 或合法域内都算拦住——镜像后端 _clean_dialog + 前端 validateDialogAct）
- 端点拒收（dialog_act_rejected/超时等）: 无
- 门槛（act 宏 F1≥0.90 且 拦截率 100%）：❌ 未过


## 评测运行 · 2026-09-28 00:32（生产忠实口径 v3）

### dialog 组（D 批：act 分类 25 + idx 消歧 8 + 防编造负例 7）
- act 宏 F1 = 0.69（逐 act: {'negotiate_block': 0.0, 'discard_topic': 1.0, 'chit_chat': 1.0, 'pick_candidate': 0.941, 'new_intent': 0.833, 'resume_topic': 0.8, 'ask_slot': 0.778, 'FAIL': 0.0, 'confirm_draft': 0.857}）｜准确率 = 0.85（34/40）
- 混淆 Top: [(('confirm_draft', 'ask_slot'), 1), (('new_intent', 'negotiate_block'), 1), (('ask_slot', 'pick_candidate'), 1), (('resume_topic', 'negotiate_block'), 1), (('new_intent', 'ask_slot'), 1), (('ask_slot', 'FAIL'), 1)]
- idx 消歧 EM = 1.0（8/8）｜未命中: 无
- 非法输出拦截率 = 1.0（负例 7 条；ok:false 或合法域内都算拦住——镜像后端 _clean_dialog + 前端 validateDialogAct）
- 端点拒收（dialog_act_rejected/超时等）: [('d39', 'dialog_act_rejected')]
- 门槛（act 宏 F1≥0.90 且 拦截率 100%）：❌ 未过


## 评测运行 · 2026-09-28 00:34（生产忠实口径 v3）

### dialog 组（D 批：act 分类 25 + idx 消歧 8 + 防编造负例 7）
- act 宏 F1 = 0.905（逐 act: {'ask_slot': 0.842, 'chit_chat': 1.0, 'confirm_draft': 0.857, 'discard_topic': 1.0, 'new_intent': 0.833, 'pick_candidate': 1.0, 'resume_topic': 0.8}）｜准确率 = 0.875（35/40）
- 混淆 Top: [(('confirm_draft', 'ask_slot'), 1), (('new_intent', 'negotiate_block'), 1), (('resume_topic', 'negotiate_block'), 1), (('new_intent', 'ask_slot'), 1), (('ask_slot', 'FAIL'), 1)]
- idx 消歧 EM = 1.0（8/8）｜未命中: 无
- 非法输出拦截率 = 1.0（负例 7 条；ok:false 或合法域内都算拦住——镜像后端 _clean_dialog + 前端 validateDialogAct）
- 端点拒收（dialog_act_rejected/超时等）: [('d39', 'dialog_act_rejected')]
- 门槛（act 宏 F1≥0.90 且 拦截率 100%）：✅ 过


## 评测运行 · 2026-09-28 00:40（生产忠实口径 v3）

### 在线（生产忠实口径：规则先行 → LLM 补空/救援 → 双侧归一合并计分）
- 端点调用 67 次，ok 42（ok:false 含偶发 8s 超时——③口径：设计行为，生产回规则结果，评测同口径计分，不重试）
- action P/R/F1 = 1.0 / 0.767 / 0.868（TP 23 · FP 0 · FN 7 · TN 10）
- FN: ['i02', 'i15', 'i21', 'i23', 'i25', 'i29', 'i30']｜FP: []
- 槽位 EM（TP 条目）= 0.953（未命中: [('i08', 'when_text'), ('i16', 'when_text')]）
- answer 槽位命中（双侧归一）= 0.923（24/26）｜未命中: [('a05', 'target'), ('a17', 'effort')]
- 端点直判参考线（规则拦下的 17 条若直询端点的命中率）：1.0
- 门槛（action F1≥0.95 且 槽位 EM≥0.90）：❌ 未过
### dialog 组（D 批：act 分类 25 + idx 消歧 8 + 防编造负例 7）
- act 宏 F1 = 0.955（逐 act: {'ask_slot': 0.889, 'chit_chat': 1.0, 'confirm_draft': 0.857, 'discard_topic': 1.0, 'new_intent': 1.0, 'pick_candidate': 0.941, 'resume_topic': 1.0}）｜准确率 = 0.95（38/40）
- 混淆 Top: [(('confirm_draft', 'ask_slot'), 1), (('ask_slot', 'pick_candidate'), 1)]
- idx 消歧 EM = 1.0（8/8）｜未命中: 无
- 非法输出拦截率 = 1.0（负例 7 条；ok:false 或合法域内都算拦住——镜像后端 _clean_dialog + 前端 validateDialogAct）
- 端点拒收（dialog_act_rejected/超时等）: 无
- 门槛（act 宏 F1≥0.90 且 拦截率 100%）：✅ 过

