# 光溯 · 上理生涯规划助手

> 不是帮你学更多，是让你的计划真的被执行。
>
> 第 18 届光电杯参赛作品 · 上海理工大学光电信息与计算机工程学院

> 🔔 **新加入 / 接手先看这里**
> - **当前进度快照（已实现能力 + 数据资产 + 遗留问题）→ [`docs/progress-status.md`](./docs/progress-status.md)**
> - **AI 助手（agent）协作护栏 → [`AGENTS.md`](./AGENTS.md)**（含「已实现、不要重复造轮子」清单）
> - 项目现为**双线**：主线「光溯」生涯规划（前端）+ 副线「梨宝」校园问答（FastAPI + RAG）。

一个面向上海理工大学的个性化学习规划助手：导入课表 → 测出你的学习画像 →
把一学期切成五个阶段 → 排出每周每天的日程（**含刻意留白**）→ 期末自动进入倒计时冲刺。

**核心差异化**（答辩要讲的三句话）
1. **反内卷排程** —— 所有时间管理产品都在帮你把日程塞满。考试周我们把留白率**上调**（22%→30%）。
2. **上理工原生** —— 五校区跨校区转场缓冲、三学期制含短学期。通用App不会为我校定制。
3. **数据不出设备** —— Local-First 架构，课表与画像全部存本地浏览器。

---

## 一、环境准备（开工前必做）

按顺序装，**每装完一个就验证一次**，不要一口气装完再调试。

| # | 软件 | 版本 | 验证命令 | 备注 |
|---|---|---|---|---|
| 1 | **Node.js** | **20.x LTS**（推荐） | `node -v` | 下载 nodejs.org 选 LTS 即可。**已装 24.x 也能直接用**（本项目已在 24.x 实测 `npm run build` 通过），无需降级 |
| 2 | **VS Code** | 最新 | 打开即可 | 必装插件见下 |
| 3 | **Git** | 最新 | `git -v` | Windows 自带 Git Bash |

### VS Code 必装插件（4 个，不多不少）
- **Error Lens** ← 对新手最有用，错误直接显示在代码行尾
- **Tailwind CSS IntelliSense** ← 写 class 时自动补全
- **ESLint**
- **Prettier**

> 装完插件后，VS Code 设置里打开 `Format On Save`，两人格式统一，减少无意义 diff。

---

## 二、跑起来（三步）

```bash
# 1. 进入项目目录
cd usst-planner

# 2. 安装依赖（项目已内置 .npmrc 走国内镜像，不用自己配）
npm install

# 3. 启动
npm run dev
```

浏览器会自动打开 `http://127.0.0.1:5173`。看到「光溯」两个字就成功了。

> **如果 `npm install` 报错 ECONNRESET**：代理没生效。确认项目根目录有 `.npmrc`
> （内容应为 `registry=https://registry.npmmirror.com/`）。这个文件已配置好，不要删。

### 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式，改代码自动刷新 |
| `npm run build` | 构建生产版本到 `dist/` |
| `npm run preview` | 预览构建结果 |
| `npm run typecheck` | 只检查类型错误，不构建 |

**每天开工先跑一次 `npm run typecheck`**，红字就修，别攒着。

---

## 三、两人并行铁律 ⚠️

这套规则的目的是：**让两个人可以完全不沟通地各写各的，最后还能拼起来。**

### 规则 1 · 契约先行（最重要）
`src/types.ts` 是全项目的宪法。**D2 之后锁死**，任何字段改动必须两人口头确认。
需要新字段？先加到 types.ts，再各自写代码。**绝不用 `any` 绕过**——那是崩盘的开始。

### 规则 2 · 文件级所有权
下表标了每个目录归谁。**绝不直接改对方的文件**，要改就发消息或提 PR。

### 规则 3 · 用 mock 并行
各自维护自己的假数据，最后才对接。不要等对方写完才开始。

### 规则 4 · 每天 21:00 拉一次 dev
冲突趁早发现。同一文件冲突时先沟通，不要无脑 accept。

### 规则 5 · 调试用 *AI提示词模板 T2*
报错时把「完整错误 + 完整文件 + 已尝试方法」一起给 AI，并要求**只改局部不重写文件**。

---

## 四、目录结构与负责人

