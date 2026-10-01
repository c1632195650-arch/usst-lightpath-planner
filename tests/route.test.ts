/**
 * 路由纯函数护栏（P2-1 / 任务收口计划书 R3；《页面与使用逻辑规格书》§4.1）
 * ============================================================
 * `src/lib/route.ts` 是从 `App.tsx` 抽出的**纯函数层**：收 hash 字符串 → 出 `Route`。
 * 抽出来就是为了能零 DOM 单测（本仓无 jsdom / testing-library，且红线禁新增依赖）。
 *
 * 覆盖范围：
 *   · 六条一级路由；`#/week` 的周参数（合法 / 坏参数 / 周中日期归一）；
 *   · 缺省与未知 hash 的安静回落；`#/import` 的 DEV 开关；
 *   · `hashOf` ⇄ `parseRoute` 往返一致（导航写进去的 hash，刷新时必须解析回同一页）。
 *
 * 末尾两条是**静态守卫**，钉住这次抽离的两个前提，防日后被改回去：
 *   ① 纯函数层不许碰 `window`（一旦自取环境，Node 里就再也测不了）；
 *   ② `App.tsx` 只当环境适配层，不许再长出第二份解析逻辑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashOf, parseRoute, TAB_LABEL, type MainTab } from '@/lib/route.ts';
import { mondayOf, weekdayOf } from '@/lib/date.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..', 'src');

const DEV = { showImport: true };
const PROD = { showImport: false };

/** 剥注释：静态守卫要断言的标识符会出现在注释里（本文件的说明、App.tsx 的注释都提到过） */
const readCode = (p: string): string =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');

/* ============================================================
 * hash → Route
 * ========================================================== */

test('六条一级路由：合法 hash 各自解析正确', () => {
  assert.deepEqual(parseRoute('#/today'), { tab: 'today', weekMonday: null });
  assert.deepEqual(parseRoute('#/goals'), { tab: 'goals', weekMonday: null });
  assert.deepEqual(parseRoute('#/profile'), { tab: 'profile', weekMonday: null });
  assert.deepEqual(parseRoute('#/libao'), { tab: 'libao', weekMonday: null });
  assert.deepEqual(parseRoute('#/week'), { tab: 'week', weekMonday: null });
  assert.deepEqual(parseRoute('#/import', DEV), { tab: 'import', weekMonday: null });
});

test('#/week 无周参数 = 本周默认口径（weekMonday 为 null，不臆造具体周）', () => {
  for (const h of ['#/week', '#/week/', '#/week//']) {
    assert.equal(parseRoute(h).weekMonday, null, `${h} 不该解析出具体周`);
  }
});

test('#/week/<周中日期> 归一为那一周的周一', () => {
  // 独立核对：2026-09-23 是周三 → 所在周的周一是 2026-09-21
  assert.equal(weekdayOf('2026-09-23'), 3, '本用例的日期前提变了（2026-09-23 不是周三）');
  assert.equal(parseRoute('#/week/2026-09-23').weekMonday, mondayOf('2026-09-23'));
  assert.equal(parseRoute('#/week/2026-09-23').weekMonday, '2026-09-21');
  // 周日属于「这一周」的最后一天，不跳下一周
  assert.equal(weekdayOf('2026-09-27'), 0, '本用例的日期前提变了（2026-09-27 不是周日）');
  assert.equal(parseRoute('#/week/2026-09-27').weekMonday, '2026-09-21');
});

test('坏周参数安静回落「本周」（不猜具体周）', () => {
  for (const bad of ['#/week/2026-9-1', '#/week/abc', '#/week/20260921', '#/week/2026-09-32x']) {
    const r = parseRoute(bad);
    assert.equal(r.tab, 'week', `${bad} 仍应落在周计划页`);
    assert.equal(r.weekMonday, null, `${bad} 是坏参数，必须回落到本周而不是猜一个周`);
  }
});

