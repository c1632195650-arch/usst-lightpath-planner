# 光溯 UI v2 · 最终一键完整升级执行方案（定稿 2026-10-07）

> **执行依据**：`学术部/outputs/光溯品牌与界面统一升级案-2026-10-07.html`（3642 行最终版，唯一执行依据）
> **前置阅读**：`docs/ui-v2-impact-assessment-2026-10-07.md`（对账与护栏清单）
> **目标**：按 15 章设计稿完成全站 UI 升级，**已调通功能零丢失**，交互逻辑变化全部落在既有数据面上，
> agent 在真实前后端上自主调试至「核心功能可直接上手、无 bug」，全程门禁可验证。

---

## ▶ 一键启动（执行 agent 从这里开始）

```
你是光溯 UI v2 升级执行者。严格按本文档批次 0 → A → B → C → D → E → 终验 的顺序执行。
每个批次：开工跑 preflight → 按步骤改 → 跑该批次门禁 → 独立 commit（不 push）。
任何一步门禁红了：先修回绿；修不回来按 §6 调试协议三分法处理；
需求歧义或需要动 src/types.ts / data/ 二进制 / evals/golden 既有条目 → 写 BLOCKERS.md 停手。
禁止：push、reset --hard、rebase、clean -fd、删测试文件、放宽数值基线、改梨宝话术。
```

---

## 0. 已拍板决策（不再讨论，直接执行）

| # | 决策 | 内容 |
|---|---|---|
| D1 | **字体** | 霞鹜文楷 Screen（OFL）。安装 `npm i lxgw-wenkai-screen-webfont@1.1.0`（本方案预授权的唯一新依赖），在 `src/index.css` 顶部 `@import 'lxgw-wenkai-screen-webfont/lxgwwenkaiscreen.css'`（包内 css 自带 unicode-range 分片 + `font-display:swap`，浏览器只按需拉分片，离线可用）。**不用 CDN @import 做运行时加载**。若 npm 安装失败（网络）：备选链 = curl 从 jsdelivr 把该包的 css+woff2 下载到 `public/fonts/lxgwwenkaiscreen/` 自托管（woff2 允许提交，先确认不被 .gitignore 拦）。只作标题层（`--display` 栈），正文与用户输入保持系统字体。 |
| D2 | **不引入路由** | 设计稿 §11.1 页面树映射到现有 5 Tab 状态机；`/xxx` 路由留待独立 PR。 |
| D3 | **日程双层两阶段** | 新视图挂 `SCHEDULE_VIEW_V2` 开关（localStorage `usst.scheduleViewV2`，默认关）。第一阶段只上 DayAgenda；跑稳后第二阶段上 WeekBoard + 周网格改版；最后单独一个 commit 把默认值改开（可一键 revert）。旧 `WEEK_VIEW_V3` 回退机制保留不动。 |
| D4 | **符号几何** | 用**最终版断线方案**：入射光 `M5.25 24h8.5`、三角 `M20.75 12L34.15 35H7.35z`、折射光三条等长 5.4、张角 ±22°（`M30.85 18L35.85 15.98 M34.34 24L39.35 24 M37.84 30L42.84 32.02`）、**单色 currentColor（金也退出符号）**、线宽 2.4 / lg-tri 3.2 / xs 变体 3.2+4.2、引用宽高较旧版 ×0.91。数值以设计稿 §1.2 表为准照抄。 |
| D5 | **图标 90 枚** | sprite = 72 功能 + **12 上理建筑指认层**（men/lib/yates/hall/sci/dorm/gym/ave/liu/brick/river/park，只回答"这是哪一栋"）+ 6 微几何编码符。落 `src/components/icons/`。 |
| D6 | **accent 退役兼容** | `tailwind.config.js` 新增 `gold` 色板（#E8B44E/#F2C879/#C08A45）；`accent.DEFAULT` 值改为 `#E8B44E` 并注释 deprecated（MemoryPanel/GoalTodoCard/GoalPanel/TodoList/LbaoChat/EvalPanel/TodayPage/BlockCard/Slider 等 9 个文件的 `accent-*` class 零改动自动换色）；批次 E 再逐文件替换为 gold 并删 accent 键。 |
| D7 | **通知提醒** | 会话内客户端实现（Notification API + 每条可单独关，存 localStorage）。**服务端推送不在本次范围**（已核实 `server/` 无通知接口，不新增）。 |
| D8 | **后端契约** | **本次 0 个 API 端点新增/修改**。已核实：日程双层/⋯菜单/待办分组/撤销/搜索快捷键/梨宝呼出全部由既有数据面承接（planner 纯函数、`userPlanStore`、`assignmentStore`、`webSync` 状态、`PlanIssueCode` 机器码）。后端只做回归验证（§6.3 三个相邻点）。 |
| D9 | **测试调整授权** | 见 §6.4 纪律。用户已授权 agent 自主调整测试，边界为：**允许**更新因 JSX 重排失配的结构性源码正则锁（须 commit message 申报旧行→新行对照）；**禁止**删测试、改行为断言为恒真、放宽数值基线、动 `evals/golden` 既有条目与 `tests/golden` 引擎快照。 |

