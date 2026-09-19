/**
 * E2E 冒烟三件套（P1#9 · 2026-09-19）
 * ====================================
 * 首版只覆盖**入口页**（新用户第一眼，内容静态、可稳定基线）。
 * 更深路径（周计划/梨宝对话）需要种入画像状态后才能到——下一轮做状态种子夹具再扩。
 *
 * 三件：
 *  ① 可访问性：axe 扫描 wcag2a/2aa/21a/21aa，serious/critical 违规 = 0（运行时闸，
 *     与 eslint-plugin-jsx-a11y 的静态闸互为双保险）；
 *  ② 结构快照：ARIA 树可读（防止只有样式没有语义）；
 *  ③ 视觉基线：入口页截图对齐基线（动态内容出现后必须加 mask，否则天天红）。
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
});

test('可访问性：无 serious/critical 违规', async ({ page }) => {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, bad.map((v) => `${v.id}: ${v.description}`).join('；')).toEqual([]);
});

test('结构快照：页面有可读的标题语义', async ({ page }) => {
  const h1 = page.locator('h1');
  await expect(h1).toHaveCount(1);
  await expect(h1).not.toBeEmpty();
});

test('视觉基线：入口页', async ({ page }) => {
  await expect(page).toHaveScreenshot('entry.png', {
    maxDiffPixelRatio: 0.02,
    animations: 'disabled',
    fullPage: true,
  });
});
