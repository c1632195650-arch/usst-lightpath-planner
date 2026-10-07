/**
 * UI v2 批次 C9/C10 · ListRow + Skeleton 断言
 * ListRow（§10.5：默认/悬停/聚焦/按下/选中必验；选中三重差异）
 * Skeleton（§10.3.3：行高行数宽度比例与真实内容一致；aria-busy 约定）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { ListRow } from '@/components/ui/ListRow';
import { SkeletonRow, SkeletonCard, SkeletonBubble, SkeletonBlock } from '@/components/ui/Skeleton';

test('C9 ListRow: 可交互行 role=button + tabIndex + selected 三重差异', () => {
  const plain = renderToStaticMarkup(
    createElement(ListRow, { title: '慢跑 3 km', subtitle: '18:30 · 操场 · 已完成', onClick: () => {} } as never),
  );
  assert.match(plain, /role="button"/, '可点行暴露按钮语义');
  assert.match(plain, /tabindex="0"/, '键盘可达');
  assert.match(plain, /hover:bg-brand-light\/30/, '悬停增强');
  assert.match(plain, /active:scale-\[\.985\]/, '按下缩放');
  const sel = renderToStaticMarkup(
    createElement(ListRow, { title: '应用光学', onClick: () => {}, selected: true } as never),
  );
  assert.match(sel, /aria-selected="true"/);
  assert.match(sel, /bg-brand-light text-brand/, '选中=底色+文字色');
  assert.match(sel, /w-\[3px\]/, '选中=3px 竖条');
});

test('C9 ListRow: 静态行不冒充按钮；禁用行 aria-disabled + 变淡', () => {
  const stat = renderToStaticMarkup(createElement(ListRow, { title: '只读行' } as never));
  assert.doesNotMatch(stat, /role="button"/);
  const dis = renderToStaticMarkup(createElement(ListRow, { title: 'x', onClick: () => {}, disabled: true } as never));
  assert.match(dis, /aria-disabled="true"/);
  assert.match(dis, /opacity-40/);
  assert.doesNotMatch(dis, /role="button"/, '禁用行不可交互');
});

test('C10 Skeleton: 行/卡/气泡三档结构 + aria-busy 约定 + 纯装饰 aria-hidden', () => {
  const row = renderToStaticMarkup(createElement(SkeletonRow, null));
  assert.match(row, /aria-hidden="true"/, '骨架纯装饰');
  const card = renderToStaticMarkup(createElement(SkeletonCard, { lines: 3 } as never));
  assert.match(card, /rounded-2xl/, '卡片骨架与 panel 同形');
  const bub = renderToStaticMarkup(createElement(SkeletonBubble, null));
  assert.match(bub, /h-6 w-6/, '气泡骨架头像位 24px（对齐消息行）');
  const block = renderToStaticMarkup(createElement(SkeletonBlock, { busy: true }, createElement(SkeletonRow)));
  assert.match(block, /aria-busy="true"/, '骨架区挂 aria-busy');
  const idle = renderToStaticMarkup(createElement(SkeletonBlock, { busy: false }, createElement('p', null, 'x')));
  assert.doesNotMatch(idle, /aria-busy/, '非加载不误报');
});