## 1. 精确护栏清单（改版时逐条保留，动前先核对）

**源码正则锁（已实盘盘点：31 个测试文件含 readFileSync，直接锁组件源码的目标分布如下）**

| 被锁文件 | 锁数 | 必须原样保留的断言原文（样例） |
|---|---|---|
| `src/features/week/WeekPlanView.tsx` | 6 处 | `data-testid="weekplan-prev-week"`、`调度代价 {Math.round(diag.cost.total)}（越低越好）`、`style={{ minHeight: 'calc(100vh - 280px)' }}`（week-view-model.test.ts:172 明示"内联 style 不碰"） |
| `src/features/libao/LbaoChat.tsx` | 4 处 | `data-testid="mode-sched"` / `"mode-chat"`、`useState<'chat' \| 'sched'>(`、`switchMode('chat')`、`activeMode === 'chat'`、`send(q, { forceMode: 'sched' })`（d-batch.test.ts:22-40） |
| `src/App.tsx` | 3 处 | `data-testid="replay-onboarding"`、`patchState({ onboarded: false }); setView('welcome')`、`setMainTab(state.schedule && state.schedule !== MOCK_SCHEDULE ? 'calendar' : 'import')`、`<Welcome`、`<BasicInfoStep`、`<PersonaFlow`、`view === 'basicinfo'`、`view === 'result' && state.persona`、`hasSchedule={...MOCK_SCHEDULE...}`、`onboardingCard={`（v0/v3.test.ts） |
| `src/features/persona/PersonaResult.tsx` | 1 处 | `data-testid="profile-explain-panel"`、`这会如何影响你的排程`、`这是我猜的，可在周计划里改` |
| `src/features/libao/libaoIntent.ts` | 1 处 | 意图正则与关键词结构 |

**行为/交互资产（任何批次不得改变其行为）**
- 引擎侧零接触：`src/lib/planner/**`（buildWeekPlan/dragTo 合规闸/ripple/吸附/课程拒拖/转场收敛）、`src/types.ts`（本次不需要动任何字段）、`tests/golden/*.json`、`evals/golden/*.jsonl`
- 拖拽链路：compliance 组装、ripple→soft/hard 锁映射、window dragend 清理、StrictMode 防抖 updater、Undo
- `weekViewModel.ts` 输出文案契约：`≈`、`🚶`、来源三态、L0 ≤14 字
- E2E 依赖的 11 个 testid（已实盘）：`sched-badge`、`week-timeline`、`edit-mode-toggle`、`block-detail-*`、`detail-drawer`、`plan-eval-entry/panel`、`plan-review-offline`、`mode-sched/mode-chat`、`switch-to-sched`、`libao-input` + `weekplan-prev/next-week`
- 梨宝话术：`lib/lbao.ts`、`dialogManager.ts`、`personaCopy.ts` 等——**批次 0 先上冻结测试，再动皮**
- 移动端：云同步开关默认关（`webSync.ts:30`）、`NotifyStatus` 诚实口径文案（M5a E2E 刚锁定）
- `Logo120.tsx` 文件保留（已核实**无测试断言其用法**，App.tsx:236 / Welcome.tsx:23 两处引用可安全替换）；校徽/马/爱思/院徽/110 LOGO 不重绘

