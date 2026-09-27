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
  // D0 双模式：输入框默认落「问答」模式 —— A-J 全是排程剧本，先进排程模式再说话。
  // （问答模式下排程句会出「切到排程模式」提示卡而不自动排，剧本 N 专门验证它。）
  await page.locator('[data-testid="mode-sched"]').click().catch(() => {});
  await T(300);
}

/** 发一句话并等梨宝回完（loading 消失）。
 *  placeholder 在 collect 态会换成「排程中 ——」文案（S2 的 UI 信号之一）；
 *  D0 起排程模式（非 collect）也有专属 placeholder，三个都要认。 */
async function say(page, text) {
  await page.getByPlaceholder(/问梨宝|排程中|排程模式/).fill(text);
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
    ok(
      await page.getByText('草稿待确认', { exact: false }).first().isVisible().catch(() => false),
      'A6 补齐出草稿 → 徽章换「草稿待确认」口径（D3：草稿也是议题相位，会话未结束，可语音确认）',
    );
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

  // ── 剧本 D：多目标挑块接续（V2-1 通道在 collect 态下的续命） ──
  {
    const page = await browser.newPage();
    await onboard(page);
    await say(page, '十月中旬开始备赛；每周3次、每次2小时');
    await page.getByRole('button', { name: '就这么排' }).first().click().catch(() => {});
    await page.waitForTimeout(600);
    await say(page, '取消备赛'); // 多块同名 → 挑块追问
    ok(
      await page.getByText('好几件事', { exact: false }).or(page.getByText('挪哪个', { exact: false })).first().isVisible().catch(() => false),
      'D1 多命中 → 挑块追问（不硬猜）',
    );
    ok(await page.locator(BADGE).isVisible().catch(() => false), 'D2 挑块态仍在会话中');
    await say(page, '图书馆几点开门'); // 挑块态下的无关句 → V2-1 诚实重列候选（不掉 RAG）
    ok(
      await page.getByText('候选是这些', { exact: false }).first().isVisible().catch(() => false),
      'D3 挑块态插话诚实重列候选（不掉 RAG）',
    );
    await say(page, '退出排程');
    ok(await page.getByText('好，先不排了', { exact: false }).first().isVisible().catch(() => false), 'D4 挑块态可退出');
    await page.close();
  }

  // ── 剧本 E：hold（「这段时间别排」→ 草稿 → 确认落盘） ──
  {
    const page = await browser.newPage();
    await onboard(page);
    await say(page, '周三下午别排东西');
    ok(
      await page.getByText('把这段时间空出来', { exact: false }).first().isVisible().catch(() => false),
      'E1 hold 草稿卡出现',
    );
    await page.getByRole('button', { name: '就这么排' }).first().click();
    await page.waitForTimeout(600);
    ok(
      await page.getByText('这段时间空出来了', { exact: false }).first().isVisible().catch(() => false),
      'E2 确认后落盘回执',
    );
    await page.close();
  }

  // ── 剧本 F：重要日（add_deadline 提案卡，记节点 ≠ 排块） ──
  {
    const page = await browser.newPage();
    await onboard(page);
    await say(page, '我要考驾照，科目一12月1号考');
    ok(
      await page.getByRole('button', { name: '好，记下来' }).first().isVisible().catch(() => false),
      'F1 重要日提案卡出现',
    );
    await page.getByRole('button', { name: '好，记下来' }).first().click();
    await page.waitForTimeout(600);
    ok(
      await page.getByText('记下了', { exact: false }).first().isVisible().catch(() => false),
      'F2 确认后记节点回执',
    );
    await page.close();
  }

  // ── 剧本 G：LLM 离线降级 —— understand 端点全挂，规则兜底全链路仍可排程 ──
  {
    const page = await browser.newPage();
    await page.route('**/api/plan/understand', (route) => route.abort()); // 模拟 LLM 拔线
    await onboard(page);
    await say(page, SEED);
    ok(await page.locator(BADGE).isVisible().catch(() => false), 'G1 LLM 挂了追问照常（规则兜底）');
    await say(page, '十月中旬开始；每周3次、每次2小时');
    ok(
      await page.getByRole('button', { name: '就这么排' }).first().isVisible().catch(() => false),
      'G2 LLM 挂了分号答案照收 → 草稿卡',
    );
    await page.close();
  }

  // ── 剧本 H：草稿确认落盘（唯一写日程的地方） ──
  {
    const page = await browser.newPage();
    await onboard(page);
    await say(page, '周四我要吃大餐；每次2小时');
    ok(
      await page.getByText('还没写进日程', { exact: false }).first().isVisible().catch(() => false),
      'H1 草稿卡明示未落盘',
    );
    await page.getByRole('button', { name: '就这么排' }).first().click();
    await page.waitForTimeout(800);
    ok(
      await page.getByText('写进', { exact: false }).first().isVisible().catch(() => false),
      'H2 确认后写进日程回执',
    );
    await page.close();
  }

  // ── 剧本 I：collect 态不过 looksLikeAction 闸门（P4 的守卫） ──
  {
    const page = await browser.newPage();
    await onboard(page);
    await say(page, SEED);
    // 「学校有什么社团」：looksLikeAction 判 false、规则也抽不到槽 —— collect 态必须
    // 走保留式追问而不是掉 RAG（后端未起 → 掉 RAG 会出「校园资料服务暂时未连接」）
    await say(page, '学校有什么社团');
    ok(
      await page.getByText('先把刚才的事定完', { exact: false }).first().isVisible().catch(() => false),
      'I1 collect 态非动作句进应答通道（保留式）',
    );
    ok(
      !(await page.getByText('校园资料服务暂时未连接', { exact: false }).last().isVisible().catch(() => false)),
      'I2 该句没有掉进 RAG 问答',
    );
    await page.close();
  }

  // ── 剧本 J：跨刷新快照恢复（v3 对话管理器状态 + collect 态复活） ──
  {
    const page = await browser.newPage();
    await onboard(page);
    await say(page, SEED);
    const snap = await page.evaluate(() => sessionStorage.getItem('usst.libao.chat.v3'));
    ok(snap != null, 'J1 快照 v3 键存在');
    ok(
      snap != null && snap.includes('"mode":"sched"') && snap.includes('"phase":"collect"') && snap.includes('"asked"'),
      'J2 快照含 v3 字段（mode/topic.phase/asked）',
    );
    await page.reload();
    await page.waitForTimeout(1500);
    // 刷新后落在默认 tab —— 先切回梨宝再看会话恢复
    await page.getByRole('button', { name: /梨宝/ }).first().click().catch(() => {});
    await page.waitForTimeout(600);
    ok(
      await page.getByText('可以用分号一起答', { exact: false }).first().isVisible().catch(() => false),
      'J3 刷新后追问态恢复（asked 清单随快照回来）',
    );
    ok(await page.locator(BADGE).isVisible().catch(() => false), 'J4 刷新后徽章仍在');
    await page.close();
  }

  // ── D 批剧本 K/L/M/N ──
  await D_SCENARIOS(browser);

  await browser.close();
  console.log(`\n结果：${passed} 过 / ${failed} 挂`);
  process.exit(failed > 0 ? 1 : 0);
};

