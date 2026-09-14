/* ============================================================
 * 飞虹 Code 移动版 v7.6.4
 * 主聊天页 + 左侧导航 + 右侧设置抽屉 + 技能中心 + 小游戏创作 + 附件栏 + 流式对话
 * ============================================================ */

/* ========== 配置与状态 ========== */
var LS_MODELS = 'fh.app.models';
var LS_DEFAULT = 'fh.app.defaultModel';
var LS_TASKS = 'fh.app.tasks';
var LS_THEME = 'fh.app.theme';

var state = {
  models: [],
  defaultModelId: '',
  tasks: [],
  currentTaskId: null,
  currentFunc: 'chat',
  streaming: false,
  abortController: null,
  snMenu: 'conv',
};

/* 插件配置（功能按钮用到） */
var PLUGINS = {
  translate: { title: '中英互译', prompt: '请将以下文本翻译为中文（如果是中文则翻译为英文），保持原意和格式：\n\n{code}' },
};

/* API 提供商预设（接口补全功能） */
var PROVIDER_PRESETS = {
  agnes: {
    name: 'Agnes AI',
    apiBase: 'https://api.agnes-ai.cn/v1',
    models: [
      { id: 'agnes-2.5-flash', name: 'Agnes-2.5-Flash（推荐）' },
    ]
  },
  siliconflow: {
    name: '硅基流动 SiliconFlow',
    apiBase: 'https://api.siliconflow.cn/v1',
    models: [
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5-72B（推荐·极速）' },
      { id: 'Qwen/Qwen2.5-7B-Instruct', name: 'Qwen2.5-7B（轻量·更快）' },
      { id: 'deepseek-ai/DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash（深度思考）' },
      { id: 'deepseek-ai/DeepSeek-V4', name: 'DeepSeek-V4（强大）' },
    ]
  },
  deepseek: {
    name: 'DeepSeek 官方',
    apiBase: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek-Chat' },
      { id: 'deepseek-reasoner', name: 'DeepSeek-Reasoner' },
    ]
  },
  openai: {
    name: 'OpenAI 官方',
    apiBase: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o-mini' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5-Turbo' },
    ]
  },
  qwen: {
    name: '通义千问 Qwen',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen-plus', name: 'Qwen-Plus' },
      { id: 'qwen-turbo', name: 'Qwen-Turbo' },
      { id: 'qwen-max', name: 'Qwen-Max' },
    ]
  },
  zhipu: {
    name: '智谱 AI GLM',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-4-plus', name: 'GLM-4-Plus' },
      { id: 'glm-4-flash', name: 'GLM-4-Flash' },
      { id: 'glm-4-air', name: 'GLM-4-Air' },
    ]
  },
  moonshot: {
    name: '月之暗面 Kimi',
    apiBase: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'moonshot-v1-8k', name: 'Kimi-V1-8K' },
      { id: 'moonshot-v1-32k', name: 'Kimi-V1-32K' },
      { id: 'moonshot-v1-128k', name: 'Kimi-V1-128K' },
    ]
  },
  doubao: {
    name: '豆包 Doubao',
    apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      { id: 'doubao-pro-4k', name: 'Doubao-Pro-4K' },
      { id: 'doubao-pro-32k', name: 'Doubao-Pro-32K' },
      { id: 'doubao-lite-4k', name: 'Doubao-Lite-4K' },
    ]
  },
  ollama: {
    name: 'Ollama 本地',
    apiBase: 'http://localhost:11434/v1',
    models: [
      { id: 'llama3', name: 'Llama-3' },
      { id: 'qwen2.5', name: 'Qwen2.5' },
      { id: 'deepseek-r1', name: 'DeepSeek-R1' },
    ]
  },
};

/* 功能类型图标 */
var TYPE_ICON = { chat: '💬', 'fix-code': '🔧', 'write-code': '✍️', plugin: '🔌' };

/* ========== 基础工具 ========== */
function $(id) { return document.getElementById(id); }
function toast(msg) {
  var el = $('toast'); if (!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove('show'); }, 2200);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmtTime(iso) {
  try { return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return iso || ''; }
}
function genId() { return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6); }
function showSheet(id) { $(id).classList.add('show'); }
function hideSheet(id) { $(id).classList.remove('show'); }

/* ========== 左侧导航 ========== */
function openSidenav() {
  $('sidenav').classList.add('show');
  $('sidenavMask').classList.add('show');
  renderDocList();
}
function closeSidenav() {
  $('sidenav').classList.remove('show');
  $('sidenavMask').classList.remove('show');
}
function setSnMenu(menu) {
  state.snMenu = menu;
  document.querySelectorAll('.sn-menu-item').forEach(function (el) {
    el.classList.toggle('active', el.dataset.menu === menu);
  });
  if (menu === 'conv') { newChat(); closeSidenav(); }
  else if (menu === 'tasks') { switchPage('taskPage'); closeSidenav(); renderTaskList(); }
  else if (menu === 'skills') { closeSidenav(); showSheet('skillCenterSheet'); }
  else if (menu === 'cloud') { toast('云盘 · 开发中'); }
}

/* ========== 右侧设置抽屉 ========== */
function openDrawer() {
  $('drawer').classList.add('show');
  $('drawerMask').classList.add('show');
  renderModelList();
  fillVLForm();
  fillCreativeForm();
  renderKeylessStatus();
  // Hermes Agent 面板初始渲染
  try {
    if (typeof renderHermesMemory === 'function') renderHermesMemory();
    if (typeof renderHermesSkills === 'function') renderHermesSkills();
    if (typeof renderHermesSchedule === 'function') renderHermesSchedule();
  } catch (e) {}
}
function closeDrawer() {
  $('drawer').classList.remove('show');
  $('drawerMask').classList.remove('show');
}

/* ========== 本地存储 ========== */
/* ========== 预置推荐渠道（已取消内置模型，用户自行配置） ========== */
var BUILTIN_MODELS = [];
var AGNES_MODEL = {
  id: 'agnes_2_5_flash',
  modelId: 'agnes-2.5-flash',
  name: 'Agnes-2.5-Flash',
  apiBase: 'https://api.agnes-ai.cn/v1',
  apiKey: '',
  reasoning: ''
};
var LS_MIGRATED = 'fh.app.migrated.v3';

function loadModels() {
  try { state.models = JSON.parse(localStorage.getItem(LS_MODELS) || '[]'); }
  catch (e) { state.models = []; }
  // 兼容旧格式：旧模型对象的 id 字段同时是唯一标识和接口调用名
  // 新格式：id 是唯一标识，modelId 是接口调用名
  state.models = state.models.map(function (m) {
    if (!m.modelId) m.modelId = m.id;
    return m;
  });
  state.defaultModelId = localStorage.getItem(LS_DEFAULT) || '';
  // 首次使用：自动添加 Agnes 模型作为默认，保证开箱即用
  if (!localStorage.getItem(LS_MIGRATED) && !state.models.length) {
    state.models = [JSON.parse(JSON.stringify(AGNES_MODEL))];
    state.defaultModelId = state.models[0].id;
    try {
      localStorage.setItem(LS_MODELS, JSON.stringify(state.models));
      localStorage.setItem(LS_DEFAULT, state.defaultModelId);
      localStorage.setItem(LS_MIGRATED, '1');
    } catch (e) {}
  }
  if (!state.defaultModelId && state.models.length) state.defaultModelId = state.models[0].id;
}
function saveModels() {
  localStorage.setItem(LS_MODELS, JSON.stringify(state.models));
  if (state.defaultModelId) localStorage.setItem(LS_DEFAULT, state.defaultModelId);
}
function loadTasks() {
  try { state.tasks = JSON.parse(localStorage.getItem(LS_TASKS) || '[]'); }
  catch (e) { state.tasks = []; }
}
function saveTasks() {
  try { localStorage.setItem(LS_TASKS, JSON.stringify(state.tasks)); }
  catch (e) { toast('存储已满，请清理旧任务'); }
}
function getDefaultModel() {
  return state.models.find(function (m) { return m.id === state.defaultModelId; }) || state.models[0] || null;
}

/* ========== 大模型 API 调用（流式 SSE） ========== */
/* 生成对用户友好的错误提示 */
function friendlyError(err) {
  var msg = err && err.message ? String(err.message) : '未知错误';
  if (/503|model_not_found|无可用渠道|distributor/i.test(msg)) {
    return '模型渠道不可用（HTTP 503）：当前配置的模型 ' + (getDefaultModel() ? getDefaultModel().name : '') + ' 在服务商处无可用渠道。\n请到「⚙ 设置 → 大模型」切换为「DeepSeek-V4-Flash（推荐）」或检查你的 API 配置。';
  }
  if (/401|invalid.*api|unauthorized/i.test(msg)) return 'API Key 无效或已过期，请到「⚙ 设置 → 大模型」检查 API Key。';
  if (/429|rate.?limit/i.test(msg)) return '请求过于频繁（429），请稍等片刻再试。';
  if (/network|fetch|failed to fetch|timeout/i.test(msg)) return '网络连接失败，请检查网络后重试。';
  return msg;
}

function callModelStream(messages, onDelta, onDone, onError) {
  var model = getDefaultModel();
  // 免密模式：未配置模型或 API Key 时，自动启用 Keyless Web Tier（环形轮转池）
  if (!model || !model.apiKey) {
    console.log('[App] 未配置模型，启用免密网络层');
    keylessChat(messages, onDelta, onDone, function (err) {
      onError(new Error('免密网络层暂不可用：' + err.message + '。可在「设置 → 大模型」配置自定义模型。'));
    });
    return;
  }
  if (!model.apiBase) { onError(new Error('模型 ' + model.name + ' 未配置 API 地址')); return; }

  // 上下文窗口管理：自动截断过长历史，保留最近对话
  messages = trimContext(messages);

  var url = (model.apiBase || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/chat/completions';
  var modelId = model.modelId || model.id;
  var apiKey = model.apiKey;

  // ===== 稳定性参数：自动重试 + 长回答自动续写 =====
  var RETRY_MAX = 2;      // 失败自动重试次数（网络/超时/5xx/429）
  var CONTINUE_MAX = 2;   // finish_reason=length 自动续写次数
  var retried = 0, continued = 0;
  var totalContent = '';  // 跨重试/续写累计的完整内容
  var cancelled = false;  // 用户主动停止标记
  var currentXhr = null;
  var streamFallbackTimer = null;

  state.streaming = true;
  state.abortController = {
    aborted: false,
    abort: function () { cancelled = true; this.aborted = true; try { currentXhr && currentXhr.abort(); } catch (e) {} }
  };

  function isRetryable(msg, status) {
    if (cancelled) return false;
    if (status === 429 || (status >= 500 && status <= 599)) return true;
    return /network|fetch|failed|timeout|超时|网络|ECONN|空内容|解析失败|no internet|unreachable/i.test(msg || '');
  }

  function attempt(curMessages) {
    if (cancelled) return;
    var body = JSON.stringify({ model: modelId, messages: curMessages, stream: true, temperature: 0.7 });
    var xhr = new XMLHttpRequest();
    currentXhr = xhr;
    var fullContent = '';
    var lastPos = 0;
    var done = false;
    var hasProgress = false;
    var finishReason = '';
    if (streamFallbackTimer) clearTimeout(streamFallbackTimer);

    function finish(content) {
      if (done || cancelled) return;
      done = true;
      state.streaming = false;
      if (streamFallbackTimer) clearTimeout(streamFallbackTimer);
      if (content) { onDone(content); }
      else { onError(new Error('模型返回空内容，请重试或更换模型')); }
    }

    function fail(err, status) {
      if (done || cancelled) return;
      done = true;
      state.streaming = false;
      if (streamFallbackTimer) clearTimeout(streamFallbackTimer);
      if (retried < RETRY_MAX && isRetryable(err && err.message, status)) {
        retried++;
        state.streaming = true;
        onDelta('\n\n> ⚠️ 网络波动，正在自动重连…（' + retried + '/' + RETRY_MAX + '）\n\n');
        setTimeout(function () { attempt(curMessages); }, 1500 * retried);
        return;
      }
      onError(err);
    }

    // 流式回退保护：15秒内完全没有 onprogress 数据，自动切换非流式
    streamFallbackTimer = setTimeout(function () {
      if (done || cancelled || state.abortController.aborted) return;
      if (!hasProgress) {
        try { xhr.abort(); } catch (e) {}
        done = true;
        state.streaming = true;
        callModelNonStream(curMessages, onDelta, function (full) {
          if (cancelled) return;
          totalContent += full;
          finish(totalContent);
        }, function (err) { fail(err); });
      }
    }, 15000);

    function parseSSE(text) {
      var lines = text.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line.indexOf('data:') !== 0) continue;
        var data = line.slice(5).trim();
        if (data === '[DONE]') { if (!finishReason) finishReason = 'stop'; continue; }
        try {
          var json = JSON.parse(data);
          var choice = json.choices && json.choices[0];
          if (choice) {
            if (choice.finish_reason) finishReason = choice.finish_reason;
            var delta = choice.delta;
            if (delta && delta.content && delta.content !== '') {
              fullContent += delta.content;
              onDelta(delta.content);
            }
          }
        } catch (e) { /* 忽略解析错误 */ }
      }
    }

    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);

    xhr.onprogress = function () {
      if (cancelled || done) return;
      hasProgress = true;
      var text = xhr.responseText || '';
      if (text.length > lastPos) {
        parseSSE(text.slice(lastPos));
        lastPos = text.length;
      }
    };

    xhr.onload = function () {
      if (done || cancelled) return;
      if (xhr.status !== 200) {
        fail(new Error('HTTP ' + xhr.status + ': ' + (xhr.responseText || xhr.statusText).slice(0, 200)), xhr.status);
        return;
      }
      var text = xhr.responseText || '';
      if (text.length > lastPos) parseSSE(text.slice(lastPos));
      // 长回答截断（finish_reason=length）：自动续写，最多 CONTINUE_MAX 次
      if (finishReason === 'length' && fullContent && continued < CONTINUE_MAX) {
        continued++;
        totalContent += fullContent;
        onDelta('\n\n> ⏩ 回答较长已自动续写…（' + continued + '/' + CONTINUE_MAX + '）\n\n');
        var next = curMessages.concat([
          { role: 'assistant', content: fullContent },
          { role: 'user', content: '请从刚才中断处继续输出，不要重复已写内容。' }
        ]);
        attempt(next);
        return;
      }
      totalContent += fullContent;
      finish(totalContent);
    };

    xhr.onerror = function () {
      if (done || cancelled) return;
      fail(new Error('网络连接失败，请检查网络后重试'), 0);
    };

    xhr.onabort = function () {
      if (done) return;
      // 用户主动停止：返回已有内容
      if (cancelled) {
        totalContent += fullContent;
        finish(totalContent);
      }
    };

    xhr.ontimeout = function () {
      if (done || cancelled) return;
      fail(new Error('请求超时，请检查网络后重试'), 0);
    };

    xhr.send(body);
  }

  attempt(messages);
}

