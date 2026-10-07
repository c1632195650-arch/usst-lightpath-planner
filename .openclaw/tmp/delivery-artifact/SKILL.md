---
name: delivery-artifact
description: 把成果做成单文件 HTML 交付物——四种形态：Native 文档 / 杂志长文 / PPT 风 / Stage（原型 / 动画 / infographic / kiosk）。**专家模式渲染段默认必经入口**：成果超过一两段话、或需要视觉张力 / 交互 / 更好的展示结构 → 一律走本 skill 出 HTML 文件，不在 chat 里 dump 长文字；只有结论一两段纯文字讲得完才回纯文本。**Stage 形态进入后路由到内置 `references/huashu-design/`；用户要 PDF → 用顶层 `pdf-creator` skill,不走本入口**。
triggers:
  - "html"
  - "网页"
  - "artifact"
  - "制品"
  - "mockup"
  - "原型"
  - "动画"
  - "infographic"
---

# Delivery Artifact

把任务结果做成**单文件、可双击打开**的 HTML 交付物。被加载即默认产 HTML —— 「要不要 HTML」的判断在加载本 skill 之前已经做完。本 skill 只负责：**选对一种形态 → 套通用禁律 → 产出**。

## 第一步：形态例外（Stage）

默认 HTML（走第二步）。一个例外：

- **用户要 Stage 形态**（iOS / 手机原型、motion / 教学 / 讲解动画、印刷级 infographic、kiosk 全屏舞台）→ `references/huashu-design/huashu-design.md`，按它的流程走。Stage = `position:fixed` + 视口锁定的工程模式，跟 Native 文档（标准滚动流）不是同类，进了 huashu 分支就不走第二步。

PDF 不在本 skill 范围——用户要 PDF,由 SOP Phase 5 路由到顶层 `pdf-creator` skill。

## 第二步：形态路由（四选一）

自上而下匹配，**命中第一条强信号就定形态**；都不强匹配 → Native HTML 兜底。

| 形态 | 选它的信号 | 典型产物 |
|---|---|---|
| **PPT 风**（横向翻页 deck） | 内容是「讲」给人听的：演讲 / 分享会 / 发布会 / demo day / 路演 | 分享 deck、发布会演示 |
| **杂志风**（竖向滚动长文） | 图文并茂的阅读物、有叙事弧、偏品牌 / 编辑感 | 深度文章、产品故事、年度回顾 |
| **Native HTML**（默认兜底） | 以上都不强匹配 —— 一份要「看」的交付物，从单页报告到多章节带 TOC 的文档 | 报告、方案、对比、说明、复盘、手册 |

定形态后，按下面 3 节各形态的指引走 —— 读对应 `references/`。Native 文档可选嵌交互 widget，见 `references/native-html.md` 的「嵌入式交互组件」一节。

## 第三步：去 AI 感（3 形态共用 · 硬约束）

「AI 感」不是玄学，是一组可枚举的 telltale 特征。下面每条都是 open-design 的 editorial 模板逐字定下的铁律。

> **PPT 风 / Native 风例外**：这两种形态各有完整的视觉规范 —— PPT 看 `references/guizang-ppt/` 自带的 `checklist.md`，Native 看 `references/native-html-checklist.md`，各自按认定的方向决定美学。下面这张表是**杂志风**的硬约束；其中**普适反 slop 条目**对三形态都成立，美学条目由各形态自己的方向决定。本节后半段的工程约束仍 3 形态共用。

| 维度 | 禁 | 改用 |
|---|---|---|
| 形状 | 圆角卡片墙（多个圆角卡片堆成 KPI 网格 = dashboard tell）；「圆角 + drop-shadow」二连；「圆角 + 左侧彩色 border」的 alert / callout 块 | 主体结构用直角 + 1px hairline 描边；小元件（代码块、chip / pill / badge、widget 角部）≤4px 柔化 OK；soft 调性文档（research explainer 类）widget 可放到 14px |
| 光影 | drop-shadow / 渐变 / blur | 阴影只能是 `0 0 0 1px` 的 hairline 描边 |
| 颜色 | 多色彩虹 / 霓虹色 / hero gradient | 一个 accent 色；层级靠字号 + 字体 + 留白，不靠颜色 |
| 图标 | emoji 装饰、lucide / feather 等通用 SVG 图标库 | 自己写 inline SVG（内容里的 emoji 不算装饰） |
| 内容 | 数据捏造 / Lorem ipsum / 占位图片 URL | 真实数据；未知值写 `—`；配图用纯 CSS / 内联 SVG |
| 结构 | 堆 KPI 卡、堆图标的「dashboard 感」 | Composed pages —— 当成排过版的印刷品，不是仪表盘 |
| 字体 | Inter / Arial 千篇一律；中英混 sans + serif | 标题 / 正文字体分工明确，一种语言一套 |

