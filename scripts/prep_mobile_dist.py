#!/usr/bin/env python3
"""
光溯 APK · 构建后处理：dist → dist-mobile/（独立目录，index.html = 移动端入口）
=====================================================================
## 为什么是独立目录（2026-10-06 假联通审计 §四 的污染修复）

**旧做法（已废）**：把 `dist/m.html` 覆写成 `dist/index.html`。
代价是污染网页端构建产物——本地 `dist/` 曾因此变成移动端首屏，
一旦照常 `tar dist` 部署，线上根路径会整体变成手机界面。

**新做法**：把 `dist/` 完整拷贝到 `dist-mobile/`，只在新目录里把
`index.html` 替换为移动端入口；`dist/` 一个字节都不动。

  dist/            → 网页端产物，nginx 直接 serve，永远干净
  dist-mobile/     → APK 包内产物（capacitor webDir 指向这里），首屏=移动端

## 资源路径说明

构建后 `dist/m.html` 里的引用已被 vite 改写为 `/assets/mobile-*.js` 这类**绝对路径**。
Capacitor 的 `androidScheme: 'https'` + `hostname: 'localhost'` 会让 WebView 把
`https://localhost/assets/*` 映射到包内 `assets/public/assets/*`。
**不要把 androidScheme 改成 http**，否则映射失效、页面全白。

## 幂等

可重复执行；每次 `npm run build` 后重跑即可。拷贝用 `dirs_exist_ok=True`
**不删除任何文件**（残留的旧哈希资源无害，Android 打包时自行清理）。
"""

from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DIST = REPO / "dist"
DIST_MOBILE = REPO / "dist-mobile"
MOBILE_HTML = DIST / "m.html"
TARGET_HTML = DIST_MOBILE / "index.html"

# 移动端特征：挂载点 id 与 title —— 用于校验复制对了文件
MOBILE_MOUNT_ID = "mobile-root"
MOBILE_TITLE_HINT = "光溯 · 今天"


def fail(msg: str) -> None:
    print(f"[prep-mobile-dist] 失败：{msg}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if not MOBILE_HTML.exists():
        fail(f"未找到 {MOBILE_HTML}——请先跑 npm run build（vite 多页产物含 m.html）")
    if not (DIST / "index.html").exists():
        fail(f"未找到 {DIST / 'index.html'}——vite 构建产物不完整，请重跑 npm run build")

    mobile_html = MOBILE_HTML.read_text(encoding="utf-8")

    # 校验：必须是移动端入口，不能是网页端
    if MOBILE_MOUNT_ID not in mobile_html:
        fail(
            f"m.html 缺少挂载点 id='{MOBILE_MOUNT_ID}'，疑似拿错了文件。"
            f"实际内容开头：{mobile_html[:120]!r}"
        )
    if "<title>光溯 · 今天" not in mobile_html and MOBILE_TITLE_HINT not in mobile_html:
        print(
            f"[prep-mobile-dist] 警告：m.html 的 title 不含「{MOBILE_TITLE_HINT}」，"
            f"但挂载点 id 正确，继续执行。"
        )

    # 校验：构建产物必须已把 /src/... 改写为 /assets/...（否则包内加载会 404）
    if "/src/features/mobile" in mobile_html:
        fail(
            "m.html 仍引用 /src/features/mobile/... —— vite 未完成构建。"
            "请跑完整的 npm run build（tsc --noEmit && vite build）"
        )

    # 红线校验：dist/index.html 必须仍是网页端——本脚本绝不再碰它
    web_html = (DIST / "index.html").read_text(encoding="utf-8")
    if MOBILE_MOUNT_ID in web_html:
        fail(
            "dist/index.html 已被污染成移动端入口（旧版脚本覆写过？）。"
            "请重跑 npm run build 重新生成 dist/ 后再执行本脚本。"
        )

    # dist → dist-mobile 全量拷贝（不删除旧文件），再替换首屏
    shutil.copytree(DIST, DIST_MOBILE, dirs_exist_ok=True)
    if TARGET_HTML.exists() and TARGET_HTML.read_text(encoding="utf-8") == mobile_html:
        print("[prep-mobile-dist] dist-mobile/index.html 已是移动端入口，无需改动")
    else:
        shutil.copyfile(MOBILE_HTML, TARGET_HTML)
        print(f"[prep-mobile-dist] 已生成 {DIST_MOBILE.name}/index.html（APK 首屏=移动端；dist/ 未动）")

    # 打印 APK 首屏将要引用的资源，便于人工核对是否 200/存在
    assets = re.findall(r'(?:src|href)="(/assets/[^"]+)"', mobile_html)
    if not assets:
        print("[prep-mobile-dist] 警告：未在 HTML 中解析到 /assets 引用，请检查构建产物")
        return
    print("[prep-mobile-dist] APK 首屏将加载以下包内资源（均相对包内 assets/public）：")
    for a in dict.fromkeys(assets):  # 去重且保序
        print(f"    {a}")


if __name__ == "__main__":
    main()
