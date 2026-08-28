/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P1-1 LSP 客户端：对接真实 LSP 服务器（typescript-language-server），
 * 使 lsp-service 从"自建语义层"升级为"编译器级代码理解"（对标 OpenCode）。
 *
 * 实现：
 *  - spawn typescript-language-server --stdio，通过 stdin/stdout 通信
 *  - JSON-RPC 2.0 over stdio（Content-Length 帧编解码）
 *  - initialize → initialized → didOpen → hover / definition
 *  - 请求/响应按 id 匹配，带超时；非 TTY 可单测
 */
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

export interface LspHoverResult {
  contents?: string | { value?: string } | Array<{ value?: string }>;
  range?: unknown;
}

export interface LspLocation {
  uri?: string;
  range?: { start?: { line?: number; character?: number } };
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/** 轻量 LSP 客户端（JSON-RPC 2.0 over stdio） */
export class LspClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private started = false;
  private stderrTail: string[] = [];

  get isRunning(): boolean {
    return this.started;
  }

  get lastStderr(): string {
    return this.stderrTail.slice(-3).join('\n');
  }

  /** 启动并完成 initialize 握手（真实 LSP 服务器） */
  async start(projectRoot: string, opts: { bin?: string; timeoutMs?: number } = {}): Promise<boolean> {
    const timeoutMs = opts.timeoutMs ?? 15000;
    // 用 node 直接执行 tls 入口（require.resolve 定位，跨平台稳定，不依赖 npx/全局 PATH）
    let cliPath: string;
    try {
      cliPath = opts.bin ?? require.resolve('typescript-language-server/lib/cli.mjs');
    } catch {
      this.started = false;
      return false;
    }
    this.proc = spawn(process.execPath, [cliPath, '--stdio'], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (!this.proc.stdout || !this.proc.stdin) {
      this.started = false;
      return false;
    }
    this.proc.stdout.on('data', (d: Buffer) => this.onData(d));
    this.proc.stderr.on('data', (d: Buffer) => {
      this.stderrTail.push(d.toString());
      if (this.stderrTail.length > 20) this.stderrTail.shift();
    });
    this.proc.on('exit', () => {
      this.started = false;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('LSP server exited'));
      }
      this.pending.clear();
    });

    try {
      const rootUri = 'file:///' + projectRoot.replace(/\\/g, '/').replace(/^\/+/, '');
      await this.request('initialize', {
        processId: null,
        rootUri,
        capabilities: {},
        workspaceFolders: [{ uri: rootUri, name: projectRoot.split(/[\\/]/).pop() || 'ws' }],
      }, timeoutMs);
      this.sendNotification('initialized', {});
      this.started = true;
      return true;
    } catch (e) {
      this.close();
      return false;
    }
  }

  /** 打开文档（服务端建立诊断/语义上下文） */
  didOpen(uri: string, text: string, languageId = 'typescript'): void {
    this.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  /** hover：编译器级类型签名信息（对标 LSP textDocument/hover） */
  async hover(uri: string, line: number, character: number, timeoutMs = 10000): Promise<LspHoverResult | null> {
    try {
      return (await this.request('textDocument/hover', {
        textDocument: { uri },
        position: { line, character },
      }, timeoutMs)) as LspHoverResult | null;
    } catch {
      return null;
    }
  }

  /** definition：符号精确定位（对标 LSP textDocument/definition） */
  async definition(uri: string, line: number, character: number, timeoutMs = 10000): Promise<LspLocation[] | null> {
    try {
      return (await this.request('textDocument/definition', {
        textDocument: { uri },
        position: { line, character },
      }, timeoutMs)) as LspLocation[] | null;
    } catch {
      return null;
    }
  }

  close(): void {
    try {
      this.proc?.stdin?.end();
      this.proc?.kill();
    } catch {
      /* ignore */
    }
    this.proc = null;
    this.started = false;
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString();
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) return;
      const len = Number(m[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + len) return;
      const body = this.buffer.slice(bodyStart, bodyStart + len).toString();
      this.buffer = this.buffer.slice(bodyStart + len);
      try {
        this.handleMessage(JSON.parse(body) as Record<string, unknown>);
      } catch {
        /* 非 JSON 帧忽略 */
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const id = msg.id as number | undefined;
    if (id !== undefined && this.pending.has(id)) {
      const p = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP timeout: ${method}`));
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private sendNotification(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private send(obj: unknown): void {
    const body = JSON.stringify(obj);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    this.proc?.stdin?.write(header + body);
  }
}