工程约束（同样 3 形态共用）：

- 单文件自包含：CSS 内联 `<style>`、JS 内联 `<script>`、小图内联 SVG；无构建步骤、无外链图片（字体 / 图标 CDN 除外），双击即开。
- 不用 sandbox-hostile API：`localStorage` / `sessionStorage` / `alert` / `confirm` / `prompt` / `window.open` —— 在沙箱里渲染会炸。
- 一份交付物只用一套视觉系统（一套配色、一套字体），中途不换。
- 署名:用户没要就不加 footer / 水印;要加只写 `AutoClaw`。
- 产出后告诉用户文件路径 + `open <path>`。

## 3 种形态

Native / 杂志 / PPT 都是本 skill 内自包含的。三形态共享的反 AI 硬约束 + 工程约束见上面第三步；各形态在下面各自细化。

### 1. Native HTML
静态 editorial 排版文档（报告 / 长文 / 信函 / 简历 / 研报 / changelog…），可选嵌入交互 widget。**这里不给模板** —— prototype-skill 模型：按产物认定一个视觉方向，再精确执行。
- 方法 + 文档类型 + 嵌 widget 指引：`references/native-html.md` · 质量地板：`references/native-html-checklist.md`
- `references/native-examples/`：6 份范型铺开 Native 的结构 × 调性 × 能力空间。读了学品质标准与结构选择、从零执行，不要抄。各份格子 / 调性 / 「不要照抄」注意见 `references/native-examples/SOURCE.md`。

### 2. 杂志风
竖向滚动的 editorial 长文，衬线标题 + 图文混排 + 叙事弧。
- 骨架：`assets/magazine-template.html` · 规范：`references/magazine.md`

### 3. PPT 风
横向翻页 deck —— 演讲 / 分享会 / 发布会。完整实现内置在 `references/guizang-ppt/`（源自开源 skill `op7418/guizang-ppt-skill`，MIT；来源与同步见其 `SOURCE.md`）。
- 入口：读 `references/guizang-ppt/guizang-ppt.md`，进去后按它自己的工作流走（澄清 → 选风格/主题 → 拷模板 → 填版面 → 自检 → 预览）。
- 自带两种风格：电子杂志风 + 瑞士国际主义风，各有锁死的版面库、主题色预设、组件手册和质量 checklist。
- 视觉规范以该目录自带的 `checklist.md` 为准，不套用第三步的「去 AI 感」表。

## 资源导览

```
delivery-artifact/
├── SKILL.md            ← 你正在读
├── assets/             ← 杂志风的视觉骨架（模板）
│   └── magazine-template.html
└── references/
    ├── native-html.md            ← Native：方法 + 文档类型（无模板，prototype-skill）
    ├── native-html-checklist.md  ← Native 质量地板（普适反 slop，不钉死美学）
    ├── native-examples/          ← Native 范型 6 份：单列 prose × 3、侧栏 prose × 2、印刷 data × 1；其中一份演示「Native 嵌 widget + 右栏 marginalia」（读，不抄；见 SOURCE.md）
    ├── craft/
    │   └── structure-and-style.md  ← Native 设计空间四轴：Viewport / Navigation / Content / Style
    ├── magazine.md               ← 杂志形态规范
    ├── guizang-ppt/              ← PPT 形态完整实现（模板 / 版面 / 主题 / 校验脚本）
    └── huashu-design/            ← Stage 形态例外：iOS 原型 / motion / infographic / kiosk（第一步路由到此）
```
