/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人 吴赐虹
 *
 * 同步任务页 - 纯原生 JS 无依赖
 */

(function () {
  'use strict';

  // ===== 状态管理 =====
  const state = {
    url: '',
    token: '',
    tasks: [],
    pollingTimer: null,
    currentDetailTask: null
  };

  // ===== DOM 元素缓存 =====
  const dom = {
    config: document.getElementById('syncConfig'),
    list: document.getElementById('syncList'),
    taskList: document.getElementById('taskList'),
    listCount: document.getElementById('listCount'),
    refreshBtn: document.getElementById('refreshBtn'),
    backBtn: document.getElementById('backBtn'),
    syncUrlInput: document.getElementById('syncUrlInput'),
    syncTokenInput: document.getElementById('syncTokenInput'),
    saveConfigBtn: document.getElementById('saveConfigBtn'),
    configMsg: document.getElementById('configMsg'),
    detailSheet: document.getElementById('detailSheet'),
    newTaskSheet: document.getElementById('newTaskSheet'),
    confirmSheet: document.getElementById('confirmSheet'),
    errorBar: document.getElementById('errorBar'),
    // 详情内容
    detailGoal: document.getElementById('detailGoal'),
    detailStatus: document.getElementById('detailStatus'),
    detailTime: document.getElementById('detailTime'),
    detailMessages: document.getElementById('detailMessages'),
    detailGoals: document.getElementById('detailGoals'),
    // 新任务
    newGoalInput: document.getElementById('newGoalInput'),
    newTaskMsg: document.getElementById('newTaskMsg'),
    confirmNewTaskBtn: document.getElementById('confirmNewTaskBtn'),
    // 二次确认
    confirmGoalText: document.getElementById('confirmGoalText'),
    finalConfirmBtn: document.getElementById('finalConfirmBtn')
  };

  // ===== 工具函数 =====
  function showConfig() {
    dom.config.style.display = 'block';
    dom.list.style.display = 'none';
  }

  function showList() {
    dom.config.style.display = 'none';
    dom.list.style.display = 'flex';
  }

  function showError(msg) {
    dom.errorBar.textContent = msg;
    dom.errorBar.style.display = 'block';
    setTimeout(() => {
      dom.errorBar.style.display = 'none';
    }, 4000);
  }

  function hideError() {
    dom.errorBar.style.display = 'none';
  }

  function fmtTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return iso || '';
    }
  }

  function genRunId() {
    const base = Date.now().toString(36);
    const rand = Math.floor(Math.random() * 1296).toString(36).padStart(4, '0');
    return `syn-${base}-${rand}`;
  }

  // ===== 配置管理 =====
  function loadConfig() {
    try {
      const url = localStorage.getItem('FHCODE_SYNC_URL');
      const token = localStorage.getItem('FHCODE_SYNC_TOKEN');
      if (url && token) {
        state.url = url;
        state.token = token;
        dom.syncUrlInput.value = url;
        dom.syncTokenInput.value = token;
        showList();
        startPolling();
        fetchTasks();
        return true;
      }
    } catch (e) {}
    return false;
  }

  function saveConfig() {
    const url = dom.syncUrlInput.value.trim();
    const token = dom.syncTokenInput.value.trim();
    if (!url || !token) {
      dom.configMsg.textContent = '请填写服务器地址和令牌';
      dom.configMsg.style.color = '#f44336';
      return false;
    }
    try {
      localStorage.setItem('FHCODE_SYNC_URL', url);
      localStorage.setItem('FHCODE_SYNC_TOKEN', token);
      state.url = url;
      state.token = token;
      dom.configMsg.textContent = '配置已保存';
      dom.configMsg.style.color = '#388e3c';
      setTimeout(() => {
        dom.configMsg.textContent = '';
      }, 2000);
      showList();
      startPolling();
      fetchTasks();
      return true;
    } catch (e) {
      dom.configMsg.textContent = '保存失败，请重试';
      dom.configMsg.style.color = '#f44336';
      return false;
    }
  }

  // ===== API 调用 =====
  async function apiFetch(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }
    const url = state.url + path;
    const res = await fetch(url, {
      ...options,
      headers
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  }

  async function fetchTasks() {
    try {
      hideError();
      const data = await apiFetch('/api/sessions');
      state.tasks = data.items || [];
      renderTaskList();
    } catch (e) {
      showError('加载任务失败：' + e.message);
    }
  }

  async function fetchTaskDetail(runId) {
    try {
      const data = await apiFetch(`/api/sessions/${runId}`);
      return data;
    } catch (e) {
      showError('获取详情失败：' + e.message);
      return null;
    }
  }

  async function createSession(goal) {
    const runId = genRunId();
    try {
      await apiFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          runId,
          goal,
          status: 'queued',
          messages: []
        })
      });
      return runId;
    } catch (e) {
      throw new Error('创建会话失败：' + e.message);
    }
  }

  async function postGoal(runId, goal) {
    try {
      await apiFetch(`/api/sessions/${runId}/goals`, {
        method: 'POST',
        body: JSON.stringify({ goal })
      });
    } catch (e) {
      throw new Error('下发任务失败：' + e.message);
    }
  }

  // ===== 渲染 =====
  function renderTaskList() {
    if (state.tasks.length === 0) {
      dom.taskList.innerHTML = '<div class="empty">暂无任务</div>';
      dom.listCount.textContent = '共 0 项';
      return;
    }
    dom.listCount.textContent = `共 ${state.tasks.length} 项`;
    dom.taskList.innerHTML = state.tasks.map(task => {
      const statusClass = task.status || 'queued';
      const goalPreview = task.goal ? task.goal.slice(0, 50) + (task.goal.length > 50 ? '...' : '') : '无目标';
      return `
        <div class="task-card" onclick="showTaskDetail('${task.runId}')">
          <div class="task-header">
            <div class="task-goal">${escapeHtml(task.goal || '无目标')}</div>
            <div class="task-status">
              <span class="status-badge ${statusClass}">${translateStatus(task.status)}</span>
            </div>
          </div>
          <div class="task-meta">
            <span class="task-time">更新：${fmtTime(task.updatedAt)}</span>
            <span>ID: ${task.runId.slice(0, 12)}...</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function translateStatus(status) {
    const map = {
      queued: '等待中',
      running: '执行中',
      paused: '已暂停',
      done: '已完成',
      failed: '已失败'
    };
    return map[status] || status;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showTaskDetail(runId) {
    fetchTaskDetail(runId).then(data => {
      if (!data) return;
      state.currentDetailTask = data;
      dom.detailGoal.textContent = data.goal || '无目标';
      
      const statusClass = data.status || 'queued';
      dom.detailStatus.className = 'status-badge ' + statusClass;
      dom.detailStatus.textContent = translateStatus(data.status);
      
      dom.detailTime.textContent = '更新于 ' + fmtTime(data.updatedAt);
      
      // 渲染消息列表
      const msgs = data.messages || [];
      dom.detailMessages.innerHTML = msgs.map(m => {
        const role = m.role || 'assistant';
        const content = m.content || '';
        return `
          <div class="message-item">
            <span class="message-role">${role === 'user' ? '用户' : 'AI'}:</span>
            <span class="message-content">${escapeHtml(content)}</span>
          </div>
        `;
      }).join('') || '<div class="empty">暂无消息</div>';
      
      // 渲染子任务列表
      const goals = data.goals || [];
      dom.detailGoals.innerHTML = goals.map(g => {
        const status = g.status || 'pending';
        const statusClass = status === 'success' ? 'success' : status === 'failed' ? 'failed' : 'pending';
        return `
          <div class="goal-item">
            <div class="goal-status ${statusClass}"></div>
            <div class="goal-text">${escapeHtml(g.text || g.description || '无描述')}</div>
          </div>
        `;
      }).join('') || '<div class="empty">暂无子任务</div>';
      
      showSheet('detailSheet');
    });
  }

  // ===== 新任务流程 =====
  let pendingGoalForCreate = null;

  function showNewTaskSheet() {
    dom.newGoalInput.value = '';
    dom.newTaskMsg.textContent = '';
    showSheet('newTaskSheet');
  }

  function confirmNewTask() {
    const goal = dom.newGoalInput.value.trim();
    if (!goal) {
      dom.newTaskMsg.textContent = '请输入任务目标';
      dom.newTaskMsg.style.color = '#f44336';
      return;
    }
    pendingGoalForCreate = goal;
    hideSheet('newTaskSheet');
    dom.confirmGoalText.textContent = goal;
    showSheet('confirmSheet');
  }

  async function executeNewTask() {
    hideSheet('confirmSheet');
    const goal = pendingGoalForCreate;
    pendingGoalForCreate = null;
    
    try {
      dom.newTaskMsg.textContent = '创建中…';
      dom.newTaskMsg.style.color = '#1976d2';
      
      const runId = await createSession(goal);
      await postGoal(runId, goal);
      
      dom.newTaskMsg.textContent = '任务已下发！';
      dom.newTaskMsg.style.color = '#388e3c';
      setTimeout(() => {
        dom.newTaskMsg.textContent = '';
      }, 3000);
      
      hideSheet('newTaskSheet');
      fetchTasks();
    } catch (e) {
      dom.newTaskMsg.textContent = '失败：' + e.message;
      dom.newTaskMsg.style.color = '#f44336';
    }
  }

  // ===== 轮询 =====
  function startPolling() {
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
    }
    fetchTasks();
    state.pollingTimer = setInterval(fetchTasks, 5000);
  }

  function stopPolling() {
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }
  }

  // ===== 事件绑定 =====
  function bindEvents() {
    // 返回按钮
    dom.backBtn.addEventListener('click', () => {
      stopPolling();
      window.location.href = 'index.html';
    });
    
    // 刷新按钮
    dom.refreshBtn.addEventListener('click', fetchTasks);
    
    // 保存配置
    dom.saveConfigBtn.addEventListener('click', saveConfig);
    
    // 新任务按钮
    const newTaskBtn = document.querySelector('.bottom-fab');
    if (newTaskBtn) {
      newTaskBtn.addEventListener('click', showNewTaskSheet);
    } else {
      // 如果没有底部 FAB，在列表区添加一个按钮
      const header = document.querySelector('.list-header');
      if (header) {
        const btn = document.createElement('button');
        btn.className = 'btn sm brand';
        btn.textContent = '+ 新任务';
        btn.style.marginLeft = 'auto';
        btn.addEventListener('click', showNewTaskSheet);
        header.appendChild(btn);
      }
    }
    
    // 确认新任务
    dom.confirmNewTaskBtn.addEventListener('click', confirmNewTask);
    
    // 最终确认
    dom.finalConfirmBtn.addEventListener('click', executeNewTask);
  }

  // ===== 初始化 =====
  function init() {
    bindEvents();
    if (!loadConfig()) {
      showConfig();
    }
  }

  // 延迟初始化确保 DOM 就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
