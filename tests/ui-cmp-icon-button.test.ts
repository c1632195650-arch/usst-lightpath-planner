/**
 * UI v2 批次 C2 · IconButton 断言（§10.2.1：命中区强制 44×44；§10.5 矩阵：默认/悬停/聚焦/按下/选中/禁用必验）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { IconButton } from '@/components/ui/IconButton';

const icon = createElement('svg', { width: 17, height: 17 }, createElement('path', { d: 'M4 4h16' }));
const render = (props: Record<string, unknown>) =>
  // SSR 会把 class 里的 & 和 > 转义成 &amp; / &gt;（arbitrary variant 语法），先解码再断言。
  renderToStaticMarkup(createElement(IconButton, { label: '切换视图', ...props } as never, icon))
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>');

test('C2 IconButton: 命中区 44×44 + 图标 17px + aria-label 必挂', () => {
  const html = render({});
  assert.match(html, /h-11 w-11/, '命中区 44×44（图标小不等于能点的地方小）');
  assert.match(html, /\[&>svg\]:h-\[17px\]/, '图标视觉 17px');
  assert.match(html, /aria-label="切换视图"/, '无障碍名必填');
});

test('C2 IconButton: selected 态——aria-pressed + 三重差异类在位', () => {
  const html = render({ selected: true });
  assert.match(html, /aria-pressed="true"/, 'toggle 语义对读屏可见');
  assert.match(html, /bg-brand text-white/, '选中=底色+文字色');
  assert.match(html, /w-\[3px\]/, '3px 左竖条（三重差异之一）');
});

test('C2 IconButton: disabled + focus 双环 + active 缩放', () => {
  const html = render({ disabled: true });
  assert.match(html, /<button[^>]*disabled/, '原生禁用');
  const idle = render({});
  assert.match(idle, /focus-visible:shadow-\[0_0_0_2px_#fff,0_0_0_4px_#4A73D1\]/);
  assert.match(idle, /active:scale-\[\.985\]/);
});
