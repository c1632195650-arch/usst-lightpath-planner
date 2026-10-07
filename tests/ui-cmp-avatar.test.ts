/**
 * UI v2 批次 C8 · Avatar 断言（§10.3.2：26/38/56 三档；在线圆点+2px 白描边；组重叠 9px 折叠 +N）
 * 源码锁式。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('C8 Avatar: 三档尺寸映射 + name 首字 + sr-only 全名', () => {
  const s = src('/src/components/ui/Avatar.tsx');
  assert.match(s, /26: 'h-\[26px\] w-\[26px\] text-\[10px\]'/, '26px 档');
  assert.match(s, /38: 'h-\[38px\] w-\[38px\] text-sm'/, '38px 档');
  assert.match(s, /56: 'h-14 w-14 text-lg'/, '56px 档');
  assert.match(s, /name \? name\.slice\(0, 1\) : '\?'/, '首字入头像');
  assert.match(s, /sr-only">\{name\}<\/span>/, '全名给读屏');
});

test('C8 Avatar: online 圆点 10px + 2px 白描边 + aria 在线', () => {
  const s = src('/src/components/ui/Avatar.tsx');
  assert.match(s, /h-2\.5 w-2\.5 rounded-full border-2 border-white bg-ok/, '10px 圆点+白描边+ok 色');
  assert.match(s, /aria-label="在线"/);
});

test('C8 AvatarGroup: 重叠 9px + 最多 3 个再折叠 +N', () => {
  const s = src('/src/components/ui/Avatar.tsx');
  assert.match(s, /names\.slice\(0, 3\)/, '最多显示 3 个');
  assert.match(s, /-ml-\[9px\]/, '重叠 9px');
  assert.match(s, /extra \?\? Math\.max\(0, names\.length - 3\)/, '剩余数折叠成 +N');
  assert.match(s, /\+\{rest\}/, '+N 渲染');
});
