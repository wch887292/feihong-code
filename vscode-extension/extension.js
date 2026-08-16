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

  // M1.1b：内联评审诊断集合（按语言分组）
  const diagnostics = vscode.languages.createDiagnosticCollection('fhcode');
  context.subscriptions.push(diagnostics);

  // M1.1b：CodeAction——为评审诊断提供「查看 fhcode 建议」修复动作
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    [{ scheme: 'file' }],
    {
      provideCodeActions(document, range, ctx) {
        const actions = [];
        for (const diag of ctx.diagnostics) {
          if (diag.source !== 'fhcode') continue;
          const detail = diag.code || diag.message;
          const action = new vscode.CodeAction(
            `fhcode: ${diag.message}`,
            vscode.CodeActionKind.QuickFix,
          );
          action.diagnostics = [diag];
          action.command = {
            command: 'fhcode.showSuggestion',
            title: '查看 fhcode 建议',
            arguments: [{ rule: diag.code, detail: detail }],
          };
          actions.push(action);
        }
        return actions;
      },
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
  );
  context.subscriptions.push(codeActionProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('fhcode.run', runTask),
    vscode.commands.registerCommand('fhcode.diff', showDiff),
    vscode.commands.registerCommand('fhcode.output', showOutput),
    vscode.commands.registerCommand('fhcode.review', () => runReview(diagnostics)),
    vscode.commands.registerCommand('fhcode.showSuggestion', showSuggestion),
  );

  // M1.1b：文件保存后自动评审（默认开启，可用 fhcode.reviewOnSave 关闭）
  if (vscode.workspace.getConfiguration('fhcode').get('reviewOnSave', true)) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.scheme === 'file') runReview(diagnostics, doc.uri);
      }),
    );
  }
}

/** 执行 fhcode 命令并捕获 stdout（JSON 等结构化输出用） */
function execFhcodeCapture(args) {
  return new Promise((resolve) => {
    const bin = vscode.workspace.getConfiguration('fhcode').get('binaryPath', 'fhcode');
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || process.cwd();
    const child = spawn(bin, args, { cwd, shell: true });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.stderr?.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => resolve({ code: 1, stdout: '', stderr: e.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout: out, stderr: err }));
  });
}

/**
 * M1.1b：对活动文件/指定 URI 跑 `fhcode review <file> --json`，
 * 把 findings 映射为编辑器内联诊断（critical/high→Error，medium→Warning，low→Information）。
 */
async function runReview(diagnostics, uri) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('请先打开一个工作区文件夹');
    return;
  }
  const target = uri || vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    vscode.window.showInformationMessage('没有活动文件可评审');
    return;
  }
  const doc = await vscode.workspace.openTextDocument(target);
  const rel = vscode.workspace.asRelativePath(target).replace(/\\/g, '/');
  const { stdout } = await execFhcodeCapture(['review', rel, '--json']);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    vscode.window.showErrorMessage('fhcode review 输出解析失败，请确认 CLI 已安装且支持 --json');
    return;
  }
  const sevMap = { critical: 0, high: 0, medium: 1, low: 2 }; // Error/Warning/Information
  const entries = [];
  for (const f of parsed.findings || []) {
    const line = Math.max(0, (f.line || 1) - 1);
    const range = new vscode.Range(line, 0, line, Math.max(1, doc.lineAt(line).text.length));
    const severity = sevMap[f.severity] !== undefined ? sevMap[f.severity] : 2;
    const diag = new vscode.Diagnostic(range, `${f.detail}（${f.rule}）`, severity);
    diag.source = 'fhcode';
    diag.code = f.rule;
    entries.push([target, [diag]]);
  }
  diagnostics.set(entries);
  const n = entries.length;
  vscode.window.setStatusBarMessage(
    n === 0 ? 'fhcode review：未发现问题 ✅' : `fhcode review：发现 ${n} 个问题`,
    4000,
  );
}

/** M1.1b：展示评审建议详情（quick fix 动作） */
function showSuggestion(args) {
  const { rule, detail } = args || {};
  vscode.window.showInformationMessage(`[fhcode ${rule}] ${detail}`);
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
