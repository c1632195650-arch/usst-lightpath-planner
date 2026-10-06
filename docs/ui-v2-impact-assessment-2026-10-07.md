# 《光溯 · 设计总成 v2》技术影响评估与落地方案

> 2026-10-07 · 依据：`学术部/outputs/光溯品牌与界面统一升级案-2026-10-07.html`（15 章，本版为唯一执行依据）
> 本文回答一个问题：**按新设计稿改 UI，怎么改才不会把已调通的功能改没。**
> 结论先行：**可以改，不存在必须推倒重来的部分**。设计稿与现有代码架构高度兼容（Tailwind 令牌集中度约 8/10、引擎与视图完全解耦）；
> 真正的雷区只有一个——**26 个 `readFileSync` 源码正则测试锁死了 JSX 结构**，以及 4 个需要拍板的决策点（见 §3）。

---

## 1. 设计稿逐章 ↔ 代码现状对账

| 设计稿章节 | 触及的代码 | 改动性质 | 风险 | 备注 |
|---|---|---|---|---|
| §01 品牌标识（棱镜符号/字标/应用图标） | 新增 `src/components/LightpathMark.tsx`；`App.tsx` 顶栏、`Welcome.tsx`、`public/icon-*.png`、favicon、Android `ic_launcher` | 资源替换 + 局部重做 | 低 | `Logo120.tsx` **保留不删**（校庆场景继续用）；图标重做涉及 APK 资产，建议与移动端线协调单独做 |
| §02 梨宝形象 | 新增形象素材 + `LbaoChat.tsx` 头像位 | 纯新增/换皮 | 低 | **话术零改动**是设计稿红线，也是本方案红线（见 §4 门禁） |
| §03 欢迎页居中范式 | `Welcome.tsx`（74 行）、`src/index.css`（删 `.hero-surface .seal`、加 `.hc` 系）、`App.tsx` | 局部重做 | 低-中 | `tests/v3.test.ts:16-24` 锁 `<Welcome`/`<BasicInfoStep`/`<PersonaFlow` 组件名与 `view==='result'` 写法——**组件名与 props 契约不动**即可 |
| §04 日程重构（双层形态） | `WeekPlanView.tsx`（2373 行）、新增 `WeekBoard.tsx`/`DayAgenda.tsx`、`WeekTimetable.tsx` | **结构调整** | **高** | 全方案唯一高风险点，单独拆批 + 特性开关（§5 批次 D） |
| §05 动效系统（9 令牌） | `tailwind.config.js`（transitionDuration/TimingFunction 扩展）、`src/index.css` | 参数替换 | 低 | 与 `docs/week-view-design.md`「120–200ms」约束需对表更新（§6） |
| §06 字体系统 | `tailwind.config.js` 字体栈、`src/index.css`、新增字体文件 | 参数替换 + 资源 | 低-中 | **移除 Microsoft YaHei 是版权硬要求**；CDN @import 有离线/校园网风险，见 §3 决策点① |
| §07 色彩系统 | `tailwind.config.js` 色板、`src/constants/chartColors.ts`、`src/index.css` 2 处渐变、`index.html`/`m.html` theme-color | 参数替换 | 低 | `accent:#D98324` 退役收口为 gold；chartColors 的**数据语义键名不动**，只调值/加键 |
| §08 空间与布局（8pt/12 列/三容器） | `tailwind.config.js`（spacing/screens 扩展） | 纯新增 | 低 | 设计稿自己说「改动成本只是给容器加两个类」 |
| §09 图标体系（82 枚） | 新增 `src/components/icons/`（sprite）+ 全站约 85 处 emoji 替换 | 净新增 + 广替换 | 中 | 工作量最大但最机械；20+ 文件逐个过，先接组件层再逐页替换 |
| §10 组件库（20 组件 8 态） | `src/components/ui/`（已有 Button/Card/Chip/DetailDrawer/EmptyState/Slider 六原语，扩到 20） | 样式 + 行为 | 中 | 按组件逐个提交，勿整批 |
| §11 页面模板（10 页） | `App.tsx`、总览/待办/设置/梨宝各页 | 结构调整 | 中-高 | **不引入路由**（见 §3 决策点②）；页面树映射到现有 5 Tab |
| §12 无障碍 WCAG 2.2 AA | 全站横向 | 横向补丁 | 中 | 好消息：**拖拽非替代路径已存在**（点击块→EditBlockPanel/TimeWheelPicker 改时间），WCAG 2.5.7 基本已满足，补验证即可 |
| §13 文案与微文案 | 各页 UI 文案 | 横向 | 中 | 梨宝话术文件冻结 + CI diff 门禁（§4）；`.section-label` 的 `tracking-[0.18em]` 用在中文上是设计稿点名的真 bug，需按语言分设 |
| §14 落地治理（40 项/门禁） | `scripts/` 新增检查脚本、CI | 净新增 | 低 | 与现有 `gate_overnight.mjs` / `capability_map.mjs` 体系并轨 |

