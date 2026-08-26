/**
 * API 模块：HTTP 请求与数据获取，依赖 utils
 */

    async function loadSummaryHistory() {
      try {
        const d = await api('/api/memory/history?limit=20');
        const content = document.getElementById('memHistoryContent');
        const list = d.history || [];
        if (!list.length) {
          content.innerHTML = '<div class="empty">暂无总结历史</div>';
          return;
        }
        content.innerHTML = list.map(h =>
          '<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">' +
          '<strong>' + h.date + '</strong> → ' + h.newEntries + ' 条新增, ' + h.updatedEntries + ' 条更新<br>' +
          '<span class="muted">' + h.timestamp + '</span>' +
          '</div>'
        ).join('');
      } catch (e) { toast('加载失败：' + e.message); }
    }

    async function loadLongTermMemory() {
      try {
        const d = await api('/api/memory/long');
        const content = document.getElementById('memLongContent');
        if (!d || !d.content) {
          content.innerHTML = '<div class="empty">长期记忆为空</div>';
          return;
        }
        content.innerHTML = formatMarkdown(d.content);
      } catch (e) { toast('加载失败：' + e.message); }
    }

    async function loadMemoryContent(dateStr) {
      try {
        const d = await api('/api/memory/short?date=' + dateStr);
        const content = document.getElementById('memShortContent');
        if (!d || !d.content) {
          content.innerHTML = '<div class="empty">当天暂无记录</div>';
          return;
        }
        content.innerHTML = formatMarkdown(d.content);
        document.getElementById('memDateLabel').textContent = '📅 ' + dateStr;
      } catch (e) { toast('加载失败：' + e.message); }
    }

    async function loadMemoryStats() {
      try {
        const d = await api('/api/memory/stats');
        document.getElementById('statShortDays').textContent = d.shortTermFiles + ' 天';
        document.getElementById('statLongNotes').textContent = d.longTermNotes + ' 条';
        document.getElementById('statLastSum').textContent = d.lastSummarize || '暂无';
        // 计算下次自动总结时间（今晚24:00）
        const now = new Date();
        const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
        document.getElementById('statNextSum').textContent = next.toLocaleString('zh-CN', { hour12: false });
      } catch (e) { console.warn('加载记忆统计失败', e); }
    }

    async function loadOffice() {
      try {
        const d = await api('/api/office/capabilities');
        const grid = document.getElementById('officeGrid');
        grid.innerHTML = (d.capabilities || []).map((c) => '<div class="tile" data-prompt="' + encodeURIComponent(c.prompt) + '"><div class="icon">' + c.icon + '</div><div class="title">' + escapeHtml(c.title) + '</div><div class="desc">' + escapeHtml(c.desc) + '</div><div class="ops"><button class="use" data-prompt="' + encodeURIComponent(c.prompt) + '">生成提示词</button></div></div>').join('');
        grid.querySelectorAll('button.use').forEach((b) => b.addEventListener('click', (e) => {
          e.stopPropagation();
          const inp = document.getElementById('goalInput');
          if (inp) inp.value = decodeURIComponent(b.getAttribute('data-prompt'));
          switchView('chat');
          if (inp) inp.focus();
          toast('已填入提示词');
        }));
      } catch (e) { document.getElementById('officeGrid').innerHTML = '<div class="empty" style="color:var(--err)">加载失败：' + escapeHtml(e.message) + '</div>'; }
    }

    async function loadInstalled() {
      try {
        const d = await api('/api/skills/installed');
        state.installed = new Set((d.skills || []).map((s) => s.id));
        const grid = document.getElementById('installedGrid');
        if (!d.skills || !d.skills.length) { grid.innerHTML = '<div class="empty">暂无已安装技能</div>'; return; }
        grid.innerHTML = d.skills.map((s) => '<div class="tile"><div class="icon">✅</div><div class="title">' + escapeHtml(s.name) + '</div><div class="desc">' + escapeHtml(s.description || '').slice(0, 60) + '…</div></div>').join('');
      } catch (e) { console.warn('加载已安装失败', e); }
    }

    async function installSkill(idEnc, nameEnc, source) {
      const id = decodeURIComponent(idEnc);
      const name = decodeURIComponent(nameEnc);
      try { await api('/api/skills/install', 'POST', { id, name, source }); toast('已安装：' + name); await loadInstalled(); }
      catch (e) { toast('安装失败：' + e.message); }
    }

    async function loadMarket() {
      const q = document.getElementById('marketSearch').value.trim();
      const source = document.getElementById('marketSource').value;
      const grid = document.getElementById('marketGrid');
      grid.innerHTML = '<div class="empty">加载中…</div>';
      try {
        const params = new URLSearchParams({ source });
        if (q) params.set('q', q);
        const d = await api('/api/skills/market?' + params.toString());
        state.market = d.skills || [];
        await loadInstalled();   // 先加载已安装集合，市场按钮才能正确显示「已安装」态
        renderMarketGrid();
      } catch (e) { grid.innerHTML = '<div class="empty" style="color:var(--err)">加载失败：' + escapeHtml(e.message) + '</div>'; }
    }

    async function loadTemplates() {
      try {
        const d = await api('/api/templates');
        renderBuiltin(d.builtin || []);
        renderNodeTpl(d.node || []);
        renderCustomTpl(d.custom || []);
        renderUserTpl(d.user || []);
      } catch (e) { console.warn('加载模板失败', e); }
    }

    /* ========== 节点管理 ========== */
    async function loadNodes() {
      try {
        const d = await api('/api/nodes');
        renderNodesGrid(d.nodes || []);
      } catch (e) { console.warn('加载节点失败', e); }
    }
    async function saveNode(data) {
      try {
        const d = data.id
          ? await api('/api/nodes/' + data.id, 'PUT', data)
          : await api('/api/nodes', 'POST', data);
        await loadNodes();
        toast(data.id ? '节点已更新' : '节点已添加，连接状态：' + (d.connection?.ok ? '成功' : '失败'));
        return d;
      } catch (e) { toast('保存失败：' + e.message); }
    }
    async function deleteNode(id) {
      try { await api('/api/nodes/' + id, 'DELETE'); await loadNodes(); toast('已删除节点'); }
      catch (e) { toast('删除失败：' + e.message); }
    }
    async function testNode(id) {
      try {
        const d = await api('/api/nodes/' + id + '/test', 'POST');
        toast(d.ok ? '连接成功' : '连接失败：' + (d.error || ''));
        await loadNodes();
        return d;
      } catch (e) { toast('测试失败：' + e.message); }
    }
    async function syncNode(id) {
      try {
        const d = await api('/api/nodes/' + id + '/sync', 'POST');
        toast(d.ok ? '同步完成：' + (d.synced || []).join('、') : '同步失败：' + (d.error || ''));
        await loadNodes();
        await loadTemplates();
        await loadMarket();
        await loadOffice();
        return d;
      } catch (e) { toast('同步失败：' + e.message); }
    }
    async function toggleNode(id, enabled) {
      try { await api('/api/nodes/' + id, 'PUT', { enabled }); await loadNodes(); }
      catch (e) { toast('操作失败：' + e.message); }
    }

    /* ========== 自定义来源 ========== */
    async function loadSources() {
      try {
        const d = await api('/api/sources');
        renderSourcesGrid(d.sources || []);
      } catch (e) { console.warn('加载来源失败', e); }
    }
    async function saveSource(data) {
      try {
        const d = data.id
          ? await api('/api/sources/' + data.id, 'PUT', data)
          : await api('/api/sources', 'POST', data);
        await loadSources();
        toast(data.id ? '来源已更新' : '来源已添加');
        return d;
      } catch (e) { toast('保存失败：' + e.message); }
    }
    async function deleteSource(id) {
      try { await api('/api/sources/' + id, 'DELETE'); await loadSources(); toast('已删除来源'); }
      catch (e) { toast('删除失败：' + e.message); }
    }

    async function delAuto(id) {
      try { await api('/api/automations/' + id, 'DELETE'); await loadAutomations(); toast('已删除'); }
      catch (e) { toast('删除失败：' + e.message); }
    }

    async function runAuto(id) {
      try { const d = await api('/api/automations/' + id + '/run', 'POST'); toast('已发起任务，运行次数 ' + d.runCount); await loadTasks(); }
      catch (e) { toast('运行失败：' + e.message); }
    }

    async function loadAutomations() {
      try { const d = await api('/api/automations'); renderBuiltinAutomations(d.builtin || []); renderAutoGrid(d.automations || []); }
      catch (e) { console.warn('加载自动化失败', e); }
    }

    async function getDrivesList() {
      if (_drivesCache) return _drivesCache;
      try {
        const d = await api('/api/drives');
        _drivesCache = d.drives || [];
        return _drivesCache;
      } catch {
        return ['C:\\', 'D:\\', 'E:\\', 'F:\\', 'H:\\'];
      }
    }

    async function loadWorkspaceTree(dir) {
      // 已废弃：左侧工作区树已移除，保留此函数仅供兼容
      return;
    }

    async function loadWorkspace() {
      if (!state.token) {
        console.warn('[workspace] 未登录，跳过加载');
        return;
      }
      try {
        const d = await api('/api/workspace');
        state.workspaceDir = d.cwd;
        // 持久化到 localStorage
        localStorage.setItem('fhcode.workspaceDir', d.cwd);
        renderWorkspaceBar();
        console.log('[workspace] 加载成功:', d.cwd);
      } catch (e) {
        console.error('[workspace] 加载失败:', e.message);
        toast('工作区加载失败，请检查登录状态');
      }
    }

    async function setDefaultModel(id) {
      try {
        const d = await api('/api/models/' + encodeURIComponent(id) + '/default', 'POST');
        state.defaultModelId = d.defaultId;
        state.modelId = d.defaultId;
        localStorage.setItem('fhcode.model', '');
        renderModelSelect();
        renderModelList();
        renderModelListInline();
        toast('已设为默认大模型');
      } catch (e) { toast('设置失败：' + e.message); }
    }

    async function deleteModel(id) {
      try {
        await api('/api/models/' + encodeURIComponent(id), 'DELETE');
        toast('已删除配置');
        await loadModels();
        renderModelList();
      } catch (e) { toast('删除失败：' + e.message); }
    }

    async function saveModel() {
      const name = document.getElementById('modelName').value.trim();
      const apiBase = document.getElementById('modelApiBase').value.trim();
      const apiKey = document.getElementById('modelApiKey').value;
      const reasoning = document.getElementById('modelReasoning').value;
      const msg = document.getElementById('modelFormMsg');
      if (!name) { msg.textContent = '请填写模型名称'; msg.classList.add('err'); return; }
      const editing = document.getElementById('modelSaveBtn').dataset.editing;
      try {
        const body = { name, apiBase, reasoning };
        // 三重加密·通信层：密钥经 RSA 公钥加密传输，杜绝明文出网（编辑留空则服务端保留原密钥）
        if (apiKey) body.apiKeyEnc = await rsaEncryptText(apiKey);
        if (editing) body.id = editing;
        const d = await api('/api/models', 'POST', body);
        msg.textContent = '已保存：' + d.model.name;
        msg.classList.remove('err');
        await loadModels();
        renderModelList();
        resetModelForm();
      } catch (e) { msg.textContent = '保存失败：' + e.message; msg.classList.add('err'); }
    }

    async function loadModels() {
      try {
        const d = await api('/api/models');
        state.models = d.models || [];
        state.defaultModelId = d.defaultId || null;
        const manual = localStorage.getItem('fhcode.model');
        if (manual !== null && manual !== '') {
          state.modelId = manual;
        } else {
          state.modelId = state.defaultModelId || '';
        }
        renderModelSelect();
      } catch (e) { console.warn('加载大模型失败', e); }
    }

    async function rsaEncryptText(text) {
      if (!text) return '';
      const d = await api('/api/security/public-key');
      const b64 = String(d.publicKey || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
      if (!b64) throw new Error('未获取到加密公钥');
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const key = await crypto.subtle.importKey('spki', buf.buffer, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
      const enc = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(text));
      return btoa(String.fromCharCode.apply(null, new Uint8Array(enc)));
    }

    async function loadTasks() {
      if (!state.token) return;
      try {
        const d = await api('/api/tasks');
        state.tasks = d.tasks || [];
        renderSidebarTaskList();
        // 刷新页面：不自动选中旧任务，聊天区保持清空；
        // 历史任务全部保留在左侧「任务列表」，点击即可回看对话。
        if (state.currentTaskId) {
          await refreshCurrentThread();
        } else {
          renderTaskThread(null);
        }
      }
      catch (e) { console.warn('加载任务失败', e); }
    }

    async function doLogin() {
      const input = document.getElementById('loginPhone');
      const status = document.getElementById('loginStatus');
      const btn = document.getElementById('loginBtn');
      const phone = (input.value || '').trim();
      if (!/^\d{6,20}$/.test(phone)) { status.textContent = '请输入有效的手机号码'; status.classList.add('err'); return; }
      btn.disabled = true;
      status.textContent = '登录中…';
      status.classList.remove('err');
      try {
        const d = await api('/api/auth/login', 'POST', { phone });
        if (!d || !d.token) throw new Error('服务端未返回令牌');
        state.token = d.token;
        state.phone = d.phone || phone;
        localStorage.setItem('fhcode.token', state.token);
        localStorage.setItem('fhcode.phone', state.phone);
        // 保存引导任务（供首次登录后展示）
        if (d.isFirstLogin && d.welcomeTasks) {
          await saveWelcomeTasks(d.welcomeTasks);
        }
        status.classList.remove('err');
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('appLayout').classList.add('show');
        document.documentElement.classList.add('logged-in');
        await afterLogin();
      } catch (e) {
        status.textContent = '登录失败：' + e.message;
        status.classList.add('err');
      } finally {
        btn.disabled = false;
      }
    }

    async function api(path, method = 'GET', body) {
      let res;
      try {
        res = await fetch(path, { method, headers: authHeaders(), body: body ? JSON.stringify(body) : undefined });
      } catch (e) {
        // 网络层失败（Failed to fetch / 连接拒绝 / 超时中断）：标记后端可能已断开
        if (typeof BackendConn !== 'undefined') BackendConn.markFailure();
        throw e;
      }
      // 请求到达后端并返回响应：若之前处于断连状态，立即恢复
      if (typeof BackendConn !== 'undefined' && !BackendConn.online) BackendConn.setOnline(true);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        // 401：令牌确实被服务端拒绝，清除并回到登录页。
        // 会话已落盘（web-sessions.json），正常重启不会再走到这里；
        // 走到这里说明令牌真的过期或被吊销，此时给出明确提示，避免用户以为是"莫名跳回登录"。
        if (res.status === 401 && d.error === 'unauthorized') {
          if (state.token) {
            console.warn('[api] token 已被服务端拒绝，清除并回到登录页:', path);
            localStorage.removeItem('fhcode.token');
            state.token = '';
            try { toast('登录已过期，请重新登录'); } catch {}
          }
          const overlay = document.getElementById('loginOverlay');
          if (overlay) overlay.style.display = 'flex';
          throw new Error('登录已过期，请重新登录');
        }
        throw new Error(d.error || ('HTTP ' + res.status));
      }
      return res.json();
    }

    function authHeaders() {
      return state.token ? { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
    }

    /* ========== 后端连接状态监测（心跳 + 断连横幅 + 自动重连） ==========
     * 解决问题：后端进程崩溃后，前端无感知，用户操作均报 "Failed to fetch" 且不知原因。
     * 机制：
     *  1. 每 5s 轮询 /api/health，连续失败 2 次判定后端断开，顶部显示红色横幅。
     *  2. 断连后自动加快到每 2s 重试，恢复后自动切回 5s 并 toast 提示。
     *  3. 任意 api() 调用网络失败也会累计失败计数（双保险，不必等下一轮心跳）。
     *  4. 页面从后台切回 / 网络恢复事件时立即检测一次。
     */
    const BackendConn = {
      online: true,
      heartbeatTimer: null,
      reconnectTimer: null,
      intervalMs: 5000,       // 正常心跳间隔
      reconnectMs: 2000,       // 断连后重连检测间隔
      consecutiveFailures: 0,
      threshold: 2,             // 连续失败 N 次才判定断开（避免瞬时抖动误报）
      healthTimeoutMs: 3000,    // 单次健康检查超时

      init() {
        this.startHeartbeat();
        // 重连按钮
        const btn = document.getElementById('backendReconnectBtn');
        if (btn) btn.addEventListener('click', () => this.reconnect());
        // 页面从后台切回前台时立即检测
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) this.check();
        });
        // 浏览器网络恢复事件
        window.addEventListener('online', () => this.check());
      },

      startHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => this.check(), this.intervalMs);
      },

      async check() {
        try {
          const ctrl = new AbortController();
          const timeout = setTimeout(() => ctrl.abort(), this.healthTimeoutMs);
          const res = await fetch('/api/health', {
            method: 'GET',
            signal: ctrl.signal,
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
          });
          clearTimeout(timeout);
          if (res.ok) {
            this.consecutiveFailures = 0;
            this.setOnline(true);
          } else {
            this.markFailure();
          }
        } catch (e) {
          this.markFailure();
        }
      },

      /** 累计失败次数，达到阈值则判定断开 */
      markFailure() {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.threshold) {
          this.setOnline(false);
        }
      },

      setOnline(online) {
        if (this.online === online) return;
        this.online = online;
        const banner = document.getElementById('backendOfflineBanner');
        const text = document.getElementById('backendOfflineText');
        if (banner) {
          banner.style.display = online ? 'none' : 'flex';
        }
        if (online) {
          // 恢复：切回正常心跳间隔
          if (this.reconnectTimer) { clearInterval(this.reconnectTimer); this.reconnectTimer = null; }
          this.startHeartbeat();
          try { toast('后端服务已恢复连接'); } catch (e) {}
        } else {
          // 断开：停止正常心跳，加快重连检测
          if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
          if (!this.reconnectTimer) {
            this.reconnectTimer = setInterval(() => this.check(), this.reconnectMs);
          }
          if (text) text.textContent = '后端服务已断开，正在自动重连…';
        }
      },

      /** 手动触发重连：重置失败计数并立即检测 */
      reconnect() {
        const text = document.getElementById('backendOfflineText');
        if (text) text.textContent = '正在重连后端服务…';
        this.consecutiveFailures = 0;
        this.check();
      },
    };

    // 页面加载完成后启动心跳监测
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => BackendConn.init());
    } else {
      BackendConn.init();
    }

    /* ========== v7.2.0 新能力 API 封装（voice / knowledge / plugins / sso）==========
     * 修复：v7.2 新增能力此前前端 0 调用。以下封装供能力中心面板使用。
     */
    async function apiVoiceParse(text) {
      return api('/api/voice/parse', 'POST', { text });
    }
    async function apiVoiceCommands() {
      return api('/api/voice/commands');
    }
    async function apiVoiceToCode(description, language) {
      return api('/api/voice/to-code', 'POST', { description, language: language || 'typescript' });
    }
    async function apiKnowledgeStats() {
      return api('/api/knowledge/stats');
    }
    async function apiKnowledgeList(params) {
      const qs = new URLSearchParams();
      if (params) { for (const k of ['category', 'type', 'sortBy', 'order', 'limit', 'offset']) { if (params[k]) qs.set(k, params[k]); } }
      const s = qs.toString();
      return api('/api/knowledge/documents' + (s ? '?' + s : ''));
    }
    async function apiKnowledgeSearch(query, extra) {
      return api('/api/knowledge/search', 'POST', { query, ...(extra || {}) });
    }
    async function apiKnowledgeAdd(data) {
      return api('/api/knowledge/document', 'POST', data);
    }
    async function apiKnowledgeDelete(id) {
      return api('/api/knowledge/document/' + encodeURIComponent(id), 'DELETE');
    }
    async function apiPluginsMarket(q, category) {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (category) qs.set('category', category);
      const s = qs.toString();
      return api('/api/plugins/market' + (s ? '?' + s : ''));
    }
    async function apiPluginsList(status) {
      const s = status ? '?status=' + encodeURIComponent(status) : '';
      return api('/api/plugins' + s);
    }
    async function apiPluginsInstall(plugin) {
      return api('/api/plugins/install', 'POST', { plugin });
    }
    async function apiSsoProviders() {
      return api('/api/sso/providers');
    }

    /* ========== P1-1: 代码补全（ghost text）========== */
    async function apiCompletion(filePath, fileContent, opts) {
      return api('/api/completion', 'POST', {
        filePath,
        fileContent,
        cursorOffset: opts?.cursorOffset ?? fileContent.length,
        mode: opts?.mode ?? 'quick',
        language: opts?.language,
      });
    }
