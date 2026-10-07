/**
 * UI v2 批次 C3 · Segmented 断言（§10.2.2：role=group + aria-pressed；选中三重差异）
 * 源码锁式。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('C3 Segmented: role=group + aria-label + 每项 aria-pressed（不是缺省）', () => {
  const s = src('/src/components/ui/Segmented.tsx');
  assert.match(s, /role="group"/);
  assert.match(s, /aria-label=\{label\}/);
  assert.match(s, /aria-pressed=\{active\}/, '当前项 true / 非当前 false 都显式输出');
});

test('C3 Segmented: 选中三重差异（底色+文字色+3px 竖条）；禁用整组变淡+按钮级禁用', () => {
  const s = src('/src/components/ui/Segmented.tsx');
  assert.match(s, /bg-white text-brand shadow-sm/, '选中底+文字色');
  assert.match(s, /w-\[3px\]/, '左竖条');
  assert.match(s, /disabled \? 'opacity-40'/, '禁用变淡');
  assert.match(s, /disabled=\{disabled\}/, '按钮级禁用');
  assert.match(s, /min-h-9/, '命中区 ≥36px（分段控件小档）');
});
