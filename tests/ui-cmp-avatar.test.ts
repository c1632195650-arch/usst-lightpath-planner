/**
 * UI v2 批次 C8 · Avatar 断言（§10.3.2：26/38/56 三档；在线=右下 10px 圆点+2px 白描边；
 * 组：重叠 9px、最多 3 个再折叠 +N）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { Avatar, AvatarGroup } from '@/components/ui/Avatar';

test('C8 Avatar: 三档尺寸 + name 首字 + sr-only 全名', () => {
  for (const [size, cls] of [[26, 'h-\\[26px\\]'], [38, 'h-\\[38px\\]'], [56, 'h-14']] as const) {
    const html = renderToStaticMarkup(createElement(Avatar, { name: '王一', size } as never));
    assert.match(html, new RegExp(cls), `size=${size}`);
  }
  const html = renderToStaticMarkup(createElement(Avatar, { name: '王' } as never));
  assert.match(html, />王</, '首字入头像');
  assert.match(html, /sr-only">王</, '全名给读屏');
});

test('C8 Avatar: online 圆点 10px + 2px 白描边', () => {
  const html = renderToStaticMarkup(createElement(Avatar, { name: '林', online: true } as never));
  assert.match(html, /h-2\.5 w-2\.5/, '10px 圆点');
  assert.match(html, /border-2 border-white bg-ok/, '白描边+ok 色');
  assert.match(html, /aria-label="在线"/);
});

test('C8 AvatarGroup: 重叠 9px + 超出折叠 +N', () => {
  const html = renderToStaticMarkup(
    createElement(AvatarGroup, { names: ['王', '陈', '林', '赵', '钱'] } as never),
  );
  assert.match(html, /-ml-\[9px\]/, '重叠 9px');
  assert.match(html, /\+2</, '5 人显示 3 个 + 折叠 +2');
  const few = renderToStaticMarkup(createElement(AvatarGroup, { names: ['王', '陈'] } as never));
  assert.doesNotMatch(few, /\+</, '未超 3 个不折叠');
});