## 2. 批次 0 · 护栏先行（约 0.5 天）

1. `node scripts/preflight.mjs`（必须 ✅）→ `npm run typecheck` → `npm run test:engine` → `npm run test:ui` → 记录基线数字（engine pass 数 / ui pass 数）到 commit message。
2. 生成锁清单文档 `docs/ui-v2-regex-lock-inventory.md`：对上表 5 个文件，把 31 个测试文件里每条 `assert.match(<目标文件>)` 的行号+原文抄出（grep 命令：`grep -n "assert.match" tests/*.test.ts | grep -v fileURLToPath` 逐文件过）。后续每批次动文件前先查此单。
3. 新增 `tests/libao-copy-freeze.test.ts`：对 `src/lib/lbao.ts`、`src/features/libao/dialogManager.ts`、`src/features/persona/personaCopy.ts` 的文本内容做规范化哈希（去空白后 sha256），与测试内硬编码基线比对，文件被改即红。**先加锁，后动皮。**
4. `node scripts/capability_map.mjs --write`，确认新测试进守护映射。
- 门禁：typecheck 0 错；engine/ui fail=0 且 pass ≥ 基线；`gate_overnight.mjs` 绿。
- commit：`test(guard): UI v2 批次0——梨宝话术冻结门禁+源码锁清单基线`

## 3. 批次 A · 令牌与字体（约 1 天，低风险）

**改动文件**：`tailwind.config.js`、`src/index.css`、`index.html`、`m.html`、`package.json`

1. `tailwind.config.js`：
   - 删字体栈里的 `Microsoft YaHei`（:69/:70，版权硬要求）；`sans` 改西文前置（`Inter, -apple-system, 'PingFang SC', 'HarmonyOS Sans SC', 'Source Han Sans SC', system-ui, sans-serif`）；`display` 前置 `"LXGW WenKai Screen"`；新增 `mono: ['JetBrains Mono','ui-monospace','SFMono-Regular','Consolas','monospace']`。
   - 新增动效令牌：`transitionDuration: { instant:'90ms', fast:'140ms', base:'220ms', slow:'360ms' }`、`transitionTimingFunction: { out:'cubic-bezier(.16,.84,.44,1)', in:'cubic-bezier(.55,0,1,.45)', standard:'cubic-bezier(.4,0,.2,1)', spring:'cubic-bezier(.34,1.56,.64,1)' }`。
   - 新增 `gold` 色板；`accent.DEFAULT` 值改 `#E8B44E`（决策 D6）。
   - 新增三档容器宽度（`maxWidth: { narrow:'720px', default:'1200px', wide:'1440px' }`）。
2. `src/index.css`：正文 `font-size:14.5px; line-height:1.82; font-weight:400`、墨色 `#1F2A44`；新增 `:root` 变量 `--ph:#6E7688`、`--border-control:#8C95A6`、`--warn-text:#965C18`、`--danger-text:#B0402F`（设计稿 §7.8 四处对比度修复）；顶部 `@import` 字体包 css。
3. 中文 tracking bug 修复：`index.css:79` 的 `.section-label` 加 `tracking-[0.01em]` 版本 `.section-label-zh`，`App.tsx:416` 中文标签改用之（PersonaFlow:183 / PersonaResult:92 是英文眉标，保留 0.18em）。
4. `index.html` / `m.html`：`<title>` 加「光溯」、`theme-color` 改 `#1F3A78`。
5. 验证字体生效：`npm run dev` 后浏览器检查标题层 font-family 实际命中 `LXGW WenKai Screen`（Network 面板确认只拉了用到的分片）。
- 门禁：typecheck 0 错；engine/ui 全绿（本批不动组件，预期零断）；若 `week-view-model.test.ts:172` 类断言受影响（不应受），按 D9 处理。
- commit：`feat(ui-tokens): 批次A——动效令牌+字体三条栈(霞鹜文楷Screen本地分片)+去雅黑+对比度修复`

