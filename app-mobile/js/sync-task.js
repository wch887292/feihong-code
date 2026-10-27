/*
晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人 吴赐虹
*/

(function () {
  'use strict';

  // ===== 配置与状态 =====
  const CONFIG_KEYS = {
    URL: 'FHCODE_SYNC_URL',
    TOKEN: 'FHCODE_SYNC_TOKEN'
  };

  // 内置默认令牌（2026-10-25 吴总要求「该填的全部内置、无需填写」）：
  // 真实值由构建脚本 scripts/inject-mobile-token.cjs 从本机 ~/.feihong-code/web-token.json
  // 注入并替换下方占位符（与 app.js 的 FH_SYNC_TOKEN 同一注入链路，token 字段）；
  // 源码仓库永远只含占位符，真实令牌不出本机。用户仍可在「服务器配置」页修改，优先级更高。
  const BUILTIN_TOKEN = '<FH_SYNC_TOKEN>';

  let state = {
    url: '',
    token: '',
    pollingTimer: null,
    detailTimer: null,
    currentTaskId: null
  };

  // ===== DOM 元素 =====
  const els = {
    errorBar: document.getElementById('errorBar'),
    configSection: document.getElementById('configSection'),
    listSection: document.getElementById('listSection'),
    syncUrlInput: document.getElementById('syncUrlInput'),
    syncTokenInput: document.getElementById('syncTokenInput'),
    saveConfigBtn: document.getElementById('saveConfigBtn'),
    configMsg: document.getElementById('configMsg'),
    taskList: document.getElementById('taskList'),
    refreshBtn: document.getElementById('refreshBtn'),
    detailSheet: document.getElementById('detailSheet'),
    detailStatus: document.getElementById('detailStatus'),
    detailGoal: document.getElementById('detailGoal'),
    detailUpdated: document.getElementById('detailUpdated'),
    detailMessages: document.getElementById('detailMessages'),
    detailProgress: document.getElementById('detailProgress'),
    detailGoals: document.getElementById('detailGoals'),
    interveneInput: document.getElementById('interveneInput'),
    interveneBtn: document.getElementById('interveneBtn'),
    interveneMsg: document.getElementById('interveneMsg'),
    detailBackBtn: document.getElementById('detailBackBtn'),
    newTaskSheet: document.getElementById('newTaskSheet'),
    newGoalInput: document.getElementById('newGoalInput'),
    confirmSheet: document.getElementById('confirmSheet'),
    confirmGoalText: document.getElementById('confirmGoalText'),
    sendTaskBtn: document.getElementById('sendTaskBtn'),
    confirmNewTaskBtn: document.getElementById('confirmNewTaskBtn'),
    newTaskFab: document.getElementById('newTaskFab'),
    showNewTaskBtn: document.getElementById('showNewTaskBtn'),
    backBtn: document.getElementById('backBtn')
  };

  // ===== 工具函数 =====
  // 错误文案本地化：把浏览器/网络的原始报错翻译成用户看得懂的中文提示
  function friendlyError(e) {
    const msg = (e && e.message) || String(e || '未知错误');
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return '网络连接失败，请检查网络或服务器状态后重试';
    }
    if (/未配置/.test(msg)) return msg;
    const m = msg.match(/API 错误 \((\d+)\)/);
    if (m) {
      const code = Number(m[1]);
      if (code === 401 || code === 403) return '访问令牌错误或已失效，请更新令牌后重试';
      if (code === 404) return '请求的服务不存在（404）';
      if (code >= 500) return '服务器暂时异常，请稍后重试';
      return '请求失败（HTTP ' + code + '），请稍后重试';
    }
    return msg;
  }

  function showError(msg) {
    if (!els.errorBar) return;
    els.errorBar.textContent = msg;
    els.errorBar.style.display = 'block';
    setTimeout(() => {
      els.errorBar.style.display = 'none';
    }, 4000);
  }

  function showConfig() {
    els.configSection.style.display = 'flex';
    els.listSection.style.display = 'none';
    els.newTaskFab.style.display = 'none';
  }

  function showList() {
    els.configSection.style.display = 'none';
    els.listSection.style.display = 'block';
    els.newTaskFab.style.display = 'block';
  }

  function getStoredConfig() {
    try {
      const url = localStorage.getItem(CONFIG_KEYS.URL) || 'https://sync.klai.top';
      // 内置令牌兜底：localStorage 无用户值时才用（占位符未注入时等同空串，退回手动填写）
      const builtin = BUILTIN_TOKEN.indexOf('<FH_SYNC_TOKEN>') === 0 ? '' : BUILTIN_TOKEN;
      const token = localStorage.getItem(CONFIG_KEYS.TOKEN) || builtin;
      return { url, token };
    } catch (e) {
      const builtin = BUILTIN_TOKEN.indexOf('<FH_SYNC_TOKEN>') === 0 ? '' : BUILTIN_TOKEN;
      return { url: 'https://sync.klai.top', token: builtin };
    }
  }

  function setStoredConfig(url, token) {
    try {
      localStorage.setItem(CONFIG_KEYS.URL, url);
      localStorage.setItem(CONFIG_KEYS.TOKEN, token);
    } catch (e) {
      console.error('保存配置失败:', e);
    }
  }

  function formatTime(isoStr) {
    try {
      const date = new Date(isoStr);
      return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return isoStr || '';
    }
  }

  function genRunId() {
    const randomPart = Math.floor(Math.random() * 46656).toString(36).padStart(4, '0');
    return `syn-${Date.now().toString(36)}-${randomPart}`;
  }

  // ===== API 调用 =====
  async function fetchApi(endpoint, options = {}) {
    if (!state.url || !state.token) {
      throw new Error('未配置服务器地址或令牌');
    }

    const url = state.url.replace(/\/+$/, '') + endpoint;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.token}`
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...headers, ...options.headers }
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`API 错误 (${response.status}): ${errText.slice(0, 200)}`);
      }

      const text = await response.text();
      return JSON.parse(text);
    } catch (e) {
      throw e;
    }
  }

  async function listSessions() {
    const data = await fetchApi('/api/sessions');
    // sync-server 返回 { ok, sessions: [...] }
    return data && Array.isArray(data.sessions) ? data.sessions : [];
  }

  async function getSession(runId) {
    const data = await fetchApi(`/api/sessions/${encodeURIComponent(runId)}`);
    // sync-server 返回 { ok, session: {...} }
    return data && data.session ? data.session : null;
  }

  /** 拉取执行过程事件流（手机端轮询渲染「执行过程·思考轨迹」） */
  async function getProgress(runId) {
    const data = await fetchApi(`/api/sessions/${encodeURIComponent(runId)}/progress`);
    return data && Array.isArray(data.events) ? data.events : [];
  }

  async function createSession(runId, goal) {
    return await fetchApi('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        runId,
        goal,
        status: 'queued',
        messages: []
      })
    });
  }

  async function postGoal(runId, goal, executor) {
    return await fetchApi(`/api/sessions/${runId}/goals`, {
      method: 'POST',
      body: JSON.stringify({ goal, executor: executor || 'local' })
    });
  }

  // ===== 渲染函数 =====
  function renderTaskList(tasks) {
    if (!els.taskList) return;

    if (tasks.length === 0) {
      els.taskList.innerHTML = '<div class="empty">暂无任务</div>';
      return;
    }

    els.taskList.innerHTML = tasks.map(task => {
      const time = task.updatedAt ? formatTime(task.updatedAt) : '未知时间';
      const goalPreview = task.goal ? task.goal.slice(0, 50) + (task.goal.length > 50 ? '...' : '') : '无描述';
      
      return `
        <div class="task-item" data-run-id="${task.runId}">
          <div class="task-header">
            <span class="status-badge ${task.status || 'queued'}">${task.status || 'queued'}</span>
            ${task.hasCloudGoal ? '<span class="executor-badge" title="云端执行">云</span>' : ''}
            <div class="task-goal">${escapeHtml(goalPreview)}</div>
          </div>
          <div class="task-meta">
            <span class="task-time">${time}</span>
          </div>
        </div>
      `;
    }).join('');

    // 绑定点击事件
    els.taskList.querySelectorAll('.task-item').forEach(item => {
      item.addEventListener('click', () => {
        const runId = item.dataset.runId;
        loadTaskDetail(runId);
      });
    });
  }

  function renderTaskDetail(task) {
    if (!task) return;

    els.detailStatus.textContent = task.status || 'queued';
    els.detailStatus.className = 'status-badge ' + (task.status || 'queued');
    
    els.detailGoal.textContent = task.goal || '无描述';
    els.detailUpdated.textContent = task.updatedAt ? formatTime(task.updatedAt) : '未知时间';

    // 渲染消息列表
    if (task.messages && task.messages.length > 0) {
      els.detailMessages.innerHTML = task.messages.map(msg => {
        const roleLabel = msg.role === 'user' ? '用户' : (msg.role === 'assistant' ? '助手' : msg.role || 'unknown');
        const content = msg.content ? escapeHtml(msg.content.slice(0, 200)) : '';
        return `
          <div class="message-item">
            <div class="message-role">${roleLabel}</div>
            <div>${content}</div>
          </div>
        `;
      }).join('');
    } else {
      els.detailMessages.innerHTML = '<div style="padding:10px;color:var(--ink-2);text-align:center;">暂无对话记录</div>';
    }

    // 渲染 goals 列表（sync-server goal 条目字段：id / goal / status / createdAt）
    if (task.goals && task.goals.length > 0) {
      els.detailGoals.innerHTML = task.goals.map(goal => {
        const statusClass = goal.status || 'queued';
        const statusText = goal.status || 'queued';
        return `
          <div class="goal-item">
            <div>${escapeHtml(goal.goal || '无描述')}</div>
            <span class="goal-status ${statusClass}">${statusText}</span>
          </div>
        `;
      }).join('');
    } else {
      els.detailGoals.innerHTML = '<div style="padding:10px;color:var(--ink-2);text-align:center;">暂无子任务</div>';
    }
  }

  /* ===== 执行过程渲染 =====
   * v8.13.4：补「执行过程 · 思考轨迹」——此前详情页只有空的「助手」与空队列，
   * 用户无法判断任务到底跑到哪一步。事件来源：sync-server /api/sessions/:runId/progress
   * （执行端在 model.response / tool.call / tool.result 时增量上报）。
   */
  const PROGRESS_KIND_LABEL = {
    think: '💭 思考',
    model: '💭 思考',
    tool: '🔧 工具',
    tool_call: '🔧 工具',
    tool_result: '📄 结果',
    result: '📄 结果',
    error: '❌ 错误',
    done: '✅ 完成',
    step: '· 步骤',
  };

  function renderProgress(events) {
    if (!els.detailProgress) return;
    if (!events || events.length === 0) {
      els.detailProgress.innerHTML =
        '<div style="padding:10px;color:var(--ink-2);text-align:center;">执行端尚未回传过程（电脑端开始执行后此处会实时刷新）</div>';
      return;
    }
    els.detailProgress.innerHTML = events.map(ev => {
      const label = PROGRESS_KIND_LABEL[ev.kind] || '· 步骤';
      const text = ev.text ? escapeHtml(String(ev.text)) : '';
      const time = ev.at ? formatTime(ev.at) : '';
      return `
        <div class="progress-item ${escapeHtml(ev.kind || 'step')}">
          <div class="progress-head">
            <span class="progress-kind">${label}</span>
            ${time ? `<span class="progress-time">${time}</span>` : ''}
          </div>
          ${text ? `<div class="progress-text">${text}</div>` : ''}
        </div>
      `;
    }).join('');
    // 保持滚动在底部，新事件自动可见
    els.detailProgress.scrollTop = els.detailProgress.scrollHeight;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== 数据加载 =====
  async function loadTaskDetail(runId) {
    state.currentTaskId = runId;
    try {
      const task = await getSession(runId);
      renderTaskDetail(task);
      if (els.detailSheet) els.detailSheet.classList.add('show');
      startDetailPolling(runId);
    } catch (e) {
      showError('加载详情失败：' + friendlyError(e));
    }
  }

  /** 仅刷新详情内容（不影响弹层开关），用于详情打开时的自动轮询 */
  async function refreshTaskDetail(runId) {
    try {
      const task = await getSession(runId);
      if (task) renderTaskDetail(task);
      // 执行过程事件流：单独拉取（append-only，增量渲染）
      const events = await getProgress(runId);
      renderProgress(events);
    } catch (e) {
      // 瞬断忽略，下次轮询重试
    }
  }

  /** 详情打开期间每 4 秒拉一次最新上下文（读上下文 / 看电脑端实时执行） */
  function startDetailPolling(runId) {
    stopDetailPolling();
    state.detailTimer = setInterval(() => {
      if (!els.detailSheet || !els.detailSheet.classList.contains('show')) {
        stopDetailPolling();
        return;
      }
      refreshTaskDetail(runId);
    }, 4000);
  }

  function stopDetailPolling() {
    if (state.detailTimer) {
      clearInterval(state.detailTimer);
      state.detailTimer = null;
    }
  }

  /** 续聊 / 随时介入：对运行中任务追加一条指令（POST /api/sessions/:runId/goals） */
  async function handleIntervene() {
    const runId = state.currentTaskId;
    const cmd = els.interveneInput ? els.interveneInput.value.trim() : '';
    if (!runId) {
      if (els.interveneMsg) { els.interveneMsg.textContent = '当前没有打开的任务'; els.interveneMsg.style.color = '#dc2626'; }
      return;
    }
    if (!cmd) {
      if (els.interveneMsg) { els.interveneMsg.textContent = '请输入要下发的指令'; els.interveneMsg.style.color = '#dc2626'; }
      return;
    }
    if (els.interveneBtn) els.interveneBtn.disabled = true;
    try {
      await postGoal(runId, cmd, selectedExecutor);
      if (els.interveneInput) {
        els.interveneInput.value = '';
        autoGrow(els.interveneInput); // 清空后回落到 min-height
      }
      if (els.interveneMsg) {
        els.interveneMsg.textContent = '指令已下发（' + (selectedExecutor === 'cloud' ? '云端' : '本机') + '），电脑端将认领执行';
        els.interveneMsg.style.color = '#16a34a';
      }
      refreshTaskDetail(runId);
    } catch (e) {
      if (els.interveneMsg) { els.interveneMsg.textContent = '下发失败：' + friendlyError(e); els.interveneMsg.style.color = '#dc2626'; }
    } finally {
      if (els.interveneBtn) els.interveneBtn.disabled = false;
    }
  }

  async function refreshTaskList() {
    if (!els.taskList) return;
    els.taskList.innerHTML = '<div class="empty">加载中…</div>';

    try {
      const tasks = await listSessions();
      // 按更新时间倒序
      tasks.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      renderTaskList(tasks);
    } catch (e) {
      els.taskList.innerHTML = `<div class="empty" style="color:var(--err);">${escapeHtml(friendlyError(e))}<br><span style="font-size:12px;color:var(--ink-2);">页面每 5 秒自动重试，也可点右上角「刷新」</span></div>`;
    }
  }

  // ===== 轮询 =====
  function startPolling() {
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
    }
    state.pollingTimer = setInterval(refreshTaskList, 5000);
  }

  function stopPolling() {
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }
  }

  /** 文本域随输入自动增高（配合 CSS min-height，解决「输入框太小无法输入」） */
  function autoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    const minH = 108;
    const maxH = Math.max(minH, Math.floor(window.innerHeight * 0.4));
    const next = Math.min(el.scrollHeight, maxH);
    el.style.height = next + 'px';
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
  }

  function bindAutoGrow(el) {
    if (!el) return;
    el.addEventListener('input', () => autoGrow(el));
    el.addEventListener('focus', () => autoGrow(el));
    // 初始按内容撑开
    setTimeout(() => autoGrow(el), 0);
  }

  // ===== 事件处理 =====
  function handleSaveConfig() {
    const url = els.syncUrlInput.value.trim();
    const token = els.syncTokenInput.value.trim();

    if (!url) {
      els.configMsg.textContent = '服务器地址不能为空';
      els.configMsg.style.color = '#dc2626';
      return;
    }

    if (!token) {
      els.configMsg.textContent = '访问令牌不能为空';
      els.configMsg.style.color = '#dc2626';
      return;
    }

    setStoredConfig(url, token);
    state.url = url;
    state.token = token;

    els.configMsg.textContent = '配置已保存';
    els.configMsg.style.color = '#16a34a';

    setTimeout(() => {
      els.configMsg.textContent = '';
      showList();
      refreshTaskList();
      startPolling();
    }, 1000);
  }

  function handleShowNewTask() {
    if (els.newTaskSheet) els.newTaskSheet.classList.add('show');
  }

  /** 关闭弹层：移除 show 类（关闭详情时停止其轮询） */
  function hideSheet(id) {
    const sheet = document.getElementById(id);
    if (sheet) sheet.classList.remove('show');
    if (id === 'detailSheet') stopDetailPolling();
  }

  // ===== 执行端选择（本机 / 云端） =====
  let selectedExecutor = 'local';

  function initExecutorPicker() {
    // 绑定页面上所有 .executor-picker（新建任务 + 详情续聊），共享 selectedExecutor
    document.querySelectorAll('.executor-picker').forEach((picker) => {
      const hint = picker.parentElement.querySelector('.executor-hint');
      picker.querySelectorAll('.executor-option').forEach((btn) => {
        btn.addEventListener('click', () => {
          picker.querySelectorAll('.executor-option').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          selectedExecutor = btn.getAttribute('data-executor') || 'local';
          if (hint) {
            hint.textContent = selectedExecutor === 'cloud'
              ? '云端执行：任务由服务器上的 fhcode 云电脑认领，本机不开机也照跑'
              : '本机执行：任务由 H 盘 fhcode 认领，本机开机才会跑';
          }
        });
      });
    });
  }

  function handleConfirmNewTask() {
    const goal = els.newGoalInput.value.trim();
    if (!goal) {
      alert('请输入任务目标');
      return;
    }

    // 显示二次确认（文案随执行端变化）
    if (els.confirmSheet && els.confirmGoalText) {
      els.confirmGoalText.textContent = goal;
      const tip = document.getElementById('confirmExecutorTip');
      if (tip) {
        tip.textContent = selectedExecutor === 'cloud'
          ? '即将把以下任务下发给云端电脑（服务器）执行，请确认内容：'
          : '即将把以下任务下发给本机 fhcode 执行，请确认内容：';
      }
      hideSheet('newTaskSheet');
      els.confirmSheet.classList.add('show');
    }
  }

  async function handleSendTask() {
    const goal = els.newGoalInput.value.trim();
    if (!goal) {
      alert('任务目标已清空');
      return;
    }

    const executor = selectedExecutor;
    hideSheet('confirmSheet');
    els.newGoalInput.value = '';

    const runId = genRunId();

    try {
      // 先创建会话
      await createSession(runId, goal);
      // 再下发 goal（带执行端）
      await postGoal(runId, goal, executor);

      alert('任务已创建并下发（' + (executor === 'cloud' ? '云端执行' : '本机执行') + '，runId: ' + runId + '）');
      refreshTaskList();
    } catch (e) {
      showError('下发失败：' + friendlyError(e));
    }
  }

  // ===== 初始化 =====
  function init() {
    const config = getStoredConfig();
    state.url = config.url;
    state.token = config.token;

    // 填充输入框
    if (els.syncUrlInput) els.syncUrlInput.value = config.url || '';
    if (els.syncTokenInput) els.syncTokenInput.value = config.token || '';

    // 执行端选择器
    initExecutorPicker();

    // 绑定事件
    if (els.saveConfigBtn) {
      els.saveConfigBtn.addEventListener('click', handleSaveConfig);
    }

    if (els.refreshBtn) {
      els.refreshBtn.addEventListener('click', refreshTaskList);
    }

    if (els.showNewTaskBtn) {
      els.showNewTaskBtn.addEventListener('click', handleShowNewTask);
    }

    if (els.confirmNewTaskBtn) {
      els.confirmNewTaskBtn.addEventListener('click', handleConfirmNewTask);
    }

    if (els.sendTaskBtn) {
      els.sendTaskBtn.addEventListener('click', handleSendTask);
    }

    if (els.backBtn) {
      els.backBtn.addEventListener('click', () => {
        window.location.href = 'index.html';
      });
    }

    // 详情页：续聊下发指令 + 返回列表
    if (els.interveneBtn) {
      els.interveneBtn.addEventListener('click', handleIntervene);
    }
    if (els.detailBackBtn) {
      els.detailBackBtn.addEventListener('click', () => hideSheet('detailSheet'));
    }

    // v8.13.4：下指令输入框 / 新建任务输入框随内容自动增高
    bindAutoGrow(els.interveneInput);
    bindAutoGrow(els.newGoalInput);

    // 弹层关闭按钮（右上角 ×）
    document.querySelectorAll('.sheet-close').forEach((btn) => {
      btn.addEventListener('click', () => hideSheet(btn.dataset.close));
    });
    // 点击遮罩空白处关闭
    document.querySelectorAll('.sheet-mask').forEach((mask) => {
      mask.addEventListener('click', (e) => {
        if (e.target === mask) mask.classList.remove('show');
      });
    });
    // 二次确认弹层的取消按钮
    const cancelConfirmBtn = document.getElementById('cancelConfirmBtn');
    if (cancelConfirmBtn) {
      cancelConfirmBtn.addEventListener('click', () => hideSheet('confirmSheet'));
    }

    // 检查是否已配置
    if (config.url && config.token) {
      showList();
      refreshTaskList();
      startPolling();
    } else {
      showConfig();
    }
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
