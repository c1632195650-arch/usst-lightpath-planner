#!/usr/bin/env node
/**
 * refactor_run —— 重构偿债批（报告一 D1-D12）的一键驱动器
 * ===================================================================
 * 配套文档（开工前必读）：
 *   · docs/refactor-execution-plan-2026-10-24.md  —— 逐批工作单（R1-R9）
 *   · docs/execution-charter-2026-10-24.md §2     —— commit 规范（本脚本的裁决依据）
 *   · docs/refactor-and-optimization-assessment-2026-10-24.md —— 债务全景（为什么做）
 *
 * 它解决什么：
 *   偿债批的机械部分（闸门→登记→提交）此前靠人肉记忆拼命令，本机还常常没有
 *   git.exe（2026-10-22 起多批登记）。本脚本把每批收尾压成一条命令，并保证：
 *     ① commit message 永远符合章程 §2.1 前缀表（从清单生成，不靠手敲）；
 *     ② 永远 path-scoped add（清单文件 + --extra 白名单，绝不 add -A）；
 *     ③ 无 git 环境不阻塞进度：批次落盘 + 台账登记，白天 `drain` 一键补交；
 *     ④ 门禁红了自动停手 + 自动写 BLOCKERS（章程 §4 变红流程）。
 *
 * 子命令：
 *   node scripts/refactor_run.mjs status                  # 批次全景 + 台账状态
 *   node scripts/refactor_run.mjs start <批id>            # 开工声明（自动登记 BLOCKERS 首条，章程 §6.1/§8）
 *   node scripts/refactor_run.mjs gate <批id> [--extra f] # 只跑门禁不登记（五步）
 *   node scripts/refactor_run.mjs finish <批id> [--extra f]  # 门禁 + 台账登记（绿）/红停手
 *   node scripts/refactor_run.mjs drain [--plan]          # 白天补交：按台账顺序逐批 path-scoped 提交
 *                                                          #   --plan 只打印等价命令块（章程 §7 形态）不执行
 *
 * 设计红线（不可绕过）：
 *   · 只 commit 不 push；不改历史；不删文件（AGENTS.md §8.3）。
 *   · 禁区文件（src/types.ts / data/ 二进制 / evals/golden 既有条目 / *.env）
 *     出现在清单或 --extra 里 → 直接拒绝（章程 §3.1.3）。
 *   · 门禁任一步真红 → 不登记、不提交，自动写 BLOCKERS 停手。
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_REL = 'docs/refactor-ledger-2026-10-24.jsonl';
const LEDGER = path.join(ROOT, LEDGER_REL);
const BLOCKERS = path.join(ROOT, 'BLOCKERS.md');
const PLAN_DOC = 'docs/refactor-execution-plan-2026-10-24.md';

/* ============================================================================
 * 1. 批次清单（单一事实源；执行方案文档 §2 总表与之同源，改这里必须同步文档）
 * ========================================================================== */
export const COMMIT_RE = /^(feat|fix|chore|docs|test|refactor)\([a-z0-9][a-z0-9-]*\): \S.*/; // §0.4-C：原 \S.+ 误拒单字符 subject

export const FORBIDDEN_RE = [
  /^src\/types\.ts$/,   // 契约层（章程 §3.1.3 夜间禁区）
  /^data\//,            // 数据/二进制库
  /^evals\/golden\//,   // golden 既有条目（只增不改）
  /\.env$/,             // 密钥永不入库（AGENTS.md 红线 3）
  /^node_modules\//,
];

