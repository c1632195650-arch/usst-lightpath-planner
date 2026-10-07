/**
 * UI v2 批次 E1 · 图标体系断言（源码锁式 + 数据真读）
 * RV-E1-1 ← sprite 少于 90 枚 → 「90 枚齐全」红
 * RV-E1-2 ← 线宽补偿表数值漂移 → 「五档阶梯」红
 * RV-E1-3 ← 图标吃 fill/换色 → 「currentColor 单色」红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('E1 sprite: 90 枚齐全 = 72 功能 + 12 上理建筑 + 6 微几何（RV-E1-1）', () => {
  const paths = src('/src/components/icons/iconPaths.ts');
  const entries = paths.match(/'^[^']+', \{ viewBox:/g) ?? paths.match(/'[a-z0-9-]+': \{ viewBox:/g) ?? [];
  assert.equal(entries.length, 90, `实际 ${entries.length} 枚`);
  for (const b of ['men', 'lib', 'yates', 'hall', 'sci', 'dorm', 'gym', 'ave', 'liu', 'brick', 'river', 'park']) {
    assert.match(paths, new RegExp(`'${b}': \\{ viewBox:`), `建筑 ${b} 在列`);
  }
  for (const g of ['mg-tri', 'mg-diamond', 'mg-circle', 'mg-square', 'mg-star', 'mg-hex']) {
    assert.match(paths, new RegExp(`'${g}': \\{ viewBox: '12`), `微几何 ${g} 12 viewBox`);
  }
});

test('E1 Icon 组件: 五档尺寸/线宽补偿表照抄 §9.3（RV-E1-2）', () => {
  const s = src('/src/components/icons/Icon.tsx');
  assert.match(s, /xs: \{ px: 14, width: 2\.4 \}/);
  assert.match(s, /sm: \{ px: 16, width: 2\.2 \}/);
  assert.match(s, /md: \{ px: 20, width: 2 \}/, 'md★ 默认');
  assert.match(s, /lg: \{ px: 24, width: 1\.8 \}/);
  assert.match(s, /xl: \{ px: 32, width: 1\.6 \}/);
  assert.match(s, /size = 'md'/, '缺省 md★');
});

test('E1 Icon 组件: currentColor 单色 + round 端点 + 纯装饰 aria-hidden 缺省（RV-E1-3）', () => {
  const s = src('/src/components/icons/Icon.tsx');
  assert.match(s, /stroke=\{micro \? 'none' : 'currentColor'\}/, '描边吃 currentColor');
  assert.match(s, /fill=\{micro \? 'currentColor' : 'none'\}/, '微几何实心，功能图标 none');
  assert.match(s, /strokeLinecap="round"/, 'round 端点（§9 尖角小尺寸崩）');
  assert.match(s, /strokeLinejoin="round"/);
  assert.match(s, /'aria-hidden': true/, '缺省纯装饰');
  assert.match(s, /role: 'img', 'aria-label': label/, 'label 语义件可选');
});
