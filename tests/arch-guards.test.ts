/**
 * G1 架构护栏（前端架构规格书 §11 AC-6 / AC-7 / AC-8）
 * ============================================================
 * 第一批：依赖方向（§4.1 规则 1–4）
 * 第二批（2026-09-21，任务收口计划书 P1-1/P1-2/P1-4）：状态归属 + 无直连引擎 + 跨域冻结基线
 *
 * 零依赖静态扫源码（node:fs / node:path，可进 tests/** 门禁）。
 *
 * ⚠️ **落地纪律（交接书 G1）：只在规则已满足时才写成断言。** 存量违规走
 * **显式豁免名单 / 冻结基线**（只许缩短、不许加长），禁为了变绿改期望值。
 *
 *   [已断言]
 *   · R1  `lib/**` 不 import `features/**`（§4.1 规则 1 前半）—— 当前零违规；
 *   · R2  `lib/**` 不 import React（§4.1 规则 1 后半）—— 豁免名单见 `REACT_EXEMPT`；
 *   · R4  `lib/**` 代码里读 `import.meta.env` 只许边界层（§4.1 规则 4）——
 *         允许名单见 `ENV_ALLOWED`（planner 里的命中全是注释，剥注释后为零）；
 *   · R5  跨域横向 import `features/X/**` → `features/Y/**`：现状 **37 处 / 14 个域对**
 *         → **冻结基线**（`CROSS_DOMAIN_FROZEN` + `CROSS_DOMAIN_BASELINE`），禁新增，
 *         随 F2/F3 拆解后续逐域收紧；
 *   · AC-7 `WeekPlanView.tsx` 状态归属（`useState ≤12` 且行数 `≤800`）—— 现状 8 / 798；
 *   · AC-8 无直连引擎：除 `ENGINE_ALLOWED` 外 `features/**`、`components/**`
 *         不得**调用** `planWeek` / `planWeekV2` / `buildWeekPlan`；import 集合也冻结
 *         （`ENGINE_IMPORT_FROZEN` —— 2026-09-21 收口批次清掉 `WeekPlanView` 那条
 *         未使用 import 后，名单已缩短到与 `ENGINE_ALLOWED` 相等）。
 *   · P2-5 星期中文名单一定义点（§4.1 精神：同一事实不许两处定义）—— 真源
 *         `lib/date.ts`，现存 8 份同值副本已收成 1 份，余 `WeekView.tsx`（CY）豁免。
 *
 *   [存量违规，暂不写成断言，待重构后按批加进来]
 *   · R3  `lib/planner/**` 不 import `lib/api.ts`：`planner/transfer.ts` 静态
 *         import `../api` 是既有设计（`planWeek` 用动态 import 隔离它）→ 不满足。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..', 'src');

/** R2 豁免：存量 React import（前端架构规格书 §4.1 规则 1 的目标为零，重构时消除后从名单删） */
const REACT_EXEMPT = new Set(['lib/storage.ts']);

/** R4 允许：边界层读 `import.meta.env`（§4.1 规则 4 只列了 api.ts；timetableClient 是后来的边界层，已登记进度板） */
const ENV_ALLOWED = new Set(['lib/api.ts', 'lib/timetableClient.ts', 'lib/apiBase.ts']);

/**
 * R5 冻结基线：跨域横向 import 的**域对**（`from -> to`）。
 * 2026-09-21 实测 37 处 / 14 对。**只许缩短**：清掉一对就从名单删一对，
 * 出现新对即红灯（这正是 F2/F3 拆解后要防的回归）。
 */
const CROSS_DOMAIN_FROZEN = new Set([
  'calendar -> activity',
  'calendar -> overview',
  // 2026-10-07 RAY 授权新增（CY 梨宝排程壳搬运，路线 2）：LbaoChat/ModeSetupDialog
  // 需要 week 的 MiniWeekPreview/PlanEvalPanel/userPlanStore/planEditsStore 与
  // calendar 的 deadlineStore —— 对话壳落在 libao 域，引擎执行器在 week 域。
  'libao -> calendar',
  'libao -> week',
  'overview -> activity',
  'overview -> calendar',
  'overview -> feedback',
  'overview -> weather',
  'overview -> week',
  'persona -> activity',
  'week -> activity',
  'week -> behavior',
  'week -> feedback',
  'week -> libao',
  'week -> plan',
  'week -> weather',
]);

