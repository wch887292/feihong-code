// 飞虹 Code 本地直连服务启动器（8082 端口，供手机 App 局域网直连）
// 由计划任务 FHDirect8082 调用；令牌从 ~/.feihong-code/web-token.json 读取（服务端持久化），
// 避免在源码中硬编码敏感值。
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.FH_WEB_PORT = '8082';
try {
  const tokenFile = path.join((process.env.FH_HOME || '').trim() || os.homedir(), '.feihong-code', 'web-token.json');
  if (fs.existsSync(tokenFile)) {
    const saved = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    if (saved && saved.token) process.env.FH_WEB_TOKEN = saved.token;
  }
} catch (e) { /* 读取失败则使用服务端自动生成逻辑 */ }
process.env.NODE_OPTIONS = '';
process.chdir('H:\\Muse Code\u590d\u523b'); // H:\Muse Code复刻
var srv = require('H:\\Muse Code\u590d\u523b\\dist\\web\\server.js');
srv.startWebServer({});
setInterval(function () {}, 1 << 30); // 保活
