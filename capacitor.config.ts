/**
 * 飞虹 Code (fhcode) Capacitor 配置
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心
 * 用于构建 Android APK：webDir 指向构建后的 Web 控制台静态资源
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.feihong.code',
  appName: '飞虹 Code',
  // 移动版 APK 实际打包的是 app-mobile（本地嵌入，非远程 jb.klai.top 控制台）
  webDir: 'app-mobile',
  android: {
    allowMixedContent: true,
    backgroundColor: '#f7f8fa'
  }
};

export default config;