/* 非流式请求（流式失败时的回退） */
function callModelNonStream(messages, onDelta, onDone, onError) {
  var model = getDefaultModel();
  if (!model) { onError(new Error('请先配置大模型')); return; }
  var url = (model.apiBase || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/chat/completions';
  var modelId = model.modelId || model.id;
  var body = JSON.stringify({ model: modelId, messages: messages, stream: false, temperature: 0.7, max_tokens: 4000 });

  var xhr = new XMLHttpRequest();
  var done = false;
  state.abortController = {
    aborted: false,
    abort: function () { this.aborted = true; try { xhr.abort(); } catch (e) {} }
  };

  xhr.open('POST', url, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer ' + model.apiKey);
  xhr.timeout = 120000;

  xhr.onload = function () {
    if (done) return;
    done = true;
    state.streaming = false;
    if (xhr.status !== 200) {
      onError(new Error('HTTP ' + xhr.status + ': ' + (xhr.responseText || '').slice(0, 200)));
      return;
    }
    try {
      var data = JSON.parse(xhr.responseText);
      var content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
      if (content) {
        // 模拟逐字输出效果（快速）
        var i = 0;
        var timer = setInterval(function () {
          if (state.abortController.aborted) { clearInterval(timer); onDone(content.slice(0, i)); return; }
          var chunk = content.slice(i, i + 20);
          i += 20;
          onDelta(chunk);
          if (i >= content.length) { clearInterval(timer); onDone(content); }
        }, 10);
      } else {
        onError(new Error('模型返回空内容'));
      }
    } catch (e) {
      onError(new Error('响应解析失败：' + e.message));
    }
  };
  xhr.onerror = function () { if (!done) { done = true; state.streaming = false; onError(new Error('网络连接失败')); } };
  xhr.ontimeout = function () { if (!done) { done = true; state.streaming = false; onError(new Error('请求超时（120秒）')); } };
  xhr.onabort = function () { if (!done) { done = true; state.streaming = false; onDone(''); } };
  xhr.send(body);
}

/* 上下文窗口管理：自动截断过长历史 */
function trimContext(messages) {
  if (!messages || messages.length <= 12) return messages;
  // 保留最近 10 条对话（5轮），超过则截断
  var keep = 10;
  var trimmed = messages.slice(-keep);
  // 在开头添加系统提示说明上下文已截断
  trimmed.unshift({ role: 'system', content: '（注意：由于对话较长，早期上下文已被自动截断，仅保留最近的对话记录。）' });
  return trimmed;
}
function stopStreaming() {
  if (state.abortController) { try { state.abortController.abort(); } catch (e) {} }
  state.streaming = false;
}

/* ========== Markdown 渲染 ========== */
function renderMarkdown(text) {
  var html = esc(text == null ? '' : text);
  var codeBlocks = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
    var idx = codeBlocks.length;
    codeBlocks.push('<pre class="md-code"><code>' + code + '</code><button class="md-copy" onclick="copyCode(this)">复制</button></pre>');
    return '\x00CB' + idx + '\x00';
  });
  html = html.replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  html = html.replace(/^### (.*)$/gm, '<div class="md-h3">$1</div>');
  html = html.replace(/^## (.*)$/gm, '<div class="md-h2">$1</div>');
  html = html.replace(/^# (.*)$/gm, '<div class="md-h1">$1</div>');
  html = html.replace(/^[-*] (.*)$/gm, '<div class="md-li">• $1</div>');
  html = html.replace(/^(\d+)\. (.*)$/gm, '<div class="md-li">$1. $2</div>');
  html = html.replace(/(https?:\/\/[^\s<>"'()]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/\x00CB(\d+)\x00/g, function (_, idx) { return codeBlocks[parseInt(idx)]; });
  return html;
}
function copyCode(btn) {
  var code = btn.previousElementSibling;
  var text = code ? code.textContent : '';
  navigator.clipboard.writeText(text).then(function () {
    btn.textContent = '已复制';
    setTimeout(function () { btn.textContent = '复制'; }, 1500);
  }).catch(function () { toast('复制失败'); });
}

/* ========== 页面切换 ========== */
function switchPage(name) {
  document.querySelectorAll('.page').forEach(function (p) { p.classList.toggle('active', p.id === name); });
  if (name === 'taskPage') renderTaskList();
}

/* ========== 功能按钮切换 ========== */
function setFunc(func) {
  state.currentFunc = func;
  document.querySelectorAll('.q-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.func === func);
  });
  var tip = { chat: '💬 对话模式', game: '🎮 游戏中心', create: '🎨 AI 创作', flashapp: '✨ 闪应用', translate: '🌐 中英互译' };
  $('toolTip').textContent = tip[func] || '💬 对话模式';
  if (func === 'chat') {
    $('goalInput').focus();
  } else if (func === 'game') {
    openGameCreator();
  } else if (func === 'create') {
    openCreateCenter();
  } else if (func === 'flashapp') {
    openFlashApp();
  } else if (PLUGINS[func]) {
    openPlugin(func);
  }
}

/* ========== 任务管理 ========== */
function statusBadge(s) {
  var map = { queued: '排队中', running: '执行中', done: '已完成', failed: '失败' };
  return '<span class="badge ' + s + '">' + (map[s] || s) + '</span>';
}
function createTask(goal, type) {
  var task = { id: genId(), goal: goal, type: type || 'chat', status: 'queued', createdAt: new Date().toISOString(), messages: [] };
  state.tasks.unshift(task);
  saveTasks();
  return task;
}
function deleteTask(id) {
  if (!confirm('确定删除该任务？')) return;
  state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
  if (state.currentTaskId === id) { state.currentTaskId = null; renderThread(null); }
  saveTasks();
  renderTaskList();
  renderDocList();
  toast('已删除');
}
function clearAllTasks() {
  if (!confirm('确定清空所有任务？此操作不可恢复。')) return;
  state.tasks = [];
  state.currentTaskId = null;
  saveTasks();
  renderTaskList();
  renderDocList();
  renderThread(null);
  toast('已清空所有任务');
}
function getTask(id) { return state.tasks.find(function (t) { return t.id === id; }); }
function renderTaskList() {
  var box = $('taskList');
  if (!box) return;
  var list = state.tasks.slice(0, 100);
  if (!list.length) { box.innerHTML = '<div class="empty">暂无任务，去对话页发起一个吧</div>'; return; }
  box.innerHTML = list.map(function (t) {
    return '<div class="card task-card" data-id="' + esc(t.id) + '">' +
      '<div class="row">' +
        '<span class="task-icon">' + (TYPE_ICON[t.type] || '💬') + '</span>' +
        '<div class="li-title" style="flex:1;">' + esc(t.goal.slice(0, 40)) + (t.goal.length > 40 ? '…' : '') + '</div>' +
        statusBadge(t.status) +
      '</div>' +
      '<div class="muted" style="margin-top:6px;">' + fmtTime(t.createdAt) + ' · ' + (t.messages ? t.messages.length : 0) + ' 条消息</div>' +
      '<div class="task-ops"><button class="btn sm ghost" data-open="' + esc(t.id) + '">打开</button><button class="btn sm ghost" data-del="' + esc(t.id) + '" style="color:var(--err);">删除</button></div>' +
    '</div>';
  }).join('');
  box.querySelectorAll('[data-open]').forEach(function (b) { b.addEventListener('click', function () { openTask(b.dataset.open); }); });
  box.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { deleteTask(b.dataset.del); }); });
}
function openTask(id) {
  state.currentTaskId = id;
  switchPage('convPage');
  renderThread(getTask(id));
}

/* ========== 侧边栏会话列表（豆包式置顶文档） ========== */
function renderDocList() {
  var box = $('snDocList');
  if (!box) return;
  var kw = ($('snSearch').value || '').trim().toLowerCase();
  var list = state.tasks.filter(function (t) {
    if (!kw) return true;
    return (t.goal || '').toLowerCase().indexOf(kw) >= 0;
  }).slice(0, 50);
  if (!list.length) {
    box.innerHTML = '<div class="empty" style="padding:20px;">' + (kw ? '未找到相关会话' : '暂无历史会话<br>去对话页发起一个吧') + '</div>';
    return;
  }
  box.innerHTML = list.map(function (t) {
    var lastMsg = t.messages && t.messages.length ? t.messages[t.messages.length - 1].content : '';
    var desc = lastMsg ? lastMsg.replace(/\s+/g, ' ').slice(0, 30) : fmtTime(t.createdAt);
    return '<div class="sn-doc-item" data-id="' + esc(t.id) + '">' +
      '<span class="sn-doc-ico">' + (TYPE_ICON[t.type] || '📄') + '</span>' +
      '<div class="sn-doc-main">' +
        '<div class="sn-doc-title">' + esc(t.goal.slice(0, 20)) + (t.goal.length > 20 ? '…' : '') + '</div>' +
        '<div class="sn-doc-desc">' + esc(desc) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  box.querySelectorAll('.sn-doc-item').forEach(function (el) {
    el.addEventListener('click', function () { openTask(el.dataset.id); closeSidenav(); });
  });
}

/* ========== 对话渲染 ========== */
function renderThread(task) {
  var box = $('convMessages');
  if (!task) {
    box.innerHTML = '<div class="empty">选择下方功能，或直接输入指令开始对话<br>支持代码生成、修复、审查等</div>';
    return;
  }
  var msgs = task.messages || [];
  if (!msgs.length) { box.innerHTML = '<div class="empty">任务已创建，等待回复…</div>'; return; }
  var html = '';
  msgs.forEach(function (m) {
    if (m.role === 'user') {
      var imgHtml = m.image ? '<img src="' + m.image + '" style="max-width:200px;max-height:200px;border-radius:8px;margin-top:6px;display:block;" onclick="window.open(this.src)">' : '';
      html += '<div class="msg user">' + esc(m.content) + imgHtml + '</div>';
    }
    else if (m.role === 'assistant') html += '<div class="msg assistant">' + renderMarkdown(m.content) + '</div>';
  });
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}
function appendAssistantMessage(taskId, content) {
  var task = getTask(taskId);
  if (!task) return;
  task.messages.push({ role: 'assistant', content: content });
  task.status = 'done';
  saveTasks();
}

/* ========== 发送消息（对话） ========== */
/* ========== 电脑遥控：对话发自然语言指令 → 电脑端执行（豆包式） ========== */
/* 两种连接模式：
 * 1) 云端桥接（默认）：手机 → 腾讯云 fhcode serve → 电脑端 fhcode bridge 拉取执行 → 结果回传手机。
 *    云端地址: api.klai.top（或局域网内 http://电脑IP:18080），鉴权头 Authorization: Bearer <token>
 * 2) 直连模式：同局域网手机直接调电脑端 /api/computer/nl（地址 http://电脑IP:8081，无鉴权）
 * 配置（localStorage）：fh.pc.mode = 'cloud'|'direct'；fh.pc.cloudUrl / fh.pc.pcUrl / fh.pc.deviceId / fh.pc.token
 */
function getPcMode() {
  try { return localStorage.getItem('fh.pc.mode') || 'cloud'; } catch (e) { return 'cloud'; }
}
function setPcMode(m) { try { localStorage.setItem('fh.pc.mode', m); } catch (e) {} }
function getPcUrl() {
  try { return localStorage.getItem('fh.pc.pcUrl') || 'http://127.0.0.1:8081'; } catch (e) { return 'http://127.0.0.1:8081'; }
}
function setPcUrl(u) { try { localStorage.setItem('fh.pc.pcUrl', u); } catch (e) {} }
function getCloudUrl() {
  try { return localStorage.getItem('fh.pc.cloudUrl') || 'https://api.klai.top/fhcode'; } catch (e) { return 'https://api.klai.top/fhcode'; }
}
function setCloudUrl(u) { try { localStorage.setItem('fh.pc.cloudUrl', u); } catch (e) {} }
function getPcDeviceId() {
  try { return localStorage.getItem('fh.pc.deviceId') || 'pc-cloud-agent-01'; } catch (e) { return 'pc-cloud-agent-01'; }
}
function setPcDeviceId(id) { try { localStorage.setItem('fh.pc.deviceId', id); } catch (e) {} }
function getCloudToken() {
  // 预置云端令牌（产品内置默认执行端），用户可在设置中覆盖
  try { return localStorage.getItem('fh.pc.token') || '25dacff5349f22fe4354f8ab34d6beaf9390e119b55fe1ad'; } catch (e) { return '25dacff5349f22fe4354f8ab34d6beaf9390e119b55fe1ad'; }
}
function setCloudToken(t) { try { localStorage.setItem('fh.pc.token', t); } catch (e) {} }

/* ========== 电脑连接状态（顶栏胶囊：未连接灰 / 本地电脑绿 / 云电脑蓝） ========== */
var connState = { local: false, cloud: false, checking: false };

/* 检测本地电脑（局域网直连）：GET {pcUrl}/api/health，4s 超时 */
function testLocalConn(cb) {
  var url = getPcUrl().replace(/\/+$/, '');
  getJson(url + '/api/health', {},
    function (d) { connState.local = !!(d && d.ok !== false); cb && cb(connState.local); },
    function () { connState.local = false; cb && cb(false); }, 4000);
}

/* 检测云电脑（云端桥接）：GET {cloudUrl}/api/bridge/devices，带 token，6s 超时 */
function testCloudConn(cb) {
  var url = getCloudUrl().replace(/\/+$/, '');
  var token = getCloudToken();
  getJson(url + '/api/bridge/devices', token ? { Authorization: 'Bearer ' + token } : {},
    function (d) { connState.cloud = !!(d && d.devices && d.devices.length >= 0); cb && cb(connState.cloud); },
    function () { connState.cloud = false; cb && cb(false); }, 6000);
}

/* 同时检测两个通道，完成后刷新 UI */
function checkAllConns(cb) {
  if (connState.checking) return;
  connState.checking = true;
  var done = 0;
  function fin() { done++; if (done >= 2) { connState.checking = false; renderConnStatus(); cb && cb(); } }
  testLocalConn(fin); testCloudConn(fin);
}

/* 刷新顶栏胶囊 + 设置面板状态 */
function renderConnStatus() {
  var mode = getPcMode();
  var pill = $('connPill');
  var label = '● 未连接'; var cls = 'off';
  if (mode === 'direct' && connState.local) { label = '● 本地电脑'; cls = 'local'; }
  else if (mode === 'cloud' && connState.cloud) { label = '● 云电脑'; cls = 'cloud'; }
  else if (mode === 'direct') { label = '● 本地未连'; cls = 'off'; }
  else { label = '● 云未连接'; cls = 'off'; }
  if (pill) { pill.className = 'conn-pill ' + cls; pill.innerHTML = label; }
  var lDot = $('pcStatusDot'), cDot = $('cloudStatusDot');
  if (lDot) lDot.style.background = connState.local ? 'var(--ok)' : 'var(--ink-3)';
  if (cDot) cDot.style.background = connState.cloud ? 'var(--brand)' : 'var(--ink-3)';
}

/* 连接设置面板初始化与绑定 */
function initPcConnPanel() {
  var mode = getPcMode();
  var localInput = $('pcUrlInput'), cloudUrlInput = $('cloudUrlInput'),
    cloudTokenInput = $('cloudTokenInput'), cloudDeviceInput = $('cloudDeviceInput');
  if (localInput) localInput.value = getPcUrl();
  if (cloudUrlInput) cloudUrlInput.value = getCloudUrl();
  if (cloudTokenInput) cloudTokenInput.value = getCloudToken();
  if (cloudDeviceInput) cloudDeviceInput.value = getPcDeviceId();

  // 模式 tab 切换
  document.querySelectorAll('[data-ctab2]').forEach(function (t) {
    t.classList.toggle('active', t.dataset.ctab2 === mode);
    t.onclick = function () {
      document.querySelectorAll('[data-ctab2]').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('[id^="ctab2-"]').forEach(function (p) { p.classList.add('hidden'); });
      var panel = $('ctab2-' + t.dataset.ctab2);
      if (panel) panel.classList.remove('hidden');
    };
  });

  // 本地电脑：测试
  var pcTest = $('pcTestBtn');
  if (pcTest) pcTest.onclick = function () {
    var m = $('pcMsg'); if (!m) return;
    m.textContent = '📡 检测中…'; m.className = 'form-msg';
    testLocalConn(function (ok) {
      m.textContent = ok ? '✅ 本地电脑已连接' : '❌ 无法连接本地电脑（请确认同一 WiFi 且 fhcode 服务已启动）';
      m.className = 'form-msg ' + (ok ? 'ok' : 'err');
      renderConnStatus();
    });
  };
  // 本地电脑：保存并连接
  var pcSave = $('pcSaveBtn');
  if (pcSave) pcSave.onclick = function () {
    var u = (localInput ? localInput.value : '').trim();
    var m = $('pcMsg'); if (!m) return;
    if (!u) { m.textContent = '请填写本地电脑地址（如 http://192.168.1.8:8081）'; m.className = 'form-msg err'; return; }
    setPcUrl(u); setPcMode('direct');
    m.textContent = '已切换本地电脑，正在检测…'; m.className = 'form-msg';
    testLocalConn(function (ok) {
      m.textContent = ok ? '✅ 已连接本地电脑（顶栏变绿色）' : '❌ 已保存，但本地电脑未响应，请稍后重试';
      m.className = 'form-msg ' + (ok ? 'ok' : 'err');
      renderConnStatus();
    });
  };
  // 云电脑：测试
  var cloudTest = $('cloudTestBtn');
  if (cloudTest) cloudTest.onclick = function () {
    var m = $('cloudMsg'); if (!m) return;
    m.textContent = '📡 检测中…'; m.className = 'form-msg';
    testCloudConn(function (ok, reason) {
      var msg = ok ? '✅ 云电脑通道可用（顶栏变蓝色）'
        : reason === '401' ? '❌ Token 错误或已过期（云服务在线，但鉴权失败，请检查 Token）'
        : reason === 'empty' ? '❌ 请填写云电脑地址'
        : reason === 'timeout' ? '❌ 云服务响应超时（检查网络或地址）'
        : reason === 'network' ? '❌ 无法连接云服务（网络不通或地址错误）'
        : '❌ 云服务返回错误（HTTP ' + reason + '）';
      m.textContent = msg; m.className = 'form-msg ' + (ok ? 'ok' : 'err');
      renderConnStatus();
    });
  };
  // 云电脑：保存并连接
  var cloudSave = $('cloudSaveBtn');
  if (cloudSave) cloudSave.onclick = function () {
    var u = (cloudUrlInput ? cloudUrlInput.value : '').trim();
    var m = $('cloudMsg'); if (!m) return;
    if (!u) { m.textContent = '请填写云电脑地址'; m.className = 'form-msg err'; return; }
    setCloudUrl(u);
    setCloudToken(cloudTokenInput ? cloudTokenInput.value.trim() : '');
    setPcDeviceId(cloudDeviceInput ? cloudDeviceInput.value.trim() : '');
    setPcMode('cloud');
    m.textContent = '已切换云电脑，正在检测…'; m.className = 'form-msg';
    testCloudConn(function (ok, reason) {
      var msg = ok ? '✅ 已连接云电脑（顶栏变蓝色）'
        : reason === '401' ? '❌ 已保存，但 Token 鉴权失败（401），请确认 Token 正确'
        : '❌ 已保存，但云电脑未连通（检查地址/Token/网络）';
      m.textContent = msg; m.className = 'form-msg ' + (ok ? 'ok' : 'err');
      renderConnStatus();
    });
  };
  renderConnStatus();
}

/* 电脑指令意图识别：动词开头（打开/启动/运行/截图/输入/按/点击等）+ 目标对象 */
function isComputerCommand(text) {
  var t = String(text || '').trim();
  if (!t) return false;
  var patterns = [
    /^(打开|启动|运行|开启|帮我打开|帮我启动|帮我运行|帮我打开一下|打开一下)\s*(微信|qq|chrome|浏览器|记事本|计算器|画图|文件管理器|资源管理器|任务管理器|cmd|命令行|powershell|vscode|word|excel|ppt|outlook|钉钉|飞书|企业微信|百度网盘|网易云音乐|steam|wps|word文档)/i,
    /^(截图|截屏|屏幕截图|screen\s*shot)/i,
    /^(输入|键入|打字)\s*[:：]?.+/,
    /^(按下|按|按键)\s*[:：]?.+/,
    /^(点击|单击|点一下)\s*[:：]?/,
    /^(最小化|最大化|关闭窗口|打开文件夹|打开目录|清空回收站|锁屏|关机|重启)\s*$/,
    // 云端执行体指令（无头服务器：文件/脚本/命令/网页/系统状态）
    /^(创建|新建|写|写入|生成)(文件|脚本|目录)\s*[:：]?\s*.+/i,
    /^(读取|查看|打开|显示|cat)(文件|脚本)\s*[:：]?\s*.+/i,
    /^(列出|查看|浏览)(目录|文件夹)\s*[:：]?\s*.+/i,
    /^(执行|运行)(命令|脚本|shell|bash|sh|python|python3|node|npm|pip|git)\s*[:：]?\s*.+/i,
    /^(抓取|下载|访问|fetch)(网页|页面|url)\s*[:：]?\s*.+/i,
    /^(系统状态|服务器状态|运行状态|内存|磁盘|磁盘空间|主机信息|uptime)/i,
    /^(搜索|查找|找)(文件|关键词|内容)\s*[:：]?\s*.+/i,
  ];
  for (var i = 0; i < patterns.length; i++) { if (patterns[i].test(t)) return true; }
  return false;
}
/* 当前执行端标签：云端桥接模式 + 云端设备 → 「云端执行体」，否则「电脑」 */
function getExecEndLabel() {
  var mode = getPcMode();
  var deviceId = getPcDeviceId();
  if (mode === 'cloud' && (deviceId.indexOf('cloud') === 0 || deviceId.indexOf('pc-cloud') === 0 || deviceId === 'pc-cloud-agent-01')) return '云端执行体';
  return '电脑';
}
/* 基础 XHR POST（带可选鉴权头 + 请求签名防重放） */
function postJson(url, body, headers, onDone, onError, timeoutMs) {
  var xhr = new XMLHttpRequest();
  xhr.open('POST', url, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  if (headers) {
    Object.keys(headers).forEach(function (k) { xhr.setRequestHeader(k, headers[k]); });
  }
  addSignHeaders(xhr, headers, JSON.stringify(body || {}));
  xhr.timeout = timeoutMs || 15000;
  xhr.onload = function () {
    try {
      var data = JSON.parse(xhr.responseText);
      onDone(data);
    } catch (e) { onError(new Error('响应解析失败')); }
  };
  xhr.onerror = function () { onError(new Error('网络错误，无法连接 ' + url)); };
  xhr.ontimeout = function () { onError(new Error('连接超时（' + url + '）')); };
  xhr.send(JSON.stringify(body || {}));
}
function getJson(url, headers, onDone, onError, timeoutMs) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  if (headers) {
    Object.keys(headers).forEach(function (k) { xhr.setRequestHeader(k, headers[k]); });
  }
  addSignHeaders(xhr, headers, '');
  xhr.timeout = timeoutMs || 15000;
  xhr.onload = function () {
    try {
      var data = JSON.parse(xhr.responseText);
      onDone(data);
    } catch (e) { onError(new Error('响应解析失败')); }
  };
  xhr.onerror = function () { onError(new Error('网络错误，无法连接 ' + url)); };
  xhr.ontimeout = function () { onError(new Error('连接超时（' + url + '）')); };
  xhr.send();
}
/* 请求签名（第二层安全·防重放）：HMAC-SHA256(timestamp|nonce|body)，密钥 = 云端 token */
/* 纯 JS 实现（无外部依赖）：先用 TextEncoder 统一转 UTF-8 字节，保证中文 body 签名与 Node crypto 一致 */
function addSignHeaders(xhr, headers, bodyRaw) {
  var signSecret = getCloudToken(); // 签名密钥与 FH_WEB_TOKEN 一致
  if (!signSecret) return;
  try {
    var ts = String(Date.now());
    var nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    var sig = hmacSha256(signSecret, ts + '|' + nonce + '|' + (bodyRaw || ''));
    xhr.setRequestHeader('x-fh-ts', ts);
    xhr.setRequestHeader('x-fh-nonce', nonce);
    xhr.setRequestHeader('x-fh-sig', sig);
  } catch (e) { /* 签名失败不阻塞请求 */ }
}
function hmacSha256(secret, message) {
  var encoder = new TextEncoder();
  var keyBytes = Array.from(encoder.encode(secret));
  var msgBytes = Array.from(encoder.encode(message));
  var blockSize = 64;
  if (keyBytes.length > blockSize) keyBytes = Array.from(sha256Bytes(keyBytes));
  while (keyBytes.length < blockSize) keyBytes.push(0);
  var innerPad = keyBytes.map(function (x) { return x ^ 0x36; });
  var outerPad = keyBytes.map(function (x) { return x ^ 0x5c; });
  var innerMsg = innerPad.concat(msgBytes);
  var innerHash = sha256Bytes(innerMsg);
  var outerMsg = outerPad.concat(Array.from(innerHash));
  return toHex(sha256Bytes(outerMsg));
}
function sha256Bytes(bytes) {
  var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  var bitLen = bytes.length * 8;
  var padded = bytes.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  // 64 位大端长度
  var hi = Math.floor(bitLen / 4294967296);
  var lo = bitLen >>> 0;
  padded.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
  padded.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);
  for (var off = 0; off < padded.length; off += 64) {
    var w = new Array(64);
    for (var i = 0; i < 16; i++) {
      w[i] = ((padded[off + i * 4] << 24) | (padded[off + i * 4 + 1] << 16) | (padded[off + i * 4 + 2] << 8) | padded[off + i * 4 + 3]) >>> 0;
    }
    for (var i = 16; i < 64; i++) {
      var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (var i = 0; i < 64; i++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var temp1 = (hh + S1 + ch + k[i] + w[i]) >>> 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  var out = new Uint8Array(32);
  for (var i = 0; i < 8; i++) {
    out[i * 4] = (h[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff;
    out[i * 4 + 3] = h[i] & 0xff;
  }
  return out;
}
function toHex(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += ((bytes[i] < 16) ? '0' : '') + bytes[i].toString(16);
  return s;
}
/* 获取已注册的电脑设备列表（云端） */
function fetchCloudDevices(onDone) {
  var token = getCloudToken();
  var headers = token ? { Authorization: 'Bearer ' + token } : {};
  getJson(getCloudUrl().replace(/\/+$/, '') + '/api/bridge/devices', headers,
    function (data) { onDone(data && data.devices ? data.devices : []); },
    function () { onDone([]); });
}
/* 调用电脑：云端桥接（入队→轮询结果）或直连（POST /api/computer/nl） */
function callComputer(text, onDone, onError) {
  var mode = getPcMode();
  if (mode === 'direct') {
    // 直连模式：同局域网，直接调电脑端
    postJson(getPcUrl().replace(/\/+$/, '') + '/api/computer/nl', { text: text }, null, onDone, onError);
    return;
  }
  // 云端桥接模式
  var deviceId = getPcDeviceId();
  if (!deviceId) { onError(new Error('未配置目标电脑（deviceId）。请在设置中填写电脑端设备 ID，或用「fhcode bridge id」查看')); return; }
  var cloudBase = getCloudUrl().replace(/\/+$/, '');
  var token = getCloudToken();
  var headers = token ? { Authorization: 'Bearer ' + token } : {};
  postJson(cloudBase + '/api/bridge/command', { deviceId: deviceId, text: text }, headers,
    function (data) {
      if (!data || !data.ok) { onError(new Error((data && data.error) || '云端下发失败')); return; }
      // 轮询结果
      var cmdId = data.cmdId;
      var tries = 0;
      (function poll() {
        tries++;
        getJson(cloudBase + '/api/bridge/command/' + cmdId, headers,
          function (d) {
            if (!d || !d.ok || !d.command) { onError(new Error('查询指令状态失败')); return; }
            var c = d.command;
            if (c.status === 'done') { onDone({ ok: true, action: 'bridge', app: c.text, message: '已在' + getExecEndLabel() + '执行完成', bridge: c }); }
            else if (c.status === 'failed') { onError(new Error(c.error || getExecEndLabel() + '执行失败')); }
            else if (tries > 60) { onError(new Error('等待电脑执行超时（60 次轮询）')); }
            else { setTimeout(poll, 1500); }
          },
          function (e) { onError(e); });
      })();
    },
    onError);
}
/* 渲染电脑执行结果到对话流 */
function renderComputerResult(task, data, rawText) {
  var lines = [];
  lines.push((getExecEndLabel() === '云端执行体' ? '☁️ 云端执行体已执行指令：' : '🖥️ 电脑已执行指令：') + esc(rawText));
  lines.push('');
  if (data && data.action) {
    var actionName = {
      'app/open': '📂 打开应用',
      'screenshot': '📷 截屏',
      'keyboard/type': '⌨️ 输入文字',
      'keyboard/press': '🔘 按键',
      'mouse/click': '🖱️ 点击鼠标',
      'write': '📝 写入文件',
      'read': '📄 读取文件',
      'save-file': '💾 保存文件（手机上传）',
      'read-image': '🖼️ 读取图片',
      'ls': '📁 列出目录',
      'mkdir': '🗂️ 创建目录',
      'exec': '⚙️ 执行命令',
      'fetch': '🌐 抓取网页',
      'sysinfo': '🖥️ 系统状态',
      'grep': '🔍 搜索文件'
    }[data.action] || data.action;
    lines.push('执行动作：' + actionName);
  }
  if (data && data.app) lines.push('目标：' + esc(data.app));
  if (data && data.message) lines.push('结果：' + esc(data.message));
  var bridgeResult = data && data.bridge && data.bridge.result;
  if (bridgeResult && bridgeResult.text) {
    lines.push('<div style="white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;background:rgba(127,127,127,.08);border-radius:6px;padding:6px;margin-top:4px;color:var(--ink-1);">' + esc(bridgeResult.text) + '</div>');
  }
  if (bridgeResult && bridgeResult.path) lines.push('路径：' + esc(bridgeResult.path));
  var img = (data && data.image) || (bridgeResult && bridgeResult.image);
  if (img) {
    return { html: lines.join('<br>') + '<br><img src="' + img + '" style="max-width:100%;border-radius:8px;margin-top:6px;"/>', ok: true };
  }
  return { html: lines.join('<br>'), ok: true };
}

/* ===== v8.4.2 远程操控增强 ===== */
/* 指令历史：拉取云端本设备指令记录并渲染 */
function loadCloudHistory() {
  var box = $('cloudHistoryBox');
  if (!box) return;
  if (box.classList.contains('hidden')) { box.classList.remove('hidden'); }
  else { box.classList.add('hidden'); return; }
  var deviceId = getPcDeviceId();
  if (!deviceId) { box.innerHTML = '<div style="color:var(--ink-2);">未配置设备 ID，无法查看历史</div>'; return; }
  var cloudBase = getCloudUrl().replace(/\/+$/, '');
  var token = getCloudToken();
  var headers = token ? { Authorization: 'Bearer ' + token } : {};
  box.innerHTML = '<div style="color:var(--ink-2);">加载中…</div>';
  getJson(cloudBase + '/api/bridge/commands?deviceId=' + encodeURIComponent(deviceId), headers,
    function (data) {
      var cmds = (data && data.commands) || [];
      if (!cmds.length) { box.innerHTML = '<div style="color:var(--ink-2);">暂无指令记录</div>'; return; }
      var statusMap = { queued: '⏳ 排队', running: '⚙️ 执行中', done: '✅ 完成', failed: '❌ 失败', refused: '🚫 拒绝', paused: '⏸️ 暂停' };
      box.innerHTML = cmds.slice(0, 30).map(function (c) {
        var st = statusMap[c.status] || c.status;
        var t = (c.text || '').length > 60 ? c.text.slice(0, 60) + '…' : c.text;
        return '<div style="padding:6px;border-bottom:1px solid rgba(127,127,127,.12);"><div style="color:var(--ink-1);">' + esc(t) + '</div><div style="color:var(--ink-2);font-size:11px;">' + st + ' · ' + (c.createdAt || '').replace('T', ' ').slice(5, 19) + '</div></div>';
      }).join('');
    },
    function () { box.innerHTML = '<div style="color:var(--err);">加载失败：无法连接云端</div>'; });
}

/* 发送文件到电脑：文件 → base64 → 保存文件指令 → 云端桥接执行 */
function sendFileToCloud() {
  var input = $('cloudFileInput');
  if (!input || !input.files || !input.files.length) return;
  var file = input.files[0];
  var MAX = 6 * 1024 * 1024;
  if (file.size > MAX) { toast('文件过大（>6MB），请压缩后重试'); input.value = ''; return; }
  var reader = new FileReader();
  reader.onload = function () {
    var base64 = String(reader.result).split(',')[1] || '';
    if (!base64) { toast('文件读取失败'); input.value = ''; return; }
    var text = '保存文件 upload/' + file.name + ' base64=' + base64;
    var pcTask;
    if (!state.currentTaskId || !getTask(state.currentTaskId)) {
      pcTask = createTask('上传文件 ' + file.name, 'chat');
      state.currentTaskId = pcTask.id;
    } else { pcTask = getTask(state.currentTaskId); }
    pcTask.messages.push({ role: 'user', content: '📁 发送文件到电脑：' + file.name });
    pcTask.status = 'running'; saveTasks();
    renderThread(pcTask);
    var box = $('convMessages');
    var msgEl = document.createElement('div');
    msgEl.className = 'msg assistant';
    msgEl.innerHTML = '<span style="color:var(--ink-2);">📁 正在上传文件到' + getExecEndLabel() + '…</span> <span class="typing-cursor">▋</span>';
    box.appendChild(msgEl); box.scrollTop = box.scrollHeight;
    callComputer(text,
      function (data) {
        var r = renderComputerResult(pcTask, data, '📁 发送文件到电脑：' + file.name);
        msgEl.innerHTML = r.html;
        appendAssistantMessage(pcTask.id, '📁 发送文件到电脑：' + file.name + '\n\n' + JSON.stringify(data));
        renderThread(getTask(pcTask.id));
        updateSendBtn(false);
      },
      function (err) {
        msgEl.innerHTML = '<div style="color:var(--err);">❌ 上传失败：' + esc(friendlyError(err)) + '</div>';
        pcTask.status = 'failed'; pcTask.error = err.message; saveTasks();
        updateSendBtn(false);
      });
    updateSendBtn(true);
    input.value = '';
  };
  reader.readAsDataURL(file);
}

/* 绑定远程操控面板按钮 */
function bindRemoteControls() {
  var hb = $('cloudHistoryBtn');
  if (hb) hb.onclick = loadCloudHistory;
  var sf = $('cloudSendFileBtn');
  if (sf) sf.onclick = function () { var f = $('cloudFileInput'); if (f) f.click(); };
  var fi = $('cloudFileInput');
  if (fi) fi.onchange = sendFileToCloud;
}

function sendMessage() {
  var input = $('goalInput');
  var text = input.value.trim();
  if (!text && !state_attach) return;
  if (state.streaming) { toast('正在生成中，请稍候或点击停止'); return; }
  // 发送锁：防止快速双击或重复绑定导致重复请求
  if (state.sendingLock) return;
  state.sendingLock = true;
  setTimeout(function () { state.sendingLock = false; }, 500);

  // 图片附件：走视觉模型识别流程（最多20张）
  if (state_attach_images.length) {
    sendImageMessage(text);
    return;
  }

  // 处理附件：将附件内容合并到消息中
  var finalText = buildAttachPrompt(text);
  var attachInfo = state_attach ? state_attach.name : '';
  removeAttach(); // 发送后清除附件

  // Hermes Agent：技能匹配（如果匹配到技能，使用技能增强的 prompt）
  var hermesResult = null;
  try {
    if (typeof AgentCore !== 'undefined') {
      hermesResult = AgentCore.processInput(finalText);
      if (hermesResult.matchedSkill) {
        finalText = hermesResult.enhancedPrompt;
        toast('⚡ 已应用技能：' + hermesResult.matchedSkill.name);
      }
    }
  } catch (e) { /* 技能匹配失败不影响正常对话 */ }

  // 电脑遥控分流：识别为电脑操作指令时，直接转发电脑端执行，不走大模型
  if (isComputerCommand(finalText)) {
    var pcTask;
    if (!state.currentTaskId || !getTask(state.currentTaskId)) {
      pcTask = createTask(finalText.slice(0, 30), 'chat');
      state.currentTaskId = pcTask.id;
    } else {
      pcTask = getTask(state.currentTaskId);
    }
    pcTask.messages.push({ role: 'user', content: finalText });
    pcTask.status = 'running';
    saveTasks();
    input.value = '';
    input.style.height = 'auto';
    renderThread(pcTask);
    var pcBox = $('convMessages');
    var pcMsgEl = document.createElement('div');
    pcMsgEl.className = 'msg assistant';
    pcMsgEl.innerHTML = '<span style="color:var(--ink-2);">' + (getExecEndLabel() === '云端执行体' ? '☁️ 正在指挥云端执行体…' : '🖥️ 正在指挥电脑执行…') + '</span> <span class="typing-cursor">▋</span>';
    pcBox.appendChild(pcMsgEl);
    pcBox.scrollTop = pcBox.scrollHeight;
    callComputer(finalText,
      function (data) {
        var r = renderComputerResult(pcTask, data, finalText);
        pcMsgEl.innerHTML = r.html;
        appendAssistantMessage(pcTask.id, finalText + '\n\n' + JSON.stringify(data));
        renderThread(getTask(pcTask.id));
        updateSendBtn(false);
      },
      function (err) {
        pcMsgEl.innerHTML = '<div style="color:var(--err);white-space:pre-wrap;">❌ 电脑执行失败：' + esc(friendlyError(err)) + '</div>';
        pcTask.status = 'failed'; pcTask.error = err.message; saveTasks();
        updateSendBtn(false);
      }
    );
    updateSendBtn(true);
    return;
  }

  var task;
  if (!state.currentTaskId || !getTask(state.currentTaskId)) {
    task = createTask(finalText.slice(0, 30), 'chat');
    state.currentTaskId = task.id;
  } else {
    task = getTask(state.currentTaskId);
  }
  task.messages.push({ role: 'user', content: finalText });
  task.status = 'running';
  saveTasks();
  input.value = '';
  input.style.height = 'auto';
  renderThread(task);

  var messages = task.messages.map(function (m) { return { role: m.role, content: m.content }; });
  var assistantContent = '';
  var box = $('convMessages');
  var msgEl = document.createElement('div');
  msgEl.className = 'msg assistant';
  msgEl.innerHTML = '<span style="color:var(--ink-2);">正在思考…</span> <span class="typing-cursor">▋</span>';
  box.appendChild(msgEl);
  box.scrollTop = box.scrollHeight;

  callModelStream(messages,
    function (delta) {
      assistantContent += delta;
      msgEl.innerHTML = renderMarkdown(assistantContent) + '<span class="typing-cursor">▋</span>';
      box.scrollTop = box.scrollHeight;
    },
    function (full) {
      msgEl.innerHTML = renderMarkdown(full || assistantContent);
      appendAssistantMessage(task.id, full || assistantContent);
      renderThread(getTask(task.id));
      updateSendBtn(false);
      // Hermes Agent：对话结束后沉淀记忆
      try {
        if (typeof AgentCore !== 'undefined') AgentCore.onConversationEnd(task.messages, task.type);
      } catch (e) {}
      // 免密层记忆
      try { rememberConversation(task.messages, null); } catch (e) {}
    },
    function (err) {
      msgEl.innerHTML = '<div style="color:var(--err);white-space:pre-wrap;">❌ 生成失败：' + esc(friendlyError(err)) + '</div>';
      task.status = 'failed'; task.error = err.message; saveTasks();
      updateSendBtn(false);
    }
  );
  updateSendBtn(true);
}

/* 发送图片消息：自动调用视觉模型识别（支持多图） */
function sendImageMessage(userText) {
  var images = state_attach_images.slice();
  removeAttach();
  var input = $('goalInput');
  input.value = '';
  input.style.height = 'auto';

  var task;
  if (!state.currentTaskId || !getTask(state.currentTaskId)) {
    task = createTask('图片识别：' + (userText ? userText.slice(0, 15) : images.length + '张图'), 'chat');
    state.currentTaskId = task.id;
  } else {
    task = getTask(state.currentTaskId);
  }
  var names = images.map(function (i) { return i.name; }).join('、');
  task.messages.push({
    role: 'user',
    content: (userText ? userText + '\n\n' : '') + '[图片：' + names + ']',
    images: images.map(function (i) { return i.data; })
  });
  task.status = 'running';
  saveTasks();
  renderThread(task);

  var box = $('convMessages');
  var msgEl = document.createElement('div');
  msgEl.className = 'msg assistant';
  msgEl.innerHTML = '<span style="color:var(--ink-2);">🖼️ 正在识别 ' + images.length + ' 张图片…</span> <span class="typing-cursor">▋</span>';
  box.appendChild(msgEl);
  box.scrollTop = box.scrollHeight;

  var assistantContent = '';
  recognizeImages(images, userText,
    function (delta) {
      assistantContent += delta;
      msgEl.innerHTML = renderMarkdown(assistantContent) + '<span class="typing-cursor">▋</span>';
      box.scrollTop = box.scrollHeight;
    },
    function (full) {
      msgEl.innerHTML = renderMarkdown(full || assistantContent);
      appendAssistantMessage(task.id, full || assistantContent);
      task.status = 'done';
      saveTasks();
      renderThread(getTask(task.id));
      updateSendBtn(false);
    },
    function (err) {
      msgEl.innerHTML = '<div style="color:var(--err);white-space:pre-wrap;">❌ 图片识别失败：' + esc(friendlyError(err)) + '<br><br>请在设置中配置视觉大模型（API 地址 + Key + 模型 ID）</div>';
      task.status = 'failed'; task.error = err.message; saveTasks();
      updateSendBtn(false);
    }
  );
  updateSendBtn(true);
}
function updateSendBtn(streaming) {
  var btn = $('sendBtn');
  if (!btn) return;
  if (streaming) {
    btn.textContent = '⏹';
    btn.title = '停止生成';
    btn.onclick = function () {
      stopStreaming();
      updateSendBtn(false);
      toast('已停止生成');
    };
  } else {
    btn.textContent = '➤';
    btn.title = '发送';
    btn.onclick = sendMessage;
  }
}

/* ========== 通用：执行带 prompt 的任务 ========== */
function runPromptTask(goal, type, prompt) {
  var model = getDefaultModel();
  if (!model) { toast('请先配置大模型'); openDrawer(); return; }
  var task = createTask(goal, type);
  state.currentTaskId = task.id;
  task.messages.push({ role: 'user', content: prompt });
  task.status = 'running';
  saveTasks();
  switchPage('convPage');
  renderThread(task);

  var messages = [{ role: 'user', content: prompt }];
  var assistantContent = '';
  var box = $('convMessages');
  var msgEl = document.createElement('div');
  msgEl.className = 'msg assistant';
  msgEl.innerHTML = '<span style="color:var(--ink-2);">正在思考…</span> <span class="typing-cursor">▋</span>';
  box.appendChild(msgEl);

  callModelStream(messages,
    function (delta) {
      assistantContent += delta;
      msgEl.innerHTML = renderMarkdown(assistantContent) + '<span class="typing-cursor">▋</span>';
      box.scrollTop = box.scrollHeight;
    },
    function (full) {
      msgEl.innerHTML = renderMarkdown(full || assistantContent);
      appendAssistantMessage(task.id, full || assistantContent);
      renderThread(getTask(task.id));
    },
    function (err) {
      msgEl.innerHTML = '<div style="color:var(--err);white-space:pre-wrap;">❌ 生成失败：' + esc(friendlyError(err)) + '</div>';
      task.status = 'failed'; saveTasks();
    }
  );
}

/* ========== 代码修复 ========== */
function openFixCode() {
  $('fcCode').value = ''; $('fcError').value = ''; $('fcLang').value = 'auto';
  showSheet('fixCodeSheet');
}
function runFixCode() {
  var code = $('fcCode').value.trim();
  var error = $('fcError').value.trim();
  var lang = $('fcLang').value;
  if (!code) { toast('请输入需要修复的代码'); return; }
  hideSheet('fixCodeSheet');
  var goal = '修复代码' + (error ? '：' + error.slice(0, 30) : '');
  var prompt = '请修复以下' + (lang !== 'auto' ? lang : '') + '代码' + (error ? '，错误信息：' + error : '') + '。\n\n要求：\n1.直接给出修复后的完整代码，不要反复尝试相同方法\n2.如果第一种修复思路不行，立即换一种方法，不要重复劳作\n3.简要说明修复了什么问题（不超过3点）\n4.确保修复后的代码可以直接运行\n\n代码：\n```\n' + code + '\n```';
  runPromptTask(goal, 'fix-code', prompt);
}

/* ========== 代码编写 ========== */
function openWriteCode() {
  $('wcReq').value = ''; $('wcLang').value = 'javascript';
  showSheet('writeCodeSheet');
}
function runWriteCode() {
  var req = $('wcReq').value.trim();
  var lang = $('wcLang').value;
  if (!req) { toast('请描述代码需求'); return; }
  hideSheet('writeCodeSheet');
  var goal = '编写' + lang + '代码：' + req.slice(0, 30);
  var prompt = '请用' + lang + '编写代码，需求如下：\n\n' + req + '\n\n要求：\n1.直接给出完整可运行代码，不要反复尝试相同方法\n2.如果一种实现方式有问题，立即换一种思路，不要重复劳作\n3.代码简洁高效有注释\n4.最后附上简要说明（不超过3点）\n5.确保代码可以直接复制运行';
  runPromptTask(goal, 'write-code', prompt);
}

/* ========== 插件 ========== */
function openPlugin(id) {
  var plugin = PLUGINS[id];
  if (!plugin) return;
  $('pluginTitle').textContent = plugin.title;
  $('pluginInput').value = '';
  $('pluginInput').placeholder = '输入代码或文本…';
  $('pluginRunBtn').dataset.pluginId = id;
  showSheet('pluginSheet');
}
function runPlugin() {
  var id = $('pluginRunBtn').dataset.pluginId;
  var plugin = PLUGINS[id];
  var input = $('pluginInput').value.trim();
  if (!input) { toast('请输入内容'); return; }
  hideSheet('pluginSheet');
  var prompt = plugin.prompt.replace('{code}', input);
  runPromptTask(plugin.title + '：' + input.slice(0, 20), 'plugin', prompt);
}

/* ========== 模型设置 ========== */
function renderModelList() {
  var box = $('modelList');
  if (!box) return;
  if (!state.models.length) { box.innerHTML = '<div class="empty" style="padding:16px;">还没有模型配置，在下方添加一个吧</div>'; return; }
  box.innerHTML = state.models.map(function (m) {
    return '<div class="model-item" data-id="' + esc(m.id) + '">' +
      '<div class="row"><div class="mi-name" style="flex:1;">' + esc(m.name) + (m.id === state.defaultModelId ? ' <span class="badge done">默认</span>' : '') + '</div></div>' +
      '<div class="mi-base">' + esc(m.modelId || m.id) + '<br>' + esc(m.apiBase || '（未填写 API 地址）') + (m.apiKey ? ' · 已配置密钥' : ' · 未配置密钥') + '</div>' +
      '<div class="mi-actions">' +
        (m.id === state.defaultModelId ? '' : '<button class="btn sm ghost" data-act="default">设默认</button>') +
        '<button class="btn sm ghost" data-act="edit">编辑</button>' +
        '<button class="btn sm ghost" data-act="del" style="color:var(--err);">删除</button>' +
      '</div></div>';
  }).join('');
  box.querySelectorAll('.model-item').forEach(function (el) {
    var id = el.dataset.id;
    el.querySelectorAll('button[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.dataset.act;
        if (act === 'default') { state.defaultModelId = id; saveModels(); renderModelList(); toast('已设为默认'); }
        else if (act === 'edit') editModel(id);
        else if (act === 'del') deleteModel(id);
      });
    });
  });
}
function editModel(id) {
  var m = state.models.find(function (x) { return x.id === id; });
  if (!m) return;
  $('mName').value = m.name;
  $('mModelId').value = m.modelId || m.id || '';
  $('mBase').value = m.apiBase || '';
  $('mKey').value = '';
  $('mReasoning').value = m.reasoning || '';
  // 自动匹配提供商
  var provider = '';
  for (var key in PROVIDER_PRESETS) {
    if (m.apiBase && m.apiBase.indexOf(PROVIDER_PRESETS[key].apiBase) >= 0) { provider = key; break; }
  }
  $('mProvider').value = provider;
  $('mMsg').textContent = '编辑：' + m.name + '（密钥留空保持不变）';
  $('mMsg').className = 'form-msg';
  $('mSaveBtn').dataset.editing = id;
}
function deleteModel(id) {
  if (!confirm('确定删除该模型配置？')) return;
  state.models = state.models.filter(function (m) { return m.id !== id; });
  if (state.defaultModelId === id) state.defaultModelId = state.models[0] ? state.models[0].id : '';
  saveModels(); renderModelList(); toast('已删除');
}
function saveModel() {
  var name = $('mName').value.trim();
  var modelId = $('mModelId').value.trim();
  var msg = $('mMsg');
  if (!name) { msg.textContent = '请填写模型名称'; msg.className = 'form-msg err'; return; }
  if (!modelId) { msg.textContent = '请填写模型 ID（接口调用名）'; msg.className = 'form-msg err'; return; }
  var editing = $('mSaveBtn').dataset.editing;
  var apiBase = $('mBase').value.trim();
  var apiKey = $('mKey').value.trim();
  var reasoning = $('mReasoning').value.trim();
  if (editing) {
    var m = state.models.find(function (x) { return x.id === editing; });
    if (m) { m.name = name; m.modelId = modelId; m.apiBase = apiBase; m.reasoning = reasoning; if (apiKey) m.apiKey = apiKey; }
  } else {
    var newModel = { id: genId(), modelId: modelId, name: name, apiBase: apiBase, apiKey: apiKey, reasoning: reasoning };
    state.models.push(newModel);
    if (!state.defaultModelId) state.defaultModelId = newModel.id;
  }
  saveModels(); renderModelList(); resetModelForm(true); toast('模型配置已保存');
}
function resetModelForm(keepMsg) {
  if (!keepMsg) {
    $('mName').value = ''; $('mModelId').value = ''; $('mBase').value = '';
    $('mKey').value = ''; $('mReasoning').value = ''; $('mProvider').value = '';
    $('mMsg').textContent = ''; $('mMsg').className = 'form-msg';
  }
  $('mSaveBtn').dataset.editing = '';
}

/* ========== 视觉大模型（图片识别理解） ========== */
var LS_VL_CONFIG = 'fh.app.vlconfig';
var AGNES_VL = { apiBase: 'https://api.agnes-ai.cn/v1', apiKey: '', modelId: 'qwen-vl-max' };
var SILICONFLOW_OCR = { apiBase: 'https://api.siliconflow.cn/v1', apiKey: '', modelId: 'deepseek-ai/DeepSeek-OCR' };

function loadVLConfig() {
  try { return JSON.parse(localStorage.getItem(LS_VL_CONFIG) || 'null') || SILICONFLOW_OCR; }
  catch (e) { return SILICONFLOW_OCR; }
}
function saveVLConfig(cfg) {
  try { localStorage.setItem(LS_VL_CONFIG, JSON.stringify(cfg)); } catch (e) {}
}
function fillVLForm() {
  var cfg = loadVLConfig();
  $('vlApiBase').value = cfg.apiBase || '';
  $('vlApiKey').value = cfg.apiKey || '';
  $('vlModelId').value = cfg.modelId || '';
}
function saveVLConfigFromForm() {
  var cfg = {
    apiBase: $('vlApiBase').value.trim(),
    apiKey: $('vlApiKey').value.trim(),
    modelId: $('vlModelId').value.trim()
  };
  var msg = $('vlMsg');
  if (!cfg.apiBase) { msg.textContent = '请填写 API 地址'; msg.className = 'form-msg err'; return; }
  if (!cfg.modelId) { msg.textContent = '请填写模型 ID'; msg.className = 'form-msg err'; return; }
  saveVLConfig(cfg);
  msg.textContent = '视觉模型配置已保存 ✓';
  msg.className = 'form-msg ok';
  toast('视觉模型已保存');
}
function testVLConnection() {
  var cfg = {
    apiBase: $('vlApiBase').value.trim(),
    apiKey: $('vlApiKey').value.trim(),
    modelId: $('vlModelId').value.trim()
  };
  var msg = $('vlMsg');
  if (!cfg.apiBase || !cfg.modelId) { msg.textContent = '请先填写 API 地址和模型 ID'; msg.className = 'form-msg err'; return; }
  msg.textContent = '正在测试连接…';
  msg.className = 'form-msg';
  var xhr = new XMLHttpRequest();
  xhr.open('POST', cfg.apiBase.replace(/\/$/, '') + '/chat/completions', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  if (cfg.apiKey) xhr.setRequestHeader('Authorization', 'Bearer ' + cfg.apiKey);
  xhr.timeout = 15000;
  xhr.onload = function () {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        var data = JSON.parse(xhr.responseText);
        var content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
        msg.textContent = '连接成功 ✓ 模型回复：' + (content ? content.slice(0, 50) : 'OK');
        msg.className = 'form-msg ok';
      } catch (e) {
        msg.textContent = '连接成功 ✓（响应解析异常）';
        msg.className = 'form-msg ok';
      }
    } else {
      msg.textContent = '连接失败：HTTP ' + xhr.status + ' ' + (xhr.responseText || '').slice(0, 100);
      msg.className = 'form-msg err';
    }
  };
  xhr.onerror = function () { msg.textContent = '网络错误，请检查 API 地址'; msg.className = 'form-msg err'; };
  xhr.ontimeout = function () { msg.textContent = '连接超时（15秒）'; msg.className = 'form-msg err'; };
  xhr.send(JSON.stringify({ model: cfg.modelId, messages: [{ role: 'user', content: '你好，请回复"连接正常"' }], max_tokens: 20 }));
}

/* 图片识别理解：调用视觉模型 */
/* 多图识别：支持 1-20 张图片（视觉模型），OCR 自动优化 prompt，表格转 Markdown */
function recognizeImages(images, userPrompt, onDelta, onDone, onError) {
  var cfg = loadVLConfig();
  if (!cfg.apiBase || !cfg.modelId) {
    if (onError) onError(new Error('未配置视觉模型，请在设置中配置'));
    return;
  }
  var isOCR = /ocr/i.test(cfg.modelId || '');
  var prompt;
  if (userPrompt) {
    prompt = userPrompt;
  } else if (isOCR) {
    prompt = '请精确识别并提取图片中的所有文字内容，保持原始排版和格式。如果图片中有表格、代码或特殊格式，请用 Markdown 表格还原。';
  } else if (images.length > 1) {
    prompt = '请依次详细描述这几张图片的内容，说明每张图的编号、主体、场景、文字等信息，并对比它们之间的异同。';
  } else {
    prompt = '请详细描述这张图片的内容，包括主体、场景、文字、颜色等信息。';
  }
  var xhr = new XMLHttpRequest();
  xhr.open('POST', cfg.apiBase.replace(/\/$/, '') + '/chat/completions', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  if (cfg.apiKey) xhr.setRequestHeader('Authorization', 'Bearer ' + cfg.apiKey);
  xhr.timeout = 120000;

  var contentArr = [{ type: 'text', text: prompt }];
  images.forEach(function (img) {
    contentArr.push({ type: 'image_url', image_url: { url: img.data } });
  });

  var fullText = '';
  xhr.onprogress = function () {
    if (!xhr.responseText) return;
    try {
      var data = JSON.parse(xhr.responseText);
      var content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
      if (content && content !== fullText) {
        var delta = content.slice(fullText.length);
        fullText = content;
        if (onDelta) onDelta(delta);
      }
    } catch (e) {}
  };
  xhr.onload = function () {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        var data = JSON.parse(xhr.responseText);
        var content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
        if (content && content !== fullText) {
          if (onDelta) onDelta(content.slice(fullText.length));
          fullText = content;
        }
        if (onDone) onDone(fullText);
      } catch (e) {
        if (onError) onError(e);
      }
    } else {
      if (onError) onError(new Error('HTTP ' + xhr.status + ': ' + (xhr.responseText || '').slice(0, 200)));
    }
  };
  xhr.onerror = function () { if (onError) onError(new Error('网络错误')); };
  xhr.ontimeout = function () { if (onError) onError(new Error('请求超时（120秒）')); };

  xhr.send(JSON.stringify({
    model: cfg.modelId,
    messages: [{ role: 'user', content: contentArr }],
    max_tokens: 4000
  }));
  return xhr;
}

/* API 提供商选择：自动填充 API 地址和推荐模型 */
function onProviderChange() {
  var provider = $('mProvider').value;
  if (!provider || !PROVIDER_PRESETS[provider]) return;
  var preset = PROVIDER_PRESETS[provider];
  $('mBase').value = preset.apiBase;
  // 自动填充第一个推荐模型
  if (preset.models && preset.models.length) {
    var first = preset.models[0];
    if (!$('mModelId').value) $('mModelId').value = first.id;
    if (!$('mName').value) $('mName').value = first.name;
  }
  $('mMsg').textContent = '已选择 ' + preset.name + '，API 地址已自动填充';
  $('mMsg').className = 'form-msg ok';
}

/* 测试连接：验证 API 地址和 Key 是否可用 */
function testConnection() {
  var apiBase = $('mBase').value.trim();
  var apiKey = $('mKey').value.trim();
  var modelId = $('mModelId').value.trim();
  var msg = $('mMsg');
  if (!apiBase) { msg.textContent = '请先填写 API 地址'; msg.className = 'form-msg err'; return; }
  if (!apiKey) { msg.textContent = '请先填写 API Key'; msg.className = 'form-msg err'; return; }
  if (!modelId) { msg.textContent = '请先填写模型 ID'; msg.className = 'form-msg err'; return; }

  msg.textContent = '正在测试连接…';
  msg.className = 'form-msg';

  var url = apiBase.replace(/\/+$/, '') + '/chat/completions';
  var body = { model: modelId, messages: [{ role: 'user', content: 'hi' }], stream: false, max_tokens: 5 };
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify(body),
  }).then(function (res) {
    if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status + ': ' + (t || res.statusText)); });
    return res.json();
  }).then(function (json) {
    var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    msg.textContent = '✅ 连接成功！模型响应正常' + (content ? '：' + content.slice(0, 30) : '');
    msg.className = 'form-msg ok';
  }).catch(function (err) {
    msg.textContent = '❌ 连接失败：' + friendlyError(err);
    msg.className = 'form-msg err';
  });
}
/* 一键添加 Agnes 模型（解决渠道失效问题） */
function restoreBuiltinModels() {
  if (!confirm('将添加 Agnes-2.5-Flash 模型并设为默认，是否继续？')) return;
  // 检查是否已存在
  var exists = state.models.find(function (m) { return m.id === AGNES_MODEL.id; });
  if (!exists) {
    state.models.unshift(JSON.parse(JSON.stringify(AGNES_MODEL)));
  }
  state.defaultModelId = AGNES_MODEL.id;
  saveModels();
  try { localStorage.setItem(LS_MIGRATED, '1'); } catch (e) {}
  renderModelList();
  resetModelForm(false);
  toast('已添加 Agnes-2.5-Flash，可直接使用');
}

