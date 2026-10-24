#!/usr/bin/env node
/**
 * 软著 V1.0 源程序材料生成器（docs/usst-line-plan-2026-10-24.md §A-2）
 * ============================================================
 * 取材：src/lib/planner/*.ts（全部 34 文件，按引擎数据流排序）+ server/app.py
 *       （置于末位：文件以 uvicorn.run 结尾，满足「末页为程序结束」）。
 * 产物：_软著V1.0/ 下两份 HTML——完整 listing 与「前30后30页」提交版；
 *       PDF 用 Edge headless 打印（本脚本不spawn子进程，命令打印到 stdout 供 Bash 执行）。
 * 版式：A4，页边距 12/10mm，每页 55 行（≥50 行要求），页眉「光溯上理校园生活助手 V1.0 · 源程序 第 N 页/共 M 页」，
 *       8.5pt Consolas（中文回落微软雅黑），超宽行按字符宽度折行并加悬挂缩进——
 *       分页按「视觉行」计算，PDF 页数恒等于 page div 数，不受折行影响。
 * 用法：node scripts/softcopyright_pdf.mjs [--rows=55] [--font=8.5] [--front=30] [--back=30]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// —— 取材文件与顺序（引擎数据流：入口 → 编排 → 契约 → 构造/改进 → 滚动/涟漪 →
//    知识接线 → 解释/诊断 → 服务端）。顺序变更属材料口径变更，需在软著材料备注里同步。 ——
const MATERIAL = [
  'src/lib/planner/index.ts',
  'src/lib/planner/schedule.ts',
  'src/lib/planner/planWeek.ts',
  'src/lib/planner/model.ts',
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
  'src/lib/planner/transfer.ts',
  'src/lib/planner/transferConverge.ts',
  'src/lib/planner/unavailableSlots.ts',
  'src/lib/planner/corrections.ts',
  'src/lib/planner/courseOverrides.ts',
  'src/lib/planner/energyCurve.ts',
  'src/lib/planner/fatigue.ts',
  'src/lib/planner/health.ts',
  'src/lib/planner/events.ts',
  'src/lib/planner/knowledge.ts',
  'src/lib/planner/places.ts',
  'src/lib/planner/placesPolicy.ts',
  'src/lib/planner/profilePrefs.ts',
  'src/lib/planner/lifeModePolicy.ts',
  'src/lib/planner/longTermRules.ts',
  'src/lib/planner/methods.ts',
  'src/lib/planner/templates.ts',
  'src/lib/planner/campusLookup.ts',
  'src/lib/planner/explain.ts',
  'src/lib/planner/planDigest.ts',
  'src/lib/planner/planEval.ts',
  'server/app.py',
];

const SOFT_NAME = '光溯上理校园生活助手 V1.0';
const OUT_DIR = path.join(ROOT, '_软著V1.0');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);
const ROWS = Number(args.rows ?? 55);
const FONT_PT = Number(args.font ?? 8.5);
const FRONT = Number(args.front ?? 30);
const BACK = Number(args.back ?? 30);

// —— 版式常量（pt = 1/72 inch；A4 = 595.3 × 841.9 pt）——
const MARGIN_MM = { top: 12, right: 10, bottom: 12, left: 10 };
const PAGE_W_PT = (210 * 72) / 25.4;
const PAGE_H_PT = (297 * 72) / 25.4;
const PRINT_W_PT = PAGE_W_PT - ((MARGIN_MM.left + MARGIN_MM.right) * 72) / 25.4;
const LINE_H_PT = 13;
const rowEm = PRINT_W_PT / FONT_PT; // 一行能容纳的 em 宽数（ascii≈0.55em，CJK=1em）

const charEm = (ch) => {
  const cp = ch.codePointAt(0);
  if (cp >= 0x2e80) return 1.0; // CJK 与全角区
  return 0.55; // Consolas advance ≈ 0.5498em
};

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 把一行源码按可用宽度折成若干「视觉行」，续行加 6 空格悬挂缩进 */
function wrapLine(line, wrapStat) {
  const rows = [];
  let cur = '';
  let curEm = 0;
  let cont = false;
  const PREFIX = '      '; // 续行悬挂缩进
  const prefixEm = () => [...PREFIX].reduce((s, c) => s + charEm(c), 0);
  for (const ch of line) {
    const w = charEm(ch);
    const budget = cont ? rowEm - prefixEm() : rowEm;
    if (curEm + w > budget && cur.length > 0) {
      rows.push(cont ? PREFIX + cur : cur);
      cur = '';
      curEm = 0;
      cont = true;
      wrapStat.count += 1;
    }
    cur += ch;
    curEm += w;
  }
  rows.push(cont ? PREFIX + cur : cur);
  return rows;
}

