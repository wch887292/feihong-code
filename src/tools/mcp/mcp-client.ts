/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P0-3 轻量 MCP（Model Context Protocol）stdio 客户端。
 *
 * 设计原则：
 *  - 零第三方依赖：纯 Node 内置模块（child_process / readline），离线可用。
 *  - 传输：MCP 官方 stdio transport 采用"每行一个 JSON-RPC 2.0 消息"（NDJSON）。
 *  - 生命周期：spawn 子进程 → initialize 握手 → notifications/initialized → tools/list → tools/call。
 *  - 约定：服务器一切非协议输出写 stderr（协议规范要求），stdout 仅走协议；本客户端将 stderr 归入日志。
 */
import { spawn, type ChildProcess } from 'child_process';
import { createInterface, type Interface } from 'readline';
import { logger } from '../../shared/logger';

export interface McpServerConfig {
  /** 服务器名（工具名会以 `<name>_<tool>` 前缀注册，避免与内置工具冲突） */
  name: string;
  /** 启动命令（如 npx / node / python） */
  command: string;
  /** 启动参数（如 ["-y","@some/mcp-server"]） */
  args?: string[];
  /** 工作目录（缺省继承父进程） */
  cwd?: string;
  /** 环境变量（缺省继承） */
  env?: Record<string, string>;
  /** 初始化超时（默认 15000ms） */
  initTimeoutMs?: number;
  /** 工具调用超时（默认 120000ms） */
  callTimeoutMs?: number;
  /** 工具白名单（按原始工具名过滤；缺省不过滤） */
  tools?: string[];
}

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpCallResult {
  ok: boolean;
  output: string;
  error?: string;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** JSON-RPC 请求/通知写入 stdin（NDJSON 一行一条） */
function writeMessage(child: ChildProcess, msg: unknown): void {
  child.stdin?.write(JSON.stringify(msg) + '\n');
}

/**
 * 凭证展开（H2 安全修复）：MCP 配置 env 值支持 `${FHC_XXX}` 引用，
 * 启动子进程前从 process.env（含 .env 经 loadDotEnv 注入的值）解析。
 * 未解析的引用置空并告警，避免把 `${...}` 字面量当密钥传给平台 API。
 */
function expandEnvRefs(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string') { out[k] = v; continue; }
    out[k] = v.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => {
      const val = process.env[name];
      if (val !== undefined) return val;
      logger.warn(`MCP env 引用未解析：${name}（${k}）未设置，已置空。请在 .env 中配置 ${name}`, { ref: name });
      return '';
    });
  }
  return out;
}

/**
 * MCP stdio 客户端实例。
 * 用法：await client.connect() → await client.listTools() → await client.callTool(name, args) → await client.close()。
 */
export class McpClient {
  private child: ChildProcess | null = null;
  private rl: Interface | null = null;
  private readonly pending = new Map<
    string | number,
    { resolve: (msg: JsonRpcResponse) => void; reject: (e: Error) => void }
  >();
  private idSeq = 0;
  private connected = false;
  private stderrBuf = '';

  constructor(private readonly cfg: McpServerConfig) {}

  /** 服务器名（供上层按名查找客户端） */
  get serverName(): string {
    return this.cfg.name;
  }

  /** 启动子进程并完成 initialize 握手 */
  async connect(): Promise<void> {
    if (this.connected) return;
    const { command, args = [], cwd, env, name } = this.cfg;
    this.child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...expandEnvRefs(env) } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.rl = createInterface({ input: this.child.stdout ?? (undefined as never) });
    this.rl.on('line', (line) => this.handleLine(line));

    this.child.stderr?.on('data', (d: Buffer) => {
      this.stderrBuf = (this.stderrBuf + d.toString()).slice(-4000);
    });
    this.child.on('error', (e) => {
      const code = (e as NodeJS.ErrnoException).code;
      const hint = code === 'ENOENT'
        ? `（命令未找到：${command}。请确认该命令在 PATH 中，或改用绝对路径）`
        : '';
      this.rejectAll(`MCP 进程启动失败: ${e.message}${hint}`);
    });
    this.child.on('exit', (code) => {
      this.connected = false;
      this.rejectAll(`MCP 进程退出（code=${code}）`);
    });