```
usst-planner/
├── src/
│   ├── types.ts                 🔒 契约层 —— 两人共用，D2 后锁死
│   ├── constants/               🔒 共享事实层（人 A 维护）
│   │   ├── campus.ts            五校区 + 教学楼→校区推断 + 转场时长
│   │   ├── time.ts              节次时间表 + 时间工具
│   │   ├── goals.ts             大学目标 → 课程权重表
│   │   └── phases.ts            学期五阶段（含短学期）
│   ├── lib/
│   │   ├── storage.ts           【A 已建】localStorage + useAppState
│   │   ├── date.ts              【A 已建】日期工具（ISO 字符串）
│   │   └── planner/             【B】算法层（待建）
│   │       ├── phases.ts        学期/阶段计算
│   │       ├── priority.ts      课程优先级
│   │       └── scheduler.ts     日排程 ⭐核心
│   ├── components/ui/           【A 已建】Button / Card / Slider / EmptyState
│   ├── features/
│   │   ├── quiz/                【A】问卷与画像
│   │   ├── schedule/            【B】课表导入
│   │   └── plan/                【A 的 UI × B 的算法】
│   ├── App.tsx                  🔒 外壳（人 A 维护，改动要打招呼）
│   └── mocks/                   各自假数据
├── public/manifest.webmanifest  PWA 配置（图标待补）
└── docs/
    ├── PRD.md                   产品文档（总纲）← 开发/修复前必读
    ├── roadmap.md               路线图（功能分类×顺序×HTML→App×PDF）
    ├── features.md              功能契约 ← 每人对着自己的条目看
    ├── decisions.md             技术决策记录 ← 答辩前必读
    ├── prompts.md               提示词库 ← 必读
    ├── teammate-onboarding.md   队友加入指南
    └── README.md                本文件
```

> `App.tsx` 刻意**没有引入 react-router**，用 tab state 切换。少一个依赖少一类坑。

---

## 五、Git 分支规范

```
main            保护分支，只接受 dev 合并，且必须是能跑的版本
dev             日常集成
feat/quiz       【A】问卷
feat/import     【B】课表导入
feat/planner    【B】排程引擎
feat/ui         【A】可视化
feat/ai         【A】AI 接入
docs/*          文档与材料
```

**提交信息格式**
```
feat(planner): 加入跨校区转场缓冲
fix(import): 修复 CSV 含逗号时字段错位
docs(features): 更新 M4 验收标准
chore(deps): 升级 tailwind
```

**每天下班前必须 push**，哪怕功能没写完。一是防丢，二是让对方看到你的进度。

---

## 六、绝对不能做的三件事 🚨

1. **不能碰教务账号密码。** 不写登录、不写爬虫、不放后端。
   课表一律由用户在自己浏览器里粘贴/上传，本地解析。

2. **不能把 API Key 提交到仓库。**
   Key 只放 `.env.local`（已在 .gitignore 里）。也不要贴进聊天框、Issue、截图。

3. **不能替用户做道德判断。** 留白滑块调多高都是对的。
   产品里不许出现"拖延""效率低""落后了"这类词。

---

## 七、干活顺序（照抄即可）

```
D1–D2  两人一起：跑通环境 → 读懂 types.ts → 各自跑 npm run dev
D3–D6  A 做问卷 / B 做课表   ← 完全并行，零耦合
D7–D10 B 写算法 / A 先用 mock 写 UI
        ⚠️ M4 排程引擎：先写测试，再写实现
D11–D13 对接 + 真机测试 + 部署
D14–D16 加分项，D16 18:00 硬冻结
D17–D20 视频 / 申报书 / PPT / 彩排
```

详细排期见《光电杯20天作战手册.html》。

---

## 八、部署（D11 做）

```bash
npm run build    # 产出 dist/
```

然后把 `dist` 拖到 [Vercel](https://vercel.com) 或 Netlify，几分钟拿到公网链接。
纯静态托管，免费额度足够，不需要服务器、不需要备案。

> 拿到链接后立刻写进申报书，并在手机上打开测一遍。

---

## 九、待办清单

- [ ] 补 PWA 图标 `public/icon-192.png` 和 `icon-512.png`（D15 前）
- [ ] `constants/time.ts` 的节次时间需用真实课表核对（D3 前）
- [ ] 拿到 2026–2027 学年校历，确认开学日与短学期周次（D3 前）
- [ ] 部署后把链接填进申报书（D13）
