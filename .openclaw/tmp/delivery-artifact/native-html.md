# Native HTML

静态 editorial 排版文档 —— 写得像**被排过版的纸**,不是 dashboard、不是网页、不是 app。

## 没有模板。这是 prototype-skill,不是套皮。

Native 兜底覆盖 one-pager / 长文 / 信函 / portfolio / 简历 / 研报 / changelog —— 这些产物视觉上毫无共性,**不存在一套「Native 的样子」**。把每份产物套同一种配色字体,就是「太模板化」的根。

你的任务:**为手上这一份产物现场认定一个视觉方向,再精确执行**。研报该冷峻,信函该朴素,长文该有书卷气 —— 它们就该长得不一样。凭空套一种长相 = generic,一定能被一眼认出是「AI 出的」。

`references/native-examples/` 是**范型(archetype),不是模板**:读它们学「一份排过版的好东西」的品质标准和版式节奏,然后**从零执行**。不要 copy 任何一份去填空。6 份范型沿 Viewport × Navigation × Content × Style 四轴 + 可选附加能力(嵌 widget / marginalia)铺(详见 `craft/structure-and-style.md` + `native-examples/SOURCE.md`),证明 Native 既不是"只有一种长相",也不是"只有一种结构"。

## 第一步 · 认定方向(动手写 HTML 之前)

先答四问,再认定方向 —— 答案错了,后面写多少 CSS 都是歪的;方向错了,晚改比早改贵 100 倍。

1. **用途与受众** —— 解决什么问题、给谁看、在多近的距离读(打印件 / 屏幕 / 投屏)?
2. **调性** —— 安静 / 权威 / 冷峻 / 温润 / 朴素,挑一个。
3. **约束** —— 必含什么、不能出现什么?
4. **差异化** —— 读者会记住的那**一个**点是什么?

据此认定**一个** editorial 方向并贯彻到底。方向无强弱之分 —— 提炼克制和冷峻技术都成立,关键是 intentionality:认定后精确执行。常见方向(挑一个,或据产物另立一个):

| 方向 | 视觉签名 | 范型 |
|---|---|---|
| 暖人文编辑 | 暖纸 + 衬线 + 哑光 accent | `doc-kami-parchment.html` |
| 冷峻技术 | 深色 / 冷白 + 无衬线 + mono 元数据 | `eng-runbook.html` |
| 瑞士国际主义 | 网格 + 无衬线 + 极致字号对比 + 大留白 | —— |
| 单色印刷 | 近黑白灰 + 一个克制 accent + hairline | —— |

**需求模糊时**(「做份好看的报告」式、没有参考):不要凭通用直觉硬做,更不要默认暖衬线。从上表挑 **2-3 个分属不同家族的方向**给用户选 —— 别给两个都偏暖、或两个都偏极简的,差异不明显等于没给。每个方向用一句话点出气质;有范型的,指给用户先看一眼范型再选。这一步轻量做、不生成草稿。**「认定方向」是和用户对齐的检查点 —— 方向定了再进第二步。**

## 第二步 · 判断文档类型,套结构骨架

按用户内容挑最接近的一种。骨架照搭,视觉识别由第一步认定的方向决定。

- **One-Pager** —— logotype + 标题 + lede + 要点组 + 底脚 metadata。一屏讲完一件事。
- **Long Doc** —— 封面(大标题/副标/作者/日期)→ 目录(kicker + 页码)→ 章节(folio 顶角 + section rule + body)→ 脚注 + 文末 colophon。
- **Letter** —— 抬头地址 + 日期 + 收件人 + 左对齐正文(段间空 1.5em)+ 署名 + 签名占位线。
- **Portfolio** —— 项目 hero + 一张大图占位 + 描述 + 角色/时间/stack 元数据 row。
- **Resume** —— 姓名大字 + 一行 tagline + contact row + experience / skills / education。
- **Equity / Data Report** —— 公司名 + ticker + 期间 + key metrics row + 分析正文 + 单色 SVG 走势图。示例数据须标注为样例。
- **Changelog** —— 版本号大字 + 日期 + Added / Changed / Fixed 分组 + 单 rule 分隔。

(演讲 / 幻灯片交付走 PPT 风形态,不在此。)

## 第二步半 · 画布与读宽度选择

选画布 → 见 `craft/structure-and-style.md`(决策树 + CSS 约定 + 来源标注)。三档速查:

- **散文主导**(Letter / Long Doc 叙述为主 / Portfolio):走 `prose` 画布,主容器 ≈ 720px / 65ch
- **数据主导**(Equity / Data Report / Changelog / Resume):走 `canvas` 画布,主容器 ≈ 1180px
- **混合**(投研 / White paper / 混合型 One-Pager):走 `canvas` + 段落锁 measure + 表格 `.bleed` 突破

## 第三步 · 执行 —— 四个维度的普适工艺