/* ============================================================
 * D 批剧本 K/L/M/N（2026-09-27 夜）
 * ============================================================
 * LLM 边界用 route.mock 定死（dialog 场景按 q 回罐头、intent/answer 拔线走规则兜底，
 * 与剧本 G 同一手法）——E2E 只测**前端执行器链**这半边；LLM 裁决那半边由
 * evals/golden/plan_understand.jsonl 的 dialog 组在线评测覆盖（eval_plan_understand.py）。
 * 引擎级「真排上/真 blocked」由 tests/d-batch.test.ts 的 D4 用例覆盖。
 */
const DOW_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const TERM_START = '2026-08-31'; // MOCK 学期第一周周一（src/data/usst.ts）

/** 明天（相对真机时钟）的落盘要素：ISO、教学周号、星期数、中文星期、M.D */
function tomorrowInfo() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const dow = t.getDay() === 0 ? 7 : t.getDay();
  const weekNo = Math.floor((t - new Date(`${TERM_START}T00:00:00`)) / (7 * 864e5)) + 1;
  return { iso, dow, weekNo, dowCN: DOW_CN[t.getDay()], md: iso.slice(5).replace('-', '.') };
}

/** 预置用户待办（layer.tasks）：操场跑步固定在明天傍晚 —— 替换/取消的真实目标 */
async function seedUserPlan(page, tasks) {
  await page.evaluate((list) => {
    localStorage.setItem('usst-user-plan-v1', JSON.stringify({
      schemaVersion: 2, tasks: list, excluded: [], moves: [], slots: [],
      courseOverrides: [], mealPlaces: {}, assignments: [],
    }));
  }, tasks);
}

/** 预置对话快照 v3：直接落一个指定相位的 topic（绕过引擎裁决，专测执行器链） */
async function seedTopicSnapshot(page, topic, messages) {
  await page.evaluate(([topic, messages]) => {
    sessionStorage.setItem('usst.libao.chat.v3', JSON.stringify({
      v: 3, messages, pending: {}, pendingSeq: 0, mode: 'sched', topic, missStreak: 0,
    }));
  }, [topic, messages]);
}