## 4. 批次 B · 标识与欢迎页 + 梨宝皮（约 1–1.5 天）

1. 新增 `src/components/LightpathMark.tsx`：断线几何四态（tone: ink / on-dark / mono / plate，size props，xs 降级规则）。新增 `LightpathWordmark`（光溯 + LIGHTPATH 字标，display 栈）。
2. `App.tsx:236` 顶栏换 `<LightpathMark tone="plate" size={32} />`（**v0/v3 锁定语句一律原样**）；`Welcome.tsx:23` 同步替换。
3. `Welcome.tsx` 居中改版：外层 `.hc` 容器 + 四层装饰（sym-beam 左右镜像 / ring 同心刻度环 / gridc 细网格 / spec-rule 光谱标尺），样式抄设计稿 §3.5 落地表进 `index.css`；删 4 处水印与 `.hero-surface .seal` 规则；保留 `<Welcome` 组件名、props 契约、`replay-onboarding` testid。
4. 梨宝皮（`LbaoChat.tsx`）：头像位换梨宝品牌渐变（`#F2D45C→#9ED46B`）、气泡圆角靠说话人一侧 4px、AI 生成内容挂 sparkle 图标 + 「改动已写入 · 可撤销 5s」提示条样式。**只动样式节点与结构包裹**，上表 d-batch 锁定行（mode testid / useState 类型 / switchMode / modeHint / send forceMode）与一切文案字符串零改动。
5. 梨宝形象素材：若 `outputs/.../libao/libao-*.png` 已就位则复制进 `public/libao/`（≤32px 场景用内联 SVG 头像版）；未就位则跳过图片、仅做 CSS 渐变头像，不阻塞。
- 门禁：typecheck；engine/ui 全绿；`npm run test:libao` 可选（需活后端）不做硬门禁；E2E smoke（onboarding 动线）通过。
- commit：`feat(ui-brand): 批次B——棱镜符号断线几何+欢迎页居中四层+梨宝皮升级(话零改动)`

## 5. 批次 C · 组件库（约 2–3 天，纯新增，逐组件 commit）

在 `src/components/ui/` 现有六原语（Button/Card/Chip/DetailDrawer/EmptyState/Slider）基础上**只增不改调用点**，补齐设计稿 §10 的 20 组件 × 8 态：

Button 8 态（loading 宽高不变）/ IconButton 44×44 命中区 / Segmented（`role="group"`+`aria-pressed`）/ Input+Select+Textarea（外置 label、错误态、占位符 #6E7688）/ Switch+Checkbox+Radio / Tag / Progress 条+环 / Avatar / Toast（2.4s 自动退场，带操作按钮不自动退，`aria-live="polite"`）/ Popover（Esc 关、悬停不消失）/ Modal（焦点归还）/ Drawer / ListRow / EmptyState / Skeleton（行高与真内容一致）。

- 每组件一个 commit：`feat(ui-cmp): Batch C——<组件名> 8态`；每组件附状态断言测试（disabled/loading/selected/aria 可 DOM 验证项）；`capability_map.mjs --write`。
- 本批不替换任何现有页面调用（批次 D 才逐页接入）→ impact 预期 PASS。

## 6. 批次 D · 页面层（约 3–5 天，高风险，逐页合并）

> 每步完成即跑：typecheck + engine/ui 全绿 + `node scripts/e2e-sched-session.mjs`（**必须离线模式**：vite 的 API_BASE 不指向活后端，见脚本头注释）77/77。