/* ========== 主题 ========== */
function toggleTheme() {
  var dark = document.documentElement.classList.toggle('dark');
  localStorage.setItem(LS_THEME, dark ? 'dark' : 'light');
  toast(dark ? '已切换深色主题' : '已切换浅色主题');
}

/* ========== 新建对话 ========== */
function newChat() {
  state.currentTaskId = null;
  setFunc('chat');
  switchPage('convPage');
  renderThread(null);
  $('goalInput').focus();
}

/* ========== 小红书内容生成技能 ========== */
function openXiaohongshu() {
  $('xhsTopic').value = ''; $('xhsStyle').value = '种草';
  $('xhsAudience').value = ''; $('xhsKeywords').value = '';
  $('xhsLength').value = '500';
  showSheet('xiaohongshuSheet');
}
function runXiaohongshu() {
  var topic = $('xhsTopic').value.trim();
  if (!topic) { toast('请填写主题/产品'); return; }
  var style = $('xhsStyle').value;
  var audience = $('xhsAudience').value.trim();
  var keywords = $('xhsKeywords').value.trim();
  var length = $('xhsLength').value;
  hideSheet('xiaohongshuSheet');

  var prompt = '你是一位资深小红书内容创作专家，擅长撰写高互动率的小红书笔记。请根据以下信息创作一篇小红书笔记：\n\n' +
    '【主题/产品】' + topic + '\n' +
    '【内容风格】' + style + '\n' +
    (audience ? '【目标人群】' + audience + '\n' : '') +
    (keywords ? '【关键词】' + keywords + '\n' : '') +
    '【字数要求】约' + length + '字\n\n' +
    '创作要求：\n' +
    '1. 标题：3-5个吸睛标题备选，用 emoji 点缀，符合小红书爆款标题风格（数字、痛点、悬念、反差）\n' +
    '2. 正文：口语化、有代入感，分段清晰，每段不超过3行，适当使用 emoji，包含真实体验感\n' +
    '3. 标签：5-8个相关话题标签（#开头），包含热门标签和精准标签\n' +
    '4. 结尾：引导互动（点赞/收藏/评论）\n' +
    '5. 整体风格真诚不生硬，避免广告感过重\n\n' +
    '请直接输出完整笔记内容。';

  var goal = '小红书文案：' + topic.slice(0, 20);
  runPromptTask(goal, 'xiaohongshu', prompt);
}