/** dialog 场景罐头路由：q 命中 responder 则回裁决；intent/answer 一律拔线（规则兜底） */
function mockDialogLLM(respond) {
  return async (route) => {
    const req = route.request();
    if (!req.url().includes('/api/plan/understand')) return route.continue();
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch { /* 拔线 */ }
    if (body.scene !== 'dialog') return route.abort();
    const res = respond(body);
    if (!res) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, reason: 'dialog_no_mock' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(res) });
  };
}

const D_SCENARIOS = async (browser) => {
  // ── 剧本 K（B① 议题续用）：blocked 之后「把操场跑步替换掉」≤1 轮出 replace 草稿卡 ──
  {
    const page = await browser.newPage();
    const tm = tomorrowInfo();
    await page.route('**/api/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, llm: true, model: 'mock' }) }));
    await page.route('**/api/plan/understand', mockDialogLLM((body) => {
      if (body.q.includes('操场跑步替换')) {
        return { ok: true, act: 'new_intent', args: { intent: 'replace', patch: { targetHint: '操场跑步' } }, reply_note: '', confidence: 0.9 };
      }
      return null;
    }));
    await onboard(page);
    await seedUserPlan(page, [{
      id: 'u-run', title: '操场跑步', emoji: '🏃', kind: 'activity', category: 'sport',
      dayOfWeek: tm.dow, startMin: 17 * 60 + 55, durationMin: 60, weeks: [tm.weekNo],
    }]);
    // blocked 相直接注入快照（引擎级 blocked 已由 d-batch D4 用例覆盖）：上一件「出去玩」没排成
    const slots = {
      intent: 'create', title: '出去玩', certainty: 'exact', priorityHint: 85,
      missing: [], unclear: [], raw: '明天晚上出去玩一小时',
      dateFrom: tm.iso, dateTo: tm.iso, durationMin: 60,
      when: { text: '明天晚上', kind: 'relative', relativeDays: 1 },
      window: { fromMin: 18 * 60, toMin: 23 * 60, text: '晚上' },
    };
    await seedTopicSnapshot(page, {
      phase: 'blocked', intent: 'create', slots, asked: [],
      priorFailed: { title: '出去玩', slots },
      blocking: { kind: 'no_placement', verdict: { kind: 'infeasible', questions: [], added: [], studyDeltaMin: 0, placedCount: 0, candidateCount: 1, placedAt: [], caveats: [], reasons: [] }, blockingBlocks: [] },
      createdAt: Date.now(), turns: 1,
    }, [{ role: 'lbao', text: '「出去玩」我排不进去：' }]);
    await page.reload();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /梨宝/ }).first().click().catch(() => {});
    await page.waitForTimeout(600);

    await say(page, '把操场跑步替换掉');
    ok(
      await page.getByRole('button', { name: '就这么排' }).first().isVisible().catch(() => false),
      'K1 blocked 后 1 轮出 replace 草稿卡（priorFailed 议题续用）',
    );
    ok(
      await page.getByText('取消：操场跑步', { exact: false }).first().isVisible().catch(() => false),
      'K2 草稿卡含「取消：操场跑步」',
    );
    ok(
      !(await page.getByText('投入多少', { exact: false }).first().isVisible().catch(() => false)),
      'K3 不重复追问时长/时间（B① 根治）',
    );
    await page.close();
  }

  // ── 剧本 L（B② idx 消歧）：replace 两候选 →「明天的那个」1 轮命中出草稿卡 ──
  {
    const page = await browser.newPage();
    const tm = tomorrowInfo();
    await page.route('**/api/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, llm: true, model: 'mock' }) }));
    await page.route('**/api/plan/understand', mockDialogLLM((body) => {
      if (body.q.includes('操场跑步替换')) {
        return { ok: true, act: 'new_intent', args: { intent: 'replace', patch: { title: '出去玩', durationMin: 60, targetHint: '操场跑步', when_text: '明天', relativeDays: 1 } }, reply_note: '', confidence: 0.9 };
      }
      if (body.q.includes('明天的那个')) {
        return { ok: true, act: 'pick_candidate', args: { candidate_idx: 0 }, reply_note: '', confidence: 0.9 };
      }
      return null;
    }));
    await onboard(page);
    const mkRun = (id, dow) => ({
      id, title: '操场跑步', emoji: '🏃', kind: 'activity', category: 'sport',
      dayOfWeek: dow, startMin: 17 * 60 + 55, durationMin: 60, weeks: [tm.weekNo],
    });
    await seedUserPlan(page, [mkRun('u-run-mon', tm.dow), mkRun('u-run-fri', tm.dow === 5 ? 4 : 5)]);
    await page.reload();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /梨宝/ }).first().click().catch(() => {});
    await page.waitForTimeout(600);

    await say(page, '把操场跑步替换掉');
    ok(
      await page.getByText('替换哪个', { exact: false }).first().isVisible().catch(() => false),
      'L1 两候选 → 挑块追问（候选带日期）',
    );
    await say(page, '明天的那个');
    ok(
      await page.getByRole('button', { name: '就这么排' }).first().isVisible().catch(() => false),
      'L2 「明天的那个」1 轮命中 → 草稿卡（无第二次替换哪个）',
    );
    ok(
      !(await page.getByText('替换哪个', { exact: false }).nth(1).isVisible().catch(() => false)),
      'L3 没有重复追问',
    );
    await page.close();
  }

  // ── 剧本 M（B③ 协商基于事实）：blocked 相下协商回复引用挡路块，不硬编码「降一档」 ──
  {
    const page = await browser.newPage();
    const tm = tomorrowInfo();
    const hint = `${tm.dowCN}(${tm.md}) 17:55–18:55`;
    await page.route('**/api/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, llm: true, model: 'mock' }) }));
    await page.route('**/api/plan/understand', mockDialogLLM((body) => {
      if (body.q.includes('怎么办')) {
        return { ok: true, act: 'negotiate_block', args: { option: 'swap_block' }, reply_note: '', confidence: 0.8 };
      }
      return null;
    }));
    await onboard(page);
    const slots = {
      intent: 'create', title: '出去玩', certainty: 'exact', priorityHint: 85,
      missing: [], unclear: [], raw: '明天晚上出去玩一小时',
      dateFrom: tm.iso, dateTo: tm.iso, durationMin: 60,
      when: { text: '明天晚上', kind: 'relative', relativeDays: 1 },
      window: { fromMin: 18 * 60, toMin: 23 * 60, text: '晚上' },
    };
    await seedTopicSnapshot(page, {
      phase: 'blocked', intent: 'create', slots, asked: [],
      priorFailed: { title: '出去玩', slots },
      blocking: {
        kind: 'no_placement',
        verdict: { kind: 'infeasible', questions: [], added: [], studyDeltaMin: 0, placedCount: 0, candidateCount: 1, placedAt: [], caveats: [], reasons: [] },
        blockingBlocks: [{ idx: 0, title: '操场跑步', hint, origin: 'plan', target: { blockId: 'w4-d1-user-u-run', title: '操场跑步', origin: 'plan', hint } }],
      },
      createdAt: Date.now(), turns: 1,
    }, [{ role: 'lbao', text: '「出去玩」我排不进去：' }]);
    await page.reload();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /梨宝/ }).first().click().catch(() => {});
    await page.waitForTimeout(600);

    await say(page, '那怎么办');
    const body = await page.locator('section').innerText();
    ok(body.includes('操场跑步'), 'M1 协商回复引用挡路块「操场跑步」（事实，非编造）');
    ok(body.includes('17:55'), 'M2 引用具体时间 17:55');
    ok(!body.includes('降一档目标量'), 'M3 不出现硬编码的「降一档目标量」');
    await page.close();
  }

  // ── 剧本 N（模式按钮）：问答模式出提示不自动排；切换重发直达排程流；排程模式议题保留 ──
  {
    const page = await browser.newPage();
    await page.route('**/api/plan/understand', (route) => route.abort()); // 全离线：测纯前端模式行为
    await onboard(page); // onboard 已点排程模式 → 切回问答
    await page.locator('[data-testid="mode-chat"]').click();
    await page.waitForTimeout(300);
    await say(page, SEED);
    ok(
      await page.locator('[data-testid="switch-to-sched"]').first().isVisible().catch(() => false),
      'N1 问答模式排程句 → 出切换提示卡',
    );
    ok(
      !(await page.getByRole('button', { name: '就这么排' }).first().isVisible().catch(() => false)),
      'N2 不自动排（无草稿卡）',
    );
    await page.locator('[data-testid="switch-to-sched"]').first().click();
    await page.waitForTimeout(1500);
    ok(await page.locator(BADGE).isVisible().catch(() => false), 'N3 切到排程模式并重发 → 进入排程流（追问态）');
    await say(page, '图书馆几点开会'); // 无关插话：议题保留（保留式提醒，不掉 RAG）
    ok(
      await page.getByText('先把刚才的事定完', { exact: false }).first().isVisible().catch(() => false),
      'N4 排程模式内无关句 → 议题保留（保留式提醒）',
    );
    ok(await page.locator(BADGE).isVisible().catch(() => false), 'N5 议题仍在（徽章未消失）');
    await page.close();
  }
};

run().catch((e) => { console.error(e); process.exit(1); });
