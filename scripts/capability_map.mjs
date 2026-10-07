#!/usr/bin/env node
/**
 * 能力清单生成器 —— 把「已实现的功能」变成机器可读的归档真相源。
 * ===================================================================
 * 为什么需要它（2026-10-06 立）
 * -------------------------------------------------------------------
 * 问题的真实根因不是 agent 态度差，而是**它物理上看不到你本地推进的成果**：
 *   - 本地 beta-v2 与 origin/dev 是 unrelated histories（零共同祖先）
 *   - 本地领先远端 132+ commit，且从未推送
 *   → agent clone 拿到的是 150 个 commit 前的另一条历史，只能「凭印象猜着补」
 *
 * 所以要解决的是三件事，按因果排序：
 *   1. 让 agent 落在最新版本文件上→ 靠 preflight.mjs（开工硬闸）
 *   2. 让 agent 知道过去已经形成了哪些功能 → 靠本文件（能力清单）
 *   3. 让 agent 改动后能自动验证没打断旧功能 → 靠 impact.mjs（影响面门禁）
 *
 * 本文件负责第 2 件事：**功能 ↔ 守护测试**的映射，机器推导，不靠人记。
 *
 * 推导原理（为什么能自动生成而不是手工维护）：
 *   测试文件通过 `import ... from '@/lib/planner/xxx'` 直接依赖源码。
 *   反向扫描这个关系，就得到「哪些测试在守���哪些源文件」。
 *   实测 95 个测试文件中 90 个有源码依赖（余下 5 个用 readFileSync 源码锁，
 *   走 srcLock 兜底通道，同样能映射）。
 *
 * 用法：
 *   node scripts/capability_map.mjs            # 打印人类可读摘要
 *   node scripts/capability_map.mjs --json     # 输出 JSON（给 impact.mjs 消费）
 *   node scripts/capability_map.mjs --write    # 落盘 docs/capability-map.json
 *   node scripts/capability_map.mjs --check    # CI 模式：清单与源码不同步则 exit 1
 *
 * 退出码：0 = 一致；1 = --check 发现清单过期或有孤立测试
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'capability-map.json');

const argv = process.argv.slice(2);
const wantJson = argv.includes('--json');
const wantWrite = argv.includes('--write');
const wantCheck = argv.includes('--check');

/** 功能域定义：把源码目录归成语义上的「功能域」。
 *  这是本项目唯一需要人工维护的表——因为「域」是产品语义，不是代码结构。
 *  但只需列目录前缀，新增目录时补一行即可，不逐文件登记。 */
const DOMAINS = [
  { id: 'planner-engine', label: '排程引擎（两遍法/增量滚动/锁定/涟漪/buffer）', prefixes: ['src/lib/planner/'] },
  { id: 'week-view', label: '周计划视图（块卡片/抽屉/编辑/拖拽）', prefixes: ['src/features/week/', 'src/components/'] },
  { id: 'libao-chat', label: '梨宝对话（意图层/追问状态机/ActExecutor）', prefixes: ['src/features/libao/', 'src/lib/lbao.ts', 'src/lib/api.ts'] },
  { id: 'persona', label: '画像（问卷/规则映射/偏好接线）', prefixes: ['src/features/persona/', 'src/features/welcome/', 'src/lib/persona.ts', 'src/features/onboarding/'] },
  { id: 'calendar', label: '月历与截止事项/重要日', prefixes: ['src/features/calendar/'] },
  { id: 'activity-feedback', label: '活动与反馈', prefixes: ['src/features/activity/', 'src/features/feedback/'] },
  { id: 'mobile', label: '移动端（今日页/账号同步/ICS/Capacitor）', prefixes: ['src/features/mobile/', 'm.html', 'mobile/'] },
  { id: 'contracts', label: '契约层与全局类型（改这里=跨模块影响）', prefixes: ['src/types.ts', 'src/constants', 'src/lib/'] },
  { id: 'backend', label: '后端服务（RAG/问答/排程理解/账号同步）', prefixes: ['server/'] },
  { id: 'data-kb', label: '数据与知识库（方法库/健康库/空间库/资讯库）', prefixes: ['data/', 'scripts/rag.py', 'evals/'] },
  { id: 'ui-kit', label: '设计系统与通用组件', prefixes: ['src/components/', 'src/styles', 'src/index.css', 'tailwind.config'] },
];

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      walk(p, acc);
    } else if (e.name.endsWith('.test.ts')) acc.push(p);
  }
  return acc;
}

