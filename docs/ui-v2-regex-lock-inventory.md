# UI v2 · 源码正则锁清单（批次 0 生成，2026-10-07）

> **用途**：批次 A–E 动任何被锁文件前，先查本单。断言行号+原文由脚本 `_tmp/gen-lock-inventory.mjs`
> 扫描 `tests/**` 自动抽取（含跨行断言、同名变量按位置归属），生成自 commit `1d74303` 时点。
> **纪律**：改了被锁文件的 JSX 结构导致断言失配 → 按 D9 处理：commit message 申报旧行→新行对照，
> 且必须做反向验证（临时回退实现确认测试会红）。**禁止删测试、禁止改行为断言为恒真。**

共扫描 81 个测试文件，锁定 10 个源码文件、126 条断言。

## 一、五个首要锁定目标（执行方案 §1 表）

### `src/features/week/WeekPlanView.tsx` —— 42 条断言，来自 9 个测试文件

**tests/d-batch.test.ts**：

- L312: `  assert.match(wv, /setUndoDepth\(undoDepth\(\)\);\n\s+const onReplanDepth = \(\) => setUndoDepth\(undoDepth\(\)\);/, ⏎     '挂载 + 重排广播双路同步在位');`

**tests/h3h4-eval.test.ts**：

- L138: `  assert.match(wv, /digestPlan\(plan \?\? EMPTY_PLAN, evalCtx\)/, 'digestPlan 带 ctx（删 ctx → 红）');`
- L139: `  assert.match(wv, /r\.wakeMin != null && r\.sleepMin != null/, '作息真源接线（H3）');`
- L140: `  assert.match(wv, /goals\s*\n?\s*\.filter\(\(g\) => \(g\.status \?\? 'active'\) === 'active'/, 'GoalsPage active 目标接线（H4）'); ⏎   // 移植适配（2026-10-06 收官批次 P0-1a，已在 commit/台账申报）：上游断言 ⏎   // `/t\.recurring/` 锁的是 R5.2 recurring 重复任务跨度接线，该特性的生产端 ⏎   // （weekPlanForChat recurring: true）不在 beta-v2。本树改为**负向锁**： ⏎   // 不许伪造习惯跨度 —— digest 未传 habitSpans = unknown（诚实标注纪律）， ⏎   // 而不是拿 weeks 数组冒充 recurring 数据。 ⏎   assert.doesNotMatch(wv, /habitSpans\s*:/, 'R5.2 不在本树：不得伪造习惯跨度（unknown 而非 0）');`
- L146: `  assert.doesNotMatch(wv, /habitSpans\s*:/, 'R5.2 不在本树：不得伪造习惯跨度（unknown 而非 0）');`
- L147: `  assert.match(wv, /weeksLeft: due != null \? Math\.max\(0, due - cur\) : null/, 'weeksLeft 在调用方折算（摘要层不读时钟）');`
- L159: `  assert.match(wv, /planReview\(\{ user_id: getUserId\(\), week_no: weekNo/, '面板展开时拉取后端复核'); ⏎   assert.match(wv, /\.catch\(\(\) => \{ if \(alive\) setEvalReview\(\{ state: 'offline' \}\); \}\)/, '失败静默降级'); ⏎  ⏎   const panel = src('/src/features/week/PlanEvalPanel.tsx'); ⏎   assert.match(panel, /data-testid="plan-review-backend"/, '后端复核渲染区'); ⏎   assert.match(panel, /data-testid="plan-review-offline"/, '离线如实说明'); ⏎   assert.match(panel, /（静态口径）/, '静态降级不冒充真检索');`
- L160: `  assert.match(wv, /\.catch\(\(\) => \{ if \(alive\) setEvalReview\(\{ state: 'offline' \}\); \}\)/, '失败静默降级');`
- L172: `  assert.match(wv2, /onAdopt=\{\(skeleton\) => \{/, 'WeekPlanView 接线采纳');`
- L173: `  assert.match(wv2, /note: '采纳自日程评估（重排后生效）'/, '任务 note 如实标注来源');`
- L174: `  assert.match(wv2, /handleAddTask\(\{/, '复用「加一件事」同一条攒改动流（L4：重排才生效）'); ⏎   const api2 = src('/src/lib/api.ts'); ⏎   assert.match(api2, /action\?\: \{ kind: 'add_task'; task: Record<string, unknown> \} \\| null/, 'advice action 类型'); ⏎ });`

