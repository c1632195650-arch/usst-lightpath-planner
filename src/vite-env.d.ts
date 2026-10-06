/// <reference types="vite/client" />

/**
 * 构建期注入的常量（由 `vite.config.ts` 的 `define` 提供）。
 *
 * `__APP_VERSION__` —— **单一事实源 = 仓根 `package.json` 的 `version` 字段**。
 * 用途：移动端 F18「检查更新」要比对「服务器上的最新版本」与「本 APK 内置版本」。
 * 🔴 此前是`useTodayData.ts` 里手写的`const APP_VERSION = '0.1.0'`，
 * 每次出 APK 若忘记手改 → 检查更新静默失效（永远提示"已是最新"）。
 * 现改为构建期注入，**漏改不再可能**。
 *
 * 出新 APK 时仍需同步三处（这是 Android 侧与文件名的要求，与本常量无关）：
 *   1. `mobile/android/app/build.gradle` 的 versionCode / versionName
 *   2. `package.json` 的 version（本常量随之自动更新）
 *   3. `server/version.json`（供服务端 `/api/version` 返回）
 */
declare const __APP_VERSION__: string;
