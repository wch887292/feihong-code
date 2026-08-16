/**
 * fhcode — 飞虹 Code VSCode 扩展（P6-3 增强版）
 *
 * 设计：不内置任何 Agent 逻辑，仅作为编辑器侧入口——
 *  1) `fhcode.run`：目标输入，**自动检测选区**，选中代码作为上下文注入目标
 *  2) `fhcode.diff`：列出工作区变更文件，用 VSCode **原生 diff 编辑器**
 *     就地展示 HEAD vs 工作区（TextDocumentContentProvider 提供 HEAD 内容）
 *  3) `fhcode.output`：查看最近一次任务输出（Output Channel）
 *
 * 二进制定位：设置 fhcode.binaryPath（默认 PATH 中的 fhcode）。
 * 依赖：用户需已安装 fhcode；diff 面板依赖 git（与 fhcode diff 一致）。
 */
'use strict';

const vscode = require('vscode');
const { spawn, execFile } = require('child_process');
const { join } = require('path');

const HEAD_SCHEME = 'fhcode-head';

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  // HEAD 内容提供器：fhcode-head://<workspace>/<relative-path> → git show HEAD:<path>
  const provider = new (class {
    provideTextDocumentContent(uri) {
      return new Promise((resolve) => {
        const rel = decodeURIComponent(uri.path).replace(/^\/+/, '');
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || process.cwd();
        execFile('git', ['show', `HEAD:${rel}`], { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
          resolve(err ? `（无法读取 HEAD 版本: ${err.message}）` : stdout);
        });
      });
    }
  })();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(HEAD_SCHEME, provider));

  context.subscriptions.push(
    vscode.commands.registerCommand('fhcode.run', runTask),
    vscode.commands.registerCommand('fhcode.diff', showDiff),
    vscode.commands.registerCommand('fhcode.output', showOutput),
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

/** 获取当前编辑器选区文本（无选区返回 null） */
function getSelectionText() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const sel = editor.selection;
  if (sel.isEmpty) return null;
  const text = editor.document.getText(sel).trim();
  return text || null;
}

/** fhcode.run：询问目标 →（有选区时附加上下文）→ 执行任务 */
async function runTask() {
  const selection = getSelectionText();
  const prompt = selection
    ? 'fhcode 任务目标（将附加当前选区为上下文）'
    : 'fhcode 任务目标（自然语言）';
  const goal = await vscode.window.showInputBox({
    prompt,
    placeHolder: '例如: 修复 src/auth.ts 中的 token 校验 bug',
    ignoreFocusOut: true,
  });
  if (!goal) return;

  let finalGoal = goal;
  if (selection) {
    const pick = await vscode.window.showQuickPick(
      ['✅ 附带选区上下文', '忽略选区'],
      { placeHolder: '检测到选中代码，如何处理？', ignoreFocusOut: true },
    );
    if (pick === '✅ 附带选区上下文') {
      const lang = vscode.window.activeTextEditor?.document.languageId || '';
      finalGoal += `\n\n<selection context="${lang}">\n${selection}\n</selection>`;
    }
  }

  const offline = vscode.workspace.getConfiguration('fhcode').get('offline', false);
  const channel = vscode.window.createOutputChannel('fhcode');
  const args = offline ? ['--offline'] : [];
  await execFhcode(channel, [...args, '--yes', finalGoal]);
}

/** 列出工作区变更文件（git diff --name-only，含未跟踪的简化处理） */
function listChangedFiles() {
  return new Promise((resolve) => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || process.cwd();
    execFile('git', ['diff', '--name-only'], { cwd }, (err, stdout) => {
      if (err) return resolve([]);
      const files = stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      resolve(files);
    });
  });
}

/** fhcode.diff：用 VSCode 原生 diff 编辑器就地展示 HEAD vs 工作区 */
async function showDiff() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('请先打开一个工作区文件夹');
    return;
  }
  const files = await listChangedFiles();
  if (files.length === 0) {
    vscode.window.showInformationMessage('工作区没有已跟踪的变更文件');
    return;
  }
  const pick = await vscode.window.showQuickPick(files, {
    placeHolder: `选择要查看 diff 的文件（共 ${files.length} 个变更）`,
    ignoreFocusOut: true,
  });
  if (!pick) return;

  const workspaceRoot = folder.uri.fsPath;
  const rel = pick.replace(/\\/g, '/');
  // HEAD 版本：fhcode-head://<root>/<rel>
  const headUri = vscode.Uri.parse(`${HEAD_SCHEME}://${encodeURIComponent(workspaceRoot)}/${rel}`);
  const workUri = vscode.Uri.file(join(workspaceRoot, ...rel.split('/')));
  await vscode.commands.executeCommand('vscode.diff', headUri, workUri, `${rel} (HEAD ↔ 工作区)`);
}

/** fhcode.output：聚焦最近任务输出 */
function showOutput() {
  vscode.window.createOutputChannel('fhcode').show(true);
}

function deactivate() {}

module.exports = { activate, deactivate };
