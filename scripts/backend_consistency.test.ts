/**
 * r4 · 双后端地址一致性互查的守护测试（D6，2026-10-24）
 * ============================================================
 * 背景：2026-10-22 服务器迁移漏改了 serve.py 的 CY_API_TARGET（仍指旧机
 * 101.35.253.143，10-25 到期后本地梨宝脑转发整体死链）——r4 已对齐，
 * 本测试防再次漂移：serve.py 转发目标 / apiBase 包内兜底 / version.json
 * 更新源三处 host 必须一致（scripts/check_backend_consistency.mjs 为实现）。
 *
 * RV（反向验证留痕）：
 *   · 把 serve.py 的 CY_API_TARGET 临时改回旧机 IP → 真文件组恰红（实测过再还原）；
 *   · fixture 组本身就是"注入漂移必红"的双向证明。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostOf,
  extractServeTarget,
  extractInlineFallback,
  extractApkUrl,
  diffConsistency,
  checkRepo,
} from './check_backend_consistency.mjs';

test('r4 · 提取器：三种来源各自拿得到 URL', () => {
  assert.equal(hostOf('http://43.142.141.186/apk/x.apk'), '43.142.141.186');
  assert.equal(hostOf('http://localhost:5173'), 'localhost');
  assert.equal(hostOf('not-a-url'), null);
  assert.equal(
    extractServeTarget('CY_API_TARGET = "http://1.2.3.4"\n'),
    'http://1.2.3.4',
  );
  assert.equal(
    extractInlineFallback("const INLINE_API_FALLBACK = 'http://1.2.3.4';"),
    'http://1.2.3.4',
  );
  assert.equal(extractApkUrl('{"apkUrl":"http://1.2.3.4/apk/a.apk"}'), 'http://1.2.3.4/apk/a.apk');
  assert.equal(extractApkUrl('broken json'), null);
});

test('r4 · 一致性判定：三处同 host → 零问题（fixture 正向）', () => {
  const r = diffConsistency({
    serveTarget: 'http://43.142.141.186',
    inlineFallback: 'http://43.142.141.186',
    apkUrl: 'http://43.142.141.186/apk/lightpath-0.4.10.apk',
  });
  assert.deepEqual(r, []);
});

test('r4 · 一致性判定：一处漂移（旧机 IP 混入）→ 必须点名报告（RV：改回旧值即红）', () => {
  const r = diffConsistency({
    serveTarget: 'http://101.35.253.143',
    inlineFallback: 'http://43.142.141.186',
    apkUrl: 'http://43.142.141.186/apk/lightpath-0.4.10.apk',
  });
  assert.ok(r.some((p) => p.includes('漂移') && p.includes('101.35.253.143')), JSON.stringify(r));
});

test('r4 · 一致性判定：常量消失（改名/删除）→ 也要红（锁存在性，不许静默退化）', () => {
  const r = diffConsistency({ serveTarget: null, inlineFallback: 'http://43.142.141.186', apkUrl: null });
  assert.ok(r.some((p) => p.includes('提取不到')), JSON.stringify(r));
});

test('r4 · 真文件互查：当前仓库三处后端地址一致（serve.py / apiBase / version.json）', () => {
  const { ctx, problems } = checkRepo();
  assert.deepEqual(problems, [], `真文件互查发现问题：${problems.join('；')}\nctx=${JSON.stringify(ctx)}`);
});