**tests/issue-bar-ui.test.ts**：

- L16: `  assert.match(wpv, /summarizeIssues/);`
- L17: `  assert.match(wpv, /data-testid="issue-summary-bar"/);`
- L21: `  assert.match(wpv, /dayISO\(/); ⏎   assert.match(wpv, /dayShort\(/); ⏎ }); ⏎  ⏎ test('今天列高亮（仅当前周生效）', () => { ⏎   assert.match(wpv, /data-today=\{day === todayDow \? '1' : undefined\}/); ⏎   assert.match(wpv, /day === todayDow \? 'ring-2 ring-brand\/40' : ''/);`
- L22: `  assert.match(wpv, /dayShort\(/); ⏎ });`
- L26: `  assert.match(wpv, /data-today=\{day === todayDow \? '1' : undefined\}/);`
- L27: `  assert.match(wpv, /day === todayDow \? 'ring-2 ring-brand\/40' : ''/);`

**tests/v2.test.ts**：

- L79: `  assert.match(wv, /addEventListener\('usst:replan'/); ⏎ });`

**tests/v3.test.ts**：

- L35: `  assert.match(wv, /data-testid="open-mode-setup"/, 'V1-4 换个节奏入口');    // 10`
- L40: `  assert.match(wv, /<SaturationBar/, '⑧ 满溢度条');                          // 11`
- L41: `  assert.match(wv, /data-testid="edit-mode-toggle"/, '⑨ 编辑开关');          // 12`
- L42: `  assert.match(wv, /blankTaskFor\(deleteAsk, weekNo\)/, '⑩ 留白块实体');     // 13`
- L43: `  assert.match(wv, /addEventListener\('usst:replan'/, '⑯ hold 确认触发重排'); // 14 ⏎ });`

**tests/week-diag-copy.test.ts**：

- L19: `  assert.match(wpv, /调度代价 \{Math\.round\(diag\.cost\.total\)\}（越低越好）/);`
- L29: `  assert.doesNotMatch(wpv, /加权质量分/);`

**tests/week-view-model.test.ts**：

- L168: `  assert.match(wv, /import \{ blockChip, blockDetail(, summarizeIssues)? \} from '@\/features\/week\/weekViewModel'/, '模型已接线');`
- L169: `  assert.match(wv, /const chip = blockChip\(block\)/, '卡片用 chip');`
- L170: `  assert.ok(!wv.includes('🚶 {t.fromPlace}'), '旧的散文式转场行必须下线');`
- L171: `  assert.match(wv, /data-testid="week-timeline"/, '时间轴量测锚在位');`
- L172: `  assert.match(wv, /style=\{\{ minHeight: 'calc\(100vh - 280px\)' \}\}/, '浏览态时间轴撑满主体高度（视觉重心，内联 style 不碰既有类名断言）');`
- L173: `  assert.match(wv, /\{!editable && chip\.hasDetail && onOpenDetail && \(/, '详情入口三条件闸'); ⏎   assert.match(wv, /<DetailDrawer/, '抽屉已接线'); ⏎   assert.match(wv, /blockDetail\(detailBlock\)/, '详情数据来自纯函数装配'); ⏎ });`
- L174: `  assert.match(wv, /<DetailDrawer/, '抽屉已接线');`
- L175: `  assert.match(wv, /blockDetail\(detailBlock\)/, '详情数据来自纯函数装配');`

**tests/weekplan-shift-ui.test.ts**：