## 2. 「绝不许丢」的资产清单（改版护栏）

这些是本项目辛苦调出来的功能资产，任何 UI 批次都**不得触碰其行为**。改动前逐条对照，改动后跑守护测试证明没丢：

**排程引擎与数据流（零 DOM，理论上安全，但别顺手改）**
- `src/lib/planner/` 全部（buildWeekPlan 两遍法/增量滚动/ripple/dragTo 合规闸/转场收敛）——49 个测试文件 + `tests/golden/*.json` 快照守护
- `src/types.ts` 的 `WeekPlan`/`TimeBlock`/`PlanIssue`/`TransferHint` 契约——**本次 UI 改版不需要动任何字段**；新 UI 必须继续按 `PlanIssueCode`/`TransferHint.reliable` 机器可读码消费，禁止前端匹配文案

**周视图交互（重灾区，改 WeekPlanView 时逐条保留）**
- 拖拽链路：`dragTo` 合规调用（ripple.ts:318 起：课程拒拖/10 分钟吸附/WP10 合规闸）、compliance 组装（WeekPlanView:1051-1072）、ripple→soft/hard 锁映射（:1406-1412）、window dragend 清理（:1102-1118）
- 持久化：`userPlanStore`（key `usst-user-plan-v1`）、Undo、StrictMode 双调用防抖 updater（:502-533）
- 编辑/浏览态门控：`editMode` 持久化（`usst.week.editMode`）、浏览态不渲染编辑控件（E2E :597 在验）
- `weekViewModel.ts` 纯函数及其文案契约：估算 `≈`、`🚶`、来源三态、L0 ≤14 字（`tests/week-view-model.test.ts` 有原文断言）
- 全部 `data-testid`：`sched-badge`、`week-timeline`、`edit-mode-toggle`、`block-detail-*`、`detail-drawer`、`weekplan-prev/next-week`、`plan-eval-*`
- E2E 77 断言（`scripts/e2e-sched-session.mjs`）全绿不退化；`WEEK_VIEW_V3` 回退开关机制——新视图照抄这个模式加 `SCHEDULE_VIEW_V2` 开关

**欢迎页/画像链路**
- `App.tsx` view 状态机写法被 `tests/v0.test.ts:42-46` 源码锁（`patchState({onboarded:false}); setView('welcome')`、`data-testid="replay-onboarding"`）——改版时**保持这些语句原样**
- `tests/profile-explain.test.ts:81-87` 锁 `data-testid="profile-explain-panel"` 与两句 L3 文案（「这会如何影响你的排程」「这是我猜的，可在周计划里改」）——PersonaResult 重排视觉时保留
- 逻辑层零接触：`basicInfo.ts`、`lib/persona.ts` buildProfile、`data/personaBank.ts`（年级分层在这，不在 UI）、`deadlineStore.ts`、`chartColors.ts` 语义映射

**梨宝**
- 话术冻结：`lib/lbao.ts`、`features/persona/personaCopy.ts`、`features/libao/dialogManager.ts` 等约 9 个文件的文案段——先加 CI diff 门禁再动皮（§4）
- `DIALOG_ENABLED=false` 一行回退机制不碰；`weekPlanForChat.ts` 唯一接缝不碰