export const BATCHES = [
  {
    id: 'r1-d4-build-decouple',
    debt: 'D4', wave: 1, deps: [],
    title: 'APK 暂存目录与 vite 输出解耦（构建不再冲掉安装包）',
    files: ['.gitignore', 'scripts/stage_apk.mjs', 'scripts/apk_stage.test.ts', 'docs/真机走查准备清单-2026-10-06.md'],
    message: {
      subject: 'chore(build): APK 暂存目录与 vite 输出解耦（dist/apk → dist-apk/）',
      body: '依据报告一 D4；BLOCKERS 2026-10-06 实录（npm run build 冲掉 dist/apk 致公网短暂 404）。\n' +
        '新增 scripts/stage_apk.mjs（gradle 产物 → dist-apk/lightpath-<ver>.apk，拒绝写入 dist/）+ 源码锁测试\n' +
        '（scripts 内禁止再出现 dist/apk 写入）+ .gitignore 增 dist-apk/。行为零漂移：不动 vite/serve/引擎。\n' +
        '附带 capability_map.mjs 扫描器补丁：识别仓内相对导入（./x.mjs）——脚本级测试此前被误判孤立、\n' +
        '--check 红、impact 永远漏跑（r4 的互查测试同样受益）。执行批 2026-10-24 接管并行会话遗留的\n' +
        'RV-TEMP 变异并还原，红向 RV 两组实测。',
    },
    crit: 'engine/ui 全绿且不动任何源码行为；新源码锁反向验证（再写 dist/apk 必红）',
    escape: 'dist/apk 旧手工惯例仍可用（仅不被守护），不回滚任何功能',
  },
  {
    id: 'r2-d1a-libao-time-split',
    debt: 'D1批1', wave: 1, deps: [],
    title: 'libaoIntent 拆出时间表达式解析子模块 timeParse.ts（纯搬运）',
    files: ['src/features/libao/libaoIntent.ts', 'src/features/libao/timeParse.ts', 'scripts/libao-time-split.test.ts'],
    message: {
      subject: 'refactor(libao): 拆出时间表达式解析子模块 timeParse.ts（纯搬运零漂移）',
      body: '依据报告一 D1 第一批（约还 30% 对话层债）。搬运集 = WhenHint/TimeWindow/ClockHint 类型 +\n' +
        'extractWhen/Effort/Frequency/Window/ClockRange/Target/TargetWhen/ReplanDays + clockChannelOn +\n' +
        'termAnchorsFrom/resolveWhen/spanDurationMin 及其私有助手；libaoIntent.ts 原名 re-export，\n' +
        'import 面零变化。零漂移证明：scripts/libao-intent-* 全套存量断言逐条绿；\n' +
        '新增 re-export 同一性源码锁（RV：删任一 re-export → 恰红）。',
    },
    crit: 'libao-intent-* 与 libaoIntent 全套存量断言逐条绿；re-export 同一性锁反向验证',
    escape: '整批为文件级搬运，git revert 单笔即回到拆分前',
  },
  {
    id: 'r3-d9-snapshot-refresh',
    debt: 'D9', wave: 1, deps: [],
    title: 'AGENTS.md §〇 快照刷新至 2026-10-24 口径 + 测试目录语义说明（D5 文档半）',
    files: ['AGENTS.md', 'docs/progress-status.md', 'tests/README.md'],
    message: {
      subject: 'docs(governance): AGENTS.md §〇 快照刷新至 2026-10-24（D9）',
      body: '数字全部取自门禁实跑（tsc 0 / engine·ui 实测值 / capability-map 统计 / 版本 0.4.10 /\n' +
        '服务器 43.142.141.186），不写估算值。tests/README 补测试目录语义（tests/=engine、\n' +
        'scripts/*.test.ts=ui，D5 渐进归位口径：存量 glob 不动，新测试进语义目录）。',
    },
    crit: '纯 docs：零源码改动，typecheck 双绿即可',
    escape: 'git revert 单笔文档提交',
  },
  {
    id: 'r4-d6-serve-positioning',
    debt: 'D6', wave: 1, deps: [],
    title: 'serve.py 定位声明 + 后端地址三处一致性互查（r4 recon 修正：真漂移是 IP 不是 CORS）',
    files: ['serve.py', 'scripts/check_backend_consistency.mjs', 'scripts/backend_consistency.test.ts'],
    message: {
      subject: 'chore(server): serve.py 定位声明（本地一体化，生产以 server/ 为准）+ 后端地址三处一致性互查',
      body: '依据报告一 D6（recon 修正：真漂移点是后端地址而非 CORS——serve.py 同源无白名单）：\n' +
        'serve.py 钉定位（本地一体化，生产行为以 server/ 为准）+ CY_API_TARGET 对齐迁机新机\n' +
        '43.142.141.186（10-22 迁移漏改，旧机 10-25 到期后本地梨宝脑转发即死链）。\n' +
        'check_backend_consistency.mjs 互查三处硬编码后端地址（CY_API_TARGET ↔ apiBase\n' +
        'INLINE_API_FALLBACK ↔ version.json apkUrl），漂移 exit 1；fixture 双向 + 真文件 RV。\n' +
        '合并两后端属 L2，决赛后随框架线再议。',
    },
    crit: '互查脚本对当前两文件 PASS；fixture 反向验证红；serve.py 仅增注释零行为改动',
    escape: '互查脚本是新增告警器，摘掉不影响任何运行行为',
  },
  {
    id: 'r5-d2-week-edit-extract',
    debt: 'D2', wave: 1, deps: [],
    title: 'WeekPlanView 编辑动作与撤销栈下沉 weekEditActions.ts（行为不变）',
    files: ['src/features/week/WeekPlanView.tsx', 'src/features/week/weekEditActions.ts', 'scripts/weekEditActions.test.ts'],
    message: {
      subject: 'refactor(week): 编辑动作与撤销栈下沉出 WeekPlanView（行为不变，D2）',
      body: '依据报告一 D2：沿 weekViewModel 既有方向继续下沉，只搬运不改写；不做视觉层重写\n' +
        '（week-view-design.md 令牌体系刚收敛）。本批下沉撤销/重做/删除回执/键盘绑定编排簇\n' +
        '（useWeekEditActions + 纯函数 weekKeyToAction，WeekPlanView 1341→1309 行）；删除-重排\n' +
        '动作组依赖本地状态闭包较多，留待 wave2 前再评估，不在本批强行搬。\n' +
        '守护：planLock/userPlanStore/rollingState 存量断言 + 离线 E2E 77 断言（白天人工窗）+\n' +
        '新增键盘映射/文案口径/接线锁（RV 三组实测：删 y 分支、改文案、视图内联回潮均恰红）。',
    },
    crit: '存量周视图断言全绿 + E2E 77 断言离线复跑零漂移（白天窗）',
    escape: 'git revert 单笔；weekViewModel 路线既有先例',
  },
  {
    id: 'r6-d3-route-table',
    debt: 'D3', wave: 1, deps: [],
    title: 'App 壳动线收敛为显式动线表（startPersonaOrOnboarding 思路推广全站）',
    files: ['src/App.tsx', 'src/appFlow.ts', 'tests/v3.test.ts'],
    message: {
      subject: 'refactor(app): 动线收敛为显式动线表（view 路由行为不变，D3）',
      body: '依据报告一 D3：把「页面 + 进入条件」收敛成 appFlow.ts 一张表，App.tsx 只做分发；\n' +
        '2026-10-08「绕过课表导入」修复的思路推广到全站，不动 UI。\n' +
        '守护：tests/v3.test.ts 既有动线锁全绿 + 新增表驱动动线锁（无真实课表/无基本信息两条\n' +
        '入口的落点断言，RV：表改错必红）。',
    },
    crit: 'v3 动线锁全绿；新表驱动锁反向验证',
    escape: 'git revert 单笔；动线语义逐条对照旧 if 链',
  },
  {
    id: 'r7-d7-storage-gateway',
    debt: 'D7', wave: 1, deps: [],
    title: '存储网关：统一 loadState/saveState 入口 + 迁移登记表（老键照读）',
    files: ['src/lib/storage.ts', 'src/lib/storageGateway.ts', 'scripts/storageGateway.test.ts'],
    message: {
      subject: 'refactor(storage): 存储网关统一入口 + 迁移登记表（老键照读，D7）',
      body: '依据报告一 D7：新增 storageGateway（key→{version,migrate} 登记表 + 可注入 store 的纯核），\n' +
        '新 feature 一律走网关；storage.ts 既有行为逐字节不变（存量测试零改动全绿）。\n' +
        '后续契约升级（schemaVer 3、4…）只改登记表一处。纯核设计使网关可在 node:test 下直测。',
    },
    crit: 'storage.test.ts 存量 8 断言零改动全绿；网关注册表 round-trip + RV',
    escape: '网关是新增层，无人调用即零副作用',
  },
  {
    id: 'r8-d1b-chat-ui-split',
    debt: 'D1后续', wave: 2, deps: ['r2-d1a-libao-time-split'],
    title: 'LbaoChat 拆分：UI 组件（消息流/按钮卡/反馈条）与编排 hook 分离',
    files: ['src/features/libao/LbaoChat.tsx'],
    message: {
      subject: 'refactor(libao): LbaoChat UI 组件与编排 hook 分离（D1 后续批，纯搬运）',
      body: '依据报告一 D1 路线 A 第二步。chatParts/ 新目录承接按钮卡/反馈条/评估入口等展示组件，\n' +
        'LbaoChat 保留编排。开工前先跑工作单内 recon 步骤列函数清单；只搬运不改写。\n' +
        '守护：libao-interact / chatRestore / libao-copy-guard 存量断言 + 新增 chatParts 源码锁。',
    },
    crit: '梨宝线存量断言全绿；E2E 梨宝剧本离线复跑零漂移（白天窗）',
    escape: 'git revert 单笔',
  },
  {
    id: 'r9-d1b-weekforchat-split',
    debt: 'D1后续', wave: 2, deps: ['r2-d1a-libao-time-split'],
    title: 'weekPlanForChat 拆分：话术生成（verdict/描述族）与引擎调用分离',
    files: ['src/features/libao/weekPlanForChat.ts', 'src/features/libao/chatVerdict.ts'],
    message: {
      subject: 'refactor(libao): weekPlanForChat 话术生成与引擎调用分离（D1 后续批，纯搬运）',
      body: '依据报告一 D1 路线 A 第三步。describeVerdict/summarizeWeekPlan/quickOptionsFor 等\n' +
        '话术族迁 chatVerdict.ts（不 import planner），weekPlanForChat 保留引擎调用并 re-export。\n' +
        '接缝红线不变：features/libao 禁直 import @/lib/planner，唯一例外仍是本文件（AGENTS §三.6）。\n' +
        '守护：lbaoPlan / schedSession / day-replan 存量断言 + re-export 同一性锁。',
    },
    crit: '排程对话存量断言全绿；接缝红线源码锁复验',
    escape: 'git revert 单笔',
  },
];

