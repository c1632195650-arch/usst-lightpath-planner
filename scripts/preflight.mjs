#!/usr/bin/env node
/**
 * preflight —— 开工闸门：**动代码之前**先证明你站在最新版本上。
 * ===================================================================
 * 解决的真问题（2026-10-06）
 * -------------------------------------------------------------------
 * 现象：agent 老是在「CY 自己本地推进的进度上继续往前加补」，
 *      已经 clone 了队友全部推送，还是照着旧版本补。
 * 根因（实测确认，非猜测）：
 *      git merge-base HEAD origin/dev → 空
 *      本地 beta-v2 与 origin/dev 是 **unrelated histories**（零共同祖先），
 *      本地领先 132+ commit 且从未 push。
 *      → agent 无论怎么 pull，拿到的都是 150 个 commit 之前的另一条历史，
 *        它**物理上看不到**本地已有的功能，只能凭印象重建 → 于是「重复造轮子」。
 *
 * 本脚本把这三件事变成**机器判定**，不再依赖 agent 自觉：
 *   ① 你在哪个工作树 / 哪个分支、HEAD 是哪个 commit
 *   ② 与远端是否共享祖先（unrelated →直接 FAIL，给出唯一正确出路）
 *   ③ 工作区是否干净（有未提交改动 → 提示先commit/备份）
 *   ④ 本地是否落后远端（behind > 0 → 必须先 fetch+对齐）
 *
 * 设计原则（重要）：
 *   **只做「检测 + 指引」，不做「自动拉取/自动切换」。**
 *   因为本项目三树未合流、unrelated histories，自动 merge 曾经静默丢过工作。
 *   这里宁可拦住，也不猜。
 *
 * 用法：
 *   node scripts/preflight.mjs            # 检查并打印报告
 *   node scripts/preflight.mjs --json# 机器可读（给 agent 解析）
 *   node scripts/preflight.mjs --allow-dirty   # 明确允许带着未提交改动开工
 *
 * 退出码：0 = 可以开工；1 = 有硬阻塞，按报告里的指引处理后再来
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const allowDirty = argv.includes('--allow-dirty');

/* ============================================================================
 * 为什么用「直读 .git」而不是 spawnSync('git', ...)
 * ----------------------------------------------------------------------------
 * 本项目实测：在 WorkBuddy沙箱里，Node 启动任何子进程都被拦——
 *   spawnSync('git', ...)   → EBUSY
 *   spawnSync(..., {shell})  → EBUSY（连 cmd.exe 也起不来）
 * 记忆里记的 gate_overnight 撞过同一个坑（BLOCKERS 2026-09-28 有留痕）。
 * 这意味着**任何依赖子进程的门禁在 agent 环境里都是假跑**。
 *
 * 所以这里不 spawn git，改为直接读 .git 目录：
 *   .git/HEAD            → 当前分支
 *   .git/refs/heads/*    → 本地分支 tip（松散引用）
 *   .git/packed-refs     → 打包引用（分支多时会打包，必须一起读）
 *   .git/FETCH_HEAD      → 最近一次 fetch 的远端 commit
 * 这样在沙箱内外行为一致，且零依赖、零网络。
 *
 * 局限（如实说明，不假装能做全）：
 *   - 不做 fetch（无法判断远端**此刻**是否有新提交）
 *   - 不算 ahead/behind 的拓扑差（那需要提交图遍历）
 *   → 这些交给「有子进程权限时」的 git 路径，或交人判断。
 *   本脚本的价值在于：**在沙箱里也能确定地检出 unrelated histories 与脏工作区**，
 *   这正是本项目当前最要命的那一类问题。
 * ========================================================================== */

const GITDIR = path.join(ROOT, '.git');

/** 读一个 ref 的 sha：先松散 refs，再 packed-refs。 */
function readRef(refName) {
  const loose = path.join(GITDIR, ...refName.split('/'));
  if (existsSync(loose)) {
    const v = readFileSync(loose, 'utf8').trim();
    return v.startsWith('ref:') ? null : v; // 符号引用再解析一层
  }
  const packed = path.join(GITDIR, 'packed-refs');
  if (existsSync(packed)) {
    for (const line of readFileSync(packed, 'utf8').split('\n')) {
      const l = line.trim();
      if (!l || l.startsWith('#') || l.startsWith('^')) continue;
      const [sha, name] = l.split(/\s+/, 2);
      if (name === refName) return sha;
    }
  }
  return null;
}

