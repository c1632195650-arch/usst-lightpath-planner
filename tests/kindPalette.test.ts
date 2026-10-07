/**
 * 日程块类别色守卫（`constants/chartColors.ts` ↔ `types.ts` ↔ Tailwind 产物）
 * ============================================================
 * 背景：块类别色原先在 `features/week/BlockCard.tsx` 里硬编码七套 Tailwind 内置色
 * （`bg-blue-100 border-blue-400 text-blue-900` …），与 `chartColors.SPECTRUM`
 * **并存= 两套真相源**。代价：
 *   ① 加类别要改两处，删一处不删另一处就出色差；
 * ② 内置色**从未核对对比度**（SPECTRUM 与 tailwind.config.js 都标了实测值）；
 * ③ 换品牌色会漏掉这一处。
 *
 * 这个守卫钉住收口后的三件事：
 *   Q1 键集**严格等于** `BlockKind` —— 多一个键（如原实现的 `'user'`）就是死代码，
 *      因为 `block.kind` 永远取不到它；少一个则界面会掉到兜底样式。
 *   Q2 三档类名（wash / line / text）齐全，且都是**字面量**。
 *      🔴 这是本守卫最要紧的一条：Tailwind 的 JIT 只扫源码里的**完整类名**，
 *      `bg-[${hex}]` 这种拼出来的写法会被**静默漏掉**（不报错，只是没样式）。
 *      所以类名必须以字面量出现在本文件里，改色时不能改成拼接。
 *   Q3 收口后 `BlockCard.tsx` 里**不再出现**裸色类 —— 真源只能有一个。
 *
 * 另附一条纯 CSS 断言：产出的类名必须真的存在于构建产物 CSS 里。
 * 这条比前三条更狠 —— 前面防「写错」，这条防「Tailwind 没扫到」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KIND_PALETTE, kindCls, paletteOf } from '@/constants/chartColors';
import type { BlockKind } from '@/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 契约里的全部 kind —— 抄一份字面量，避免测试直接依赖 types.ts 的导出形态。 */
const ALL_KINDS: BlockKind[] = ['course', 'meal', 'study', 'activity', 'commute', 'blank'];

test('Q1 键集严格等于 BlockKind —— 不多不少', () => {
  const actual = Object.keys(KIND_PALETTE).sort();
  const expected = [...ALL_KINDS].sort();
  assert.deepEqual(
    actual,
    expected,
    `KIND_PALETTE 的键与 BlockKind 不一致。\n`
      + `  实际：${actual.join(', ')}\n`
      + `  应为：${expected.join(', ')}\n`
      + `多出来的键是死代码（block.kind 取不到它，白留着骗人）；`
      + `少掉的键会让该类别掉进兜底样式。`,
  );
});

test('Q1b 每个 kind 都能查到样式，且未知 kind 落到 blank', () => {
  for (const k of ALL_KINDS) {
    assert.ok(paletteOf(k), `kind=${k} 查不到样式`);
    assert.equal(paletteOf(k).label.length > 0, true, `kind=${k} 缺一字标签`);
  }
  // 未知 kind 不许抛异常（旧实现是 `KIND_STYLE[kind] ?? KIND_STYLE.blank`）
  assert.equal(paletteOf('不存在的种类').label, KIND_PALETTE.blank.label);
  assert.equal(paletteOf('').label, KIND_PALETTE.blank.label);
});