/* ============================================================================
 * 2. 纯函数区（供 scripts/refactor_run.test.ts 直测）
 * ========================================================================== */
export function forbiddenHit(p) {
  const norm = String(p).replace(/\\/g, '/');
  return FORBIDDEN_RE.find((re) => re.test(norm)) || null;
}

export function getBatch(id) {
  return BATCHES.find((b) => b.id === id) || null;
}

/** 清单自检：id 唯一、message 合章程、文件非空且零禁区、deps 可解析。 */
export function validateManifest() {
  const errs = [];
  const ids = new Set();
  for (const b of BATCHES) {
    if (ids.has(b.id)) errs.push(`批 id 重复：${b.id}`);
    ids.add(b.id);
    if (!COMMIT_RE.test(b.message.subject)) errs.push(`${b.id}: subject 不合章程 §2.1 前缀表 → ${b.message.subject}`);
    if (!b.files || b.files.length === 0) errs.push(`${b.id}: files 为空（path-scoped add 无从谈起）`);
    for (const f of b.files || []) {
      const hit = forbiddenHit(f);
      if (hit) errs.push(`${b.id}: 清单含禁区文件 ${f}（命中 ${hit}）`);
    }
    for (const d of b.deps || []) if (!ids.has(d) && !BATCHES.some((x) => x.id === d)) errs.push(`${b.id}: deps 指向不存在的批 ${d}`);
  }
  return errs;
}

