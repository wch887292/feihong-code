/* ========== 配置与状态 ========== */
// App 内置凭据：用于通过 Nginx Basic Auth 换取会话（与网页版共用账号体系）
var BASIC_AUTH = 'Zmhjb2RlOnZyVktTQm1IUkVCZQ=='; // base64(fhcode:vrVKSBmHREBe)
// 三重加密·第三重（App 端存储加密）：优先 Android Keystore（硬件级加密），浏览器降级 localStorage
var SecureStore = {
  isApp: function () { return !!(window.FhSecureStore && window.FhSecureStore.isApp()); },
  getToken: function () {
    return SecureStore.isApp() ? (window.FhSecureStore.getToken() || '') : (localStorage.getItem('fh.m.token') || '');
  },
  setToken: function (t) {
    if (SecureStore.isApp()) { window.FhSecureStore.saveToken(t); }
    else if (t) { localStorage.setItem('fh.m.token', t); }
    else { localStorage.removeItem('fh.m.token'); }
  },
  clearToken: function () {
    if (SecureStore.isApp()) { window.FhSecureStore.clearToken(); }
    else { localStorage.removeItem('fh.m.token'); }
  },
};
var state = {
  token: SecureStore.getToken(),
  phone: localStorage.getItem('fh.m.phone') || '',
  tasks: [], currentTaskId: null,
  automations: [], templates: { builtin: [], user: [] },
  models: [], defaultModelId: null, modelId: localStorage.getItem('fh.m.model') || '',
  agentType: 'general',
  permissions: JSON.parse(localStorage.getItem('fh.m.perm') || '{"readScope":"workspace","readPath":"","allowRead":true,"allowWrite":false,"allowShell":false,"allowNetwork":true,"allowBrowser":false}'),
  pollTimer: null,
};
var AGENTS = { general: '通用助手', 'fix-code': '修复代码', 'write-code': '编写代码', 'exec-command': '执行命令' };

/* ========== 基础工具 ========== */
function $(id) { return document.getElementById(id); }
function toast(msg) {
  var el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove('show'); }, 2200);
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmtTime(iso) { try { return new Date(iso).toLocaleString(); } catch (e) { return iso || ''; } }
function showSheet(id) { $(id).classList.add('show'); }
function hideSheet(id) { $(id).classList.remove('show'); }
document.querySelectorAll('.sheet-mask').forEach(function (m) {
  m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('show'); });
});

/* ========== API 封装 ========== */
function api(path, method, body, extra) {
  var headers = { 'Content-Type': 'application/json' };
  var opts = { method: method || 'GET', headers: headers };
  if (extra && extra.basic) headers['Authorization'] = 'Basic ' + BASIC_AUTH;
  else if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  if (body) opts.body = JSON.stringify(body);
  return fetch(path, opts).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (d) {
      if (!res.ok) {
        if (res.status === 401 && d.error === 'unauthorized' && state.token) {
          state.token = ''; SecureStore.clearToken();
          showLogin(); toast('登录已过期，请重新登录');
        }
        throw new Error(d.error || ('HTTP ' + res.status));
      }
      return d;
    });
  });
}

/* ========== 登录 ========== */
function showLogin() {
  $('headbar').style.display = 'none'; $('tabbar').style.display = 'none';
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  $('loginPage').classList.add('active');
}
function afterLogin() {
  $('headbar').style.display = 'flex'; $('tabbar').style.display = 'flex';
  $('headPhone').textContent = state.phone; $('sheetPhone').textContent = state.phone;
  switchPage('convPage');
  loadTasks(); loadAutomations(); loadTemplates(); loadModels();
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(loadTasks, 5000);
}
function doLogin() {
  var phone = $('phone').value.trim();
  var st = $('loginStatus');
  if (!/^\d{6,20}$/.test(phone)) { st.textContent = '请输入有效的手机号码'; st.className = 'login-status err'; return; }
  var btn = $('loginBtn'); btn.disabled = true;
  st.textContent = '登录中…'; st.className = 'login-status';
  api('/api/auth/login', 'POST', { phone: phone }, { basic: true })
    .then(function (d) {
      state.token = d.token; state.phone = d.phone || phone;
      SecureStore.setToken(state.token);
      localStorage.setItem('fh.m.phone', state.phone);
      afterLogin(); toast('登录成功');
    })
    .catch(function (e) { st.textContent = '登录失败：' + e.message; st.className = 'login-status err'; })
    .finally(function () { btn.disabled = false; });
}
function logout() {
  SecureStore.clearToken(); localStorage.removeItem('fh.m.phone');
  state.token = ''; showLogin(); toast('已退出登录');
}
$('loginBtn').addEventListener('click', doLogin);
$('phone').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });

