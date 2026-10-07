/**
 * UI v2 批次 C6 · Tag 断言（§10.2.5：分类/状态七 tone；未读=小圆点，数量=数字，不混用）
 * 源码锁式。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('C6 Tag: 七 tone 全在映射表（含上理红 school 与 gold）', () => {
  const s = src('/src/components/ui/Tag.tsx');
  for (const tone of ['neutral', 'brand', 'ok', 'warn', 'danger', 'gold', 'school']) {
    assert.match(s, new RegExp(`\\b${tone}: '`), `${tone} tone 在映射表`);
  }
  assert.match(s, /school: 'border-school-red\/20 bg-school-light text-school-red'/, '上理红浅底语义');
  assert.match(s, /rounded-full/, '胶囊形');
});

test('C6 Tag: dot 7px 小圆点与 count 数字徽标互不混用（dot 在场抑制 count）', () => {
  const s = src('/src/components/ui/Tag.tsx');
  assert.match(s, /h-\[7px\] w-\[7px\]/, '未读=7px 小圆点');
  assert.match(s, /\{!dot && count != null && \(/, 'dot 在场时抑制 count（规则硬编码在渲染层）');
});