/** 台账：一行一事件（JSONL），parse 容忍空行与坏行（坏行跳过并计数，不让脏数据炸掉 drain）。 */
export function parseLedger(text) {
  const events = [];
  let bad = 0;
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t)); } catch { bad += 1; }
  }
  return { events, bad };
}

/** 已提交集合：committed 事件的 batch id。 */
export function committedIds(events) {
  return new Set(events.filter((e) => e && e.type === 'committed').map((e) => e.batch));
}

/** 待补交批次：门禁绿（finished/green）且尚无 committed 事件，按清单顺序返回。 */
export function pendingBatches(events) {
  const done = committedIds(events);
  const green = new Set(
    events.filter((e) => e && e.type === 'finished' && e.verdict === 'GREEN').map((e) => e.batch)
  );
  return BATCHES.filter((b) => green.has(b.id) && !done.has(b.id));
}

/** drain 计划：待补交批次 → [{batch, files, subject, body}]（files 取 finished 事件里登记的实际清单）。 */
export function buildDrainPlan(events) {
  const lastFinish = {};
  for (const e of events) if (e && e.type === 'finished') lastFinish[e.batch] = e;
  return pendingBatches(events).map((b) => ({
    batch: b.id,
    files: lastFinish[b.id]?.files?.length ? lastFinish[b.id].files : b.files,
    subject: b.message.subject,
    body: b.message.body,
  }));
}

