/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P3-1 轻量 TUI：sticky header + 无闪烁渲染（对齐 Gemini CLI 的终端体验）。
 *
 * 设计：
 *  - 纯 ANSI 转义实现，零依赖；非 TTY 环境自动退化为普通输出（无感）。
 *  - 交替屏幕缓冲（\x1b[?1049h/l）：TUI 会话独享整个终端，退出后完整恢复。
 *  - sticky header：状态栏固定顶部（模式/runId/迭代/成本/状态），
 *    内容区在下方滚动；每次更新用单次写入整屏重绘（无闪烁）。
 *  - 鼠标：开启 SGR 鼠标模式（\x1b[?1006h + ?1000h），滚轮滚动内容区。
 *  - 事件驱动：setStatus() 更新 header；print()/log() 追加内容行。
 */
import { t } from '../shared/i18n';

const ESC = '\x1b[';
// ANSI 控制序列
const ALT_ON = '\x1b[?1049h'; // 进入交替屏幕缓冲
const ALT_OFF = '\x1b[?1049l'; // 退出交替屏幕缓冲
const MOUSE_ON = '\x1b[?1000h\x1b[?1006h'; // 开启按钮 + SGR 鼠标
const MOUSE_OFF = '\x1b[?1000l\x1b[?1006l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR = '\x1b[2J';
const HOME = '\x1b[H';

/** 光标移动到第 row 行、col 列（1-based） */
function moveTo(row: number, col = 1): string {
  return `${ESC}${row};${col}H`;
}

export interface TuiStatus {
  mode?: string;
  runId?: string;
  iteration?: number;
  cost?: string;
  state?: string;
}

/**
 * 最小 TUI 渲染器。
 * 典型用法：
 *   const tui = new Tui();
 *   tui.start();
 *   tui.setStatus({ mode: 'live', state: '运行中' });
 *   tui.log('模型响应…');
 *   tui.stop();
 */
export class Tui {
  private enabled = false;
  private header: TuiStatus = {};
  private lines: string[] = [];
  /** 内容区最大可见行数（超出滚动丢弃顶部，控制内存与重绘量） */
  private maxLines = 500;
  /** 滚动偏移（滚轮/PageUp 用） */
  private scroll = 0;
  /** 头部高度（固定 1 行状态 + 1 行分隔） */
  private readonly headerHeight = 2;

  constructor(private readonly stream: NodeJS.WriteStream = process.stdout) {}

  /** 是否处于 TUI 模式 */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 进入 TUI 模式（仅 TTY 时生效） */
  start(): void {
    if (!this.stream.isTTY || this.enabled) return;
    this.enabled = true;
    this.stream.write(ALT_ON + MOUSE_ON + HIDE_CURSOR + CLEAR + HOME);
    this.render();
    this.stream.write(`${moveTo(this.stream.rows ?? 24)}${SHOW_CURSOR}`); // 光标回到输入行
  }

  /** 更新 sticky header 状态 */
  setStatus(status: TuiStatus): void {
    if (!this.enabled) return;
    this.header = { ...this.header, ...status };
    this.render();
  }

  /** 追加一行内容（自动滚动，保留底部窗口） */
  log(text: string): void {
    if (!this.enabled) {
      this.stream.write(text + '\n');
      return;
    }
    for (const line of text.split('\n')) {
      this.lines.push(line);
    }
    if (this.lines.length > this.maxLines) {
      this.lines.splice(0, this.lines.length - this.maxLines);
    }
    this.scroll = 0; // 新内容 → 回到底部
    this.render();
  }

  /** 滚轮/按键滚动（delta > 0 向上看历史，< 0 向下） */
  scrollBy(delta: number): void {
    if (!this.enabled) return;
    this.scroll = Math.max(0, Math.min(this.lines.length - 1, this.scroll + delta));
    this.render();
  }

  /** 退出 TUI 模式并恢复终端 */
  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.stream.write(ALT_OFF + MOUSE_OFF + SHOW_CURSOR + CLEAR + HOME);
    this.stream.write('\x1b[0m');
  }

  /** 渲染整屏（单次 write = 无闪烁） */
  private render(): void {
    if (!this.enabled) return;
    const height = this.stream.rows ?? 24;
    const width = this.stream.columns ?? 80;
    const headerText = this.renderHeader();
    const visibleBody = height - this.headerHeight - 1; // 保留底部输入提示行
    // 计算内容窗口（从 lines 尾部按滚动偏移取 visibleBody 行）
    const start = Math.max(0, this.lines.length - visibleBody - this.scroll);
    const window = this.lines.slice(start, start + visibleBody);

    let out = CLEAR + HOME;
    out += headerText + '\n';
    out += '─'.repeat(Math.min(width, 80)) + '\n';
    for (const line of window) {
      out += (line || ' ').slice(0, width) + '\n';
    }
    // 补足空行，避免残留
    for (let i = window.length; i < visibleBody; i++) out += '\n';
    out += `${moveTo(height)}${this.renderPrompt()}`;
    this.stream.write(out);
  }

  private renderHeader(): string {
    const s = this.header;
    const parts = [
      s.mode ? `[${s.mode}]` : '[fhcode]',
      s.runId ? `run=${s.runId.slice(0, 8)}` : '',
      s.iteration !== undefined ? `iter=${s.iteration}` : '',
      s.cost ? `cost=${s.cost}` : '',
      s.state ? `· ${s.state}` : '',
    ].filter(Boolean);
    return parts.join(' ') || '[fhcode]';
  }

  private renderPrompt(): string {
    return `${t('repl.prompt')}`;
  }
}
