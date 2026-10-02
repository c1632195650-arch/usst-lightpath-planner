/**
 * 光溯 APK · Capacitor 配置（方案 §8.1；M4 的 gradle 构建待白天装 JDK/SDK，见 BLOCKERS）
 * ============================================================
 * server.url 指向公网 = WebView 直接加载在线 m.html：APK 体积最小、更新即时；
 * cleartext 显式允许（裸跑 http，方案 §2.3 拍板；上 HTTPS 后这里同步改）。
 * webDir 相对本文件所在目录（mobile/）→ 指向仓库构建产物 dist/。
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.usst.lightpath',
  appName: '光溯',
  webDir: '../dist',
  android: {
    path: 'android',
    allowMixedContent: true,
  },
  server: {
    url: 'http://101.35.253.143',
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
