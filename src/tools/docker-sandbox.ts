/**
 * 飞虹 Code — Docker 沙盒执行层（v8.0）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 对齐 sandbox.ts 的 'container' 沙箱模式：
 *  - shell 命令在 Docker 容器内执行（docker run 挂载工作区）
 *  - 镜像由 FH_SANDBOX_IMAGE 配置，默认 node:22-alpine
 *  - 网络受限：默认禁用（--network none），可 FH_SANDBOX_NETWORK=true 开启
 *  - 资源受限：内存/CPU 上限可配置
 *  - 只读挂载模式可选（防止容器内修改宿主文件）
 *
 * 设计：
 *  - 惰性拉取镜像（首次运行时 docker pull）
 *  - 每次执行创建一次性容器（--rm），执行完自动销毁
 *  - 超时强杀（docker kill）
 *  - 不依赖 dockerode（减少依赖），用子进程调用 docker CLI
 */

import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const execFileAsync = promisify(execFile);

export interface DockerSandboxOptions {
  /** 沙盒镜像（默认 node:22-alpine） */
  image?: string;
  /** 挂载的工作区目录（默认当前工作目录） */
  workspaceDir?: string;
  /** 容器内工作区挂载点（默认 /workspace） */
  mountPoint?: string;
  /** 内存上限（如 '512m'，默认 512m） */
  memoryLimit?: string;
  /** CPU 上限（如 '0.5'，默认 1） */
  cpuLimit?: string;
  /** 是否启用网络（默认 false，禁用网络更安全） */
  networkEnabled?: boolean;
  /** 工作区是否只读挂载（默认 true） */
  readOnly?: boolean;
  /** 执行超时（毫秒，默认 60s） */
  timeoutMs?: number;
  /** 是否输出 docker 命令调试 */
  debug?: boolean;
}

export interface DockerExecResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  containerId?: string;
}

const DEFAULT_OPTIONS: Required<Omit<DockerSandboxOptions, 'debug'>> = {
  image: 'node:22-alpine',
  workspaceDir: process.cwd(),
  mountPoint: '/workspace',
  memoryLimit: '512m',
  cpuLimit: '1',
  networkEnabled: false,
  readOnly: true,
  timeoutMs: 60000,
};

export class DockerSandbox {
  private options: Required<Omit<DockerSandboxOptions, 'debug'>>;
  private debugEnabled: boolean;
  private imageReady = false;

  constructor(options: DockerSandboxOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.debugEnabled = options.debug || false;

    if (process.env.FH_SANDBOX_IMAGE) this.options.image = process.env.FH_SANDBOX_IMAGE;
    if (process.env.FH_SANDBOX_NETWORK === 'true') this.options.networkEnabled = true;
    if (process.env.FH_SANDBOX_READONLY === 'false') this.options.readOnly = false;

    // 确保工作区目录存在
    if (!existsSync(this.options.workspaceDir)) {
      mkdirSync(this.options.workspaceDir, { recursive: true });
    }
  }

  private debug(...args: unknown[]): void {
    if (this.debugEnabled) console.log('[DockerSandbox]', ...args);
  }

