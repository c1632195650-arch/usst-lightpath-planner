/**
 * 注册 `@/` 别名钩子（零依赖跑 .ts 测试的入口）
 * ============================================================
 * 配套：`scripts/alias-hook.mjs`（提供 resolve 钩子）
 *
 * 用法：
 *   node --import ./scripts/register-alias.mjs --test "scripts/**\/*.test.ts"
 *
 * 为什么不用 tsx：规格书定的是「零新增依赖」；Node 24 已原生剥离 TS 类型，
 * 我们唯一缺的只是别名解析——一个 10 行的钩子就够，不必引一个包。
 */
import { register } from 'node:module';

register('./alias-hook.mjs', import.meta.url);
