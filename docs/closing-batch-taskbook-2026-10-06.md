# 光溯 · 收官批次任务书（交 zcode 独立执行）

> 委托人：CY。制定：MOSS（2026-10-06，基于两棵工作树实测grep + 门禁实跑 + `git rev-list` 计数）。
> 工作树：**`D:/WORKBUDDY DATA/学术部/_work_dev`**，分支 `beta-v2`，HEAD `1abba45`。
> 门禁基线（2026-10-06 实测，**只增不减**）：`tsc --noEmit` **0 错**｜`npm run test:engine` **598 pass / 0 fail**｜
> `npm run test:ui` **432 pass / 0 fail**｜`e2e/mobile-smoke.spec.ts` **15 条**。
> **本任务书自包含。遇未覆盖决策点 → 写 `BLOCKERS.md` 停下等 CY，不擅自裁决。**

---

## 🔴 零、先读这一节：两棵树的真相（**不读会做错方向**）

仓库有**两棵工作树**，做的不是同一件事：

| 工作树 | 分支 | 角色 |
|---|---|---|
| **`_work_dev`** | `beta-v2` | ✅ **本任务书的施工树**。移动端线 + memo 特性 + 版本卫生机制都在这里 |
| `_integration_full` | `integration-full` | ⚠️ **另一条线**：R 批（R1–R7 + Wave3 日程评估引擎）在这里 |

**关键事实：`beta-v2` 领先 `integration-full` 45 个 commit；反过来 integration-full 独有的 R 批成果也不在 beta-v2。**
具体地，**「日程评估引擎」整组文件在 `_work_dev` 完全不存在**（实测7/7 缺失）：

```
缺 src/lib/planner/planDigest.ts        （TimeBlock → 五维指标抽取）
缺 src/lib/planner/planEval.ts
缺 src/features/week/PlanEvalPanel.tsx（评估面板 UI）
缺 server/plan_review.py（后端三库复核 /api/plan/review）
缺 tests/h1-eval-panel.test.ts
缺 tests/h1-plan-eval.test.ts
缺 tests/h3h4-eval.test.ts
```

**⇒ 本批P0-1 的第一件事是把这一整组从 `integration-full` 移植过来。** 不要重新实现，它在那里已被MOSS 独立验收过
（tsc 0 / engine 737 / ui 424全绿、变异验证 4 条各恰1 红、HTTP 探针 12/12）。

### 关于你新加的版本卫生契约（`1fb63b1`）

`AGENTS.md` 已引入两道硬闸，**开工必须遵守**：

```bash
node scripts/preflight.mjs      # ① 开工：证明站在最新版本上
   ……写代码……
node scripts/impact.mjs# ② 收尾：证明没打断过往功能
```

⚠️ **但 `preflight.mjs` 当前会硬阻塞，且阻塞理由与本批无关**（实测）：

```
❌ [UNRELATED_HISTORIES] 本地仓库不含 origin/dev 的任何对象
```

**这是环境事实，不是你的错**：`preflight` 的基线写死 `origin/dev`，而 `origin/dev` 是项目**最早期脚手架**那条线
（根提交与本地无共同祖先）；CY 已于 2026-10-02 拍板**主线改走 `integration-full`**，`dev` 线**作废、不再合并**
（见 `BLOCKERS.md`「双树收敛·结项」）。

**本批处置办法（已获CY 授权，照此执行不必再等）**：
1. `preflight.mjs` 的**基线从 `origin/dev` 改为 `origin/beta-v2`**（本批P0-0 顺手修掉），
   同时把「工作树必须是 `_work_dev`」的检查放宽为「必须在 `_work_dev` 或 `_integration_full`」——
   因为移植产物要读另一棵树。
2. 改完跑一次 `node scripts/preflight.mjs`，**把输出贴进 BLOCKERS.md 留痕**，然后继续。

---

## 一、背景一句话

R 批功能已收官，但**功能散在两棵树上**：移动端/memo/版本卫生在 `beta-v2`，R 批成果（尤其 Wave3 日程评估引擎）在 `integration-full`，
`_work_dev` 上**连评估面板都没有**。本批做**四件事**：①把评估引擎移植进施工树并补齐两个入口缺口（梨宝侧入口 + E2E 覆盖）
②修掉三处「已实现但用户/评委看不见」的问题 ③把健康库/画像/空间三处 PARTIALS 真正接线 ④修契约缺陷。

