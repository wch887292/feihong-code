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

  let state = {
    url: '',
    token: '',
    pollingTimer: null,
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
    detailGoals: document.getElementById('detailGoals'),
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
      const token = localStorage.getItem(CONFIG_KEYS.TOKEN);
      return { url, token };
    } catch (e) {
      return { url: 'https://sync.klai.top', token: '' };
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
    } catch (e) {
      showError('加载详情失败：' + e.message);
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
      els.taskList.innerHTML = `<div class="empty" style="color:#dc2626;">加载失败：${escapeHtml(e.message)}</div>`;
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

  /** 关闭弹层：移除 show 类 */
  function hideSheet(id) {
    const sheet = document.getElementById(id);
    if (sheet) sheet.classList.remove('show');
  }

  // ===== 执行端选择（本机 / 云端） =====
  let selectedExecutor = 'local';

  function initExecutorPicker() {
    const picker = document.getElementById('executorPicker');
    const hint = document.getElementById('executorHint');
    if (!picker) return;
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
      showError('下发失败：' + e.message);
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
