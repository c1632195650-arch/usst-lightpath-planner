#!/usr/bin/env node
/**
 * stage_apk —— 把 gradle 产出的签名 APK 暂存到 dist-apk/（与 vite 输出解耦）
 * ============================================================
 * 为什么存在（重构偿债 D4，2026-10-24 批 r1-d4-build-decouple）：
 *   vite.config.ts 的 build.outDir='dist'，vite 构建默认会**清空 dist/**，
 *   而 APK 此前一直暂存在 dist/apk/ —— 每次 `npm run build` 都会把安装包
 *   无声冲掉，历史上曾直接造成**公网 APK 短暂 404**（重新出包后忘了补回、
 *   又被下一次前端构建清空）。根修不是改 vite 行为，而是让 APK 根本不住在
 *   dist/ 里：暂存目录固定为 dist-apk/（.gitignore 已列），与 vite 输出互不知晓。
 *
 *   为防旧习惯回潮，本脚本**从根上拒绝**任何落在 dist/ 内的目标路径
 *  （含 dist/apk、以及 `dist-apk/..\dist\x` 这类穿越写法）——宁可当场 exit 1，
 *   也不给 vite 留下再清一次的机会。
 *
 * 用法：
 *   node scripts/stage_apk.mjs [--src <apk路径>] [--dest <目标目录>]
 *
 *   · 默认源：mobile/android/app/build/outputs/apk/release/app-release.apk（--src 可覆盖）
 *   · 默认目标目录：dist-apk/（--dest 可覆盖，但落在 dist/ 内一律拒绝）
 *   · 产物名：lightpath-<package.json 的 version>.apk（单一事实源，杜绝手滑写错版本号）
 *
 * 退出码：0 = 复制成功（打印字节数）；1 = 源不存在 / 目标落在 dist/ 内。
 *
 * 测试：scripts/apk_stage.test.ts 直接 import 下方的纯函数
 *  （checkDestDir / apkFileName），CLI 入口有 invoked 守卫，被 import 时不执行 main。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SRC = path.join(ROOT, 'mobile/android/app/build/outputs/apk/release/app-release.apk');
const DEFAULT_DEST_DIR = path.join(ROOT, 'dist-apk');

/* ============================================================================
 * 1. 纯函数（供测试 import；不碰文件系统）
 * ========================================================================== */

/**
 * 判断绝对路径是否等于 dist/ 或落在 dist/ 内。
 * 必须在 resolve 掉 `..` 段**之后**判定，否则 `dist-apk\..\dist\x` 会漏网。
 * （path.win32 在 win32 上比较路径是大小写不敏感的，`DIST/x` 同样会被拒。）
 */
export function isInsideDist(absPath, repoRoot = ROOT) {
  const rel = path.relative(path.resolve(repoRoot, 'dist'), path.resolve(absPath));
  if (rel === '') return true;                                  // 目标就是 dist/ 本身
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * 校验目标目录：落在 dist/ 内 → { ok:false, reason }；否则 → { ok:true, abs }。
 * 这是 CLI 出 exit 1 的唯一判定来源，也是测试的锚点。
 */
export function checkDestDir(destDir, repoRoot = ROOT) {
  // 相对路径一律按仓库根解析（本脚本的默认用法就在仓库根跑；绝对路径则原样）
  const abs = path.resolve(repoRoot, destDir);
  if (isInsideDist(abs, repoRoot)) {
    return {
      ok: false,
      reason: `目标目录「${destDir}」落在 dist/ 内（解析后为 ${abs}）。` +
        `vite 构建会清空 dist/（D4 事故根因），APK 一律暂存到 dist-apk/ 等独立目录。`,
    };
  }
  return { ok: true, abs };
}

/** 产物命名：lightpath-<version>.apk。版本来自 package.json，不手敲。 */
export function apkFileName(version) {
  return `lightpath-${version}.apk`;
}

/* ============================================================================
 * 2. CLI 外壳
 * ========================================================================== */
function readVersion() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

function main() {
  const argv = process.argv.slice(2);
  const pick = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };

  const src = pick('--src') ? path.resolve(pick('--src')) : DEFAULT_SRC;
  const destArg = pick('--dest');
  const destDir = destArg ? path.resolve(destArg) : DEFAULT_DEST_DIR;

  if (!existsSync(src) || !statSync(src).isFile()) {
    console.error(`[stage_apk] ❌ 源 APK 不存在：${src}\n` +
      `  先完成 gradle 出包（见 docs/真机走查准备清单-2026-10-06.md §8），或用 --src 指定路径。`);
    process.exit(1);
  }

  const check = checkDestDir(destDir);
  if (!check.ok) {
    console.error(`[stage_apk] ❌ ${check.reason}`);
    process.exit(1);
  }

  const target = path.join(check.abs, apkFileName(readVersion()));
  mkdirSync(check.abs, { recursive: true });
  copyFileSync(src, target);
  const bytes = statSync(target).size;
  console.log(`[stage_apk] ✅ ${src}\n  → ${target}（${bytes.toLocaleString('en-US')} 字节）`);
  return 0;
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const code = main();
  if (typeof code === 'number' && code !== 0) process.exit(code);
}