## 二、验收标准（DoD，全绿才算完成）

| 门 | 基线（2026-06 实测） | 本批要求 |
|---|---|---|
| `npx tsc --noEmit` | **0 错** | 0 错 |
| `npm run test:engine` | 598 pass / 0 fail | **≥ 640 / 0 fail**（新增测试后只增不减） |
| `npm run test:ui` | 432 pass / 0 fail | **≥ 436 / 0 fail** |
| `e2e/mobile-smoke.spec.ts` | 15 条 | **≥ 17 条**（P0-1 的 E2E 新增 2 条） |
| `node scripts/capability_map.mjs --check` | **当前 ❌ FAIL** | ✅ **PASS** |
| `node scripts/impact.mjs` | — | ✅ PASS，且输出贴 BLOCKERS.md |
| golden 快照 | 5 份 | **零漂移**；若 P1 接线必然导致漂移 → **停下报 CY**，严禁 `--update` 掩盖 |

交付物：①每 WP 单独提交 ②`BLOCKERS.md` 落节 ③验收证据（命令 + 数字）④台账 `docs/wp-ledger-v2.md` 随做随记

## 三、执行项（按波次与优先级，每项独立提交）

### Wave 0 · P0-0：修契约缺陷（**必须最先做，否则 Wave1 的 impact 会失真**）

#### P0-0 · capability-map 过期（真实缺陷，会让 impact 漏跑守护）
**现象**：`node scripts/capability_map.mjs --check` → ❌ FAIL，提示
`未登记的新测试（跑 --write 补）：scripts/memo-web-workspace.test.ts`
**依据**：`1abba45` 新增了 memo 特性与19 个用例，但没更新能力清单。
**危害**：按 `AGENTS.md` 契约，`impact.mjs` 靠 `docs/capability-map.json` 反查「哪些测试在守这些文件」——
清单过期 = **新守护被漏跑**，impact 报PASS 是假的。

- [ ] `node scripts/capability_map.mjs --write`，然后 `--check` 转 PASS
- [ ] 确认 `docs/capability-map.json` 已包含 `memo-web-workspace.test.ts` 的守护映射
- [ ] **验收**：连续两次 `--check` 均PASS（幂等），且git diff 里 `capability-map.json` 有实质新增条目

#### P0-0b · preflight 基线错（阻塞开工，见「零」节）
- [ ] `scripts/preflight.mjs` 基线 `origin/dev` → `origin/beta-v2`
- [ ] 工作树检查放宽为 `_work_dev` 或 `_integration_full`
- [ ] **验收**：`node scripts/preflight.mjs` 不再报 `UNRELATED_HISTORIES`；输出贴 `BLOCKERS.md`

---

### Wave 1 · P0-1：日程评估引擎**移植** + 补齐两个缺口

#### P0-1a · 整组移植（**从 integration-full 搬，不要重写**）
**现象**：`_work_dev` 上`grep -rn "PlanEval"src/` 零命中；周计划页没有「评估」入口。
**依据**：该组已在 `_integration_full` 验收通过（详见「零」节）。

- [ ] 从 `_integration_full` 移植下列文件（连同它们的测试）：
      `src/lib/planner/planDigest.ts`｜`src/lib/planner/planEval.ts`｜
      `src/features/week/PlanEvalPanel.tsx`｜`server/plan_review.py`｜
      `tests/h1-eval-panel.test.ts`｜`tests/h1-plan-eval.test.ts`｜`tests/h3h4-eval.test.ts`
- [ ] 移植后**必须实跑后端测试**（**进程内单测不算数**，见「红线」第2 条）
- [ ] **验收**：
  - `npm run test:engine` 中3 个 h*eval 测试全绿
  - 真打一次 HTTP：`POST /api/plan/review` 带完整 digest → 200 且 `advice[].source` 有库名+tier
  - 缺 `digest` 入参 → **422**（不是 200）；检索降级路径 → `retrieved: false`
