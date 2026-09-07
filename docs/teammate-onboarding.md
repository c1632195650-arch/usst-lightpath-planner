# 队友加入指南 · 光溯（上理生涯规划助手）

> 适用对象：刚加入本项目、从未碰过这个仓库的同学。
> 目标：照着做 **10 分钟** 就能在本机跑起来、认领模块、开始写代码。
> 更偏「agent / 协作纪律」的内容见仓库根目录 `AGENTS.md`，**那一份是给 AI 助手看的护栏，你也该扫一眼**。

---

## 0. 这个项目是什么

「光溯」是一个面向上理工大学学生的 **个性化学习规划 Web 应用**（第 18 届光电杯参赛作品）：

> 导入课表 → 测出你的学习画像 → 把一学期切成五个阶段 → 排出每周每天的日程（**含刻意留白**）→ 期末自动进入倒计时冲刺。

技术栈：**Vite + React + TypeScript + Tailwind**，纯前端、无后端，数据存浏览器本地（localStorage）。
**不碰教务账号密码、不做爬虫、不放后端**——这是架构级红线，见第 6 节。

---

## 1. 你要准备什么（装这 3 样 + 4 个插件）

| # | 软件 | 验证 | 说明 |
|---|---|---|---|
| 1 | **Node.js** | `node -v` | 20.x LTS 或你已有的 24.x 都行，本项目在 24.x 实测可构建 |
| 2 | **VS Code** | 打开即可 | 编辑器 |
| 3 | **Git** | `git -v` | Windows 自带 Git Bash |

VS Code 必装 4 个插件：**Error Lens**（错误直接标在行尾，对新手最有用）、**Tailwind CSS IntelliSense**、**ESLint**、**Prettier**。
装完在设置里打开 **Format On Save**，两人格式统一，少一堆无意义冲突。

---

## 2. 第一步：克隆仓库

```bash
# 把仓库拉到本地（URL 以实际远程地址为准）
git clone <仓库地址> usst-planner
cd usst-planner
```

> 没有仓库地址？问项目负责人（CY）要。仓库是 **私有** 的，你需要被加为 collaborator。

---

## 3. 第二步：装依赖、跑起来

```bash
npm install      # 项目已内置 .npmrc 走国内镜像，不用自己配代理
npm run dev      # 浏览器自动打开 http://127.0.0.1:5173
```

看到「光溯」两个大字就成功了。
**如果 `npm install` 报 ECONNRESET**：确认项目根目录有 `.npmrc`（内容应为 `registry=https://registry.npmmirror.com/`），这个文件别删。

常用命令：

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式，改代码自动刷新 |
| `npm run build` | 构建生产版本到 `dist/` |
| `npm run typecheck` | 只检查类型错误（**每天开工先跑一次**） |

---

## 4. 第三步：认领你的模块

两人**按文件所有权分工，绝不直接改对方的文件**。

| 你如果是… | 你负责 | 你开的分支 |
|---|---|---|
| **A（项目负责人 CY）** | `src/features/quiz/`、`src/components/ui/`、`src/features/plan/`(UI)、文档 | `feat/quiz` `feat/ui` `feat/ai` |
| **B（你，队友）** | `src/features/schedule/`、`src/lib/planner/` | `feat/import` `feat/planner` |

> 想改对方的文件？先发消息沟通，或提 PR 让对方 review。**别默默改。**

---

## 5. 第四步：每天怎么干活（标准动作）

```bash
git checkout dev
git pull origin dev            # ① 开工先拉最新
git checkout -b feat/xxx       # ② 开自己的功能分支
# ……写代码（可以让 AI 帮你写）……
npm run typecheck              # ③ 提交前必过，红字就修
git add .
git commit -m "feat(planner): 加入跨校区转场缓冲"
git push origin feat/xxx       # ④ 推到远程
# 在 GitHub 上提 PR，合进 dev
```

- **每天下班前 push**，哪怕没写完——防丢、也让对方看到进度。
- commit 信息格式：`feat(模块): 做了什么` / `fix(模块): 修了什么` / `docs(模块): 文档更新`。

---

## 6. 协作红线（防止 agent 乱来，也防止人乱来）

这些规则写进了 `AGENTS.md`，**任何 AI 助手进这个仓库第一眼就会读到**。人类也要遵守：

1. **`src/types.ts` 是契约层，锁死。** 字段改动必须两人确认；禁止用 `any` 绕过类型。
2. **禁止直接 push 到 `main` 或 `dev`。** 一律开 `feat/*` 分支，合进 `dev`，稳定后再合 `main`。
3. **禁止提交**：`.env.local`、任何密钥/Token、大文件（演示视频等）、`node_modules/`、`dist/`。这些已在 `.gitignore` 里，别手滑 `git add .` 加进来。
4. **大文件（演示视频、模型）不要进 git**，放 Vercel/Netlify 或单独提交，仓库只留代码。
5. **小步提交**，每个 commit 都能独立回滚。

> 为什么这么严？因为本项目大部分代码由 AI 生成，AI 很"热心"——它可能顺手把别人的文件也改了、或用 `any` 把类型系统打穿、或把密钥提交上来。**这些红线就是用来拦住这类行为的。**

---

## 7. 冲突了怎么办

- `git merge` / `git pull` 报 `conflict`：**别无脑 accept**。看清楚哪边是你、哪边是对方，手动合并。
- 同一文件冲突几乎只发生在 `types.ts` 或共享常量——所以「锁死」那条规则最关键。
- `main` 被弄脏：用 `git revert` 回滚单个 commit，**不要 `reset --hard`** 丢掉别人的工作。

---

## 8. 参赛关键时间点（务必记牢）

- **报名截止：2026-09-28 24:00**（建议中午前交，别拖到最后一刻）。
- 院邮箱会员 **9/29 到期**，演示视频附件大小限制需 **D15 前**去官方 QQ 群（221225591）问清。
- 提交类别务必选 **「创新设计」**（往届「创新理念」3 件全部三等奖、入围率 0%）。
- 完整排期见 `光电杯20天作战手册.html`（项目外，问 CY 要）。

---

## 9. 常见问题

**Q：我是 B，怎么拿到 `dev` 分支？**
A：克隆后 `git checkout -b dev origin/dev` 即可；平时从 `dev` 切出自己的 `feat/*`。

**Q：AI 帮我写代码，它改了 `types.ts` 怎么办？**
A：立刻 `git diff` 检查，不该改的用 `git checkout -- src/types.ts` 还原，并提醒对方。

**Q：`npm run typecheck` 一直红？**
A：把完整报错 + 完整文件 + 你已尝试的方法一起发给 AI，要求「只改局部，不重写文件」。

**Q：我电脑上 Node 是 24.x，能用吗？**
A：能。本项目已在 24.x 实测 `npm run build` 通过，无需降级到 20.x。

---

_本文档与 `AGENTS.md` 共同构成项目协作规范。规范有更新时，同步修改这两处。_
