/**
 * E 批 E4 · 周视图渲染模型验收（2026-09-28）
 * ============================================================
 * 判据：① L0 只留 `emoji+时刻+地点+通勤徽章`；② **估算转场必须带 ≈**（不把估算说成实测）；
 *       ③ 标题里已点名的地点不重复；④ issue 明细收成一句话 + 计数；⑤ L0 文本长度可量化。
 * 反向验证锚点（RV，删实现必红）：
 *   E4-RV1 ← transferChip 不再判估算 → 「估算带 ≈」用例红
 *   E4-RV2 ← placeLabel 不做「标题含地点则省略」→ 「不重复点名」用例红
 *   E4-RV3 ← summarizeIssues 不按 error 优先 → 「顶部取最严重」用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TimeBlock } from '@/types';
import {
  blockChip, blockDetail, hhmm, l0Length, placeLabel, summarizeIssues, timeLabel, transferChip,
} from '@/features/week/weekViewModel';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

function block(over: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: 'w4-d1-study-1', kind: 'study', dayOfWeek: 1,
    startMin: 9 * 60, endMin: 10 * 60, title: '自习 · 图书馆',
    place: '图书馆（图文信息中心）', emoji: '📚', source: 'template',
    ...over,
  };
}

/* ---------------- ① 时间 ---------------- */

test('E4 时间: 时刻格式化（补零、四舍五入到分钟）', () => {
  assert.equal(hhmm(9 * 60 + 5), '09:05');
  assert.equal(hhmm(13 * 60), '13:00');
  assert.equal(timeLabel({ startMin: 8 * 60, endMin: 9 * 60 + 30 }), '08:00–09:30');
});

/* ---------------- ③ 地点不重复点名 ---------------- */

test('E4 地点: 标题里已点名的地点不重复显示；L0 用简写、全名留给 L1/L2', () => {
  assert.equal(placeLabel(block({ title: '图书馆（图文信息中心）自习' })), null, '标题已含地点全名 → 不重复');
  assert.equal(placeLabel(block({ title: '自习' })), '图书馆', '括号补充说明不进 L0（简写）');
  assert.equal(placeLabel(block({ title: '自习', room: '305' })), '图书馆 305');
  assert.equal(placeLabel(block({ place: undefined })), null);
  const c = blockChip(block({ title: '自习', room: '305' }));
  assert.equal(c.place, '图书馆 305', 'L0 简写');
  assert.equal(c.placeFull, '图书馆（图文信息中心） 305', '全名留给 L1/L2');
});

/* ---------------- ② 通勤徽章（含估算诚实标记） ---------------- */

test('E4 通勤: 实测不带 ≈，估算带 ≈ 且标 estimate', () => {
  const measured = transferChip(block({
    transfer: { fromPlace: '一食堂', toPlace: '图书馆（图文信息中心）', minutes: 8, slackMin: 12, tight: false, reliable: true, source: 'osm' },
  }));
  assert.equal(measured?.label, '🚶 8′');
  assert.equal(measured?.estimate, false);

  const estimated = transferChip(block({
    transfer: { fromPlace: '一食堂', toPlace: '图书馆（图文信息中心）', minutes: 17, slackMin: 2, tight: true, reliable: false, source: 'campus-estimate' },
  }));
  assert.equal(estimated?.label, '🚶 ≈17′', '估算必须带 ≈');
  assert.equal(estimated?.estimate, true);
  assert.equal(estimated?.tight, true);
  assert.match(estimated?.detail ?? '', /估算值/, '详情里也要说明是估算');

  // source 含 estimate 也要判成估算（不只认 reliable 字段）
  const bySource = transferChip(block({
    transfer: { fromPlace: 'a', toPlace: 'b', minutes: 6, slackMin: 30, tight: false, source: 'transfer-estimate' },
  }));
  assert.equal(bySource?.estimate, true);
  assert.equal(transferChip(block()), null, '没有转场信息就没有徽章');
});

/* ---------------- ① L0 模型 ---------------- */

test('E4 L0: 来源三态与校历事件标注；有内情才给「可点开」', () => {
  assert.equal(blockChip(block({ source: 'course', kind: 'course' })).sourceLabel, '课表');
  assert.equal(blockChip(block({ source: 'user' })).sourceLabel, '你自己加的');
  assert.equal(blockChip(block()).sourceLabel, '引擎自动安排');
  assert.match(blockChip(block({ source: 'template', fromEventId: 'ev-1' })).sourceLabel, /校历事件/);

  assert.equal(blockChip(block()).hasDetail, false, '没有 reason/转场/锁定 → 不给「点我」的错觉');
  assert.equal(blockChip(block({ reason: '为什么' })).hasDetail, true);
  assert.equal(blockChip(block({ locked: true })).hasDetail, true);
});

test('E4 L0: 文本长度可量化（典型块 ≤14 字宽，简写后达标）', () => {
  const withFullName = block({
    title: '自习',
    transfer: { fromPlace: '图书馆（图文信息中心）', toPlace: '第一食堂', minutes: 8, slackMin: 20, tight: false },
  });
  assert.ok(l0Length(withFullName) <= 14,
    `L0 应 ≤14 字宽（简写后），实际 ${l0Length(withFullName)}`);
  // 简写是达标的前提：去掉括号补充说明
  assert.equal(placeLabel(withFullName), '图书馆');
});

