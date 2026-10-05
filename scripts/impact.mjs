#!/usr/bin/env node
/**
 * impact —— 改动收尾闸门：**只测被这次改动波及的过往功能**，不多不少。
 * ===================================================================
 * 它解决的是「不要让改动祸及目标外的功能」，但**不是**靠禁止改动。
 *
 * 常见做法与本脚本的差别（这决定了 agent 敢不敢改）：
 *   ✗ 错误做法：给一份「不准碰这些文件」的禁区清单 → agent 越界就panic，
 *     或者干脆什么都不敢改。**本项目已验证这条路走不通**：
 *     AGENTS.md §8.1 的禁区名单在 2026-10-02 被清空，机制保留但名单空置。
 *   ✓ 本脚本做法：**放开改，但改完按依赖图自动圈出「你可能碰坏了什么」，
 *     并要求这些守护测试全绿。** 判断依据是机器推导的依赖图，不是人肉记忆。
 *
 * 工作方式：
 *   1. 取改动文件集（优先 git diff；沙箱里 git 不可用时读变更登记文件）
 *   2. 用 docs/capability-map.json 的 reverseIndex 反查：哪些测试在守这些文件
 *   3. 跑这些测试（按 suite 分组复用 npm run test:engine / test:ui 的入口）
 *   4. 全绿 = 可提交；红了 = 明确告诉你「你碰坏了哪个过往功能」
 *
 * 关键设计：**改动不触发任何已知守护 → 直接 PASS 并说明「无需回归」。**
 *   这保证 agent 改新东西时不会被无关测试拖住手脚（不阻塞正常推进）。
 *
 * 用法：
 *   node scripts/impact.mjs                     # 自动取git diff（已暂存+未暂存）
 *   node scripts/impact.mjs --files a.ts,b.ts # 显式指定改动文件
 *   node scripts/impact.mjs --staged           # 只看已暂存
 *   node scripts/impact.mjs --json# 机器可读
 *   node scripts/impact.mjs --explain          # 只解释「会跑哪些测试」，不执行
 *
 * 退出码：0 = 受影响功能全绿；1 = 有失败或无法判定
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_PATH = path.join(ROOT, 'docs', 'capability-map.json');
// 沙箱里 git 子进程不可用时的兜底登记文件（impact 侧写、preflight 侧不依赖）
const CHANGED_LOG = path.join(ROOT, '.impact-changed.txt');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const explainOnly = argv.includes('--explain');
const printCommand = argv.includes('--print-command');
const stagedOnly = argv.includes('--staged');

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.error || r.status === null) return { ok: false, out: '', err: r.error?.message ?? 'status=null' };
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const gitUsable = (() => { try { return git(['rev-parse', '--git-dir']).ok; } catch { return false; } })();

// ---------- 1. 取改动文件 ----------
let changed = [];
const fileArgIdx = argv.findIndex((a) => a === '--files');
if (fileArgIdx >= 0 && argv[fileArgIdx + 1]) {
  changed = argv[fileArgIdx + 1].split(',').map((s) => s.trim()).filter(Boolean);
} else if (gitUsable) {
  const args = stagedOnly
    ? ['diff', '--cached', '--name-only']
    : ['diff', '--name-only', 'HEAD'];
  const d = git(args);
  if (d.ok) changed = d.out.split('\n').map((s) => s.trim()).filter(Boolean);
} else if (existsSync(CHANGED_LOG)) {
  changed = readFileSync(CHANGED_LOG, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
}

// 归一化成清单里用的键（去扩展名、正斜杠）
const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');
const changedNorm = changed.map(norm);

// ---------- 2. 载入清单并反查守护测试 ----------
if (!existsSync(MAP_PATH)) {
  console.error('[impact] ❌ 找不到 docs/capability-map.json。先跑：node scripts/capability_map.mjs --write');
  process.exit(1);
}
const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
const rev = map.reverseIndex || {};

/** 命中逻辑：路径相等 / 目录前缀（改了 src/lib/planner/x.ts → lib/planner/x）。 */
function testsFor(srcPath) {
  const hits = new Set();
  // 精确命中
  for (const [k, v] of Object.entries(rev)) if (k === srcPath) v.forEach((t) => hits.add(t));
  // 目录级命中：改了一个「目录型」文件（index/types 等），其下的测试都算波及
  for (const [k, v] of Object.entries(rev)) {
    if (k === srcPath) continue;
    if (srcPath.startsWith(k + '/') || k.startsWith(srcPath + '/')) v.forEach((t) => hits.add(t));
  }
  return [...hits];
}

