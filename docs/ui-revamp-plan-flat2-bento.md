# 光溯网页端 UI 改版执行方案 —— 扁平 2.0 + Bento 局部

> 版本 v1.0 · 2026-10-06 · 状态：待执行
> 决策来源：《光溯网页端UI改版指南》（outputs/光溯网页端UI改版指南.html）第 ⑥ 章组合建议，经 CY 确认采纳。
> 本方案是**执行文档**：每个批次写到「改哪个文件、哪一行、改成什么、怎么验证、怎么回滚」。

---

## 0. 一句话决策

**骨架不动**（保持顶栏标签页式），**皮肤走扁平 2.0 + Bento 局部**：阴影减淡、描边补位、间距按 Apple HIG 放大、状态色按 Ant Design 的角色逻辑立规矩、总览页做便当盒网格。全程**不改任何交互逻辑、不改任何 `data-testid`**。

## 1. 目标与非目标

**目标**
1. 全站观感升级为「更轻、更整齐、更松」：单一轻阴影 + 清晰细描边承担层次，去掉大柔和投影的"悬浮感"。
2. 数据区（总览页）具备 Bento 节奏：块的大小表达信息优先级，间距与圆角全场一致。
3. 建立一套写进代码注释的皮肤规范，后续任何人改 UI 都有据可依。

**非目标（本方案明确不做）**
- 不改信息架构：不合并「课表/总览」tab、不移云同步入口、不改五面板编辑区结构。
- 不改任何交互行为、状态机、条件渲染、路由。
- 不引入任何第三方组件库或 webfont。
- 不动 `m.html` 移动端线（仅 B4 做一次主色一致性核对）。

## 2. 皮肤规范（Skin Spec v1）

### 2.1 骨架

顶栏标签页式，现状延续。`.page-shell` 1200px 容器宽度**保持不变**（本方案不动第 ⑤ 章"容器宽度"那个性价比点，留给后续独立决策）。

### 2.2 五条设计法则（写进 index.css 头部注释）

1. **层次靠描边和底色差，不靠阴影。** 阴影只做"贴地" elevation，永远单层、透明度 ≤ 0.05。
2. **深色面是唯一的强调手段。** `hero-surface` / `hero-surface-flat` 及其光晕是品牌资产，一字不改。
3. **间距 8pt 网格。** 所有 padding/margin/gap 取 4 的倍数；卡片内边距 p-5（20px）起步，页面区段 py-8。
4. **可点击目标 ≥ 44px 高**（Apple HIG 触控目标），文字按钮除外。
5. **琥珀点缀上限。** `accent` 只出现在：光晕、极少数"暖端"提示位。禁止用于大面积底色和正文文字。

### 2.3 令牌变更表（tailwind.config.js）

现有 21 个色值**全部保留不动**（对比度是实测资产，动了要全部重算）。唯一新增——阴影令牌化：

```js
// theme.extend 内新增
boxShadow: {
  /** 扁平 2.0：贴地轻影，层次主要靠 border 承担。 */
  card: '0 1px 2px rgba(22,35,63,0.04), 0 4px 14px rgba(22,35,63,0.04)',
  /** 深色大卡的第二档（原值保留）。 */
  'card-dark': '0 18px 44px rgba(22,35,63,0.10)',
  /** 主按钮投影，从 0_6px_16px_.22 减淡。 */
  btn: '0 1px 3px rgba(43,76,155,0.18)',
},
```

**说明**：把阴影从 `index.css` 里的硬编码任意值收进令牌表，是为了让"阴影"和"颜色"一样成为一处可改的皮肤资产。

### 2.4 组件类变更表（src/index.css @layer components）

| 类 | 现值 | 改为 | 理由 |
|---|---|---|---|
| `.panel` | `border-ink/[0.07]` + `shadow-[0_8px_28px_rgba(22,35,63,0.06)]` | `border-ink/[0.09]` + `shadow-card` | 阴影减淡后由描边补边界；全站 24 个文件自动生效 |
| `.button-primary` | `py-3` + `shadow-[0_6px_16px_…]` | 加 `min-h-11`，投影换 `shadow-btn` | 44px 触控目标；投影减淡 |
| `.button-secondary` | `py-3` | 加 `min-h-11` | 与主按钮等高 |
| `.button-on-dark` | `min-h-10` | `min-h-11` | 三种按钮统一高度 |
| `.icon-button` | `h-9 w-9` | `h-10 w-10` | 40px，接近触控目标且不破坏月历栅格 |
| `.nav-item` / `.nav-item-active` / `.section-label` / `.page-shell` / `.content-shell` / `.hero-surface` / `.hero-surface-flat` / `.fade-item` | — | **不动** | 已符合规范 |