/** 解析可能带两层符号引用的 HEAD。 */
function resolveHead() {
  const headPath = path.join(GITDIR, 'HEAD');
  if (!existsSync(headPath)) return { branch: null, sha: null };
  const raw = readFileSync(headPath, 'utf8').trim();
  if (!raw.startsWith('ref:')) return { branch: '(detached)', sha: raw };
  const ref = raw.slice(4).trim();
  return { branch: ref.replace('refs/heads/', ''), sha: readRef(ref) };
}

/** 提交对象是否真实存在于本地 object库 —— 用于判定「这条历史我本地到底有没有」。 */
function objectExists(sha) {
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) return false;
  return existsSync(path.join(GITDIR, 'objects', sha.slice(0, 2), sha.slice(2)));
}

/** 从 FETCH_HEAD 解析远端分支 → sha。 */
function readFetchHead() {
  const p = path.join(GITDIR, 'FETCH_HEAD');
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([0-9a-f]{40})\s+.*?branch\s+'([^']+)'/);
    if (m) out['origin/' + m[2]] = m[1];
  }
  return out;
}

/** 需要真实 git 时才走子进程；不可用则返回 null（而不是假装成功）。 */
function git(args, opts = {}) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });
  if (r.error || r.status === null) return { ok: false, out: '', err: r.error?.message ?? 'status=null' };
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const gitUsable = (() => { try { return git(['rev-parse', '--git-dir']).ok; } catch { return false; } })();

function numOf(s) {
  const n = Number(String(s || '').trim());
  return Number.isFinite(n) ? n : null;
}

const report = {
  root: ROOT,
  gitUsable,
  branch: null,
  head: null,
  headShort: null,
  headDate: null,
  headSubject: null,
  dirtyFiles: [],
  isGitRepo: false,
  remote: null,
  baseBranch: null,
  remoteBranchExists: false,
  ahead: null,
  behind: null,
  sharesAncestor: null,
  blocks: [],
  warnings: [],
  hints: [],
};

