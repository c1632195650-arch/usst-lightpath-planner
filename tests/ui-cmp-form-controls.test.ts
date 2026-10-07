/**
 * UI v2 批次 C4 · 表单三件套断言（§10.2.3：外置 label / 占位符 #6E7688 / 错误说怎么改 / 禁用）
 * 源码锁式。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('C4 FieldShell: 外置 label 在上方（htmlFor 配对）+ 必填 * + 框下提示', () => {
  const s = src('/src/components/ui/FormControls.tsx');
  assert.match(s, /<label htmlFor=\{htmlFor\}/, '外置 label（不用占位符代替标签）');
  assert.match(s, /required && <span className="ml-0\.5 text-\[#B0402F\]" aria-hidden="true">\*<\/span>/, '必填 * 标出');
  assert.match(s, /role=\{error \? 'alert' : undefined\}/, '错误提示对读屏可达');
  assert.match(s, /error \? 'text-\[#B0402F\]' : 'text-ink-faint'/, '错误红/提示灰分色');
});

test('C4 占位符 #6E7688（4.56:1）+ 聚焦双环+光晕 + 错误边框 danger', () => {
  const s = src('/src/components/ui/FormControls.tsx');
  assert.match(s, /placeholder:text-\[#6E7688\]/, '占位符对比度达标');
  assert.match(s, /focus:shadow-\[0_0_0_2px_#fff,0_0_0_4px_#4A73D1/, '聚焦 2px 外环+光晕（不是只有颜色变深）');
  assert.match(s, /border-\[#B0402F\]/, '错误边框转 --danger-text');
  assert.match(s, /aria-invalid=\{error \|\| undefined\}/, 'aria-invalid 挂上');
});

test('C4 禁用态 + Textarea 两行高内部滚动', () => {
  const s = src('/src/components/ui/FormControls.tsx');
  assert.match(s, /disabled:cursor-not-allowed disabled:bg-paper disabled:opacity-60/, '禁用三件套');
  assert.match(s, /min-h-\[4\.2rem\] resize-none overflow-y-auto/, '两行可见高度、超出内部滚动');
});