/* ---------------- ④ issue 聚合 ---------------- */

test('E4 issue: 顶部取最严重一条 + 计数，明细按 严重→警告→提示 排序', () => {
  const s = summarizeIssues([
    { level: 'info', message: '换地点会更顺' },
    { level: 'warn', message: '转场偏紧' },
    { level: 'error', message: '两门课时间重叠' },
  ]);
  assert.match(s.headline ?? '', /两门课时间重叠/);
  assert.match(s.headline ?? '', /另有 2 条/);
  assert.equal(s.errorCount, 1);
  assert.equal(s.warnCount, 1);
  assert.deepEqual(s.details, ['两门课时间重叠', '转场偏紧', '换地点会更顺']);
  assert.equal(summarizeIssues([]).headline, null);
});

/* ---------------- ⑥ E5：L2 详情装配 + 零依赖闸门 ---------------- */

test('E5 详情: 必给「时间/地点/来源」，其余按有无内容产出（不出现占位噪音）', () => {
  const bare = blockDetail(block());
  assert.deepEqual(bare.rows.map((r) => r.label), ['时间', '地点', '来源'],
    '没有内情就是最小三行（地点给**全名**：L0 显示的是简写，详情要说清是哪个馆）');
  assert.equal(bare.rows.find((r) => r.label === '地点')?.value, '图书馆（图文信息中心）');
  assert.match(bare.title, /📚/);

  const rich = blockDetail(block({
    reason: '早上专注更好', locked: true, fromEventId: 'ev-9',
    transfer: { fromPlace: '一食堂', toPlace: '图书馆（图文信息中心）', minutes: 9, slackMin: 20, tight: false, reliable: false, source: 'campus-estimate' },
  }));
  const labels = rich.rows.map((r) => r.label);
  for (const k of ['时间', '地点', '通勤', '为什么排在这', '来源', '锁定', '关联事件']) {
    assert.ok(labels.includes(k), `应有「${k}」行`);
  }
  assert.match(rich.rows.find((r) => r.label === '通勤')!.value, /≈/, '详情里的估算也要带 ≈');
  assert.ok(!rich.rows.some((r) => r.value === '' || r.value === '—'), '不产出空行');
});

test('E5 零依赖闸门: 详情抽屉用原生 dialog，未引入任何组件库', () => {
  const d = src('/src/components/ui/DetailDrawer.tsx');
  assert.match(d, /<dialog/, '用原生 dialog');
  assert.match(d, /showModal\(\)/, 'showModal 自带焦点陷阱/Esc/inert');
  assert.match(d, /motion-reduce:transition-none/, '遵循 prefers-reduced-motion');
  // ⚠️ 只查 **import 语句**，不查正文 —— 注释里写「无需引 Radix/Vaul」是解释，
  //    不是依赖（首版用正文 includes 判定，被自己的注释打红，2026-09-28 修正为 import 级判定）。
  const imports = d.match(/^\s*import[^\n]*/gm) ?? [];
  const importText = imports.join('\n').toLowerCase();
  for (const dep of ['radix', 'vaul', 'base-ui', '@headlessui', 'framer-motion', 'formkit']) {
    assert.ok(!importText.includes(dep), `import 不得引入 ${dep}（依赖闸门：附录 A 全关）`);
  }
  assert.ok(imports.every((l) => /from '(react|@\/)[^']*'/.test(l)),
    '只允许 react 与仓内模块（零新依赖）');
  const pkg = src('/package.json');
  const deps = JSON.parse(pkg) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  const all = Object.keys({ ...deps.dependencies, ...deps.devDependencies }).join(',');
  for (const dep of ['radix', 'vaul', 'base-ui', '@headlessui', 'framer-motion', '@formkit']) {
    assert.ok(!all.includes(dep), `package.json 不得新增 ${dep}`);
  }
  assert.match(src('/src/features/week/WeekPlanView.tsx'), /data-testid=\{`block-detail-\$\{block\.id\}`\}/, '详情入口 testid 在位');
});

/* ---------------- ⑤ 源码锁（接线形状） ---------------- */

test('E4 源码锁: BlockCard 走渲染模型，散文式转场行已下线；时间轴有视觉重心与量测锚', () => {
  const wv = src('/src/features/week/WeekPlanView.tsx');
  assert.match(wv, /import \{ blockChip, blockDetail \} from '@\/features\/week\/weekViewModel'/, '模型已接线');
  assert.match(wv, /const chip = blockChip\(block\)/, '卡片用 chip');
  assert.ok(!wv.includes('🚶 {t.fromPlace}'), '旧的散文式转场行必须下线');
  assert.match(wv, /data-testid="week-timeline"/, '时间轴量测锚在位');
  assert.match(wv, /style=\{\{ minHeight: 'calc\(100vh - 280px\)' \}\}/, '浏览态时间轴撑满主体高度（视觉重心，内联 style 不碰既有类名断言）');
  assert.match(wv, /\{!editable && chip\.hasDetail && onOpenDetail && \(/, '详情入口三条件闸');
  assert.match(wv, /<DetailDrawer/, '抽屉已接线');
  assert.match(wv, /blockDetail\(detailBlock\)/, '详情数据来自纯函数装配');
});
