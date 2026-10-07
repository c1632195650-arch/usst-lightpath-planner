/**
 * UI v2 批次 C5 · 开关/复选/单选断言（§10.2.4：native + role=switch / accent-brand / 键盘可达）
 * 源码锁式。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('C5 Switch: role=switch + 文案在左拨杆在右（不给是/否标签）+ 禁用变淡', () => {
  const s = src('/src/components/ui/Switch.tsx');
  assert.match(s, /role="switch"/, '拨杆语义');
  assert.match(s, /checked=\{checked\}/, '开关态可达');
  assert.match(s, /<span className="text-sm text-ink">\{label\}<\/span>/, '文案在左');
  assert.match(s, /appearance-none rounded-full border/, 'native checkbox 拨杆化');
  assert.match(s, /\{disabled \? 'opacity-40' : ''\}/, '禁用变淡');
  assert.match(s, /checked:border-brand checked:bg-brand/, '开启=brand');
});

test('C5 Checkbox/Radio: native input + accent-brand + 双环焦点 + min-h-11 命中', () => {
  const s = src('/src/components/ui/Switch.tsx');
  assert.match(s, /type="checkbox"/);
  assert.match(s, /type="radio"/);
  assert.match(s, /accent-brand/, 'native accent 上色');
  assert.match(s, /focus-visible:shadow-\[0_0_0_2px_#fff,0_0_0_4px_#4A73D1\]/, '双环焦点（键盘可达）');
  assert.match(s, /min-h-11/, '命中区 ≥44px');
});
