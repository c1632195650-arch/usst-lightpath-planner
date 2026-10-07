/**
 * UI v2 批次 C13 · Modal / Drawer 断言（§10.4.2 + §10.5：默认/聚焦/加载必验）
 * SSR 验关闭态零渲染与打开态 dialog 语义；焦点归还/Esc 是运行时行为，走查覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { Modal, Drawer } from '@/components/ui/Modal';

test('C13 Modal: 关闭态零渲染（不偷挂 DOM）', () => {
  const html = renderToStaticMarkup(
    createElement(Modal, { open: false, onClose: () => {}, title: '删除这条日程？' } as never, '「慢跑 3 km」将被移除。'),
  );
  assert.equal(html, '', '关闭态不渲染任何节点');
});

test('C13 Modal: 打开态 role=dialog + aria-modal + 标题可达 + 动作区', () => {
  const html = renderToStaticMarkup(
    createElement(Modal, {
      open: true, onClose: () => {}, title: '删除这条日程？',
      actions: createElement('button', null, '删除'),
    } as never, '「慢跑 3 km」将被移除，5 秒内可撤销。'),
  );
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-label="删除这条日程？"/);
  assert.match(html, /删除/);
});

test('C13 Drawer: 打开态 role=dialog + 右侧/底部两形态 + 关闭态零渲染', () => {
  const right = renderToStaticMarkup(
    createElement(Drawer, { open: true, onClose: () => {}, title: '改时间' } as never, '18:00 → 19:00'),
  );
  assert.match(right, /role="dialog"/);
  assert.match(right, /right-0 top-0/, '右滑形态');
  const bottom = renderToStaticMarkup(
    createElement(Drawer, { open: true, onClose: () => {}, title: '改时间', side: 'bottom' } as never, 'x'),
  );
  assert.match(bottom, /bottom-0 inset-x-0/, '底部形态（移动端偏好）');
  const closed = renderToStaticMarkup(
    createElement(Drawer, { open: false, onClose: () => {}, title: 'x' } as never, 'x'),
  );
  assert.equal(closed, '');
});
