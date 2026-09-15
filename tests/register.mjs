// 零依赖测试入口：注册 `@/` 别名钩子后交给 node --test。
// 用法： node --import ./tests/register.mjs --test "tests/**/*.test.ts"
import { register } from 'node:module';

register('./alias-hook.mjs', import.meta.url);
