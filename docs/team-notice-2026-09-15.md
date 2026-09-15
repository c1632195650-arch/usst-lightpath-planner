# 队友通报 · 项目定位改版（2026-09-15）

> **事由**：`docs/project-core.md` v3 已合入 `dev`（PR #6 → merge commit `1ddf03a`）。
> **本文件用途**：把「定位改版」同步给队友。§二 / §三 是**可直接复制**的正文，互不重复。
> **事实来源**：`git ls-remote` + `gh api` 实测（2026-09-15 18:45），非文档转述。

---

## 一、口径变了什么（共同背景）

三件事，全部是**定义层面的变更**，不是待办：

| # | 变更 | 具体 |
|---|---|---|
| 1 | **「留白率 / 反内卷」撤出核心** | 不是"暂时不做"，是定位层面的否决。现在它只是排程目标函数里**若干软权重中的一项**（`blankDeficit`）——可调、可关、**不进验收标准**、**不进对外材料的主叙事** |
| 2 | **记忆点定为「懂分寸」** | 一个给你地图、陪你走、给你方向，但**绝不替你拍板**的 AI 伙伴（智能边界 L1 信息 / L2 引导 / L3 建议 / L4 决策不做） |
| 3 | **架构红线更新** | 旧「纯前端 / 无后端」作废（后端 + RAG 已是既成事实）。不变的三条：不碰教务账号密码 · 个人数据本地优先 · LLM 输入脱敏 |

**新的定位唯一权威 = `docs/project-core.md`。**

以下文档的**定位与记忆点章节作废**（已挂归档声明，内容保留仅供查史）：
`PRD.md`、`roadmap.md`、`product-vision.md`、`project-intro.md`。

**所有人的第一步**：

```bash
git checkout dev && git pull origin dev
```

---

## 二、给 Ray（B）· 可直接复制

> Ray，
>
> 项目定位改版了，`dev` 上新增 **`docs/project-core.md`（v3）**，是现在唯一的定位权威。先拉一下：
>
> ```bash
> git checkout dev && git pull origin dev
> ```
>
> 核心变化两条：
> **① 「反内卷 / 留白率」从核心卖点降为排程引擎的一个可调软参数**（`blankDeficit`）——可调、可关、不进验收标准、不进对外材料主叙事。
> **② 记忆点定为「懂分寸」**：给你地图、陪你走、给你方向，但绝不替你拍板（智能边界 L1 信息 / L2 引导 / L3 建议 / L4 决策绝不做）。
> 旧的 PRD / roadmap / product-vision / project-intro 定位章节已作废。
>
> ---
>
> **1. 你的排程规格书不用改。**
>
> 我核了 `docs/scheduler-v2-spec.md`：留白本来就是**并列软目标之一**（§29 加权目标函数、§55「软目标达成率（自习、留白）不低于现有引擎」、§225 字段 `blankDeficit`、§748 验收项 QL-1），跟新口径**天然一致**，没有需要返工的地方。
> 唯一一条要求：**别把它重新升格成"项目记忆点"**——当并列项，不当卖点。
>
> **2. 你的两个分支现在都落后 `dev`**（我这次文档合并把 dev 往前推了 3 个）：
>
> ```
> feat/planner-v2-p0   ahead 6  / behind 3    PR #2   CLEAN，可直接合
> feat/planner-v2-p1   ahead 15 / behind 3    ⚠️ 没有 PR
> ```
>
> P1 那批（`improve.ts` + `tests/` 全套 + golden 基线 + `places-buildings.test.ts`）已经推到远程了，**但还没开 PR**，记得补一个。合之前先 `git merge dev`，否则越拉越远。
>
> 顺带说一句：你 18:18 那个 `campusOfName('第三教学楼')` 断言改 null 的修复已经落在 #2 和 p1 上了，**"#2 合进 dev 会红一条"这个担心已经解除**。
>
> **3. 合入顺序不变**，仍是栈式：**#2 → #3 → #4 → #5**（#7 也栈在 #3 上）。
>
> **4. 想请你确认一件事**：新口径把留白降级后，你 P1 的目标函数 / 验收设计（golden 基线里的软目标权重）**是否需要跟着调权重**？我的理解是**不用动结构，只改权重数值**即可，但这条你说了算——如果 golden 快照会因此变化，早点说，避免我这边基于旧快照做对比。
>
> 口径上如果你有不同意见，也直接说，现在改成本最低。

---

## 三、给舅舅（isunbeam）· 可直接复制

