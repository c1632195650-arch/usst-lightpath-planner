/**
 * UI v2 批次 C9/C10 · ListRow + Skeleton 断言
 * ListRow（§10.5：默认/悬停/聚焦/按下/选中必验；选中三重差异）
 * Skeleton（§10.3.3：行高行数宽度比例与真实内容一致；aria-busy 约定）
 * 源码锁式。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('C9 ListRow: 可交互行 role=button + tabIndex + selected 三重差异', () => {
  const s = src('/src/components/ui/ListRow.tsx');
  assert.match(s, /role: 'button', tabIndex: 0/, '可点行暴露按钮语义+键盘可达');
  assert.match(s, /hover:border-brand\/20 hover:bg-brand-light\/30 active:scale-\[\.985\]/, '悬停增强+按下缩放');
  assert.match(s, /aria-selected=\{interactive \? selected : undefined\}/, '选中语义仅交互行暴露');
  assert.match(s, /border-brand\/30 bg-brand-light text-brand/, '选中=底色+文字色');
  assert.match(s, /w-\[3px\]/, '选中=3px 竖条');
});

test('C9 ListRow: 静态行不冒充按钮；禁用行 aria-disabled + 变淡', () => {
  const s = src('/src/components/ui/ListRow.tsx');
  assert.match(s, /const interactive = onClick != null && !disabled/, '无 onClick 或禁用 → 非交互');
  assert.match(s, /aria-disabled=\{disabled \|\| undefined\}/);
  assert.match(s, /disabled \? 'opacity-40' : ''/, '禁用变淡');
});

test('C10 Skeleton: 行/卡/气泡三档 + 比例锚 + aria-busy 约定 + 纯装饰', () => {
  const s = src('/src/components/ui/Skeleton.tsx');
  // 三档骨架都在
  assert.match(s, /export function SkeletonRow/, '行骨架');
  assert.match(s, /export function SkeletonCard/, '卡骨架');
  assert.match(s, /export function SkeletonBubble/, '气泡骨架');
  // 比例与真实内容一致：行骨架两行(h-4/h-3)、卡骨架 rounded-2xl 对齐 panel、气泡头像位 24px 对齐消息行
  assert.match(s, /w-1\/2" h="h-4"/, '行骨架标题行比例');
  assert.match(s, /w-2\/3" h="h-3"/, '行骨架副文行比例');
  assert.match(s, /rounded-2xl border border-ink\/\[0\.07\] bg-white p-5/, '卡骨架与 panel 同形');
  assert.match(s, /h-6 w-6/, '气泡骨架头像位 24px（对齐 LbaoChat 消息行）');
  assert.match(s, /aria-hidden="true"/, '骨架纯装饰');
  assert.match(s, /aria-busy=\{busy \|\| undefined\}/, '骨架区挂 aria-busy，真实内容到了再摘');
});
