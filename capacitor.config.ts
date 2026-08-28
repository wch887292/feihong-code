/**
 * 飞虹 Code (fhcode) Capacitor 配置
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心
 * 用于构建 Android APK：webDir 指向构建后的 Web 控制台静态资源
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.feihong.code',
  appName: '飞虹 Code',
  webDir: 'dist/web/public',
  server: {
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#1a1a2e'
  }
};

export default config;