/* ========== 游戏中心 ========== */
var LS_GAMES = 'fh.app.games';
var LS_GAME_BEST = 'fh.app.gamebest';
var LS_GAME_RECENT = 'fh.app.gamerecent';

function loadGames() {
  try { return JSON.parse(localStorage.getItem(LS_GAMES) || '[]'); }
  catch (e) { return []; }
}
function saveGamesList(games) {
  try { localStorage.setItem(LS_GAMES, JSON.stringify(games)); } catch (e) {}
}
function getBestScore(key) {
  try { return parseInt(localStorage.getItem(LS_GAME_BEST + '.' + key) || '0') || 0; }
  catch (e) { return 0; }
}
function setBestScore(key, score) {
  try {
    var cur = getBestScore(key);
    if (score > cur) localStorage.setItem(LS_GAME_BEST + '.' + key, String(score));
  } catch (e) {}
}
function getRecentGames() {
  try { return JSON.parse(localStorage.getItem(LS_GAME_RECENT) || '[]'); }
  catch (e) { return []; }
}
function addRecentGame(key) {
  try {
    var list = getRecentGames().filter(function (k) { return k !== key; });
    list.unshift(key);
    if (list.length > 5) list = list.slice(0, 5);
    localStorage.setItem(LS_GAME_RECENT, JSON.stringify(list));
  } catch (e) {}
}

