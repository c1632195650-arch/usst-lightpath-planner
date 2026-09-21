#!/usr/bin/env python3
"""行尾归一化 —— 把仓库内**文本**文件统一成 LF（`_work_dev` 的既有约定）。

为什么需要：
    本项目有多棵树（_work_dev / _full / usst-planner）与多个工具（ZCode、WorkBuddy、
    git merge-file）交替写入。行尾不统一会在跨树搬运时产生**整文件 diff 噪音**
    （2026-09-21 合流实测：6 个数据文件因 CRLF/LF 差异虚增约 5.2 万行改动）。

约定：`_work_dev` 全仓 LF；`_full` 与 `usst-planner` 是 CRLF，跨树 cp 后需在本树归一。
    （`.gitattributes` 用 `* -text` 声明字节精确，避免 git 暗自转换。）

安全性：对**已经是 LF** 的文件是空操作 —— 归一化天然不会碰 LF 文件，
        因此不会误伤队友 RAY 名下 `src/features/week|lib/planner|components` 下的代码。

用法：
    python scripts/normalize_eol.py                # 全仓归一为 LF
    python scripts/normalize_eol.py --dry-run      # 只看会改哪些
    python scripts/normalize_eol.py path1 path2    # 只处理指定文件
"""
import subprocess
import sys

BINARY_EXT = {
    '.db', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2',
    '.ttf', '.zip', '.gz', '.xlsx', '.pdf', '.pyc', '.so', '.dll', '.exe',
    '.webp', '.bmp', '.mp4', '.mp3', '.wav',
}


def is_text(path: str) -> bool:
    """显式二进制表 → 排除；否则看内容有没有 NUL 字节（标准二进制嗅探）。

    不用扩展名白名单：仓库里有 .npmrc / .env.example / manifest.webmanifest /
    .gitkeep 这类点文件与冷门扩展名，白名单会漏。
    """
    if any(path.lower().endswith(e) for e in BINARY_EXT):
        return False
    try:
        with open(path, 'rb') as fh:
            return b'\x00' not in fh.read(8192)
    except OSError:
        return False


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry-run' in sys.argv
    if args:
        files = args
    else:
        files = subprocess.run(
            ['git', 'ls-files'], capture_output=True, text=True, check=True
        ).stdout.split('\n')

    changed, skipped = [], 0
    for f in files:
        if not f or not is_text(f):
            continue
        try:
            with open(f, 'rb') as fh:
                raw = fh.read()
        except OSError:
            skipped += 1
            continue
        # 先压成 LF，再整体升 LF —— 幂等，且能修混合行尾
        normalized = raw.replace(b'\r\n', b'\n')
        if normalized != raw:
            changed.append(f)
            if not dry:
                with open(f, 'wb') as fh:
                    fh.write(normalized)

    verb = '将归一' if dry else '已归一'
    print('%s %d 个文本文件为 LF（跳过 %d 个不可读）' % (verb, len(changed), skipped))
    for f in changed[:60]:
        print('   ', f)
    if len(changed) > 60:
        print('    … 另有 %d 个' % (len(changed) - 60))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
