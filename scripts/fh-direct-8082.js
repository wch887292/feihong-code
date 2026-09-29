// 飞虹 Code 本地直连服务启动器（8082 端口，供手机 App 局域网直连）
// 由计划任务 FHDirect8082 调用；token 与手机 App 内置云端令牌一致
process.env.FH_WEB_PORT = '8082';
process.env.FH_WEB_TOKEN = '25dacff5349f22fe4354f8ab34d6beaf9390e119b55fe1ad';
process.env.NODE_OPTIONS = '';
process.chdir('H:\\Muse Code\u590d\u523b'); // H:\Muse Code复刻
var srv = require('H:\\Muse Code\u590d\u523b\\dist\\web\\server.js');
srv.startWebServer({});
setInterval(function () {}, 1 << 30); // 保活