function buildRows() {
  const rows = [];
  const wrapStat = { count: 0 };
  const summary = [];
  for (const rel of MATERIAL) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) throw new Error(`取材文件不存在：${rel}`);
    const raw = fs.readFileSync(abs, 'utf8').replace(/\r\n?/g, '\n');
    const lines = raw.split('\n');
    // 末尾空行收敛为 1（文件末换行产生的那条空行）
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const comment = rel.endsWith('.py') ? '#' : '/*';
    const tail = rel.endsWith('.py') ? '' : ' */';
    rows.push(`${comment} ===== 文件：${rel}（${lines.length} 行） =====${tail}`);
    rows.push('');
    for (const l of lines) {
      const expanded = l.replace(/\t/g, '    ').replace(/\u00a0/g, ' ').trimEnd();
      rows.push(...wrapLine(expanded, wrapStat));
    }
    rows.push('');
    summary.push({ rel, lines: lines.length });
  }
  return { rows, wrapStat, summary };
}

function renderHtml(pages, totalPages, title, pageNoOf) {
  const pageDivs = pages
    .map((rows, idx) => {
      const no = pageNoOf ? pageNoOf(idx) : idx + 1;
      return `  <div class="page">
    <div class="hdr">${SOFT_NAME} · 源程序　第 ${no} 页 / 共 ${totalPages} 页</div>
    <pre>${esc(rows.join('\n'))}</pre>
  </div>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: A4; margin: ${MARGIN_MM.top}mm ${MARGIN_MM.right}mm ${MARGIN_MM.bottom}mm ${MARGIN_MM.left}mm; }
  html, body { margin: 0; padding: 0; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .hdr { font: 8pt "Microsoft YaHei", "SimSun", sans-serif; color: #000;
         border-bottom: 0.5pt solid #666; padding-bottom: 2pt; margin-bottom: 5pt; white-space: nowrap; }
  pre { margin: 0; font: ${FONT_PT}pt/${LINE_H_PT}pt Consolas, "Microsoft YaHei", monospace;
        white-space: pre; overflow: hidden; }
</style>
</head>
<body>
${pageDivs}
</body>
</html>
`;
}

function paginate(rows) {
  const pages = [];
  for (let i = 0; i < rows.length; i += ROWS) pages.push(rows.slice(i, i + ROWS));
  return pages;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { rows, wrapStat, summary } = buildRows();
  const pages = paginate(rows);
  const totalPages = pages.length;

  const fullHtml = renderHtml(pages, totalPages);
  const fullHtmlPath = path.join(OUT_DIR, 'source-listing-full.html');
  fs.writeFileSync(fullHtmlPath, fullHtml, 'utf8');

  if (totalPages < FRONT + BACK) {
    throw new Error(
      `总页数 ${totalPages} 不足 ${FRONT}+${BACK}，请扩取材范围或减小 --rows`,
    );
  }
  const submitPages = [
    ...pages.slice(0, FRONT),
    ...pages.slice(totalPages - BACK),
  ];
  // 提交版保留绝对页码（前 1..FRONT 与后 BACK 页的原页号）
  const offsets = [
    ...Array.from({ length: FRONT }, (_, i) => i + 1),
    ...Array.from({ length: BACK }, (_, i) => totalPages - BACK + i + 1),
  ];
  const submitHtml = renderHtml(
    submitPages,
    totalPages,
    `${SOFT_NAME} 源程序（前${FRONT}后${BACK}页）`,
    (idx) => offsets[idx],
  );
  const submitHtmlPath = path.join(OUT_DIR, 'source-listing-submit.html');
  fs.writeFileSync(submitHtmlPath, submitHtml, 'utf8');

  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  console.log('================ 软著源程序材料生成 ================');
  console.log(`取材 ${MATERIAL.length} 个文件：`);
  for (const s of summary) console.log(`  ${String(s.lines).padStart(6)} 行  ${s.rel}`);
  console.log('----------------------------------------------------');
  console.log(`源码行 ${rows.length}（含文件分隔横幅）→ 每页 ${ROWS} 行 → 共 ${totalPages} 页`);
  console.log(`折行处理：${wrapStat.count} 条续行（宽于 ${rowEm.toFixed(1)}em 的行按字符宽折行+悬挂缩进）`);
  console.log(`提交版页码范围：1–${FRONT} 与 ${totalPages - BACK + 1}–${totalPages}（页眉保留绝对页码）`);
  console.log('');
  console.log('PDF 打印命令（Edge headless，逐条在 Bash 执行）：');
  console.log(`"${edge}" --headless=new --disable-gpu --no-first-run --no-pdf-header-footer --print-to-pdf-no-header --print-to-pdf="${path.join(OUT_DIR, 'guangsu-v1.0-source-submit.pdf')}" "${pathToFileURL(submitHtmlPath).href}"`);
  console.log(`"${edge}" --headless=new --disable-gpu --no-first-run --no-pdf-header-footer --print-to-pdf-no-header --print-to-pdf="${path.join(OUT_DIR, 'guangsu-v1.0-source-full.pdf')}" "${pathToFileURL(fullHtmlPath).href}"`);
}

main();