/** 开工声明行（章程 §6.1/§8 模板，追加进 BLOCKERS.md）。 */
export function kickoffLine(b, ts) {
  const files = b.files.join('、');
  return `- [${ts} ${b.id}·开工声明] 工作单=${PLAN_DOC}（${b.debt} ${b.title}）｜界限=${files}` +
    `｜零回归=${b.crit}｜逃生=${b.escape}｜收尾=node scripts/refactor_run.mjs finish ${b.id}`;
}

/** 门禁红停手行（自动登记，不用人肉拼）。 */
export function blockedLine(b, ts, stepName, tail) {
  const oneLine = String(tail || '').split('\n').filter(Boolean).slice(-1)[0] || '(无输出)';
  return `- [${ts} ${b.id}·门禁红停手] 阻塞点：${stepName} 红（${oneLine.slice(0, 160)}）｜已排除：驱动器自动登记，` +
    `未提交未改断言｜需要人决定：按 ${PLAN_DOC} §1 变红流程处理（禁改测试换绿）`;
}

/* ============================================================================
 * 3. 环境与执行区
 * ========================================================================== */
const GIT_CANDIDATES = [
  ...(process.env.GIT_BIN ? [process.env.GIT_BIN] : []),
  'git',
  // 2026-10-24 实况：PortableGit 升级到 1.3.0（1.2.0 目录在 .deleting 残留中），
  // 注册表 PATH 仍指旧版 → 两个版本号都列上，外加 current 软链位防再漂移。
  'C:/Users/CY/.workbuddy/binaries/PortableGit/versions/1.3.0/cmd/git.exe',
  'C:/Users/CY/.workbuddy/binaries/PortableGit/current/cmd/git.exe',
  'C:/Users/CY/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd/git.exe',
  'C:/Program Files/Git/cmd/git.exe',
];

let _gitBin = undefined; // undefined=未探测；null=不可用；string=可执行路径
export function gitBin() {
  if (_gitBin !== undefined) return _gitBin;
  for (const bin of GIT_CANDIDATES) {
    const r = spawnSync(bin, ['rev-parse', '--git-dir'], { cwd: ROOT, encoding: 'utf8' });
    if (!r.error && r.status === 0) { _gitBin = bin; return bin; }
  }
  _gitBin = null;
  return null;
}

function runStep(name, cmd, args, opts = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, shell: opts.shell === true, timeout: opts.timeout || 600_000,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const envBlocked = Boolean(r.error) && /ENOENT|EBUSY|EPERM|not permitted/i.test(String(r.error?.message || ''));
  const ok = r.status === 0;
  return {
    name, ok, code: r.status, envBlocked,
    ms: Date.now() - t0,
    tail: out.split('\n').filter(Boolean).slice(-6).join('\n'),
    out,
  };
}

