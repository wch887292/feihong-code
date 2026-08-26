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
