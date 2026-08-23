/**
 * 前端分模块脚本：将单文件 index.html 拆分为 index.html + css/style.css + js/app.js
 * 用法: node scripts/split-frontend.cjs <src-dir>
 */
const fs = require('fs');
const path = require('path');

const srcDir = process.argv[2] || path.join(__dirname, '..', 'src', 'web', 'public');
const indexPath = path.join(srcDir, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error('index.html not found:', indexPath);
  process.exit(1);
}

let html = fs.readFileSync(indexPath, 'utf8');

// 1. 提取 <style>...</style>
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) {
  console.error('No <style> block found');
  process.exit(1);
}
const cssContent = styleMatch[1].trim() + '\n';

// 2. 提取 <script>...</script>（最后一个 script 块，即主应用代码）
const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scriptMatches.length === 0) {
  console.error('No <script> block found');
  process.exit(1);
}
// 取最后一个 script（主应用代码）
const mainScript = scriptMatches[scriptMatches.length - 1];
const jsContent = mainScript[1].trim() + '\n';

// 3. 写入 css/style.css
const cssDir = path.join(srcDir, 'css');
if (!fs.existsSync(cssDir)) fs.mkdirSync(cssDir, { recursive: true });
fs.writeFileSync(path.join(cssDir, 'style.css'), cssContent, 'utf8');
console.log('✓ css/style.css written (' + cssContent.length + ' bytes)');

// 4. 写入 js/app.js
const jsDir = path.join(srcDir, 'js');
if (!fs.existsSync(jsDir)) fs.mkdirSync(jsDir, { recursive: true });
fs.writeFileSync(path.join(jsDir, 'app.js'), jsContent, 'utf8');
console.log('✓ js/app.js written (' + jsContent.length + ' bytes)');

// 5. 更新 index.html：替换 style 块为 link 引用
html = html.replace(
  /<style>[\s\S]*?<\/style>/,
  '  <link rel="stylesheet" href="css/style.css">'
);

// 6. 更新 index.html：替换最后一个 script 块为外部引用
// 先找到最后一个 script 的位置
const lastScriptStart = html.lastIndexOf('<script>');
const lastScriptEnd = html.indexOf('</script>', lastScriptStart) + '</script>'.length;
if (lastScriptStart === -1) {
  console.error('Could not find last <script> for replacement');
  process.exit(1);
}
html = html.substring(0, lastScriptStart) +
  '  <script src="js/app.js"></script>' +
  html.substring(lastScriptEnd);

// 7. 写入更新后的 index.html
fs.writeFileSync(indexPath, html, 'utf8');
console.log('✓ index.html updated (' + html.length + ' bytes)');
console.log('\n拆分完成！');