/** §0.4-A：gate_overnight 的红是否"仅禁区且属环境原因"（git status 读不到 ≠ 禁区真被改动）。 */
function gateOvernightOnlyEnvRed(out) {
  const text = String(out || '');
  const m = text.match(/结果：\d+ 条未过 → (.+)/);
  if (!m) return false;
  const names = m[1].split(/[,，]\s*/).map((x) => x.trim());
  return names.length > 0 && names.every((n) => n === '禁区文件') &&
    /无法读取 git 状态|未能判定|环境不可用/.test(text);
}

/** 五步门禁（章程 §2.5 的机器化：typecheck → impact(本批文件) → engine → ui → gate_overnight 汇总）。 */
function runGates(batch, files) {
  const steps = [];
  steps.push(runStep('typecheck', 'npm', ['run', '--silent', 'typecheck'], { shell: true }));
  steps.push(runStep('impact', process.execPath, ['scripts/impact.mjs', '--files', files.join(',')]));
  steps.push(runStep('test:engine', 'npm', ['run', '--silent', 'test:engine'], { shell: true, timeout: 900_000 }));
  steps.push(runStep('test:ui', 'npm', ['run', '--silent', 'test:ui'], { shell: true, timeout: 900_000 }));
  steps.push(runStep('gate_overnight', process.execPath, ['scripts/gate_overnight.mjs'], { timeout: 900_000 }));
  // §0.4-A（2026-10-24 执行批套用）：gate_overnight 唯一红项是「禁区文件」且属环境原因
  //（本机无 git 读不到 status）时降 WARN——章程 §4「等价人工复核」先例；
  // 禁区**真的被改动**（detail="禁区文件被改动"）或其他门真红仍按 FAIL 拦。
  for (const s of steps) {
    if (s.name === 'gate_overnight' && !s.ok && gateOvernightOnlyEnvRed(s.out)) s.envBlocked = true;
  }
  const red = steps.filter((s) => !s.ok && !s.envBlocked);
  return { steps, verdict: red.length === 0 ? 'GREEN' : 'RED', red };
}

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function loadEvents() {
  if (!existsSync(LEDGER)) return { events: [], bad: 0 };
  return parseLedger(readFileSync(LEDGER, 'utf8'));
}

function appendEvent(ev) {
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, JSON.stringify(ev) + '\n', 'utf8');
}

function appendBlockers(line) {
  appendFileSync(BLOCKERS, `\n${line}\n`, 'utf8');
}

/** 批次实际文件清单 = 清单 files + --extra（逐个过禁区闸）。 */
function resolveFiles(batch, extra) {
  const files = [...batch.files, ...(extra || [])].map((f) => f.replace(/\\/g, '/'));
  const errs = [];
  for (const f of files) {
    const hit = forbiddenHit(f);
    if (hit) errs.push(`禁区文件拒绝：${f}（章程 §3.1.3，命中 ${hit}）`);
  }
  const seen = new Set();
  const dedup = files.filter((f) => (seen.has(f) ? false : (seen.add(f), true)));
  for (const f of dedup) {
    const abs = path.join(ROOT, f);
    if (!existsSync(abs)) errs.push(`文件不存在（工作单步骤未做完？）：${f}`);
  }
  return { files: dedup, errs };
}

/* ============================================================================
 * 4. 子命令
 * ========================================================================== */
function cmdStatus() {
  const { events, bad } = loadEvents();
  const done = committedIds(events);
  const started = new Set(events.filter((e) => e.type === 'started').map((e) => e.batch));
  const g = gitBin();
  let branch = '(读不到)';
  try { branch = readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim().replace('ref: refs/heads/', ''); } catch { /* 无 .git 时保持占位 */ }
  console.log(`\n============ 重构偿债批 · 全景 ============`);
  console.log(`git 可用：${g ? '✅ ' + g : '❌（无 git 环境 → finish 走台账登记，白天 drain 补交）'}　分支：${branch}`);
  console.log(`台账：${LEDGER_REL}${existsSync(LEDGER) ? '' : '（尚未创建）'}${bad ? `　⚠️ ${bad} 行坏数据已跳过` : ''}\n`);
  for (const b of BATCHES) {
    const state = done.has(b.id) ? '✅ 已提交' : events.some((e) => e.type === 'finished' && e.batch === b.id) ? '🟡 待补交' : started.has(b.id) ? '🔵 已开工' : '⚪ 未开始';
    console.log(`  ${state.padEnd(8)} wave${b.wave}  ${b.id.padEnd(26)} ${b.debt.padEnd(4)} ${b.title}`);
  }
  console.log(`\n顺序建议：wave1 按 r1→r7；wave2（决赛后）r8/r9（依赖 r2）。\n`);
}