- [ ] **提交**：`feat(eval): 移植 Wave3 日程评估引擎到 beta-v2（来源 integration-full bfea222/f1aac73）`

#### P0-1b · 梨宝侧「让梨宝评估这一版」入口（任务书触发点①，真缺口）
**现象**：`src/features/libao/LbaoChat.tsx` 内 `评估|PlanEval` **零命中**。
用户刚确认完日程想听评价，**没有任何入口**。
**依据**：R 批任务书原文——「触发点：①对话侧 `confirmGoal` 落盘后出现按钮『让梨宝评估这一版』；
②周计划侧 `WeekPlanView` 顶部常驻『评估本周』」。**②已做（`WeekPlanView.tsx` 内`让梨宝评估这版日程`），①未做。**

- [ ] 在 `confirmGoal` 落盘成功后的回执区增加按钮「让梨宝评估这一版」
- [ ] 点击 → 复用**已存在的** `PlanEvalPanel`（**不要另写一套UI**）
- [ ] **红线**：只进入重排草稿流，**不直接改已排日程**
- [ ] **验收**：源码锁断言 `LbaoChat.tsx` 引用 `PlanEvalPanel`；UI 测试断言按钮存在且点击后面板可见
- [ ] **变异反向验证**：摘掉该按钮 → 恰 1 红 → 还原 sha256 一致
- [ ] **提交**：`feat(libao): 梨宝侧补「让梨宝评估这一版」入口（R批触发点①）`

#### P0-1c · E2E 覆盖评估动线（真缺口）
**现象**：三个 E2E 脚本里「评估」**全 0 命中**：
`scripts/e2e-sched-session.mjs`=0｜`scripts/e2e-journey.mjs`=0｜`e2e/mobile-smoke.spec.ts`=0（虽有 15 条，无一条测评估）
**依据**：R 批 Wave3 验收明文要求「E2E 点『评估』出报告且建议可采纳」。现有覆盖**只到单元层**。

- [ ] `e2e/mobile-smoke.spec.ts` 增 2 条：
  ① **评估面板出报告**：打开 → 点评估入口 → 五维分数渲染 → 展开某维「看依据（N个块）」可读
  ② **建议可采纳**：有 gap 的语料 →点「采纳」→ 目标进入**草稿/重排流**（断言草稿徽章，**不断言直接改表**）
- [ ] **注意**：示例课表恰好达标 → 无 gap → 无建议可采纳（**数据依赖，非缺陷**）。
  构造数据时确保 `aerobicMin` 低于 150，否则第 ② 条会假红
- [ ] **验收**：`npx playwright test e2e/mobile-smoke.spec.ts` → **17 passed / 0 failed**
- [ ] **提交**：`test(e2e): 评估动线覆盖 —— 出报告 + 建议可采纳（R批 Wave3 验收项）`

---

### Wave 2 · P1：三处「已实现但看不见/被误读」

#### P1-1 · 「质量分」文案（2 行，答辩风险点）
**现象**：周计划页底部诊断行显示「**质量分 229**」。
**用户会误读成百分比/分数**，但它其实是**引擎代价，越低越好**。
**依据**：`src/features/week/WeekPlanView.tsx:1562` ——
`{' · '}质量分 {Math.round(diag.cost.total)}`；
接受准则是`improve.ts:574` 的 `delta < -EPS`（**严格下降**）⇒ `cost` 单调不增、**越低越好**。

- [ ] 改为自解释文案，建议：`调度代价 229（越低越好）` 或 `引擎代价 229 ·越低越好`
- [ ] 同文件 `:448` 的注释也同步纠正（「加权质量分」→「加权代价（越低越好）」）
- [ ] **验收**：UI 测试断言新文案；grep 全仓`质量分` 在渲染处**零命中**（注释可留）
- [ ] **提交**：`fix(week): 诊断行「质量分」改自解释文案—— 实为引擎代价，越低越好`

#### P1-2 · 健康库 M3 按最终基座重放验证（数据正确性）
**现象/依据**：`docs/health-kb-plan.md:136` 写着
「M3 已对接 `app.py`（本地检出），**推送前需按 dev 最新版重新应用**（本地基座滞后，同方法库流程）」，
且 `:139`「canonical 条目下一轮补联网复核」。**该待办从未被结案记录。**