- **D1 DayAgenda（当日流水）**：新增 `src/features/week/DayAgenda.tsx` + `agendaModel.ts`（纯函数：blocks 按天分组、空档识别=虚线降透明、真冲突各占 50% 并排 + 1.5px 警告描边 + 顶部「重叠 X 分钟」行——数据全部来自 `PlanIssue` 机器码，不匹配文案）。nowline：2px 上理红 + 8px 圆点，60s 定时刷新、不做平滑动画、reduced-motion 下静止。挂 `SCHEDULE_VIEW_V2` 开关（默认关）。新增 E2E 用例（开关开后 `data-testid="day-agenda"` 渲染、点击块→改时间路径可达）。
- **D2 周网格块改版 + WeekBoard（周概览七密度卡）**：`WeekTimetable.tsx` 块改五维分层（色条 4px+微几何符 / 课程名 600 / 时间等宽品牌色 / 地点 / 状态 tag）+ ⋯ 菜单替代 hover 浮现按钮（E2E 可点元素计数下降属预期改善）；`KIND_STYLE` 色值切到设计稿 §7.6 六类（保持 `chartColors.ts` 语义键名，只调值/加键）；新增 `WeekBoard.tsx`（注意 `src/features/mobile/WeekBoard.tsx` 同名，import 路径写全）。`WeekPlanView.tsx` 容器改为「上层→下层」，**护栏清单 6 处锁定行原样保留**（改样式不动结构），删除「感受测试版」标记。跑稳后单独 commit 把 `SCHEDULE_VIEW_V2` 默认改开。
- **D3 总览页**：深色焦点卡（全页唯一重物，无进行中事项不渲染）+ 12 列 Bento（跨度只用 4/6/8/12）+ 三档容器；保留 E2E 依赖的 testid 与 `onboardingCard` 接线。
- **D4 待办页**：复用 `assignmentStore`/`routineStore`（**不新增存储**），今天/本周/已完成分组，逾期红+flag 双编码，完成项划线保留。
- **D5 设置页**：分组列表 + 行上直显当前值（校区/同步状态读 `webSync` 现有状态、ICS 导出与订阅链接复用既有端点输出）；**没有的功能不上占位行**（防假按钮）。
- **D6 梨宝常驻呼出**：右下 launcher 呼出 + 全屏两态（现有 Tab 即全屏态，复用 `mode-sched/mode-chat` 既有结构）。
- **D7 移动端令牌同步**：`TodayPage/WeekBoard/GoalTodoCard/BlockCard/NotifyStatus` 换新令牌 class；底部导航命中区 ≥44×44 + `env(safe-area-inset-bottom)`；`m.html` theme-color。`NotifyStatus` 文案与云同步默认关**零改动**。
- 每步 commit：`feat(ui-page): 批次D#——<页面>`；门禁同上。`docs/week-view-design.md` 在 D2 合并时同步修订（动效时长对齐 §05 令牌四档；「只许 opacity/transform + reduced-motion 全关」保留）。

## 7. 批次 E · 图标实装 + 无障碍 + 文案（约 2 天）

1. 90 枚 sprite：`src/components/icons/` 导出 `<Icon name size tone />`（viewBox 24、线宽 2、round、currentColor；xs/sm/md/lg/xl 五档线宽补偿表照抄 §9.3）。按 §9.6 落位矩阵逐页替换全站约 85 处 emoji，分 5–6 个 commit（week / libao / mobile / memo / persona / components）。
2. 全站 `:focus-visible` 双环（`0 0 0 2px #fff, 0 0 0 4px var(--brand-bright)`）；`prefers-reduced-motion`（装饰动画全停、进度斜纹静止保留）、`prefers-contrast`、`prefers-color-scheme` 三媒体查询；状态消息挂 `aria-live`。
3. WCAG 2.5.7：拖拽替代路径 E2E 断言（点击块 → 改时间 → TimeWheelPicker，路径已存在，补自动化证明）。
4. 文案走查（**仅界面层，梨宝除外**）：按钮=动词、感叹号清零、错误信息=陈述+建议、术语表对齐（待办/日程/周概览/当日流水）、中西文半角空格。凡触碰锁定文案（`调度代价…`、weekViewModel 三态等）→ 按 D9 申报或不动。
5. 新增 `scripts/a11y-check.mjs`：对比度脚本（遍历令牌实算 ≥4.5/≥3:1，0 FAIL）+ Playwright 命中区扫描（可点元素 ≥44×44，0 违例），接入 `gate_overnight.mjs` 为新增门（基线记录后只增不减）。
- commit：`feat(ui-a11y): 批次E——90枚图标实装+WCAG2.2AA补齐+文案走查+新门禁`

