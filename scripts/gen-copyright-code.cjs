/**
 * 软件著作权源程序代码生成器
 * 生成60页源程序代码HTML（前30页+后30页，每页≥50行）
 */
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = 'H:\\Muse Code复刻';
const SOFTWARE_NAME = '飞虹 Code 终端 AI 编程智能体软件';
const VERSION = 'V1.0.0';
const LINES_PER_PAGE = 50;
const FRONT_PAGES = 30;
const BACK_PAGES = 30;

// 前30页选取的文件（入口+核心编排器）
const frontFiles = [
  'src/cli/index.ts',
  'src/cli/version.ts',
  'src/agent/orchestrator.ts',
  'src/agent/planner.ts',
  'src/agent/self-heal.ts',
  'src/agent/code-writer.ts',
  'src/agent/experience.ts',
  'src/agent/prompts.ts',
];

// 后30页选取的文件（模型路由+Web服务+工具系统）
const backFiles = [
  'src/models/model-router.ts',
  'src/models/model.interface.ts',
  'src/models/providers/openai-compatible.provider.ts',
  'src/web/server.ts',
  'src/web/task-queue.ts',
  'src/web/auth.ts',
  'src/tools/tool.registry.ts',
  'src/tools/shell/exec.ts',
  'src/shared/config.ts',
  'src/shared/concurrency.ts',
];

function readFileLines(relativePath) {
  const fullPath = path.join(PROJECT_ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return [];
  const content = fs.readFileSync(fullPath, 'utf8');
  return content.split('\n').map((line, idx) => ({
    num: idx + 1,
    text: line.replace(/\t/g, '    '),
    file: relativePath,
  }));
}

function collectLines(files, maxLines) {
  const allLines = [];
  for (const file of files) {
    const lines = readFileLines(file);
    // 添加文件分隔标记
    if (allLines.length > 0) {
      allLines.push({ num: '', text: '', file: '', isSeparator: true });
      allLines.push({ num: '', text: `// ===== ${file} =====`, file: '', isHeader: true });
      allLines.push({ num: '', text: '', file: '', isSeparator: true });
    } else {
      allLines.push({ num: '', text: `// ===== ${file} =====`, file: '', isHeader: true });
      allLines.push({ num: '', text: '', file: '', isSeparator: true });
    }
    for (const line of lines) {
      allLines.push(line);
      if (allLines.length >= maxLines) break;
    }
    if (allLines.length >= maxLines) break;
  }
  return allLines.slice(0, maxLines);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateHtml(lines, startPage, totalPages) {
  let html = '';
  let pageNum = startPage;
  let lineCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lineCount === 0) {
      html += `<div class="page">\n`;
      html += `  <div class="header">${SOFTWARE_NAME} ${VERSION} &nbsp;&nbsp; 第 ${pageNum} 页 / 共 ${totalPages} 页</div>\n`;
      html += `  <div class="code">\n`;
    }

    const line = lines[i];
    const lineClass = line.isHeader ? 'line header-line' : line.isSeparator ? 'line sep-line' : 'line';
    const numStr = line.num ? String(line.num).padStart(4, ' ') : '    ';
    html += `    <div class="${lineClass}"><span class="lineno">${numStr}</span><span class="codetext">${escapeHtml(line.text) || '&nbsp;'}</span></div>\n`;
    lineCount++;

    if (lineCount >= LINES_PER_PAGE || i === lines.length - 1) {
      // 填充空行到50行
      while (lineCount < LINES_PER_PAGE) {
        html += `    <div class="line"><span class="lineno">    </span><span class="codetext">&nbsp;</span></div>\n`;
        lineCount++;
      }
      html += `  </div>\n`;
      html += `</div>\n`;
      pageNum++;
      lineCount = 0;
    }
  }

  return html;
}

// 主流程
const frontMaxLines = FRONT_PAGES * LINES_PER_PAGE;
const backMaxLines = BACK_PAGES * LINES_PER_PAGE;

console.log('收集前30页代码...');
const frontLines = collectLines(frontFiles, frontMaxLines);
console.log(`前30页: ${frontLines.length} 行`);

console.log('收集后30页代码...');
const backLines = collectLines(backFiles, backMaxLines);
console.log(`后30页: ${backLines.length} 行`);

const totalPages = FRONT_PAGES + BACK_PAGES;
const frontHtml = generateHtml(frontLines, 1, totalPages);
const backHtml = generateHtml(backLines, FRONT_PAGES + 1, totalPages);

const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${SOFTWARE_NAME} ${VERSION} - 源程序代码</title>
<style>
  @page {
    size: A4;
    margin: 15mm 10mm 15mm 10mm;
  }
  body {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 9pt;
    line-height: 1.3;
    margin: 0;
    padding: 0;
  }
  .page {
    page-break-after: always;
    page-break-inside: avoid;
  }
  .page:last-child {
    page-break-after: auto;
  }
  .header {
    text-align: center;
    font-size: 9pt;
    font-weight: bold;
    border-bottom: 1px solid #333;
    padding-bottom: 3px;
    margin-bottom: 5px;
    font-family: 'SimSun', '宋体', serif;
  }
  .code {
    white-space: pre-wrap;
    word-break: break-all;
  }
  .line {
    display: flex;
    min-height: 1.3em;
  }
  .lineno {
    display: inline-block;
    width: 35px;
    text-align: right;
    color: #999;
    margin-right: 8px;
    flex-shrink: 0;
    user-select: none;
  }
  .codetext {
    flex: 1;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .header-line .codetext {
    color: #0066cc;
    font-weight: bold;
  }
  .sep-line {
    color: #ccc;
  }
</style>
</head>
<body>
${frontHtml}
${backHtml}
</body>
</html>`;

const outputPath = path.join(PROJECT_ROOT, '软著申请材料', '源程序代码.html');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, fullHtml, 'utf8');
console.log(`\n源程序代码已生成: ${outputPath}`);
console.log(`总页数: ${totalPages}`);
console.log(`总行数: ${frontLines.length + backLines.length}`);
