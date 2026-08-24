const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = 'H:\\Muse Code复刻';
const SOFTWARE_NAME = '飞虹 Code 终端 AI 编程智能体软件';
const VERSION = 'V1.0.0';
const LINES_PER_PAGE = 24;
const CHARS_PER_LINE = 32;
const TOTAL_PAGES = 60;

const content = require(path.join(PROJECT_ROOT, '软著申请材料', 'manual-content.cjs'));

// 将内容项展开为行
const lines = [];
for (const item of content) {
  if (item.type === 'title') {
    lines.push({ type: 'title', text: item.text });
    lines.push({ type: 'blank', text: '' });
  } else if (item.type === 'subtitle') {
    lines.push({ type: 'subtitle', text: item.text });
    lines.push({ type: 'blank', text: '' });
  } else if (item.type === 'h1') {
    lines.push({ type: 'h1', text: item.text });
  } else if (item.type === 'h2') {
    lines.push({ type: 'h2', text: item.text });
  } else if (item.type === 'p') {
    // 将长段落按标点拆分为多行（每行约40字）
    const text = item.text;
    let current = '';
    for (let i = 0; i < text.length; i++) {
      current += text[i];
      if (current.length >= CHARS_PER_LINE && (text[i] === '，' || text[i] === '。' || text[i] === '；' || text[i] === '：' || text[i] === '、' || i === text.length - 1)) {
        lines.push({ type: 'p', text: current });
        current = '';
      }
    }
    if (current) lines.push({ type: 'p', text: current });
    lines.push({ type: 'blank', text: '' });
  }
}

// 分页生成HTML
let html = '';
let pageNum = 1;
let lineCount = 0;

for (let i = 0; i < lines.length; i++) {
  if (lineCount === 0) {
    html += `<div class="page">\n`;
    html += `  <div class="header">${SOFTWARE_NAME} ${VERSION} 用户使用手册 &nbsp;&nbsp; 第 ${pageNum} 页 / 共 ${TOTAL_PAGES} 页</div>\n`;
    html += `  <div class="content">\n`;
  }

  const item = lines[i];
  if (item.type === 'title') {
    html += `    <div class="title">${item.text}</div>\n`;
    lineCount += 2;
  } else if (item.type === 'subtitle') {
    html += `    <div class="subtitle">${item.text}</div>\n`;
    lineCount += 1;
  } else if (item.type === 'h1') {
    html += `    <div class="h1">${item.text}</div>\n`;
    lineCount += 2;
  } else if (item.type === 'h2') {
    html += `    <div class="h2">${item.text}</div>\n`;
    lineCount += 1;
  } else if (item.type === 'p') {
    html += `    <div class="p">${item.text}</div>\n`;
    lineCount += 1;
  } else if (item.type === 'blank') {
    html += `    <div class="blank">&nbsp;</div>\n`;
    lineCount += 1;
  }

  if (lineCount >= LINES_PER_PAGE || i === lines.length - 1) {
    while (lineCount < LINES_PER_PAGE) {
      html += `    <div class="blank">&nbsp;</div>\n`;
      lineCount++;
    }
    html += `  </div>\n`;
    html += `</div>\n`;
    pageNum++;
    lineCount = 0;
  }
}

const actualPages = pageNum - 1;
// 如果实际页数不足60页，补充空白页
while (pageNum <= TOTAL_PAGES) {
  html += `<div class="page">\n`;
  html += `  <div class="header">${SOFTWARE_NAME} ${VERSION} 用户使用手册 &nbsp;&nbsp; 第 ${pageNum} 页 / 共 ${TOTAL_PAGES} 页</div>\n`;
  html += `  <div class="content">\n`;
  for (let j = 0; j < LINES_PER_PAGE; j++) {
    html += `    <div class="blank">&nbsp;</div>\n`;
  }
  html += `  </div>\n`;
  html += `</div>\n`;
  pageNum++;
}

const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${SOFTWARE_NAME} ${VERSION} - 用户使用手册</title>
<style>
@page { size: A4; margin: 20mm 15mm 20mm 15mm; }
body { font-family: 'SimSun','宋体',serif; font-size: 12pt; line-height: 1.8; margin: 0; padding: 0; }
.page { page-break-after: always; page-break-inside: avoid; }
.page:last-child { page-break-after: auto; }
.header { text-align: center; font-size: 9pt; font-weight: bold; border-bottom: 1px solid #333; padding-bottom: 4px; margin-bottom: 8px; }
.content { text-align: justify; }
.title { font-size: 20pt; font-weight: bold; text-align: center; margin: 30px 0 10px 0; }
.subtitle { font-size: 11pt; text-align: center; margin: 5px 0; color: #333; }
.h1 { font-size: 16pt; font-weight: bold; text-align: center; margin: 20px 0 15px 0; color: #1a1a1a; }
.h2 { font-size: 12pt; font-weight: bold; margin: 12px 0 6px 0; color: #2a2a2a; border-left: 3px solid #333; padding-left: 8px; }
.p { text-indent: 2em; margin: 0; line-height: 1.6; }
.blank { height: 1em; }
</style>
</head>
<body>
${html}
</body>
</html>`;

const outputPath = path.join(PROJECT_ROOT, '软著申请材料', '用户使用手册.html');
fs.writeFileSync(outputPath, fullHtml, 'utf8');

console.log(`用户使用手册已生成: ${outputPath}`);
console.log(`内容页数: ${actualPages}`);
console.log(`总页数(含补充): ${TOTAL_PAGES}`);
console.log(`内容行数: ${lines.length}`);
