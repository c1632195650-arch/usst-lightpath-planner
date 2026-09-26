# WP 台账 · 2026-09-27 通宵批次（beta-v2）

> 台账规则：本文件与代码同一个 commit 提交，永不脱节。
> 「完成」四要件：① 门禁五门全 PASS；② 反向验证逐条记录（红/绿+验证点）；
> ③ 假绿自查三连通过；④ 改动文件清单与 commit 文件列表逐一对得上。

## §0 基线（活文档，每批收尾更新）

- 起点：`03a11b5`（master，2026-09-22 合流后修复提交）
- 分支：`beta-v2`（扁平名；本机安全软件会拦带斜杠分支名，故不用 feat/*）
- 当前基线（批 2 收尾）：**tsc=0 / engine=328 / ui=254 / intent=69(含于 ui) / golden=v1**
  - 批 0 开工基线：tsc=0 / engine=326 / ui=237 / intent=69 / golden=v1；批 1 收尾：engine=328 / ui=246
  - 注：`scripts/gate_overnight.mjs` 内置下限为旧值 312/219；台账以实测更高值为「只增」基线。
- 门禁脚本指纹：`md5(scripts/gate_overnight.mjs) = eb43ce60816d4691a8b209f3904dcb3b`（夜里禁改，收尾必核）

## §R 规则抄录（夜班铁律）

- golden 只增不改（v1 冻结）；既有测试期望值不许改（除非台账单独申报改了哪文件哪行+理由）。
- 每条新断言必须反向验证：关掉实现/还原旧代码 → 断言红 → 恢复 → 回绿。没做反向验证的断言按不存在处理。
- 测试基线只增不减（engine ≥326 / ui ≥237 / intent ≥69）。
- 只 `git add` 台账列出的文件；禁 `git add -A` / `git add .`（工作区有他人杂物：M AGENTS.md、
  `.openclaw/`、`.cluster/`、`HEARTBEAT.md`、`IDENTITY.md`、`SOUL.md`、`TOOLS.md`、`USER.md`、
  `.tyc-proxy-capability.json` 等，一律不碰、不提交）。
- 禁：push / reset --hard / rebase / clean / checkout -- . / 切回 master / 删除文件 / 改门禁脚本 /
  起后台进程 / 新依赖 / 改 schema / 改 .env / 碰 data/*.db。
- 遇阻塞：写 BLOCKERS.md（格式：`- [时间] 批次n·阻塞点：<一句话>｜已排除：<试过什么>｜需要人决定：<具体二选一或确认项>`），该批标 [~]，跳下一批。
- 断线恢复协议：对账 `git log --oneline -8` + 重读本台账 + 跑门禁 ≥ 台账值 → 从最后一个 [x] 之后继续。

## §B 批次状态表

| 批 | 内容 | 状态 | commit |
|---|---|---|---|
| 0 | beta-v2 分支 + 台账 | [x] | cc901b5 |
| 1 | WP1 基础信息前置 BasicInfoStep | [x] | （见 git log WP1） |
| 2 | WP2 题库年级分层 + 上理场景化 | [x]（分层口径待 CY 复核，见 §WP2） | |
| 3 | WP4b 四 bug（B2/B3/B5/B6） | [ ] | |
| 4 | WP11 重要日体系 | [ ] | |
| 5 | WP8-mini + WP9 梨宝改排程 + 预览卡（5a-5d 四小步） | [ ] | |
| 6 | WP10 拖拽合规（仅余力） | [ ] | |

状态图例：[ ] 未开始 / [~] 进行中(含卡点) / [x] 完成(含会话证据)

## §WP1 基础信息前置

- 状态：[x] 完成（2026-09-27 夜，commit 见 WP1:）
- 改动文件清单：
  - `src/lib/identity.ts` — BasicInfo 扩 campus('军工路本部'|'1100')/dorm/sleepMin/exercisePerWeek；grade 收窄为 1-4 数字（Grade 类型 + gradeFromLabel + GRADE_LABELS + CAMPUS_OPTIONS）；loadBasicInfo 逐字段白名单校验 + 旧版「大二」字符串迁移；applyObjectiveFact 年级走解析、解析不了不写入；basicInfoContext 增校区、年级出标签
  - `src/features/welcome/basicInfo.ts`（新）— 纯逻辑：initialView 冷启动闸门 / validateBasicInfo 必填+值域 / parseBasicInfo 草稿解析
  - `src/features/welcome/BasicInfoStep.tsx`（新）— 引导第 1 步 UI；必填缺失禁「下一步」（touched 后禁用+alert）
  - `src/App.tsx` — 净改 8 行（≤10 达标）：View 增 'basicinfo'；:39 改 `useState<View>(() => initialView(state.onboarded))`；Welcome.onStart → basicinfo；新增 basicinfo 渲染分支；handleComplete 去掉 onboarded 写入；PersonaResult.onEnter 加 `patchState({ onboarded: true })`（写入点移到全流程完成）
  - `src/features/persona/personaCopy.ts` — makeEpithet 年级经 gradeLabel 出「大二」式标签（兜底兼容字符串）
  - `src/features/persona/PersonaResult.tsx` — 基础信息卡 grade 输入经 gradeFromLabel 转数字，非法不写入；显示 GRADE_LABELS
  - `scripts/basicInfo.test.ts`（新，10 用例）
  - `tests/identity.test.ts` — 见下方申报
- 反向验证记录（关实现 → 红 → 恢复 → 绿）：
  - RV1 initialView 恒 return 'welcome'（删 onboarded 读取）→ basicInfo.test.ts fail=5（含「onboarded=true 冷启动直进 main」）→ 恢复 → 全绿
  - RV2 validateBasicInfo 改为恒 return {}（删全部必填/值域校验）→ fail=4（必填四项+campus+数字域+坐标）→ 恢复 → 全绿
  - RV3 仅删 campus 值域检查 → fail=2（「campus 非法值被拒」用例红）→ 恢复 → 全绿
  - RV4 applyObjectiveFact 删 gradeFromLabel 解析分支 → identity.test.ts fail=2（「解析不了的年级不写入」「只覆盖对应单字段」红）→ 恢复 → 全绿
  - 恢复字节一致性：md5(identity.ts)=17c4177d…、md5(basicInfo.ts)=29c27bd5…，与改动前备份完全一致
- 既有断言调整申报（假绿自查 3b）：
  - `tests/identity.test.ts` 3 处（「基础信息保存与读取闭环」「applyObjectiveFact 只覆盖对应单字段」「闸门：偏好类 key」）：grade 期望值由字符串「大一/大二」改为数字 1/2 —— 理由：v2 方案 WP1 把 BasicInfo.grade 契约从自由字符串收窄为 1|2|3|4（题库分层 WP2 依赖数字年级），旧字符串在 loadBasicInfo 自动迁移，断言随契约演进；未删任何用例，另新增「WP1 新字段」「解析不了的年级不写入」2 条。
- 门禁：tsc=0 / engine=328(≥326) / ui=246(≥237) / 禁区零改动 / 风格 8 项 — 5/5 PASS
- 遗留：Welcome「先浏览应用」跳过引导不置 onboarded（刷新会再回欢迎页）——符合「未完成引导」语义，不改；如需改动请人拍板。

## §WP2 题库年级分层 + 上理场景化

- 状态：[x] 完成（分层口径取保守解读，**待 CY 复核**，见下）
- 改动文件清单：
  - `src/data/personaBank.ts` — 全题库上理场景化改写（只动 text，35/35 题面命中场景词）；每题加 sceneTag；10 题加 grades 分层标签；新增 `TieredPersonaItem`（本地扩展 types.ts 的 PersonaItem，**未动契约层**）、`PersonaGrade`、`buildPersonaSequence(grade)`（含 A03 锚定恒插入）；PERSONA_VERSION → 2026.09.27
  - `src/features/persona/PersonaFlow.tsx` — 出卷改 `buildPersonaSequence(loadBasicInfo().grade)`；没填年级（跳过引导）→ 全库 35 题，与分层前一致
  - `src/features/welcome/Welcome.tsx` — 「35 个日常选择」→「按你年级定制的日常选择」（硬编码数字随分层失效）
  - `scripts/personaTiering.test.ts`（新，8 用例：结构冻结/序列差异/A03 恒插入/分层数/标签值域/场景词覆盖/固定作答回归×2）
- **分层口径（需要人决定的解释项）**：方案书测试④「分层后总题数 8~14」存在两种读法：
  (a) 每份年级卷总题数 8~14；(b) 带 grades 标签的分层题总数 8~14。
  夜班按轴覆盖数学核算：若取 (a)，PLAN/RAT/BOLD 等轴的高权重输入题（C01-C05/D01-D05）必然大面积缺席，
  6 个以上轴塌到兜底值 50 —— buildProfile 名义可用、实际失真，且违反「dim 与计分逻辑一个字符都不许动」的
  精神。**故取 (b) 保守口径**：10 题分层（B01[2,3,4] C01[3,4] C02[2,3,4] C05[1,2] D01[1,2] D02[3,4]
  D03[1,2,3] E03[1,2] E08[1,2] A12[1,2]），每份卷 29~33 题，轴覆盖完整。若 CY 确认 (a)，只需改
  personaBank 的 grades 标签（纯数据，revert/重标无涟漪）。
- 反向验证记录（关实现 → 红 → 恢复 → 绿）：
  - RV1 buildPersonaSequence 还原成全库按 order 排列（无年级过滤）→ ST-SEQ 红（pass 7/fail 1）→ 恢复 → 全绿
  - RV2 A03 误挂 grades[2,3] 且删恒插入分支 → fail 2（ST-A03 红）→ 恢复 → 全绿
  - RV3 16 题题面还原成改写前文案 → 仅 ST-WORD 红（pass 7/fail 1，隔离验证）→ 恢复 → 全绿
  - 恢复字节一致性：md5(personaBank.ts)=6bc47991… 与改动前一致（×3 次）
- 固定作答回归（测试⑤）：改写前后同一组固定作答的 buildProfile 轴值**逐值一致**
  （EXP66/PLAN76/SOC84/RES81/ACH75/HEA80/RAT86/BOLD82，原型 healthy，quality ok）
  —— 用 git HEAD 旧题库实测比对，非推断。
- 门禁：tsc=0 / engine=328(持平) / ui=254(+8) / 禁区零改动 / 风格 8 项 — 5/5 PASS
- 遗留：
  - 换年级重测时旧答卷仍留在 answers 里，buildProfile 会吃到非当前卷面的旧答案（buildProfile 属 Ray 属地 + 计分铁律，夜班不碰）；建议白天在 handleComplete 里按当前卷面过滤答卷。
  - Welcome 的「先浏览应用」跳过引导用户没有 grade → 全库出卷（行为正确，仅提示）。

## §WP4b 四 bug

- 改动文件清单：
- 反向验证记录：
- 遗留：

## §WP11 重要日体系

- 改动文件清单：
- 反向验证记录：
- 遗留：

## §WP8-mini + WP9 梨宝改排程执行器 + 预览卡

- 改动文件清单：
- 反向验证记录：
- 遗留：

## §WP10 拖拽合规

- 改动文件清单：
- 反向验证记录：
- 遗留：

## §TODO 汇总

- （下一会话第一站：从最后一个 [x] 批次之后继续）