test('Q2 三档类名齐全且都是字面量（Tailwind JIT 只扫字面量）', () => {
  for (const k of ALL_KINDS) {
    const p = KIND_PALETTE[k];
    for (const [name, v] of [['wash', p.wash], ['line', p.line], ['text', p.text]] as const) {
      assert.ok(v, `kind=${k} 的 ${name} 为空`);
      assert.doesNotMatch(
        v,
        /\$\{|\$\(/,
        `kind=${k} 的 ${name} 含插值 —— Tailwind 扫不到，样式会静默失效：${v}`,
      );
      assert.doesNotMatch(
        v,
        /\[#/,
        `kind=${k} 的 ${name} 用了任意值写法 bg-[#xxx] —— 同样扫不到：${v}`,
      );
    }
    // 左边条必须是 border-l-* —— BlockCard 用 `border-l-4 ${line}`
    assert.match(p.line, /^border-l-/, `kind=${k} 的 line 应为 border-l-*，实为 ${p.line}`);
  }
});

test('Q3 kindCls 拼出的类串包含全部三档', () => {
  for (const k of ALL_KINDS) {
    const p = KIND_PALETTE[k];
    const cls = kindCls(k);
    for (const v of [p.wash, p.line, p.text]) {
      assert.ok(cls.includes(v), `kindCls(${k}) 少了 ${v} —— 实得：${cls}`);
    }
  }
});

test('Q4 BlockCard 不再自带类别色（真源唯一）', () => {
  const src = readFileSync(join(ROOT, 'src/features/week/BlockCard.tsx'), 'utf8');
  // 剥掉块注释再查 —— 否则「这里以前是 bg-blue-100」这类说明文字会被误判。
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // 🔵 只禁**类别色**。组件里还有**语义色**是合法的，不能一并禁掉：
  //   · bg-green-600 →「🆕 新」徽标（强调状态）
  //   · bg-purple-100 →「校历事件」徽标（事件语义，与 activity 类别色无关）
  //   · bg-red-50/70 → 删除按钮的 hover（危险操作）
  // 判据按 KIND_PALETTE 用到的那几个色系 + 旧实现那七套的具体档位。
  const banned = [
    'bg-blue-100', 'border-blue-400', 'text-blue-900',
    'bg-amber-100', 'border-amber-400', 'text-amber-900',
    'bg-green-100', 'border-green-400', 'text-green-800',
    'bg-purple-100', 'border-purple-400', 'text-purple-900',
    'bg-pink-100', 'border-pink-400', 'text-pink-900',
    'bg-gray-100', 'border-gray-400',
  ];
  const hit = banned.filter((b) => code.includes(b));
  assert.deepEqual(
    hit,
    [],
    `BlockCard.tsx 里仍写着类别色 ${hit.join(', ')} —— 类别色真源已收口到 `
      + `constants/chartColors.KIND_PALETTE，组件里不该再有第二份。`,
  );
});

test('Q4b safelist 与 KIND_PALETTE 同步（漏登记 = 无样式且不报错）', () => {
  const cfg = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8');
  const missing = ALL_KINDS.flatMap((k) => {
    const p = KIND_PALETTE[k];
    return [p.wash, p.line, p.text].filter((v) => !cfg.includes(`'${v}'`));
  });
  assert.deepEqual(
    missing,
    [],
    `tailwind.config.js 的 safelist 少了：${missing.join(', ')} —— `
      + `这些类只在 chartColors 的字符串里拼出来，Tailwind 扫不到 `
      + `（**不会报错，只是界面没颜色**）。`,
  );
});

test('Q5 用餐块不显示地点，但 place 数据保留', () => {
  const src = readFileSync(join(ROOT, 'src/features/week/BlockCard.tsx'), 'utf8');
  assert.match(
    src,
    /block\.place\s*&&\s*block\.kind\s*!==\s*'meal'/,
    'BlockCard 的地点渲染应带上 `kind !== \'meal\'` 条件（用餐块不显示食堂）',
  );
  // 🔴 只藏不删：place 仍必须参与渲染判断之外的逻辑（转场/食堂偏好依赖它）。
  // 这里守的是「别把整个 block.place 分支删掉」—— 那会让非用餐块的地点也消失。
  assert.ok(
    /block\.place\s*&&/.test(src),
    'BlockCard 仍在读 block.place（若整段被删，非用餐块会失去地点）',
  );
});

/**
 * Q6 最狠的一条：这些类名必须**真的出现在构建产物 CSS 里**。
 * 前面五条防「写错」，这条防「Tailwind 没扫到」——
 * 类名写对了但产物里没有，运行时就是一片无样式，且不报任何错。
 */
test('Q6 类名真实存在于构建产物 CSS（Tailwind 没漏扫）', () => {
  const distDir = join(ROOT, 'dist/assets');
  if (!existsSync(distDir)) {
    // 没构建过就跳过 —— 不让「没跑 build」变成一条红灯。
    // 想严格些可改成断言失败，但首次克隆与只跑 tsc 的场景会误伤。
    return;
  }
  const cssFile = readdirSync(distDir).find((f) => f.endsWith('.css'));
  if (!cssFile) return;
  const css = readFileSync(join(distDir, cssFile), 'utf8');

  // Tailwind 产物里类名会被转义：`bg-indigo-50` → `.bg-indigo-50`，
  // 含 `/` 或 `:` 的会写成 `\/`，这里只查不含特殊字符的那些。
  const missing: string[] = [];
  for (const k of ALL_KINDS) {
    const p = KIND_PALETTE[k];
    for (const v of [p.wash, p.line, p.text]) {
      if (v.includes('/') || v.includes(':') || v.includes('[')) continue;
      if (!css.includes(`.${v}`)) missing.push(`${k}.${v}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `构建产物 CSS 里找不到这些类：${missing.join(', ')} —— `
      + `说明 Tailwind 没扫到（动态拼接的类名会被静默丢掉）。`,
  );
});