test('#/week 多出的尾段被忽略（只取第一段周参数）', () => {
  assert.deepEqual(parseRoute('#/week/2026-09-21/extra'), { tab: 'week', weekMonday: '2026-09-21' });
});

test('缺省 / 未知 hash 一律落今天页', () => {
  for (const h of ['', '#', '#/', '#!/', '#/nope', '#/Week', '#/weekx', '#/today/extra']) {
    assert.equal(parseRoute(h).tab, 'today', `${JSON.stringify(h)} 应回落到今天页`);
  }
});

test('#/import 只在 showImport 打开时才是 import（DEV 联调页不许漏到正式构建）', () => {
  assert.equal(parseRoute('#/import', DEV).tab, 'import');
  assert.equal(parseRoute('#/import', PROD).tab, 'today', 'showImport 关闭时 #/import 必须回落今天页');
  assert.equal(parseRoute('#/import').tab, 'today', '默认（未传 env）应按关闭处理，闭默认更安全');
});

/* ============================================================
 * hashOf ⇄ parseRoute 往返
 * ========================================================== */

test('往返一致：hashOf 写出的 hash，parseRoute 必须解析回同一页', () => {
  const tabs: MainTab[] = ['today', 'week', 'goals', 'profile', 'libao', 'import'];
  for (const tab of tabs) {
    const wm = tab === 'week' ? '2026-09-21' : null;
    const hash = hashOf(tab, wm);
    const back = parseRoute(hash, DEV);
    assert.equal(back.tab, tab, `${hash} → ${back.tab}（往返断了，刷新会掉页）`);
    if (tab === 'week') assert.equal(back.weekMonday, wm, `${hash} 的周参数没往返回来`);
  }
});

test('hashOf 的形状：week 带参数 / week 不带 / 其余按 tab 名', () => {
  assert.equal(hashOf('week', '2026-09-21'), '#/week/2026-09-21');
  assert.equal(hashOf('week', null), '#/week');
  assert.equal(hashOf('today', null), '#/today');
  assert.equal(hashOf('libao', '2026-09-21'), '#/libao', 'weekMonday 只对 week 有意义，其余 tab 必须忽略');
});

test('TAB_LABEL 覆盖全部 MainTab（穷尽映射由 tsc 兜底，这里防「值被清空」）', () => {
  const tabs: MainTab[] = ['today', 'week', 'goals', 'profile', 'libao', 'import'];
  for (const tab of tabs) {
    assert.ok(TAB_LABEL[tab] && TAB_LABEL[tab].length > 0, `TAB_LABEL.${tab} 是空的`);
  }
});

/* ============================================================
 * 静态守卫：钉住这次抽离的两个前提
 * ========================================================== */

test('静态守卫：route.ts 是纯函数层，不读 window / document', () => {
  const code = readCode(join(SRC_ROOT, 'lib', 'route.ts'));
  assert.match(code, /export function parseRoute/, '没读到 route.ts 的内容 —— 路径变了？本用例失效');
  assert.ok(!/\bwindow\b/.test(code), 'route.ts 读了 window —— 纯函数层一旦自取环境，Node 里就测不了了');
  assert.ok(!/\bdocument\b/.test(code), 'route.ts 读了 document —— 同上');
});

test('静态守卫：App.tsx 只做环境适配，不再自带第二份解析逻辑', () => {
  const code = readCode(join(SRC_ROOT, 'App.tsx'));
  assert.match(
    code,
    /parseRoute\(\s*window\.location\.hash/,
    'App.tsx 没把当前 hash 注入 parseRoute —— 抽离被改回去了？',
  );
  assert.ok(!/function\s+parseRoute/.test(code), 'App.tsx 里又长出了本地的 parseRoute —— 会与 @/lib/route 分叉');
  assert.ok(!/function\s+hashOf/.test(code), 'App.tsx 里又长出了本地的 hashOf —— 往返一致性会失守');
});
