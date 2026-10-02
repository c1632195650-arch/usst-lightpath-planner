/**
 * 梨宝排程交互 · 活体验收剧本（7 条，**需要活后端 + 活 vite**；手动验收资产，不进 CI 门禁）
 * ============================================================
 * 对应工作单：docs/libao-sched-interaction-upgrade-plan-2026-10-02.md §七「真机剧本」。
 * 与 e2e-sched-session.mjs（离线规则口径）互补：本脚本走 **live LLM**，
 * 验的是「在线对话管理器 + 按钮卡 + 类目推荐」这条生产路径。
 *
 * 前置（缺一不可，否则会静默降级成规则层、断言失真）：
 *   1) 后端：`PORT=8003 python server/app.py`（要 .env 里有 LLM_API_KEY）
 *   2) 前端：**必须用 5173 或 5174**（server/app.py 的 CORS 白名单只放行这两个；
 *      其他端口会被浏览器 CORS 拒 → plan/understand 静默失败 → 退化成规则层），
 *      且必须 `VITE_API_BASE=http://127.0.0.1:8003`（api.ts 默认打 8000，会连空）：
 *        VITE_API_BASE=http://127.0.0.1:8003 npx vite --port 5173 --strictPort
 *
 * 运行：node scripts/e2e-libao-live.mjs http://127.0.0.1:5173
 *
 * 断言口径：读 `[aria-live="polite"]` 消息容器气泡文本（**勿用 body.innerText 差分**——
 * 历史消息会污染断言；这是本轮终验踩过的坑）。
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log(`  ✓ ${label}`); }
  else { failed += 1; console.log(`  ✗ ${label}`); }
}

async function onboard(page) {
  const T = (ms) => page.waitForTimeout(ms);
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload(); await T(800);
  await page.getByRole('button', { name: '开始画像测评' }).click(); await T(500);
  await page.getByPlaceholder('怎么称呼你').fill('终验生');
  await page.locator('select').first().selectOption('2');
  await page.getByPlaceholder('如：光电学院').fill('光电学院');
  await page.locator('select').nth(1).selectOption('军工路本部');
  await page.getByRole('button', { name: /下一步/ }).click(); await T(500);
  for (let i = 0; i < 80; i++) {
    if (await page.getByText('你的节奏，已经有了轮廓').isVisible().catch(() => false)) break;
    const opt = page.locator('button[aria-pressed]:enabled').first();
    if (await opt.count()) { await opt.click().catch(() => {}); await page.waitForTimeout(420); continue; }
    const next = page.getByRole('button', { name: /下一步|生成我的画像/ }).first();
    if (await next.count() && await next.isEnabled().catch(() => false)) { await next.click().catch(() => {}); await page.waitForTimeout(420); }
    else await page.waitForTimeout(300);
  }
  await page.getByRole('button', { name: /进入|看看/ }).first().click().catch(() => {}); await T(900);
  await page.getByRole('button', { name: /梨宝/ }).first().click(); await T(600);
  await page.locator('[data-testid="mode-sched"]').click().catch(() => {}); await T(300);
}

/** 消息总数（用于定位本轮新增） */
const msgCount = (page) => page.evaluate(() => {
  const c = document.querySelector('[aria-live="polite"]');
  return c ? c.children.length : 0;
});
/** 从第 n 条起的所有气泡文本拼接 */
const msgsFrom = (page, n) => page.evaluate((start) => {
  const c = document.querySelector('[aria-live="polite"]');
  if (!c) return '';
  return Array.from(c.children).slice(start).map((k) => k.innerText).join('\n---\n');
}, n);

