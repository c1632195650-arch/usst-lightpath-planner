/**
 * UI v2 批次 C7 · Progress 断言（§10.3.1 / §10.5：默认/禁用/加载/错误必验；环形数字在中心）
 * 源码锁式。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('C7 线性: role=progressbar + aria 三值 + 数值 tabular', () => {
  const s = src('/src/components/ui/Progress.tsx');
  assert.match(s, /role="progressbar"/);
  assert.match(s, /aria-valuemin=\{0\}/);
  assert.match(s, /aria-valuemax=\{100\}/);
  assert.match(s, /aria-valuenow=\{loading \|\| indeterminate \? undefined : pct\}/, '确定态报值/不确定态置空');
  assert.match(s, /tabular-nums/, '数值等宽');
});

test('C7 线性: 进行中斜纹（reduced-motion 静止但保留）+ 禁用/错误/加载三态', () => {
  const s = src('/src/components/ui/Progress.tsx');
  assert.match(s, /progress-stripes/, '斜纹=仍在推进');
  assert.match(s, /aria-disabled=\{disabled \|\| undefined\}/, '禁用可达');
  assert.match(s, /error \? 'bg-danger' : 'bg-brand'/, '错误轨道转 danger');
  assert.match(s, /loading \? 'w-full bg-ink\/15'/, '加载态整条骨架灰');
  const css = src('/src/index.css');
  assert.match(css, /\.progress-stripes \{/, '斜纹样式入库');
  assert.match(css, /@keyframes progress-stripes-move/, '斜纹动画关键帧在位');
});

test('C7 环形: 数字写在中心（不让人目测弧长）+ stroke-dashoffset 同步', () => {
  const s = src('/src/components/ui/Progress.tsx');
  assert.match(s, /absolute text-sm font-semibold text-ink tabular-nums">\{pct\}%/, '百分比在环心');
  assert.match(s, /strokeDashoffset=\{c \* \(1 - pct \/ 100\)\}/, '弧长同步数值');
  assert.match(s, /aria-valuenow=\{pct\}/, '环形也报 aria 值');
});
