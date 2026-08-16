/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 交互式 REPL：逐条需求交给编排器执行。未配置模型时走离线模式。
 * v0.5.0 增强：
 *  - Ctrl+D / EOF 优雅退出（此前 question Promise 永不 resolve，进程挂死）
 *  - 支持斜杠技能 /plan /grill /goal（与命令行行为一致）
 * P3-1 增强：
 *  - TUI 模式（TTY 时自动启用）：sticky header（模式/runId/迭代/成本/状态）+ 无闪烁渲染
 *  - 编排器事件实时驱动 header 与内容区；非 TTY 环境退化为普通输出
 */
import * as readline from 'readline';
import { runGoal, isOfflineByDefault, runPlanSkill, runGrillSkill, runGoalSkill } from './run';
import type { OrchestratorEvent } from '../agent/orchestrator';
import { Tui } from './tui';
import { t } from '../shared/i18n';

/** 把编排器事件渲染进 TUI（header 状态 + 内容日志） */
function tuiEventRenderer(tui: Tui): (ev: OrchestratorEvent) => void {
  return (ev) => {
    switch (ev.type) {
      case 'model.response':
        if (ev.content.trim()) tui.log(`🧠 ${ev.content.trim().slice(0, 300)}`);
        else if (ev.toolCalls.length > 0) tui.log(`🔧 ${t('stream.toolCalling', { tools: ev.toolCalls.join(', ') })}`);
        break;
      case 'tool.result':
        tui.log(ev.ok ? `  ✅ ${ev.name} ${t('stream.toolOk')}` : `  ❌ ${ev.name} ${t('stream.toolFail')} — ${ev.output.slice(0, 120)}`);
        break;
      case 'self-heal':
        tui.log(`🩹 ${t('stream.selfHeal', { category: ev.category })}`);
        break;
      case 'context.compact':
        tui.log(`📦 ${t('stream.compact', { from: ev.originalLength, to: ev.compressedLength })}`);
        break;
      case 'session.end':
        tui.setStatus({ iteration: ev.iterations, cost: '$' + ev.costUsd.toFixed(6), state: ev.ok ? '完成' : '未完成' });
        tui.log(`🏁 ${t('stream.done', { iter: ev.iterations, cost: '$' + ev.costUsd.toFixed(6) })}`);
        break;
    }
  };
}

export async function startRepl(): Promise<void> {
  const tui = new Tui();
  tui.start(); // 非 TTY 自动 no-op

  console.log(t('repl.welcome'));
  console.log(t('repl.hint'));
  tui.setStatus({ mode: isOfflineByDefault() ? 'offline' : 'live', state: t('repl.stateReady') });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Ctrl+D / EOF：readline 触发 close，但挂起的 question 回调不会执行，
  // 必须由 close 事件主动唤醒等待中的 Promise，否则进程永久挂死。
  let closed = false;
  let resolvePrompt: ((line: string | null) => void) | null = null;
  rl.on('close', () => {
    closed = true;
    resolvePrompt?.(null);
  });

  while (!closed) {
    const line = await new Promise<string | null>((resolve) => {
      resolvePrompt = resolve;
      rl.question(t('repl.prompt'), (answer) => resolve(answer));
    });
    resolvePrompt = null;
    if (line === null) break; // EOF → 退出
    const cmd = line.trim();
    if (cmd === 'exit' || cmd === 'quit') break;
    if (!cmd) continue;

    // 斜杠技能（与 CLI 单命令一致）
    if (cmd.startsWith('/')) {
      try {
        const [kind, ...rest] = cmd.slice(1).split(/\s+/);
        if (kind === 'plan') tui.log(runPlanSkill(rest.join(' ') || ''));
        else if (kind === 'grill') tui.log(runGrillSkill(rest.join(' ') || '.'));
        else if (kind === 'goal') tui.log(runGoalSkill(rest.join(' ') || ''));
        else tui.log(t('repl.unknownSkill', { cmd: kind }));
      } catch (e) {
        tui.log(t('repl.errorPrefix') + (e instanceof Error ? e.message : String(e)));
      }
      continue;
    }

    const offline = isOfflineByDefault();
    tui.setStatus({ mode: offline ? 'offline' : 'live', state: t('repl.stateRunning') });
    try {
      // P3-1：TUI 模式下用自定义渲染器驱动 header/内容；非 TTY 走普通流式输出
      await runGoal(cmd, { offline, renderer: tui.isEnabled ? tuiEventRenderer(tui) : undefined, stream: !tui.isEnabled });
    } catch (e) {
      tui.log(t('repl.errorPrefix') + (e instanceof Error ? e.message : String(e)));
    }
    tui.setStatus({ state: t('repl.stateReady') });
  }

  rl.close();
  tui.stop();
  console.log(t('repl.bye'));
}