async function say(page, text, waitMs = 25000) {
  const n = await msgCount(page);
  await page.getByTestId('libao-input').fill(text);
  await page.getByRole('button', { name: '发送' }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('掐指一算'), null, { timeout: waitMs }).catch(() => {});
  await page.waitForTimeout(1000);
  return msgsFrom(page, n);
}
const lastOptions = (page) => page.evaluate(() => {
  const groups = document.querySelectorAll('[data-testid="msg-options"]');
  if (!groups.length) return [];
  return Array.from(groups[groups.length - 1].querySelectorAll('button')).map((b) => b.innerText.trim().replace(/\n/g, ' / '));
});

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const apiCalls = [];
  page.on('request', (r) => { if (r.url().includes('/api/plan/understand')) apiCalls.push(r.url()); });
  page.on('requestfailed', (r) => { if (r.url().includes('/api/')) console.log('   [REQFAIL]', r.url(), r.failure()?.errorText); });

  await onboard(page);
  const boot = await page.locator('body').innerText();
  ok(!/校园资料服务未连接/.test(boot), '环境自检：后端已连（无「校园资料服务未连接」）');

  const shot = (d, n = 300) => d.replace(/\n+/g, ' | ').slice(0, n);

  console.log('\n=== 剧本1 · 周四晚上出去玩一小时 ===');
  let d = await say(page, '周四晚上出去玩一小时');
  console.log('   [新消息]', shot(d));
  ok(/60|一小时/.test(d), 'S1 时长 60 分钟被识别');
  ok(/草稿|就这么排|占多久|哪天|多久|什么时候|投入|单次/.test(d), 'S1 进排程流（草稿/追问）');
  if (await page.getByRole('button', { name: '就这么排' }).count()) { await page.getByRole('button', { name: '就这么排' }).first().click(); await page.waitForTimeout(1800); }
  await say(page, '退出排程', 12000);

  console.log('\n=== 剧本2 · 排实验报告 → 下周一开始；一共10小时 ===');
  d = await say(page, '帮我排个实验报告');
  console.log('   [新消息]', shot(d));
  ok(/草稿|追问|投入|什么时候|开始|多久|占/.test(d), 'S2 首轮进排程流');
  d = await say(page, '下周一开始；一共10小时');
  console.log('   [新消息]', shot(d));
  ok(/撞|冲突|量|转场|方案|可选|就这么排|草稿|单次/.test(d), 'S2 撞车/协商或草稿');
  await say(page, '退出排程', 12000);

  console.log('\n=== 剧本4 · 明天打篮球 → 按钮卡(45/60/90/2h) ===');
  d = await say(page, '帮我规划一下我明天要打篮球');
  console.log('   [新消息]', shot(d));
  let o4 = await lastOptions(page);
  console.log('   [选项]', JSON.stringify(o4));
  ok(o4.length >= 3, `S4 首问即按钮卡（≥3 快捷项，实测 ${o4.length}）`);
  ok(o4.some((t) => /45|60|90|1\.5|两小时|2 小时/.test(t)) || /45|60|90/.test(d), 'S4 快捷项含时长档');
  const b90 = page.getByTestId('msg-options').getByRole('button').filter({ hasText: /90|1\.5|一小时半|一个半/ }).first();
  if (await b90.count()) { await b90.click(); await page.waitForTimeout(4500); }
  const tail4 = await msgsFrom(page, (await msgCount(page)) - 2);
  console.log('   [点后]', shot(tail4));
  ok(/草稿|就这么排|单次|明天/.test(tail4), 'S4 点选后走到草稿卡');
  if (await page.getByRole('button', { name: '就这么排' }).count()) { await page.getByRole('button', { name: '就这么排' }).first().click(); await page.waitForTimeout(2000); }
  await say(page, '退出排程', 12000);

  console.log('\n=== 剧本5 · 周六晚上6点到8点打球 → 零追问直接草稿 ===');
  d = await say(page, '周六晚上6点到8点我要打球');
  console.log('   [新消息]', shot(d));
  ok(/18|6\s*点|20|8\s*点|草稿|就这么排|冲突|撞|单次/.test(d), 'S5 钟点被接住');
  ok(!/我按你的课表排了一版/.test(d), 'S5 未掉「泛泛安排这周」分支');
  ok(!/占多久|大概占|投入多少|想投多少/.test(d), 'S5 未重问时长');
  await say(page, '退出排程', 12000);

  console.log('\n=== 剧本7 · 周五下午；每天两小时 ===');
  d = await say(page, '周五下午；每天两小时');
  console.log('   [新消息]', shot(d));
  ok(!/每周\s*7\s*次|7\s*次\/周|频率：每周 7/.test(d), 'S7 无「频率：每周 7 次」幻觉');
  // 该句无目标名 → 正确行为是追问「你要排的是哪件事（问句）」而非泛泛安排
  ok(/问句|还得问|草稿|就这么排|冲突|可选|占多久|哪件事/.test(d), 'S7 走到追问/草稿/协商');
  ok(!/我按你的课表排了一版/.test(d), 'S7 未掉「泛泛安排这周」分支');
  await say(page, '退出排程', 12000);

  console.log('\n=== 剧本6 · 真冲突（撞既有课）===');
  d = await say(page, '周一上午9点到11点我要开会');
  console.log('   [新消息]', shot(d, 420));
  o4 = await lastOptions(page);
  console.log('   [选项]', JSON.stringify(o4));
  ok(/⏰|📦|🚶|撞|量|转场/.test(d), 'S6 冲突反馈带类型标签');
  ok(o4.length >= 3 || /方案|可选|回编号|[1-4][．.、]/.test(d), `S6 协商按钮/编号 ≥3（按钮 ${o4.length}）`);
  // 口径：方案的「≤6 行」指 describeVerdict 产出的行（代码上界：blocked=caveats1+reasons1+挡路2+汇总1+结论1=6）
  // 渲染层 describeSlots 行=「· x」，describeVerdict 行自带 '· ' 前缀 → 渲染成「· · x」双点，据此区分
  const verdictLines = d.split('\n').filter((x) => /^\s*·\s*·\s/.test(x)).length;
  ok(verdictLines >= 1 && verdictLines <= 6, `S6 冲突反馈 ≤6 行（verdict 行实测 ${verdictLines}）`);
  await say(page, '退出排程', 12000);

  console.log('\n=== 剧本3 · 问答模式 RAG ===');
  await page.locator('[data-testid="mode-chat"]').click().catch(() => {}); await page.waitForTimeout(500);
  d = await say(page, '我们学校的校历安排是怎样的', 30000);
  console.log('   [新消息]', shot(d));
  ok(!/就这么排|草稿待确认|排程中/.test(d), 'S3 问答模式不触发排程流');
  ok(d.replace(/\s/g, '').length > 60, 'S3 RAG 有实质回答');

  console.log(`\n结果：${passed} 过 / ${failed} 挂`);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
};
run().catch((e) => { console.error(e); process.exit(2); });
