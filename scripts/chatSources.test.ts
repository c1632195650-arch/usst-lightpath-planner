/**
 * F2 · 引用溯源 + 不确定分级（2026-10-24）
 * ============================================================
 * 组件无 DOM 测试先例 —— 沿用 app_error_boundary.test.ts 的两段式：
 *  ① 纯逻辑：confidenceModel 的四态映射与来源可见集（直接 import 测）；
 *  ② 源码锁：readFileSync 断言挂载点 / 契约字段真实存在 —— 拆挂载即红（RV 锚点）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { CONFIDENCE_META, confidenceMeta, visibleSources } from '@/components/ui/confidenceModel';
import type { RagSource } from '@/lib/api';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function src(url: string, i = 0): RagSource {
  return { title: `通知${i}`, account: '学生处', pub_time: '2026-10-24', snippet: '', url };
}

test('confidenceMeta：四态各自映射到固定文案与色调', () => {
  assert.equal(CONFIDENCE_META.cited.label, '✅ 依据校园公开信息');
  assert.equal(CONFIDENCE_META.inferred.tone, 'warn');
  assert.equal(CONFIDENCE_META.structured.label, '🧩 来自校内数据');
  assert.equal(CONFIDENCE_META.none.tone, 'line');
});

test('confidenceMeta：未知/缺失 level 返回 null（不渲染徽章，宁缺毋滥）', () => {
  assert.equal(confidenceMeta(undefined), null);
  assert.equal(confidenceMeta(null), null);
  assert.equal(confidenceMeta('hallucinated'), null);
});

test('visibleSources：默认截前 3 条，展开后全量；空来源恒空', () => {
  const list = [src('u1'), src('u2'), src('u3'), src('u4'), src('u5')];
  assert.equal(visibleSources(list, false).length, 3);
  assert.equal(visibleSources(list, true).length, 5);
  assert.deepEqual(visibleSources([], true), []);
  assert.equal(visibleSources(list.slice(0, 2), false).length, 2, '不足 max 时全量展示');
});

test('源码锁：LbaoChat 挂载 SourceChips + ConfidenceBadge 并透传 confidence', () => {
  const t = read('src/features/libao/LbaoChat.tsx');
  assert.match(t, /<SourceChips/, '来源卡组件必须挂在 web 梨宝回答块');
  assert.match(t, /<ConfidenceBadge/, '置信徽章必须挂在 web 梨宝回答块');
  assert.match(t, /confidence: response\.confidence/, 'ragReply 必须把后端 confidence 写进消息');
});

test('源码锁：LbaoDrawer 挂载两组件并消费 done 帧与降级响应的来源', () => {
  const t = read('src/features/mobile/LbaoDrawer.tsx');
  assert.match(t, /<SourceChips/, '移动端抽屉也挂来源卡');
  assert.match(t, /<ConfidenceBadge/, '移动端抽屉也挂置信徽章');
  assert.match(t, /ev\.type === 'done'/, 'SSE done 帧必须被消费（sources/confidence 靠它）');
  assert.match(t, /Array\.isArray\(body\.sources\)/, '一次性降级路径必须透传 sources');
});

test('源码锁：契约面 —— app.py 调统一置信度函数、SSE done 帧含新键、api.ts 声明字段', () => {
  const app = read('server/app.py');
  assert.match(app, /compute_confidence/, '_chat_core 必须调用统一置信度函数（server/confidence.py）');
  assert.match(app, /"confidence", "kb"/, 'SSE done 帧必须只增透传 confidence/kb');
  const api = read('src/lib/api.ts');
  assert.match(api, /confidence\?/, 'ChatResult 必须声明 confidence 可选字段');
});