- L19: `  assert.match(wpv, /data-testid="weekplan-prev-week"/);`
- L20: `  assert.match(wpv, /data-testid="weekplan-next-week"/);`
- L21: `  assert.match(wpv, /aria-label="上一周"/);`
- L22: `  assert.match(wpv, /aria-label="下一周"/);`
- L23: `  assert.match(wpv, /onShiftWeek\(-1\)/);`
- L24: `  assert.match(wpv, /onShiftWeek\(1\)/);`
- L28: `  assert.match(wpv, /onShiftWeek\?: \(d: number\) => void/);`
- L33: `  assert.match(wpv, /键盘 ←\/→ 也可切周/);`

**tests/wp12.test.ts**：

- L73: `  assert.match(wv, /pushPlanEvents\(diffPlanEvents\(layerRef\.current, projected\)\)/);`

### `src/features/libao/LbaoChat.tsx` —— 33 条断言，来自 4 个测试文件

**tests/d-batch.test.ts**：

- L22: `  assert.match(chat, /data-testid="mode-sched"/, '排程模式按钮');`
- L23: `  assert.match(chat, /data-testid="mode-chat"/, '问答模式按钮');`
- L24: `  assert.match(chat, /const \[mode, setMode\] = useState<'chat' \\| 'sched'>\(/, 'mode 状态在位'); ⏎   assert.match(chat, /switchMode\('chat'\)/, '切回问答走唯一入口'); ⏎ });`
- L25: `  assert.match(chat, /switchMode\('chat'\)/, '切回问答走唯一入口');`
- L31: `  assert.match(chat, /activeMode === 'chat'/, '问答模式拦截闸在位');`
- L32: `  assert.match(chat, /modeHint: q/, '提示卡携带原句');`
- L33: `  assert.match(chat, /modeHint != null && \(/, '提示卡渲染在位'); ⏎   assert.match(chat, /send\(q, \{ forceMode: 'sched' \}\)/, '继续按钮 = 切模式 + 原句重发'); ⏎ });`
- L34: `  assert.match(chat, /send\(q, \{ forceMode: 'sched' \}\)/, '继续按钮 = 切模式 + 原句重发');`
- L39: `  assert.match(chat, /mode: 'chat' \\| 'sched';/, '快照类型带 mode');`
- L40: `  assert.match(chat, /modeFromV2\(s\.mode, s\.schedMode\)/, 'v2 迁移按推导补 mode');`
- L41: `  assert.match(chat, /boot\?\.mode \?\? 'chat'/, 'v3 快照 mode 原样恢复');`
- L134: `  assert.match(chat, /const DIALOG_ENABLED = true;/, '总回退开关在位');`
- L135: `  assert.match(chat, /if \(DIALOG_ENABLED && activeMode === 'sched' && online !== false\)/, ⏎     '排程模式+在线才走 dialog 主干');`
- L137: `  assert.match(chat, /await tryDialogAct\(q, today, history\)/, '每轮恰一次 dialog 裁决');`
- L138: `  assert.match(chat, /const ACT_EXECUTORS: Record<DialogAct,/, '8 个 act 执行器映射在位');`
- L144: `  assert.match(chat, /ctx\.confidence >= 0\.8 && CONFIRM_RE\.test\(ctx\.q/); ⏎   assert.match(chat, /\^\(好\\|好呀\\|好啊\\|行\\|可以\\|对\\|确认\\|就这么排\\|就这么办\\|排吧\\|嗯\+\)/); ⏎ });`
- L145: `  assert.match(chat, /\^\(好\\|好呀\\|好啊\\|行\\|可以\\|对\\|确认\\|就这么排\\|就这么办\\|排吧\\|嗯\+\)/);`
- L150: `  assert.match(chat, /const markDraft = useCallback/, '草稿→topic{draft}');`
- L151: `  assert.match(chat, /const markBlocked = useCallback/, '阻塞→topic{blocked}');`
- L152: `  assert.match(chat, /priorFailed: \{ title: slots\.title, slots \}/, 'B① 议题续用记录');`
- L155: `  assert.match(chat, /pickingTopic\('replace', slots, targets\)/, 'B② replace 多候选改道 picking');`
- L156: `  assert.match(chat, /t\?\.priorFailed\n\s+&& merged\.durationMin == null/, 'replace 隐含用刚才失败的事');`
- L157: `  assert.match(chat, /await ragReply\(ctx\.q\)/, 'chit_chat 走 RAG 且议题保留');`
- L158: `  assert.match(chat, /topicExpired\(\{ \.\.\.topic, turns: topic\.turns \+ 1 \}\)/, 'turns 超限自动作废');`