const affectedTests = new Set();
const changedByTest = {}; // test -> [changedSrc...]
for (const f of changedNorm) {
  const hits = testsFor(f);
  hits.forEach((t) => {
    affectedTests.add(t);
    (changedByTest[t] ||= []).push(f);
  });
}

// 契约层/配置类改动无法靠 import 图覆盖 → 兜底跑全量
const GLOBAL_TRIGGERS = [
  { re: /^src\/types\.ts$/, why: '契约层改动：字段增删会波及全部模块，必须全量回归' },
  { re: /^src\/constants/, why: '全局常量改动：影响面不可静态判定，必须全量回归' },
  { re: /^scripts\/register-alias\.mjs$/, why: '测试加载钩子改动：可能影响所有测试的解析，必须全量回归' },
  { re: /^package\.json$/, why: '依赖/脚本改动：测试入口可能变化，必须全量回归' },
];
const globalReason = GLOBAL_TRIGGERS.filter((g) => changedNorm.some((f) => g.re.test(f)));

// 后端/数据改动没有 TS 测试守护 → 提示人工验证（不假装有覆盖）
const NEEDS_HUMAN = [
  { re: /^server\//, label: '后端服务（server/）' },
  { re: /^data\//, label: '数据/知识库（data/）' },
  { re: /^evals\//, label: '评测语料（evals/）' },
];
const humanZones = NEEDS_HUMAN.filter((h) => changedNorm.some((f) => h.re.test(f)));

// ---------- 3. 决定要跑哪些套件 ----------
const runAll = globalReason.length > 0;
let suites = []; // 'engine' | 'ui'
if (runAll) {
  suites = ['engine', 'ui'];
} else {
  for (const t of affectedTests) {
    const s = (map.tests?.[t]?.suite) ?? (t.startsWith('tests/') ? 'engine' : 'ui');
    if (!suites.includes(s)) suites.push(s);
  }
}

// ---------- 4. 输出计划 / 执行 ----------
const results = [];

/**
 * 执行策略（两层，按可用性降级）：
 *   ① 直接 spawn `node --test <具体文件>` —— 更快、可带文件白名单、沙箱内可用
 *   ② 回退 `npm run test:engine|test:ui` —— 走包管理器，行为与项目脚本完全一致
 *
 * 为什么优先 ①：本机沙箱里 npm 需要拉起 cmd.exe，会EBUSY 被拦（实测确认）。
 * 若只用 ②，门禁在 agent 环境里就是「一跑就假红」，等于没有门禁。
 * 两层都拿不到执行环境时，判 FAIL（fail-closed），绝不假装通过。
 */
function runNodeTest(files) {
  const r = spawnSync(
    process.execPath,
    ['--import', './scripts/register-alias.mjs', '--test', ...files],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }
  );
  if (r.error || r.status === null) {
    return {
      ok: false,
      code: 1,
      // 🔴 关键：区分「测试真的挂了」与「环境跑不起来」。
      // 沙箱里 Node 无法 spawn 任何子进程（连自身 node.exe 也 EBUSY），
      // 若一律判 FAIL，门禁在 agent 环境就变成「永远假红」，
      // agent 会开始绕过它 → 门禁名存实亡。这是最坏结果。
      envBlocked: true,
      out: `[impact] ⚠️ 执行环境不可用（${r.error?.message ?? 'status=null'}）。\n` +
           `[impact] 不是测试失败，是当前沙箱禁止 Node 启动子进程。\n` +
           `[impact] 请在有子进程权限的环境重跑，或直接执行：\n` +
           `[impact]   node --import ./scripts/register-alias.mjs --test ${files.join(' ')}`,
    };
  }
  return { ok: true, code: r.status, envBlocked: false, out: (r.stdout || '') + (r.stderr || '') };
}

function runSuite(name) {
  const r = spawnSync('npm', ['run', '--silent', `${name === 'engine' ? 'test:engine' : 'test:ui'}`], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    shell: true,
  });
  if (r.error || r.status === null) {
    return { code: 1, envBlocked: true, out: `[impact] ⚠️ 执行环境不可用（${r.error?.message ?? 'status=null'}）` };
  }
  return { code: r.status, envBlocked: false, out: (r.stdout || '') + (r.stderr || '') };
}

if (!explainOnly && !printCommand) {
  if (suites.length && affectedTests.size) {
    // 路径①：只跑受影响的测试文件（这正是本脚本的意义——不跑全量）
    const r = runNodeTest([...affectedTests].sort());
    const out = r.out;
    results.push({
      suite: suites.join('+') + '（仅受影响 ' + affectedTests.size + ' 个文件）',
      code: r.code,
      envBlocked: r.envBlocked,
      pass: Number(out.match(/(?:^|\s)pass\s+(\d+)/m)?.[1] ?? NaN),
      fail: Number(out.match(/(?:^|\s)fail\s+(\d+)/m)?.[1] ?? NaN),
      out,
    });
  } else if (suites.length) {
    // 触发了全量但没圈出具体文件（契约层触发）→ 跑两个完整套件
    for (const s of suites) {
      const r = runSuite(s);
      const out = r.out;
      results.push({
        suite: s + '（全量）',
        code: r.code,
        envBlocked: r.envBlocked,
        pass: out.match(/(?:^|\s)pass\s+(\d+)/m)?.[1] ? Number(out.match(/(?:^|\s)pass\s+(\d+)/m)[1]) : null,
        fail: out.match(/(?:^|\s)fail\s+(\d+)/m)?.[1] ? Number(out.match(/(?:^|\s)fail\s+(\d+)/m)[1]) : null,
        out,
      });
    }
  }
}

const envBlocked = results.some((r) => r.envBlocked);
const failed = results.some((r) => (!r.envBlocked && (r.code !== 0 || (r.fail !== null && r.fail > 0))));

// ---- 5b. print-command：把「该跑什么」输出成可直接粘贴的 shell 命令 ----
// 为什么需要：部分沙箱禁止 Node 启动子进程（本机实测如此），此时门禁无法自跑。
// 但**判定逻辑已经算完了**，只差执行。把命令交给agent 在 Bash 里跑即可，
// 这样门禁在受限环境里依然可用，而不是退化成「一跑就假红」。
if (printCommand) {
  const cmds = [];
  if (runAll) {
    cmds.push('npm run test:engine', 'npm run test:ui');
  } else if (affectedTests.size) {
    const files = [...affectedTests].sort();
    cmds.push(
      `node --import ./scripts/register-alias.mjs --test \\\n  ` + files.join(' \\\n  ')
    );
  }
  if (cmds.length) {
    console.log(cmds.join('\n'));
  } else {
    console.log('# 无需运行任何测试（本次改动不触及已归档功能）');
  }
  process.exit(0);
}

// ---------- 5. 报告 ----------
if (asJson) {
  console.log(JSON.stringify({
    ok: !failed,
    verdict: envBlocked ? 'UNDETERMINED' : failed ? 'BROKEN' : 'PASS',
    changedFiles: changed,
    affectedTestCount: affectedTests.size,
    affectedTests: [...affectedTests].sort(),
    changedByTest,
    globalReason: globalReason.map((g) => g.why),
    humanZones: humanZones.map((h) => h.label),
    suites,
    results: results.map(({ out, ...r }) => r),
  }, null, 2));
} else {
  const line = '─'.repeat(64);
  console.log(`\n================ 影响面门禁 impact ================`);
  console.log(line);
  console.log(`改动文件　${changed.length} 个`);
  if (changed.length) {
    console.log(`　　　　　${changed.slice(0, 12).join('\n　　　　　')}${changed.length > 12 ? `\n　　　　　… 共 ${changed.length} 个` : ''}`);
  }
  console.log(line);

  if (globalReason.length) {
    console.log('\n🔍 触发**全量回归**（影响面无法静态判定）：');
    globalReason.forEach((g) => console.log(`  · ${g.why}`));
  }

  if (affectedTests.size) {
    console.log(`\n🎯 反查到的守护测试（${affectedTests.size} 个）—— 这些在守你改动的文件：`);
    for (const t of [...affectedTests].sort()) {
      const src = (changedByTest[t] || []).slice(0, 3).join(', ');
      console.log(`  · ${path.basename(t).padEnd(30)} ← ${src}`);
    }
  } else if (!runAll) {
    console.log('\n✨ 本次改动**未触及任何已有功能的守护测试** → 无需回归验证。');
    console.log('   （这是正常的：新功能/新文件的改动不应被旧测试拖住。）');
  }

  if (humanZones.length) {
    console.log('\n⚠️ 以下区域没有 TS 自动守护，机器无法验证，请人工确认：');
    humanZones.forEach((h) => console.log(`  · ${h.label} —— 若改的是行为逻辑，需手动跑对应验证脚本`));
  }

  if (explainOnly) {
    console.log(`\n（--explain 模式，未实际执行）将运行：${suites.length ? suites.join(', ') : '无'}`);
  } else if (!suites.length) {
    console.log('\n结论：✅ 无需跑测试（改动不触及已归档功能）。可以提交。');
  } else {
    console.log(line);
    for (const r of results) {
      if (r.envBlocked) {
        console.log(`  SKIP  ${r.suite.padEnd(8)} 执行环境不可用，无法判定`);
        continue;
      }
      const tag = r.code === 0 && (r.fail ?? 0) === 0 ? 'PASS' : 'FAIL';
      console.log(`  ${tag}  ${r.suite.padEnd(8)} pass=${r.pass ?? '?'} fail=${r.fail ?? '?'}`);
    }
    console.log(line);
    if (envBlocked) {
      console.log('\n结论：⚠️ **无法判定**（不是「通过」，也不是「失败」）。');
      console.log('  受影响的测试已定位在上方，但当前沙箱禁止 Node 启动子进程，跑不了。');
      console.log('  请在有子进程权限的环境重跑；或直接执行下面这条命令核实：');
      for (const r of results) {
        if (r.envBlocked) console.log(`\n${r.out.split('\n').filter(Boolean).map((l) => '    ' + l).join('\n')}`);
      }
      console.log('\n  ⚠️ 不要因为「跑不了」就当它通过——那等于没有门禁。');
    } else if (failed) {
      const bad = results.filter((r) => r.code !== 0 || (r.fail ?? 0) > 0);
      console.log('\n结论：❌ 过往功能被影响。不要提交。');
      for (const r of bad) {
        console.log(`\n--- ${r.suite} 失败输出（尾部） ---`);
        console.log(r.out.split('\n').slice(-30).join('\n'));
      }
      console.log('\n处理方式（按优先级）：');
      console.log('  1. 如果是**本次改动导致** → 修实现，不要改测试断言。');
      console.log('  2. 如果是**环境问题**（端口占用/实例陈旧/后端未起）→ 隔离环境复跑，');
      console.log('     注意 5173/8000 常有别人的进程在跑（BLOCKERS 有先例）。');
      console.log('  3. 如果**确实是既往功能的既存失败**（本次没碰它）→ 写进 BLOCKERS.md，');
      console.log('     报清楚「改动前就红」并附证据，不要自己改测试让它变绿。');
    } else {
      console.log('\n结论：✅ 受影响的过往功能全部正常。可以提交。');
    }
  }
  console.log('=================================================\n');
}

// UNDETERMINED 也返回 1：让脚本可以被 CI/门禁串联，且绝不被误读成「通过」
process.exit(failed || envBlocked ? 1 : 0);