/* ========== 页面切换 ========== */
function switchPage(name) {
  document.querySelectorAll('.page').forEach(function (p) { p.classList.toggle('active', p.id === name); });
  document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.page === name); });
  if (name === 'taskPage') loadTasks();
  if (name === 'autoPage') loadAutomations();
  if (name === 'tplPage') loadTemplates();
}
document.querySelectorAll('.tab').forEach(function (t) {
  t.addEventListener('click', function () { switchPage(t.dataset.page); });
});

/* ========== 任务 ========== */
function statusBadge(s) { return '<span class="badge ' + s + '">' + (s === 'queued' ? '排队中' : s === 'running' ? '执行中' : s === 'done' ? '已完成' : s === 'failed' ? '失败' : s) + '</span>'; }
function loadTasks() {
  if (!state.token) return;
  return api('/api/tasks').then(function (d) {
    state.tasks = d.tasks || [];
    renderTaskList();
    if (!state.currentTaskId && state.tasks.length) {
      state.currentTaskId = state.tasks[0].id;
      renderTaskList();
    }
    if (state.currentTaskId) refreshThread();
    else renderThread(null);
  }).catch(function (e) { console.warn('任务加载失败', e); });
}
function renderTaskList() {
  var box = $('taskList');
  var list = (state.tasks || []).slice(0, 50);
  if (!list.length) { box.innerHTML = '<div class="empty">暂无任务，去「对话」页发起一个吧</div>'; return; }
  box.innerHTML = list.map(function (t) {
    var icon = t.status === 'running' ? '⏳' : t.status === 'queued' ? '📥' : t.status === 'failed' ? '❌' : '✅';
    return '<div class="card" style="padding:12px;cursor:pointer;" data-id="' + esc(t.id) + '" data-del="' + esc(t.id) + '">' +
      '<div class="row">' + icon + '<div class="li-title" style="flex:1;">' + esc(t.goal.slice(0, 30)) + (t.goal.length > 30 ? '…' : '') + '</div>' +
      statusBadge(t.status) + '</div>' +
      '<div class="muted" style="margin-top:6px;">' + fmtTime(t.createdAt) + (t.workspaceDir ? ' · ' + esc(t.workspaceDir) : '') + '</div>' +
      '</div>';
  }).join('');
  box.querySelectorAll('.card[data-id]').forEach(function (c) {
    c.addEventListener('click', function () { openTaskDetail(c.dataset.id); });
  });
  // 长按删除
  box.querySelectorAll('.card[data-del]').forEach(function (c) {
    var t0 = 0;
    c.addEventListener('touchstart', function () { t0 = Date.now(); });
    c.addEventListener('touchend', function () { if (Date.now() - t0 > 600) deleteTask(c.dataset.del); });
  });
}
function selectTask(id) {
  state.currentTaskId = id;
  switchPage('convPage');
  refreshThread();
}
function deleteTask(id) {
  if (!confirm('确定删除该任务？')) return;
  api('/api/tasks/' + encodeURIComponent(id), 'DELETE').then(function () {
    state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
    if (state.currentTaskId === id) { state.currentTaskId = null; renderThread(null); }
    renderTaskList(); toast('已删除');
  }).catch(function (e) { toast('删除失败：' + e.message); });
}
function openTaskDetail(id) {
  api('/api/tasks/' + encodeURIComponent(id)).then(function (d) {
    var t = d.task;
    var r = t.result || {};
    var html =
      '<div class="d-row"><b>目标</b><br>' + esc(t.goal) + '</div>' +
      '<div class="d-row"><b>状态</b> ' + statusBadge(t.status) + '</div>' +
      (t.agentType ? '<div class="d-row"><b>智能体</b> ' + esc(AGENTS[t.agentType] || t.agentType) + '</div>' : '') +
      (r.iterations != null ? '<div class="d-row"><b>迭代</b> ' + r.iterations + ' · <b>成本</b> $' + Number(r.costUsd || 0).toFixed(6) + '</div>' : '') +
      (r.finalAnswer ? '<div class="d-row"><b>结果</b><br><pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:13px;">' + esc(r.finalAnswer) + '</pre></div>' : '') +
      (t.error ? '<div class="d-row" style="color:var(--err);"><b>错误</b><br>' + esc(t.error) + '</div>' : '');
    $('taskDetailBody').innerHTML = html;
    showSheet('taskDetailSheet');
  }).catch(function (e) { toast('加载详情失败：' + e.message); });
}

