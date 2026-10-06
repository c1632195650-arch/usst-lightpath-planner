#!/usr/bin/env python3
"""
光溯 APK · 构建后处理：把 dist/m.html 复制为 dist/index.html
=====================================================================
## 为什么需要这一步

去掉 `capacitor.config.ts` 的 `server.url` 后，Capacitor 加载**包内**资源，
而包内首屏默认是 `webDir/index.html`。但 `dist/index.html` 是**网页端主站**
（`id="root"` + `main-*.js`），移动端入口是 `dist/m.html`
（`id="mobile-root"` + `mobile-*.js`）。

→ 不做这一步，APK 会显示**网页端**（这正是 2026-10-06 排查到的「界面不更新」真因）。

## 两种可选做法（本脚本用 A，避免动 Android Java 代码）

**A. 覆写 index.html（采用）**：`dist/m.html` → `dist/index.html`。
   首屏即移动端，**零 Android 侧改动**。代价：APK 内 index.html 与网页端同名不同内容
   （无害——两者本就在不同产物里：网页端走 nginx，APK 走包内）。

**B. 改 Android MainActivity** 的 `getStartUrl()` 指向 `public/m.html`。
   更「干净」，但要动原生工程+ 回归启动路径，收益不抵成本。

## 资源路径说明（为何A 可行）

构建后 `dist/m.html` 里的引用已被 vite 改写为 `/assets/mobile-*.js` 这类**绝对路径**。
Capacitor 的 `androidScheme: 'https'` + `hostname: 'localhost'` 会让 WebView 把
`https://localhost/assets/*` 映射到包内 `assets/public/assets/*`。
**不要把 androidScheme 改成 http**，否则映射失效、页面全白。

## 幂等

可重复执行；每次 `npm run build` 后重跑即可（vite 会重写 dist/，本脚本重新覆写）。
"""

from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DIST = REPO / "dist"
MOBILE_HTML = DIST / "m.html"
TARGET_HTML = DIST / "index.html"

# 移动端特征：挂载点 id 与title —— 用于校验复制对了文件
MOBILE_MOUNT_ID = "mobile-root"
MOBILE_TITLE_HINT = "光溯 · 今天"


def fail(msg: str) -> None:
    print(f"[prep-mobile-dist] 失败：{msg}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if not MOBILE_HTML.exists():
        fail(f"未找到 {MOBILE_HTML}——请先跑 npm run build（vite 多页产物含 m.html）")

    html = MOBILE_HTML.read_text(encoding="utf-8")

    # 校验：必须是移动端入口，不能是网页端
    if MOBILE_MOUNT_ID not in html:
        fail(
            f"m.html 缺少挂载点 id='{MOBILE_MOUNT_ID}'，疑似拿错了文件。"
            f"实际内容开头：{html[:120]!r}"
        )
    if "<title>光溯 · 今天" not in html and MOBILE_TITLE_HINT not in html:
        print(
            f"[prep-mobile-dist] 警告：m.html 的title 不含「{MOBILE_TITLE_HINT}」，"
            f"但挂载点 id 正确，继续执行。"
        )

    # 校验：构建产物必须已把 /src/... 改写为 /assets/...（否则包内加载会 404）
    if "/src/features/mobile" in html:
        fail(
            "m.html 仍引用 /src/features/mobile/... —— vite 未完成构建。"
            "请跑完整的 npm run build（tsc --noEmit && vite build）"
        )

    # 幂等覆写
    if TARGET_HTML.exists() and TARGET_HTML.read_text(encoding="utf-8") == html:
        print("[prep-mobile-dist] index.html 已是移动端入口，无需改动")
    else:
        shutil.copyfile(MOBILE_HTML, TARGET_HTML)
        print(f"[prep-mobile-dist] 已用 m.html 覆写 {TARGET_HTML.name}（APK 首屏=移动端）")

    # 打印 APK 首屏将要引用的资源，便于人工核对是否 200/存在
    assets = re.findall(r'(?:src|href)="(/assets/[^"]+)"', html)
    if not assets:
        print("[prep-mobile-dist] 警告：未在 HTML 中解析到 /assets 引用，请检查构建产物")
        return
    print("[prep-mobile-dist] APK 首屏将加载以下包内资源（均相对包内 assets/public）：")
    for a in dict.fromkeys(assets):  # 去重且保序
        print(f"    {a}")


if __name__ == "__main__":
    main()
