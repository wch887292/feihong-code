/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P2-1 多窗格 TUI：参照 opencode TUI 的「消息 + 文件树 + diff」三视图布局。
 *
 * 设计：
 *  - 纯文本布局可独立断言（getLayout()），非 TTY 下也可冒烟验证渲染正确。
 *  - TTY 下全屏重绘（交替屏幕缓冲 + ANSI），无闪烁；非 TTY 下仅打印布局。
 *  - 窗格：左 = 文件树（'↓' 选中），右 = 消息 / diff（可切换）。
 *  - 快捷键（TTY raw 模式由上层接管）：Tab 切换活跃窗格；1/2 切换右窗格视图。
 *  - 与旧 Tui（单列滚动）互不干扰，新增类向后兼容。
 */
import { TuiStatus } from './tui';

const ESC = '\x1b[';
const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const MOUSE_ON = '\x1b[?1000h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1000l\x1b[?1006l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR = '\x1b[2J';
const HOME = '\x1b[H';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

function moveTo(row: number, col = 1): string {
  return `${ESC}${row};${col}H`;
}

export interface DiffHunk {
  header: string;
  lines: Array<{ type: 'add' | 'del' | 'ctx'; content: string }>;
}

export interface DiffView {
  file: string;
  hunks: DiffHunk[];
}

export interface MultiPaneOptions {
  /** 终端/画布宽度（字符） */
  width?: number;
  /** 终端/画布高度（行） */
  height?: number;
  /** 左窗格（文件树）宽度 */
  fileTreeWidth?: number;
  /** 是否输出 ANSI（TTY 时 true） */
  color?: boolean;
}

export type RightPaneMode = 'messages' | 'diff';

/** 多窗格 TUI：文件树 + 消息/diff 主窗格 */
export class MultiPaneTui {
  private readonly opts: Required<MultiPaneOptions>;
  private status: TuiStatus = {};
  private fileTree: string[] = [];
  private treeCursor = 0;
  private messages: string[] = [];
  private diff: DiffView | null = null;
  private rightMode: RightPaneMode = 'messages';
  private activePane: 'tree' | 'right' = 'right';
  private enabled = false;

  constructor(opts: MultiPaneOptions = {}) {
    this.opts = {
      width: opts.width ?? 100,
      height: opts.height ?? 30,
      fileTreeWidth: opts.fileTreeWidth ?? 24,
      color: opts.color ?? false,
    };
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get activePaneName(): string {
    return this.activePane;
  }

  setStatus(s: TuiStatus): void {
    this.status = { ...this.status, ...s };
    if (this.enabled) this.redraw();
  }

  /** 设置文件树（保留选中位置） */
  setFileTree(files: string[]): void {
    this.fileTree = files;
    if (this.treeCursor >= files.length) this.treeCursor = Math.max(0, files.length - 1);
    if (this.enabled) this.redraw();
  }

  appendMessage(text: string): void {
    for (const line of text.split('\n')) this.messages.push(line);
    if (this.messages.length > 500) this.messages.splice(0, this.messages.length - 500);
    if (this.enabled) this.redraw();
  }

  setDiff(diff: DiffView | null): void {
    this.diff = diff;
    if (diff) this.rightMode = 'diff';
    if (this.enabled) this.redraw();
  }

  setRightMode(mode: RightPaneMode): void {
    this.rightMode = mode;
    if (this.enabled) this.redraw();
  }

  /** Tab：切换活跃窗格 */
  nextPane(): void {
    this.activePane = this.activePane === 'tree' ? 'right' : 'tree';
    if (this.enabled) this.redraw();
  }

  /** 文件树光标移动（delta=±1） */
  moveTreeCursor(delta: number): void {
    this.treeCursor = Math.max(0, Math.min(this.fileTree.length - 1, this.treeCursor + delta));
    if (this.enabled) this.redraw();
  }

  /** 启动：TTY 全屏模式（非 TTY 下仅记录 enabled，由调用方决定是否打印布局） */
  start(stream: NodeJS.WriteStream = process.stdout): void {
    if (this.enabled) return;
    this.enabled = true;
    if (stream.isTTY) {
      stream.write(ALT_ON + MOUSE_ON + HIDE_CURSOR + CLEAR + HOME);
      this.redraw(stream);
    }
  }

  stop(stream: NodeJS.WriteStream = process.stdout): void {
    if (!this.enabled) return;
    this.enabled = false;
    if (stream.isTTY) {
      stream.write(ALT_OFF + MOUSE_OFF + SHOW_CURSOR + CLEAR + HOME + RESET);
    }
  }

  /** 生成纯文本多窗格布局（逐行数组，冒烟测试直接断言） */
  getLayout(): string[] {
    const { width, height, fileTreeWidth } = this.opts;
    const rightWidth = Math.max(20, width - fileTreeWidth - 1);
    const out: string[] = [];

    // 1) 顶栏
    out.push(this.renderHeader().slice(0, width));
    // 2) 分隔线
    out.push('─'.repeat(Math.max(width, 0)));
    // 3) 内容区（height - 3 行：顶栏 + 分隔 + 底部输入）
    const bodyRows = Math.max(1, height - 3);
    const treeRows = this.renderTree(bodyRows, fileTreeWidth);
    const rightRows = this.renderRight(bodyRows, rightWidth);
    for (let i = 0; i < bodyRows; i++) {
      const left = (treeRows[i] ?? '').padEnd(fileTreeWidth, ' ').slice(0, fileTreeWidth);
      const right = (rightRows[i] ?? '').padEnd(rightWidth, ' ').slice(0, rightWidth);
      out.push(left + '│' + right);
    }
    // 4) 底部输入行
    out.push(this.renderPrompt().slice(0, width));
    return out;
  }

  /** TTY 全屏重绘 */
  private redraw(stream: NodeJS.WriteStream = process.stdout): void {
    const lines = this.getLayout();
    let out = CLEAR + HOME;
    for (const line of lines) out += line + '\n';
    out += `${moveTo(this.opts.height)}${SHOW_CURSOR}`;
    stream.write(out);
  }

  private renderHeader(): string {
    const s = this.status;
    const parts = [
      s.mode ? `[${s.mode}]` : '[fhcode]',
      s.runId ? `run=${s.runId.slice(0, 8)}` : '',
      s.iteration !== undefined ? `iter=${s.iteration}` : '',
      s.cost ? `cost=${s.cost}` : '',
      s.state ? `· ${s.state}` : '',
      s.fileCount !== undefined ? `files=${s.fileCount}` : '',
    ].filter(Boolean);
    return parts.join(' ') || '[fhcode]';
  }

  private renderTree(rows: number, width: number): string[] {
    const label = this.activePane === 'tree' ? '▍文件树' : ' 文件树';
    const out = [label.slice(0, width)];
    const visible = rows - 1;
    for (let i = 0; i < visible; i++) {
      const idx = i;
      const f = this.fileTree[idx];
      if (f === undefined) { out.push(''); continue; }
      const cursor = idx === this.treeCursor ? '▶ ' : '  ';
      out.push((cursor + f).slice(0, width));
    }
    return out;
  }

  private renderRight(rows: number, width: number): string[] {
    const label = this.rightMode === 'diff'
      ? (this.activePane === 'right' ? '▍Diff' : ' Diff')
      : (this.activePane === 'right' ? '▍消息' : ' 消息');
    const out = [label.slice(0, width)];
    const body = this.rightMode === 'diff' ? this.renderDiffLines() : this.messages.slice(-(rows - 1));
    for (let i = 0; i < rows - 1; i++) {
      const line = body[i];
      out.push(line === undefined ? '' : line.slice(0, width));
    }
    return out;
  }

  private renderDiffLines(): string[] {
    if (!this.diff) return ['（无 diff）'];
    const lines: string[] = [`文件: ${this.diff.file}`];
    for (const h of this.diff.hunks) {
      lines.push(`@@ ${h.header}`);
      for (const l of h.lines) {
        const mark = l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  ';
        lines.push(mark + l.content);
      }
    }
    return lines;
  }

  private renderPrompt(): string {
    const hint = this.rightMode === 'messages'
      ? '1=消息 2=Diff Tab=切换窗格 ↑/↓=文件树 q=退出'
      : '1=消息 2=Diff Tab=切换窗格 ↑/↓=文件树 q=退出';
    return '> ' + hint;
  }

  /** 导出：对 diff 行做 ANSI 着色（TTY 用） */
  colorizeLines(lines: string[]): string[] {
    if (!this.opts.color) return lines;
    return lines.map((l) => {
      if (l.startsWith('+ ')) return GREEN + l + RESET;
      if (l.startsWith('- ')) return RED + l + RESET;
      if (l.startsWith('@@')) return BOLD + l + RESET;
      if (l.startsWith('▍')) return BOLD + l + RESET;
      return DIM + l + RESET;
    });
  }
}