/* ========== 对话与思维链路 ========== */
function linkify(text) {
  var html = esc(text);
  html = html.replace(/(https?:\/\/[^\s<>"'()]+)/g, '<a href="$1" style="color:var(--brand);text-decoration:underline;" target="_blank">$1</a>');
  return html;
}
/* 轻量 Markdown 渲染：代码块 / 行内代码 / 粗体 / 标题 / 列表 / 链接 / 换行 */
function renderMarkdown(text) {
  var html = esc(text == null ? '' : text);
  var codeBlocks = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
    var idx = codeBlocks.length;
    codeBlocks.push('<pre style="background:var(--bg);padding:10px;border-radius:8px;overflow-x:auto;font-size:12px;margin:6px 0;white-space:pre-wrap;word-break:break-word;"><code>' + code + '</code></pre>');
    return '\x00CB' + idx + '\x00';
  });
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg);padding:1px 5px;border-radius:4px;font-size:12px;">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  html = html.replace(/^### (.*)$/gm, '<div style="font-weight:700;margin:8px 0 4px;">$1</div>');
  html = html.replace(/^## (.*)$/gm, '<div style="font-weight:700;font-size:15px;margin:10px 0 4px;">$1</div>');
  html = html.replace(/^# (.*)$/gm, '<div style="font-weight:700;font-size:16px;margin:10px 0 4px;">$1</div>');
  html = html.replace(/^[-*] (.*)$/gm, '<div style="padding-left:14px;">• $1</div>');
  html = html.replace(/^(\d+)\. (.*)$/gm, '<div style="padding-left:20px;">$1. $2</div>');
  html = html.replace(/(https?:\/\/[^\s<>"'()]+)/g, '<a href="$1" style="color:var(--brand);text-decoration:underline;" target="_blank">$1</a>');
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/\x00CB(\d+)\x00/g, function (_, idx) { return codeBlocks[parseInt(idx)]; });
  return html;
}
/* 工具参数格式化为 key: value 列表，替代原始 JSON 字符串 */
function formatArgs(args) {
  if (!args || typeof args !== 'object') return '';
  var keys = Object.keys(args);
  if (!keys.length) return '';
  var rows = keys.map(function (k) {
    var v = args[k];
    if (v == null) v = '';
    else if (typeof v === 'object') v = JSON.stringify(v);
    return '<div><span style="color:var(--ink-2);">' + esc(k) + ':</span> ' + esc(String(v)) + '</div>';
  });
  return '<div class="tc-args">' + rows.join('') + '</div>';
}
function renderThread(task) {
  var box = $('convMessages');
  var goalEl = $('convGoal'), stEl = $('convStatus');
  if (!task) {
    goalEl.textContent = '未选择任务'; stEl.style.display = 'none';
    box.innerHTML = '<div class="empty">点击「＋新建」发起任务，或在下方输入指令<br>全部对话与思维链路将实时展示</div>';
    return;
  }
  goalEl.textContent = task.goal.length > 30 ? task.goal.slice(0, 30) + '…' : task.goal;
  stEl.style.display = 'inline-block'; stEl.className = 'badge ' + task.status;
  stEl.textContent = task.status === 'queued' ? '排队中' : task.status === 'running' ? '执行中' : task.status === 'done' ? '已完成' : task.status === 'failed' ? '失败' : task.status;
  var html = '';
  /* 只提取用户消息（助手/工具消息由 steps 覆盖，避免重复展示） */
  var userMsgs = (task.conversation || []).filter(function (m) {
    return m && m.role === 'user' && (m.content || '').trim();
  });
  var steps = (task.steps || []).filter(function (s) {
    return s.type === 'model.response' || s.type === 'tool.call' || s.type === 'tool.result' || s.type === 'self-heal' || s.type === 'context.compact';
  });
  if (!userMsgs.length && !steps.length) {
    html += '<div class="empty">任务已创建' + (task.status === 'queued' ? '，排队中…' : task.status === 'running' ? '，执行中…' : '') + '</div>';
  }
  /* 用户消息气泡 */
  userMsgs.forEach(function (m) {
    html += '<div class="msg user">' + linkify(m.content) + '</div>';
  });
  /* 思维链路：按 seq 时序排列，最新事件自然在底部 */
  steps.forEach(function (s) {
    var d = s.data || {};
    if (s.type === 'model.response') {
      var content = (d.content || '').toString();
      if (content.trim()) {
        html += '<div class="step reasoning"><div class="step-head">🧠 模型推理' + (d.model ? ' · ' + esc(d.model) : '') + '</div><div class="content">' + renderMarkdown(content) + '</div></div>';
      }
    } else if (s.type === 'tool.call') {
      html += '<div class="step toolcall"><div class="step-head">🔧 调用 ' + esc(d.name || '') + '</div>' + formatArgs(d.args) + '</div>';
    } else if (s.type === 'tool.result') {
      var out = (d.output || '').toString();
      html += '<div class="step result ' + (d.ok ? 'ok' : 'fail') + '"><div class="step-head">' + (d.ok ? '✅' : '❌') + ' ' + esc(d.name || '') + ' ' + (d.ok ? '成功' : '失败') + '</div>' + (out.trim() ? '<div class="content">' + esc(out).slice(0, 500) + '</div>' : '') + '</div>';
    } else if (s.type === 'self-heal') {
      html += '<div class="step"><div class="step-head">🩹 自愈重试</div><div class="content">检测到 <b>' + esc(d.category || '') + '</b> 类错误，已注入反思（第 ' + (d.iteration != null ? d.iteration : '?') + ' 轮）</div></div>';
    } else if (s.type === 'context.compact') {
      html += '<div class="step"><div class="step-head">📦 上下文压缩</div><div class="content">从 ' + (d.originalLength != null ? d.originalLength : '?') + ' 条压缩至 ' + (d.compressedLength != null ? d.compressedLength : '?') + ' 条</div></div>';
    }
  });
  /* 终态展示（始终在最底部） */
  if (task.status === 'done' && task.result && task.result.finalAnswer) {
    html += '<div class="step final"><div class="step-head">📬 最终回复</div><div class="content">' + renderMarkdown(task.result.finalAnswer) + '</div></div>';
  } else if (task.status === 'failed') {
    html += '<div class="step error"><div class="step-head">⛔ 任务失败</div><div class="content">' + esc(task.error || '未知错误') + '</div></div>';
  } else if (task.status === 'running') {
    html += '<div class="step"><div class="step-head">⏳ 执行中</div><div class="content">实时刷新中…</div></div>';
  }
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}
function refreshThread() {
  if (!state.currentTaskId) { renderThread(null); return; }
  api('/api/tasks/' + encodeURIComponent(state.currentTaskId)).then(function (d) {
    renderThread(d.task);
  }).catch(function () { renderThread(null); });
}
function sendTask() {
  var input = $('goalInput');
  var goal = input.value.trim();
  if (!goal) return;
  if (!state.token) { showLogin(); return; }
  var btn = $('sendBtn'); btn.disabled = true;
  function finish() { btn.disabled = false; }
  if (state.currentTaskId) {
    api('/api/tasks/' + encodeURIComponent(state.currentTaskId) + '/messages', 'POST', { message: goal })
      .then(function () { input.value = ''; loadTasks(); toast('已发送，继续当前任务对话'); })
      .catch(function (e) { toast(e.message === '任务不存在或正在执行中，请等待完成后再继续对话' ? '任务执行中，请等待完成' : '发送失败：' + e.message); })
      .finally(finish);
    return;
  }
  api('/api/tasks', 'POST', {
    goal: goal, agentType: state.agentType, permissions: state.permissions,
    workspaceDir: state.workspaceDir || undefined, modelId: state.modelId || undefined,
  }).then(function (d) {
    input.value = '';
    state.currentTaskId = d.task.id;
    state.tasks.unshift(d.task);
    renderTaskList();
    renderThread({ id: d.task.id, goal: goal, status: 'queued', createdAt: new Date().toISOString(), steps: [], conversation: [{ role: 'user', content: goal }] });
    loadTasks();
    toast('任务已提交');
  }).catch(function (e) { toast('提交失败：' + e.message); }).finally(finish);
}
$('sendBtn').addEventListener('click', sendTask);
$('goalInput').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendTask(); });
/* 输入框自动增高 */
$('goalInput').addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 100) + 'px'; });

