# RUNBOOK — 克隆后如何跑起来

> 目标是：`git clone` 后照本文执行即可运行，无需额外摸索。
> 分三层：**① 前端网站（必跑）② 梨宝问答后端（可选）③ 课表 PDF 解析服务（可选，导入课表才需要）**。

---

## 0. 前置要求
| 软件 | 版本 | 说明 |
|---|---|---|
| Node.js | 20.x LTS 或更高（已在 22/24.x 实测通过） | 前端 |
| npm | 随 Node | — |
| Python | 3.12/3.13 | 仅梨宝后端与 PDF 解析需要 |
| Git | — | — |

---

## ① 前端网站（光溯 · 主流程）— 必跑
纯 Vite + React，**无需任何 Key / 环境变量**即可完整跑通画像、月历、周程、键盘切周。

```bash
# 1. 进目录
cd usst-lightpath-planner

# 2. 装依赖（仓库自带 .npmrc 走国内镜像，不用手动配 registry）
npm install

# 3. 启动
npm run dev
```
浏览器打开 **`http://localhost:5173/`**。

> ⚠️ 本项目 Vite **只绑定 IPv6 的 localhost**。访问请用 `localhost:5173`，**不要**用 `127.0.0.1:5173`（后者连不上）。

常用命令：
```bash
npm run dev          # 开发，改代码热更新
npm run typecheck    # 类型检查（提交前必过）
npm run build        # 构建到 dist/
npm run preview      # 预览构建产物（此时「课表」tab 不显示，见下方说明）
```

> 关于「课表」导入 tab：它只在 `npm run dev`（开发模式）显示。`npm run build/preview` 的生产构建会按设计隐藏该入口。**要看课表导入请用 dev。**

---

## ② 梨宝问答后端（FastAPI，可选）
主流程不需要；只有要用梨宝的「查校园资讯/问答」功能时才需要。

```bash
# 建虚拟环境并装依赖（以 venv 为例）
cd usst-lightpath-planner
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt        # 本仓库提供，见下方"依赖清单"

# 可选：填大模型 Key（不填也能跑，走抽取式降级）
# cp server/.env.example server/.env   # 若有该模板则照做；否则直接设环境变量
export LLM_API_KEY=...                 # Windows: set LLM_API_KEY=...

# 启动（默认 8000 端口）
python server/app.py
```
浏览器/前端会自动连 `http://127.0.0.1:8000`。

**所需第三方库**（前端 `package.json` 之外的后端依赖）：
```
fastapi
uvicorn
requests
jieba
fastembed        # 纯 CPU 推理也够用（bge-small-zh-v1.5）
```
若需要向量检索完整能力，先跑一次建索引：`python scripts/rag.py build`（数据 `data/usst_articles.db` 已入库，一般不用重跑）。

> 冒烟自检：`curl http://127.0.0.1:8000/api/health` 应返回 `{"ok": true, ...}`。

---

## ③ 课表 PDF 解析服务（可选，导入课表时才需要）
「课表」tab 里上传 PDF / 拉取课表，需要一个本地解析服务，**由前端经 Vite 代理 `/timetable` 转发到 127.0.0.1:8765**。

```bash
# 该服务在独立工程目录（不在本 git 仓库内，需单独 clone/放置）
cd <timetable_project>   # 即含 server.py + timetable_parser/ 的目录
# 用装了 pdfplumber 的 python 启动：
python server.py 8765
```
前端代理已配好（`vite.config.ts`：`/timetable → http://127.0.0.1:8765`，dev 与 preview 都有），**无跨域问题**。

> 说明：`server.py` 依赖 **pdfplumber**。若提示找不到，`pip install pdfplumber`。
> 健康自检：`curl http://127.0.0.1:8765/courses` 应返回 JSON（无课表时是 `[]`）。
> 若该服务未启动，前端「课表」tab 会显示「未连通」——启动后刷新即可。

---

## 常见问题速查
| 现象 | 原因 / 处理 |
|---|---|
| `npm install` 报 ECONNRESET | 镜像没生效；确认根目录 `.npmrc` 存在（内容为 `registry=https://registry.npmmirror.com/`） |
| dev 打开 `127.0.0.1:5173` 连不上 | 本项目 Vite 只绑 IPv6，改用 `localhost:5173` |
| 看不到「课表」tab | 你用了 build/preview；该入口只在 dev 显示 |
| 课表 tab 显示「未连通」| 8765 PDF 解析服务没启动，见 §③ |
| 梨宝问答报后端未连接 | 8000 的 FastAPI 没启动，见 §② |
| typecheck 报错 | 提交前先修；这是本仓库门禁 |