**⚠️ 本项与P1-3 绑定，且**⚠️ **P1-3 有前置依赖，见下。**

- [ ] 实跑 `node scripts/gate_data.py`（或`npm run gate:data`），确认健康库数据层门禁通过
- [ ] 实跑后端健康库检索测试，确认三库路由不被劫持
- [ ] 若发现数据层错误 → 修；**修不动写 BLOCKERS.md 停下**
- [ ] **验收**：命令输出留数字（条目数 / 命中数 / 0 fail）

#### P1-3 · canonical 复核（**21 条，不是 3 条**）
**现象**：`scripts/health_kb_data.py` 里 `"verification": "canonical"` **实测 21 处**
（⚠️ 文档 `health-kb-plan.md:128` 只提了 3 条代表 —— 咖啡因半衰期/BMI 中国界值/蛋白质区间，
实际 21 条，含睡眠类多条）。
**依据**：`health_kb_data.py:28` 定义「canonical = 公认经典结论，本轮预算内未逐条复核（诚实标注，不算 verified）」。

**【需 CY 裁决】** 21 条全复核 = 要联网查 21 个出处并重跑编译 + 重验 golden，**成本远高于收益**。
**zcode 在此必须停下**，在 `BLOCKERS.md` 给出三条路线取舍：
- 路线1：**只做 3 条代表条目**（文档已点名的咖啡因/BMI/蛋白质）—— 约 30 分钟，答辩话术够用
- 路线 2：全部 21 条复核 —— 数小时 + 重跑编译链 + golden 校验
- 路线 3：**不做**，保持诚实标注（当前实现已合规，符合项目「未知不伪装」的纪律）

**放行**：等待期间可继续做 P1-2 的数据门禁与 Wave 3，不依赖本项。

#### P1-4 · 移动端 F11 / ICS 说明的**销案登记**（**不要写代码**）
实测结论如下，**请只更新文档，不要改实现**：

| 原记的待办 | 实测真相 | 处置 |
|---|---|---|
| F11 快捷指令接真端点 | ❌ **不是欠账**：`src/features/mobile/QuickBar.tsx:2-5` 明写「两个固定问法保留为**零延迟本地应答**（不调 LLM）；自由输入统一由梨宝抽屉承担（避免两个输入框，P6-3 决议）」 | **销案**，理由=已设计决议 |
| ICS 对 web-only 用户为空的提示 | ⚠️ **已做但形态不同**：`TodayPage.tsx:170` `<IcsGuide icsToken={identity.icsToken} />` 组件化 + 降级折叠归入 P6-2 | **销案**，注明实际形态 |
| persona 加进 SyncState | ✅ **已做**（`5884027`，schemaVer=2，`src/features/mobile/lib/types.ts:30` `persona?`） | **销案** |

- [ ] 在 `BLOCKERS.md` 与 `docs/mobile-line-alignment-2026-10-03.md` §7 各写一条结项留痕（含实测 `文件:行号`）
- [ ] **验收**：三处销案都有行号依据；**无任何代码改动**

---

### Wave 3 · P1：三处 PARTIALS 真接线（**改契约，须CY 裁决后才动**）

**统一前置**：这四处都需扩契约 `BuildWeekPlanInput → toPlanRequest → PlanRequest`，触及 `src/types.ts` 契约层。

**先销案一处（不用做）**：
- [ ] **④ 画像「受影响天」= 假缺口**。实测 `overrideAffectedDays` 早已在 `WeekPlanView.tsx:73` 被真实消费
      （`useWeekPlan.ts:303`、`WeekPlanView.tsx:1473` 均在用）→ E5 早已完成，
      `PROFILE_PARTIALS:241` 的「未接线」登记**过期**，请删除该条并留痕