/* ========== 新建任务 ========== */
function openNewTask() {
  var ag = $('ntAgent');
  ag.innerHTML = Object.keys(AGENTS).map(function (k) {
    return '<option value="' + k + '"' + (state.agentType === k ? ' selected' : '') + '>' + AGENTS[k] + '</option>';
  }).join('');
  var ws = $('ntWs');
  ws.innerHTML = '<option value="">默认（服务器工作区）</option>';
  api('/api/drives').then(function (d) {
    (d.drives || []).forEach(function (dr) {
      ws.innerHTML += '<option value="' + esc(dr) + '">' + esc(dr) + '</option>';
    });
  }).catch(function () {});
  $('ntGoal').value = '';
  showSheet('newTaskSheet');
  setTimeout(function () { $('ntGoal').focus(); }, 100);
}
$('ntCreateBtn').addEventListener('click', function () {
  var goal = $('ntGoal').value.trim();
  if (!goal) { toast('请填写任务描述'); return; }
  var btn = $('ntCreateBtn'); btn.disabled = true;
  var payload = {
    goal: goal, agentType: $('ntAgent').value || state.agentType,
    permissions: state.permissions, modelId: state.modelId || undefined,
  };
  var wsVal = $('ntWs').value;
  if (wsVal) payload.workspaceDir = wsVal;
  api('/api/tasks', 'POST', payload).then(function (d) {
    hideSheet('newTaskSheet');
    state.currentTaskId = d.task.id;
    state.tasks.unshift(d.task);
    renderTaskList();
    switchPage('convPage');
    renderThread({ id: d.task.id, goal: goal, status: 'queued', createdAt: new Date().toISOString(), steps: [], conversation: [{ role: 'user', content: goal }] });
    loadTasks();
    toast('新任务已创建');
  }).catch(function (e) { toast('创建失败：' + e.message); }).finally(function () { btn.disabled = false; });
});

