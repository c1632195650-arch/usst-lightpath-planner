/**
 * ICS 空值提示源码锁（2026-10-06 验收缺陷②修复的守护）
 * ============================================================
 * P6-2：web-only 用户第一次要靠移动页同步一次才有 ICS —— 空值时 UI 必须
 * 给出「怎么把链接变出来」的提示，不许静默不渲染。
 * .tsx 渲染不被 node 测试加载器支持（nowTip.ts 同款口径）→ 用源码锁：
 * 剥注释后断言空值分支与提示 testid 在位、旧的「整体 return null」已删。
 * ⚠️ 反向验证（实跑见 overnight-log）：恢复 `if (!icsToken) return null;` → 本文件红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// 路径用单字面量 '../../src/...'（capability_map.mjs 源码锁通道只认含 src/ 的
// 整段字符串；分段 join 会被误判「无源码依赖」成孤立测试，--check 恒红）。
const src = readFileSync(join(here, '../../src/features/mobile/IcsGuide.tsx'), 'utf8');

/** 剥行注释与块注释（源码锁同款口径，防「写在注释里骗测试」） */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('ICS 空值：不静默——空值提示 testid 在渲染路径上（非注释）', () => {
  const code = stripComments(src);
  assert.ok(code.includes('m-ics-empty'), '缺 m-ics-empty 空值提示渲染');
  assert.ok(code.includes('icsToken') && code.includes('open && !icsToken'), '空值分支必须挂在渲染条件上');
});

test('ICS 空值：旧的「无 token 整体 return null」已删（提示要在用户眼前）', () => {
  const code = stripComments(src);
  assert.ok(!code.includes('if (!icsToken) return null'), '静默不渲染=缺陷②复发');
});

test('ICS 空值：提示含「怎么变出链接」的行动指引（同步一次）', () => {
  const code = stripComments(src);
  assert.ok(code.includes('点一次同步'), '指引必须说明要同步一次');
  assert.ok(code.includes('网页端'), '指引必须指向网页端排计划');
});
