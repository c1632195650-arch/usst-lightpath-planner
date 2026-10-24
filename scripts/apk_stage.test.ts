/**
 * D4 · APK 暂存与 vite 输出解耦（r1-d4-build-decouple，2026-10-24）的守护测试
 * ============================================================
 * 背景：vite build 默认清空 dist/，而 APK 此前暂存在 dist/apk/ —— 每次前端
 * 构建都会无声冲掉安装包，曾造成公网 APK 短暂 404。本批把暂存目录改为
 * dist-apk/，由 scripts/stage_apk.mjs 负责暂存与命名。
 *
 * 这里守三道闸（对应最容易回潮的三种旧习惯）：
 *   ① 目标校验纯函数：任何落在 dist/ 内的目标一律拒绝（含 `..\dist` 穿越）；
 *   ② 源码锁：拒绝 dist 的判定逻辑字面在位，不许被"顺手简化"掉；
 *   ③ 配套同步：.gitignore 列了 dist-apk/、真机走查清单 §8 改走 stage_apk。
 *
 * 不碰真实文件系统、不执行 CLI main（stage_apk.mjs 有 invoked 守卫，import 无副作用）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkDestDir, apkFileName } from './stage_apk.mjs';

const here = dirname(fileURLToPath(import.meta.url));

test('D4 · 目标校验：落在 dist/ 内的写法一律拒绝（含 dist/apk 与 ..\\dist 穿越）', () => {
  const bad = [
    'dist',                                  // dist/ 本身
    'dist/',                                 // 尾斜杠形态
    'dist/apk',                              // 旧暂存位置（事故现场）
    'dist\\apk',                             // 反斜杠形态
    'dist-apk\\..\\dist\\x',                 // 穿越写法：必须在 resolve 掉 .. 之后判定
    'dist-apk/../dist/x',                    // 穿越写法（正斜杠版）
  ];
  for (const d of bad) {
    const r = checkDestDir(d);
    assert.equal(r.ok, false, `checkDestDir(${JSON.stringify(d)}) 应拒绝（D4：vite 清空 dist/ 会冲掉 APK）`);
    assert.ok(typeof r.reason === 'string' && r.reason.includes('dist'), '拒绝时必须给出说明原因');
  }
});

test('D4 · 目标校验：dist-apk/（新暂存目录）放行，且返回解析后的绝对路径', () => {
  for (const d of ['dist-apk', 'dist-apk/']) {
    const r = checkDestDir(d);
    assert.equal(r.ok, true, `checkDestDir(${JSON.stringify(d)}) 应放行`);
    assert.ok(typeof r.abs === 'string' && r.abs.endsWith('dist-apk'), '放行时必须带回解析后的绝对路径');
  }
});

test('D4 · 命名：产物名 = lightpath-<version>.apk（版本单一事实源在 package.json）', () => {
  assert.equal(apkFileName('0.4.10'), 'lightpath-0.4.10.apk');
  assert.equal(apkFileName('1.0.0'), 'lightpath-1.0.0.apk');
});

test('D4 · 源码锁：stage_apk.mjs 里"拒绝 dist"的判定字面在位（不许顺手简化掉）', () => {
  const src = readFileSync(join(here, 'stage_apk.mjs'), 'utf8');
  // 判定核心：以仓库根下的 dist/ 为基准做 path.relative —— 拿掉这行，穿越与直达全部漏网
  assert.ok(src.includes("path.relative(path.resolve(repoRoot, 'dist')"),
    'stage_apk.mjs 丢了以 dist/ 为基准的 relative 判定 —— D4 拒绝逻辑被破坏');
  // CLI 出口守卫：被本测试 import 时不得执行 main —— 锁精确表达式而非单词，
  // 否则注释里出现"invoked"也能骗过断言（RV-4b 实测踩过这个坑）
  assert.ok(src.includes('pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url'),
    'stage_apk.mjs 丢了 invoked 守卫（argv[1] === import.meta.url 判定）—— 被测试 import 时会执行 main');
});

test('D4 · .gitignore 已列 dist-apk/（暂存目录是构建产物，不进仓库）', () => {
  const gi = readFileSync(join(here, '..', '.gitignore'), 'utf8');
  assert.ok(gi.split(/\r?\n/).includes('dist-apk/'),
    '.gitignore 缺 dist-apk/ —— 暂存目录会以未跟踪文件污染工作区');
});

test('D4 · 真机走查清单 §8 的重出 APK 命令链已改走 stage_apk（不再手工 cp 进 dist/apk）', () => {
  const doc = readFileSync(join(here, '..', 'docs', '真机走查准备清单-2026-10-06.md'), 'utf8');
  assert.ok(doc.includes('node scripts/stage_apk.mjs'),
    'docs/真机走查准备清单-2026-10-06.md 未提及 stage_apk —— 下次重出 APK 还会按旧命令 cp 进 dist/apk');
});
