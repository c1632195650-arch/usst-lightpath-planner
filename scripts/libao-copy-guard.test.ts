/**
 * W5c（2026-10-07）· 梨宝呈现面口吻纪律：源码禁「宝子」
 * ============================================================
 * CY 反馈②：闲聊口吻要去命令化、去强亲密称呼 ——「宝子」这类称呼首句禁用。
 * 机械扫描 LbaoChat.tsx 源码，防回潮（历史注释/测试夹具里的旧口吻数据不算 ——
 * 本守卫只锁**我们主动渲染**的文案源码）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'features', 'libao', 'LbaoChat.tsx'), 'utf8');

test('W5c · LbaoChat 源码不得出现「宝子」字面量（口吻纪律防回潮）', () => {
  assert.ok(!src.includes('宝子'), 'LbaoChat.tsx 出现「宝子」—— W5c 口吻纪律被破坏');
});

test('W5a · 引导话术去命令化：QUICK 与开场白不得再教「帮我排/排一下」', () => {
  // 只扫**会渲染给用户**的行：跳过纯注释行（注释可以解释历史口径，不面向用户）
  const visible = src.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  for (const banned of ['帮我安排这周', '帮我排', '给我排', '排一下']) {
    assert.ok(!visible.includes(banned), `LbaoChat.tsx 面向用户的文案出现命令式话术「${banned}」—— W5a 被破坏`);
  }
});