**移动端线**
- 云同步开关默认关（`webSync.ts:30`）、通知诚实口径文案（M5a E2E 刚按新文案改过断言，别再动）、`NotifyStatus`、今日页结构（与新设计稿移动端三屏大体同构，只做令牌同步 + theme-color）

## 3. 需要拍板的 4 个决策点

| # | 决策点 | 选项与建议 |
|---|---|---|
| ① | **字体加载方式** | 设计稿建议 jsDelivr CDN @import。风险：CSS 阻塞渲染、离线/PWA 场景失效、校园网对 jsDelivr 不稳。**建议：子集化自托管（woff2，200–400 KB）+ `font-display:swap`；CDN 只作过渡**。若嫌子集化麻烦，先落「方案 C」（只调 6 条参数不换字体）也能立竿见影 |
| ② | **页面树 vs 现有单页状态机** | 设计稿 §11.1 给了 /welcome /week 路由树。**建议本轮不引入 router**：App.tsx 的 view 状态机被 v0/v3 测试源码锁，引入路由是纯结构风险零视觉收益。页面树映射到现有 5 Tab（总览/梨宝/画像/课表 + 设置收进「更多」），路由留待独立 PR |
| ③ | **日程双层改造节奏** | 采纳设计稿 §14.2 自己的建议：**先落第二层（DayAgenda 当日流水）跑稳一周，再上第一层（WeekBoard 周概览）**。两层都挂在 `SCHEDULE_VIEW_V2` 特性开关后，旧时间轴保留为回退 |
| ④ | **源码正则测试的处理口径** | 26 个 readFileSync 测试锁 JSX 结构。口径：**能保留的断言行原样保留（改 className 不动结构）；确实非改不可的断言，逐条在 commit message 申报 + 保留反向验证**。开工前先跑一遍「正则锁 × 目标文件」清单（§5 批次 0） |

## 4. 新增门禁（对齐设计稿 §14.3，接入现有体系）

在 `gate_overnight.mjs` 现有四条（tsc 0 错 / engine ≥312 / ui ≥219 / 禁区零改动）之上新增，全部可脚本化：

1. **梨宝文案 diff 门禁**（最先做）：对 `lib/lbao.ts` 等话术文件做内容哈希，写进 `tests/libao-copy-freeze.test.ts`——文件被改即红。**先加锁再动皮**，把设计稿的红线变成机器拦截。
2. 对比度脚本：遍历 tailwind 令牌实算 ≥4.5:1（文字）/ ≥3:1（非文本），0 FAIL。
3. 命中区扫描：Playwright DOM 遍历可点元素 ≥44×44，0 违例。
4. reduced-motion 检查：媒体查询下无装饰动画。
5. 320px 视口无横向滚动回归。
6. 新增测试后跑 `node scripts/capability_map.mjs --write`，保证 impact 门禁不漏守护。

## 5. 分批落地（每批独立合并、独立回滚）

> 工作流固定：每批开工 `node scripts/preflight.mjs` → 收尾 `node scripts/impact.mjs` → 提交前 `node scripts/gate_overnight.mjs`；小步提交、不 push。

**批次 0 · 护栏先行（0.5 天）**
- 产出「正则锁 × 目标文件」清单：grep tests/ 里所有 readFileSync 断言，标出落在 Welcome/PersonaResult/WeekPlanView/LbaoChat/App.tsx 的每一处（含行号与断言原文）
- 落地梨宝文案冻结测试（上面门禁 #1）
- `npm run test:ui && npm run test:engine && node scripts/e2e-sched-session.mjs` 记录基线全绿截图/计数

**批次 A · 令牌与字体（1 天，低风险）**
- `tailwind.config.js`：移除 Microsoft YaHei；字体三条栈（西文前置）；新增 9 个动效令牌（transitionDuration/TimingFunction）；accent 退役→gold；12 列栅格 + 三档容器
- `src/index.css`：正文 14.5px/1.82/400、墨色 #1F2A44、占位符 #6E7688、控件边框 #8C95A6（4 处对比度修复顺手完成）
- `index.html`/`m.html` theme-color
- 按决策点①落字体文件
- ⚠ 全站 emoji→图标**不在这批**，避免一批跨太多文件

