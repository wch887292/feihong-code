/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * MCP 隧道内置能力 — tunnel-client 生命周期管理。
 * fhcode 直接托管 OpenAI Secure MCP Tunnel 的 tunnel-client：
 *  - init    生成 tunnel-client profile（MCP Server = fhcode tunnel serve）
 *  - start   以托管进程方式拉起 tunnel-client run（API Key 走环境变量，不落盘明文）
 *  - stop    按 pidfile 停止
 *  - status  检查配置 / 二进制 / profile / 进程四要素
 *
 * 说明：tunnel-client 二进制由 OpenAI 官方发布，请从官方渠道获取：
 *   https://platform.openai.com/settings/organization/tunnels
 */
import { spawn, execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';
import { logger } from '../shared/logger';
import { AppError } from '../shared/errors';
import type { TunnelConfig } from './tunnel-config';
import { tunnelPidPath, tunnelLogPath, tunnelConfigPath, tunnelConfigReady, TUNNEL_PROFILE_PREFIX } from './tunnel-config';

const TUNNEL_CLIENT_CMD = 'tunnel-client';

/** 官方下载/管理入口（status 未找到二进制时提示） */
export const TUNNEL_CLIENT_DOWNLOAD_URL = 'https://platform.openai.com/settings/organization/tunnels';

/** 查找 tunnel-client 可执行文件；返回绝对路径或 null */
export function findTunnelClient(configured?: string): string | null {
  if (configured && configured !== 'auto') {
    return existsSync(configured) ? configured : null;
  }
  try {
    const which = platform() === 'win32' ? 'where' : 'which';
    const out = execFileSync(which, [TUNNEL_CLIENT_CMD], {
      timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const first = out.toString().split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

/** 生成 MCP Server 启动命令（tunnel-client 以 stdio spawn 它） */
export function buildMcpCommand(): string {
  // 必须使用独立入口 serve-entry.js：CLI 入口的初始化副作用会污染 MCP stdio 协议流
  const entry = join(__dirname, '../../dist/tunnel/serve-entry.js');
  return `"${process.execPath}" "${entry}"`;
}

/** 检查 profile 是否已生成（tunnel-client init 产物，位置由 tunnel-client 管理） */
function profileExists(profile: string): boolean {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const candidates = [
    join(home, '.config', 'tunnel-client', 'profiles', `${profile}.yaml`),
    join(home, '.tunnel-client', 'profiles', `${profile}.yaml`),
  ];
  return candidates.some((p) => existsSync(p));
}

/** 运行 tunnel-client 子命令并回显输出；返回是否成功 */
function runTunnelClientCli(args: string[], env: Record<string, string> = {}): { ok: boolean; output: string } {
  try {
    const out = execFileSync(TUNNEL_CLIENT_CMD, args, {
      env: { ...process.env, ...env },
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, output: out.toString() };
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const output = [err.stdout?.toString(), err.stderr?.toString(), err.message]
      .filter((s): s is string => !!s && s.trim().length > 0)
      .join('\n')
      .trim();
    return { ok: false, output };
  }
}

/** init：生成 tunnel-client profile（幂等，已存在则跳过） */
export async function tunnelInit(cfg: TunnelConfig, opts?: { force?: boolean }): Promise<void> {
  const bin = findTunnelClient(cfg.tunnel_client);
  if (!bin) {
    throw new AppError(`未找到 tunnel-client。请从官方页面下载并加入 PATH：${TUNNEL_CLIENT_DOWNLOAD_URL}`, 'TUNNEL_CLIENT_MISSING', 500);
  }
  if (!cfg.tunnel_id || cfg.tunnel_id.startsWith('YOUR_')) {
    throw new AppError('缺少 tunnel_id：先在 OpenAI 平台 Tunnels 页面创建隧道（platform.openai.com/settings/organization/tunnels）', 'TUNNEL_ID_MISSING', 500);
  }
  const profile = cfg.profile || TUNNEL_PROFILE_PREFIX;
  if (!opts?.force && profileExists(profile)) {
    console.log(`profile「${profile}」已存在，跳过 init（如需重建：fhcode tunnel init --force）`);
    return;
  }
  const mcpCmd = buildMcpCommand();
  console.log('生成 tunnel-client profile ...');
  console.log(`  MCP Server 命令: ${mcpCmd}`);
  const { ok, output } = runTunnelClientCli([
    'init', '--sample', 'sample_mcp_stdio_local',
    '--profile', profile,
    '--tunnel-id', cfg.tunnel_id,
    '--mcp-command', mcpCmd,
  ], { CONTROL_PLANE_TUNNEL_ID: cfg.tunnel_id });
  console.log(output || '(无输出)');
  if (!ok) throw new AppError('tunnel-client init 失败，请检查上方输出', 'TUNNEL_INIT_FAILED', 500);
  console.log('profile 已生成。下一步：fhcode tunnel start');
}

/** start：托管启动 tunnel-client run */
export async function tunnelStart(cfg: TunnelConfig): Promise<void> {
  if (!tunnelConfigReady(cfg)) {
    throw new AppError(`隧道配置未就绪。先运行：fhcode tunnel init（配置见 ${tunnelConfigPath()}）`, 'TUNNEL_NOT_CONFIGURED', 500);
  }
  const bin = findTunnelClient(cfg.tunnel_client);
  if (!bin) {
    throw new AppError(`未找到 tunnel-client。请从官方页面下载并加入 PATH：${TUNNEL_CLIENT_DOWNLOAD_URL}`, 'TUNNEL_CLIENT_MISSING', 500);
  }
  const pid = readPid();
  if (pid && isProcessAlive(pid)) {
    console.log(`tunnel-client 已在运行（PID ${pid}）。如需重启：fhcode tunnel stop 后 start`);
    return;
  }
  const profile = cfg.profile || TUNNEL_PROFILE_PREFIX;
  const logPath = tunnelLogPath();
  console.log(`启动 tunnel-client（profile=${profile}）...`);
  const child = spawn(bin, ['run', '--profile', profile], {
    env: {
      ...process.env,
      CONTROL_PLANE_TUNNEL_ID: cfg.tunnel_id,
      CONTROL_PLANE_API_KEY: cfg.api_key,
    },
    windowsHide: true,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  writeFileSync(tunnelPidPath(), String(child.pid), 'utf8');
  child.stdout?.on('data', (d) => appendFileSync(logPath, d.toString()));
  child.stderr?.on('data', (d) => appendFileSync(logPath, d.toString()));
  child.on('exit', (code, sig) => {
    logger.warn('tunnel-client 退出', { code, sig });
    if (readPid() === child.pid) unlinkSync(tunnelPidPath());
  });
  child.on('error', (e) => {
    logger.error('tunnel-client 启动失败', { error: e.message });
  });
  // 短暂等待后确认进程存活
  await new Promise((r) => setTimeout(r, 2500));
  if (child.exitCode !== null) {
    throw new AppError(`tunnel-client 启动后立即退出（code=${child.exitCode}），日志见 ${logPath}`, 'TUNNEL_START_FAILED', 500);
  }
  console.log(`tunnel-client 已启动（PID ${child.pid}）。日志: ${logPath}`);
  console.log('提示：保持运行期间，到 ChatGPT 网页设置 → Connectors 创建/确认连接器，即可在对话中调用本地工具。');
}

/** stop：按 pidfile 停止 */
export function tunnelStop(): void {
  const pid = readPid();
  if (!pid) {
    console.log('没有正在运行的 tunnel-client（无 pidfile）');
    return;
  }
  if (!isProcessAlive(pid)) {
    console.log(`PID ${pid} 已不在运行，清理 pidfile`);
    unlinkSync(tunnelPidPath());
    return;
  }
  try {
    if (platform() === 'win32') {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    console.log(`已停止 tunnel-client（PID ${pid}）`);
  } catch (e) {
    logger.warn('停止 tunnel-client 失败', { error: e instanceof Error ? e.message : String(e) });
    console.error('停止失败，可手动结束进程: taskkill /pid ' + pid + ' /F');
  } finally {
    try { unlinkSync(tunnelPidPath()); } catch { /* 已删 */ }
  }
}

/** status：链路四要素体检 */
export function tunnelStatus(cfg: TunnelConfig | null): void {
  console.log('== fhcode 内置 MCP 隧道 · 状态 ==\n');
  console.log(`[配置] ${tunnelConfigReady(cfg) ? '✅ 已就绪' : '❌ 未完成（fhcode tunnel init）'}`);
  if (cfg) console.log(`  ${tunnelConfigPath()}`);
  const bin = findTunnelClient(cfg?.tunnel_client);
  console.log(`[二进制] ${bin ? `✅ ${bin}` : `❌ 未找到 tunnel-client（${TUNNEL_CLIENT_DOWNLOAD_URL}）`}`);
  if (cfg) {
    const profile = cfg.profile || TUNNEL_PROFILE_PREFIX;
    console.log(`[profile] ${profileExists(profile) ? '✅ 已生成' : '⚠️ 未生成（fhcode tunnel init）'}`);
  }
  const pid = readPid();
  const alive = pid ? isProcessAlive(pid) : false;
  console.log(`[进程] ${alive ? `✅ 运行中（PID ${pid}）` : '⏹ 未运行（fhcode tunnel start）'}`);
  console.log('\n工作区与白名单：');
  if (cfg) {
    console.log(`  workspace : ${cfg.workspace}`);
    console.log(`  sandbox   : ${cfg.sandbox_mode}`);
    console.log(`  tools     : ${cfg.tools.join(', ')}`);
  } else {
    console.log('  （未配置）');
  }
}

function readPid(): number | null {
  try {
    if (!existsSync(tunnelPidPath())) return null;
    const n = Number(readFileSync(tunnelPidPath(), 'utf8').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = 进程存在但无权限操作；ESRCH = 不存在
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
