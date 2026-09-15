// 零依赖别名钩子：把 '@/xxx' 解析到 <repo>/src/xxx(.ts)
//
// ⚠️ 位置无关：src/ 由**本文件所在目录**（tests/）推出来，不写死绝对路径，
//    因此任何机器 clone 后都能直接跑。需要覆盖时设环境变量 ALIAS_SRC。
//
// 迁移历史：原在仓库外 `_devtools/`（写死了本机绝对路径），
// 2026-09-15 按规格书 §7.3 迁入仓库 `tests/`，并去掉硬编码路径。
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // <repo>/tests
const SRC = path.resolve(process.env.ALIAS_SRC ?? path.join(HERE, '..', 'src'));
const ROOT = pathToFileURL(SRC + path.sep).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    let rest = specifier.slice(2);
    if (!path.extname(rest)) rest += '.ts';
    return nextResolve(new URL(rest, ROOT).href, context);
  }
  return nextResolve(specifier, context);
}