/* ========== 自动化 ========== */
function loadAutomations() {
  if (!state.token) return;
  return api('/api/automations').then(function (d) {
    state.automations = d.automations || [];
    var box = $('autoList');
    if (!state.automations.length) { box.innerHTML = '<div class="empty">还没有快捷指令，点右上角新建</div>'; return; }
    box.innerHTML = state.automations.map(function (a) {
      return '<div class="card" style="padding:12px;">' +
        '<div class="row"><span style="font-size:18px;">⚡</span><div class="li-title" style="flex:1;">' + esc(a.name) + '</div>' +
        '<button class="btn sm" data-run="' + esc(a.id) + '">▶ 运行</button>' +
        '<button class="btn sm ghost" data-del="' + esc(a.id) + '" style="color:var(--err);">删除</button></div>' +
        '<div class="muted" style="margin-top:6px;">' + esc(a.goal.slice(0, 60)) + (a.goal.length > 60 ? '…' : '') + '<br>已运行 ' + a.runCount + ' 次</div>' +
        '</div>';
    }).join('');
    box.querySelectorAll('[data-run]').forEach(function (b) {
      b.addEventListener('click', function () { runAuto(b.dataset.run); });
    });
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { delAuto(b.dataset.del); });
    });
  }).catch(function (e) { console.warn(e); });
}
function runAuto(id) {
  api('/api/automations/' + encodeURIComponent(id) + '/run', 'POST')
    .then(function (d) { toast('已发起任务，运行 ' + d.runCount + ' 次'); loadTasks(); loadAutomations(); })
    .catch(function (e) { toast('运行失败：' + e.message); });
}
function delAuto(id) {
  if (!confirm('删除该快捷指令？')) return;
  api('/api/automations/' + encodeURIComponent(id), 'DELETE')
    .then(function () { toast('已删除'); loadAutomations(); })
    .catch(function (e) { toast('删除失败：' + e.message); });
}
function openAutoForm() {
  $('autoName').value = ''; $('autoGoal').value = '';
  showSheet('autoFormSheet');
}
$('autoSaveBtn').addEventListener('click', function () {
  var name = $('autoName').value.trim(), goal = $('autoGoal').value.trim();
  if (!name || !goal) { toast('请填写名称与目标'); return; }
  api('/api/automations', 'POST', { name: name, goal: goal })
    .then(function () { hideSheet('autoFormSheet'); toast('已保存'); loadAutomations(); })
    .catch(function (e) { toast('保存失败：' + e.message); });
});