方向定了,这四条是**任何方向都要做对**的工艺,与美学无关:

**排版** —— 字号用 1.2 或 1.25 的倍数级,一屏 ≤ 6–8 档。字体最多 2 套,各带系统 fallback;**绝不让标题裸用 `system-ui`**。字重三档够用:正文 400 / 强调 510–550 / 标题 590–600,慎用 700+。字距是成败的手术刀:**ALL CAPS 必加 0.06–0.1em**,Display(≥48px)收 −0.02~−0.03em,小字(11–13px)+0.01~0.02em,正文 0。行高:标题(≥32px)1.0–1.2、正文 1.5–1.6、小字 1.5。正文每行 50–75 字,不用 `justify`(会出河流)。**具体怎么锁宽 / 什么时候不锁** → 见 `craft/structure-and-style.md`。

**配色** —— 四层结构:中性色占 70–90%、**一个** accent 占 5–10%、语义色 0–5%、效果色 <1%。**accent 一屏最多 2 处可见**(链接、hover 都算 accent)。不用纯白 `#fff` / 纯黑 `#000`:浅色方向底 `#fafafa`、字 `#111`;深色方向底 `#0f0f0f`、字 `#f0f0f0`,且深色上的边框用半透明白 `rgba(255,255,255,.08)` 而非深色描边。正文对比度 ≥ 4.5:1、大字(>18px)≥ 3:1。token 按用途命名,不按色相。

**构图** —— 层级靠字号 + 字重 + 字体对比 + **留白**做出来,不靠颜色。留白是结构,不是没填满的剩余空间。对称里留一点张力(一段紧、一段松),不要均匀平铺。Composed pages, not dashboards —— 不堆 KPI 卡、不堆图标。

**质感** —— 分隔用 1px hairline;**不用 drop-shadow**(阴影顶多是 `0 0 0 1px` 描边)。占位图用色块 + 1px 描边,**不外链图片 CDN**。中英混排加盘古之白。一个细节做到 120%、其余做到 80% —— 品味是在该精致的地方足够精致,不是均匀用力。

> Native 是静态文档,**没有「动效」维度** —— 不要 scroll-triggering / hover 态 / 自定义光标。那些是网页和 app 的东西。

## 第四步 · 反 AI slop + 自检

AI slop = 训练语料里的视觉最大公约数,不携带任何信息 —— 读者一眼认出「这是 AI 出的」。这与方向无关,任何方向都不许踩。最常见的几条:默认靛蓝做 accent(`#6366f1` 一族)、hero 双色「信任」渐变、emoji 当图标(改用 1.6–1.8px 单线 SVG)、该衬线的标题裸用 Inter / system-ui、圆角卡片 + 左侧彩色 border(「AI 仪表盘块」)、编造数据(「快 10 倍」)、填充文案(lorem ipsum)。

生成后**逐条过 `references/native-html-checklist.md`**,P0 全过才算完成。

**怎么加灵魂而不破规则**:≈80% 成熟做法 + ≈20% 一个独特选择(一个大胆的排版决定、一处只有真正用过这份产物的人才会加的细节)。一句话检验 —— **把成品截图给项目外的人看,他认得出这是哪一份具体产物 → 有灵魂;认不出 → 你交的是模板。**

## 嵌入式交互组件(可选)

某些段落讲的概念,读公式不感、玩一下才信。这种段落里可以嵌一个 widget。

**判断**:拿掉 widget,文章仍是完整论证 → widget 服务段落,合;拿掉就讲不通 → 做的是工具,走应用,不走本 skill。

何时嵌:概念抽象到只读难内化;读者会想"换我会怎样";静态图说不清多状态关系。
何时不嵌:文档目的是结论 / 报告;静态表已说清;真要做的是 Stage 形态(走 `references/huashu-design/`)。

设计三条:

- 原生控件 + 1px hairline,不重写 `<input>` / `<button>`
- 一 widget 一主任务
- 结果可 export(Copy as JSON / snapshot / memo)

调性继承所在文章 —— Swiss editorial 配 Swiss editorial,research explainer 配 softer 学术。

范型:`references/native-examples/research-concept-explainer.html`(consistent hashing 一文 + 段间嵌 ring widget + 右栏 glossary marginalia)。

---

## 范型

`references/native-examples/` 6 份是**六个已执行方向的成品样例**(单列 prose × 3、侧栏 prose × 2、印刷 data × 1;其中 `research-concept-explainer` 同时演示嵌 widget):读它们 → 学品质标准 / 结构选择 / Style 范围 → 为你的产物从零执行,**不要 copy**。来源、各份的格子坐标、「不要照抄」注意,见该目录 `SOURCE.md`。

工程约束(单文件自包含、不用 sandbox-hostile API、双击即开)见 `SKILL.md` 第三步,此处不重复。
