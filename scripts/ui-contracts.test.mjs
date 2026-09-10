import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/** 直接锁定本次两处交互回归，避免为项目额外引入浏览器测试依赖。 */
test('画像问卷只在用户明确点击后前进', async () => {
  const source = await readFile(new URL('../src/features/persona/PersonaFlow.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /setTimeout/);
  assert.match(source, /onClick=\{goNext\} disabled=\{!answered\}/);
});

/** 对话页只保留消息列表滚动，外层固定在当前视口内。 */
test('梨宝页面只有消息列表承担纵向滚动', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const chat = await readFile(new URL('../src/features/libao/LbaoChat.tsx', import.meta.url), 'utf8');

  assert.match(app, /isLbaoTab \? 'h-dvh overflow-hidden'/);
  assert.match(chat, /no-scrollbar[^"']*overflow-y-auto/);
  assert.doesNotMatch(chat, /h-\[calc\(/);
});
