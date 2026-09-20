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
 *
 * 用法：  node scripts/gate_overnight.mjs
 * 退出码：0 = 全绿；1 = 有门禁未过（输出会指明是哪一条）
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

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
{
  let ok = true;
  let detail = '禁区文件零改动';
  if (existsSync('.git')) {
    const { out } = run('git status --porcelain');
    const hit = out
      .split('\n')
      .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
      .filter(Boolean)
      .filter((p) => FORBIDDEN.some((f) => p.startsWith(f)));
    if (hit.length) {
      ok = false;
      detail = '禁区文件被改动：\n      ' + hit.join('\n      ');
    }
  } else {
    detail = '未检测到 .git，跳过（建议先做 P0-A 快照）';
  }
  results.push({ name: '禁区文件', ok, detail });
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
