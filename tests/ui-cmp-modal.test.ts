/**
 * UI v2 批次 C13 · Modal / Drawer 断言（§10.4.2 + §10.5）
 * 源码锁式；焦点归还/Esc 是运行时行为（实现里有 cleanup 焦点归还），黑盒走查兜底。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('C13 Modal: role=dialog + aria-modal + Esc + 焦点归还（cleanup 里 focus 回原元素）', () => {
  const s = src('/src/components/ui/Modal.tsx');
  assert.match(s, /role="dialog"/);
  assert.match(s, /aria-modal="true"/);
  assert.match(s, /aria-label=\{title\}/, '标题可达');
  assert.match(s, /e\.key === 'Escape'/, 'Esc 关闭');
  assert.match(s, /lastActive\.current\.focus\(\)/, '关闭时焦点归还到打开前的元素');
  assert.match(s, /document\.activeElement/, '打开时记录原焦点');
});

test('C13 Modal: 关闭态零渲染（不偷挂 DOM）', () => {
  const s = src('/src/components/ui/Modal.tsx');
  assert.match(s, /if \(!open\) return null;/, '关闭态零渲染');
});

test('C13 Drawer: 右侧/底部两形态 + role=dialog + Esc', () => {
  const s = src('/src/components/ui/Modal.tsx');
  assert.match(s, /'right-0 top-0 h-full w-80 max-w-\[88vw\] rounded-l-2xl'/, '右滑形态');
  assert.match(s, /'bottom-0 inset-x-0 rounded-t-2xl'/, '底部形态（移动端偏好）');
  assert.match(s, /side = 'right'/, '默认右侧');
  assert.match(s, /role="dialog"/);
});