**tests/v2.test.ts**：

- L75: `  assert.match(chat, /if \(clarifyPicking\) \{/);`
- L76: `  assert.match(chat, /matchCandidate\(q, clarifyPicking\.candidates\)/);`
- L77: `  assert.match(chat, /dispatchEvent\(new CustomEvent\('usst:replan'\)\)/);`
- L85: `  assert.match(src, /outcome\.slots\.title \\|\\| outcome\.slots\.intent === 'hold'/);`
- L99: `  assert.match( ⏎     src, ⏎     /planPoints: numberedQuestions\(pairs\),[\s\S]{0,400}?options: pairs\.length > 0[\s\S]{0,200}?quickOptionsFor\(pairs\[0\]\.slot, slots,/s, ⏎   ); ⏎ });`

**tests/v3.test.ts**：

- L48: `  assert.match(chat, /runRescheduleWithPreview/, '⑫ 改期草稿卡通路');        // 15`
- L49: `  assert.match(chat, /getRecentPlanEvents\(\)/, '⑬ 日程变动注入');           // 16`
- L50: `  assert.match(chat, /<MiniWeekPreview/, '⑫ 排程预览卡');                    // 17`

**tests/wp12.test.ts**：

- L75: `  assert.match(chat, /lbaoChat\(q, identity, profileCtx, getRecentPlanEvents\(\)\)/);`

### `src/App.tsx` —— 20 条断言，来自 4 个测试文件

**tests/demo-banner-ui.test.ts**：

- L17: `  assert.match(app, /schedule\.source === 'demo'/);`
- L18: `  assert.match(app, /data-testid="demo-schedule-banner"/);`
- L19: `  assert.match(app, /示例数据/);`
- L23: `  assert.match(app, /data-testid="demo-schedule-goto-import"/);`
- L24: `  assert.match(app, /setMainTab\('import'\)/);`

**tests/v3.test.ts**：

- L18: `  assert.match(app, /<Welcome/, '① 标题页挂载');                          // 1`
- L19: `  assert.match(app, /view === 'basicinfo'/, '② 基本信息步在流程里');        // 2`
- L20: `  assert.match(app, /<BasicInfoStep/, '② BasicInfoStep 挂载');             // 3`
- L21: `  assert.match(app, /<PersonaFlow/, '③ 问卷挂载');                          // 4`
- L22: `  assert.match(app, /view === 'result' && state\.persona/, '④ 结果页入口'); // 5`
- L24: `  assert.match(app, /setMainTab\(state\.schedule && state\.schedule !== MOCK_SCHEDULE \? 'calendar' : 'import'\)/, '⑤ 首落点=导入（MOCK 不算已有课表）'); // 6`
- L25: `  assert.match(app, /hasSchedule=\{!!state\.schedule && state\.schedule !== MOCK_SCHEDULE\}/, '⑤ checklist 导入项：MOCK 兜底不亮勾'); // 6b`
- L30: `  assert.match(app, /<ModeSetupDialog/, '⑥ ModeSetupDialog 挂载');          // 7`
- L31: `  assert.match(app, /addTimetableFacts\(s, getUserId\(\)\)/, '⑤ 导入后回写事实'); // 8`
- L32: `  assert.match(app, /setModeSetupOpen\(true\)/, '⑤ 导入完成自动弹窗'); // 8b`
- L33: `  assert.match(app, /onConfirm=\{\(id\) => \{ patchState\(\{ lifeMode: id \}\)/, '⑦ 确认落 lifeMode'); // 9`
- L55: `  assert.match(app, /patchState\(\{ onboarded: false \}\); setView\('welcome'\)/, '重看引导'); // 18`