/** 把测试文件里出现的源码路径引用解析成仓库相对路径（正斜杠、去掉扩展名）。
 *  兼容项目里实际并存的四种写法（缺一不可，否则会误判大量测试为「孤立」）：
 *   ① `@/lib/planner/solver.ts`            —— @ 别名（最常见，tests/ 目录几乎全用这种）
 *   ② `../src/lib/planner/schedule.ts`    —— 相对路径带 src/ 前缀（scripts/ 目录多用）
 *   ③ `@/features/libao/weekPlanForChat`  —— @ 别名且无扩展名
 *   ④ `import type { X } from '@/types'`   —— 类型导入，同样是依赖
 *
 *  ⚠️ 历史坑：早期实现只认含 'src/' 的写法，导致 `@/...` 全被丢弃，
 *     95 个测试里 83 个被误报「无源码依赖」—— 那是假阴性，会让影响面分析漏跑。
 *     故此处按前缀分流，而不是靠 indexOf('src/') 兜。 */
function normalizeSpec(spec) {
  const raw = spec.replace(/\.(ts|tsx|js|jsx)$/, '');
  if (raw.startsWith('@/')) return 'src/' + raw.slice(2);   // ①③
  const i = raw.indexOf('src/');                              // ②
  if (i >= 0) return raw.slice(i);
  return null;
}

function extractDeps(content) {
  const deps = new Set();
  const srcLocks = new Set();
  // 静态 import / export-from / import type 统一覆盖
  const re = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content))) {
    const norm = normalizeSpec(m[1]);
    if (norm) deps.add(norm);
  }
  // 源码锁通道：直接读源码文本做正则断言（RV 反向验证锚点常用）。项目里并存四种写法：
  //   ① readFileSync(fileURLToPath(new URL('..' + rel, ...)))  —— rel 变量传入
  //   ② readFileSync('...src/xxx.ts')                            —— 字面量直接传
  //   ③ src('/src/App.tsx')                                       —— 自定义包装函数
  //      （见 tests/v3.test.ts：整份旅程锁只靠这个 helper 读源码）
  //   ④ join(here, '..', 'src', 'features', 'libao', 'LbaoChat.tsx')
  //      —— 路径拆成多个字符串段（见 scripts/libao-copy-guard.test.ts，2026-10-07 补）：
  //         单字面量正则看不到，会被误判孤立 → 永远不进影响面分析 → 假阴性，最危险。
  // 漏掉 ③ 会把 v3 误判为「孤立」，漏掉 ④ 会让 W5c 口吻守卫脱网。
  const reLock = /['"]((?:\.\.\/)*\/?(?:src\/)[^'"]+\.(?:ts|tsx))['"]/g;
  while ((m = reLock.exec(content))) {
    srcLocks.add(
      m[1].replace(/^\.\.\//, '').replace(/^\//, '').replace(/\.(ts|tsx)$/, '')
    );
  }
  const reJoin = /['"]src['"]\s*,\s*((?:['"][^'"]+['"]\s*,\s*)*['"][^'"]+['"])/g;
  while ((m = reJoin.exec(content))) {
    const segs = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]).filter((s) => s !== '..');
    const rel = 'src/' + segs.join('/');
    if (/\.(ts|tsx)$/.test(rel)) srcLocks.add(rel.replace(/\.(ts|tsx)$/, ''));
  }
  return { deps, srcLocks };
}

function domainOf(relSrc) {
  for (const d of DOMAINS) {
    if (d.prefixes.some((p) => relSrc.startsWith(p))) return d.id;
  }
  return null;
}

