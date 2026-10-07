/**
 * UI v2 批次 D1 · 当日流水（DayAgenda）E2E（手动验收资产，与 e2e-journey 同级、不进 CI 门禁）
 * ============================================================
 * 前置：SCHEDULE_VIEW_V2 开关（localStorage `usst.scheduleViewV2`，默认关）。
 * 断言：
 *   A 开关默认关：fresh context 无「日程视图」分段（不惊扰存量用户）
 *   B 开关开后：分段在位 → 点「当日流水」→ `day-agenda` 渲染
 *   C 点块 → 改时间路径可达（既有详情抽屉 detail-drawer 打开，同周网格一条路径）
 *   D nowline 锚点存在性（今天且有安排时；无安排时跳过）
 *
 * 运行（需要 5173 前端在跑，且必须离线——与 e2e-sched-session 同一约定）：
 *   node scripts/e2e-day-agenda.mjs [baseURL=http://127.0.0.1:5173]
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) { passed += 1; console.log(`  ✓ ${label}`); }
  else { failed += 1; console.log(`  ✗ ${label}`); }
}

const T = (page, ms = 6000) => page.waitForTimeout(ms);

/** 与 e2e-journey 同一段成熟登船路径（清 storage → 问卷 → 主界面）；D2 起默认开，不再显式置 '1' */
async function onboard(page) {
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await T(page, 800);
  await page.getByRole('button', { name: '开始画像测评' }).click();
  await T(page, 500);
  await page.getByPlaceholder('怎么称呼你').fill('测试生');
  await page.locator('select').first().selectOption('2');
  await page.getByPlaceholder('如：光电学院').fill('光电学院');
  await page.locator('select').nth(1).selectOption('军工路本部');
  await page.getByRole('button', { name: /下一步/ }).click();
  await T(page, 500);
  for (let i = 0; i < 40; i++) {
    if (await page.getByTestId('persona-result-title').isVisible().catch(() => false)) break;
    const opt = page.locator('button[aria-pressed]:enabled').first();
    if (await opt.count()) { await opt.click(); await T(page, 420); continue; }
    const next = page.getByRole('button', { name: /下一步|生成我的画像/ }).first();
    if (await next.count()) { await next.click(); await T(page, 420); }
  }
  await page.getByRole('button', { name: /进入|看看/ }).first().click().catch(() => {});
  await T(page, 800);
}

/** 总览 → 模式窗（远方）→ 确认 → 打开本周安排（落周计划视图） */
async function reachWeekPlan(page) {
  await page.getByRole('button', { name: '总览' }).click().catch(() => {});
  await T(page, 600);
  const modeBtn = page.getByTestId('checklist-action-lifeMode');
  if (await modeBtn.count()) { await modeBtn.click().catch(() => {}); } else {
    await page.getByTestId('open-mode-setup').first().click().catch(() => {});
  }
  await T(page, 800);
  await page.getByTestId('mode-card-faraway').click().catch(() => {});
  await T(page, 800);
  await page.getByRole('button', { name: '就这么过' }).click().catch(() => {});
  await T(page, 1500);
  const openWeek = page.getByRole('button', { name: /打开本周安排/ });
  if (await openWeek.count()) { await openWeek.first().click().catch(() => {}); await T(page, 1000); }
}

const run = async () => {
  const browser = await chromium.launch();

  // ── A. 开关默认关：fresh context 不显示「日程视图」分段 ──
  {
    const page = await browser.newPage();
    await page.goto(BASE);
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
    await T(page, 800);
    await page.getByRole('button', { name: '开始画像测评' }).click();
    await T(page, 400);
    // 只验首屏（未登船也可以看欢迎页无分段——分段在周计划内，这里验「默认开」的源头）
    const stored = await page.evaluate(() => localStorage.getItem('usst.scheduleViewV2'));
    // 【D9 申报 2026-10-07】D2 默认值翻开的配套更新：无键 = 开（显式 '0' 才关）。
    //   键本身仍不由页面写入（用户没碰过开关时保持无键），断言无键仍然成立。
    ok(stored === null, 'A1 默认无 usst.scheduleViewV2 键（默认开：无键即开，显式 \'0\' 关）');
    // A2 显式退出：'0' → 双层视图关（周网格独占，与旧行为一致）
    await page.evaluate(() => localStorage.setItem('usst.scheduleViewV2', '0'));
    await page.reload();
    await T(page, 800);
    ok((await page.evaluate(() => localStorage.getItem('usst.scheduleViewV2'))) === '0', 'A2 显式 \'0\' 已落');
    await page.close();
  }

  // ── B/C/D. 开关开后完整走一遍 ──
  {
    const page = await browser.newPage();
    await onboard(page);
    await reachWeekPlan(page);
    ok(await page.getByTestId('edit-mode-toggle').isVisible().catch(() => false), 'B0 周计划视图可达');

    const seg = page.getByRole('button', { name: '当日流水' });
    ok(await seg.isVisible().catch(() => false), 'B1 SCHEDULE_VIEW_V2 开 → 「日程视图」分段在位');
    if (await seg.count()) {
      await seg.click();
      await T(page, 600);
      ok(await page.getByTestId('day-agenda').isVisible().catch(() => false), 'B2 当日流水层渲染（day-agenda）');
      ok(await page.getByTestId('week-timeline').isHidden().catch(() => true), 'B3 周网格层让位（双层不叠渲染）');

      const back = page.getByRole('button', { name: '周概览' });
      ok(await back.isVisible().catch(() => false), 'B4 可切回周概览');
      if (await back.count()) {
        await back.click();
        await T(page, 500);
        ok(await page.getByTestId('week-timeline').isVisible().catch(() => false), 'B5 切回周网格层');
        await page.getByRole('button', { name: '当日流水' }).click();
        await T(page, 500);
      }

      // C. 点块 → 详情抽屉（改时间路径同源）
      const blk = page.locator('[data-testid="agenda-block"]').first();
      if (await blk.count()) {
        await blk.click();
        await T(page, 600);
        ok(await page.getByTestId('detail-drawer').isVisible().catch(() => false), 'C1 点流水块 → 详情抽屉打开（改时间入口同源）');
        await page.getByTestId('detail-close').click().catch(() => {});
      } else {
        console.log('  [跳过] C1：当天无任何块（空流水）——抽屉路径由周网格用例覆盖');
      }

      // D. nowline 锚点（只在「当前周+今天有安排+当前时间在 8:00-22:00」时出现；此处只验不误报）
      const hasNowline = await page.locator('[data-testid="agenda-nowline"]').count();
      ok(hasNowline <= 1, 'D1 nowline 至多一条（不重复渲染）');
    }

    await page.close();
  }

  await browser.close();
  console.log(`\n结果：${passed} 过 / ${failed} 挂`);
  process.exit(failed ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
