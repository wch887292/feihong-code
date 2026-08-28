/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P2-1 多窗格 TUI 入口：`fhcode tui`
 *  - 非 TTY：打印演示多窗格布局（供冒烟断言 / 管道输出）。
 *  - TTY：进入交互模式，展示文件树 + 消息/Diff 多窗格。
 */
import { MultiPaneTui } from './multi-pane-tui';

/** 演示数据：文件树 + 消息 + diff（供冒烟断言与 TTY 演示共用） */
export function buildDemoPanes(): MultiPaneTui {
  const tui = new MultiPaneTui({ width: 100, height: 28, fileTreeWidth: 24, color: false });
  tui.setStatus({ mode: 'live', state: '运行中', fileCount: 3 });
  tui.setFileTree(['src/', '  main.ts', '  agent/', '    planner.ts', 'package.json']);
  tui.appendMessage('> 用户: 修复登录校验漏洞');
  tui.appendMessage('计划: 1) 检查 auth middleware 2) 补 token 过期校验');
  tui.setDiff({
    file: 'src/server/middleware/auth.ts',
    hunks: [
      {
        header: '-5,4 +5,5 @@',
        lines: [
          { type: 'ctx', content: 'export function auth(req, res, next) {' },
          { type: 'del', content: '  if (!req.token) return res.status(401);' },
          { type: 'add', content: '  if (!req.token) return res.status(401).end();' },
          { type: 'add', content: '  if (isExpired(req.token)) return res.status(401).end();' },
          { type: 'ctx', content: '  next();' },
        ],
      },
    ],
  });
  return tui;
}

/** 交互循环（TTY）：Tab 切窗格 / 1=消息 / 2=Diff / ↑↓ 文件树 / q 退出 */
export function runTuiInteractive(stream: NodeJS.ReadStream = process.stdin): void {
  const tui = buildDemoPanes();
  tui.start();
  if (!tui.isEnabled) {
    // 非 TTY：直接打印布局
    console.log(tui.getLayout().join('\n'));
    return;
  }
  stream.setRawMode?.(true);
  stream.resume?.();
  stream.setEncoding('utf8');
  stream.on('data', (chunk: Buffer | string) => {
    const k = chunk.toString();
    if (k === 'q' || k === '\u0003') {
      tui.stop();
      stream.setRawMode?.(false);
      process.exit(0);
    } else if (k === '\t') {
      tui.nextPane();
    } else if (k === '1') {
      tui.setRightMode('messages');
    } else if (k === '2') {
      tui.setRightMode('diff');
    } else if (k === '\u001b[B' || k === 'j') {
      tui.moveTreeCursor(1);
    } else if (k === '\u001b[A' || k === 'k') {
      tui.moveTreeCursor(-1);
    }
  });
  tui.appendMessage('多窗格 TUI 已就绪（Tab 切窗格 / 1=消息 / 2=Diff / ↑↓ 文件树 / q 退出）');
}

export function runTui(): void {
  runTuiInteractive();
}
