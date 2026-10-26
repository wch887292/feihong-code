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
    // v78 双令牌：桥接侧（手机直连/云桥到本机 8082）统一用 bridgeToken，与手机 getCloudToken() 一致；
    // 切勿用 saved.token（那是 sync.klai.top 同步体系的令牌，两系统两把钥匙）。
    if (saved && saved.bridgeToken) process.env.FH_WEB_TOKEN = saved.bridgeToken;
  }
} catch (e) { /* 读取失败则使用服务端自动生成逻辑 */ }
process.env.NODE_OPTIONS = '';
// v8.13.3：8082 承载手机桥接/语音/MCP 的无人值守 agent 任务，run_shell 必须免审批、
// 全权沙箱，否则 agent 卡在审批队列（stuck running），桥接指令 10 分钟超时回退 GUI nl
process.env.FH_REQUIRE_APPROVAL = 'false';
process.env.FH_SANDBOX_MODE = 'danger-full-access';
process.chdir('H:\\feihong-code'); // H:\feihong-code（原 Muse Code复刻 旧目录已清空迁移）
var srv = require('H:\\feihong-code\\dist\\web\\server.js');
srv.startWebServer({});
setInterval(function () {}, 1 << 30); // 保活
