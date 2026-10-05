#!/usr/bin/env node
/**
 * 通宵批次一键门禁 —— 给「无人值守开发」用的确定性验收入口。
 *
 * 为什么需要它：
 *   /goal 的自动校验只认「实据」（命令输出 / 测试结果），不认计划和听起来像结论的回复。
 *   把四条判据压成一条命令，agent 每轮收尾跑一次即可自证，早上 CY 也只需跑同一条命令。
 *
 * 判据（基线为 2026-10-02 实测值 458/321，只增不减）：
 *   1. tsc --noEmit         → 必须 0 错误
 *   2. npm run test:engine  → fail=0 且 pass ≥ 458
 *   3. npm run test:ui      → fail=0 且 pass ≥ 321
 *   4. 禁区文件             → 名单已清空（2026-10-02 起单人负责，原 RAY 禁区条款作废，见 AGENTS.md §二/8.1）；
 *                             机制保留：日后需要重新圈禁区时往 FORBIDDEN 里加回即可
 *   5. 版本纪律（2026-06 新增）→ scripts/preflight.mjs：本地与 origin/dev 必须同源
 *                             （实测本项目为 unrelated histories，是「agent 看不到本地
 *                             功能、只能凭猜测重建」的根因，见 AGENTS.md §〇之前）
 *   6. 影响面回归（2026-06 新增）→ scripts/impact.mjs：按依赖图反查本次改动波及哪些
 *                             过往功能，只跑那些守护测试；红=打断了旧功能
 *   7. 风格规范漂移         → scripts/check_style_drift.py（E10）：梨宝语言规范入库后，
 *                            app.py 人格注释 / direct.py 模板引用必须与规范同步（2026-09-21 加入）
 *
 * 用法：  node scripts/gate_overnight.mjs
 * 退出码：0 = 全绿；1 = 有门禁未过（输出会指明是哪一条）
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';

// 2026-10-02：单人负责，原 RAY 禁区条款作废（AGENTS.md §二/8.1）→ 名单清空。
// 机制保留：需要重新圈禁区时在此加回目录前缀即可。
const BASELINE = { engine: 458, ui: 321 };

const FORBIDDEN = [];

function run(line) {
  const r = spawnSync(line, {
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  // 🔴 fail-open 修复（2026-09-27）：spawnSync 失败（如沙箱禁 cmd.exe → EBUSY）时
  //    status === null。旧行为把空输出当「成功」处理 —— 禁区门会**静默假 PASS**
  //    （读不到 git status = 零改动误判）。现在一律判 FAIL，并带上错误信息。
  //
  // 🔴 二次修正（2026-10-06）：一律 FAIL 同样有害 —— 部分沙箱禁止 spawn 子进程，
  //    会让 typecheck/测试/风格漂移**全部假红**（实测 7/7 红，而直跑 tsc 是 0 错）。
  //    假红的危害比假PASS 更大：agent 会开始习惯性忽略门禁，门禁名存实亡。
  //    所以现在单独标记 envBlocked，让汇总层把它显示为 WARN 而不是 FAIL，
  //    且**绝不静默当成通过**（verdict 会明写「未能判定」）。
  if (r.error || r.status === null) {
    const why = r.error?.message ?? 'status=null（子进程未能启动）';
    return {
      code: 1,
      envBlocked: /EBUSY|ENOENT|EPERM|not permitted|sandbox/i.test(why),
      out: `[gate] spawn 失败，本门按 FAIL 处理：${why}`,
    };
  }
  return {
    code: r.status,
    envBlocked: false,
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
  const { code, out, envBlocked } = run('npm run --silent typecheck');
  results.push({
    name: 'typecheck',
    ok: code === 0,
    envBlocked,
    detail: code === 0 ? '0 错误' : envBlocked ? '⚠️ 环境不可用，未能判定' : '有类型错误（见上方输出）',
    raw: out,
  });
}

// ---- 2 & 3. 两套测试 ----
for (const [script, key, floor] of [
  ['test:engine', 'engine', BASELINE.engine],
  ['test:ui', 'ui', BASELINE.ui],
]) {
  const { code, out, envBlocked } = run(`npm run --silent ${script}`);
  const pass = num(out, 'pass');
  const fail = num(out, 'fail');
  const ok = code === 0 && fail === 0 && pass !== null && pass >= floor;
  results.push({
    name: script,
    ok,
    envBlocked,
    detail:
      envBlocked
        ? '⚠️ 环境不可用，未能判定（不是失败）'
        : pass === null
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
  let envBlocked = false;
  let detail = '禁区文件零改动';
  if (existsSync('.git')) {
    const g = run('git status --porcelain');
    // 🔴 fail-open 修复：git status 读不到（spawn 失败）≠ 零改动 —— 必须判 FAIL
    if (g.code !== 0) {
      ok = false;
      envBlocked = !!g.envBlocked;
      detail = g.envBlocked
        ? '⚠️ 环境不可用，未能读取 git 状态（不是「零改动」）'
        : `无法读取 git 状态（spawn 失败），按 FAIL 处理：${g.out.slice(0, 120)}`;
    } else {
      const out = g.out;
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
    }
  } else {
    detail = '未检测到 .git，跳过（建议先做 P0-A 快照）';
  }
  results.push({ name: '禁区文件', ok, envBlocked, detail });
}

// ---- 4b. 版本纪律 + 影响面回归（2026-10-06）----
// 为什么加这两条：本项目真实根因是本地 beta-v2 与 origin/dev 为
// unrelated histories（merge-base 为空、领先 132+ commit 从未 push），
// agent clone 后看不到本地已形成的功能 → 只能凭猜测重建。
//   preflight 拦「没站在最新版本上就动手」
//   impact    拦「改完没验证有没有打断过往功能」
const ALLOW_DIRTY = !!process.env.GATE_ALLOW_DIRTY;

// preflight：only warn on dirty worktree（那是常态，不该拦住收尾）；但 unrelated/behind 必须 FAIL
{
  const { code, out, envBlocked } = run(`node scripts/preflight.mjs ${ALLOW_DIRTY ? '--allow-dirty' : ''}`);
  // preflight 退出码 1 = 有硬阻塞（UNRELATED_HISTORIES / BEHIND）
  const blocked2 = code !== 0;
  const mBlock = out.match(/⛔ \[(\w+)\]/g) || [];
  // ⚠️ 嵌套 spawn 局限：本门自己也是 spawn 出来的。在禁止子进程的沙箱里，
  //连 preflight 都跑不起来 → 拿不到它的真实结论，只能标 WARN。
  //    这时**必须让 agent 单独跑 preflight**（AGENTS.md 已写死为开工第一件事），
  //    不能因为这里显示 WARN 就以为版本纪律没问题。
  results.push({
    name: '版本纪律',
    ok: !blocked2,
    envBlocked,
    detail: envBlocked
      ? '⚠️ 环境不可用，未能判定——请单独跑 node scripts/preflight.mjs（它是开工硬闸，不许跳过）'
      : blocked2
        ? `未站在最新版本上：${mBlock.join(' ').replace(/⛔ \[|\]/g, '')}` +
          `（处理办法见 AGENTS.md §〇之前，或直接跑 node scripts/preflight.mjs 看报告）`
        : 'HEAD 即最新（与远端基线同源）',
    raw: out,
  });
}

// impact：只跑受本次改动波及的测试，快；这是「不许打断过往功能」的机器判据
{
  const { code, out, envBlocked } = run('node scripts/impact.mjs');
  const undetermined = /无法判定/.test(out);
  // ⚠️ fail-open 风险处理：环境不可用（UNDETERMINED）不能算 PASS 也不能算 FAIL——
  // 真实测试失败（fail>0 / 非零退出且非环境问题）才判 FAIL。
  const realFail = code !== 0 && !undetermined && !envBlocked;
  results.push({
    name: '影响面回归',
    ok: !realFail,
    envBlocked: envBlocked || undetermined,
    detail: envBlocked || undetermined
      ? '⚠️ 环境不可用，未能判定（不是通过）——请在 Bash 里跑 node scripts/impact.mjs --print-command 拿命令复跑'
      : realFail
        ? '有受影响测试未过（可能打断过往功能）'
        : /未触及|无需回归|结论：✅/.test(out)
          ? '本次改动不触及已归档功能，无需回归'
          : '受影响功能全部正常',
    raw: out,
  });
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
  const { code, out, envBlocked } = run(`"${py}" scripts/check_style_drift.py`);
  const tail = out.split('\n').filter(Boolean).slice(-3).join(' | ');
  results.push({
    name: '风格漂移',
    ok: code === 0,
    envBlocked,
    detail: code === 0 ? '规范与代码同步（check_style_drift 8 项全过）' : envBlocked ? '⚠️ 环境不可用，未能判定' : tail,
    raw: out,
  });
}

// ---- 汇总 ----
console.log('\n================ 通宵批次门禁 ================');
for (const r of results) {
  const tag = r.envBlocked ? 'WARN' : r.ok ? 'PASS' : 'FAIL';
  console.log(`  ${tag}  ${r.name.padEnd(12)} ${r.detail}`);
}
const failed = results.filter((r) => !r.ok && !r.envBlocked);
const blocked = results.filter((r) => r.envBlocked);
console.log('==============================================');
if (blocked.length) {
  console.log(
    `⚠️ ${blocked.length} 条因环境受限未能判定（${blocked.map((b) => b.name).join(', ')}）——` +
      `\n   这是沙箱禁止子进程所致，不是测试失败。请在 Bash 里直跑对应命令核实，例如：`
  );
  for (const b of blocked) {
    const hint = { typecheck: 'npx tsc --noEmit', 'test:engine': 'npm run test:engine', 'test:ui': 'npm run test:ui', 禁区文件: 'git status --porcelain', 风格漂移: 'python scripts/check_style_drift.py', '影响面回归': 'node scripts/impact.mjs --print-command', 版本纪律: 'node scripts/preflight.mjs' }[b.name] || '';
    if (hint) console.log(`     ${b.name.padEnd(12)} → ${hint}`);
  }
  if (blocked.some((b) => b.name === '版本纪律')) {
    console.log(`\n   🔴 特别注意：版本纪律是**开工硬闸**，即使这里显示 WARN 也必须单独核实。`);
    console.log(`      本项目当前实测状态是 UNRELATED_HISTORIES（本地与远端无共同祖先）。`);
  }
  console.log(`   ⚠️ 不要因为「跑不了」就当它通过。`);
}
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
if (blocked.length) {
  console.log('结果：真实判据无失败，但有环境受限项未能判定 → 请人工核实上面命令。');
  process.exit(2); // 2 = 未判定（区别于 1 = 真失败，区别于 0 = 全绿）
}
console.log('结果：全部通过。可以收尾。');