**批次 B · 标识与欢迎页（1 天，低风险）**
- 新增 `LightpathMark.tsx`（设计稿 §1.2 的 5 笔 2 色数值直接照抄）+ 字标
- `Welcome.tsx` 改居中四层结构（.hc/sym-beam/ring/gridc/spec-rule 从设计稿 CSS 抄）；删 Logo120 引用（组件文件保留）
- `App.tsx` 顶栏换符号（**保持 v0/v3 锁定的语句原样**）
- 梨宝皮：LbaoChat 头像/气泡圆角/sparkle 标识（有文案冻结测试兜底）
- favicon/应用图标重做可后置，与 APK 一起

**批次 C · 组件库（2–3 天，按组件逐个提交）**
- `src/components/ui/` 六原语扩到 20：Button 8 态（loading 宽高不变）、Segmented（role=group+aria-pressed）、Input/Select/Textarea 错误态、Switch/Checkbox、Tag、Progress、Avatar、Toast、Popover/Modal/Drawer（Esc+焦点归还）、ListRow/EmptyState/Skeleton
- 每组件：实现 + 状态断言测试 + `capability_map.mjs --write`

**批次 D · 页面层（3–5 天，高风险，逐页合并）**
1. **课表页第二层 DayAgenda**（52px 时间列/空档虚线/冲突并排/nowline）——复用 weekViewModel 输出，不改数据流；`SCHEDULE_VIEW_V2` 开关默认关
2. 跑稳一周 → **第一层 WeekBoard 七密度卡** + 周网格块样式（五维分层/微几何符双编码/⋯ 菜单替代 hover 按钮——E2E 可点元素计数会因此下降，属预期改善）
3. 总览页 Bento（深色焦点卡全页唯一）+ 三档容器
4. 待办页分组（今天/本周/已完成）、设置页行上直显当前值
5. 移动端：TodayPage/WeekBoard 令牌同步 + 底部导航命中区 44px + safe-area inset（结构已对齐设计稿，改动小）
- ⚠ `src/features/mobile/WeekBoard.tsx` 与新增 web `WeekBoard.tsx` 同名不同目录，注意 import 路径写全
- ⚠ `docs/week-view-design.md` 与新 §04 的约束差异（动效时长、块内信息五层）在 D1 合并时同步修订，避免两份规范打架

**批次 E · 无障碍与文案（2 天，A–D 之后）**
- 82 枚图标 sprite 落地 + 全站约 85 处 emoji 按设计稿 §9.6 落位矩阵逐页替换
- 全站 `:focus-visible` 双环（2px 品牌环 + 2px 白隔离圈）；`prefers-reduced-motion/contrast/color-scheme` 三媒体查询
- WCAG 2.5.7 拖拽替代路径验证（已有 TimeWheelPicker 入口，补 E2E 断言）
- 文案走查：术语表对齐、感叹号清零、中西文空格、`.section-label` 中文 tracking 修复
- 新门禁脚本（§4 的 2–5）接入 `gate_overnight.mjs`

## 6. 遗留对表

- `docs/week-view-design.md`：动效约束「120–200ms」→ 对齐 §05 令牌四档（90/140/220/360），保留「只许 opacity/transform + reduced-motion 全关」
- `tests/v3.test.ts` / `tests/v0.test.ts` / `tests/profile-explain.test.ts` / `tests/weekplan-shift-ui.test.ts` / `tests/week-diag-copy.test.ts` / `tests/d-batch.test.ts`：批次 B/D 动手前按批次 0 清单逐条核对，能保留则保留
- 能力清单：每批新增测试后 `node scripts/capability_map.mjs --write && --check`
- 决赛时间点（10 月底）倒排：若时间紧，**A+B+C+E 是「看起来换了血」的大头**，D 批可只做 D1（DayAgenda）即参加评审

---

*评估方法：设计稿 3614 行逐章阅读 + 三个并行代码探查（欢迎页/画像链路、周视图/引擎耦合、令牌/组件/移动端）+ preflight 通过（beta-v2 @ 29bf571，与 origin 同步）。*