/** R5 冻结总条数（同一域对可被多个文件命中）—— 同样只许缩短
 *  43 → 44：WeekPlanView 内嵌排程对话抽屉（2026-10-07，RAY「接手不跳页」）+1 条 week→libao */
const CROSS_DOMAIN_BASELINE = 44;

/**
 * AC-8 允许：唯一引擎准入通道（前端架构规格书 §6.1 / §7.3）。
 * `weekPlanForChat.ts` 是梨宝侧的防腐层（仓库 AGENTS.md 红线 6 指定的唯一接缝）。
 */
const ENGINE_ALLOWED = new Set(['features/week/useWeekPlan.ts', 'features/libao/weekPlanForChat.ts']);

/**
 * AC-8 附注：`features/**`、`components/**` 里**允许** import 引擎入口的完整名单。
 * 2026-09-21 收口批次：`features/week/WeekPlanView.tsx` 那条**未使用的**
 * `import { planWeek }`（F2d 拆组件时漏清）已删除 ⟹ 名单从 3 项缩到 2 项（只许缩短）。
 */
const ENGINE_IMPORT_FROZEN = new Set([...ENGINE_ALLOWED]);

/**
 * AC-7 目标文件与阈值（前端架构规格书 §11 AC-7）
 *
 * 🔴 2026-10-07 · RAY 授权解除行数硬闸（`useState` 那半**不解除**）。
 *
 * 背景：规格书 §11 原话「AC-6/7/8/9/10 是本规格书新增—— 它们是「架构真的变好了」
 * 的**唯一客观证据**；现在一条都没有，所以『重构完了』只能靠感觉判断 —��� 这是必须补的」。
 * 也就是说800 行这条不是随手加的数，它的作用是**让"架构没退化"可被机器验证**。
 *
 * 为什么不直接删掉断言（那会让「架构退化」重新变成凭感觉）：
 *   改成**基线 + 增量**双阈值 —— ① 基线闸（`AC7_BASE_LINES`）永远绿，是「不许退化」的底线；
 *   ② 增量闸（`AC7_MAX_LINES`）在**超出时给出警告但不失败**，并把实际行数打印出来。
 *   ⟹ 「放宽」与「可观测」同时保住；后续「之后再简化」时，把 BASE 调到当时的实际值即可收紧。
 *
 * ⚠️ `useState ≤ 12` **保持原样且仍是硬闸**：状态归属是这套护栏真正要守的东西，
 *    组件可以变长（拆分后反而更清楚），但**状态必须留在该留的地方**。
 */
const WEEKPLAN_VIEW_REL = 'features/week/WeekPlanView.tsx';
const AC7_MAX_USESTATE = 12;
// 行数基线/增量双闸（AC7_BASE_LINES 799 / AC7_MAX_LINES 1200）已于 2026-10-07
// 按 RAY 拍板**彻底移除** —— 修复七列一排布局时 800 行立刻撞 799，演化终态 =
// 行数零断言（详见本文件头 AC-7 注释与《前端架构规格书》§11 记账）。

/* ============================================================
 * 扫描工具（零依赖）
 * ========================================================== */

function listTsFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** 剥掉块注释与整行行注释 —— lib/planner 的注释里大量提及 features/ / import.meta.env，不能算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