  /** 检查 Docker CLI 与 daemon 是否均可用（docker info 而非 --version，确保 daemon 在运行） */
  static async isDockerAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}']);
      return /^\d+\.\d+\.\d+/.test(stdout.trim());
    } catch {
      return false;
    }
  }

  /** 确保镜像已存在（首次执行自动拉取） */
  async ensureImage(): Promise<void> {
    if (this.imageReady) return;

    this.debug(`检查镜像 ${this.options.image}...`);
    try {
      const { stdout } = await execFileAsync('docker', ['image', 'inspect', this.options.image]);
      if (stdout) {
        this.imageReady = true;
        return;
      }
    } catch { /* 镜像不存在，需要拉取 */ }

    this.debug(`拉取镜像 ${this.options.image}...`);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('docker', ['pull', this.options.image], { stdio: this.debugEnabled ? 'inherit' : 'ignore' });
      proc.on('close', (code) => {
        if (code === 0) { this.imageReady = true; resolve(); }
        else reject(new Error(`镜像拉取失败（exit ${code}）: ${this.options.image}`));
      });
      proc.on('error', reject);
    });
  }

  /** 在 Docker 容器中执行命令 */
  async execute(command: string, options: { workdir?: string; env?: Record<string, string> } = {}): Promise<DockerExecResult> {
    const start = Date.now();
    const dockerAvailable = await DockerSandbox.isDockerAvailable();
    if (!dockerAvailable) {
      return {
        success: false, exitCode: -1, stdout: '', stderr: 'Docker 不可用：请安装并启动 Docker Desktop',
        timedOut: false, durationMs: Date.now() - start,
      };
    }

    try {
      await this.ensureImage();
    } catch (e) {
      return {
        success: false, exitCode: -1, stdout: '',
        stderr: `镜像准备失败: ${e instanceof Error ? e.message : String(e)}`,
        timedOut: false, durationMs: Date.now() - start,
      };
    }

    // 构造 docker run 参数
    const dockerArgs: string[] = ['run', '--rm'];
    dockerArgs.push('--name', `fh-sandbox-${Date.now()}`);
    dockerArgs.push('-m', this.options.memoryLimit);
    dockerArgs.push('--cpus', this.options.cpuLimit);
    dockerArgs.push('--network', this.options.networkEnabled ? 'bridge' : 'none');
    dockerArgs.push('--workdir', this.options.mountPoint);
    dockerArgs.push('--mount', `type=bind,source=${this.options.workspaceDir},target=${this.options.mountPoint},readonly=${this.options.readOnly}`);

    if (options.workdir) dockerArgs.push('--workdir', options.workdir);

    // 环境变量
    for (const [k, v] of Object.entries(options.env || {})) {
      dockerArgs.push('-e', `${k}=${v}`);
    }

    // 危险命令拒绝列表（纵深防御，即使容器内也拦截）
    const DANGEROUS_PATTERNS = [
      /rm\s+-rf\s+\/(?!workspace)/,      // 删除根目录（排除 workspace）
      /mkfs/,                             // 格式化
      /dd\s+if=.*of=\/dev/,               // 写入块设备
      /:\(\)\s*\{\s*:\|:&\s*\};:/,        // fork 炸弹
    ];
    for (const pat of DANGEROUS_PATTERNS) {
      if (pat.test(command)) {
        return {
          success: false, exitCode: -1, stdout: '',
          stderr: `危险命令被容器沙盒拦截: ${pat}`,
          timedOut: false, durationMs: Date.now() - start,
        };
      }
    }

    // 容器内执行命令（用 sh -c）
    dockerArgs.push(this.options.image);
    dockerArgs.push('/bin/sh', '-c', command);

    this.debug('docker run 参数:', dockerArgs.join(' '));

    return new Promise<DockerExecResult>((resolve) => {
      const proc = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        timedOut = true;
        // 超时强杀：通过容器名 kill
        const containerName = dockerArgs[dockerArgs.indexOf('--name') + 1];
        execFile('docker', ['kill', containerName], () => {});
        proc.kill('SIGKILL');
      }, this.options.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          success: code === 0,
          exitCode: code ?? -1,
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - start,
        });
      });
      proc.on('error', (e) => {
        clearTimeout(timer);
        resolve({
          success: false, exitCode: -1, stdout, stderr: `执行失败: ${e.message}`,
          timedOut, durationMs: Date.now() - start,
        });
      });
    });
  }

  /** 便捷：在容器中运行脚本文件 */
  async runScript(scriptPath: string, options: { workdir?: string; env?: Record<string, string> } = {}): Promise<DockerExecResult> {
    const absPath = join(this.options.workspaceDir, scriptPath);
    if (!existsSync(absPath)) {
      return {
        success: false, exitCode: -1, stdout: '', stderr: `脚本不存在: ${scriptPath}`,
        timedOut: false, durationMs: 0,
      };
    }
    return this.execute(`node ${this.options.mountPoint}/${scriptPath}`, options);
  }

  /** 获取沙盒配置信息 */
  getConfig(): Required<Omit<DockerSandboxOptions, 'debug'>> {
    return { ...this.options };
  }
}

/** 全局单例 */
let sandboxInstance: DockerSandbox | null = null;

export function getDockerSandbox(options?: DockerSandboxOptions): DockerSandbox {
  if (!sandboxInstance) sandboxInstance = new DockerSandbox(options);
  return sandboxInstance;
}

export function resetDockerSandbox(): void {
  sandboxInstance = null;
}