/* ========== 模板 ========== */
function loadTemplates() {
  if (!state.token) return;
  return api('/api/templates').then(function (d) {
    state.templates = { builtin: d.builtin || [], user: d.user || [] };
    renderTpls('tplBuiltin', state.templates.builtin, false);
    renderTpls('tplUser', state.templates.user, true);
  }).catch(function (e) { console.warn(e); });
}
function renderTpls(id, list, deletable) {
  var box = $(id);
  if (!list.length) { box.innerHTML = '<div class="empty">' + (deletable ? '暂无自定义模板' : '无内置模板') + '</div>'; return; }
  box.innerHTML = list.map(function (t) {
    return '<div class="card" style="padding:12px;" data-goal="' + encodeURIComponent(t.goal) + '">' +
      '<div class="row"><span style="font-size:18px;">' + (t.icon || '📄') + '</span><div class="li-title" style="flex:1;">' + esc(t.title) + '</div>' +
      '<button class="btn sm" data-use="' + encodeURIComponent(t.goal) + '">填入</button>' +
      (deletable ? '<button class="btn sm ghost" data-tdel="' + esc(t.id) + '" style="color:var(--err);">删除</button>' : '') +
      '</div>' +
      '<div class="muted" style="margin-top:6px;">' + esc(t.category || '') + ' · ' + esc(t.goal.slice(0, 30)) + (t.goal.length > 30 ? '…' : '') + '</div>' +
      '</div>';
  }).join('');
  box.querySelectorAll('[data-use]').forEach(function (b) {
    b.addEventListener('click', function () {
      var goal = decodeURIComponent(b.dataset.use);
      var input = $('goalInput');
      input.value = goal;
      input.style.height = 'auto';
      switchPage('convPage');
      input.focus();
      toast('已填入输入框，去发送吧');
    });
  });
  if (deletable) {
    box.querySelectorAll('[data-tdel]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('删除该模板？')) return;
        api('/api/templates/' + encodeURIComponent(b.dataset.tdel), 'DELETE')
          .then(function () { toast('已删除'); loadTemplates(); })
          .catch(function (e) { toast('删除失败：' + e.message); });
      });
    });
  }
}