/** 反向索引：源文件 → 守护它的测试文件 */
function build() {
  const testFiles = [...walk(path.join(ROOT, 'tests')), ...walk(path.join(ROOT, 'scripts'))];
  const rel = testFiles
    .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))
    .sort();

  const guards = new Map(); // srcRelPath -> Set(testRel)
  const tests = {};
  const orphans = [];

  for (const t of rel) {
    const content = readFileSync(path.join(ROOT, t), 'utf8');
    const { deps, srcLocks } = extractDeps(content);
    const domains = new Set();
    for (const d of [...deps, ...srcLocks]) {
      const dom = domainOf(d);
      if (dom) domains.add(dom);
      if (!guards.has(d)) guards.set(d, new Set());
      guards.get(d).add(t);
    }
    // 反向验证锚点自述：文件头注释里写了 RV 编号的，标记为「强守护」
    const hasRv = /反向验证|RV|变异体|源码锁/.test(content.slice(0, 2000));
    tests[t] = {
      suite: t.startsWith('tests/') ? 'engine' : 'ui',
      guards: [...domains],
      guardCount: deps.size + srcLocks.size,
      reverseVerified: hasRv,
    };
    if (deps.size === 0 && srcLocks.size === 0) orphans.push(t);
  }

  // 按功能域聚合
  const domainsOut = {};
  for (const d of DOMAINS) {
    const ts = rel.filter((t) => tests[t].guards.includes(d.id));
    domainsOut[d.id] = {
      label: d.label,
      prefixes: d.prefixes,
      testCount: ts.length,
      tests: ts,
      // 该域下被守护的源码文件（用于影响面反查）
      sources: [...guards.keys()].filter((s) => domainOf(s) === d.id).sort(),
    };
  }

  return {
    generatedBy: 'scripts/capability_map.mjs',
    schemaVersion: 1,
    // 手工校准的基线（人工审阅后更新，--check 不会自动改）
    note:
      '本文件由 scripts/capability_map.mjs 生成，请勿手工编辑。' +
      '测试 ↔ 源码映射来自 import 扫描；新增测试后跑 --write 更新。',
    baseline: { engine: 458, ui: 321 },
    totals: {
      testFiles: rel.length,
      engineFiles: rel.filter((t) => t.startsWith('tests/')).length,
      uiFiles: rel.filter((t) => t.startsWith('scripts/')).length,
      guardedSources: guards.size,
      reverseVerified: rel.filter((t) => tests[t].reverseVerified).length,
      orphans: orphans.length,
    },
    domains: domainsOut,
    tests,
    reverseIndex: Object.fromEntries([...guards.entries()].map(([k, v]) => [k, [...v].sort()])),
    orphans,
  };
}

const map = build();

if (wantWrite) {
  writeFileSync(OUT, JSON.stringify(map, null, 2) + '\n', 'utf8');
  console.log(`[capability_map] 已写入 ${path.relative(ROOT, OUT)}`);
  console.log(`  测试文件 ${map.totals.testFiles}｜守护源文件 ${map.totals.guardedSources}｜RV 锚点 ${map.totals.reverseVerified}`);
}

if (wantJson) {
  console.log(JSON.stringify(map, null, 2));
} else if (!wantWrite) {
  // 人类可读摘要
  console.log('\n============ 能力归档清单（功能 ↔ 守护测试） ============\n');
  console.log(
    `测试文件 ${map.totals.testFiles} 个（engine ${map.totals.engineFiles} / ui ${map.totals.uiFiles}）` +
      `｜守护源文件 ${map.totals.guardedSources} 个｜反向验证锚点 ${map.totals.reverseVerified} 个`
  );
  console.log('');
  for (const [id, d] of Object.entries(map.domains)) {
    if (d.testCount === 0) continue;
    console.log(`【${id}】${d.label}`);
    console.log(`  测试 ${d.testCount} 个｜源码 ${d.sources.length} 个`);
    console.log(`  ${d.tests.map((t) => path.basename(t)).join(', ')}`);
    console.log('');
  }
  if (map.orphans.length) {
    console.log(`⚠️ 无源码依赖的测试（${map.orphans.length}个，靠运行期行为断言）：`);
    map.orphans.forEach((t) => console.log(`  ${t}`));
  }
}

if (wantCheck) {
  const problems = [];
  // 1) 清单文件不存在 → 未生成过
  if (!existsSync(OUT)) {
    problems.push('docs/capability-map.json 不存在，先跑 --write 生成');
  } else {
    const onDisk = JSON.parse(readFileSync(OUT, 'utf8'));
    // 2) 有新测试文件没登记（漏跑 impact 会误以为「没波及」）
    const known = new Set(Object.keys(onDisk.tests || {}));
    const missing = map.tests ? Object.keys(map.tests).filter((t) => !known.has(t)) : [];
    if (missing.length) problems.push(`未登记的新测试（跑 --write 补）：${missing.join(', ')}`);
    // 3) 有测试被删（说明过往功能的守护被拆掉了 —— 红灯）
    const gone = [...known].filter((t) => !(t in map.tests));
    if (gone.length) problems.push(`测试文件已消失（守护缺失，需说明原因）：${gone.join(', ')}`);
    // 4) 孤寡测试（有测试但不映射任何域 → 永远不会被影响面覆盖）
    const orphanNow = map.orphans || [];
    if (orphanNow.length) problems.push(`无源码依赖、无法参与影响面分析：${orphanNow.join(', ')}`);
  }
  if (problems.length) {
    console.error('\n[capa bility_map --check] ❌ FAIL');
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }
  console.log('\n[capability_map --check] ✅ 能力清单与源码一致');
}