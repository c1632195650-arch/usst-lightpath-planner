/**
 * `@/` 别名解析钩子（Node module customization hook）
 * ============================================================
 * 仓库的 TS 源码用 `@/types`、`@/lib/date` 这类**别名导入**（tsconfig paths），
 * 而 Node 原生不认识别名。此前靠 `tsx` 解决，但规格书纪律是「零新增依赖」，
 * 故改用 Node 自带的 hooks（Node 20.6+ 提供，24 已稳定）。
 *
 * ⚠️ 与 B 的 `_devtools/register.mjs` + `alias-hook.mjs` 功能重复。
 *    D4 落地（验收脚本收进 `tests/`）后，本文件应删除、统一用 `tests/` 那一套。
 *
 * 用法见同目录 `register-alias.mjs`。
 */

const SRC = new URL('../src/', import.meta.url);

/** 已带扩展名的原样解析，否则补 `.ts`（源码里两种写法都有） */
const HAS_EXT = /\.[a-z]+$/i;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const rel = specifier.slice(2);
    const target = HAS_EXT.test(rel) ? rel : `${rel}.ts`;
    return nextResolve(new URL(target, SRC).href, context);
  }
  return nextResolve(specifier, context);
}
