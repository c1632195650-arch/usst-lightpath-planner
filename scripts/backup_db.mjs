#!/usr/bin/env node
/**
 * SQLite 三库备份脚本（维护批 P1-1，2026-10-11）
 * ============================================================
 * 背景：data/ 下三库（libao_account / libao_memory / lightpath）此前全在单机单盘、
 * 全仓零备份逻辑 —— 2026-10-06 的 dist 事故靠本地备份侥幸恢复（BLOCKERS 留痕）。
 * 本脚本是维护计划 P1-1 的「最低配兜底」：SQLite 官方 `VACUUM INTO` 做一致性好、
 * 单文件、免进程的快照（Litestream 流式复制是 P1-1 首选，见维护计划 §5.5；
 * 在服务器跑通 litestream 之前先用本脚本 + 计划任务顶住）。
 *
 * 用法（服务器 crontab / Windows 计划任务通用）：
 *   node scripts/backup_db.mjs                 # 备份全部存在的库 → _backups/<时间戳>/
 *   LIBAO_BACKUP_DIR=/opt/usst/backup node scripts/backup_db.mjs
 *   node scripts/backup_db.mjs --keep 7        # 只保留最近 7 份（默认 14）
 *
 * 设计约束：
 *   · 零新增依赖（node:sqlite 内置，Node ≥22.5）；
 *   · 源库只读（VACUUM INTO 不改源库、不需要停服）；
 *   · 每份备份后跑 PRAGMA integrity_check，坏档立即报错退出（备份不可信=没备份）；
 *   · 只清理**本脚本自己命名模式**的旧档，绝不动 data/ 原库。
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DATA_DIR = process.env.LIBAO_DATA_DIR || path.join(ROOT, 'data');
const BACKUP_DIR = process.env.LIBAO_BACKUP_DIR || path.join(ROOT, '_backups');
const KEEP = (() => {
  const i = process.argv.indexOf('--keep');
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isInteger(v) && v > 0 ? v : 14;
})();

const SOURCES = ['libao_account.db', 'libao_memory.db', 'lightpath.db'];

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const destDir = path.join(BACKUP_DIR, stamp);
fs.mkdirSync(destDir, { recursive: true });

const results = [];
let failed = false;

for (const name of SOURCES) {
  const src = path.join(DATA_DIR, name);
  if (!fs.existsSync(src)) {
    results.push(`SKIP  ${name}（不存在，跳过 —— 本地未起过该服务属正常）`);
    continue;
  }
  const dest = path.join(destDir, name).replaceAll('\\', '/');
  const db = new DatabaseSync(src);
  try {
    // VACUUM INTO：对 WAL 源库安全（拿一致性快照写进全新单文件），源库零改动
    db.exec(`VACUUM INTO '${dest}'`);
  } finally {
    db.close();
  }
  // 坏档不如没档：立刻对副本做完整性校验
  const check = new DatabaseSync(dest);
  try {
    const row = check.prepare('PRAGMA integrity_check').get();
    const ok = row && row.integrity_check === 'ok';
    const size = fs.statSync(dest).size;
    if (!ok) {
      failed = true;
      results.push(`FAIL  ${name} → 完整性校验未过: ${JSON.stringify(row)}`);
    } else {
      results.push(`OK    ${name} → ${path.basename(destDir)}/${name} (${(size / 1024).toFixed(0)} KB, integrity ok)`);
    }
  } finally {
    check.close();
  }
}

// 附带把课程表 JSON 也拷一份（课表解析产物，丢了要重新上传 PDF）
const courseJson = path.join(DATA_DIR, 'course_records.json');
if (fs.existsSync(courseJson)) {
  fs.copyFileSync(courseJson, path.join(destDir, 'course_records.json'));
  results.push('OK    course_records.json（副本）');
}

// 保留策略：只删**本脚本命名模式**（纯时间戳目录名）里的旧档，绝不动其他文件
try {
  const dirs = fs.readdirSync(BACKUP_DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();
  for (const old of dirs.slice(KEEP)) {
    fs.rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });
    results.push(`PRUNE 旧备份 ${old}（保留最近 ${KEEP} 份）`);
  }
} catch (e) {
  results.push(`WARN  保留策略清理失败（不影响本次备份）: ${e.message}`);
}

for (const line of results) console.log(line);

const backed = results.filter((l) => l.startsWith('OK')).length;
if (failed || (backed === 0 && results.every((l) => !l.startsWith('SKIP') && !l.startsWith('OK')))) {
  console.error('备份失败');
  process.exit(1);
}
if (backed === 0) {
  console.error('没有可备份的库（全部 SKIP）—— 若在服务器上运行这是异常，请检查 LIBAO_DATA_DIR');
  process.exit(1);
}
console.log(`备份完成：${backed} 个库 → ${path.basename(destDir)}（保留最近 ${KEEP} 份）`);