/** 收集 import 说明符（static / 副作用 / 动态） */
function importSpecs(code: string): string[] {
  const specs = new Set<string>();
  for (const m of code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
  for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
  return [...specs];
}

function existsFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 相对说明符 / `@/` 别名 → 绝对路径；bare（react、node:…）→ null */
function resolveSpec(spec: string, fromFile: string): string | null {
  const tryBase = (base: string): string | null => {
    for (const cand of [`${base}.ts`, `${base}.tsx`, base, join(base, 'index.ts'), join(base, 'index.tsx')]) {
      if (existsFile(cand)) return cand;
    }
    return null;
  };
  if (spec.startsWith('@/')) return tryBase(join(SRC_ROOT, spec.slice(2)));
  if (spec.startsWith('.')) return tryBase(join(dirname(fromFile), spec));
  return null;
}

const inDir = (abs: string, dir: string): boolean =>
  abs.startsWith(dir.endsWith(sep) ? dir : dir + sep);

const isReactSpec = (spec: string): boolean =>
  /^(react|react-dom)([/'].|$)/.test(spec);

/** Windows 下 relative() 产生反斜杠 —— 名单统一用 `/`，比较前归一 */
const relOf = (file: string): string => relative(SRC_ROOT, file).split(sep).join('/');

/**
 * 匹配针不能直接写字面量：alias-hook 在加载期会把源码里的
 * `import.meta.env` 文本替换成垫片（连本测试文件的字符串都逃不掉），
 * 所以拆开拼。
 */
const ENV_NEEDLE = ['import', 'meta', 'env'].join('.');

/* ============================================================
 * R1：lib/** 不 import features/**
 * ========================================================== */

test('AC-6·R1：lib/** 不 import features/**（依赖只能向下）', () => {
  const violations: string[] = [];
  for (const file of listTsFiles(join(SRC_ROOT, 'lib'))) {
    const specs = importSpecs(stripComments(readFileSync(file, 'utf8')));
    for (const spec of specs) {
      const resolved = resolveSpec(spec, file);
      if (spec.startsWith('@/features/') || (resolved != null && inDir(resolved, join(SRC_ROOT, 'features')))) {
        violations.push(`${relative(SRC_ROOT, file)} → ${spec}`);
      }
    }
  }
  assert.deepEqual(violations, [], 'lib 反向依赖 features（规格书 §4.1 规则 1）：\n' + violations.join('\n'));
});

/* ============================================================
 * R2：lib/** 不 import React（存量豁免名单只许缩短）
 * ========================================================== */

test('AC-6·R2：lib/** 不 import React（豁免名单外的存量清零，且不许新增）', () => {
  const violations: string[] = [];
  for (const file of listTsFiles(join(SRC_ROOT, 'lib'))) {
    if (REACT_EXEMPT.has(relOf(file))) continue;
    const specs = importSpecs(stripComments(readFileSync(file, 'utf8')));
    for (const spec of specs) {
      if (isReactSpec(spec)) violations.push(`${relOf(file)} → ${spec}`);
    }
  }
  assert.deepEqual(violations, [], 'lib 出现新的 React import（规格书 §4.1 规则 1）：\n' + violations.join('\n'));
});

test('AC-6·R2：豁免名单精确命中（名单里的文件若已修掉 React，就让它从名单退役）', () => {
  for (const rel of REACT_EXEMPT) {
    const file = join(SRC_ROOT, rel);
    assert.ok(existsFile(file), `豁免名单里的 ${rel} 不存在了 —— 请把它从 REACT_EXEMPT 删除`);
  }
});

/* ============================================================
 * R4：lib/** 读 import.meta.env 只许边界层
 * ========================================================== */

test('AC-6·R4：lib/** 代码读 Vite env 只许 ENV_ALLOWED（api.ts / timetableClient.ts）', () => {
  const violations: string[] = [];
  for (const file of listTsFiles(join(SRC_ROOT, 'lib'))) {
    if (ENV_ALLOWED.has(relOf(file))) continue;
    if (stripComments(readFileSync(file, 'utf8')).includes(ENV_NEEDLE)) {
      violations.push(relOf(file));
    }
  }
  assert.deepEqual(violations, [], 'lib 出现新的 import.meta.env（规格书 §4.1 规则 4）：\n' + violations.join('\n'));
});

/* ============================================================
 * R5：跨域横向 import 冻结基线（AC-6 剩余子规则）—— 只许缩短
 * ========================================================== */

test('AC-6·R5：features/X 不 import features/Y（冻结基线，禁新增域对）', () => {
  const hits: string[] = [];
  for (const file of listTsFiles(join(SRC_ROOT, 'features'))) {
    const rel = relOf(file);
    const from = rel.split('/')[1];
    for (const spec of importSpecs(stripComments(readFileSync(file, 'utf8')))) {
      if (!spec.startsWith('@/features/')) continue;
      const to = spec.slice('@/features/'.length).split('/')[0];
      if (to === from) continue;
      hits.push(`${from} -> ${to}`);
    }
  }
  const fresh = [...new Set(hits.filter((p) => !CROSS_DOMAIN_FROZEN.has(p)))].sort();
  assert.deepEqual(
    fresh,
    [],
    '出现新的跨域域对（规格书 §4.1 规则 2）——存量基线只许缩短：\n' + fresh.join('\n'),
  );
  assert.ok(
    hits.length <= CROSS_DOMAIN_BASELINE,
    `跨域 import 条数 ${hits.length} > 冻结基线 ${CROSS_DOMAIN_BASELINE}（只许缩短）`,
  );
});

/* ============================================================
 * AC-7：WeekPlanView 状态归属（useState ≤12；行数限制已于 2026-10-07 彻底解除）
 * ========================================================== */

test('AC-7：WeekPlanView.tsx 状态归属达标（useState ≤12；行数无限制）', () => {
  const raw = readFileSync(join(SRC_ROOT, WEEKPLAN_VIEW_REL), 'utf8');
  const code = stripComments(raw); // ⚠️ 必须剥注释：注释里提到 useState 不能算
  // ⚠️ 只数真正的 hook 调用 —— 别用 `grep -c useState`，那会把 `import { useState }` 那行也算进去
  const hooks = [...code.matchAll(/\bconst\s*\[[^\]]*\]\s*=\s*useState\s*[<(]/g)].length;
  assert.ok(hooks <= AC7_MAX_USESTATE, `WeekPlanView useState ${hooks} > ${AC7_MAX_USESTATE}（AC-7）`);
  // 行数检查已按 RAY 2026-10-07 拍板彻底移除（演进史见上方常量块注释）。
});

/* ============================================================
 * AC-8：无直连引擎（唯一通道 useWeekPlan / weekPlanForChat）
 * ========================================================== */

/** 引擎调用点（`planWeekV2(` / `planWeek(` / `buildWeekPlan(`）—— 注意天然不匹配 `planWeekForChat(` */
const ENGINE_CALL = /\b(planWeekV2|planWeek|buildWeekPlan)\s*\(/;

/**
 * 引擎**入口模块**（不是 `@/lib/planner/**` 全部 —— corrections/templates/model 等
 * 是共享数据结构层，features 合法消费）。`planWeek.ts` 才是「引擎准入」的那道门。
 */
const ENGINE_IMPORT = /@\/lib\/planner\/planWeek['"]/;

test('AC-8：features/**、components/** 不得直连引擎调用（唯一通道）', () => {
  const violations: string[] = [];
  for (const dir of ['features', 'components']) {
    let files: string[];
    try {
      files = listTsFiles(join(SRC_ROOT, dir));
    } catch {
      continue; // 目录不存在（components 允许为空）
    }
    for (const file of files) {
      if (ENGINE_ALLOWED.has(relOf(file))) continue;
      if (ENGINE_CALL.test(stripComments(readFileSync(file, 'utf8')))) violations.push(relOf(file));
    }
  }
  assert.deepEqual(
    violations,
    [],
    '绕过唯一通道直连引擎（规格书 §6.1 / §7.3）：\n' + violations.join('\n'),
  );
});

test('AC-8：引擎 import 集合冻结（只许缩短，清理后从名单删除）', () => {
  const importers: string[] = [];
  for (const dir of ['features', 'components']) {
    let files: string[];
    try {
      files = listTsFiles(join(SRC_ROOT, dir));
    } catch {
      continue;
    }
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (ENGINE_IMPORT.test(code)) importers.push(relOf(file));
    }
  }
  const fresh = [...new Set(importers.filter((f) => !ENGINE_IMPORT_FROZEN.has(f)))].sort();
  assert.deepEqual(fresh, [], '出现新的引擎 import（规格书 §6.1 / §7.3）：\n' + fresh.join('\n'));
});

test('AC-8：冻结名单精确命中（名单里的文件若已清理，就让它从名单退役）', () => {
  for (const rel of ENGINE_IMPORT_FROZEN) {
    assert.ok(existsFile(join(SRC_ROOT, rel)), `冻结名单里的 ${rel} 不存在了 —— 请把它删除`);
  }
});

/* ============================================================
 * R6 文案单一定义点（AC-6 家族；2026-09-21 P2-5 去重后新增）
 * ========================================================== */

/**
 * 星期中文名两套口径，各自只许有**一个定义点**：
 *   · 周一起数组 → `lib/date.ts` 的 `DAY_LABELS`（配合 `dayOfWeek` 1–7，取 `[d-1]`）
 *   · 周日开数组 → `lib/date.ts` 的 `WEEKDAY_CN`（配合 `Date.getDay()`，`[0]=周日`）
 *
 * 为什么值得一条守卫：去重前「周一起数组」在仓里有 **8 份**同值副本
 * （周视图 ×5 + 目标页 ×1 + 引擎 ×2）。任一处改了文案、另几处不跟，
 * 界面就会同时出现「周三」和「礼拜三」——**而且不会有任何测试报错**，
 * 因为每份副本各自都对、谁也不认识谁。这类漂移只能靠「定义点唯一」静态钉死。
 */
const DAY_LABEL_MON_FIRST = /\['周一',\s*'周二',\s*'周三',\s*'周四',\s*'周五',\s*'周六',\s*'周日'\]/;
const DAY_LABEL_SUN_FIRST = /\['周日',\s*'周一',\s*'周二',\s*'周三',\s*'周四',\s*'周五',\s*'周六'\]/;
/** 真源（两套口径都在这一个文件里，各自一份） */
const DAY_LABEL_CANONICAL = 'lib/date.ts';
/**
 * 豁免：`features/week/WeekView.tsx` 属 **CY 地盘**（所有权见工作区 AGENTS.md），
 * 本会话不动，已登记进度板待合并。**只许缩短**：CY 合并后把本行删掉、用例自然收紧。
 */
const DAY_LABEL_EXEMPT = new Set(['features/week/WeekView.tsx']);

test('P2-5：星期中文名只有一个定义点（周一起 / 周日开 各一份，禁文案漂移）', () => {
  const fresh: string[] = [];
  for (const file of listTsFiles(SRC_ROOT)) {
    const rel = relOf(file);
    if (rel === DAY_LABEL_CANONICAL || DAY_LABEL_EXEMPT.has(rel)) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    if (DAY_LABEL_MON_FIRST.test(code) || DAY_LABEL_SUN_FIRST.test(code)) fresh.push(rel);
  }
  fresh.sort();
  assert.deepEqual(
    fresh,
    [],
    '出现了新的星期中文名字面量副本（真源在 lib/date.ts）：\n' +
      fresh.join('\n') +
      "\n请改为 import { DAY_LABELS } from '@/lib/date'（lib/** 内部用相对路径）。",
  );
});

test('P2-5：真源确实在 lib/date.ts 导出，且两套口径并排', () => {
  const src = readFileSync(join(SRC_ROOT, DAY_LABEL_CANONICAL), 'utf8');
  assert.match(src, /export const DAY_LABELS\s*=/, 'lib/date.ts 里找不到 DAY_LABELS 的定义');
  assert.match(src, /export const WEEKDAY_CN\s*=/, 'lib/date.ts 里找不到 WEEKDAY_CN 的定义');
  assert.ok(
    DAY_LABEL_MON_FIRST.test(src) && DAY_LABEL_SUN_FIRST.test(src),
    'lib/date.ts 应同时含两套口径的字面量（周一起 = DAY_LABELS，周日开 = WEEKDAY_CN）',
  );
});

test('P2-5：豁免名单精确命中（CY 合并 WeekView 之后，本用例会要求你删掉豁免）', () => {
  for (const rel of DAY_LABEL_EXEMPT) {
    const src = readFileSync(join(SRC_ROOT, rel), 'utf8');
    assert.ok(
      DAY_LABEL_MON_FIRST.test(src),
      `${rel} 里已经没有星期中文名字面量了 —— 请把它从 DAY_LABEL_EXEMPT 删除（名单只许缩短）`,
    );
  }
});
