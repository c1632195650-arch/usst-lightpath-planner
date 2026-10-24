#!/usr/bin/env node
/**
 * check_backend_consistency —— 双后端地址一致性互查（重构偿债 D6，r4，2026-10-24）
 * ============================================================
 * 为什么查的是"后端地址一致性"而不是 CORS（r4 recon 修正）：
 *   · serve.py 是同源一体化服务，**没有也不需要** CORS 白名单（真 CORS 在
 *     server/app.py::_CORS_DEFAULT，只放行本机 dev 端口）——两处并不双维护；
 *   · 真正的双后端漂移点是**硬编码的后端地址**：serve.py 的 CY_API_TARGET
 *     （本地转发目标）↔ src/lib/apiBase.ts 的 INLINE_API_FALLBACK（APK 包内
 *     兜底）↔ server/version.json 的 apkUrl（应用内更新下载源）。2026-10-22
 *     服务器迁移时就漏过 serve.py 这处（仍指旧机 101.35.253.143，10-25 到期
 *     后本地"梨宝脑"转发整体变死链）——r4 已对齐，本脚本防再次漂移。
 *
 * 规则：三处的 host 必须完全一致；任何一处提取不到也算不一致（锁存在性，
 * 防有人把常量改名/删掉后互查静默变成"两处一致"）。
 *
 * 用法：node scripts/check_backend_consistency.mjs        # 真文件互查，漂移 exit 1
 * 纯函数（hostOf / extractServeTarget 等）导出供 backend_consistency.test.ts 直测。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 从 URL 提取 host（去端口）。非 URL → null。 */
export function hostOf(url) {
  const m = String(url ?? '').match(/https?:\/\/([^/'"\s]+)/);
  return m ? m[1].replace(/:\d+$/, '') : null;
}

/** serve.py 的梨宝脑转发目标（CY_API_TARGET = "http://…"）。 */
export function extractServeTarget(servePyText) {
  return String(servePyText ?? '').match(/CY_API_TARGET\s*=\s*"(https?:\/\/[^"]+)"/)?.[1] ?? null;
}

/** apiBase.ts 的 APK 包内兜底（INLINE_API_FALLBACK = 'http://…'）。 */
export function extractInlineFallback(apiBaseText) {
  return String(apiBaseText ?? '').match(/INLINE_API_FALLBACK\s*=\s*'(https?:\/\/[^']+)'/)?.[1] ?? null;
}

/** version.json 的 apkUrl（应用内更新下载源）。 */
export function extractApkUrl(versionJsonText) {
  try {
    return JSON.parse(String(versionJsonText ?? '')).apkUrl ?? null;
  } catch {
    return null;
  }
}

/** 三处 host 的一致性判定 → 问题清单（空 = 一致）。纯函数，测试双向用。 */
export function diffConsistency({ serveTarget, inlineFallback, apkUrl }) {
  const problems = [];
  const named = [
    ['serve.py CY_API_TARGET（本地梨宝脑转发）', serveTarget],
    ['apiBase.ts INLINE_API_FALLBACK（APK 包内兜底）', inlineFallback],
    ['server/version.json apkUrl（应用内更新源）', apkUrl],
  ];
  for (const [label, url] of named) {
    if (!url) problems.push(`${label}：提取不到（常量被改名/删除？互查不许静默退化）`);
  }
  const hosts = named.filter(([, u]) => u).map(([l, u]) => [l, hostOf(u)]);
  for (const [label, h] of hosts) {
    if (!h) problems.push(`${label}：不是 http(s) URL（${label}）`);
  }
  const uniq = [...new Set(hosts.map(([, h]) => h).filter(Boolean))];
  if (uniq.length > 1) {
    problems.push(`后端地址漂移：${hosts.map(([l, h]) => `${h}（${l}）`).join(' ≠ ')}`);
  }
  return problems;
}

/** 对仓库真文件跑互查（测试与 CLI 共用）。 */
export function checkRepo(repoRoot = ROOT) {
  const read = (p) => {
    try { return readFileSync(path.join(repoRoot, p), 'utf8'); } catch { return ''; }
  };
  const ctx = {
    serveTarget: extractServeTarget(read('serve.py')),
    inlineFallback: extractInlineFallback(read('src/lib/apiBase.ts')),
    apkUrl: extractApkUrl(read('server/version.json')),
  };
  return { ctx, problems: diffConsistency(ctx) };
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const { ctx, problems } = checkRepo();
  console.log('==== 双后端地址一致性 ====');
  for (const [k, v] of Object.entries(ctx)) console.log(`  ${k}: ${v ?? '（未提取到）'}`);
  if (problems.length) {
    console.error(`\n[check_backend_consistency] ❌ ${problems.length} 处不一致：`);
    problems.forEach((p) => console.error('  - ' + p));
    process.exit(1);
  }
  console.log('\n[check_backend_consistency] ✅ 三处后端地址一致');
}