## 8. 自主调试协议（真实前后端，贯穿 D/E 与终验）

**环境起停**
- 前端：`npm run dev`（127.0.0.1:5173）。后端：`python server/app.py`（127.0.0.1:8000；不配 Key 自动降级抽取式，够验证路由与结构）。起服务前先探测端口是否被占（`curl -s http://127.0.0.1:8000/api/health`）——**只允许杀掉自己本次起的进程**（记录 PID），绝不碰别人已在 8000 上的实例。
- E2E（`scripts/e2e-sched-session.mjs`）**必须离线跑**：vite 的 API_BASE 指向空端口（脚本头注释既有约定），与真实后端调试分开做，两不混淆。

**黑盒走查（用 browser-use 技能逐条执行并截图留证）**
1. 欢迎页居中渲染 → 「开始使用」→ 基础信息校验 → 问卷年级分层出题 → 结果页雷达 + explain 面板两句文案在位 → 进入主界面首落点=导入。
2. 梨宝排程对话：mode-sched → 输入排程诉求 → 生成周计划 → `sched-badge` 出现 → 周时间轴渲染。
3. 拖拽改时间：拿起→预览警告色→落下回弹→Toast「已移到 …·撤销」→Undo 生效；课程块拒拖。
4. 非拖拽改时间：点块 → 改时间 → TimeWheelPicker（WCAG 2.5.7）。
5. 编辑模式开关、加任务、详情抽屉（block-detail-*）、周切换（prev/next）。
6. 待办分组与勾选（划线保留）、设置页同步状态、ICS 链接可达。
7. 移动端 `m.html`：今日页直入流水、底栏 44px、通知横幅诚实口径。
8. `SCHEDULE_VIEW_V2` 开=双层视图完整走一遍；开=关各跑一遍 E2E。

**bug 三分法**：实现 bug → 修实现，修完重跑该流程 + 全量门禁；测试过时（断言锁的是旧视觉/旧结构且语义已被新实现等价承接）→ 按 D9 更新断言 + commit 申报对照 + 反向验证（临时回退实现确认测试会红）；需求歧义/需动契约层 → `BLOCKERS.md` 停。

**「无 bug」放行标准（全部满足才可宣告完成）**：走查 8 条全过并留截图；`tsc --noEmit` 0 错；engine fail=0 且 pass ≥ 基线；ui fail=0 且 pass ≥ 基线；E2E 77/77 + 新增用例全绿；`a11y-check.mjs` 0 FAIL；`gate_overnight.mjs` 绿；梨宝话术冻结测试绿。

## 9. 终验 · 用户直接上手验收

- **5 分钟上手路径**：`npm install && npm run dev` → 欢迎页 → 问卷 → 主界面 → 梨宝排程 → 拖拽/改时间/撤销 → 待办 → 移动端 m.html。全程无报错、无死按钮、无占位假功能。
- 设计稿 §14.1 的 40 项清单逐项打勾，映射：A→#1-7，B→#8-15，C→#16-25，D→#26-32，E→#33-40（写进终验 commit message）。
- 回滚保障：每批次独立 commit，`git revert <batch-commit>` 单批回退；`SCHEDULE_VIEW_V2` / `WEEK_VIEW_V3` 双开关兜底日程视图。

## 10. 工期与最低可演示集

批次 0(0.5d) + A(1d) + B(1–1.5d) + C(2–3d) + D(3–5d) + E(2d) + 调试缓冲(1–2d) ≈ **10–14 个工作日**。
若决赛时间紧：**0 + A + B + C + D1 + 调试** 即为最低可演示集（观感换血 ≈80%，日程双层先出当日流水一层）。
