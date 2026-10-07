/**
 * UI v2 批次 C12 · Popover / Tooltip 断言（§10.4.2 + §10.5：默认态必验）
 * SSR 验标记与常量；Esc/点外部关闭是运行时行为，黑盒走查（终验八条）覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { Popover, Tooltip, TOOLTIP_DELAY_MS } from '@/components/ui/Popover';

test('C12 Popover: 关闭态不渲染面板（无遮罩）；常量 400ms 提示延迟', () => {
  assert.equal(TOOLTIP_DELAY_MS, 400);
  const closed = renderToStaticMarkup(
    createElement(Popover, {
      trigger: (o: { open: boolean; toggle: () => void }) =>
        createElement('button', { onClick: o.toggle, 'aria-expanded': o.open }, '冲突详情'),
      children: '与「应用光学实验」重叠 20 分钟。',
    } as never),
  );
  assert.match(closed, /aria-expanded="false"/);
  assert.doesNotMatch(closed, /data-testid="popover-panel"/, '关闭时无面板');
});

test('C12 Popover: 打开态 role=dialog + 面板 + 动作按钮（可承载文字+一个动作）', () => {
  const open = renderToStaticMarkup(
    createElement(Popover, {
      trigger: () => createElement('button', null, 'x'),
      actionLabel: '看建议',
      defaultOpen: true,
    } as never, '建议：把实验提前到 13:00。'),
  );
  assert.match(open, /data-testid="popover-panel"/, '面板真渲染');
  assert.match(open, /role="dialog"/);
  assert.match(open, /建议：把实验提前到 13:00。/, '文字在面板内');
  assert.match(open, /data-testid="popover-action"/, '动作位（最多一个动作）');
});

test('C12 Tooltip: 纯文字 role=tooltip + 400ms 延迟样式 + 默认 opacity-0（不出即不可见）', () => {
  const html = renderToStaticMarkup(
    createElement(Tooltip, { text: '单双周交替显示' }, createElement('span', null, '?',
    )),
  );
  assert.match(html, /role="tooltip"/);
  assert.match(html, /单双周交替显示/);
  assert.match(html, /opacity-0/, '悬停前不可见');
  assert.match(html, /transition-delay: 400ms|transition-delay:400ms/, '400ms 才出');
});
