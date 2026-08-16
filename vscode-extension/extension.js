/**
 * fhcode — 飞虹 Code VSCode 扩展壳（最小可用）
 *
 * 设计：不内置任何 Agent 逻辑，仅作为编辑器侧入口——
 *  1) 调起 `fhcode "<目标>"` 执行任务，输出流式写入 Output Channel
 *  2) 调起 `fhcode diff` 展示工作区变更（未跟踪/已跟踪）
 *
 * 二进制定位：设置 fhcode.binaryPath（默认 PATH 中的 fhcode）。
 * 依赖：用户需已安装 fhcode（npm i -g feihong-code 或本地构建）。
 */
'use strict';

const vscode = require('vscode');
const { spawn } = require('child_process');
const { homedir } = require('os');
const { join } = require('path');
const { existsSync } = require('fs');

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('fhcode.run', runTask),
    vscode.commands.registerCommand('fhcode.diff', showDiff),
  );
}

/** 执行一个 fhcode 命令并流式输出到 Output Channel */
function execFhcode(channel, args) {
  return new Promise((resolve) => {
    const bin = vscode.workspace
      .getConfiguration('fhcode')
      .get('binaryPath', 'fhcode');
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || process.cwd();
    channel.appendLine(`$ ${bin} ${args.join(' ')}  (cwd: ${cwd})`);

    const child = spawn(bin, args, { cwd, shell: true });
    child.stdout?.on('data', (d) => channel.append(d.toString()));
    child.stderr?.on('data', (d) => channel.append(d.toString()));
    child.on('error', (e) => {
      channel.appendLine(`[fhcode] 启动失败: ${e.message}`);
      channel.show(true);
      resolve({ code: 1 });
    });
    child.on('close', (code) => {
      channel.appendLine(`\n[fhcode] 退出码 ${code ?? 1}`);
      channel.show(true);
      resolve({ code: code ?? 1 });
    });
  });
}

/** fhcode.run：询问目标 → 执行任务 */
async function runTask() {
  const goal = await vscode.window.showInputBox({
    prompt: 'fhcode 任务目标（自然语言）',
    placeHolder: '例如: 修复 src/auth.ts 中的 token 校验 bug',
    ignoreFocusOut: true,
  });
  if (!goal) return;

  const offline = vscode.workspace.getConfiguration('fhcode').get('offline', false);
  const channel = vscode.window.createOutputChannel('fhcode');
  const args = offline ? ['--offline'] : [];
  // 非交互：审批一律拒绝更安全（CLI 无 TTY 时默认已如此）
  await execFhcode(channel, [...args, '--yes', goal]);
}

/** fhcode.diff：展示工作区 diff */
async function showDiff() {
  const channel = vscode.window.createOutputChannel('fhcode diff');
  await execFhcode(channel, ['diff']);
}

function deactivate() {}

module.exports = { activate, deactivate };