### 2.5 间距规范（HIG 8pt）—— B3 逐页执行

| 对象 | 现状惯例 | 规范值 |
|---|---|---|
| 卡片内边距 | p-4 ~ p-6 混用 | `p-5`（信息密的卡）/ `sm:p-6`（主卡） |
| 卡片间距 | gap-3 ~ gap-6 混用 | `gap-4` 常规 / `gap-6` 页面级分区 |
| 页面区段 | py-6 / py-8 | 统一 `py-8` |
| 卡内元素间 | gap-1 ~ gap-3 | 保持（已合理） |

### 2.6 状态色角色映射（Ant Design 逻辑，不加新色值）

AntD 的价值在「角色分档」而非具体 hex。现有语义色直接对号入座，**不新增 token**：

| 角色 | AntD 概念 | 光溯对应 | 用法 |
|---|---|---|---|
| 成功/已完成 | success | `ok` + `ok-light` | 完成态、同步成功 |
| 警告/待处理 | warning | `warn` + `warn-light` | 锁过多、估算待核对 |
| 错误/过期 | error | `danger` + `danger-light` | 校验红字、节点临期 |
| 进行中/信息 | processing / info | `brand` + `brand-light` | 选中态、加载中 |

规则：**语义色禁止做按钮底色**（按钮只有 brand 主、白底次、深色面三型），语义色只用于徽章、提示条、状态点。

### 2.7 Bento 局部规范（仅总览页 + 数据统计区）

- **块即语言**：圆角统一 `rounded-2xl`（16px），块间距统一 `gap-4`，描边统一 `.panel`。
- **大小表达优先级**：今日卡 > 节点倒计时栏 > 七天条 > 校历。
- 数据数字块（如「投入与成就」的统计格）用 `paper-sunken` 底 + `rounded-xl` 做嵌入式小格，不再各自描边。

### 2.8 对比度红线

本方案不改任何色值，现有对比度全部维持。B3 逐页间距调整时**禁止**把文字透明度降到 `ink-soft` 以下；新增任意灰色文字一律用 `text-ink-soft`（7.9:1），小字标签用 `text-ink-faint`（4.6:1，无余量，不得再降）。

---

## 3. 执行批次

### B0 · 准备（约 10 分钟）

```bash
node scripts/preflight.mjs          # 确认站在最新版本上
git checkout beta-v2 && git checkout -b feat/ui-skin-flat2
```

浏览器打开 `npm run dev`，对 欢迎页 / 总览 / 周计划 / 梨宝 四页各截一张基线图（存 `_ui_skin_baseline/`，`_` 前缀已被 gitignore，不入库）。

### B1 · 纯换肤批（约半天）—— 只动 2 个文件，零 tsx

**改动**：§2.3 令牌表 + §2.4 组件类表，全部落在 `tailwind.config.js` 和 `src/index.css`。同时在 `index.css` 顶部写入 §2.2 五条法则注释。

**预期效果**：全站 24 个文件的卡片、11 个文件的主按钮、3 个文件的导航自动换观感——变轻、变齐、按钮变高。

**验证**（顺序执行，全绿才算过）：
```bash
npm run typecheck
npm run test:ui
node scripts/impact.mjs        # .panel 被大量测试守护，此批必跑
npm run e2e                    # 必须离线模式：关掉后端再跑
```

**提交**：`feat(ui-skin): B1 扁平2.0换肤——阴影令牌化减淡+描边补位+按钮统一44px`
**回滚**：`git revert <该commit>`，单 commit 完整还原。

### B2 · Bento 总览批（约 1 天）—— 动 1~3 个 tsx（布局类名）

