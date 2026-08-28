/* ============================================================
 * 飞虹 Code 移动版 v1.2 · 纯前端独立 APP
 * 布局：两排滑动功能按钮 + 任务独立页 + 侧边设置抽屉
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
};

/* 插件配置（功能按钮用到） */
var PLUGINS = {
  review: { title: '代码审查', prompt: '请审查以下代码，指出潜在的bug、安全隐患、性能问题和代码规范问题，并给出改进建议：\n\n```\n{code}\n```' },
  explain: { title: '代码解释', prompt: '请用通俗的语言解释以下代码的工作原理和逻辑：\n\n```\n{code}\n```' },
  comments: { title: '添加注释', prompt: '请为以下代码添加清晰的中文注释，解释每段代码的作用和关键逻辑：\n\n```\n{code}\n```' },
  optimize: { title: '代码优化', prompt: '请优化以下代码，提升性能和可读性，保持功能不变，并说明优化点：\n\n```\n{code}\n```' },
  translate: { title: '中英互译', prompt: '请将以下文本翻译为中文（如果是中文则翻译为英文），保持原意和格式：\n\n{code}' },
  regex: { title: '正则生成', prompt: '请根据以下需求生成正则表达式，并说明每个部分的含义和使用示例：\n\n{code}' },
};

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

/* ========== 侧边抽屉 ========== */
function openDrawer() {
  $('drawer').classList.add('show');
  $('drawerMask').classList.add('show');
  renderModelList();
}
function closeDrawer() {
  $('drawer').classList.remove('show');
  $('drawerMask').classList.remove('show');
}

/* ========== 本地存储 ========== */
function loadModels() {
  try { state.models = JSON.parse(localStorage.getItem(LS_MODELS) || '[]'); }
  catch (e) { state.models = []; }
  state.defaultModelId = localStorage.getItem(LS_DEFAULT) || '';
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
function callModelStream(messages, onDelta, onDone, onError) {
  var model = getDefaultModel();
  if (!model) { onError(new Error('请先在「设置 → 大模型」中配置模型')); return; }
  if (!model.apiKey) { onError(new Error('模型 ' + model.name + ' 未配置 API Key')); return; }

  var url = (model.apiBase || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/chat/completions';
  var body = { model: model.id, messages: messages, stream: true, temperature: 0.7 };
  if (model.reasoning) body.reasoning = model.reasoning;

  state.abortController = new AbortController();
  state.streaming = true;

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + model.apiKey },
    body: JSON.stringify(body),
    signal: state.abortController.signal,
  }).then(function (res) {
    if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status + ': ' + (t || res.statusText)); });
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var fullContent = '';
    function read() {
      reader.read().then(function (chunk) {
        if (chunk.done) { state.streaming = false; onDone(fullContent); return; }
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || !line.startsWith('data:')) continue;
          var data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            var json = JSON.parse(data);
            var delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
            if (delta) { fullContent += delta; onDelta(delta); }
          } catch (e) {}
        }
        read();
      }).catch(function (e) {
        state.streaming = false;
        if (e.name === 'AbortError') onDone(fullContent); else onError(e);
      });
    }
    read();
  }).catch(function (e) {
    state.streaming = false;
    if (e.name === 'AbortError') onDone(''); else onError(e);
  });
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
  document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.page === name); });
  if (name === 'taskPage') renderTaskList();
}
document.querySelectorAll('.tab').forEach(function (t) {
  t.addEventListener('click', function () { switchPage(t.dataset.page); });
});

