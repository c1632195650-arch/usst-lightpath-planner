/**
 * 光溯 APK · Capacitor 配置
 * ============================================================
 *🔴 2026-10-06 改为**包内资源模式**（根治「界面不更新」与「服务器到期白屏」）
 * ------------------------------------------------------------------
 * 旧配置：`server.url = 'http://101.35.253.143'`（无路径）
 *   → WebView 直接加载**服务器根路径 = 网页端主站**（`id="root"` / `main-*.js`），
 *     而不是移动端 `/m.html`（`id="mobile-root"` / `mobile-*.js`）。
 *   → 症状：装APK 后看到的是**网页端**，清缓存无效（每次都在正确加载网页端）。
 *   → 且每次前端更新都要重出 APK，服务器 10-25 到期后直接白屏。
 *
 * 现配置：**不设 `server.url`** → Capacitor 加载 `webDir` 内的包内资源（离线可用）。
 *   · `webDir` 指向 `../dist`（相对本文件），其中 `index.html` 已被替换为移动端入口
 *     （见 `scripts/prep_mobile_dist.py`：把 `dist/m.html` 复制成 `dist/index.html`），
 *     这样免改Android 侧 Java 代码即可让 WebView 首屏是移动端。
 *   · `androidScheme: 'https'` + `hostname: 'localhost'`：Capacitor 默认的本地资源协议，
 *     `/assets/*` 绝对路径由其内部 WebView 拦截器映射到包内，**不要改成 http**。
 *   · cleartext 仅保留给「登录/同步/API」等走公网的 XHR（方案 §2.3 拍板，裸跑 http）。
 *
 * 更新的走法（方案内已实现，勿重复造）：
 *   包内页面 → TodayPage 的 F18 检查更新读 `GET /api/version`
 *   → 发现新版本出「下载更新 APK」横幅 → 跳浏览器下载 `apkUrl` → 装新版。
 *   版本号三处同步：`mobile/android/app/build.gradle`（versionCode/versionName）
 *   + `server/version.json` + APK 文件名。
 *
 * 副作用（已知并接受）：断网时**界面能开**，但云端计划/待办/梨宝问答需联网
 *   —— 本App 的数据面本来就在服务端，这是设计取舍，不是缺陷。
 * ============================================================
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.usst.lightpath',
  appName: '光溯',
  // 相对本文件（mobile/）→ 仓库构建产物 dist/。
  // 其中 dist/index.html 已被 prep_mobile_dist.py 覆写为移动端入口。
  webDir: '../dist',
  android: {
    path: 'android',
    // 允许 WebView 内的 XHR 走明文 http（连公网 API / 天气 / 地图等），非资源加载。
    allowMixedContent: true,
  },
  server: {
    // 🔴 不设 url —— 关键修复：设了会让 WebView 整个跳去公网加载网页端。
    // Capacitor 用本地 scheme 提供包内资源（默认 https://localhost）。
    androidScheme: 'https',
    hostname: 'localhost',
    // 仅为「API XHR 走明文 http」而开，不影响包内资源加载路径。
    cleartext: true,
  },
  plugins: {
    LocalNotifications: {
      small: 'ic_stat_icon',
      iconColor: '#2B4C9B',
    },
  },
};

export default config;
