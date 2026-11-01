#!/usr/bin/env node
/**
 * 家电脑 → 腾讯云 反向隧道保活（统一 8082 端口）
 *
 * 背景：
 *   云端 LiveKit Agent（飞虹智语音助手）需要访问家电脑的 fhcode MCP 端点。
 *   云端 agent_fhcode.py 的 FHCODE_MCP_URL 统一指向 http://127.0.0.1:8082/mcp，
 *   由本脚本建立的 SSH 反向隧道把云端 8082 转发到家电脑 8082。
 *
 * 统一后的端口约定（全链路只有一个 MCP 端口 = 8082）：
 *   - 家电脑本地：8082  = fhcode serve（Web 控制台 + 云桥接 + 内嵌 /mcp）
 *   - 云端转发  ：8082  = SSH -R 反向隧道落点
 *   - 云端 18085    = fhcode-v885（云端执行体，非 MCP）
 *   - 已废弃      ：8083（家电脑 python MCP 中间层）与家电脑上的 8083 隧道
 *
 * 行为：
 *   - 已在隧道中则直接退出（幂等，不重复起）
 *   - 隧道断开则自动重连（带退避）
 *   - 由 FHRelayTunnel 计划任务（登录时）拉起，FHWatchdog 巡检兜底
 *
 * 环境变量：
 *   FH_TUNNEL_HOST    默认 root@111.229.190.132
 *   FH_TUNNEL_KEY     默认 ~/.ssh/id_ed25519
 *   FH_TUNNEL_PORT    默认 8082（云端落点端口 = 家电脑端口）
 *   FH_TUNNEL_PIDFILE 默认 %TEMP%/fh-tunnel-8082.pid
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOST = process.env.FH_TUNNEL_HOST || 'root@111.229.190.132';
const KEY = process.env.FH_TUNNEL_KEY || path.join(os.homedir(), '.ssh', 'id_ed25519');
const PORT = String(process.env.FH_TUNNEL_PORT || '8082');
const PIDFILE = process.env.FH_TUNNEL_PIDFILE || path.join(os.tmpdir(), `fh-tunnel-${PORT}.pid`);
const LOGFILE = process.env.FH_TUNNEL_LOGFILE || path.join(os.tmpdir(), `fh-tunnel-${PORT}.log`);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try { fs.appendFileSync(LOGFILE, line + '\n'); } catch (_) { /* 忽略日志失败 */ }
  console.log(line);
}

function readPid() {
  try {
    const pid = parseInt(String(fs.readFileSync(PIDFILE, 'utf8')).trim(), 10);
    if (!pid) return null;
    // Windows 下无法用 kill(0) 探测，改用 tasklist
    return pid;
  } catch (_) {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return String(out).includes(String(pid));
  } catch (_) {
    return false;
  }
}

/**
 * 检查隧道是否真的活着。
 * 判据（按可靠性排序）：
 *   1. PID 文件记录的进程仍在 → 隧道在
 *   2. 云端目标端口有本地 SSH 转发在监听（远端探测不可得，用本机 ssh -O check 代替）
 *   3. 都不可得 → 认为隧道断了，需要重连
 *
 * 之所以不只用 PID 文件：家电脑重启后 PID 会变、文件会丢，但隧道可能仍由别的进程维持。
 * 所以额外用「本地是否已存在指向该端口的 ssh -R 转发进程」交叉验证。
 */
function tunnelAlive() {
  const pid = readPid();
  if (pid && isAlive(pid)) return true;
  // 交叉验证：扫本机 ssh.exe 命令行，找 -R 127.0.0.1:<port> 的转发
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync(
      'wmic',
      ['process', 'where', "name='ssh.exe'", 'get', 'CommandLine', '/format:list'],
      { encoding: 'utf8', windowsHide: true }
    );
    const needle = `-R 127.0.0.1:${PORT}:`;
    if (String(out).includes(needle)) return true;
  } catch (_) {
    // wmic 不可用时退回 PID 判据
  }
  return false;
}

function startTunnel() {
  const args = [
    '-i', KEY,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ConnectTimeout=15',
    '-N',
    '-R', `127.0.0.1:${PORT}:127.0.0.1:${PORT}`,
    HOST,
  ];
  log(`建立隧道 → 云端 127.0.0.1:${PORT} 转发到家电脑 127.0.0.1:${PORT}`);
  const child = spawn('ssh', args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  try { fs.writeFileSync(PIDFILE, String(child.pid), 'utf8'); } catch (_) { /* 忽略 */ }
  log(`隧道进程已启动 pid=${child.pid}`);
  return child.pid;
}

function main() {
  if (tunnelAlive()) {
    log(`隧道已在运行（pid=${readPid()}），无需重复启动`);
    return;
  }
  const pid = startTunnel();
  // 起来后 3 秒自检：进程是否还活着（避免 ExitOnForwardFailure 静默退出）
  setTimeout(() => {
    if (isAlive(pid)) log(`隧道自检通过 pid=${pid}，云端 8082 已通到家电脑 8082`);
    else log(`隧道自检失败 pid=${pid} 已退出，需由 FHWatchdog 重试`);
  }, 3000);
}

main();
