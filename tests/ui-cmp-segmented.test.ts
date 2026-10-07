/**
 * UI v2 批次 C3 · Segmented 断言（§10.2.2：role=group + aria-pressed；选中三重差异）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { Segmented } from '@/components/ui/Segmented';

const opts = [
  { value: 'week', label: '周概览' },
  { value: 'day', label: '当日流水' },
] as const;

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(Segmented, {
      options: opts, value: 'week', onChange: () => {}, label: '日程视图', ...props,
    } as never),
  );

test('C3 Segmented: role=group + aria-label + 每项 aria-pressed', () => {
  const html = render();
  assert.match(html, /role="group"/);
  assert.match(html, /aria-label="日程视图"/);
  assert.match(html, /aria-pressed="true"/, '当前项 selected');
  assert.match(html, /aria-pressed="false"/, '非当前项显式 false（不是缺省）');
});

test('C3 Segmented: 选中三重差异（底色+文字色+3px 竖条）；禁用整组透明+不可点', () => {
  const on = render();
  assert.match(on, /bg-white text-brand/, '选中底+文字色');
  assert.match(on, /w-\[3px\]/, '左竖条');
  const off = render({ disabled: true });
  assert.match(off, /opacity-40/, '禁用变淡');
  assert.match(off, /<button[^>]*disabled/, '按钮级禁用');
});
