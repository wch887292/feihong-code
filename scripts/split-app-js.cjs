/**
 * 将 app.js 拆分为 utils.js / api.js / ui.js / app.js
 * 按函数名分类，用括号计数精确提取函数体
 */
const fs = require('fs');
const path = require('path');

const jsDir = path.join(__dirname, '..', 'src', 'web', 'public', 'js');
const appPath = path.join(jsDir, 'app.js');
let src = fs.readFileSync(appPath, 'utf8');
const lines = src.split('\n');

// 分类定义
const CATEGORIES = {
  utils: [
    'escapeHtml', 'fmtTime', 'toast', 'openModal', 'closeModal',
    'renderMarkdown', 'formatToolArgs', 'formatSize', 'estimateDataUrlSize',
    'linkifyArtifacts', 'extractUrl', 'getDirectoryName', 'statusBadge',
    'formatMarkdown', 't', 'applyI18nToEl',
  ],
  api: [
    'authHeaders', 'api', 'loadTasks', 'loadModels', 'saveModel', 'deleteModel',
    'setDefaultModel', 'loadWorkspace', 'loadWorkspaceTree', 'loadAutomations',
    'runAuto', 'delAuto', 'loadTemplates', 'loadMarket', 'installSkill',
    'loadInstalled', 'loadOffice', 'loadMemoryStats', 'loadMemoryContent',
    'loadLongTermMemory', 'loadSummaryHistory', 'doLogin', 'rsaEncryptText',
    'getDrivesList',
  ],
  ui: [
    'renderSidebarTaskList', 'renderTaskDetail', 'renderThinkingProcess',
    'renderTaskHeader', 'renderTaskThread', 'renderStepHtml', 'showArtifacts',
    'switchRightTab', 'showPreview', 'renderStagedFiles', 'renderModelSelect',
    'renderModelList', 'renderModelListInline', 'renderAutoGrid', 'renderBuiltin',
    'renderUserTpl', 'renderMarketGrid', 'renderWorkspaceBar', 'showWelcomeGuide',
    'showWelcomeModal', 'updateUserBar', 'switchView', 'toggleThinking', 'toggleArgs',
    'toggleDirectMode', 'openAgentSelector', 'openPermissions', 'openSettings',
    'toggleModelManage', 'openModels', 'tplCard', 'bindTplCards', 'bindArtifacts',
    'previewFile', 'previewImage', 'initMemoryUI', 'resetModelForm', 'editModel',
    'resetInlineForm', 'fillInlineForm', 'persistSessionConfig',
  ],
};

// 所有要提取的函数名
const allExtractNames = new Set([...CATEGORIES.utils, ...CATEGORIES.api, ...CATEGORIES.ui]);

/**
 * 找到函数定义的起始行和结束行（括号计数）
 */
function findFunctionRange(lines, funcName) {
  // 匹配: function name( 或 async function name(
  const startPattern = new RegExp(`^\\s*(async\\s+)?function\\s+${funcName}\\s*\\(`);
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startPattern.test(lines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  // 从起始行开始括号计数，找到函数结束
  let braceCount = 0;
  let inFunction = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') { braceCount++; inFunction = true; }
      else if (ch === '}') { braceCount--; }
    }
    if (inFunction && braceCount === 0) {
      return { start: startIdx, end: i };
    }
  }
  return null;
}

// 收集所有要提取的函数范围
const extractions = [];
for (const [category, names] of Object.entries(CATEGORIES)) {
  for (const name of names) {
    const range = findFunctionRange(lines, name);
    if (range) {
      extractions.push({ name, category, ...range });
    } else {
      console.log(`  ⚠ 未找到函数: ${name} (${category})`);
    }
  }
}

// 按起始行排序，从后往前删除（避免行号偏移）
extractions.sort((a, b) => b.start - a.start);

// 按分类收集函数代码
const categoryCode = { utils: [], api: [], ui: [] };
const removedRanges = [];

for (const ext of extractions) {
  const funcCode = lines.slice(ext.start, ext.end + 1).join('\n');
  categoryCode[ext.category].push(funcCode);
  removedRanges.push({ start: ext.start, end: ext.end });
}

// 从源码中移除已提取的函数（从后往前）
let newLines = [...lines];
for (const range of removedRanges) {
  newLines.splice(range.start, range.end - range.start + 1);
}

// 写入各模块文件
const headers = {
  utils: '/**\n * 工具函数模块：纯函数，无状态依赖，可被任意模块调用\n */\n',
  api: '/**\n * API 模块：HTTP 请求与数据获取，依赖 utils\n */\n',
  ui: '/**\n * UI 渲染模块：DOM 渲染与交互，依赖 utils 和 api\n */\n',
};

for (const [category, code] of Object.entries(categoryCode)) {
  if (code.length > 0) {
    const filePath = path.join(jsDir, `${category}.js`);
    const content = headers[category] + '\n' + code.join('\n\n') + '\n';
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ ${category}.js (${code.length} 个函数, ${content.length} bytes)`);
  }
}

// 写入更新后的 app.js
fs.writeFileSync(appPath, newLines.join('\n'), 'utf8');
console.log(`✓ app.js (剩余 ${newLines.length} 行)`);

// 更新 index.html 中的 script 引用顺序
const indexPath = path.join(jsDir, '..', 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');
const oldScript = '<script src="js/app.js"></script>';
const newScripts = '  <script src="js/utils.js"></script>\n  <script src="js/api.js"></script>\n  <script src="js/ui.js"></script>\n  <script src="js/app.js"></script>';
if (indexHtml.includes(oldScript)) {
  indexHtml = indexHtml.replace(oldScript, newScripts);
  fs.writeFileSync(indexPath, indexHtml, 'utf8');
  console.log('✓ index.html script 引用已更新（utils→api→ui→app）');
} else {
  console.log('⚠ index.html 中未找到 app.js 引用');
}

console.log('\n拆分完成！');
