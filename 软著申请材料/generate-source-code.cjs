// 飞虹 Code v8.0.0 软著申请源程序代码生成器
// 生成前30页+后30页，每页50行，共3000行
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(__dirname, '源程序代码-v8.0.0.html');

// 核心源文件按优先级排序（前半部分）
const FRONT_FILES = [
  'src/cli/version.ts',
  'src/cli/index.ts',
  'src/cli/repl.ts',
  'src/shared/config.ts',
  'src/shared/errors.ts',
  'src/shared/logger.ts',
  'src/shared/secure-store.ts',
  'src/shared/sqlite-store.ts',
  'src/shared/log-rotator.ts',
  'src/models/model-router.ts',
  'src/models/providers/openai-compatible.provider.ts',
  'src/models/providers/ollama.provider.ts',
  'src/models/providers/mock.provider.ts',
  'src/agent/orchestrator.ts',
  'src/agent/planner.ts',
  'src/agent/swe-agent.ts',
  'src/agent/swe-planner.ts',
  'src/agent/swe-verifier.ts',
  'src/agent/solo-agent.ts',
  'src/agent/multi-agent.ts',
  'src/agent/custom-agent.ts',
  'src/agent/event-driven-agent.ts',
  'src/agent/self-correction.ts',
  'src/agent/self-heal.ts',
  'src/agent/quality-gate.ts',
  'src/agent/context-compactor.ts',
  'src/agent/context-budget.ts',
  'src/agent/experience.ts',
  'src/agent/layered-memory.ts',
  'src/agent/code-writer.ts',
  'src/agent/code-review.ts',
  'src/agent/design-to-code.ts',
  'src/agent/git-integration.ts',
  'src/agent/repo-context.ts',
  'src/agent/repo-reader.ts',
  'src/agent/symbol-index.ts',
  'src/agent/type-checker.ts',
  'src/agent/lint.ts',
  'src/agent/completion-engine.ts',
  'src/agent/completion-postprocess.ts',
  'src/agent/parallel-orchestrator.ts',
  'src/agent/team.ts',
  'src/agent/team-collaboration.ts',
  'src/agent/subagent.ts',
  'src/agent/subagent-summary.ts',
];

// 后半部分核心文件
const BACK_FILES = [
  'src/tools/docker-sandbox.ts',
  'src/tools/sandbox.ts',
  'src/tools/safe-path.ts',
  'src/tools/tool.registry.ts',
  'src/tools/index.ts',
  'src/tools/file/read.tool.ts',
  'src/tools/file/write.tool.ts',
  'src/tools/file/edit.tool.ts',
  'src/tools/file/list.tool.ts',
  'src/tools/shell/exec.ts',
  'src/tools/shell/run-shell.tool.ts',
  'src/tools/search/grep.tool.ts',
  'src/tools/browser/browser.tool.ts',
  'src/tools/web/web.tool.ts',
  'src/tools/verify/build-check.tool.ts',
  'src/tools/verify/test-run.tool.ts',
  'src/tools/generator/code-generator.ts',
  'src/tools/generator/test-generator.ts',
  'src/tools/analysis/code-analyzer.ts',
  'src/tools/mcp/mcp-client.ts',
  'src/tools/mcp/index.ts',
  'src/tools/skills/load-skill.tool.ts',
  'src/memory/honcho-store.ts',
  'src/memory/auto-summarize.ts',
  'src/memory/index.ts',
  'src/skills/pua-hooks.ts',
  'src/skills/skill-loader.ts',
  'src/skills/skill-market.ts',
  'src/skills/goal.ts',
  'src/skills/grill.ts',
  'src/skills/plan.ts',
  'src/skills/self-heal.ts',
  'src/integrations/wechat-bridge.ts',
  'src/integrations/feishu-bridge.ts',
  'src/integrations/yuanbao-bridge.ts',
  'src/integrations/github-mcp.ts',
  'src/integrations/collaboration.ts',
  'src/integrations/figma.ts',
  'src/integrations/sso.ts',
  'src/web/server.ts',
  'src/web/auth.ts',
  'src/web/task-queue.ts',
  'src/web/channels.ts',
  'src/web/extra-apis.ts',
  'src/web/web-config.ts',
  'src/runtime/event-log.ts',
  'src/runtime/session-store.ts',
  'src/runtime/session-persist.ts',
  'src/runtime/git.ts',
  'src/runtime/hooks.ts',
  'src/runtime/worktree.ts',
  'src/enterprise/audit.ts',
  'src/enterprise/policy.ts',
  'src/enterprise/tenant.ts',
  'src/enterprise/quota.ts',
  'src/enterprise/guard.ts',
  'src/enterprise/index.ts',
  'src/knowledge/library.ts',
  'src/lsp/lsp-client.ts',
  'src/lsp/lsp-service.ts',
  'src/plugins/manager.ts',
  'src/plugins/plugin-loader.ts',
  'src/self-evolve/manager.ts',
  'src/self-evolve/self-heal-scheduler.ts',
  'src/self-evolve/hook.ts',
  'src/harness/executor.ts',
  'src/harness/verifier.ts',
  'src/harness/loader.ts',
  'src/harness/harness.ts',
  'src/harness/reporter.ts',
  'src/training/completion-evaluator.ts',
  'src/training/fim-data.ts',
  'src/voice/voice-programming.ts',
  'src/shared/concurrency.ts',
  'src/shared/i18n.ts',
  'src/shared/types.ts',
];

const LINES_PER_PAGE = 50;
const PAGES_HALF = 30;
const LINES_HALF = LINES_PER_PAGE * PAGES_HALF; // 1500

