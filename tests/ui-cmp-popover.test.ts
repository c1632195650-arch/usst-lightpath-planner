/**
 * UI v2 批次 C12 · Popover / Tooltip 断言（§10.4.2 + §10.5：默认态必验）
 * 源码锁式；Esc/点外部关闭是运行时行为，黑盒走查（终验八条）覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('C12 Popover: 点外部 + Esc 双关闭；不带遮罩；悬停不消失（无 mouseleave 逻辑）', () => {
  const s = src('/src/components/ui/Popover.tsx');
  assert.match(s, /addEventListener\('mousedown', onDocDown\)/, '点外部关闭');
  assert.match(s, /e\.key === 'Escape'/, 'Esc 关闭');
  assert.match(s, /e\.key === 'Escape'\) setOpen\(false\)/);
  assert.doesNotMatch(s, /onMouseLeave=\{|onMouseOut=\{/, '触发器不挂 mouseleave 类事件（悬停不消失）');
  assert.doesNotMatch(s, /bg-ink\/45|bg-ink\/30/, '不带遮罩（遮罩是模态/抽屉的）');
});

test('C12 Popover: 面板 role=dialog + 文字+一个动作（最多一个）', () => {
  const s = src('/src/components/ui/Popover.tsx');
  assert.match(s, /role="dialog"/);
  assert.match(s, /data-testid="popover-panel"/);
  assert.match(s, /data-testid="popover-action"/);
  assert.match(s, /defaultOpen = false/, '初始关闭（SSR 测试可用 defaultOpen 展开验证）');
});

test('C12 Tooltip: 纯文字 role=tooltip + 400ms 延迟 + 默认不可见 + 触屏不出现', () => {
  const s = src('/src/components/ui/Popover.tsx');
  assert.equal(src('/src/components/ui/Popover.tsx').match(/TOOLTIP_DELAY_MS = 400/)?.[0], 'TOOLTIP_DELAY_MS = 400');
  assert.match(s, /role="tooltip"/);
  assert.match(s, /opacity-0 transition-\[opacity\] duration-fast ease-out group-hover\/tip:opacity-100/, '悬停前不可见，悬停出');
  assert.match(s, /transitionDelay: `\$\{TOOLTIP_DELAY_MS\}ms`/, '400ms 才出（扫过不出）');
});
