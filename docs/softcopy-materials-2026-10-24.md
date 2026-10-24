# 软著 V1.0 材料 · 生成与验证登记（2026-10-24）

> 生成：2026-10-24（zcode /goal 批）。承 `docs/usst-line-plan-2026-10-24.md` §B2 A-2「软著 V1.0 提交」。
> **登记名称**：光溯上理校园生活助手 V1.0（产品发版口径 0.4.10 与登记口径 V1.0 并存，不冲突）。
> **材料状态**：两份 PDF 已生成并通过独立验证，**待 CY 复核封面占位与名义后提交**（中国版权保护中心官网自办，免费、60 日审结）。

## 1. 产物清单（均在 `_softcopy/`，下划线目录不进 git）

| 文件 | 规格 | 验证 |
|---|---|---|
| `光溯上理校园生活助手V1.0-源程序材料.pdf` | 61 页（前 30 程序页 + 1 说明页 + 后 30 程序页），每页 50 行，页眉软件名+版本号，末页为程序结束（`uvicorn.run` 启动块），631 KB | pdfplumber 逐页强验证：61 页全部非空源码行按序命中（§3） |
| `光溯上理校园生活助手V1.0-用户手册.pdf` | 10 页六章 + 封面目录，嵌 8 张真实产品截图，820 KB | 文本层章节齐全 + 8 图嵌入 + 像素级溢出检测全 clean + 末页完整收尾 |
| `user-manual.html` / `_source_material.html` | 两份 PDF 的渲染源（留档可复看） | — |

## 2. 源程序材料取材范围（显式契约）

- **取材**：`src/lib/planner/` 全部 35 个非测试 `.ts` 文件 + `server/app.py`，共 36 文件、12,992 源码行；拼装后（含 36 行文件标注 + 35 行文件间空行）总 13,028 行。
- **提交形态**：前 30 页 = 第 1–1500 行（恰好覆盖引擎主线 model→construct→solver→objective）；后 30 页 = 第 11,529–13,028 行（以 `server/app.py` 全文收尾，末页为程序结束）；中间 10,028 行按版权材料惯例省略，说明页注明省略区间。
- **取材顺序锁定在 `scripts/build_softcopy_pdf.mjs` 的 `ORDER` 常量**：planner 目录新增/删除源文件而 ORDER 未同步时脚本直接报错（防取材漂移）；本次生成时校验通过。

## 3. 生成与验证方式（可复现）

```bash
node scripts/build_softcopy_pdf.mjs            # 两条产线都生成（source / manual 可单跑）
# 渲染通道：Playwright + 系统 Edge（channel:'msedge'），零新增依赖、零浏览器下载
.venv/Scripts/python.exe _softcopy/_verify_pdf2.py        # 源程序材料强验证（HTML↔PDF 逐页逐行）
.venv/Scripts/python.exe _softcopy/_verify_manual_geom.py # 手册图片几何验证
.venv/Scripts/python.exe _softcopy/_verify_overflow.py    # 手册像素级溢出检测
```

验证口径（不采信生成器自述，全部独立复核）：

- 源程序材料：从渲染源 HTML 提取每页预期内容，与 PDF 抽取文本做**去空白归一化 + 逐行有序包含**比对——61 页全部通过；emoji 行经双侧 emoji 归一后全部命中（`⚠️` 等符号在 PDF 中由 Segoe UI Emoji 真实渲染，pdfplumber 抽取层字符差异不算内容丢失）。
- 已修两处缺陷（首版生成发现）：① 说明页未强制分页导致后段首页跨两个物理页——已包 `.page` 修复；② emoji 无打印字形——CSS 字体链加 `Segoe UI Emoji` 解决，**源文件零改动**。
- 已知误报备忘：pdfplumber 对 Chromium 嵌入图像的 bbox 报告不可信（报 720pt 溢出），以像素级检测为准（右边缘条带 0 非白像素）。

## 4. 用户手册内容来源

封面/概述改编自 `project-core.md`；安装运行改编自 `README.md`/`teammate-onboarding.md`；移动端章节改编自 `mobile-line-alignment-2026-10-03.md`；截图复用 `_g-shots/`（网页端 3 张）与 `_accept-shots/`（移动端 5 张）。只写已实现功能，未实现项（iOS/推送/整周重排上手机）如实写"不提供"。

## 5. 提交前待 CY 处理（阻塞项）

1. **封面占位**：用户手册封面「著作权人：〔提交时填写〕」与「开发完成日期：2026 年 10 月」需 CY 填实名与具体日期（登记表口径）。
2. **D1 名义裁决（卡框架线 M5）**：先按**个人名义**准备；同时**务必问到教务处/创新创业学院书面口径**——综测/保研加分是否要求学校为第一著作权人。若为是 → 改学校名义重填封面并评估对框架线开源时机的影响（`framework-line-plan-2026-10-24.md` §A6.4）。
3. 复核建议：翻一遍源程序材料前 3 页与后 3 页观感（等宽 8.5pt、每页 50 行），确认无异议后在版权保护中心官网提交两份 PDF + 登记表。
4. 受理后：受理通知书截图存 `docs/` + BLOCKERS 销项（usst-line-plan A-2 DoD）。

## 6. 版本与快照说明

- 生成基线：beta-v2 @ `0be6e9c`（本批 preflight 实测 HEAD），planner 35 文件清单以脚本 ORDER 为准。
- 本批 git 不可用（PATH 无 git.exe，与 2026-10-22/10-24 批同款环境限制），新增文件待有 git 的终端补一笔提交（见 BLOCKERS）。