/* ========== 功能按钮切换 ========== */
function setFunc(func) {
  state.currentFunc = func;
  document.querySelectorAll('.func-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.func === func);
  });
  if (func === 'chat') {
    // 对话模式，直接聚焦输入框
    $('goalInput').focus();
  } else if (func === 'fix-code') {
    openFixCode();
  } else if (func === 'write-code') {
    openWriteCode();
  } else if (PLUGINS[func]) {
    openPlugin(func);
  } else if (func === 'more') {
    toast('更多功能开发中');
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
  toast('已删除');
}
function clearAllTasks() {
  if (!confirm('确定清空所有任务？此操作不可恢复。')) return;
  state.tasks = [];
  state.currentTaskId = null;
  saveTasks();
  renderTaskList();
  renderThread(null);
  toast('已清空所有任务');
}
function getTask(id) { return state.tasks.find(function (t) { return t.id === id; }); }
function renderTaskList() {
  var box = $('taskList');
  if (!box) return;
  var list = state.tasks.slice(0, 100);
  if (!list.length) { box.innerHTML = '<div class="empty">暂无任务，去对话页发起一个吧</div>'; return; }
  var typeIcon = { chat: '💬', 'fix-code': '🔧', 'write-code': '✍️', plugin: '🔌' };
  box.innerHTML = list.map(function (t) {
    return '<div class="card task-card" data-id="' + esc(t.id) + '">' +
      '<div class="row">' +
        '<span class="task-icon">' + (typeIcon[t.type] || '💬') + '</span>' +
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

/* ========== 对话渲染 ========== */
function renderThread(task) {
  var box = $('convMessages');
  var goalEl = $('convGoal'), stEl = $('convStatus');
  if (!task) {
    if (goalEl) goalEl.textContent = '新对话';
    if (stEl) stEl.style.display = 'none';
    box.innerHTML = '<div class="empty">选择上方功能，或直接输入指令开始对话<br>支持代码生成、修复、审查等</div>';
    return;
  }
  if (goalEl) goalEl.textContent = task.goal.length > 30 ? task.goal.slice(0, 30) + '…' : task.goal;
  if (stEl) { stEl.style.display = 'inline-block'; stEl.className = 'badge ' + task.status; stEl.textContent = task.status === 'running' ? '生成中' : task.status === 'done' ? '已完成' : task.status; }
  var msgs = task.messages || [];
  if (!msgs.length) { box.innerHTML = '<div class="empty">任务已创建，等待回复…</div>'; return; }
  var html = '';
  msgs.forEach(function (m) {
    if (m.role === 'user') html += '<div class="msg user">' + esc(m.content) + '</div>';
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
function sendMessage() {
  var input = $('goalInput');
  var text = input.value.trim();
  if (!text) return;
  if (state.streaming) { toast('正在生成中，请稍候或点击停止'); return; }
  var model = getDefaultModel();
  if (!model) { toast('请先配置大模型'); openDrawer(); return; }

  var task;
  if (!state.currentTaskId || !getTask(state.currentTaskId)) {
    task = createTask(text, 'chat');
    state.currentTaskId = task.id;
  } else {
    task = getTask(state.currentTaskId);
  }
  task.messages.push({ role: 'user', content: text });
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
  msgEl.innerHTML = '<span class="typing-cursor">▋</span>';
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
    },
    function (err) {
      msgEl.innerHTML = '<div style="color:var(--err);">❌ 生成失败：' + esc(err.message) + '</div>';
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
    btn.onclick = function () { stopStreaming(); updateSendBtn(false); toast('已停止生成'); };
  } else {
    btn.textContent = '▶';
    btn.onclick = sendMessage;
  }
}

/* ========== 通用：执行带 prompt 的任务（代码修复/编写/插件） ========== */
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
  msgEl.innerHTML = '<span class="typing-cursor">▋</span>';
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
      msgEl.innerHTML = '<div style="color:var(--err);">❌ 生成失败：' + esc(err.message) + '</div>';
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

/* ========== 模型设置（侧边抽屉） ========== */
function renderModelList() {
  var box = $('modelList');
  if (!box) return;
  if (!state.models.length) { box.innerHTML = '<div class="empty" style="padding:16px;">还没有模型配置，在下方添加一个吧</div>'; return; }
  box.innerHTML = state.models.map(function (m) {
    return '<div class="model-item" data-id="' + esc(m.id) + '">' +
      '<div class="row"><div class="mi-name" style="flex:1;">' + esc(m.name) + (m.id === state.defaultModelId ? ' <span class="badge done">默认</span>' : '') + '</div></div>' +
      '<div class="mi-base">' + esc(m.apiBase || '（未填写 API 地址）') + (m.apiKey ? ' · 已配置密钥' : ' · 未配置密钥') + '</div>' +
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
  $('mName').value = m.name; $('mBase').value = m.apiBase || '';
  $('mKey').value = ''; $('mReasoning').value = m.reasoning || '';
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
  var msg = $('mMsg');
  if (!name) { msg.textContent = '请填写模型名称'; msg.className = 'form-msg err'; return; }
  var editing = $('mSaveBtn').dataset.editing;
  var apiBase = $('mBase').value.trim();
  var apiKey = $('mKey').value.trim();
  var reasoning = $('mReasoning').value.trim();
  if (editing) {
    var m = state.models.find(function (x) { return x.id === editing; });
    if (m) { m.name = name; m.apiBase = apiBase; m.reasoning = reasoning; if (apiKey) m.apiKey = apiKey; }
  } else {
    var newModel = { id: genId(), name: name, apiBase: apiBase, apiKey: apiKey, reasoning: reasoning };
    state.models.push(newModel);
    if (!state.defaultModelId) state.defaultModelId = newModel.id;
  }
  saveModels(); renderModelList(); resetModelForm(true); toast('模型配置已保存');
}
function resetModelForm(keepMsg) {
  if (!keepMsg) { $('mName').value = ''; $('mBase').value = ''; $('mKey').value = ''; $('mReasoning').value = ''; $('mMsg').textContent = ''; $('mMsg').className = 'form-msg'; }
  $('mSaveBtn').dataset.editing = '';
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

/* ========== 初始化 ========== */
(function init() {
  loadModels();
  loadTasks();
  if (localStorage.getItem(LS_THEME) === 'dark') document.documentElement.classList.add('dark');

  // 侧边抽屉
  $('menuBtn').addEventListener('click', openDrawer);
  $('drawerClose').addEventListener('click', closeDrawer);
  $('drawerMask').addEventListener('click', closeDrawer);

  // 新建对话
  $('newChatBtn').addEventListener('click', newChat);

  // 功能按钮
  document.querySelectorAll('.func-btn').forEach(function (b) {
    b.addEventListener('click', function () { setFunc(b.dataset.func); });
  });

  // 发送消息
  $('sendBtn').addEventListener('click', sendMessage);
  $('goalInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $('goalInput').addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px'; });

  // 任务清空
  $('clearTasksBtn').addEventListener('click', clearAllTasks);

  // 代码任务
  $('fcRunBtn').addEventListener('click', runFixCode);
  $('wcRunBtn').addEventListener('click', runWriteCode);

  // 插件
  $('pluginRunBtn').addEventListener('click', runPlugin);

  // 模型设置
  $('mSaveBtn').addEventListener('click', saveModel);
  $('mResetBtn').addEventListener('click', function () { resetModelForm(false); });

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
    setTimeout(function () { toast('首次使用请点右上角 ☰ 设置大模型'); }, 800);
  }
})();
