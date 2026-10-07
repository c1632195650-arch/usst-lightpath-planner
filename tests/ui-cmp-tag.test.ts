/**
 * UI v2 批次 C6 · Tag 断言（§10.2.5：分类/状态七 tone；未读=小圆点，数量=数字，两者不混用）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, Fragment } from 'react';

import { Tag } from '@/components/ui/Tag';

test('C6 Tag: 七 tone 全可渲染（含上理红 school 与 gold）', () => {
  for (const tone of ['neutral', 'brand', 'ok', 'warn', 'danger', 'gold', 'school']) {
    const html = renderToStaticMarkup(createElement(Tag, { tone } as never, '理论课'));
    assert.match(html, /rounded-full/, `${tone} 渲染`);
  }
  assert.match(renderToStaticMarkup(createElement(Tag, { tone: 'school' } as never, '校历')), /bg-school-light/);
});

test('C6 Tag: dot 小圆点 7px 与 count 数字徽标互不混用（dot 优先，同给时不出 count）', () => {
  const dotOnly = renderToStaticMarkup(createElement(Tag, { dot: true } as never, '未读'));
  assert.match(dotOnly, /h-\[7px\] w-\[7px\]/, '7px 小圆点');
  const countOnly = renderToStaticMarkup(createElement(Tag, { count: 3 } as never, '待办'));
  assert.match(countOnly, />3</, '数字徽标');
  const both = renderToStaticMarkup(createElement(Tag, { dot: true, count: 3 } as never, 'x'));
  assert.match(both, /h-\[7px\]/);
  assert.doesNotMatch(both, />3</, '同给时 count 不渲染（规则：两者不混用）');
});