    // initialize 握手（协议版本用官方最新稳定版）
    const initResp = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'feihong-code', version: '0.5.0' },
    }, this.cfg.initTimeoutMs ?? 15000);
    if (!initResp.result) {
      throw new Error(`MCP ${name} initialize 失败: ${initResp.error?.message ?? '无响应'}`);
    }
    // 通知服务器客户端已就绪
    writeMessage(this.child, { jsonrpc: '2.0', method: 'notifications/initialized' });
    this.connected = true;
  }

  /** 列出服务器工具 */
  async listTools(): Promise<McpToolDef[]> {
    const resp = await this.request('tools/list', {});
    if (!resp.result) {
      throw new Error(`tools/list 失败: ${resp.error?.message ?? '无响应'}`);
    }
    const tools = (resp.result as { tools?: McpToolDef[] }).tools ?? [];
    return tools;
  }

  /** 调用服务器工具（参数自动序列化，文本结果拼接返回），含瞬态错误指数退避重试 */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<McpCallResult> {
    // 非幂等写操作（git 的 confirm:true / db 的 allowWrite:true，或工具名命中写语义）不重试，
    // 避免"已执行但响应超时"时退避重试造成重放（重复 commit / 重复写 SQL）
    const isWriteOp =
      args.confirm === true ||
      args.allowWrite === true ||
      /commit|_add$|create_branch|checkout|^reset|push|delete|insert|update|drop|alter/i.test(toolName);
    const maxRetries = isWriteOp ? 0 : 3;
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await this.request('tools/call', { name: toolName, arguments: args }, this.cfg.callTimeoutMs ?? 120000);
        if (!resp.result) {
          return { ok: false, output: '', error: `tools/call 失败: ${resp.error?.message ?? '无响应'}` };
        }
        const result = resp.result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
        const text = (result.content ?? [])
          .map((c) => c.text ?? '')
          .join('\n');
        return {
          ok: !result.isError,
          output: text,
          error: result.isError ? text.slice(0, 500) : undefined,
        };
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        const msg = lastErr.message;
        // 进程退出/连接断开是终结性错误，直接抛出；仅对瞬态超时/网络错误重试
        if (/MCP 进程退出|MCP 进程启动失败|MCP 请求未运行/i.test(msg)) {
          throw lastErr;
        }
        const transient = /MCP 请求超时|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network/i.test(msg);
        if (!transient || attempt === maxRetries) break;
        logger.warn(`MCP callTool 瞬态错误，指数退避重试 ${attempt + 1}/${maxRetries}`, {
          tool: toolName, error: msg,
        });
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
    return { ok: false, output: '', error: lastErr?.message ?? 'tools/call 失败' };
  }

  /**
   * 关闭连接（优雅结束子进程）：
   *  1. 先 reject 全部在途请求，避免调用方挂到超时；
   *  2. 再走 stdin EOF，让 server 在 'end' 事件中自主清理（如 SQLite close、浏览器 quit）；
   *  3. 2s 内未退出才 SIGTERM 强杀兜底（SIGTERM 会绕过 server 清理路径，仅作兜底）。
   */
  async close(): Promise<void> {
    this.connected = false;
    this.rejectAll('连接已关闭');
    this.rl?.close();
    this.rl = null;
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return;
    try { child.stdin?.end(); } catch { /* noop */ }
    const exitedGracefully = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
    if (!exitedGracefully) {
      try { child.kill(); } catch { /* noop */ }
    }
  }

  /** stderr 摘要（诊断用） */
  get stderrTail(): string {
    return this.stderrBuf;
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(line) as JsonRpcResponse;
    } catch {
      logger.warn('MCP 收到非 JSON 行，已忽略', { server: this.cfg.name, line: line.slice(0, 200) });
      return;
    }
    if (msg.id !== undefined) {
      const entry = this.pending.get(msg.id);
      if (entry) {
        this.pending.delete(msg.id);
        entry.resolve(msg);
      }
    }
    // 服务器主动通知（如 logs/listened）直接忽略
  }

  private request(method: string, params: Record<string, unknown>, timeoutMs = 120000): Promise<JsonRpcResponse> {
    if (!this.child || this.child.exitCode !== null) {
      return Promise.reject(new Error('MCP 进程未运行'));
    }
    const id = ++this.idSeq;
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时（${method} > ${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject,
      });
      writeMessage(this.child!, { jsonrpc: '2.0', id, method, params });
    });
  }

  private rejectAll(reason: string): void {
    for (const [, entry] of this.pending) {
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }
}

/** 便捷工厂：创建客户端并完成握手 */
export async function connectMcp(cfg: McpServerConfig): Promise<McpClient> {
  const client = new McpClient(cfg);
  try {
    await client.connect();
    return client;
  } catch (e) {
    await client.close().catch(() => undefined);
    throw e;
  }
}
