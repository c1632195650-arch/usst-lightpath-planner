#!/usr/bin/env node
/**
 * 版本号单源校验（维护批 P1-8，2026-10-11）
 * ============================================================
 * 背景：版本号此前在**四处**靠人工同步 —— package.json、server/version.json
 * （version 与 apkUrl 文件名）、mobile/android/app/build.gradle
 * （versionCode/versionName），已出过一次忘同步（commit 544d569 的教训）。
 *
 * 单一来源 = package.json 的 "version"。本脚本只读校验四处一致，漂移即 exit 1：
 *   ① package.json version                      （来源）
 *   ② server/version.json version               （F18 应用内检查更新的比对源）
 *   ③ server/version.json apkUrl 里的 lightpath-<ver>.apk 文件名
 *   ④ build.gradle versionName === <ver> 且 versionCode === version.json.versionCode
 *     （versionCode 无法从 semver 推导 —— 它是每次发版 +1 的整数，所以把
 *      version.json 增补一个 versionCode 字段作为 gradle 的同步点；
 *      /api/version 只挑 version/apkUrl/notes 三个键返回，额外键无害）
 *
 * 用法：
 *   node scripts/release_version.mjs             # 校验仓库当前状态
 *   node scripts/release_version.mjs --root X    # 校验别的目录（测试用）
 *
 * 发版流程（配套 checklist，随下次发版切换为 L2 生效）：
 *   1. 改 package.json version（唯一要人写的地方）
 *   2. 改 server/version.json：version / versionCode(+1) / apkUrl 文件名 / notes
 *   3. 改 build.gradle：versionCode / versionName
 *   4. 跑本脚本 → 必须 exit 0 才许构建 APK
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf('--root');
const ROOT = path.resolve(rootIdx >= 0 ? argv[rootIdx + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const readJson = (p) => JSON.parse(read(p));

const results = [];
let failed = false;
const fail = (msg) => { failed = true; results.push(`FAIL  ${msg}`); };
const ok = (msg) => results.push(`OK    ${msg}`);

let pkgVer;
try {
  pkgVer = readJson('package.json').version;
  if (typeof pkgVer !== 'string' || !/^\d+\.\d+\.\d+/.test(pkgVer)) throw new Error(`形态不对: ${pkgVer}`);
  ok(`单一来源 package.json version = ${pkgVer}`);
} catch (e) {
  fail(`package.json version 读不到或形态不对: ${e.message}`);
}

let vj;
try {
  vj = readJson('server/version.json');
  if (vj.version === pkgVer) ok(`server/version.json version = ${vj.version}`);
  else fail(`server/version.json version=${vj.version} ≠ package.json ${pkgVer}`);

  const expectApk = `lightpath-${pkgVer}.apk`;
  if (typeof vj.apkUrl === 'string' && vj.apkUrl.includes(expectApk)) ok(`apkUrl 含 ${expectApk}`);
  else fail(`apkUrl(${vj.apkUrl}) 未包含 ${expectApk}`);

  if (Number.isInteger(vj.versionCode) && vj.versionCode > 0) ok(`version.json versionCode = ${vj.versionCode}`);
  else fail('server/version.json 缺少整数 versionCode（P1-8 起作为 gradle 同步点，请增补）');
} catch (e) {
  fail(`server/version.json 解析失败: ${e.message}`);
}

try {
  const gradle = read('mobile/android/app/build.gradle');
  const name = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
  const code = gradle.match(/versionCode\s+(\d+)/)?.[1];
  if (name === pkgVer) ok(`build.gradle versionName = ${name}`);
  else fail(`build.gradle versionName=${name} ≠ package.json ${pkgVer}`);
  if (vj && Number(code) === vj.versionCode) ok(`build.gradle versionCode = ${code}`);
  else fail(`build.gradle versionCode=${code} ≠ version.json versionCode=${vj && vj.versionCode}`);
} catch (e) {
  fail(`build.gradle 读取失败: ${e.message}`);
}

for (const line of results) console.log(line);
if (failed) {
  console.error(`版本漂移！四处必须同为 ${pkgVer}（发版 checklist 见本文件头注释）`);
  process.exit(1);
}
console.log(`版本单源校验通过：四处一致 @ ${pkgVer} (code ${vj && vj.versionCode})`);