**改动**（`src/features/overview/OverviewPage.tsx` 为主，TodayCard/WeekStrip 仅类名微调）：
1. 外层 `grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]` → `gap-4`，内层 `flex flex-col gap-6` → `gap-4`。
2. 校历卡收起态说明行与展开态统一内边距 `p-5 sm:p-6`。
3. `DeadlineBoard` 卡片样式核对统一为 `.panel` 基准（若已是则不改）。
4. 今日卡内统计/数字区块若为散排，改为 §2.7 的 sunken 小格样式。

**验证**：同 B1（typecheck / test:ui / impact / 离线 e2e）；总览页与手机宽度（<640px）目测。
**提交**：`feat(ui-skin): B2 总览页Bento化——块间距统一gap-4+数据格sunken化`
**回滚**：同上，单 commit。

### B3 · 逐页间距精修（可选，每页约半天）—— 按页推进

优先级：**周计划页**（2360 行，重灾区）→ **梨宝页** → 待办页 → 画像/欢迎页。
每页只做：卡片内边距、卡片间距、区段间距按 §2.5 调整；顺手把该页明显违反 §2.6 的语义色误用改掉。
**每页独立 commit、独立验证**（typecheck + test:ui + 该页相关 e2e 断言），一页不过不碰下一页。

### B4 · 收尾验收（约半天）

```bash
node scripts/impact.mjs
node scripts/gate_overnight.mjs      # 全量门禁
```

- 四页 After 截图 vs B0 基线对比，确认「更轻、更松」达标。
- **m.html 主色核对**：打开 `m.html`，确认网页端换肤后两端主色（ink/brand）仍一致——本方案不改色值，理论上自动一致，核对只为兜底。
- 按 §6 验收清单逐条打勾，全过 → `git checkout beta-v2 && git merge feat/ui-skin-flat2`（本地合回）。

## 4. 全局工作流纪律

- **三命令标准流**：开工 `node scripts/preflight.mjs` → 收尾 `node scripts/impact.mjs` → 提交前 `node scripts/gate_overnight.mjs`。
- **只 commit 不 push**；每批一个 commit，粒度=可独立回滚。
- e2e 必须**离线跑**（关后端），否则断言假红。
- 提交前确认 `.env`/密钥/大文件不在暂存区。

## 5. 红线（违反即回滚）

1. 不碰 `data-testid`、`aria-label` 文案、条件渲染分支、状态机——测试靠它们定位。
2. 不碰 `src/types.ts`、`data/` 二进制、`evals/golden/` 既有条目。
3. 不改 21 个色值与对比度（本方案唯一允许的"色"改动是阴影令牌，不含颜色）。
4. 全仓 LF 行尾，新文件写 LF。
5. 禁止 `git push` / `reset --hard` / `rebase` / `clean -fd`。
6. 不启动/杀 8000 端口上的任何进程。
7. 改测试断言让门禁变绿 = 假覆盖，绝对禁止。

## 6. 验收清单（B4 逐条检查）

- [ ] 全站卡片圆角一致 16px、描边一致 `ink/9%`、阴影为单层轻影。
- [ ] 三种按钮等高 ≥ 44px，hover/active/disabled 状态正常。
- [ ] 总览页块间距统一 16px，Bento 节奏成立（今日卡最大、层级可读）。
- [ ] 正文仍为 `ink`/`ink-soft`，无新增低对比文字。
- [ ] `npm run typecheck` 0 错。
- [ ] `npm run test:ui`、`npm run test:engine`、离线 `npm run e2e` 全绿。
- [ ] `node scripts/impact.mjs` PASS。
- [ ] `node scripts/gate_overnight.mjs` PASS。
- [ ] 深色面（欢迎页/今日卡/画像结果/题卡）观感不变——品牌资产未受损。
- [ ] m.html 与网页端主色一致。

## 7. 移入 backlog（指南第 ③ 章中有价值、但属产品决策，本方案不做）

合并"课表/总览"tab 考证 · 云同步入口改滑动开关并更名"和手机同步" · 节点倒计时与重要日数据打通 · 周计划"重新排一遍"吸底主按钮 · 编辑面板改侧边抽屉 · 求解器诊断收进折叠 · 页脚加版本号与反馈入口。

---

*执行时如与本仓 AGENTS.md 冲突，以 AGENTS.md 为准。方案本身的修订也走 commit。*
