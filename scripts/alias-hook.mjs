/**
 * TS 源码在 Node 下的解析钩子（Node module customization hook）
 * ============================================================
 * 仓库的 TS 源码有三处 Node 原生跑不了的地方，本钩子一次性解决：
 *
 *  1. **`@/` 别名导入**（tsconfig paths），如 `@/types`、`@/lib/date`。
 *  2. **相对路径省略扩展名**，如 `transfer.ts` 里的 `../api`。
 *     ⚠️ 这条曾长期缺失：只要测试链路 import 到 `lib/planner/transfer.ts`，
 *        Node 就报 `ERR_MODULE_NOT_FOUND`。补上后，测试不再需要为绕开依赖而
 *        把静态 import 改成动态 `import()`。
 *  3. **`import.meta.env`**（Vite 专有），如 `lib/api.ts` 的 `VITE_API_BASE`、
 *     `App.tsx` 的 `DEV`。Node 里它是 undefined，**读取即抛**。这里在 load 阶段
 *     替换成 `globalThis.__VITE_ENV__`；默认空对象 → 各处的 `?? 默认值` 生效
 *     （`api.ts` 于是回落到 `http://127.0.0.1:8000`，正合本地联调）。
 *     测试若想指定，只需在 import 之前 `globalThis.__VITE_ENV__ = {...}`。
 *
 * 用法见同目录 `register-alias.mjs`；`package.json` 的 `test:ui` / `test:engine` 都走它。
 *
 * ⚠️ 与 B 的 `_devtools/register.mjs` + `alias-hook.mjs` 功能重复。
 *    D4 落地（验收脚本收进 `tests/`）后应合并为一套，别让两套钩子各自演化。
 */

const SRC = new URL('../src/', import.meta.url);

/** 已带扩展名的原样解析，否则补扩展名（源码里两种写法都有） */
const HAS_EXT = /\.[a-z]+$/i;

/** 相对导入可补的扩展名，按优先级尝试 */
const TRY_EXT = ['.ts', '.tsx'];
/** 目录导入的入口候选 */
const TRY_INDEX = ['/index.ts', '/index.tsx'];

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const rel = specifier.slice(2);
    const target = HAS_EXT.test(rel) ? rel : `${rel}.ts`;
    return nextResolve(new URL(target, SRC).href, context);
  }

  if (specifier.startsWith('.') && !HAS_EXT.test(specifier)) {
    for (const ext of TRY_EXT) {
      try {
        return await nextResolve(`${specifier}${ext}`, context);
      } catch { /* 试下一个 */ }
    }
    for (const idx of TRY_INDEX) {
      try {
        return await nextResolve(`${specifier}${idx}`, context);
      } catch { /* 试下一个 */ }
    }
    // 都补不出来 → 交回默认解析，别把真实存在的 .js/.json 也挡掉
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (result.source != null && !url.includes('/node_modules/')) {
    const src = result.source.toString();
    if (src.includes('import.meta.env')) {
      return {
        ...result,
        source: src.replace(/import\.meta\.env/g, '(globalThis.__VITE_ENV__ ?? {})'),
      };
    }
  }
  return result;
}