function openGameCreator() {
  renderGameCenter();
  renderRecentGames();
  showSheet('gameSheet');
}

/* 渲染游戏中心大卡片 */
function renderGameCenter() {
  var box = $('gameCenterGrid');
  if (!box) return;
  var recent = getRecentGames();
  box.innerHTML = Object.keys(GAME_TEMPLATES).map(function (key) {
    var tpl = GAME_TEMPLATES[key];
    var best = getBestScore(key);
    var isRecent = recent.indexOf(key) >= 0;
    return '<div class="gc-card' + (isRecent ? ' recent' : '') + '" data-gc-key="' + key + '">' +
      (best > 0 ? '<div class="gc-best">🏆 ' + best + '</div>' : '') +
      '<div class="gc-ico">' + (tpl.ico || '🎮') + '</div>' +
      '<div class="gc-name">' + esc(tpl.name) + '</div>' +
      '<div class="gc-desc">' + esc(tpl.desc || '') + '</div>' +
      '</div>';
  }).join('');
  box.querySelectorAll('.gc-card').forEach(function (card) {
    card.addEventListener('click', function () {
      var key = card.dataset.gcKey;
      hideSheet('gameSheet');
      playGame({ name: GAME_TEMPLATES[key].name, mode: 'template', template: key, config: {} });
    });
  });
}

/* 渲染最近玩过 */
function renderRecentGames() {
  var box = $('gameRecentList');
  if (!box) return;
  var recent = getRecentGames();
  if (!recent.length) { box.innerHTML = '<div class="empty" style="padding:8px;font-size:12px;">还没有玩过，点击上方游戏开始吧！</div>'; return; }
  box.innerHTML = recent.map(function (key) {
    var tpl = GAME_TEMPLATES[key];
    if (!tpl) return '';
    var best = getBestScore(key);
    return '<div class="model-item" style="margin-bottom:4px;padding:8px 10px;cursor:pointer;" data-recent-key="' + key + '">' +
      '<div class="row"><span style="font-size:18px;margin-right:8px;">' + (tpl.ico || '🎮') + '</span>' +
      '<div class="mi-name" style="flex:1;">' + esc(tpl.name) + '</div>' +
      (best > 0 ? '<span style="font-size:11px;color:#f0a500;">🏆 ' + best + '</span>' : '') +
      '</div></div>';
  }).join('');
  box.querySelectorAll('[data-recent-key]').forEach(function (el) {
    el.addEventListener('click', function () {
      var key = el.dataset.recentKey;
      hideSheet('gameSheet');
      playGame({ name: GAME_TEMPLATES[key].name, mode: 'template', template: key, config: {} });
    });
  });
}