**tests/weekplan-shift-ui.test.ts**：

- L29: `  assert.match(app, /onShiftWeek=\{shiftWeekBy\}/);`

**tests/wp12.test.ts**：

- L66: `  assert.match(src, /const SHOW_IMPORT = true;/);`
- L67: `  assert.doesNotMatch(src, /SHOW_IMPORT = import\.meta\.env\.DEV/);`

### `src/features/persona/PersonaResult.tsx` —— 4 条断言，来自 1 个测试文件

**tests/profile-explain.test.ts**：

- L83: `  assert.match(pr, /data-testid="profile-explain-panel"/);`
- L84: `  assert.match(pr, /这会如何影响你的排程/);`
- L85: `  assert.match(pr, /这是我猜的，可在周计划里改/);`
- L86: `  assert.match(pr, /explainProfile/);`

### `src/features/libao/libaoIntent.ts` —— 2 条断言，来自 1 个测试文件

**tests/v2.test.ts**：

- L91: `  assert.match(src, /\(别排\\|不要排\\|留出来\\|空出来\\|这段时间有空\\|没空\)/);`
- L92: `  assert.match(src, /looksLikeAction[\s\S]*?别排[\s\S]*?return true;/s);`

## 二、其余被锁源码文件（批次 C/D/E 同样不许破坏）

### `server/plan_review.py` —— 2 条（1 个测试文件）

- tests/h3h4-eval.test.ts:L152: `  assert.ok(pr.includes('@router.post("/api/plan/review")'), '端点在位');`
- tests/h3h4-eval.test.ts:L153: `  assert.ok(pr.includes('retrieved'), 'source 带 retrieved 标记（真检索 vs 静态降级）');`

### `src/components/ui/DetailDrawer.tsx` —— 3 条（1 个测试文件）

- tests/week-view-model.test.ts:L141: `  assert.match(d, /<dialog/, '用原生 dialog');`
- tests/week-view-model.test.ts:L142: `  assert.match(d, /showModal\(\)/, 'showModal 自带焦点陷阱/Esc/inert');`
- tests/week-view-model.test.ts:L143: `  assert.match(d, /motion-reduce:transition-none/, '遵循 prefers-reduced-motion');`

### `src/features/week/PlanEvalPanel.tsx` —— 6 条（1 个测试文件）

- tests/h3h4-eval.test.ts:L163: `  assert.match(panel, /data-testid="plan-review-backend"/, '后端复核渲染区');`
- tests/h3h4-eval.test.ts:L164: `  assert.match(panel, /data-testid="plan-review-offline"/, '离线如实说明');`
- tests/h3h4-eval.test.ts:L165: `  assert.match(panel, /（静态口径）/, '静态降级不冒充真检索');`
- tests/h3h4-eval.test.ts:L168: `  assert.match(panel, /data-testid="plan-review-adopt"/, '采纳按钮（RV：删按钮 → 红）');`
- tests/h3h4-eval.test.ts:L169: `  assert.match(panel, /a\.action\?\.kind === 'add_task' && \(/, '只有可加块表达的建议出采纳'); ⏎   assert.match(panel, /onClick=\{\(\) => onAdopt\(a\.action!\.task\)\}/, '点击交回任务骨架'); ⏎   const wv2 = src('/src/features/week/WeekPlanView.tsx'); ⏎   assert.match(wv2, /onAdopt=\{\(skeleton\) => \{/, 'WeekPlanView 接线采纳'); ⏎   assert.match(wv2, /note: '采纳自日程评估（重排后生效）'/, '任务 note 如实标注来源'); ⏎   assert.match(wv2, /hand`
- tests/h3h4-eval.test.ts:L170: `  assert.match(panel, /onClick=\{\(\) => onAdopt\(a\.action!\.task\)\}/, '点击交回任务骨架');`

### `src/lib/api.ts` —— 6 条（2 个测试文件）

