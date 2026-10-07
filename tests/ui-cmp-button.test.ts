/**
 * UI v2 批次 C1 · Button 8 态断言（§10.1 / §10.5 覆盖矩阵：默认/悬停/聚焦/按下/禁用/加载必验）
 * 用 react-dom/server 真渲染出 DOM 字符串断言（比源码正则强：验的是产出的真实标记）。
 * 悬停/按下为 CSS 类存在性断言（SSR 无法模拟指针，视觉走查归终验黑盒八条）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { Button } from '@/components/ui/Button';

const render = (props: Record<string, unknown> = {}, children = '保存') =>
  renderToStaticMarkup(createElement(Button, props as never, children));

test('C1 Button: default 语义五variant齐全（含上理红）+ 两尺寸最小高', () => {
  for (const v of ['primary', 'secondary', 'ghost', 'danger', 'red']) {
    assert.match(render({ variant: v }), /class="/, `variant ${v} 可渲染`);
  }
  assert.match(render({ variant: 'red' } as never), /bg-school-red/, '上理红语义在位');
  assert.match(render({ size: 'sm' }), /min-h-9/, 'sm=36px 档');
  assert.match(render({ size: 'md' }), /min-h-11/, 'md=44px 档');
});

test('C1 Button: disabled 态——disabled 属性 + opacity-40 + 不可点（不是只变淡）', () => {
  const html = render({ disabled: true });
  assert.match(html, /<button[^>]*disabled/, '原生 disabled（不可聚焦不可点）');
  assert.match(html, /disabled:opacity-40/, '变淡样式在位');
  assert.match(html, /disabled:pointer-events-none/, '指针事件关闭');
});

test('C1 Button: loading 态——宽高不变（文字透明占位）+ 15px spinner + aria-busy + 自动禁用', () => {
  const html = render({ loading: true });
  assert.match(html, /aria-busy="true"/, 'aria-busy 对读屏与测试可见');
  assert.match(html, /<button[^>]*disabled/, '加载中自动禁用，防重复提交');
  assert.match(html, /text-transparent/, '文字转透明占位（宽高不变的核心）');
  assert.match(html, /width="15" height="15"/, '15px spinner');
  assert.match(html, /ui-spin_1\.1s_linear_infinite/, '1.1s linear 旋转');
  // 宽高不变：loading 与非 loading 输出的尺寸类一致（min-h 同档、padding 同档）
  const idle = render({});
  const minH = (s: string) => s.match(/min-h-\d+/)?.[0];
  const pad = (s: string) => s.match(/px-\d+ py-\d+/)?.[0];
  assert.equal(minH(html), minH(idle), 'loading 不改变高度档');
  assert.equal(pad(html), pad(idle), 'loading 不改变内边距');
});

test('C1 Button: focus-visible 双环 + active 缩放 + hover 增强类在位', () => {
  const html = render({});
  assert.match(html, /focus-visible:shadow-\[0_0_0_2px_#fff,0_0_0_4px_#4A73D1\]/, '2px 外环+2px 白隔离圈');
  assert.match(html, /active:scale-\[\.985\]/, '按下 scale(.985)');
  assert.match(html, /duration-fast/, 'hover 140ms 档');
  assert.match(html, /active:duration-instant/, 'active 90ms 档');
});