/* ========== 模型配置（三重加密：RSA 加密传输 + 服务端 AES 落盘） ========== */
// 第二重（通信层）：服务器 RSA 公钥加密敏感文本（如模型 API Key）
function rsaEncryptText(text) {
  return api('/api/security/public-key').then(function (d) {
    var b64 = String(d.publicKey || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    if (!b64) throw new Error('未获取到加密公钥');
    var bin = atob(b64);
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return crypto.subtle.importKey('spki', buf.buffer, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
      .then(function (key) {
        return crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(text));
      })
      .then(function (enc) {
        var bytes = new Uint8Array(enc), s = '';
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s);
      });
  });
}
function loadModels() {
  if (!state.token) return;
  return api('/api/models').then(function (d) {
    state.models = d.models || [];
    state.defaultModelId = d.defaultId || null;
    if (!state.modelId) state.modelId = state.defaultModelId || '';
    renderModelList();
  }).catch(function (e) { console.warn(e); });
}
function renderModelList() {
  var box = $('modelList');
  if (!state.models.length) { box.innerHTML = '<div class="empty">还没有模型配置，请在下方添加</div>'; return; }
  box.innerHTML = state.models.map(function (m) {
    return '<div class="model-item" data-id="' + esc(m.id) + '">' +
      '<div class="row"><div class="mi-name" style="flex:1;">' + esc(m.name) + (m.default ? ' <span class="badge done">默认</span>' : '') + '</div></div>' +
      '<div class="mi-base">' + esc(m.apiBase || '（未填写 API 地址）') + (m.reasoning ? ' · 已配推理内容' : '') + '</div>' +
      '<div class="mi-actions">' +
      (m.default ? '' : '<button class="btn sm ghost" data-act="default">设为默认</button>') +
      '<button class="btn sm ghost" data-act="edit">编辑</button>' +
      '<button class="btn sm ghost" data-act="del" style="color:var(--err);">删除</button>' +
      '</div></div>';
  }).join('');
  box.querySelectorAll('.model-item').forEach(function (el) {
    var id = el.dataset.id;
    el.querySelectorAll('button[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.dataset.act;
        if (act === 'default') setDefaultModel(id);
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
  $('mKey').value = ''; // 密钥不回填（服务端加密存储，防泄露）
  $('mReasoning').value = m.reasoning || '';
  $('mMsg').textContent = '正在编辑：' + m.name + '（密钥已加密存储，留空保持不变）'; $('mMsg').className = 'form-msg';
  $('mSaveBtn').dataset.editing = id;
}
function deleteModel(id) {
  api('/api/models/' + encodeURIComponent(id), 'DELETE').then(function () {
    toast('已删除配置'); loadModels();
  }).catch(function (e) { toast('删除失败：' + e.message); });
}
function setDefaultModel(id) {
  api('/api/models/' + encodeURIComponent(id) + '/default', 'POST').then(function (d) {
    state.defaultModelId = d.defaultId; state.modelId = d.defaultId;
    localStorage.setItem('fh.m.model', '');
    loadModels(); toast('已设为默认大模型');
  }).catch(function (e) { toast('设置失败：' + e.message); });
}
$('mSaveBtn').addEventListener('click', function () {
  var name = $('mName').value.trim();
  var msg = $('mMsg');
  if (!name) { msg.textContent = '请填写模型名称'; msg.className = 'form-msg err'; return; }
  var body = {
    name: name, apiBase: $('mBase').value.trim(),
    reasoning: $('mReasoning').value,
  };
  var editing = $('mSaveBtn').dataset.editing;
  if (editing) body.id = editing;
  // 三重加密·通信层：密钥 RSA 加密传输（留空则服务端保留原密钥）
  var keyVal = $('mKey').value;
  var save = keyVal
    ? rsaEncryptText(keyVal).then(function (enc) { body.apiKeyEnc = enc; return api('/api/models', 'POST', body); })
    : api('/api/models', 'POST', body);
  save.then(function (d) {
    msg.textContent = '已保存：' + d.model.name; msg.className = 'form-msg ok';
    $('mSaveBtn').dataset.editing = '';
    loadModels(); resetModelForm(true);
    toast('模型配置已保存');
  }).catch(function (e) { msg.textContent = '保存失败：' + e.message; msg.className = 'form-msg err'; });
});
function resetModelForm(keepMsg) {
  if (!keepMsg) { $('mName').value = ''; $('mBase').value = ''; $('mKey').value = ''; $('mReasoning').value = ''; $('mMsg').textContent = ''; $('mMsg').className = 'form-msg'; }
  $('mSaveBtn').dataset.editing = '';
}
$('mResetBtn').addEventListener('click', function () { resetModelForm(false); });

/* ========== 权限 ========== */
document.querySelectorAll('#readScopeSeg .seg-item').forEach(function (el) {
  el.addEventListener('click', function () {
    document.querySelectorAll('#readScopeSeg .seg-item').forEach(function (x) { x.classList.remove('active'); });
    el.classList.add('active');
    $('permPathWrap').style.display = el.dataset.v === 'specified' ? 'block' : 'none';
  });
});
$('permSaveBtn').addEventListener('click', function () {
  var scope = document.querySelector('#readScopeSeg .seg-item.active').dataset.v;
  state.permissions = {
    readScope: scope, readPath: $('permPath').value.trim(),
    allowRead: $('pRead').checked, allowWrite: $('pWrite').checked,
    allowShell: $('pShell').checked, allowNetwork: $('pNetwork').checked,
    allowBrowser: $('pBrowser').checked,
  };
  localStorage.setItem('fh.m.perm', JSON.stringify(state.permissions));
  hideSheet('permSheet'); toast('权限配置已保存');
});
/* 打开权限时同步当前值 */
function syncPermUI() {
  var p = state.permissions;
  document.querySelectorAll('#readScopeSeg .seg-item').forEach(function (el) {
    el.classList.toggle('active', el.dataset.v === p.readScope);
  });
  $('permPathWrap').style.display = p.readScope === 'specified' ? 'block' : 'none';
  $('permPath').value = p.readPath || '';
  $('pRead').checked = !!p.allowRead; $('pWrite').checked = !!p.allowWrite;
  $('pShell').checked = !!p.allowShell; $('pNetwork').checked = !!p.allowNetwork;
  $('pBrowser').checked = !!p.allowBrowser;
}
var origPermShow = showSheet;
window.showSheet = function (id) {
  if (id === 'permSheet') syncPermUI();
  if (id === 'modelSheet') { resetModelForm(false); loadModels(); }
  origPermShow(id);
};

/* ========== 主题 / 关于 ========== */
function toggleTheme() {
  var dark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('fh.m.theme', dark ? 'dark' : 'light');
  toast(dark ? '已切换深色主题' : '已切换浅色主题');
}
if (localStorage.getItem('fh.m.theme') === 'dark') document.documentElement.classList.add('dark');
function openAbout() {
  showSheet('userSheet');
  toast('飞虹 Code v0.5.1 · 移动版\n晋江市飞虹智科技企业管理有限公司');
}

/* ========== 初始化 ========== */
(function init() {
  if (state.token && state.phone) {
    afterLogin();
  } else {
    showLogin();
  }
})();