- tests/h3h4-eval.test.ts:L156: `  assert.match(api, /export function planReview/, 'api.planReview 客户端');`
- tests/h3h4-eval.test.ts:L169: `  assert.match(panel, /a\.action\?\.kind === 'add_task' && \(/, '只有可加块表达的建议出采纳'); ⏎   assert.match(panel, /onClick=\{\(\) => onAdopt\(a\.action!\.task\)\}/, '点击交回任务骨架'); ⏎   const wv2 = src('/src/features/week/WeekPlanView.tsx'); ⏎   assert.match(wv2, /onAdopt=\{\(skeleton\) => \{/, 'WeekPlanView 接线采纳'); ⏎   assert.match(wv2, /note: '采纳自日程评估（重排后生效）'/, '任务 note 如实标注来源'); ⏎   assert.match(wv2, /hand`
- tests/h3h4-eval.test.ts:L174: `  assert.match(wv2, /handleAddTask\(\{/, '复用「加一件事」同一条攒改动流（L4：重排才生效）'); ⏎   const api2 = src('/src/lib/api.ts'); ⏎   assert.match(api2, /action\?\: \{ kind: 'add_task'; task: Record<string, unknown> \} \\| null/, 'advice action 类型'); ⏎ });`
- tests/h3h4-eval.test.ts:L176: `  assert.match(api2, /action\?\: \{ kind: 'add_task'; task: Record<string, unknown> \} \\| null/, 'advice action 类型');`
- tests/wp12.test.ts:L81: `  assert.match(api, /addTimetableFacts/);`
- tests/wp12.test.ts:L82: `  assert.doesNotMatch(api.split('addTimetableFacts')[1]?.split('}')[0] ?? '', /lat\|lon\|经纬\|坐标/i);`

### `src/lib/planner/construct.ts` —— 8 条（3 个测试文件）

- tests/knowledge-wiring.test.ts:L163: `  assert.match( ⏎     c, ⏎     /knowledgeWired\(\)[\s\S]{0,120}sedentarySafeDurations\(studyBlockDurations\(\)\)[\s\S]{0,60}\[45, 60, 90\]/, ⏎     '三元必须在位：开启走知识档位、关闭回退原档位', ⏎   );`
- tests/places-policy.test.ts:L181: `  assert.match(c, /if \(spatialWired\(\) && prev\?\.place\)/, '开关闸在位');`
- tests/places-policy.test.ts:L182: `  assert.match(c, /orderByWalkFrom\(pool, prev\.place/, '按步行排序在位'); ⏎   assert.match( ⏎     c, ⏎     /cands\.find\(\(t\) => openAt\(t, gap\.endMin - MIN_CHUNK, gap\.endMin\)\)/, ⏎     '既有「末尾仍开门」兜底链必须保留（关闭态逐位等价的前提）', ⏎   ); ⏎ });`
- tests/places-policy.test.ts:L183: `  assert.match( ⏎     c, ⏎     /cands\.find\(\(t\) => openAt\(t, gap\.endMin - MIN_CHUNK, gap\.endMin\)\)/, ⏎     '既有「末尾仍开门」兜底链必须保留（关闭态逐位等价的前提）', ⏎   );`
- tests/profile-prefs.test.ts:L133: `  assert.match(c, /prefs: blockPrefsOf\(req\)/, '偏好随 fillStudy 传入');`
- tests/profile-prefs.test.ts:L134: `  assert.match(c, /if \(prefs && prefs\.deepWorkWindows\.length > 0\)/, '有偏好才重排');`
- tests/profile-prefs.test.ts:L135: `  assert.match(c, /gapAffinity\(prefs, y\) - gapAffinity\(prefs, x\)/, '按亲和度排序在位');`
- tests/profile-prefs.test.ts:L136: `  assert.match( ⏎     c, ⏎     /\.sort\(\(a, b\) => \(b\.endMin - b\.startMin\) - \(a\.endMin - a\.startMin\)\)/, ⏎     '既有「大空档优先」基线排序必须保留（关闭态逐位等价的前提）', ⏎   );`
