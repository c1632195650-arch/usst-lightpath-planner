/**
 * UI v2 批次 C11 · Toast 断言（§10.4.1 三规矩 + §10.5 矩阵：默认/错误必验）
 * 时序规矩用纯函数实测（2.4s 自动退场 / 带 action 不自动退 / 一次最多 1 条排队）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { pushToast, sweepToasts, visibleToast, TOAST_AUTO_MS, ToastStack, type ToastItem } from '@/components/ui/Toast';

test('C11 规矩①: 2.4s 自动退场；带 action 的不过期', () => {
  assert.equal(TOAST_AUTO_MS, 2400);
  const now = 1000;
  const plain = pushToast([], { text: '已保存' }, now);
  const acted = pushToast([], { text: '时间冲突 · 仍要保存？', actionLabel: '仍要保存', onAction: () => {} }, now);
  assert.deepEqual(sweepToasts(plain, now + TOAST_AUTO_MS - 1), plain, '2.4s 内存活');
  assert.equal(sweepToasts(plain, now + TOAST_AUTO_MS).length, 0, '2.4s 整点出队');
  assert.equal(sweepToasts(acted, now + TOAST_AUTO_MS * 10).length, 1, '带按钮永不过期（等用户点）');
});

test('C11 规矩③: 一次最多露 1 条，第 2 条排队不堆叠；队列硬顶', () => {
  let q = pushToast([], { text: '第一条' }, 0);
  q = pushToast(q, { text: '第二条' }, 10);
  assert.equal(q.length, 2, '第二条排队而非替换堆叠');
  assert.equal(visibleToast(q)?.text, '第一条', '只露队首');
  for (let i = 0; i < 20; i++) q = pushToast(q, { text: `x${i}` }, 20 + i);
  assert.ok(q.length <= 8, '队列硬顶 8 条，防内存涨');
});

test('C11 标记: 右下定位不遮操作位 + aria-live=polite + tone 状态点 + action 按钮', () => {
  const q: ToastItem[] = pushToast([], { text: '同步失败 · 网络离线，改动已存在本机', tone: 'error' }, 0);
  const html = renderToStaticMarkup(createElement(ToastStack, { queue: q, onDismiss: () => {} }));
  assert.match(html, /aria-live="polite"/, '读屏播报');
  assert.match(html, /fixed bottom-5 right-5/, '右下角（不遮正在操作的位置）');
  assert.match(html, /data-tone="error"/);
  assert.match(html, /bg-danger/, '错误状态点');
  const withAct = pushToast([], { text: '已移到周三 14:00', actionLabel: '撤销', onAction: () => {} }, 0);
  const act = renderToStaticMarkup(createElement(ToastStack, { queue: withAct, onDismiss: () => {} }));
  assert.match(act, /data-testid="toast-action"/);
  assert.match(act, /撤销/);
});
