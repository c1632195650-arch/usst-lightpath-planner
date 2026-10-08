/**
 * 任务二 红线 8 · 方法提示真实性（引文零编造）
 * ============================================================
 * 五维指向的 habit_kb slug 必须真实存在于 METHOD_PARAMS.hints
 * （编译自 data/method_kb.db）—— MOSS 验收「source_slug 可检索」的机器侧证据。
 * 任务一升格落地后，本测试自动覆盖扩库后的同 slug 条目。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { METHOD_PARAMS } from '@/data/methodParams.generated';
import { DIM_TIP_SLUGS, tipForDim, tipForSlug } from '@/features/mobile/eval/compute.ts';
import { DIM_IDS, DIM_LABELS } from '@/features/mobile/eval/model.ts';

test('五维各有一个提示 slug，且全部能在 METHOD_PARAMS.hints 检索到', () => {
  assert.equal(Object.keys(DIM_TIP_SLUGS).length, DIM_IDS.length);
  for (const dim of DIM_IDS) {
    const slug = DIM_TIP_SLUGS[dim];
    const hint = METHOD_PARAMS.hints.find((h) => h.slug === slug);
    assert.ok(hint, `维度 ${dim} 的 slug「${slug}」必须存在于 method_kb（引文零编造）`);
    assert.ok(hint.title.length > 0 && hint.summary.length > 0);
  }
});

test('tipForDim / tipForSlug：内容照抄 hints，未知 slug 返回 null（不造引用）', () => {
  const tip = tipForDim('procrastination');
  assert.equal(tip!.slug, 'procrastination-regulation');
  assert.equal(tip!.title, METHOD_PARAMS.hints.find((h) => h.slug === 'procrastination-regulation')!.title);
  assert.equal(tipForSlug('no-such-slug-anywhere'), null);
});

test('提示条目证据等级与状态可见（verified / tier 非空）', () => {
  for (const dim of DIM_IDS) {
    const hint = METHOD_PARAMS.hints.find((h) => h.slug === DIM_TIP_SLUGS[dim])!;
    assert.ok(hint.tier.length > 0, `${hint.slug} 缺证据等级`);
    assert.ok(['verified', 'contested'].includes(hint.status), `${hint.slug} 状态异常：${hint.status}`);
  }
});

/* ---------- UI 契约（源码锁，红线 6 / 验收「无总分字样」「未出现画像字样」） ---------- */

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', 'src', 'features', 'mobile');

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function readComponent(name: string): string {
  return stripComments(readFileSync(join(ROOT, name), 'utf8'));
}

test('UI 契约：EvalPanel / DailyQuizSheet 剥注释后不出现「总分」「画像」字样', () => {
  for (const f of ['EvalPanel.tsx', 'DailyQuizSheet.tsx']) {
    const src = readComponent(f);
    assert.ok(!src.includes('总分'), `${f} 出现「总分」——违反铁律 1（五维不合成）`);
    assert.ok(!src.includes('画像'), `${f} 出现「画像」——CY 明确评估窗口与画像无关`);
    assert.ok(!src.includes('排名'), `${f} 出现「排名」——不做跨用户比较`);
  }
});

test('UI 契约：EvalPanel 必须有「数据累积中」「本周最该改」与五维独立展示', () => {
  const src = readComponent('EvalPanel.tsx');
  assert.ok(src.includes('数据累积中'), '冷启动必须显示「数据累积中」而非 0 分');
  assert.ok(src.includes('本周最该改'), '必须有「本周最该改的一件事」');
  assert.ok(src.includes('DIM_IDS.map'), '五维必须逐维独立渲染（map over DIM_IDS）');
  assert.ok(src.includes('m-eval-dim-'), '每维有独立 testid（可独立定位，非聚合展示）');
  for (const label of Object.values(DIM_LABELS)) {
    assert.ok(label.length > 0);
  }
  assert.equal(new Set(Object.values(DIM_LABELS)).size, DIM_IDS.length, '五维名称互异');
  assert.ok(!/\.reduce\([^)]*\+\s*[a-z.]*value/.test(src), '不得把五维 value 求和（合成总分）');
});

test('UI 契约（2026-10-08 清晰化）：每维明细含「在量什么 / 怎么看 / 数据依据 / 可以怎么做」', () => {
  const src = readComponent('EvalPanel.tsx');
  assert.ok(src.includes('m-eval-dim-detail-'), '每维展开明细须有独立 testid（可独立定位）');
  assert.ok(src.includes('怎么看'), '每维须有一句「怎么看」（这个数怎么读、偏低意味着什么）');
  assert.ok(src.includes('数据依据'), '每维须如实回显 compute 层 basis（用户能看到数从哪来）');
  assert.ok(src.includes('可以怎么做'), '每维须给一条可执行方法');
  assert.ok(src.includes('tipForDim'), '每维方法必须取自 DIM_TIP_SLUGS 编译产物（引文零编造，不造引用）');
});

test('UI 契约：DailyQuizSheet 可跳过、弹窗带「看方法」入口', () => {
  const src = readComponent('DailyQuizSheet.tsx');
  assert.ok(src.includes('跳过'), '题目必须可跳过（不强制）');
  assert.ok(src.includes('看方法'), '每题必须有指向习惯库的「看方法」入口');
});
