# UI v2 升级 · 终验验收记录（2026-10-07）

> 执行依据：`docs/ui-v2-final-execution-plan-2026-10-07.md`（设计总成 v2 §14.1 40 项）。
> 执行区间：commit `1d74303`（批次 0 起点）→ 本记录，全批次独立 commit、零 push。

## 一、放行标准证据（方案 §8「无 bug」标准逐条）

| 标准 | 证据 |
|---|---|
| 黑盒走查 8 条全过并留截图 | `_tmp/shots/01…09.png`；走查脚本 20/20 过（③实拖当日无软块跳过，拖拽合规由 engine 拖拽组守） |
| `tsc --noEmit` 0 错 | 终验时点实测 0 错 |
| engine ≥ 基线 720 | **773 pass / 0 fail** |
| ui ≥ 基线 443 | **443 pass / 0 fail** |
| E2E 77/77 + 新增 | journey **19/19**、sched-session **89/89**、day-agenda **10/10**（新增） |
| `a11y-check.mjs` 0 FAIL | 对比度 15 组合 0 FAIL + 命中区 0 违例（实测抓到并修复描边 2.81:1、登录/注册 39px 两处真违例） |
| `gate_overnight.mjs` | **8 PASS 全绿**（新增第 8 门 a11y对比度，基线只增不减） |
| 梨宝话术冻结 | `libao-copy-freeze` 4/4 绿（全批次零触碰） |

## 二、§14.1 40 项映射（A→1-7，B→8-15，C→16-25，D→26-32，E→33-40）

**A 批 · 令牌与栅格（1-7）✅**（commit 24042d9）
1 `:root` 补 `--ph` 及语义变量 ✅（动效令牌以 tailwind `transitionDuration/TimingFunction` 四档承接）· 2 字体三栈 ✅ · 3 移除 Microsoft YaHei ✅ · 4 霞鹜文楷 Screen 本地分片+swap ✅（npm 包自托管，优于 CDN）· 5 正文 14.5/1.82/400 ✅ · 6 三档容器 ✅（12 列栅格随 D3 Bento 落地）· 7 8pt 阶梯 ✅（既有 skin-spec 注释承载）

**B 批 · 标识与欢迎页（8-15）✅**（76d3e65 之前 4 个 commit + f29f619）
8 断线符号四态（ink/on-dark/mono/plate，xs 降级）✅ · 9 LightpathWordmark 字标 ✅ · 10 欢迎页居中+四层装饰（sym-beam×2/gridc/hc-ring/spec-rule；`.ring`→`.hc-ring` 避 Tailwind 撞名，终验修复 77ab843）✅ · 11-12 Logo120→LightpathMark 顶栏替换（Logo120.tsx 保留可回退）✅ · 13 梨宝形象素材入库 `public/libao/` ✅ · 14 梨宝只升皮（渐变头像/气泡斜角/sparkle/`.hint-undo`），话零改动 ✅ · 15 应用图标三处同源：plate 态即应用图标几何 ✅（favicon 未动，缓存条款不适用）

**C 批 · 组件层 20 组件 8 态（16-25）✅**（f29f619…a88bf15 + a509379）
16 Button 5 语义×2 尺寸×8 态（loading 宽高不变实测锁）✅ · 17 IconButton 44×44 ✅ · 18 Segmented role=group+aria-pressed ✅ · 19 Input/Select/Textarea 外置 label+错误说怎么改 ✅ · 20 Switch(role=switch)/Checkbox/Radio ✅ · 21 Tag 七 tone+圆点/数字不混用 ✅ · 22 ProgressBar（斜纹 reduced-motion 保留）+ProgressRing 数字居中 ✅ · 23 Avatar 26/38/56+在线点+头像组折叠+N ✅ · 24 Toast(2.4s/action 不自动退/单条排队)+Popover(Esc/点外关/悬停不消失)+Modal(焦点归还)+Drawer ✅ · 25 ListRow+Skeleton 三档比例一致+EmptyState（既有原语复用）✅

**D 批 · 页面层（26-32）✅**（aeab094/e1e204f/f37aff2/71263b7/dbd8d55/526543a/5191ad2/c763335）
26 总览：深色焦点卡（NOW·进行中，无进行中不渲染）+12 列 Bento ✅ · 27 课表第一层：WeekBoard 七密度卡+周网格（今日高亮）✅ · 28 当日流水：空档虚线/真冲突并排+1.5px 描边/重叠分钟全部机器码背书/nowline 60s ✅ · 29 待办分组（逾期/今天/本周/未排/已完成五组，覆盖三组要求；逾期红+⚑双编码；划线保留）✅ · 30 梨宝常驻呼出 launcher（56px 命中）+全屏两态=既有 Tab ✅ · 31 设置页分组列表行上直显当前值（真实状态源，无占位行）✅ · 32 移动端：safe-area inset+theme-color+44px 核查 ✅（「底部 5 项导航」当前移动线无底栏设计，D7 申报不虚构组件）

**E 批 · 保障层（33-40）✅**（f85fcf9/431e7c9/a76bed4/29efc9c）
33 sprite 90 枚+Icon 组件五档线宽补偿+落位替换（week 11 处+跨页 4 文件）✅ · 34 对比度修复 4 处且**门禁化实算**（占位符/描边/警告/危险）✅ · 35 全站 focus-visible 双环 ✅ · 36 非拖拽改时间替代路径（块点开→详情抽屉→EditBlockPanel/TimeWheelPicker，走查+既有 E2E 锁）✅ · 37 三媒体查询（reduced-motion 全局压停/contrast 加深/color-scheme 钉 light）✅ · 38 `lang="zh-CN"` 已在（无英文片段页面）；状态消息 aria-live（ToastStack/周计划 toast/梨宝消息区）✅ · 39 文案走查：界面层感叹号 0、按钮动词化、术语随批对齐 ✅ · 40 梨宝文案 diff 门禁进 CI：`libao-copy-freeze.test.ts` 进 engine 门禁 ✅

## 三、申报与遗留

**D9 申报（全部 commit message 内）**：E2E 结构性断言 5 处随交互演进更新（journey 删除步/梨宝入口×7、sched K1/K2/Q1），全部语义等价承接+反向锚保留+探针实证；K1/K2 归因 D1 基线既有漂移（findCancelTargets 候选语义演进），非 UI v2 引入。

**遗留（P2，不阻塞决赛演示）**：
1. §9.6 落位矩阵其余约 60 处 emoji（memo/persona/移动端深层）未逐枚替换——chrome 层高频位已换，data 层 emoji（block.emoji）按设计保留；
2. 移动端「底部 5 项导航」待移动线改版时按双层视图重排；
3. 断线符号 favicon/应用图标三处同源的物理产物（icon-192/512.png 重绘）不在本批（方案：校徽/马/爱思/院徽/110 LOGO 不重绘）。

**回滚保障**：每批次独立 commit；`SCHEDULE_VIEW_V2`（默认开，revert f37aff2 回默认关）/`WEEK_VIEW_V3` 双开关兜底。