function playGame(game) {
  if (!game) return;
  if (typeof game === 'string') game = { name: '小游戏', mode: 'html', html: game };
  // 记录最近玩过
  if (game.mode === 'template' && game.template) addRecentGame(game.template);

  var runner = document.createElement('div');
  runner.className = 'game-runner';
  runner.innerHTML = '<div class="game-runner-header">' +
    '<div class="game-runner-title">🎮 ' + esc(game.name || '小游戏') + '</div>' +
    '<button class="game-runner-close">✕ 退出</button></div>' +
    '<div class="game-runner-stage"></div>';
  document.body.appendChild(runner);
  var stage = runner.querySelector('.game-runner-stage');
  var gameInstance = null;

  if (game.mode === 'template' && GAME_TEMPLATES[game.template]) {
    var tpl = GAME_TEMPLATES[game.template];
    var container = document.createElement('div');
    container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
    stage.appendChild(container);
    try {
      // 传入最高分回调
      var cfg = game.config || {};
      cfg.onGameOver = function (score) {
        if (game.template) setBestScore(game.template, score || 0);
      };
      cfg.bestScore = getBestScore(game.template);
      gameInstance = tpl.create(container, cfg);
    } catch (e) {
      container.innerHTML = '<div style="color:#fff;padding:40px;text-align:center;">游戏加载失败：' + esc(e.message) + '</div>';
    }
  } else if (game.html) {
    var mobileAdapt = '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">' +
      '<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;-webkit-overflow-scrolling:touch;touch-action:manipulation;}*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}canvas,div,img{max-width:100%;max-height:100%;}</style>';
    var html = game.html;
    if (/<meta[^>]*name=["']viewport["'][^>]*>/i.test(html)) {
      html = html.replace(/<meta[^>]*name=["']viewport["'][^>]*>/i, mobileAdapt.split('>')[0] + '>');
    } else if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, '$&' + mobileAdapt);
    } else if (/<html[^>]*>/i.test(html)) {
      html = html.replace(/<html[^>]*>/i, '$&<head>' + mobileAdapt + '</head>');
    } else {
      html = '<!DOCTYPE html><html><head>' + mobileAdapt + '</head><body>' + html + '</body></html>';
    }
    var iframe = document.createElement('iframe');
    iframe.className = 'game-runner-iframe';
    iframe.sandbox = 'allow-scripts allow-same-origin allow-pointer-lock allow-modals allow-popups';
    iframe.srcdoc = html;
    stage.appendChild(iframe);
  } else {
    stage.innerHTML = '<div style="color:#fff;padding:40px;text-align:center;">无法加载此游戏</div>';
  }

  runner.querySelector('.game-runner-close').onclick = function () {
    if (gameInstance && gameInstance.destroy) { try { gameInstance.destroy(); } catch (e) {} }
    document.body.removeChild(runner);
  };
}

/* ========== 闪应用（灵光式应用生成） ========== */
var LS_FLASH_APPS = 'fh.app.flashapps';
function loadFlashApps() {
  try { return JSON.parse(localStorage.getItem(LS_FLASH_APPS) || '[]'); }
  catch (e) { return []; }
}
function saveFlashApps(apps) {
  try { localStorage.setItem(LS_FLASH_APPS, JSON.stringify(apps)); } catch (e) {}
}
/* 从模型输出中稳健提取 HTML：优先 ```html 代码块，其次任意代码块，最后按 <!DOCTYPE/<html 起始截取 */
function extractHtmlFromMarkdown(text) {
  if (!text) return '';
  var s = String(text);
  var m = s.match(/```(?:html|HTML)?\s*([\s\S]*?)```/);
  if (m && /<!DOCTYPE|<html|<body/i.test(m[1])) return m[1].trim();
  if (m) return m[1].trim();
  var i = s.search(/<!DOCTYPE|<html/i);
  if (i >= 0) {
    var tail = s.slice(i);
    var j = tail.lastIndexOf('</html>');
    return j >= 0 ? tail.slice(0, j + 7) : tail;
  }
  return '';
}

/* 在对话流末尾追加「打开应用」卡片（不依赖 renderThread 时序） */
function appendFlashAppCard(app) {
  var box = $('convMessages');
  if (!box) return;
  var div = document.createElement('div');
  div.className = 'msg assistant';
  div.innerHTML = '<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;text-align:center;">' +
    '<div style="font-size:32px;margin-bottom:8px;">✨</div>' +
    '<div style="font-size:16px;font-weight:600;margin-bottom:4px;">' + esc(app.name) + '</div>' +
    '<div style="font-size:12px;color:var(--ink-2);margin-bottom:12px;">应用已生成，随时可重新打开</div>' +
    '<button class="btn" style="width:100%;">▶ 打开应用</button></div>';
  var btn = div.querySelector('button');
  btn.onclick = function () { playFlashApp(app); };
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function openFlashApp() {
  $('faDesc').value = ''; $('faMsg').textContent = ''; $('faMsg').className = 'form-msg';
  renderFlashAppList();
  showSheet('flashAppSheet');
}
function renderFlashAppList() {
  var apps = loadFlashApps();
  var box = $('faList');
  if (!apps.length) { box.innerHTML = '<div class="empty" style="padding:12px;">还没有创建的应用</div>'; return; }
  box.innerHTML = apps.map(function (app, i) {
    return '<div class="model-item" style="margin-bottom:6px;">' +
      '<div class="row"><div class="mi-name" style="flex:1;">✨ ' + esc(app.name) + '</div></div>' +
      '<div class="mi-base">' + (app.createdAt || '') + '</div>' +
      '<div class="mi-actions">' +
      '<button class="btn sm ghost" data-fa-idx="' + i + '" data-fa-act="play">▶ 打开</button>' +
      '<button class="btn sm ghost" data-fa-idx="' + i + '" data-fa-act="del" style="color:var(--err);">删除</button>' +
      '</div></div>';
  }).join('');
  box.querySelectorAll('button[data-fa-act]').forEach(function (b) {
    b.addEventListener('click', function () {
      var idx = parseInt(b.dataset.faIdx);
      var apps = loadFlashApps();
      if (b.dataset.faAct === 'play' && apps[idx]) {
        hideSheet('flashAppSheet');
        playFlashApp(apps[idx]);
      } else if (b.dataset.faAct === 'del') {
        if (confirm('删除这个应用？')) {
          apps.splice(idx, 1); saveFlashApps(apps); renderFlashAppList();
        }
      }
    });
  });
}
function runFlashApp() {
  var desc = $('faDesc').value.trim();
  var msg = $('faMsg');
  if (!desc) { msg.textContent = '请描述你想要的应用'; msg.className = 'form-msg err'; return; }

  hideSheet('flashAppSheet');
  var prompt = '你是一位专业的移动端 Web 应用开发者。请根据以下需求，创作一个可以直接在手机浏览器中运行的交互式小应用。\n\n' +
    '【应用需求】' + desc + '\n\n' +
    '【强制要求 - 手机适配】\n' +
    '1. 必须包含 <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">\n' +
    '2. html,body 设置 margin:0;padding:0;width:100%;height:100%;overflow:hidden，禁止横向滚动\n' +
    '3. 应用容器使用 100% 宽高，所有元素在竖屏内完整显示，不超出屏幕\n' +
    '4. 按钮最小尺寸 44×44px，适合手指触摸\n' +
    '5. 字体不小于 14px，使用 touchstart/touchend 事件，禁止只支持鼠标\n' +
    '6. 禁止使用 alert/confirm/prompt，用应用内 UI 替代\n\n' +
    '【应用内容要求】\n' +
    '1. 完整的单文件 HTML，所有 CSS/JS 内联，不引用外部资源（CDN/图片/字体）\n' +
    '2. 视觉精美，有渐变色、圆角、阴影、动画效果\n' +
    '3. 功能完整可交互，有输入/按钮/结果展示\n' +
    '4. 用 Web Audio API 生成简单音效（可选）\n' +
    '5. 这是一个工具/娱乐类应用，不是游戏\n\n' +
    '【输出要求】\n' +
    '直接输出完整的 HTML 代码，用 ```html 包裹，不要输出任何解释文字。';

  var task = createTask('✨ ' + desc.slice(0, 20), 'flashapp');
  state.currentTaskId = task.id;
  task.messages.push({ role: 'user', content: prompt });
  task.status = 'running';
  saveTasks();
  switchPage('convPage');
  renderThread(task);

  var messages = [{ role: 'user', content: prompt }];
  var assistantContent = '';
  var box = $('convMessages');
  var msgEl = document.createElement('div');
  msgEl.className = 'msg assistant';
  msgEl.innerHTML = '<span style="color:var(--ink-2);">✨ 正在生成应用，请稍候…</span> <span class="typing-cursor">▋</span>';
  box.appendChild(msgEl);
  box.scrollTop = box.scrollHeight;

  callModelStream(messages,
    function (delta) {
      assistantContent += delta;
      msgEl.innerHTML = '<span style="color:var(--ink-2);">✨ 正在生成应用…</span> <span class="typing-cursor">▋</span>';
      box.scrollTop = box.scrollHeight;
    },
    function (full) {
      var html = extractHtmlFromMarkdown(full || assistantContent);
      if (html) {
        var appName = desc.slice(0, 15) + '应用';
        var apps = loadFlashApps();
        var app = { name: appName, desc: desc, html: html, createdAt: new Date().toLocaleString() };
        apps.unshift(app);
        saveFlashApps(apps);
        appendAssistantMessage(task.id, '【闪应用已创建】' + appName + '，已直接打开应用界面');
        // 先持久化渲染对话流，再追加可重开卡片，最后立即全屏打开渲染好的应用界面（全程不展示任何 HTML）
        renderThread(getTask(task.id));
        appendFlashAppCard(app);
        setTimeout(function () { playFlashApp(app); }, 350);
      } else {
        msgEl.innerHTML = '<div style="color:var(--err);">❌ 未能生成应用界面，请重试</div>';
        appendAssistantMessage(task.id, '闪应用创建失败：未能生成应用界面');
        renderThread(getTask(task.id));
        var rb = $('faRetryBtn');
        if (!rb) {
          var box2 = $('convMessages');
          if (box2) {
            var rdiv = document.createElement('div');
            rdiv.className = 'msg assistant';
            rdiv.innerHTML = '<button class="btn" id="faRetryBtn" style="width:100%;">🔄 重新生成</button>';
            box2.appendChild(rdiv);
            rb = $('faRetryBtn');
          }
        }
        if (rb) rb.onclick = function () { $('faDesc').value = desc; runFlashApp(); };
      }
      updateSendBtn(false);
    },
    function (err) {
      msgEl.innerHTML = '<div style="color:var(--err);white-space:pre-wrap;">❌ 生成失败：' + esc(friendlyError(err)) + '</div>';
      task.status = 'failed'; task.error = err.message; saveTasks();
      updateSendBtn(false);
    }
  );
  updateSendBtn(true);
}
function playFlashApp(app) {
  if (!app || !app.html) return;
  // 手机适配注入
  var mobileAdapt = '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">' +
    '<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;-webkit-overflow-scrolling:touch;touch-action:manipulation;}*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}</style>';
  var html = app.html;
  if (/<meta[^>]*name=["']viewport["'][^>]*>/i.test(html)) {
    html = html.replace(/<meta[^>]*name=["']viewport["'][^>]*>/i, mobileAdapt.split('>')[0] + '>');
  } else if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, '$&' + mobileAdapt);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/<html[^>]*>/i, '$&<head>' + mobileAdapt + '</head>');
  } else {
    html = '<!DOCTYPE html><html><head>' + mobileAdapt + '</head><body>' + html + '</body></html>';
  }

  var runner = document.createElement('div');
  runner.className = 'game-runner';
  runner.innerHTML = '<div class="game-runner-header">' +
    '<div class="game-runner-title">✨ ' + esc(app.name || '闪应用') + '</div>' +
    '<button class="game-runner-close">✕ 退出</button></div>' +
    '<div class="game-runner-stage"></div>';
  document.body.appendChild(runner);
  var stage = runner.querySelector('.game-runner-stage');
  var iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;background:#fff;';
  iframe.sandbox = 'allow-scripts allow-same-origin allow-pointer-lock allow-modals allow-popups allow-forms allow-downloads';
  var fallbackShown = false;
  // 白屏兜底：srcdoc 在个别 WebView 渲染失败时自动切换为 blob URL 重新加载
  iframe.onload = function () {
    if (fallbackShown) return;
    setTimeout(function () {
      try {
        var doc = iframe.contentDocument;
        var h = doc && doc.body ? doc.body.scrollHeight : 0;
        if (h <= 0) {
          fallbackShown = true;
          var blob = new Blob([html], { type: 'text/html' });
          iframe.src = URL.createObjectURL(blob);
        }
      } catch (e) {}
    }, 1500);
  };
  iframe.srcdoc = html;
  stage.appendChild(iframe);
  runner.querySelector('.game-runner-close').onclick = function () {
    document.body.removeChild(runner);
  };
}

/* ========== AI 创作中心（文生图/文生视频） ========== */
var APP_VER = 'v8.4.2';
var LS_CREATIVE = 'fh.app.creative';
var creativeConfig = { t2i: {}, t2v: {} };
function loadCreativeConfig() {
  try {
    var raw = localStorage.getItem(LS_CREATIVE);
    if (raw) creativeConfig = JSON.parse(raw);
  } catch (e) { creativeConfig = { t2i: {}, t2v: {} }; }
  if (!creativeConfig.t2i) creativeConfig.t2i = {};
  if (!creativeConfig.t2v) creativeConfig.t2v = {};
}
function saveCreativeConfig() {
  try { localStorage.setItem(LS_CREATIVE, JSON.stringify(creativeConfig)); } catch (e) {}
}
function openCreateCenter() {
  showSheet('createSheet');
  // 初始化 tab 切换
  document.querySelectorAll('.create-tab').forEach(function (tab) {
    tab.onclick = function () {
      document.querySelectorAll('.create-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      document.querySelectorAll('.create-panel').forEach(function (p) { p.classList.add('hidden'); });
      $('ctab-' + tab.dataset.ctab).classList.remove('hidden');
    };
  });
  // 文生视频参考图上传绑定
  bindRefUpload();
}
var t2vRefData = null;
function bindRefUpload() {
  var upload = $('t2vRefUpload');
  if (!upload || upload.__bound) return;
  upload.__bound = true;
  upload.onclick = function () { $('t2vRefFile').click(); };
  $('t2vRefFile').onchange = function (e) {
    var file = e.target.files[0];
    if (!file) return;
    if (file.type.indexOf('image/') !== 0) { toast('请选择图片文件'); return; }
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var scale = 1;
        if (img.width > 1024 || img.height > 1024) scale = 1024 / Math.max(img.width, img.height);
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        t2vRefData = canvas.toDataURL('image/jpeg', 0.9);
        $('t2vRefPreview').innerHTML = '<img src="' + t2vRefData + '" style="max-height:140px;width:100%;object-fit:cover;border-radius:8px;">' +
          '<div style="text-align:right;margin-top:2px;"><span style="font-size:10px;color:var(--ink-2);" onclick="clearRefImage()">✕ 移除</span></div>';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
}
function clearRefImage() {
  t2vRefData = null;
  var p = $('t2vRefPreview');
  if (p) p.innerHTML = '🖼️ 参考图（可选，让画面更贴近参考）<br><span style="font-size:10px;opacity:.7">点击上传，最多 1 张</span>';
}

/* 文生图：OpenAI 兼容 /images/generations */
function genText2Image() {
  var prompt = $('t2iPrompt').value.trim();
  if (!prompt) { toast('请输入图片描述'); return; }
  var cfg = creativeConfig.t2i;
  if (!cfg.apiBase || !cfg.apiKey || !cfg.modelId) { toast('请先在设置中配置文生图模型'); return; }
  var size = $('t2iSize').value;
  var result = $('t2iResult');
  var msg = $('t2iMsg');
  msg.textContent = '';
  result.innerHTML = '<div class="gen-loading"><div class="spinner"></div><div>正在生成图片，请稍候…</div></div>';
  $('t2iBtn').disabled = true;
  var xhr = new XMLHttpRequest();
  xhr.open('POST', cfg.apiBase.replace(/\/+$/, '') + '/images/generations', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer ' + cfg.apiKey);
  xhr.timeout = 120000;
  xhr.onload = function () {
    $('t2iBtn').disabled = false;
    try {
      var data = JSON.parse(xhr.responseText);
      var url = data.data && data.data[0] && (data.data[0].url || data.data[0].b64_json);
      if (url) {
        if (url.indexOf('data:') !== 0 && url.indexOf('http') !== 0) url = 'data:image/png;base64,' + url;
        result.innerHTML = '<img src="' + url + '" alt="生成图片"><div style="text-align:center;margin-top:8px;"><a href="' + url + '" download="feihong-ai.png" style="font-size:12px;color:var(--accent);">⬇️ 保存图片</a></div>';
        GameKit.beep(800, 80, 0.04);
      } else {
        result.innerHTML = '';
        msg.textContent = '❌ ' + (data.error && data.error.message ? data.error.message : '生成失败，请重试');
      }
    } catch (e) {
      result.innerHTML = '';
      msg.textContent = '❌ 解析响应失败：' + e.message;
    }
  };
  xhr.onerror = function () { $('t2iBtn').disabled = false; result.innerHTML = ''; msg.textContent = '❌ 网络错误，请检查 API 地址'; };
  xhr.ontimeout = function () { $('t2iBtn').disabled = false; result.innerHTML = ''; msg.textContent = '⏱️ 生成超时（120秒），请重试'; };
  xhr.send(JSON.stringify({ model: cfg.modelId, prompt: prompt, n: 1, size: size, response_format: 'url' }));
}

/* 文生视频：agnes-video-2.5-flash 正确契约 = seconds(字符串) + size:720P + aspect_ratio + mode + 参考图 */
function genText2Video() {
  var prompt = $('t2vPrompt').value.trim();
  if (!prompt) { toast('请输入视频描述'); return; }
  var cfg = creativeConfig.t2v;
  if (!cfg.apiBase || !cfg.apiKey || !cfg.modelId) { toast('请先在设置中配置文生视频模型，或点「一键填充 Agnes」'); return; }
  var duration = $('t2vDuration').value;
  var ratio = $('t2vRatio').value;
  var result = $('t2vResult');
  var msg = $('t2vMsg');
  msg.textContent = '';
  result.innerHTML = '<div class="gen-loading"><div class="spinner"></div><div>正在生成视频（' + duration + ' 秒），可能需要 1-3 分钟…</div></div>';
  $('t2vBtn').disabled = true;

  var body = {
    model: cfg.modelId,
    prompt: prompt,
    seconds: String(parseInt(duration) || 5),
    size: '720P',
    aspect_ratio: ratio || '16:9'
  };
  if (t2vRefData) {
    body.mode = 'reference';
    body.image = t2vRefData;
  } else {
    body.mode = 'text';
  }

  var xhr = new XMLHttpRequest();
  xhr.open('POST', cfg.apiBase.replace(/\/+$/, '') + '/videos', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer ' + cfg.apiKey);
  xhr.timeout = 180000;
  xhr.onload = function () {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        var data = JSON.parse(xhr.responseText);
        var taskId = data.id || (data.data && data.data.id);
        if (taskId) {
          result.innerHTML = '<div class="gen-loading"><div class="spinner"></div><div>视频生成中，任务已提交<br>正在查询进度…</div></div>';
          pollVideoTask(cfg, taskId, result, msg, 't2vBtn', 0);
        } else {
          $('t2vBtn').disabled = false;
          result.innerHTML = '';
          msg.textContent = '❌ ' + (data.error && data.error.message ? data.error.message : '响应中未找到任务ID：' + xhr.responseText.slice(0, 200));
        }
      } catch (e) {
        $('t2vBtn').disabled = false;
        result.innerHTML = '';
        msg.textContent = '❌ 解析响应失败：' + e.message;
      }
    } else {
      $('t2vBtn').disabled = false;
      result.innerHTML = '';
      msg.textContent = '❌ HTTP ' + xhr.status + '：' + (xhr.responseText || '').slice(0, 300);
    }
  };
  xhr.onerror = function () { $('t2vBtn').disabled = false; result.innerHTML = ''; msg.textContent = '❌ 网络错误，请检查 API 地址'; };
  xhr.ontimeout = function () { $('t2vBtn').disabled = false; result.innerHTML = ''; msg.textContent = '⏱️ 请求超时（3分钟），请重试'; };
  xhr.send(JSON.stringify(body));
}

/* 轮询视频任务：GET {base}/agnesapi?video_id= 或 /videos/{task_id}（2.5-flash 契约） */
function pollVideoTask(cfg, videoId, resultEl, msgEl, btnId, attempts) {
  if (attempts > 120) {
    $(btnId).disabled = false;
    resultEl.innerHTML = '';
    msgEl.textContent = '⏱️ 任务超时，请稍后在 Agnes 平台查看结果';
    return;
  }
  setTimeout(function () {
    var xhr = new XMLHttpRequest();
    var base = cfg.apiBase.replace(/\/+$/, '');
    // 兼容：/v1/agnesapi?video_id= 与旧版 /videos/{id}
    var url = base + '/agnesapi?video_id=' + encodeURIComponent(videoId);
    xhr.open('GET', url, true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + cfg.apiKey);
    xhr.timeout = 30000;
    xhr.onload = function () {
      try {
        var data = JSON.parse(xhr.responseText);
        var status = data.status || (data.data && data.data.status) || '';
        // 视频地址兼容多种返回结构
        var url2 = data.video_url || data.url ||
          (data.data && (data.data.video_url || data.data.url)) ||
          (data.metadata && (data.metadata.url || data.metadata.video_url)) ||
          (data.output && data.output.url) ||
          (data.result && data.result.url);
        if (url2) {
          resultEl.innerHTML = '<video src="' + url2 + '" controls playsinline style="width:100%;border-radius:12px;"></video>' +
            '<div style="text-align:center;margin-top:8px;"><a href="' + url2 + '" download="feihong-ai.mp4" style="font-size:12px;color:var(--accent);">⬇️ 保存视频</a></div>';
          msgEl.textContent = '✅ 视频生成完成';
          GameKit.beep(800, 80, 0.04);
          $(btnId).disabled = false;
          return;
        }
        if (status === 'failed' || status === 'error' || data.error) {
          $(btnId).disabled = false;
          resultEl.innerHTML = '';
          msgEl.textContent = '❌ 任务失败：' + ((data.error && data.error.message) || status || '未知错误');
          return;
        }
        if (status === 'succeeded' || status === 'completed' || status === 'success') {
          $(btnId).disabled = false;
          resultEl.innerHTML = '';
          msgEl.textContent = '⚠️ 任务完成但未获取到视频地址';
          return;
        }
        resultEl.innerHTML = '<div class="gen-loading"><div class="spinner"></div><div>生成中… ' + Math.min(attempts + 1, 120) + '/120</div></div>';
        pollVideoTask(cfg, videoId, resultEl, msgEl, btnId, attempts + 1);
      } catch (e) {
        resultEl.innerHTML = '<div class="gen-loading"><div class="spinner"></div><div>生成中… ' + Math.min(attempts + 1, 120) + '/120</div></div>';
        pollVideoTask(cfg, videoId, resultEl, msgEl, btnId, attempts + 1);
      }
    };
    xhr.onerror = function () {
      // 网络抖动：继续轮询
      resultEl.innerHTML = '<div class="gen-loading"><div class="spinner"></div><div>连接中断，重试中… ' + Math.min(attempts + 1, 120) + '/120</div></div>';
      pollVideoTask(cfg, videoId, resultEl, msgEl, btnId, attempts + 1);
    };
    xhr.ontimeout = function () { pollVideoTask(cfg, videoId, resultEl, msgEl, btnId, attempts + 1); };
    xhr.send();
  }, 8000);
}

/* 一键填充 Agnes 创作模型（文生图 agnes-image-2.5-flash + 文生视频 agnes-video-2.5-flash） */
function fillAgnesVideo() {
  var base = 'https://api.agnes-ai.cn/v1';
  var key = ''; // 安全策略：不内置明文 API Key，请在此填写你自己的 Agnes Key（设置→大模型→创作模型 也可配置）
  $('cgT2IBase').value = base;
  $('cgT2IKey').value = key;
  $('cgT2IModel').value = 'agnes-image-2.5-flash';
  $('cgT2VBase').value = base;
  $('cgT2VKey').value = key;
  $('cgT2VModel').value = 'agnes-video-2.5-flash';
  // 同时加入自定义模型列表，方便对话使用
  var ms = [
    { id: 'agnes_image_2_5', modelId: 'agnes-image-2.5-flash', name: 'Agnes-Image-2.5（文生图）', apiBase: base, apiKey: key, reasoning: '' },
    { id: 'agnes_video_2_5', modelId: 'agnes-video-2.5-flash', name: 'Agnes-Video-2.5（文生视频）', apiBase: base, apiKey: key, reasoning: '' }
  ];
  var added = 0;
  ms.forEach(function (m) {
    var exists = state.models.find(function (x) { return x.id === m.id; });
    if (!exists) { state.models.push(m); added++; }
  });
  if (added > 0) { saveModels(); if (typeof renderModelList === 'function') renderModelList(); }
  $('cgMsg').textContent = '已填充 Agnes 文生图+文生视频并加入模型列表，点保存配置后即可使用';
  $('cgMsg').className = 'form-msg ok';
}

/* 保存创作模型配置 */
function saveCreativeFromForm() {
  creativeConfig.t2i = {
    apiBase: $('cgT2IBase').value.trim(),
    apiKey: $('cgT2IKey').value.trim(),
    modelId: $('cgT2IModel').value.trim()
  };
  creativeConfig.t2v = {
    apiBase: $('cgT2VBase').value.trim(),
    apiKey: $('cgT2VKey').value.trim(),
    modelId: $('cgT2VModel').value.trim()
  };
  saveCreativeConfig();
  $('cgMsg').textContent = '✅ 创作配置已保存';
  setTimeout(function () { $('cgMsg').textContent = ''; }, 2000);
}

/* 一键填充硅基流动文生图 */
function fillSiliconFlowT2I() {
  $('cgT2IBase').value = 'https://api.siliconflow.cn/v1';
  $('cgT2IModel').value = 'stabilityai/stable-diffusion-xl-base-1.0';
  $('cgMsg').textContent = '已填充硅基流动文生图，请填写 API Key 后保存';
}

/* 加载创作配置到表单 */
function fillCreativeForm() {
  $('cgT2IBase').value = creativeConfig.t2i.apiBase || '';
  $('cgT2IKey').value = creativeConfig.t2i.apiKey || '';
  $('cgT2IModel').value = creativeConfig.t2i.modelId || '';
  $('cgT2VBase').value = creativeConfig.t2v.apiBase || '';
  $('cgT2VKey').value = creativeConfig.t2v.apiKey || '';
  $('cgT2VModel').value = creativeConfig.t2v.modelId || '';
}

/* ========== 免密网络层状态与测试 ========== */
function renderKeylessStatus() {
  var box = $('keylessStatus');
  if (!box) return;
  var s = getKeylessStatus();
  var html = '<div style="font-weight:600;margin-bottom:4px;">✅ 免密层已启用 · 当前节点：' + esc(s.activeNode) + '</div>';
  html += '<div style="color:var(--ink-2);">厂商：' + esc(s.activeVendor) + ' · 环形池：' + s.poolSize + ' 节点</div>';
  html += '<div style="margin-top:6px;color:var(--ink-2);">';
  s.nodes.forEach(function (n) {
    var status = n.cooldown > 0 ? '⏳冷却' + n.cooldown + 's' : (n.failures > 0 ? '⚠️失败' + n.failures + '次' : '✅正常');
    html += '<div>· ' + esc(n.name) + ' — ' + status + '</div>';
  });
  html += '</div>';
  html += '<div style="margin-top:6px;color:var(--ink-2);">🧠 Hermes 记忆：' + s.memoryCount + ' 条 · 技能：' + s.skillCount + ' 个</div>';
  box.innerHTML = html;
}
function testKeylessChat() {
  var btn = $('keylessTestBtn');
  btn.disabled = true;
  btn.textContent = '测试中…';
  var msgs = [{ role: 'user', content: '你好，请用一句话介绍你自己' }];
  var full = '';
  keylessChat(msgs,
    function (delta) { full += delta; },
    function (result) {
      btn.disabled = false;
      btn.textContent = '🧪 测试免密聊天';
      var box = $('keylessStatus');
      box.innerHTML += '<div style="margin-top:8px;padding:8px;background:var(--bg-1);border-radius:6px;color:var(--ok);"><b>✅ 免密聊天成功：</b>' + esc(result.slice(0, 200)) + '</div>';
    },
    function (err) {
      btn.disabled = false;
      btn.textContent = '🧪 测试免密聊天';
      var box = $('keylessStatus');
      box.innerHTML += '<div style="margin-top:8px;padding:8px;background:var(--bg-1);border-radius:6px;color:var(--err);"><b>❌ 测试失败：</b>' + esc(err.message) + '</div>';
    }
  );
}
function testKeylessSearch() {
  var q = $('keylessSearchInput').value.trim();
  if (!q) { toast('请输入搜索关键词'); return; }
  var btn = $('keylessSearchBtn');
  btn.disabled = true;
  btn.textContent = '搜索中…';
  keylessSearch(q, function (results) {
    btn.disabled = false;
    btn.textContent = '搜索';
    var text = formatSearchResults(results, q);
    $('keylessSearchResult').textContent = text;
  });
}

/* ========== Hermes Agent 面板 ========== */
function initHermesPanel() {
  // 注入 LLM 调用器到 SkillManager（用于 LLM 辅助技能提炼）
  try {
    if (typeof SkillManager !== 'undefined') {
      SkillManager.setModelCaller(function (prompt, callback) {
        // 使用当前默认模型进行非流式调用
        var model = getDefaultModel();
        if (!model) { callback(''); return; }
        var xhr = new XMLHttpRequest();
        xhr.open('POST', model.apiBase.replace(/\/$/, '') + '/chat/completions', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        if (model.apiKey) xhr.setRequestHeader('Authorization', 'Bearer ' + model.apiKey);
        xhr.onload = function () {
          try {
            var data = JSON.parse(xhr.responseText);
            var content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
            callback(content || '');
          } catch (e) { callback(''); }
        };
        xhr.onerror = function () { callback(''); };
        xhr.ontimeout = function () { callback(''); };
        xhr.timeout = 30000;
        xhr.send(JSON.stringify({
          model: model.modelId,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 1000,
          stream: false
        }));
      });
    }
  } catch (e) { /* LLM 注入失败不影响基础功能 */ }

  // Tab 切换
  document.querySelectorAll('[data-htab]').forEach(function (tab) {
    tab.onclick = function () {
      document.querySelectorAll('[data-htab]').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      document.querySelectorAll('[id^="htab-"]').forEach(function (p) { p.classList.add('hidden'); });
      var panel = $('htab-' + tab.dataset.htab);
      if (panel) panel.classList.remove('hidden');
      if (tab.dataset.htab === 'memory') renderHermesMemory();
      if (tab.dataset.htab === 'skills') renderHermesSkills();
      if (tab.dataset.htab === 'schedule') renderHermesSchedule();
    };
  });
  // 记忆面板
  var mr = $('hermesMemRefreshBtn');
  if (mr) mr.onclick = renderHermesMemory;
  var ms = $('hermesMemSaveBtn');
  if (ms) ms.onclick = saveHermesMemory;
  // 技能面板
  var sr = $('hermesSkillRefreshBtn');
  if (sr) sr.onclick = renderHermesSkills;
  var si = $('hermesSkillInstallBtn');
  if (si) si.onclick = installHermesSkill;
  // 调度面板
  var scr = $('hermesSchedRefreshBtn');
  if (scr) scr.onclick = renderHermesSchedule;
  var sca = $('hermesSchedAddBtn');
  if (sca) sca.onclick = addHermesSchedule;
  // 初始渲染
  renderHermesMemory();
}

function renderHermesMemory() {
  if (typeof MemoryManager === 'undefined') return;
  var md = $('hermesMemoryMD');
  var ud = $('hermesUserMD');
  var stats = $('hermesMemStats');
  if (md) md.value = MemoryManager.getMemoryMD();
  if (ud) ud.value = MemoryManager.getUserMD();
  if (stats) {
    var hist = MemoryManager.getHistory();
    var ctx = MemoryManager.getAllContexts();
    stats.textContent = '历史任务：' + hist.length + ' 条 · 项目上下文：' + Object.keys(ctx).length + ' 个 · 自动沉淀中';
  }
}

function saveHermesMemory() {
  if (typeof MemoryManager === 'undefined') return;
  var md = $('hermesMemoryMD');
  var ud = $('hermesUserMD');
  if (md) MemoryManager.updateMemoryMD(md.value);
  if (ud) MemoryManager.updateUserMD(ud.value);
  toast('✅ 记忆已保存');
}

function renderHermesSkills() {
  if (typeof SkillManager === 'undefined') return;
  var box = $('hermesSkillList');
  if (!box) return;
  var skills = SkillManager.getAll();
  if (!skills.length) { box.innerHTML = '<div style="padding:12px;text-align:center;color:var(--ink-2);font-size:12px;">暂无技能，将从对话中自动提炼</div>'; return; }
  box.innerHTML = skills.map(function (s) {
    return '<div style="padding:8px;border-bottom:1px solid var(--border);font-size:12px;">' +
      '<div style="font-weight:600;">' + esc(s.name) + (s.builtin ? ' <span style="color:var(--ok);font-size:10px;">内置</span>' : (s.autoExtracted ? ' <span style="color:var(--warn);font-size:10px;">自动</span>' : '')) + '</div>' +
      '<div style="color:var(--ink-2);margin:2px 0;">' + esc(s.description || '').slice(0, 60) + '</div>' +
      '<div style="color:var(--ink-3);font-size:10px;">触发：' + esc(s.trigger || '').slice(0, 30) + ' · 使用' + (s.useCount || 0) + '次</div>' +
      (s.builtin ? '' : '<button onclick="SkillManager.remove(\'' + s.id + '\');renderHermesSkills();" style="color:var(--err);font-size:11px;background:none;border:none;cursor:pointer;margin-top:2px;">删除</button>') +
      '</div>';
  }).join('');
}

function installHermesSkill() {
  if (typeof SkillManager === 'undefined') return;
  var input = $('hermesSkillInstall');
  if (!input || !input.value.trim()) { toast('请输入技能 JSON'); return; }
  try {
    var data = JSON.parse(input.value);
    var ok = SkillManager.install(data);
    if (ok) { toast('✅ 技能已安装：' + data.name); input.value = ''; renderHermesSkills(); }
    else toast('❌ 安装失败');
  } catch (e) { toast('❌ JSON 格式错误：' + e.message); }
}

function renderHermesSchedule() {
  if (typeof Scheduler === 'undefined') return;
  var box = $('hermesScheduleList');
  if (!box) return;
  var tasks = Scheduler.getAll();
  if (!tasks.length) { box.innerHTML = '<div style="padding:12px;text-align:center;color:var(--ink-2);font-size:12px;">暂无定时任务</div>'; return; }
  box.innerHTML = tasks.map(function (t) {
    var next = new Date(t.schedule.nextRun);
    return '<div style="padding:8px;border-bottom:1px solid var(--border);font-size:12px;">' +
      '<div style="font-weight:600;">' + esc(t.name) + (t.enabled ? '' : ' <span style="color:var(--err);">已禁用</span>') + '</div>' +
      '<div style="color:var(--ink-2);margin:2px 0;">' + esc(t.expression) + ' → ' + esc(t.prompt.slice(0, 30)) + '</div>' +
      '<div style="color:var(--ink-3);font-size:10px;">下次：' + next.toLocaleString() + ' · 已执行' + t.runCount + '次</div>' +
      '<div style="margin-top:4px;">' +
      '<button onclick="Scheduler.toggle(\'' + t.id + '\');renderHermesSchedule();" style="font-size:11px;background:none;border:none;cursor:pointer;color:var(--accent);margin-right:8px;">' + (t.enabled ? '禁用' : '启用') + '</button>' +
      '<button onclick="Scheduler.remove(\'' + t.id + '\');renderHermesSchedule();" style="font-size:11px;background:none;border:none;cursor:pointer;color:var(--err);">删除</button>' +
      '</div></div>';
  }).join('');
}

function addHermesSchedule() {
  if (typeof Scheduler === 'undefined') return;
  var time = $('hermesSchedTime').value.trim();
  var prompt = $('hermesSchedPrompt').value.trim();
  var msg = $('hermesSchedMsg');
  if (!time || !prompt) { if (msg) msg.textContent = '❌ 请填写时间和任务内容'; return; }
  var result = Scheduler.create(time, prompt);
  if (result.success) {
    if (msg) { msg.textContent = '✅ 已创建：' + result.task.name; msg.className = 'form-msg ok'; }
    $('hermesSchedTime').value = '';
    $('hermesSchedPrompt').value = '';
    renderHermesSchedule();
  } else {
    if (msg) { msg.textContent = '❌ ' + result.error; msg.className = 'form-msg'; }
  }
}

/* ========== 附件处理（图片最多20张 + 文件） ========== */
var state_attach = null; // 文件附件 { type:'file', name, data, mime, isText }
var state_attach_images = []; // 图片附件数组 [{name, data, mime}]

/* 图片压缩：最长边 1280px，JPEG 质量 0.8，防内存溢出 */
function compressImage(dataUrl, maxSide, quality, cb) {
  try {
    var img = new Image();
    img.onload = function () {
      var w = img.width, hgt = img.height;
      var scale = 1;
      if (w > maxSide || hgt > maxSide) scale = maxSide / Math.max(w, hgt);
      var tw = Math.round(w * scale), th = Math.round(hgt * scale);
      var canvas = document.createElement('canvas');
      canvas.width = tw; canvas.height = th;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, tw, th);
      try { cb(canvas.toDataURL('image/jpeg', quality)); }
      catch (e) { cb(dataUrl); }
    };
    img.onerror = function () { cb(dataUrl); };
    img.src = dataUrl;
  } catch (e) { cb(dataUrl); }
}

/* 添加图片（多选）：压缩后存入 state_attach_images，最多 20 张 */
function addAttachImages(fileList) {
  if (!fileList || !fileList.length) return;
  var files = Array.prototype.slice.call(fileList).slice(0, 20);
  var pending = files.length;
  files.forEach(function (file) {
    if (!file.type || file.type.indexOf('image/') !== 0) { pending--; return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      compressImage(e.target.result, 1280, 0.8, function (compressed) {
        if (state_attach_images.length < 20) {
          state_attach_images.push({ name: file.name, data: compressed, mime: 'image/jpeg' });
        }
        pending--;
        if (pending <= 0) renderAttachImgs();
      });
    };
    reader.onerror = function () { pending--; if (pending <= 0) renderAttachImgs(); };
    reader.readAsDataURL(file);
  });
}

/* 渲染多图缩略图预览（点击可全屏查看） */
function renderAttachImgs() {
  var box = $('attachImgs');
  if (!box) return;
  if (!state_attach_images.length) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = 'flex';
  var html = '';
  state_attach_images.forEach(function (img, i) {
    html += '<div style="position:relative;flex-shrink:0;"><img src="' + img.data + '" style="width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid var(--line);" onclick="window.open(this.src)">' +
      '<span onclick="removeAttachImage(' + i + ')" style="position:absolute;top:-6px;right:-6px;background:#f43f5e;color:#fff;width:18px;height:18px;border-radius:50%;font-size:11px;line-height:18px;text-align:center;">✕</span></div>';
  });
  if (state_attach_images.length < 20) {
    html += '<div onclick="document.getElementById(\'imageInput\').click()" style="width:52px;height:52px;border:1.5px dashed var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--ink-2);flex-shrink:0;">＋</div>';
  }
  html += '<span style="font-size:10px;color:var(--ink-2);align-self:flex-end;margin-left:4px;">' + state_attach_images.length + '/20</span>';
  box.innerHTML = html;
}
function removeAttachImage(idx) {
  state_attach_images.splice(idx, 1);
  renderAttachImgs();
}

/* 文件附件（≤20MB，文本读内容，其他 base64） */
function handleFileSelect(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { toast('文件过大，请选择 20MB 以内的文件'); return; }
  var reader = new FileReader();
  reader.onload = function (e) {
    var isText = /\.(txt|md|csv|json|js|css|html|py|java|c|cpp|xml|yml|yaml|log)$/i.test(file.name);
    state_attach = {
      type: 'file', name: file.name,
      data: e.target.result,
      mime: file.type || 'application/octet-stream',
      isText: isText
    };
    showAttachPreview('📄 ' + file.name);
  };
  if (/\.txt$|\.md$|\.csv$|\.json$|\.js$|\.css$|\.html$|\.py$|\.java$|\.c$|\.cpp$|\.xml$|\.yml$|\.yaml$|\.log$/i.test(file.name)) {
    reader.readAsText(file);
  } else {
    reader.readAsDataURL(file);
  }
}
function showAttachPreview(text) {
  var preview = $('attachPreview');
  if (!preview) return;
  preview.style.display = 'inline-flex';
  preview.innerHTML = esc(text) + ' <span class="remove-attach" onclick="removeAttach()">✕</span>';
}
function removeAttach() {
  state_attach = null;
  state_attach_images = [];
  var preview = $('attachPreview');
  if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
  renderAttachImgs();
}

function buildAttachPrompt(userText) {
  if (!state_attach) return userText;
  var attach = state_attach;
  var prompt = userText;
  if (attach.type === 'image') {
    prompt = (userText ? userText + '\n\n' : '') + '[附件：图片 ' + attach.name + ']\n' +
      '（图片已作为 base64 数据附加，如需分析图片内容请说明）';
    // 注意：纯文本 API 不支持图片，这里只做提示
  } else if (attach.type === 'file') {
    if (attach.isText) {
      prompt = (userText ? userText + '\n\n' : '') + '[附件文件：' + attach.name + ']\n文件内容如下：\n```\n' + attach.data + '\n```';
    } else {
      prompt = (userText ? userText + '\n\n' : '') + '[附件文件：' + attach.name + ']（二进制文件，大小约 ' + Math.round(attach.data.length / 1024) + 'KB）';
    }
  }
  return prompt;
}

/* ========== 技能中心卡片点击 ========== */
function initSkillCenter() {
  document.querySelectorAll('.skill-card').forEach(function (card) {
    card.addEventListener('click', function () {
      var skill = card.dataset.skill;
      hideSheet('skillCenterSheet');
      if (skill === 'xiaohongshu') { openXiaohongshu(); }
      else if (PLUGINS[skill]) { openPlugin(skill); }
      else { toast('该技能开发中'); }
    });
  });
}

/* ========== 初始化 ========== */
(function init() {
  loadModels();
  loadTasks();
  initHermes(); // Hermes 风格持久记忆 + 技能沉淀
  if (localStorage.getItem(LS_THEME) === 'dark') document.documentElement.classList.add('dark');

  // 顶栏
  $('menuBtn').addEventListener('click', openSidenav);
  $('newChatBtn').addEventListener('click', newChat);

  // 左侧导航
  $('sidenavMask').addEventListener('click', closeSidenav);
  document.querySelectorAll('.sn-menu-item').forEach(function (el) {
    el.addEventListener('click', function () { setSnMenu(el.dataset.menu); });
  });
  $('snSearch').addEventListener('input', renderDocList);
  $('snEditBtn').addEventListener('click', function () { switchPage('taskPage'); closeSidenav(); renderTaskList(); });

  // 右侧设置
  $('snSettingsBtn').addEventListener('click', openDrawer);
  $('drawerClose').addEventListener('click', closeDrawer);
  $('drawerMask').addEventListener('click', closeDrawer);

  // 电脑连接：顶栏胶囊点击打开设置；初始化面板；启动检测 + 30s 心跳
  var connPill = $('connPill');
  if (connPill) connPill.addEventListener('click', openDrawer);
  initPcConnPanel();
  checkAllConns();
  setInterval(checkAllConns, 30000);

  // 功能按钮
  document.querySelectorAll('.q-btn').forEach(function (b) {
    b.addEventListener('click', function () { setFunc(b.dataset.func); });
  });

  // 发送消息（用 onclick 而非 addEventListener，避免与 updateSendBtn 的 onclick 切换重复绑定）
  $('sendBtn').onclick = sendMessage;
  bindRemoteControls();
  $('goalInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $('goalInput').addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 110) + 'px'; });

  // 任务清空（任务页）
  var clearBtn = $('clearTasksBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearAllTasks);

  // 代码任务
  $('fcRunBtn').addEventListener('click', runFixCode);
  $('wcRunBtn').addEventListener('click', runWriteCode);

  // 插件
  $('pluginRunBtn').addEventListener('click', runPlugin);

  // 模型设置
  $('mSaveBtn').addEventListener('click', saveModel);
  $('mResetBtn').addEventListener('click', function () { resetModelForm(false); });
  $('mRestoreBtn').addEventListener('click', restoreBuiltinModels);
  $('mProvider').addEventListener('change', onProviderChange);
  $('mTestBtn').addEventListener('click', testConnection);

  // 视觉模型设置
  $('vlSaveBtn').addEventListener('click', saveVLConfigFromForm);
  $('vlTestBtn').addEventListener('click', testVLConnection);
  $('vlSfBtn').addEventListener('click', function () {
    $('vlApiBase').value = SILICONFLOW_OCR.apiBase;
    $('vlApiKey').value = SILICONFLOW_OCR.apiKey;
    $('vlModelId').value = SILICONFLOW_OCR.modelId;
    $('vlMsg').textContent = '已填充硅基流动 DeepSeek-OCR，请填写你的 API Key 后保存';
    $('vlMsg').className = 'form-msg ok';
  });
  $('vlRestoreBtn').addEventListener('click', function () {
    $('vlApiBase').value = AGNES_VL.apiBase;
    $('vlApiKey').value = AGNES_VL.apiKey;
    $('vlModelId').value = AGNES_VL.modelId;
    $('vlMsg').textContent = '已填充 Agnes 视觉模型，点击保存生效';
    $('vlMsg').className = 'form-msg ok';
  });

  // AI 创作中心
  loadCreativeConfig();
  fillCreativeForm();
  $('t2iBtn').addEventListener('click', genText2Image);
  $('t2vBtn').addEventListener('click', genText2Video);
  $('cgSaveBtn').addEventListener('click', saveCreativeFromForm);
  $('cgSfBtn').addEventListener('click', fillSiliconFlowT2I);
  $('cgAgnesBtn').addEventListener('click', fillAgnesVideo);

  // 免密网络层（Keyless Web Tier）
  $('keylessRefreshBtn').addEventListener('click', renderKeylessStatus);
  $('keylessTestBtn').addEventListener('click', testKeylessChat);
  $('keylessSearchBtn').addEventListener('click', testKeylessSearch);
  $('keylessSearchInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') testKeylessSearch();
  });

  // Hermes Agent（自我进化智能体）
  initHermesPanel();

  // 技能中心
  initSkillCenter();
  $('xhsRunBtn').addEventListener('click', runXiaohongshu);

  // 游戏中心（大卡片点击直接玩，在 renderGameCenter 中绑定）

  // 闪应用
  $('faRunBtn').addEventListener('click', runFlashApp);

  // 附件按钮（图片可多选最多20张；截图功能已移除）
  $('attachImageBtn').addEventListener('click', function () { $('imageInput').click(); });
  $('attachFileBtn').addEventListener('click', function () { $('fileInput').click(); });
  $('attachCameraBtn').addEventListener('click', function () { $('cameraInput').click(); });
  $('imageInput').addEventListener('change', function (e) { addAttachImages(e.target.files); e.target.value = ''; });
  $('fileInput').addEventListener('change', function (e) { handleFileSelect(e.target.files[0]); e.target.value = ''; });
  $('cameraInput').addEventListener('change', function (e) { addAttachImages(e.target.files); e.target.value = ''; });

  // 主题
  $('themeBtn').addEventListener('click', toggleTheme);

  // Sheet 关闭
  document.querySelectorAll('.sheet-mask').forEach(function (m) {
    m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('show'); });
  });

  // 默认页面
  switchPage('convPage');
  renderThread(null);

  // 无模型提示
  if (!state.models.length) {
    setTimeout(function () { toast('首次使用请点左上角 ☰ 菜单，再点底部 ⚙ 设置大模型'); }, 800);
  }
})();
