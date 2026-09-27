/**
 * S 批 S2 · 排程会话 E2E 走查（手动验收资产，与 e2e-journey.mjs 同级、不进 CI 门禁）
 * ============================================================
 * 三条剧本（对应 CY 诉求：追问中插话不丢态 / 连续 2 轮无关才作废 / 显式退出）：
 *   A 折返：追问中插一句无关 → 会话保留（徽章还在 + 有声提醒）→ 分号答案照收出草稿
 *   B 作废：连续 2 轮无关 → 作废并说明（不静默），徽章消失
 *   C 退出：追问中说「退出排程」→ 回执 + 徽章消失
 *
 * 运行（需要 5173 前端在跑；后端可选 —— 三条剧本的排程链路纯本地，RAG 挂了反而
 * 正好验证「不掉 RAG」）：
 *   node scripts/e2e-sched-session.mjs [baseURL=http://127.0.0.1:5173]
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) { passed += 1; console.log(`  ✓ ${label}`); }
  else { failed += 1; console.log(`  ✗ ${label}`); }
}

const SEED = '我要报名数学建模，帮我规划备赛';
const BADGE = '[data-testid="sched-badge"]';

/** 把一次问卷旅程走完，落到主界面（与 e2e-journey.mjs 同一段成熟路径） */
async function onboard(page) {
  const T = (ms) => page.waitForTimeout(ms);
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await T(800);

  await page.getByRole('button', { name: '开始画像测评' }).click();
  await T(500);
  await page.getByPlaceholder('怎么称呼你').fill('走查生');
  await page.locator('select').first().selectOption('2');
  await page.getByPlaceholder('如：光电学院').fill('光电学院');
  await page.locator('select').nth(1).selectOption('军工路本部');
  await page.getByRole('button', { name: /下一步/ }).click();
  await T(500);

  // 问卷自动作答：点可选项直到结果页
  // ⚠️ 选项点击后有 advancing 过渡（全部按钮短暂 disabled）——此时不能去点「下一步」，
  //    否则 locator 会挂着等它 enabled 卡死 30s（首次走查实测抓到）。
  for (let i = 0; i < 80; i++) {
    if (await page.getByText('你的节奏，已经有了轮廓').isVisible().catch(() => false)) break;
    const opt = page.locator('button[aria-pressed]:enabled').first();
    if (await opt.count()) { await opt.click().catch(() => {}); await page.waitForTimeout(420); continue; }
    const next = page.getByRole('button', { name: /下一步|生成我的画像/ }).first();
    if (await next.count() && await next.isEnabled().catch(() => false)) {
      await next.click().catch(() => {});
      await page.waitForTimeout(420);
    } else {
      await page.waitForTimeout(300);
    }
  }
  ok(await page.getByText('你的节奏，已经有了轮廓').isVisible().catch(() => false), '引导：画像结果页可达');

  await page.getByRole('button', { name: /进入|看看/ }).first().click().catch(() => {});
  await T(900);
  await page.getByRole('button', { name: /梨宝/ }).first().click();
  await T(600);
}

/** 发一句话并等梨宝回完（loading 消失）。
 *  placeholder 在 collect 态会换成「排程中 ——」文案（S2 的 UI 信号之一），两个都要认。 */
async function say(page, text) {
  await page.getByPlaceholder(/问梨宝|排程中/).fill(text);
  await page.getByRole('button', { name: '发送' }).click();
  await page.waitForFunction(
    () => !document.body.innerText.includes('掐指一算'),
    null,
    { timeout: 15000 },
  ).catch(() => {});
  await page.waitForTimeout(500);
}

const run = async () => {
  const browser = await chromium.launch();

  // ── 剧本 A：折返 —— 插话不丢态，分号答案照收 ──
  {
    const page = await browser.newPage();
    await onboard(page);
    await say(page, SEED);
    ok(await page.locator(BADGE).isVisible().catch(() => false), 'A1 追问态徽章出现');
    ok(await page.getByText('可以用分号一起答', { exact: false }).first().isVisible().catch(() => false), 'A2 追问带分号尾注');
    ok(
      await page.getByPlaceholder(/排程中/).count() > 0,
      'A2b collect 态输入框 placeholder 换排程文案',
    );

    await say(page, '图书馆几点开门'); // 无关插话
    ok(
      await page.getByText('先把刚才的事定完', { exact: false }).first().isVisible().catch(() => false),
      'A3 插话后保留式提醒（有声，不静默掉 RAG）',
    );
    ok(await page.locator(BADGE).isVisible().catch(() => false), 'A4 折返后徽章仍在');

    await say(page, '十月中旬开始；每周3次、每次2小时');
    ok(
      await page.getByRole('button', { name: '就这么排' }).first().isVisible().catch(() => false),
      'A5 分号答案被收进槽位 → 草稿卡出现',
    );
    ok(!(await page.locator(BADGE).isVisible().catch(() => false)), 'A6 补齐出草稿 → 会话回 idle，徽章消失');
    await page.close();
  }

  // ── 剧本 B：连续 2 轮无关才作废（作废前先说明，不静默） ──
  {
    const page = await browser.newPage();
    await onboard(page);
    await say(page, SEED);
    await say(page, '学校最近有什么社团活动'); // 第 1 轮无关（不含时间词，防被 when 槽收走）
    ok(
      await page.getByText('先把刚才的事定完', { exact: false }).first().isVisible().catch(() => false),
      'B1 第 1 轮无关：会话保留',
    );
    ok(await page.locator(BADGE).isVisible().catch(() => false), 'B2 第 1 轮无关：徽章仍在');
    await say(page, '食堂二楼有什么好吃的'); // 第 2 轮无关
    ok(
      await page.getByText('连着两轮没对上', { exact: false }).first().isVisible().catch(() => false),
      'B3 第 2 轮无关：作废并说明（不静默）',
    );
    ok(!(await page.locator(BADGE).isVisible().catch(() => false)), 'B4 作废后徽章消失');
    await page.close();
  }

  // ── 剧本 C：显式退出 ──
  {
    const page = await browser.newPage();
    await onboard(page);
    await say(page, SEED);
    ok(await page.locator(BADGE).isVisible().catch(() => false), 'C1 追问态在会话中');
    await say(page, '退出排程');
    ok(
      await page.getByText('好，先不排了', { exact: false }).first().isVisible().catch(() => false),
      'C2 退出回执',
    );
    ok(!(await page.locator(BADGE).isVisible().catch(() => false)), 'C3 退出后徽章消失');
    await page.close();
  }

  await browser.close();
  console.log(`\n结果：${passed} 过 / ${failed} 挂`);
  process.exit(failed > 0 ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
