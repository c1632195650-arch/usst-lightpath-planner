#!/usr/bin/env node
// 软著登记材料生成器（2026-10-24 立，承 docs/usst-line-plan-2026-10-24.md §B2 A-2）
//
// 产出两份 PDF（输出到 _softcopy/，下划线目录 = 生成产物不进 git）：
//   ① 光溯上理校园生活助手V1.0-源程序材料.pdf —— 前连续 30 页 + 后连续 30 页，
//      每页 50 行（末页可不足），页眉带软件全称 + 版本号，末页为程序结束（server/app.py 的
//      uvicorn.run 启动块）。取材 = src/lib/planner 全部非测试 .ts + server/app.py（下方
//      ORDER 为显式契约：planner 新增/删除源文件而 ORDER 未同步时脚本直接报错，防取材漂移）。
//   ② 光溯上理校园生活助手V1.0-用户手册.pdf —— 由 _softcopy/user-manual.html 渲染。
//
// 渲染通道：Playwright + 系统 Edge（channel: 'msedge'）——零新增依赖（playwright 已在
// devDependencies，浏览器用系统自带 Edge，不下载 chromium 二进制）。
//
// 用法：
//   node scripts/build_softcopy_pdf.mjs source   # 只生成源程序材料
//   node scripts/build_softcopy_pdf.mjs manual   # 只生成用户手册
//   node scripts/build_softcopy_pdf.mjs          # 两条都生成

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '_softcopy');
const SOFTWARE_NAME = '光溯上理校园生活助手 V1.0';
const LINES_PER_PAGE = 50;
const FRONT_PAGES = 30;
const BACK_PAGES = 30;

// 取材顺序（软著材料的阅读序）：引擎主线（模型→构造→求解→目标→改进→滚动/涟漪）在前，
// 周边知识/策略居中，入口与后端殿后——前 30 页恰好覆盖引擎核心算法，后 30 页以 server/app.py
// 的启动块结束。清单与 src/lib/planner 实际非测试 .ts 文件集做双向校验。
const ORDER = [
  'src/lib/planner/model.ts',
  'src/lib/planner/planWeek.ts',
  'src/lib/planner/buildPhases.ts',
  'src/lib/planner/construct.ts',
  'src/lib/planner/solver.ts',
  'src/lib/planner/objective.ts',
  'src/lib/planner/improve.ts',
  'src/lib/planner/incremental.ts',
  'src/lib/planner/ripple.ts',
  'src/lib/planner/roll.ts',
  'src/lib/planner/localizedReplan.ts',
  'src/lib/planner/longLocks.ts',
  'src/lib/planner/templates.ts',
  'src/lib/planner/methods.ts',
  'src/lib/planner/planEval.ts',
  'src/lib/planner/planDigest.ts',
  'src/lib/planner/explain.ts',
  'src/lib/planner/energyCurve.ts',
  'src/lib/planner/fatigue.ts',
  'src/lib/planner/health.ts',
  'src/lib/planner/knowledge.ts',
  'src/lib/planner/places.ts',
  'src/lib/planner/placesPolicy.ts',
  'src/lib/planner/profilePrefs.ts',
  'src/lib/planner/campusLookup.ts',
  'src/lib/planner/transfer.ts',
  'src/lib/planner/transferConverge.ts',
  'src/lib/planner/corrections.ts',
  'src/lib/planner/courseOverrides.ts',
  'src/lib/planner/events.ts',
  'src/lib/planner/lifeModePolicy.ts',
  'src/lib/planner/longTermRules.ts',
  'src/lib/planner/unavailableSlots.ts',
  'src/lib/planner/schedule.ts',
  'src/lib/planner/index.ts',
  'server/app.py',
];

function verifyOrder() {
  const dir = path.join(ROOT, 'src/lib/planner');
  const actual = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d).sort()) {
      const fp = path.join(d, f);
      if (fs.statSync(fp).isDirectory()) walk(fp);
      else if (f.endsWith('.ts') && !f.endsWith('.test.ts')) actual.push(path.relative(ROOT, fp).replace(/\\/g, '/'));
    }
  };
  walk(dir);
  const planned = ORDER.filter((f) => f.startsWith('src/lib/planner/'));
  const missing = actual.filter((f) => !planned.includes(f));
  const extra = planned.filter((f) => !actual.includes(f));
  if (missing.length || extra.length) {
    throw new Error(
      `取材清单与 src/lib/planner 实际文件漂移：缺失 ${JSON.stringify(missing)} / 多余 ${JSON.stringify(extra)}。` +
        `请同步本脚本 ORDER 后重跑（软著材料取材范围必须显式登记）。`,
    );
  }
}