> 舅舅，
>
> 项目定位改版了，同步一下，另外有件事想正式跟你对齐。
>
> **1. 定位变化（两条）**
> `dev` 上新增 `docs/project-core.md`（v3），是唯一权威。核心：
> ①「反内卷 / 留白率」**从核心卖点降为**排程引擎的一个可调软参数，不再进对外材料主叙事；
> ② 记忆点定为**「懂分寸」**——给你地图、给方向，但不替你拍板。
>
> **2. 你 9-11 那个 `feat/ui-refresh` 我核过了：`ahead 0 / behind 22`。**
> 也就是说**它的内容已经全部在 `dev` 里了**，不需要再做任何动作，包括解冲突和重推。
> 当时的 UI 刷新是有效的、已经进来了，感谢 🙏
>
> **3. 如果还想继续帮忙改前端**：先 `git checkout dev && git pull origin dev`，然后**开一个新分支**（`feat/xxx`）往上做，别在 `ui-refresh` 上续——那条已经落后 22 个提交了。
>
> **4. 一个边界，是对齐不是批评**：`ui-refresh` 当时动过 `server/` 和 `scripts/rag.py`。这两块现在的归属是 **CY（后端 + 数据工程）**，B（Ray）负责 `src/features/week/` 和 `src/lib/planner/`。以后要动这两处，先在群里说一声，免得两边同时改同一个文件。完整分工表见 `AGENTS.md` §二。
>
> **5. 前端文案上一条软要求**（不用现在改）：
> 页面里还有几处"留白 / 内卷"字样，比如 `src/data/usst.ts` 的「平衡模式」「摸鱼模式」描述、`WeekPlanView` 的"留白 X%"。**这些作为功能标签是没问题的，不用删。**
> 要守的只有一条：**别让它们在首页第一屏 / 海报 / PPT 里被当成核心卖点**——核心卖点现在是「懂分寸」。

---

## 四、群发版（一屏，可贴群公告）

> 【项目定位改版通知】
> 新权威文档 `docs/project-core.md` 已合入 `dev`（PR #6）。两个变化：
> ① **「反内卷 / 留白率」撤出核心**，降为排程引擎的一个可调软参数——不再是对外材料的卖点，也不再进验收标准；
> ② **记忆点定为「懂分寸」**：给你地图、给你方向，但绝不替你拍板。
> 旧的 PRD / roadmap / product-vision / project-intro 的定位章节作废（已归档）。
> 各位先 `git checkout dev && git pull origin dev`。
> 排程侧规格书**不需要返工**（留白本来就是并列软目标之一），只需要别再把它升格成记忆点。

---

## 五、事实底账（可复现）

```bash
# 远程实况
git ls-remote --heads origin
#   dev  = 1ddf03a   ← PR #6 已合
#   main = cb3f39e   ← 未更新（默认分支）

# 各分支相对 dev 的差集
gh api repos/c1632195650-arch/usst-lightpath-planner/compare/dev...feat/planner-v2-p0
```

| 分支 | ahead | behind | PR | 作者 |
|---|---|---|---|---|
| `feat/planner-v2-p0` | 6 | 3 | #2 OPEN / CLEAN | Ray-cialor |
| `feat/planner-v2-p1` | 15 | 3 | **无 PR** | Ray-cialor |
| `feat/events-and-diversity` | 5 | 3 | #3 OPEN / CLEAN | c1632195650-arch |
| `feat/libao-wiring` | 4 | 3 | **#4 OPEN / CONFLICTING** | c1632195650-arch |
| `feat/weather` | 5 | 3 | #5 OPEN / UNKNOWN | c1632195650-arch |
| `feat/contract-t1` | 5 | 3 | #7 OPEN / CLEAN | 光溯开发组 |
| `feat/ui-refresh` | 0 | 22 | 无 | isunbeam（**内容已全在 dev**） |
| `feat/demo` | 1 | 43 | 无 | 光溯开发组（**已死**） |
| `feat/import` | 0 | 30 | #1 MERGED | — |

> 上表 behind 数字会随 `dev` 前进而变化，**以 `git ls-remote` / `gh api` 实测为准**，不必纠结具体值。

**`dev` 本次新增的 3 个提交**：

```
f725dcc  docs(core): 定位唯一权威 + 记忆点定为「懂分寸」，留白率移出核心
6538b2a  docs(core): 更正「远程落后 38 提交」误判 + 数据数字二次校准
1ddf03a  Merge pull request #6 from c1632195650-arch/docs/project-core
```
