/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * Web 控制台一键启动脚本（简化版）
 */
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? '8080');

console.log(`\n${'═'.repeat(50)}`);
console.log('  飞虹 Code Web 控制台 启动');
console.log('  晋江市飞虹智科技企业管理有限公司');
console.log(`${'═'.repeat(50)}\n`);

// 1. 编译检查
if (!existsSync(join(__dirname, 'dist/cli/index.js'))) {
  console.log('[编译] 正在构建...');
  try {
    execSync('npm run build', { stdio: 'inherit' });
    console.log('[✓] 编译完成');
  } catch (e) {
    console.error('[✗] 编译失败');
    process.exit(1);
  }
} else {
  console.log('[✓] 产物已就绪');
}

// 2. 清理端口
console.log(`[清理] 检测端口 ${PORT}...`);
try {
  const output = execSync('netstat -ano', { encoding: 'utf8' });
  const lines = output.split('\n');
  for (const line of lines) {
    if (line.includes(`:${PORT}`) && line.includes('LISTENING')) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && !isNaN(parseInt(pid))) {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
        console.log(`[✓] 已清理端口 ${PORT} (PID ${pid})`);
      }
    }
  }
} catch (e) {}

// 3. 启动服务
console.log(`[启动] Web 服务 (端口 ${PORT})...`);
const serverLog = [];
const child = spawn('node', ['dist/cli/index.js', 'serve'], {
  cwd: __dirname,
  env: { ...process.env, FH_WEB_PORT: String(PORT) },
  stdio: 'pipe'
});

child.stdout.on('data', (data) => {
  const text = data.toString();
  serverLog.push(text);
  process.stdout.write(text);
});

child.stderr.on('data', (data) => {
  const text = data.toString();
  serverLog.push(text);
  process.stderr.write(`\x1b[31m${text}\x1b[0m`);
});

// 4. 等待就绪
console.log(`[等待] 服务启动中...`);
let ready = false;
const startTime = Date.now();

const checkInterval = setInterval(async () => {
  if (ready) return;
  
  try {
    const { get } = await import('http');
    const promise = new Promise((resolve, reject) => {
      const req = get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
        if (res.statusCode === 200) resolve(true);
        else reject(new Error(`HTTP ${res.statusCode}`));
      });
      req.on('error', reject);
      req.setTimeout(2000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
    
    await promise;
    ready = true;
    clearInterval(checkInterval);
    
    // 提取 Token
    const logText = serverLog.join('');
    const tokenMatch = logText.match(/[Tt]oken.*?([0-9a-f]{32,})/);
    const token = tokenMatch ? tokenMatch[1] : null;
    
    console.log('\n' + '═'.repeat(50));
    console.log('  ✓ Web 控制台已启动！');
    console.log(`  地址: http://127.0.0.1:${PORT}/`);
    if (token) console.log(`  Token: ${token}`);
    console.log('═'.repeat(50) + '\n');
    
    // 打开浏览器
    const url = `http://127.0.0.1:${PORT}/`;
    console.log(`[打开] 浏览器 → ${url}`);
    exec(`start "" "${url}"`, (err) => {
      if (err) {
        console.warn(`[!] 无法打开浏览器: ${err.message}`);
        console.warn(`    请手动访问: ${url}`);
      } else {
        console.log('[✓] 浏览器已打开');
      }
    });
    
  } catch (e) {
    if (Date.now() - startTime >= 15000) {
      clearInterval(checkInterval);
      console.error('\n[✗] 启动超时');
      console.error('\n服务日志:');
      console.error(serverLog.slice(-10).join(''));
      process.exit(1);
    }
  }
}, 1000);

// 进程管理
process.on('exit', () => child.kill());
process.on('SIGINT', () => {
  console.log('\n[停止] 正在关闭服务...');
  child.kill();
  process.exit(0);
});
process.on('SIGTERM', () => {
  child.kill();
  process.exit(0);
});
