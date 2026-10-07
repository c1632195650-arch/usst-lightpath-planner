/**
 * UI v2 批次 C2 · IconButton 断言（§10.2.1：命中区强制 44×44；选中三重差异）
 * 源码锁式（零依赖 runner 编译不了 JSX；类名与 SSR 实测产出核对过）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('C2 IconButton: 命中区 44×44 + 图标 17px + aria-label 必挂', () => {
  const s = src('/src/components/ui/IconButton.tsx');
  assert.match(s, /h-11 w-11/, '命中区 44×44（图标小不等于能点的地方小）');
  assert.match(s, /\[&>svg\]:h-\[17px\] \[&>svg\]:w-\[17px\]/, '图标视觉 17px');
  assert.match(s, /aria-label=\{label\}/, '无障碍名必填');
  assert.match(s, /label: string/, 'label 是必填 prop（类型层强制）');
});

test('C2 IconButton: selected 态——aria-pressed + 三重差异类在位', () => {
  const s = src('/src/components/ui/IconButton.tsx');
  assert.match(s, /aria-pressed=\{selected\}/, 'toggle 语义对读屏可见');
  assert.match(s, /border-brand bg-brand text-white/, '选中=底色+文字色');
  assert.match(s, /w-\[3px\]/, '3px 左竖条（三重差异之一）');
});

test('C2 IconButton: disabled + focus 双环 + active 缩放', () => {
  const s = src('/src/components/ui/IconButton.tsx');
  assert.match(s, /disabled=\{disabled\}/);
  assert.match(s, /disabled:pointer-events-none disabled:opacity-40/);
  assert.match(s, /focus-visible:shadow-\[0_0_0_2px_#fff,0_0_0_4px_#4A73D1\]/);
  assert.match(s, /active:scale-\[\.985\]/);
});
