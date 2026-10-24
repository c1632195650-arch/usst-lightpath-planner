/**
 * refactor_run 驱动器纯函数守护测试（方案 §5 预留位 / 验收 P5 补齐，2026-10-24）
 * ============================================================
 * 驱动器是偿债批的提交管线（commit 规范的机器执行者），它的纯函数出问题
 * 会直接污染 drain 的 path-scoped 提交。这里锁五件事：
 *   ① COMMIT_RE 白名单（章程 §2.1 前缀表）——过松会放进不合规消息；
 *   ② forbiddenHit 禁区拒绝（src/types.ts / data/ / evals/golden / *.env）；
 *   ③ validateManifest：九批清单自身健康（id 唯一、消息合规、零禁区、deps 可解析）；
 *   ④ 台账解析与待补交队列：GREEN 且未 committed 才进队列（RED 不进），
 *      amendment 等未知事件类型被容忍（不炸 drain）；
 *   ⑤ drain 计划：subject/body 取驱动器 manifest（单一事实源），files 缺省回落清单。
 * RV（反向验证留痕）：COMMIT_RE 放宽一档 → ①恰红；pendingBatches 摘掉
 * verdict 过滤 → ④恰红（2026-10-24 验收批实测后还原）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BATCHES, COMMIT_RE, FORBIDDEN_RE, forbiddenHit, getBatch,
  validateManifest, parseLedger, committedIds, pendingBatches, buildDrainPlan,
} from './refactor_run.mjs';

test('P5 · COMMIT_RE：章程 §2.1 白名单前缀过、坏形态拒（RV：放宽前缀表 → 恰红）', () => {
  for (const ok of [
    'feat(week): 加入跨校区转场缓冲',
    'fix(libao): 修追问链在分号应答下的错位',
    'chore(pipeline): 数据管线脚本',
    'docs(plan): 重构偿债执行方案',
    'test(mobile): 通知桥纯函数',
    'refactor(libao): 时间解析拆出',
  ]) {
    assert.ok(COMMIT_RE.test(ok), `应放行：${ok}`);
  }
  for (const bad of [
    'feat week: 缺括号',
    'feat(WEEK): scope 大写',
    'feat(): 空 scope',
    'feat(week)',       // 缺冒号
    '风格(week): 中文前缀',
    'feat(week):',      // 冒号后无内容
  ]) {
    assert.equal(COMMIT_RE.test(bad), false, `应拒绝：${bad}`);
  }
});

test('P5 · forbiddenHit：夜间禁区与密钥路径一律拒绝，正常源码放行', () => {
  for (const bad of [
    'src/types.ts', 'data/usst_articles.db', 'evals/golden/plan_understand.jsonl',
    'server/.env', 'node_modules/react/index.js',
  ]) {
    assert.ok(forbiddenHit(bad), `应拒绝：${bad}`);
  }
  assert.equal(forbiddenHit('src/lib/storage.ts'), null);
  assert.equal(forbiddenHit('scripts/refactor_run.mjs'), null);
  assert.equal(FORBIDDEN_RE.length, 5, '禁区正则清单长度变化须同步本测试与章程 §3.1.3');
});

test('P5 · 清单自检：九批 id 唯一、消息全过白名单、文件零禁区、deps 可解析', () => {
  assert.deepEqual(validateManifest(), []);
  assert.equal(new Set(BATCHES.map((b) => b.id)).size, BATCHES.length, 'id 重复');
});

test('P5 · 台账解析：好行进、坏行计数不炸；amendment 未知事件被容忍', () => {
  const text = [
    JSON.stringify({ type: 'started', batch: 'r1-d4-build-decouple' }),
    JSON.stringify({ type: 'message-amended', batch: 'r4-d6-serve-positioning', message: { subject: 'x', body: 'y' } }),
    '# 注释行也不是 JSON，应计坏行而非抛异常',
    'not-json-at-all',
  ].join('\n');
  const { events, bad } = parseLedger(text);
  assert.equal(events.length, 2);
  assert.equal(bad, 2);
});

test('P5 · 待补交队列：GREEN 未 committed 才进队；RED 不进；committed 移除（RV：摘 verdict 过滤 → 恰红）', () => {
  const ev = [
    { type: 'finished', batch: 'r1-d4-build-decouple', verdict: 'GREEN', files: ['AGENTS.md'] },
    { type: 'finished', batch: 'r3-d9-snapshot-refresh', verdict: 'RED' },
    { type: 'finished', batch: 'r4-d6-serve-positioning', verdict: 'GREEN' },
    { type: 'committed', batch: 'r4-d6-serve-positioning', sha: 'abc1234' },
  ];
  const ids = pendingBatches(ev).map((b) => b.id);
  assert.deepEqual(ids, ['r1-d4-build-decouple'], '只应含 GREEN 且未提交的 r1');
  assert.deepEqual([...committedIds(ev)], ['r4-d6-serve-positioning']);
});

test('P5 · drain 计划：subject/body 取 manifest（单一事实源），files 回落清单缺省', () => {
  const ev = [
    { type: 'finished', batch: 'r7-d7-storage-gateway', verdict: 'GREEN', files: ['src/lib/storageGateway.ts'] },
  ];
  const plan = buildDrainPlan(ev);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].batch, 'r7-d7-storage-gateway');
  assert.equal(plan[0].files[0], 'src/lib/storageGateway.ts', '台账 files 优先');
  assert.equal(plan[0].subject, getBatch('r7-d7-storage-gateway').message.subject, 'subject 来自 manifest');
  assert.equal(plan[0].body, getBatch('r7-d7-storage-gateway').message.body, 'body 来自 manifest');
  // 无 finished 事件的批次不产生计划；有事件但 files 空 → 回落清单 files
  const plan2 = buildDrainPlan([
    { type: 'finished', batch: 'r6-d3-route-table', verdict: 'GREEN', files: [] },
  ]);
  assert.deepEqual(plan2[0].files, getBatch('r6-d3-route-table').files, 'files 空时回落清单');
});