function cmdStart(id) {
  const b = getBatch(id);
  if (!b) return fail(`未知批 id：${id}（status 查看全表）`);
  const ts = now();
  appendBlockers(kickoffLine(b, ts));
  appendEvent({ type: 'started', batch: b.id, ts });
  console.log(`✅ 已登记开工声明（BLOCKERS.md + 台账）。接下来按 ${PLAN_DOC} 工作单改代码，完成后：`);
  console.log(`   node scripts/refactor_run.mjs finish ${b.id} [--extra <本批追加的文件>...]`);
}

function cmdGate(id, extra) {
  const b = getBatch(id);
  if (!b) return fail(`未知批 id：${id}`);
  const { files, errs } = resolveFiles(b, extra);
  if (errs.length) return fail(errs.join('\n'));
  const { steps, verdict, red } = runGates(b, files);
  printGates(b.id, steps, verdict);
  return verdict === 'GREEN' ? 0 : (console.log(`红项：${red.map((r) => r.name).join(', ')}`), 1);
}

function cmdFinish(id, extra) {
  const b = getBatch(id);
  if (!b) return fail(`未知批 id：${id}`);
  const { files, errs } = resolveFiles(b, extra);
  if (errs.length) return fail(errs.join('\n'));
  const ts = now();
  const { steps, verdict, red } = runGates(b, files);
  printGates(b.id, steps, verdict);
  appendEvent({ type: 'finished', batch: b.id, ts, verdict, files, message: b.message, gates: steps.map(({ name, ok, code, envBlocked, ms }) => ({ name, ok, code, envBlocked, ms })) });
  if (verdict === 'RED') {
    appendBlockers(blockedLine(b, ts, red[0].name, red[0].tail));
    console.log(`🔴 门禁红：已登记台账（verdict=RED，不计入待补交）并自动写 BLOCKERS 停手。`);
    console.log(`   处理顺序：修实现 → 复跑 finish；修不动 → 保持 BLOCKERS 登记，交 CY。禁止改断言换绿。`);
    return 1;
  }
  const g = gitBin();
  if (g) {
    console.log(`\ngit 可用 → 直接提交（path-scoped）：`);
    const add = spawnSync(g, ['add', '--', ...files], { cwd: ROOT, encoding: 'utf8' });
    if (add.status !== 0) return fail(`git add 失败：${add.stderr || add.stdout}`);
    const cm = spawnSync(g, ['commit', '-m', b.message.subject, '-m', b.message.body], { cwd: ROOT, encoding: 'utf8' });
    if (cm.status !== 0) return fail(`git commit 失败：${cm.stderr || cm.stdout}`);
    const sha = spawnSync(g, ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
    appendEvent({ type: 'committed', batch: b.id, ts, sha, mode: 'direct' });
    console.log(`✅ 已提交 ${sha}：${b.message.subject}`);
    console.log(`   （只 commit 不 push —— push 属白天人工动作，AGENTS.md §8.3）`);
  } else {
    console.log(`\n🟡 本机无 git：已登记台账（GREEN，待补交）。白天在有 git 的终端跑：`);
    console.log(`   node scripts/refactor_run.mjs drain        # 逐批 path-scoped 提交`);
    console.log(`   node scripts/refactor_run.mjs drain --plan # 或先打印等价命令块人工执行`);
  }
  return 0;
}

function cmdDrain(planOnly) {
  const { events } = loadEvents();
  const plan = buildDrainPlan(events);
  if (!plan.length) return console.log('台账里没有待补交批次（GREEN 且未提交）。'), 0;
  const g = planOnly ? 'plan' : gitBin();
  if (!planOnly && !g) return fail('drain 需要 git：在有 git 的终端跑（或先 --plan 看命令块）');
  if (planOnly) console.log(`# ==== drain 等价命令块（${plan.length} 批；逐批执行，禁止 add -A）====`);
  for (const p of plan) {
    if (planOnly) {
      console.log(`\n# ${p.batch}`);
      console.log(`git add -- ${p.files.map((f) => JSON.stringify(f)).join(' \\\n        ')}`);
      console.log(`git commit -m ${JSON.stringify(p.subject)} -m ${JSON.stringify(p.body)}`);
      continue;
    }
    const st = spawnSync(g, ['status', '--porcelain', ...p.files], { cwd: ROOT, encoding: 'utf8' });
    if ((st.stdout || '').trim() === '') {
      console.log(`⏭️  ${p.batch}：清单文件在 git status 里无差异（疑似已入库），跳过——请人工核对`);
      continue;
    }
    const add = spawnSync(g, ['add', '--', ...p.files], { cwd: ROOT, encoding: 'utf8' });
    if (add.status !== 0) { console.log(`⛔ ${p.batch} git add 失败：${add.stderr}`); break; }
    const cm = spawnSync(g, ['commit', '-m', p.subject, '-m', p.body], { cwd: ROOT, encoding: 'utf8' });
    if (cm.status !== 0) { console.log(`⛔ ${p.batch} git commit 失败：${cm.stderr}`); break; }
    const sha = spawnSync(g, ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
    appendEvent({ type: 'committed', batch: p.batch, ts: now(), sha, mode: 'drain' });
    console.log(`✅ ${p.batch} → ${sha} ${p.subject}`);
  }
  if (!planOnly) console.log(`\n补交完成。push 属白天人工动作：git push origin beta-v2（AGENTS.md §8.3 / 章程 §2.3）`);
  return 0;
}

/* ============================================================================
 * 5. CLI 外壳
 * ========================================================================== */
function printGates(id, steps, verdict) {
  console.log(`\n========= gate ${id} → ${verdict} =========`);
  for (const s of steps) {
    const tag = s.ok ? 'PASS' : s.envBlocked ? 'WARN' : 'FAIL';
    console.log(`  ${tag}  ${s.name.padEnd(14)} ${((s.ms / 1000) | 0)}s`);
  }
  console.log('='.repeat(40));
}

function fail(msg) { console.error(`[refactor_run] ❌ ${msg}`); process.exit(1); }

function main() {
  const mErrs = validateManifest();
  if (mErrs.length) { console.error('[refactor_run] 批次清单自检失败（改清单必须同步执行方案文档 §2）：\n' + mErrs.map((e) => '  · ' + e).join('\n')); process.exit(1); }
  const [cmd, id, ...rest] = process.argv.slice(2);
  const extraIdx = rest.indexOf('--extra');
  const extra = extraIdx >= 0 ? rest.slice(extraIdx + 1).filter((x) => x && !x.startsWith('--')) : [];
  switch (cmd) {
    case 'status': return cmdStatus();
    case 'start': return id ? cmdStart(id) : fail('用法：start <批id>');
    case 'gate': return id ? cmdGate(id, extra) : fail('用法：gate <批id> [--extra 文件...]');
    case 'finish': return id ? cmdFinish(id, extra) : fail('用法：finish <批id> [--extra 文件...]');
    case 'drain': return cmdDrain(process.argv.includes('--plan'));
    default:
      console.log('用法：node scripts/refactor_run.mjs status | start <批id> | gate <批id> | finish <批id> [--extra 文件...] | drain [--plan]\n' +
        '文档：' + PLAN_DOC);
      return 0;
  }
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
// §0.4-B：退出码必须反映门禁结论（此前 main() 返回值被丢弃，RED 也 exit 0，&& 串联会放行红门禁）
if (invoked) {
  const code = main();
  if (typeof code === 'number' && code !== 0) process.exit(code);
}