**再修一处（两树状态不一致）**：
- [ ] **⓪ 睡眠保底窗口**：`_integration_full` 已由 10-02 P1-2 结项（就寝时间经 `dayWindowWithFallback`
      进 `PlanRequest.dayStart/dayEnd`）；但 `_work_dev` 的 `src/lib/planner/knowledge.ts:127`
      **仍写「未接线（需 identity.sleepMin 进 PlanRequest 契约）」**
      → **对齐**：把 `_integration_full` 的实现移植过来，并更新这条 PARTIALS 文本

**真正还缺的 3 处**：

#### P1-5 · ①每周活动量下限（150min/周均摊）
**现象**：引擎**完全不会主动排运动块**。你不手动加，一周可能零运动。
**依据**：`src/lib/planner/knowledge.ts:128`「每周活动量下限未接线（需 construct 活动块生成策略，150min/周均摊）」；
对齐口径见 R 批 H1 的 `aerobicMin`（同用 WHO「每周中高强度 ≥150 分钟」）。

- [ ] 在 `construct` 活动块生成处消费「本周已排运动分钟 vs 150 下限」，缺口按天均摊
- [ ] **验收**：构造一周含 1 个 60 分钟运动块的语料 → 引擎补排至 ≥150；已达标语料 → **不补**
- [ ] **变异反向验证**：删掉补排分支 → 恰红

#### P1-6 · ②三餐食堂选取（`rankPlaces` 已就绪，只差接线）
**现象**：三餐地点**按校区写死**；画像里的「就餐半径」答案算出来了**没人用**。
**依据**：`src/lib/planner/placesPolicy.ts:227-228`
「三餐食堂选取未接线（`templates.ts` 的食堂模块按校区写死 place+campus）… **`rankPlaces` 已可直接用于该场景**」；
`rankPlaces` 本体在 `placesPolicy.ts:126`，排序规则完备（校区过滤 → 关门剔除 → 步行预算 → 开着优先→ 距离升序 → 名称兜底）。

- [ ] `templates.ts` 食堂模块改为用 `rankPlaces` 排序候选
- [ ] 消费 `profilePrefs.ts:62` 的 `mealWalkBudgetMin`（同批 P1-7 一起做）
- [ ] **红线**：`walk` 查询返回 `null` 时**保持未知、不吸附到本部坐标**（`placesPolicy.ts:229-230` 的既定纪律，勿破）
- [ ] **验收**：`meal_radius: 'near'` 与 `'far'` 两档问卷 → 三餐推荐点**集合不同**（近档步行分钟更小）

#### P1-7 · ③ 夜猫子时段 + `mealWalkBudgetMin` 消费
- `mealWalkBudgetMin` 消费 → **并入 P1-6**
- 夜猫子：`PROFILE_PARTIALS:238-239` 明说 `night_supply` 说的是**夜间补给方式**、
  **不是作息倾向**，「无可辩护依据前不臆造」→ **必须先加问卷题** = 产品改动
- **【需 CY 裁决】** 在此停下，给 CY 两个选项：
  - 选项 A：本批**不做**夜猫子（保持现状诚实标注），只做 `mealWalkBudgetMin`
  - 选项 B：加 1 道问卷题（问「你通常几点睡」→ 映射夜猫子档）→ 需同步改
    `persona` 问卷、`ProfilePrefs` 生成、快照/金标

**【需 CY 裁决】闸门说明**：P1-5/ P1-6/ P1-7 全部触及 `src/types.ts` 契约层。
按 `AGENTS.md` §八，契约层**结构性改动须 CY 确认**。因此：
- zcode 做到 Wave 3 时**必须停下**，在 `BLOCKERS.md` 写出：①要加的字段名与语义
  ②影响面清单（用 `node scripts/impact.mjs --print-command` 取命令） ③golden 漂移预判
- **放行**：Wave 0/ 1 / 2 全部不依赖本项，可先做完

---

### 暂缓 / 不做（本批明确排除，防范围蔓延）