function readFiles(fileList) {
  const allLines = [];
  for (const rel of fileList) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, 'utf-8');
    const lines = content.split('\n');
    // 添加文件分隔标记
    allLines.push({ type: 'file', name: rel });
    for (const line of lines) {
      allLines.push({ type: 'code', text: line });
    }
  }
  return allLines;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildPages(lines, startPage) {
  const pages = [];
  let lineIdx = 0;
  for (let p = 0; p < PAGES_HALF; p++) {
    const pageLines = [];
    for (let l = 0; l < LINES_PER_PAGE && lineIdx < lines.length; l++, lineIdx++) {
      pageLines.push(lines[lineIdx]);
    }
    pages.push({ pageNum: startPage + p, lines: pageLines });
  }
  return pages;
}

function renderPage(page, section) {
  let html = `<div class="page">`;
  html += `<div class="header">飞虹 Code 终端 AI 编程智能体软件 V8.0.0 ｜ 源程序代码 ｜ ${section}</div>`;
  html += `<table class="code-table">`;
  let globalLine = (page.pageNum - 1) * LINES_PER_PAGE + 1;
  for (const item of page.lines) {
    if (item.type === 'file') {
      html += `<tr><td class="lineno"></td><td class="file-marker">┌── ${escapeHtml(item.name)} ──┐</td></tr>`;
    } else {
      const text = item.text === '' ? '&nbsp;' : escapeHtml(item.text);
      html += `<tr><td class="lineno">${globalLine}</td><td class="codeline">${text}</td></tr>`;
      globalLine++;
    }
  }
  html += `</table>`;
  html += `<div class="footer">第 ${page.pageNum} 页 ｜ 共 60 页</div>`;
  html += `</div>`;
  return html;
}

console.log('读取前半部分核心源文件...');
const frontLines = readFiles(FRONT_FILES);
console.log(`前半部分共 ${frontLines.length} 行（含文件标记）`);

console.log('读取后半部分核心源文件...');
const backLines = readFiles(BACK_FILES);
console.log(`后半部分共 ${backLines.length} 行（含文件标记）`);

// 前30页：取前1500行
const frontPages = buildPages(frontLines.slice(0, LINES_HALF + 30), 1); // 多取30行补偿文件标记

// 后30页：取后1500行
const backStart = Math.max(0, backLines.length - LINES_HALF - 30);
const backPages = buildPages(backLines.slice(backStart), 31);

console.log(`生成 ${frontPages.length} 页（前半）+ ${backPages.length} 页（后半）`);

let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>飞虹 Code 终端 AI 编程智能体软件 源程序代码 V8.0.0</title>
<style>
@page { size: A4; margin: 1.5cm 1.5cm 1.5cm 1.5cm; }
body { font-family: Consolas, "Courier New", monospace; font-size: 8pt; line-height: 1.4; margin: 0; padding: 0; color: #000; }
.page { page-break-after: always; position: relative; min-height: 26cm; }
.page:last-child { page-break-after: auto; }
.header { text-align: center; font-size: 8pt; color: #333; border-bottom: 1px solid #999; padding-bottom: 4px; margin-bottom: 8px; font-family: "Microsoft YaHei", sans-serif; }
.footer { text-align: center; font-size: 8pt; color: #666; border-top: 1px solid #999; padding-top: 4px; margin-top: 8px; position: absolute; bottom: 0; width: 100%; font-family: "Microsoft YaHei", sans-serif; }
.code-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.code-table td { padding: 0; vertical-align: top; }
.lineno { width: 40px; text-align: right; padding-right: 8px !important; color: #999; border-right: 1px solid #eee; white-space: nowrap; }
.codeline { padding-left: 8px !important; white-space: pre-wrap; word-break: break-all; }
.file-marker { padding-left: 8px !important; font-weight: bold; color: #0066cc; background: #f0f4ff; white-space: pre-wrap; }
.cover { text-align: center; padding-top: 250px; page-break-after: always; font-family: "Microsoft YaHei", sans-serif; }
.cover h1 { font-size: 28pt; margin-bottom: 20px; }
.cover h2 { font-size: 18pt; margin-bottom: 40px; font-weight: normal; }
.cover .info { font-size: 14pt; line-height: 2.5; margin-top: 60px; }
</style>
</head>
<body>

<div class="cover">
<h1>飞虹 Code</h1>
<h2>终端 AI 编程智能体软件</h2>
<h2>源程序代码</h2>
<div class="info">
<p><strong>软件版本：</strong>V8.0.0</p>
<p><strong>著作权人：</strong>吴赐虹</p>
<p><strong>开发完成日期：</strong>2026年9月3日</p>
<p><strong>首次发表日期：</strong>2026年9月3日</p>
<p><strong>源代码页数：</strong>前30页 + 后30页，共60页</p>
<p><strong>开发单位：</strong>晋江市飞虹智科技企业管理有限公司</p>
<p><strong>研发中心：</strong>飞扬企源研发中心</p>
</div>
</div>

`;

console.log('渲染前30页...');
for (const page of frontPages) {
  html += renderPage(page, '前30页（源程序开头部分）');
}

console.log('渲染后30页...');
for (const page of backPages) {
  html += renderPage(page, '后30页（源程序结尾部分）');
}

html += `
</body>
</html>`;

fs.writeFileSync(OUTPUT, html, 'utf-8');
console.log(`\n生成完成: ${OUTPUT}`);
console.log(`文件大小: ${(fs.statSync(OUTPUT).size / 1024).toFixed(1)} KB`);
