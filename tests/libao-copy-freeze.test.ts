/**
 * UI v2 批次 0 · 梨宝话术冻结门禁（2026-10-07）
 * ============================================================
 * 目的：UI v2 全站改皮期间（批次 A–E），梨宝的话术层一个字都不许动。
 * 机制：对三个话术源文件做「去所有空白后 sha256」，与本文件内硬编码基线比对——
 *       文件被改（哪怕只加一个空格以外的字符）即红。失败信息会给出新哈希，
 *       供人工拍板后**显式**更新基线（更新基线必须在 commit message 申报）。
 * 反向验证锚点（RV，写测试时已实测）：
 *   RV1 ← 改 lbao.ts 任意一个字符 → 「libao.ts」用例红
 *   RV2 ← 改 dialogManager.ts 任意一个字符 → 「dialogManager.ts」用例红
 *   RV3 ← 改 personaCopy.ts 任意一个字符 → 「personaCopy.ts」用例红
 *   RV4 ← 只调整缩进/换行/空格 → 不红（规范化去空白，允许纯排版 PR）
 * 范围说明：这是**全文件哈希**（代码+文案一起冻）。UI v2 各批次不计划改这三个文件；
 *   若批次中确需触碰（如 dialogManager 结构），必须先在 BLOCKERS.md 记录并经人工确认更新基线。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const normSha = (rel: string): string => {
  const raw = readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');
  return createHash('sha256').update(raw.replace(/\s+/g, ''), 'utf8').digest('hex');
};

/** 基线（2026-10-07 批次 0 实测；只随人工拍板更新，禁止为让门禁变绿而改） */
const BASELINE: Record<string, string> = {
  'src/lib/lbao.ts':
    'a9aafed47c00699854b29438584895c0f51dd2a0b2ebf74b09c7cdfce51f3bc1',
  'src/features/libao/dialogManager.ts':
    'a50ba9b8257d44a98b703265811f74007d0335400b3162d8c2c1c06688d7becd',
  'src/features/persona/personaCopy.ts':
    '55e93c71b975e7dd906dff50270ad937b168c441123e276279e653795bab7328',
};

for (const [file, want] of Object.entries(BASELINE)) {
  test(`话术冻结: ${file} 自批次 0 基线后零改动`, () => {
    const got = normSha('/' + file);
    assert.equal(
      got,
      want,
      `话术文件被改动：${file}\n  期望 sha256: ${want}\n  实际 sha256: ${got}\n` +
      `  若为人工拍板的合法改动，请显式更新本测试内 BASELINE 并在 commit message 申报；否则回退该文件。`,
    );
  });
}

test('话术冻结: 规范化管道反向自检（内容变→哈希变；纯空白变→哈希不变）', () => {
  const raw = readFileSync(
    fileURLToPath(new URL('../src/lib/lbao.ts', import.meta.url)), 'utf8',
  );
  const strip = (s: string) => createHash('sha256').update(s.replace(/\s+/g, ''), 'utf8').digest('hex');
  const h1 = strip(raw);
  const h2 = strip(raw + 'x'); // 内容变化必须改变哈希（RV1 机制自证）
  const h3 = strip(raw.replace(/\n/g, '\r\n')); // 纯行尾空白差异不得改变哈希（RV4 机制自证）
  assert.notEqual(h1, h2, '内容变化必须改变哈希（RV1 机制自证）');
  assert.equal(h1, h3, '仅空白差异不得改变哈希（RV4 机制自证）');
});