// ---- 0. 是否 git 仓库 ----
if (!existsSync(GITDIR)) {
  report.blocks.push({
    code: 'NOT_A_REPO',
    msg: `当前目录不是 git 仓库：${ROOT}`,
    fix: `cd 到主力开发树 _work_dev 再跑；不要在上层「学术部」目录 git init（.gitignore 的 _* 会把整棵树忽略掉）。`,
  });
} else {
  report.isGitRepo = true;
  const head = resolveHead();
  report.branch = head.branch;
  report.head = head.sha;
  report.headShort = head.sha ? head.sha.slice(0, 7) : null;

  // ---- 1. 工作区是否干净 ----
  const st = git(['status', '--porcelain']);
  if (st.ok) {
    const lines = st.out.split('\n').filter((l) => l.trim());
    report.dirtyFiles = lines.map((l) => l.slice(3).trim().replace(/^"|"$/g, ''));
    if (lines.length && !allowDirty) {
      report.warnings.push({
        code: 'DIRTY',
        msg: `工作区有 ${lines.length} 个未提交改动。`,
        detail: lines.slice(0, 15).join('\n           '),
        fix: '建议先 commit（保住可回滚点）；确实要带着脏改动开工请加 --allow-dirty。',
      });
    }
  } else if (!gitUsable) {
    report.warnings.push({
      code: 'STATUS_UNAVAILABLE',
      msg: '当前环境无法调用 git 子进程（沙箱 EBUSY），工作区脏度未检查。',
      detail: '这是环境限制，不是仓库问题；有子进程权限的环境会正常检出。',
    });
  } else {
    report.blocks.push({ code: 'GIT_STATUS_FAIL', msg: `读不到 git status：${st.err}`, fix: '检查沙箱是否禁用了 git 子进程。' });
  }

  // ---- 2. 远端基线对比 ----
  const fetchHead = readFetchHead();
  report.remote = 'origin';
  report.fetchHeadAt = (() => {
    try { return readFileSync(path.join(GITDIR, 'FETCH_HEAD'), 'utf8').trim().split('\n')[0]?.split(/\s+/)[1] ?? null; } catch { return null; }
  })();

  // 基线分支：优先 dev，回落 main（与项目分支模型一致）
  let baseSha = null;
  for (const cand of ['origin/dev', 'origin/main']) {
    const sha = readRef(`refs/remotes/${cand}`) ?? fetchHead[cand];
    if (sha) { baseSha = sha; report.baseBranch = cand; break; }
  }

  if (!baseSha) {
    report.warnings.push({
      code: 'NO_BASE',
      msg: '找不到远端基线分支（refs/remotes/origin/dev、origin/main 都没有）。',
      fix: '跑 git fetch origin 更新引用；或确认远端是否已配置。',
    });
  } else {
    report.remoteBranchExists = true;

    // 有子进程权限时先 fetch，让对比反映远端此刻状态；失败只警告不阻塞（网络/凭据问题不该拦住本地开工）
    if (gitUsable) {
      const fetch = git(['fetch', '--quiet', 'origin'], { timeout: 120000 });
      if (!fetch.ok) {
        report.warnings.push({
          code: 'FETCH_FAIL',
          msg: `fetch 失败（${fetch.err || '网络/凭据问题'}），与远端的对比基于上次 fetch 的引用，可能过期。`,
          fix: '本机出网需代理：git config --global http.proxy http://127.0.0.1:7890；\n           若卡在凭据prompt，设 GIT_TERMINAL_PROMPT=0 后重试。',
        });
        // fetch 失败时重读一次引用（refs 可能已更新）
        baseSha = readRef(`refs/remotes/${report.baseBranch}`) ?? fetchHead[report.baseBranch] ?? baseSha;
      }
    }

    if (gitUsable) {
      // 有子进程权限 →拿最精确的答案（含拓扑差）
      const mb = git(['merge-base', 'HEAD', report.baseBranch]);
      report.sharesAncestor = mb.ok && Boolean(mb.out) ? true : mb.ok ? false : null;
      report.ahead = numOf(git(['rev-list', '--count', `${report.baseBranch}..HEAD`]).out);
      report.behind = numOf(git(['rev-list', '--count', `HEAD..${report.baseBranch}`]).out);
      report.headDate = git(['log', '-1', '--format=%ci']).out || report.headDate;
      report.headSubject = git(['log', '-1', '--format=%s']).out || report.headSubject;
    } else {
      // 无子进程权限 → 用「对象是否存在于本地」+ 「远端 tip 是否是自己祖先」做保守判定。
      // 已知本项目两条历史零共同祖先，这里退化为提示：本地是否有远端那条历史的任何对象。
      report.sharesAncestor = null;
      report.ahead = null;
      report.behind = null;
      const localHasRemoteTip = objectExists(baseSha);
      report.remoteTipPresentLocally = localHasRemoteTip;
      if (!localHasRemoteTip) {
        report.hints.push(
          `远端 ${report.baseBranch} 的 tip（${baseSha.slice(0, 7)}）在本仓库里不存在任何对象` +
          `→ 两条历史确实彼此独立（unrelated histories）。这是「agent 看不到本地进度」的根因。`
        );
      }
    }

    // ---- 🔴 硬阻塞判定 ----
    if (report.sharesAncestor === false) {
      report.blocks.push({
        code: 'UNRELATED_HISTORIES',
        msg: `本地 HEAD 与 ${report.baseBranch} **没有共同祖先**（unrelated histories）。`,
        detail:
          `本地领先 ${report.ahead ?? '?'} commit、落后 ${report.behind ?? '?'} commit。\n`+
          `           「拉取远端」和「你本地的进度」在 git 眼里是两条互不相干的历史——\n`+
          `           任何 agent clone 仓库后都看不到你本地的功能，只能凭猜测重建，这正是重复造轮子的根因。`,
        fix:
          `唯一正确出路（人工做一次，agent 不得自动执行）：\n`+
          `  1) 把本地进度推到远端新分支：git push origin HEAD:refs/heads/<新分支名>\n`+
          `  2) 由 CY 人工评审后合并到 dev（合并本身是决策题，见 BLOCKERS.md）\n`+
          `  3) 之后 fetch 即可对齐，agent 才可能「站在最新版本上」。\n`+
          `  ⚠️ agent 禁止自行 push / 自行 merge —— 曾因自动合流静默丢过工作。`,
      });
    } else if (report.sharesAncestor === null && report.remoteTipPresentLocally === false) {
      report.blocks.push({
        code: 'UNRELATED_HISTORIES',
        msg: `本地仓库不含 ${report.baseBranch} 的任何对象——两条历史彼此独立（unrelated histories）。`,
        detail:
          `远端 ${report.baseBranch} tip=${baseSha.slice(0, 7)}，本地 object 库里找不到它。\n` +
          `agent clone 后无法看到本地已形成的功能，只能重建。`,
        fix: `与上面同：人工推本地进度到远端新分支，再由人工评审合并。agent 不得自动 push/merge。`,
      });
    } else if (typeof report.behind === 'number' && report.behind > 0) {
      report.blocks.push({
        code: 'BEHIND',
        msg: `本地落后 ${report.baseBranch} 共 ${report.behind} commit。`,
        fix: `先对齐再动手：git fetch origin && git merge ${report.baseBranch}。\n`+
             `           在落后版本上改代码 = 改动落不到最新文件上，后续合并必冲突。`,
      });
    } else if (typeof report.ahead === 'number' && report.ahead > 0 && report.behind === 0) {
      report.hints.push(
        `本地领先 ${report.baseBranch} ${report.ahead} commit（未推送）。` +
        `改动是安全的，但请确认这些 commit 最终会推上去，否则远端仍停在旧版。`
      );
    }
  }
}