function buildSourceLines() {
  const lines = [];
  const perFile = [];
  for (const rel of ORDER) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n');
    const fileLines = raw.split('\n');
    if (fileLines.length && fileLines[fileLines.length - 1] === '') fileLines.pop();
    const marker = (rel.endsWith('.py') ? '# ' : '// ') + `===== 文件: ${rel} =====`;
    lines.push(marker, ...fileLines, '');
    perFile.push([rel, fileLines.length + 2]);
  }
  return { lines, perFile };
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function lineDiv(l) {
  const shown = l.length === 0 ? '\u00a0' : escapeHtml(l.replace(/\t/g, '    '));
  return `<div class="ln">${shown}</div>`;
}

function pageDiv(html) {
  return `<div class="page">${html}</div>`;
}

function wrapHtml(bodyLines, docTitle) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${docTitle}</title>
<style>
  body { margin: 0; font-family: "Courier New", Consolas, "Segoe UI Emoji", "SimSun", monospace; font-size: 8.5pt; color: #111; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .ln { white-space: pre-wrap; word-break: break-all; line-height: 1.3; min-height: 1.3em; }
  .sep { padding-top: 60mm; text-align: center; font-family: "SimSun", serif; font-size: 11pt; line-height: 2; color: #333; }
  /* 手册排版（manual 子命令复用同一渲染器） */
  .doc { font-family: "SimSun", "Microsoft YaHei", serif; font-size: 10.5pt; line-height: 1.75; color: #111; padding: 0 2mm; }
  .doc h1 { font-size: 17pt; margin: 10pt 0 14pt; }
  .doc h2 { font-size: 13.5pt; margin: 14pt 0 8pt; border-left: 3pt solid #8C1F28; padding-left: 6pt; }
  .doc h3 { font-size: 11.5pt; margin: 10pt 0 6pt; }
  .doc table { border-collapse: collapse; width: 100%; font-size: 9.5pt; margin: 6pt 0; }
  .doc th, .doc td { border: 0.6pt solid #999; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  .doc img { max-width: 82%; display: block; margin: 6pt auto; border: 0.6pt solid #ccc; }
  .doc figcaption, .doc .cap { text-align: center; font-size: 9pt; color: #555; margin: 2pt 0 8pt; }
  .doc code { font-family: "Courier New", Consolas, monospace; font-size: 9.5pt; background: #f3f3f3; padding: 0 2pt; }
  .doc pre { font-family: "Courier New", Consolas, monospace; font-size: 9pt; background: #f6f6f6; padding: 5pt 7pt; border: 0.5pt solid #ddd; white-space: pre-wrap; }
</style>
</head>
<body>
${bodyLines}
</body>
</html>
`;
}

function buildSourceHtml(lines) {
  const total = lines.length;
  const frontN = FRONT_PAGES * LINES_PER_PAGE;
  const backN = BACK_PAGES * LINES_PER_PAGE;
  const pages = [];
  if (total <= frontN + backN) {
    // 全量不足 60 页：整卷提交
    for (let i = 0; i < total; i += LINES_PER_PAGE) {
      pages.push(lines.slice(i, i + LINES_PER_PAGE).map(lineDiv).join(''));
    }
    var omitted = null;
  } else {
    const front = lines.slice(0, frontN);
    const back = lines.slice(total - backN);
    for (let i = 0; i < front.length; i += LINES_PER_PAGE) {
      pages.push(front.slice(i, i + LINES_PER_PAGE).map(lineDiv).join(''));
    }
    var omitted = { from: frontN + 1, to: total - backN };
    for (let i = 0; i < back.length; i += LINES_PER_PAGE) {
      pages.push(back.slice(i, i + LINES_PER_PAGE).map(lineDiv).join(''));
    }
  }
  const parts = pages.map((p) => pageDiv(p));
  if (omitted) {
    // 说明页必须独立成页且其后强制分页（版权材料代码页必须整 50 行，
    // 2026-10-24 首版曾因未包 .page 导致后段首页被挤跨两个物理页）
    const sep = pageDiv(
      `<div class="doc"><div class="sep">` +
      `<div><b>（材料说明）</b></div>` +
      `<div>本软件源程序共 ${total} 行、${ORDER.length} 个源文件</div>` +
      `<div>（src/lib/planner 之 ${ORDER.length - 1} 个 TypeScript 文件 + server/app.py）。</div>` +
      `<div>现提交源程序前 ${FRONT_PAGES} 页（第 1—${frontN} 行）与后 ${BACK_PAGES} 页（第 ${omitted.to + 1}—${total} 行），</div>` +
      `<div>中间部分（第 ${omitted.from}—${omitted.to} 行）篇幅所限从略。</div>` +
      `<div>末页为程序结束。</div>` +
      `</div></div>`,
    );
    parts.splice(FRONT_PAGES, 0, sep);
  }
  return { html: wrapHtml(parts.join('\n'), `${SOFTWARE_NAME} 源程序材料`), total, pages: parts.length, omitted };
}

async function renderPdf(htmlPath, pdfPath, headerRight) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'load' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '16mm', left: '14mm', right: '14mm' },
      displayHeaderFooter: true,
      headerTemplate:
        `<div style="width:100%; font-size:8px; font-family:'SimSun',serif; color:#333; padding:0 14mm; display:flex; justify-content:space-between;">` +
        `<span>${SOFTWARE_NAME}</span><span>${headerRight}</span></div>`,
      footerTemplate:
        `<div style="width:100%; font-size:8px; font-family:'SimSun',serif; color:#333; text-align:center;">` +
        `第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>`,
    });
  } finally {
    await browser.close();
  }
}

async function buildSource() {
  verifyOrder();
  const { lines, perFile } = buildSourceLines();
  const { html, total, pages, omitted } = buildSourceHtml(lines);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const htmlPath = path.join(OUT_DIR, '_source_material.html');
  const pdfPath = path.join(OUT_DIR, '光溯上理校园生活助手V1.0-源程序材料.pdf');
  fs.writeFileSync(htmlPath, html, 'utf8');
  await renderPdf(htmlPath, pdfPath, '源程序材料');
  const size = fs.statSync(pdfPath).size;
  console.log('== 源程序材料 ==');
  console.log(`取材文件 ${ORDER.length} 个，总行数 ${total}（含文件标注与分隔空行）`);
  for (const [rel, n] of perFile) console.log(`  ${String(n).padStart(6)} 行  ${rel}`);
  if (omitted) console.log(`省略区间：第 ${omitted.from}—${omitted.to} 行`);
  console.log(`PDF：${pages} 页（前30 + 说明页1 + 后30）→ ${pdfPath}`);
  console.log(`体积：${(size / 1024).toFixed(0)} KB`);
  // 末页锚点自检：程序结束必须出现在最后一页
  const tail = lines.slice(-40).join('\n');
  if (!/uvicorn\.run/.test(tail)) throw new Error('末页未包含程序结束锚点（uvicorn.run）——取材排序被破坏');
  console.log('末页锚点（uvicorn.run 程序结束块）：OK');
}

async function buildManual() {
  const htmlPath = path.join(OUT_DIR, 'user-manual.html');
  if (!fs.existsSync(htmlPath)) throw new Error(`未找到 ${htmlPath}——手册源文件需先行编写`);
  const pdfPath = path.join(OUT_DIR, '光溯上理校园生活助手V1.0-用户手册.pdf');
  await renderPdf(htmlPath, pdfPath, '用户手册');
  const size = fs.statSync(pdfPath).size;
  console.log('== 用户手册 ==');
  console.log(`PDF → ${pdfPath}`);
  console.log(`体积：${(size / 1024).toFixed(0)} KB`);
}

const mode = process.argv[2] ?? 'all';
fs.mkdirSync(OUT_DIR, { recursive: true });
if (mode === 'source' || mode === 'all') await buildSource();
if (mode === 'manual' || mode === 'all') await buildManual();
console.log('done.');
