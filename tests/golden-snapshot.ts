/**
 * Golden baseline 拍摄器（T1.6 / A4）
 * 依据：`docs/scheduler-v2-spec.md` §9-T1.6（「**合并后**的旧引擎输出，只拍一次」）
 *
 * 用法（在仓库根目录）：
 *   node --import ./tests/register.mjs tests/golden-snapshot.ts            # 拍全部
 *   node --import ./tests/register.mjs tests/golden-snapshot.ts --only=week-04-typical
 *   node --import ./tests/register.mjs tests/golden-snapshot.ts --force    # 覆盖已有快照
 *
 * ⚠️ **「只拍一次」是纪律，不是口号**：shots 是后续 AC-2/AC-3 的唯一基准。
 *    默认**拒绝覆盖**；确需重拍必须显式 `--force`，并在 PR 描述里写明原因。
 * ⚠️ 时机：必须在 **CY 的 PR 合入 `dev` 之后**、且在 `schedule.ts` 唯一基准上拍。
 *    当前 `feat/planner-v2-p1` 分支尚未合入 → 现在是「工具已就绪、等待拍摄」。
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGoldenInput, GOLDEN_INPUTS, goldenInputSummary } from './golden-inputs.ts';
import { defaultEvalContext, normalizePlan, planMetrics } from './golden-lib.ts';
import { buildWeekPlan } from '@/lib/planner/schedule.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, 'golden');

/** 快照结构版本：字段有破坏性变化时才 +1 */
const SCHEMA = 1;

interface Args {
  force: boolean;
  only: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { force: false, only: null };
  for (const a of argv) {
    if (a === '--force') out.force = true;
    else if (a.startsWith('--only=')) out.only = a.slice('--only='.length);
  }
  return out;
}

function gitRev(): string | null {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });

  const existing = new Set(
    readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')),
  );

  const targets = args.only
    ? GOLDEN_INPUTS.filter((g) => g.name === args.only)
    : GOLDEN_INPUTS;

  if (targets.length === 0) {
    console.error(`✗ 找不到语料：--only=${args.only}（可选：${GOLDEN_INPUTS.map((g) => g.name).join(', ')}）`);
    return 1;
  }

  const rev = gitRev();
  const capturedAt = new Date().toISOString();
  let written = 0;
  let skipped = 0;

  for (const g of targets) {
    if (existing.has(g.name) && !args.force) {
      console.log(`• 跳过 ${g.name}（已存在；确需重拍加 --force）`);
      skipped += 1;
      continue;
    }

    const t0 = performance.now();
    const { plan } = buildWeekPlan(buildGoldenInput(g));
    const elapsedMs = Number((performance.now() - t0).toFixed(3));

    const ctx = defaultEvalContext(g.weekNo, g.policy);
    const snapshot = {
      meta: {
        schema: SCHEMA,
        name: g.name,
        engine: 'src/lib/planner/schedule.ts::buildWeekPlan',
        engineKind: 'greedy-golden',
        spec: 'docs/scheduler-v2-spec.md#T1.6',
        gitRev: rev,
        capturedAt,
      },
      input: goldenInputSummary(g),
      blocks: normalizePlan(plan),
      metrics: planMetrics(plan, ctx),
      timing: { elapsedMs },
    };

    const outPath = join(GOLDEN_DIR, `${g.name}.json`);
    writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    written += 1;
    console.log(`✓ ${g.name}.json  blocks=${snapshot.blocks.length} cost=${snapshot.metrics.cost.toFixed(1)} ${elapsedMs}ms`);
  }

  console.log(`\n完成：写入 ${written}，跳过 ${skipped}。
⚠️ 请把新快照一并提交，并在 PR 里注明「golden baseline 首次拍摄」。
   AC-2/AC-3 从此刻起以这些 JSON 为准 —— 之后不要再重拍。`);
  return 0;
}

process.exit(main());