// ---- 3. 工作树提示（项目特有：AGENTS.md §8.6 三树分叉） ----
const base = path.basename(ROOT);
if (base !== '_work_dev') {
  report.warnings.push({
    code: 'NOT_MAIN_TREE',
    msg: `当前工作树是 ${base}，不是主力树 _work_dev。`,
    fix: 'AGENTS.md §8.6：无人值守只允许在 _work_dev 内工作；另两棵树不要自动合流。',
  });
}

const failed = report.blocks.length > 0;

// ---- 输出 ----
if (asJson) {
  console.log(JSON.stringify({ ...report, ok: !failed }, null, 2));
} else {
  const line = '─'.repeat(64);
  console.log(`\n================ 开工闸门 preflight ================`);
  console.log(line);
  console.log(`工作树　${ROOT}`);
  console.log(`分支　　${report.branch ?? '?'}　HEAD ${report.headShort ?? '?'}`);
  console.log(`最近提交${report.headDate ? '（' + report.headDate + '）' : ''}`);
  console.log(`　　　　${(report.headSubject ?? '').slice(0, 56)}`);
  console.log(line);
  console.log(
    `远端　　${report.remote ?? '（无）'}　基线 ${report.baseBranch ?? '—'}　` +
      `ahead ${report.ahead ?? '—'} / behind ${report.behind ?? '—'}　` +
      `共同祖先 ${report.sharesAncestor === null ? '—' : report.sharesAncestor ? '有 ✅' : '无 ❌'}`
  );
  console.log(line);

  if (report.hints.length) {
    console.log('\n提示：');
    report.hints.forEach((h) => console.log(`  · ${h}`));
  }

  if (report.warnings.length) {
    console.log('\n提醒：');
    for (const w of report.warnings) {
      console.log(`  ⚠ [${w.code}] ${w.msg}`);
      if (w.detail) console.log(`     ${w.detail}`);
      if (w.fix) console.log(`     → ${w.fix.replace(/\n/g, '\n     ')}`);
    }
  }

  if (report.blocks.length) {
    console.log('\n🔴 硬阻塞——先处理，不要动手改代码：\n');
    for (const b of report.blocks) {
      console.log(`  ⛔ [${b.code}] ${b.msg}`);
      if (b.detail) console.log(`     ${b.detail.replace(/\n/g, '\n     ')}`);
      if (b.fix) console.log(`     → ${b.fix.replace(/\n/g, '\n     ')}`);
      console.log('');
    }
    console.log('结论：❌ 尚未站在最新版本上。');
    console.log('      上面的修复动作多为「人工决策」，agent 应写进 BLOCKERS.md 交CY，不要自行push/merge。');
  } else {
    console.log('\n结论：✅ 可以开工。改动落在当前 HEAD 之上。');
    if (report.ahead > 0) {
      console.log('提醒：收尾前跑 `node scripts/impact.mjs` 验证没有打断过往功能。');
    }
  }
  console.log('====================================================\n');
}

process.exit(failed ? 1 : 0);