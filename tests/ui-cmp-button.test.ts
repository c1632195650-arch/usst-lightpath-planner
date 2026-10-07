/**
 * UI v2 批次 C1 · Button 8 态断言（§10.1 / §10.5 覆盖矩阵）
 * 仓规：零依赖 runner（Node 原生剥类型）编译不了 JSX——组件一律 readFileSync 源码锁；
 * 类名片段与 SSR 实测产出一一对应（批次 C 落地时已探针核对）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('C1 Button: 语义五 variant 齐全（含上理红）+ 两尺寸最小高', () => {
  const s = src('/src/components/ui/Button.tsx');
  for (const v of ['primary', 'secondary', 'ghost', 'danger', 'red']) {
    assert.match(s, new RegExp(`\\b${v}:`), `variant ${v} 在映射表`);
  }
  assert.match(s, /red: 'bg-school-red text-white/, '上理红语义在位');
  assert.match(s, /sm: 'px-3 py-2 text-xs min-h-9'/, 'sm=36px 档');
  assert.match(s, /md: 'px-4 py-3 text-sm min-h-11'/, 'md=44px 档');
});

test('C1 Button: disabled 态——原生禁用 + opacity-40 + 不可点（不是只变淡）', () => {
  const s = src('/src/components/ui/Button.tsx');
  assert.match(s, /disabled=\{disabled \|\| busy\}/, 'loading 与 disabled 都落原生 disabled');
  assert.match(s, /disabled:pointer-events-none disabled:opacity-40/, '变淡+关指针事件');
});

test('C1 Button: loading 态——宽高不变（文字透明占位）+ 15px spinner + aria-busy', () => {
  const s = src('/src/components/ui/Button.tsx');
  assert.match(s, /aria-busy=\{busy \|\| undefined\}/, 'aria-busy 对读屏与测试可见');
  assert.match(s, /busy \? 'text-transparent' : ''/, '文字转透明占位（宽高不变的核心）');
  assert.match(s, /width="15"\s*\n?\s*height="15"/, '15px spinner');
  assert.match(s, /\[animation:ui-spin_1\.1s_linear_infinite\]/, '1.1s linear 旋转');
  assert.match(s, /\{busy && <Spinner \/>}/, 'spinner 绝对居中叠加，不占布局');
});

test('C1 Button: focus-visible 双环 + active 缩放(.985) + 时长档位（fast/instant）', () => {
  const s = src('/src/components/ui/Button.tsx');
  assert.match(s, /focus-visible:shadow-\[0_0_0_2px_#fff,0_0_0_4px_#4A73D1\]/, '2px 外环+2px 白隔离圈');
  assert.match(s, /active:scale-\[\.985\]/, '按下 scale(.985)');
  assert.match(s, /duration-fast ease-out/, 'hover 140ms 档');
  assert.match(s, /active:duration-instant/, 'active 90ms 档');
});