| 项 | 理由 |
|---|---|
| **F16 桌面小组件** | Capacitor 无小部件生态，必须另起原生工程（`AppWidgetProvider` + `RemoteViewsService` + XML 布局），React 代码几乎无法复用；且 F15 常驻通知已覆盖核心需求。CY 2026-10-06 拍板留到后面 |
| **beta-v2 × dev 合并** | `dev` 是项目最早期脚手架（无共同祖先），CY 已判定作废。机器自动合流会静默丢工作 |
| **睡眠真实数据接入** | 华米老款 Amazfit 无可用数据导出 API，**产品限制非代码缺口**。CY 2026-10-06 拍板搁置 |
| **重拍 golden 基线** | 🔴 **严禁**。若 P1 接线必然导致 golden 漂移 → 停下报 CY 裁决，不得 `--update` 掩盖 |
| **导入 `merge` / `push` 其他分支** | 只推 `origin/beta-v2`；`main` / `dev` / `integration-full` **零接触** |

## 四、红线（不可越）

1. 🔴 **golden 红 = 停** —— 写 `BLOCKERS.md` 报 CY，**严禁重拍快照掩盖漂移**。
2. 🔴 **凡改 `server/` 契约，必须真打 HTTP 验，进程内 pytest 不算数**。
   前车之鉴：曾出现活后端跑旧代码、`MemoryFactReq` 字段不存在、前端写入被 pydantic 422 静默拒，
   而进程内测试全绿——「后端全绿」不构成反证。
3. **只推 `origin/beta-v2`**。不 merge PR、不动 `main` / `dev` / `integration-full`。
4. **每 WP 单独提交**，中文 message 写明依据（如 `P1-5`）；台账 `docs/wp-ledger-v2.md` 随做随记。
5. **金标只增不改**；引擎/解析类改动**变异体反向验证 ≥1 条**
   （删实现 → 恰红 → 还原 sha256 比对一致）。
6. `src/types.ts` **禁 `any`**；`_` 开头 = 临时产物不入库；`.env` / 大文件不入库。
7. **测试无`.skip` / `.only` / `.todo`**。删除既有测试会让 `capability_map --check` 变红，
   **这是有意的**——需要有人拍板，不允许悄悄删测试让门禁变绿。
8. **门禁沙箱限制**：`gate_overnight.mjs` 在本机沙箱恒报 `spawnSync cmd.exe EBUSY`，
   **是老问题、非回归**。按既有先例**逐条等价复现**（tsc / engine / ui / 风格）即可，
   **不要试图修脚本**。

## 五、环境备注

- **工作树**：`D:/WORKBUDDY DATA/学术部/_work_dev`（分支 `beta-v2`）；另一棵树 `_integration_full` **只读参考**
- **运行时**：node `C:\Users\CY\.workbuddy\binaries\node\versions\24.14.0\node.exe`；
  python `C:\Users\CY\.workbuddy\binaries\python\envs\default\Scripts\python.exe`（裸 `python` 无 fastapi）
- **提交/推送唯一入口**：`python _gh_api_push.py --repo <repo> --base-sha <父提交> --branch beta-v2 --message-file msg.txt --files <路径...>`
  （绕开 git 协议，沙箱里最稳）
- **代理**：`HTTPS_PROXY=http://127.0.0.1:7890`、`HTTP_PROXY=同`；
  `gh` 只认环境变量，另需 `APPDATA="C:/Users/CY/AppData/Roaming"`
- **坑**：
  - 项目用 `node --import ./scripts/register-alias.mjs --test`，**不是 vitest**（用 vitest 会报 "No test suite found"）
  - 本机网络**单连接被限速 ≈0.7–0.8 Mbps**（校园网网关策略），多连接才能跑满
  - 沙箱会注入 `HTTP_PROXY` 劫持回环请求 → Python 侧用 `build_opener(ProxyHandler({}))` 绕过；curl 用 `--noproxy '*'`
  - 沙箱会回收后台进程 → 验证用「同一命令内起 → 探测 → 关」
  - `e2e` 前台跑易被 SIGTERM → `run_in_background` 或 `> log 2>&1` 落盘
  - Git Bash 里 `_/xxx.mjs` 会被 MSYS 咬路径 → `MSYS_NO_PATHCONV=1 node "./_/xxx.mjs"`
  - 8000 端口有别人的后端，**别杀**
- **线上**（可作真机对照）：`http://101.35.253.143` → `/api/health` ok、`/m.html` 200、
  `/apk/lightpath-0.1.0.apk` 200
