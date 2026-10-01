/**
 * AC-11 localStorage key 登记守卫（前端架构规格书 §11 AC-11）
 * ============================================================
 * 双向校验，防两类事故：
 *   ① **漏登记**：`src/**` 里出现 `'usst-…'` 字面量，但没进 `STORAGE_KEYS`
 *      → 意味着"悄悄多了一个持久化 key"，没人知道归谁、能不能清；
 *   ② **僵尸登记**：表里登记了某个 key，但代码里已经没人用
 *      → 意味着"以为还在用的 key 其实早废了"，迁移/清理时会误判。
 *
 * 另校验登记元数据自身可用：`module` 指向的文件必须存在、`owner` 必须是 CY/B。
 *
 * 零依赖纯静态扫描（node:fs / node:path），与 `arch-guards.test.ts` 同风格。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORAGE_KEYS, STORAGE_KEY_LIST, isRegisteredKey } from '@/lib/storageRegistry';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..', 'src');

/** 登记表自身要排除在扫描外 —— 否则"正向"校验会被表里的字面量自证成立 */
const REGISTRY_REL = 'lib/storageRegistry.ts';

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

/** 剥注释：`useWeekPlan.ts` 等文件在注释里提到 key 名，不算使用 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

const relOf = (file: string): string => relative(SRC_ROOT, file).split(sep).join('/');

/**
 * 收集代码里的 `'usst-…' / 'usst.…'` 字符串字面量（单/双引号；反引号里的模板串不在此列）。
 * 2026-09-27 起**两种风格都算**：连字符（`usst-xxx`）与点号（`usst.xxx`）——
 * 点号风格此前漏扫，`usst.telemetry.v1` / `usst.libao.*` 三个 key 因此长期脱管。
 */
function keyLiterals(code: string): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(/['"]((?:usst-[a-z0-9-]+)|(?:usst\.[a-z0-9_.-]+))['"]/g)) {
    found.push(m[1]);
  }
  return found;
}

function existsFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/* ============================================================
 * ① 正向：代码里出现的 key 必须在登记表里
 * ========================================================== */

test('AC-11①：src/** 出现的 usst-* key 全部已登记（防漏登记）', () => {
  const unregistered: string[] = [];
  for (const file of listTsFiles(SRC_ROOT)) {
    if (relOf(file) === REGISTRY_REL) continue;
    for (const key of keyLiterals(stripComments(readFileSync(file, 'utf8')))) {
      if (!isRegisteredKey(key)) unregistered.push(`${relOf(file)} → ${key}`);
    }
  }
  assert.deepEqual(
    unregistered,
    [],
    '发现未登记的 localStorage key —— 请加进 src/lib/storageRegistry.ts：\n' + unregistered.join('\n'),
  );
});

/* ============================================================
 * ② 反向：登记表里的 key 必须真的被代码用到
 * ========================================================== */

test('AC-11②：登记表里的 key 都真的被代码使用（防僵尸登记）', () => {
  const used = new Set<string>();
  for (const file of listTsFiles(SRC_ROOT)) {
    if (relOf(file) === REGISTRY_REL) continue;
    for (const key of keyLiterals(stripComments(readFileSync(file, 'utf8')))) used.add(key);
  }
  const zombies = STORAGE_KEY_LIST.filter((k) => !used.has(k));
  assert.deepEqual(
    zombies,
    [],
    '登记表里这些 key 在 src/** 已无人使用 —— 清理代码或从登记表删除：\n' + zombies.join('\n'),
  );
});

/* ============================================================
 * ③ 元数据自身可用：module 文件存在、owner 合法
 * ========================================================== */

test('AC-11③：登记元数据自洽（module 文件存在 / owner 合法）', () => {
  const problems: string[] = [];
  for (const key of STORAGE_KEY_LIST) {
    const meta = STORAGE_KEYS[key];
    if (meta.owner !== 'CY' && meta.owner !== 'B') {
      problems.push(`${key} 的 owner「${meta.owner}」不是 CY / B`);
    }
    const candidates = [
      join(SRC_ROOT, `${meta.module}.ts`),
      join(SRC_ROOT, `${meta.module}.tsx`),
    ];
    if (!candidates.some(existsFile)) {
      problems.push(`${key} 的 module「${meta.module}」找不到对应文件`);
    }
  }
  assert.deepEqual(problems, [], '登记表元数据有问题：\n' + problems.join('\n'));
});
