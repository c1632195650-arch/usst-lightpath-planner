/**
 * UI v2 批次 C11 · Toast 断言（§10.4.1 三规矩 + §10.5：默认/错误必验）
 * 时序规矩对纯逻辑模块 toastModel.ts **真跑实测**（.ts 可被零依赖 runner 导入）；
 * 渲染层用源码锁。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  pushToast, sweepToasts, visibleToast, TOAST_AUTO_MS, type ToastItem,
} from '@/components/ui/toastModel';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('C11 规矩①: 2.4s 自动退场；带 action 的不过期（真跑）', () => {
  assert.equal(TOAST_AUTO_MS, 2400);
  const now = 1000;
  const plain = pushToast([], { text: '已保存' }, now);
  const acted = pushToast([], { text: '时间冲突 · 仍要保存？', actionLabel: '仍要保存', onAction: () => {} }, now);
  assert.deepEqual(sweepToasts(plain, now + TOAST_AUTO_MS - 1), plain, '2.4s 内存活');
  assert.equal(sweepToasts(plain, now + TOAST_AUTO_MS).length, 0, '2.4s 整点出队');
  assert.equal(sweepToasts(acted, now + TOAST_AUTO_MS * 10).length, 1, '带按钮永不过期（等用户点）');
});

test('C11 规矩③: 一次最多露 1 条（队首），第 2 条排队不堆叠；队列硬顶（真跑）', () => {
  let q = pushToast([], { text: '第一条' }, 0);
  q = pushToast(q, { text: '第二条' }, 10);
  assert.equal(q.length, 2, '第二条排队而非替换堆叠');
  assert.equal(visibleToast(q)?.text, '第一条', '只露队首');
  for (let i = 0; i < 20; i++) q = pushToast(q, { text: `x${i}` }, 20 + i);
  assert.ok(q.length <= 8, '队列硬顶 8 条，防内存涨');
});

test('C11 渲染层: 右下定位不遮操作位 + aria-live=polite + tone 状态点 + action 按钮', () => {
  const s = src('/src/components/ui/Toast.tsx');
  assert.match(s, /aria-live="polite"/, '读屏播报');
  assert.match(s, /fixed bottom-5 right-5 z-50/, '右下角（不遮正在操作的位置）');
  assert.match(s, /data-tone=\{t\.tone \?\? 'info'\}/, 'tone 可断言锚');
  assert.match(s, /bg-danger" aria-hidden="true" \/>/, '错误状态点');
  assert.match(s, /data-testid="toast-action"/, '操作按钮位');
  assert.match(s, /visibleToast\(queue\)/, '一次只渲染一条');
});
