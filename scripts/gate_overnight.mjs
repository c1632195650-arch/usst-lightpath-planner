#!/usr/bin/env node
/**
 * 通宵批次一键门禁 —— 给「无人值守开发」用的确定性验收入口。
 *
 * 为什么需要它：
 *   /goal 的自动校验只认「实据」（命令输出 / 测试结果），不认计划和听起来像结论的回复。
 *   把四条判据压成一条命令，agent 每轮收尾跑一次即可自证，早上 CY 也只需跑同一条命令。
 *
 * 判据（基线为 2026-09-21 实测值，只增不减）：
 *   1. tsc --noEmit         → 必须 0 错误
 *   2. npm run test:engine  → fail=0 且 pass ≥ 312
 *   3. npm run test:ui      → fail=0 且 pass ≥ 219
 *   4. 禁区文件             → src/features/week/、src/lib/planner/、src/lib/persona.ts、
 *                            src/components/ 下不得有任何改动（协作红线：这些是队友 RAY 的文件）
 *   5. 风格规范漂移         → scripts/check_style_drift.py（E10）：梨宝语言规范入库后，
 *                            app.py 人格注释 / direct.py 模板引用必须与规范同步（2026-09-21 加入）
 *
 * 用法：  node scripts/gate_overnight.mjs
 * 退出码：0 = 全绿；1 = 有门禁未过（输出会指明是哪一条）
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';

const BASELINE = { engine: 312, ui: 219 };

const FORBIDDEN = [
  'src/features/week/',
  'src/lib/planner/',
  'src/lib/persona.ts',
  'src/components/',
];

function run(line) {
  const r = spawnSync(line, {
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: r.status,
    out: (r.stdout || '') + (r.stderr || ''),
  };
}

function num(text, label) {
  const m = text.match(new RegExp(label + '\\s+(\\d+)'));
  return m ? Number(m[1]) : null;
}

const results = [];

// ---- 1. typecheck ----
{
  const { code, out } = run('npm run --silent typecheck');
  results.push({
    name: 'typecheck',
    ok: code === 0,
    detail: code === 0 ? '0 错误' : '有类型错误（见上方输出）',
    raw: out,
  });
}

// ---- 2 & 3. 两套测试 ----
for (const [script, key, floor] of [
  ['test:engine', 'engine', BASELINE.engine],
  ['test:ui', 'ui', BASELINE.ui],
]) {
  const { code, out } = run(`npm run --silent ${script}`);
  const pass = num(out, 'pass');
  const fail = num(out, 'fail');
  const ok = code === 0 && fail === 0 && pass !== null && pass >= floor;
  results.push({
    name: script,
    ok,
    detail:
      pass === null
        ? '无法解析测试计数（测试没跑起来？）'
        : `pass=${pass} fail=${fail}（基线 ≥${floor}，只增不减）`,
    raw: out,
  });
}

// ---- 4. 禁区文件 ----
// 红线本意是保护 RAY 的**既有工作**：已跟踪禁区文件的修改/删除一律违规；
// 但三树合流（2026-09-21）会向禁区目录**新增**文件（methods.ts / health.ts 等），
// 新增只提示不判死 —— 合流是 CY 白天拍板的行为，不是夜间 agent 的自作主张。
//
// 已跟踪禁区文件的改动，只有两种出口：
//   a) 默认 → 违规（夜间无人值守任务走这条，规则仍是「零改动」）；
//   b) 人工主导的操作（合流 / 修 bug）→ 由操作者显式导出 GATE_ALLOW_FORBIDDEN
//      逐个声明，输出里专门列一节，既放行又留痕、可审计。
//   夜间任务脚本里**绝不设**该变量。
const ALLOW = (process.env.GATE_ALLOW_FORBIDDEN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
{
  let ok = true;
  let detail = '禁区文件零改动';
  if (existsSync('.git')) {
    const { out } = run('git status --porcelain');
    const hit = [];
    const added = [];
    const approved = [];
    for (const l of out.split('\n')) {
      const st = l.slice(0, 2);
      const p = l.slice(3).trim().replace(/^"|"$/g, '');
      if (!p || !FORBIDDEN.some((f) => p.startsWith(f))) continue;
      if (st === '??' || st.includes('A')) added.push(p);
      else if (ALLOW.includes(p)) approved.push(p);
      else hit.push(p);
    }
    const notes = [];
    if (approved.length) {
      notes.push('人工批准的例外 ' + approved.length + ' 个：\n      ' + approved.join('\n      '));
    }
    if (added.length) {
      notes.push('合流新增 ' + added.length + ' 个（未动既有文件）：\n      ' + added.join('\n      '));
    }
    if (hit.length) {
      ok = false;
      detail = '禁区文件被改动：\n      ' + hit.join('\n      ');
    } else {
      detail = '禁区文件零改动' + (notes.length ? '（' + notes.join('；') + '）' : '');
    }
  } else {
    detail = '未检测到 .git，跳过（建议先做 P0-A 快照）';
  }
  results.push({ name: '禁区文件', ok, detail });
}

// ---- 5. 风格规范漂移（E10；python 按候选顺序解析，PATH 里没有 python 时兜底到 workbuddy 管理版）----
{
  const cands = [
    'python',
    String.raw`${os.homedir()}\.workbuddy\binaries\python\versions\3.13.12\python.exe`,
  ];
  let py = cands[0];
  for (const c of cands) {
    const probe = run(`"${c}" -c "print(1)"`);
    if (probe.code === 0 && probe.out.trim() === '1') {
      py = c;
      break;
    }
  }
  const { code, out } = run(`"${py}" scripts/check_style_drift.py`);
  const tail = out.split('\n').filter(Boolean).slice(-3).join(' | ');
  results.push({
    name: '风格漂移',
    ok: code === 0,
    detail: code === 0 ? '规范与代码同步（check_style_drift 8 项全过）' : tail,
    raw: out,
  });
}

// ---- 汇总 ----
console.log('\n================ 通宵批次门禁 ================');
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(12)} ${r.detail}`);
}
const failed = results.filter((r) => !r.ok);
console.log('==============================================');
if (failed.length) {
  console.log(`结果：${failed.length} 条未过 → ${failed.map((f) => f.name).join(', ')}`);
  for (const f of failed) {
    if (f.raw && f.name !== '禁区文件') {
      console.log(`\n--- ${f.name} 输出尾部 ---`);
      console.log(f.raw.split('\n').slice(-40).join('\n'));
    }
  }
  process.exit(1);
}
console.log('结果：全部通过。可以收尾。');
