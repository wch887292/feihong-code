/**
 * UI 渲染模块：DOM 渲染与交互，依赖 utils 和 api
 */

    function initMemoryUI() {
      // 设置默认日期为今天
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('memDateInput').value = today;
      loadMemoryContent(today);

      // 事件只绑定一次（多次进出记忆页会累积监听器，导致一次点击多次请求）
      if (!window._memUIInited) {
        window._memUIInited = true;

        // Tab 切换
        document.querySelectorAll('.mem-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            document.querySelectorAll('.mem-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.mem-panel').forEach(p => p.classList.toggle('active', false));
            tab.classList.add('active');
            const panelId = tab.getAttribute('data-memtab') + 'Panel';
            document.getElementById(panelId)?.classList.add('active');
          });
        });

        // 查看按钮
        document.getElementById('memLoadDay')?.addEventListener('click', () => {
          const dateStr = document.getElementById('memDateInput').value;
          if (dateStr) loadMemoryContent(dateStr);
        });

        // 刷新按钮
        document.getElementById('memRefreshBtn')?.addEventListener('click', () => {
          loadMemoryStats();
          const dateStr = document.getElementById('memDateInput').value;
          if (dateStr) loadMemoryContent(dateStr);
          loadLongTermMemory();
        });

        // 立即总结按钮
        document.getElementById('memSummarizeBtn')?.addEventListener('click', async () => {
          const btn = document.getElementById('memSummarizeBtn');
          btn.disabled = true;
          btn.textContent = '⏳ 总结中...';
          try {
            const dateStr = document.getElementById('memDateInput').value || today;
            const d = await api('/api/memory/summarize', 'POST', { date: dateStr });
            toast('✅ ' + (d.message || '总结完成'));
            loadMemoryStats();
            loadSummaryHistory();
            loadLongTermMemory();
          } catch (e) {
            toast('总结失败：' + e.message);
          } finally {
            btn.disabled = false;
            btn.textContent = '✨ 立即总结';
          }
        });

        // 短期记忆：添加记录按钮（展开文本框）
        document.getElementById('memAddShort')?.addEventListener('click', () => {
          const editor = document.getElementById('memShortEditor');
          const input = document.getElementById('memShortInput');
          if (editor) {
            editor.style.display = editor.style.display === 'none' ? 'block' : 'none';
            if (editor.style.display !== 'none' && input) {
              input.value = '';
              input.focus();
            }
          }
        });
        // 短期记忆：取消
        document.getElementById('memShortCancel')?.addEventListener('click', () => {
          const editor = document.getElementById('memShortEditor');
          if (editor) editor.style.display = 'none';
        });
        // 短期记忆：保存
        document.getElementById('memShortSave')?.addEventListener('click', async () => {
          const input = document.getElementById('memShortInput');
          const content = input ? input.value.trim() : '';
          if (!content) { toast('请输入记录内容'); return; }
          try {
            await api('/api/memory/short', 'POST', {
              title: content.slice(0, 30) + (content.length > 30 ? '...' : ''),
              type: 'note',
              content: content,
            });
            toast('已添加到短期记忆');
            const editor = document.getElementById('memShortEditor');
            if (editor) editor.style.display = 'none';
            const dateStr = document.getElementById('memDateInput').value;
            if (dateStr) loadMemoryContent(dateStr);
            loadMemoryStats();
          } catch (e) {
            toast('添加失败：' + e.message);
          }
        });

        // 长期记忆：编辑按钮
        document.getElementById('memEditLong')?.addEventListener('click', () => {
          bindGhostTextOnce(); // P1-1: 编辑时启用 ghost text 补全
          const content = document.getElementById('memLongContent');
          const editor = document.getElementById('memLongEditor');
          const editBtn = document.getElementById('memEditLong');
          const saveBtn = document.getElementById('memSaveLong');
          const cancelBtn = document.getElementById('memCancelLong');
          const appendBtn = document.getElementById('memAppendLong');
          const appendEditor = document.getElementById('memLongAppendEditor');
          // 把当前内容放到编辑器
          if (editor && content) {
            editor.value = content.innerText || content.textContent || '';
          }
          if (content) content.style.display = 'none';
          if (editor) editor.style.display = 'block';
          if (editBtn) editBtn.style.display = 'none';
          if (appendBtn) appendBtn.style.display = 'none';
          if (appendEditor) appendEditor.style.display = 'none';
          if (saveBtn) saveBtn.style.display = '';
          if (cancelBtn) cancelBtn.style.display = '';
        });
        // 长期记忆：取消编辑
        document.getElementById('memCancelLong')?.addEventListener('click', () => {
          const content = document.getElementById('memLongContent');
          const editor = document.getElementById('memLongEditor');
          const editBtn = document.getElementById('memEditLong');
          const saveBtn = document.getElementById('memSaveLong');
          const cancelBtn = document.getElementById('memCancelLong');
          const appendBtn = document.getElementById('memAppendLong');
          if (content) content.style.display = '';
          if (editor) editor.style.display = 'none';
          if (editBtn) editBtn.style.display = '';
          if (appendBtn) appendBtn.style.display = '';
          if (saveBtn) saveBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'none';
        });
        // 长期记忆：保存编辑
        document.getElementById('memSaveLong')?.addEventListener('click', async () => {
          const editor = document.getElementById('memLongEditor');
          const content = editor ? editor.value : '';
          try {
            await api('/api/memory/long', 'POST', { content });
            toast('长期记忆已保存');
            document.getElementById('memCancelLong')?.click();
            loadLongTermMemory();
            loadMemoryStats();
          } catch (e) {
            toast('保存失败：' + e.message);
          }
        });
        // 长期记忆：追加按钮（展开文本框）
        document.getElementById('memAppendLong')?.addEventListener('click', () => {
          const editor = document.getElementById('memLongAppendEditor');
          const titleInput = document.getElementById('memAppendTitle');
          const contentInput = document.getElementById('memAppendContent');
          if (editor) {
            editor.style.display = editor.style.display === 'none' ? 'block' : 'none';
            if (editor.style.display !== 'none') {
              if (titleInput) titleInput.value = '';
              if (contentInput) contentInput.value = '';
              if (titleInput) titleInput.focus();
            }
          }
        });
        // 长期记忆：取消追加
        document.getElementById('memAppendCancel')?.addEventListener('click', () => {
          const editor = document.getElementById('memLongAppendEditor');
          if (editor) editor.style.display = 'none';
        });
        // 长期记忆：确认追加
        document.getElementById('memAppendSave')?.addEventListener('click', async () => {
          const titleInput = document.getElementById('memAppendTitle');
          const contentInput = document.getElementById('memAppendContent');
          const title = titleInput ? titleInput.value.trim() : '';
          const content = contentInput ? contentInput.value.trim() : '';
          if (!title || !content) { toast('请输入标题和内容'); return; }
          try {
            await api('/api/memory/long/append', 'POST', { title, category: '自定义', content });
            toast('已追加到长期记忆');
            const editor = document.getElementById('memLongAppendEditor');
            if (editor) editor.style.display = 'none';
            loadLongTermMemory();
            loadMemoryStats();
          } catch (e) {
            toast('追加失败：' + e.message);
          }
        });
      }

      // 每次进入都刷新数据（事件不重复绑定，数据实时刷新）
      loadMemoryStats();
      loadLongTermMemory();
      loadSummaryHistory();
    }

    function renderMarketGrid() {
      const grid = document.getElementById('marketGrid');
      if (!state.market.length) { renderEmpty(grid, t('empty.no_skills')); return; }
      grid.innerHTML = state.market.map((s) => {
        const installed = state.installed.has(s.id);
        const btn = installed
          ? '<button class="install" disabled style="opacity:.55;cursor:default;">✅ 已安装</button>'
          : '<button class="install" data-id="' + encodeURIComponent(s.id) + '" data-name="' + encodeURIComponent(s.name) + '" data-source="' + s.source + '">安装</button>';
        return '<div class="tile"><div class="icon">' + (s.source === 'clawhub' ? '🧩' : '🛠') + '</div><div class="title">' + escapeHtml(s.name) + '</div><div class="desc">' + escapeHtml(s.description).slice(0, 70) + '…<br><span class="muted">' + (s.source === 'clawhub' ? 'ClawHub' : 'Agent-Foundry') + ' · 下载 ' + (s.downloads || 0) + '</span></div><div class="ops">' + btn + '</div></div>';
      }).join('');
      grid.querySelectorAll('button.install').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        installSkill(b.getAttribute('data-id'), b.getAttribute('data-name'), b.getAttribute('data-source'));
      }));
    }

    function bindTplCards(grid) {
      grid.querySelectorAll('button.use').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const inp = document.getElementById('goalInput');
        if (inp) inp.value = decodeURIComponent(b.getAttribute('data-goal'));
        switchView('chat');
        if (inp) inp.focus();
        toast('已填入输入框，去发送吧');
      }));
      grid.querySelectorAll('button.del').forEach((b) => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await api('/api/templates/' + b.getAttribute('data-id'), 'DELETE'); await loadTemplates(); toast('已删除'); }
        catch (err) { toast('删除失败：' + err.message); }
      }));
    }

    function renderUserTpl(list) {
      const grid = document.getElementById('userTplGrid');
      if (!list.length) { renderEmpty(grid, t('empty.no_templates')); return; }
      grid.innerHTML = list.map((t) => tplCard(t, true)).join('');
      bindTplCards(grid);
    }

    function renderBuiltin(list) {
      const grid = document.getElementById('builtinGrid');
      if (!list.length) { renderEmpty(grid, t('empty.no_builtin_templates')); return; }
      grid.innerHTML = list.map((t) => tplCard(t, false)).join('');
      bindTplCards(grid);
    }

    function tplCard(t, deletable) {
      return '<div class="tile" data-goal="' + encodeURIComponent(t.goal) + '"><div class="icon">' + (t.icon || '📄') + '</div><div class="title">' + escapeHtml(t.title) + '</div><div class="desc">' + escapeHtml(t.category || '') + ' · ' + escapeHtml(t.goal).slice(0, 40) + '…</div><div class="ops"><button class="use" data-goal="' + encodeURIComponent(t.goal) + '">填入输入框</button>' + (deletable ? '<button class="ghost del" data-id="' + t.id + '">删除</button>' : '') + '</div></div>';
    }

    function renderBuiltinAutomations(list) {
      const grid = document.getElementById('builtinAutoGrid');
      if (!grid) return;
      if (!list.length) { renderEmpty(grid, '暂无预置指令'); return; }
      grid.innerHTML = list.map((a) => {
        const icon = a.icon || '⚡';
        const category = a.category || '常用';
        const goalPreview = (a.goal || '').slice(0, 50) + ((a.goal || '').length > 50 ? '…' : '');
        return '<div class="tile builtin-tile" data-id="' + escapeHtml(a.id) + '">'
          + '<div class="icon">' + icon + '</div>'
          + '<div class="title">' + escapeHtml(a.name) + '</div>'
          + '<div class="desc"><span style="color:var(--brand);font-weight:500;">' + escapeHtml(category) + '</span> · ' + escapeHtml(goalPreview) + '</div>'
          + '<div class="ops">'
          + '<button class="run builtin-run" data-id="' + escapeHtml(a.id) + '">▶ 运行</button>'
          + '<button class="ghost builtin-save" data-id="' + escapeHtml(a.id) + '" data-name="' + escapeHtml(a.name) + '" data-goal="' + encodeURIComponent(a.goal || '') + '">＋ 保存为我的</button>'
          + '</div></div>';
      }).join('');
      grid.querySelectorAll('button.builtin-run').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        runAuto(b.getAttribute('data-id'));
      }));
      grid.querySelectorAll('button.builtin-save').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = b.getAttribute('data-name') || '';
        const goal = decodeURIComponent(b.getAttribute('data-goal') || '');
        saveBuiltinAsMine(name, goal);
      }));
    }

    async function saveBuiltinAsMine(name, goal) {
      try {
        await api('/api/automations', 'POST', { name, goal });
        await loadAutomations();
        toast('已保存到「我的指令」，可在那里编辑');
      } catch (e) { toast('保存失败：' + e.message); }
    }

    function renderAutoGrid(list) {
      const grid = document.getElementById('autoGrid');
      if (!list.length) { renderEmpty(grid, t('empty.no_automations')); return; }
      grid.innerHTML = list.map((a) => {
        const icon = a.icon || '⚡';
        const category = a.category ? ' · ' + escapeHtml(a.category) : '';
        return '<div class="tile" data-id="' + a.id + '">'
          + '<div class="icon">' + icon + '</div>'
          + '<div class="title">' + escapeHtml(a.name) + category + '</div>'
          + '<div class="desc">' + escapeHtml(a.goal).slice(0, 60) + (a.goal.length > 60 ? '…' : '') + '<br>已运行 ' + a.runCount + ' 次</div>'
          + '<div class="ops"><button class="run" data-id="' + a.id + '">▶ 运行</button><button class="ghost del" data-id="' + a.id + '">删除</button></div></div>';
      }).join('');
      grid.querySelectorAll('button.run').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); runAuto(b.getAttribute('data-id')); }));
      grid.querySelectorAll('button.del').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); delAuto(b.getAttribute('data-id')); }));
    }

    /* ========== 节点模板 & 自定义来源模板 ========== */
    function renderNodeTpl(list) {
      const grid = document.getElementById('nodeTplGrid');
      const title = document.getElementById('nodeTplTitle');
      if (!grid) return;
      if (!list.length) { if (title) title.style.display = 'none'; grid.innerHTML = ''; return; }
      if (title) title.style.display = '';
      grid.innerHTML = list.map((t) => tplCard(t, false)).join('');
      bindTplCards(grid);
    }
    function renderCustomTpl(list) {
      const grid = document.getElementById('customTplGrid');
      const title = document.getElementById('customTplTitle');
      if (!grid) return;
      if (!list.length) { if (title) title.style.display = 'none'; grid.innerHTML = ''; return; }
      if (title) title.style.display = '';
      grid.innerHTML = list.map((t) => tplCard(t, false)).join('');
      bindTplCards(grid);
    }

    /* ========== 节点管理渲染 ========== */
    function renderNodesGrid(list) {
      const grid = document.getElementById('nodesGrid');
      if (!grid) return;
      window._nodesCache = list;
      if (!list.length) { grid.innerHTML = '<div class="empty">还没有添加节点，点击上方「添加节点」连接外部服务</div>'; return; }
      grid.innerHTML = list.map((n) => {
        const statusColor = n.status === 'connected' ? 'var(--ok)' : n.status === 'error' ? 'var(--err)' : 'var(--muted)';
        const statusText = n.status === 'connected' ? '已连接' : n.status === 'error' ? '连接失败' : '未连接';
        const caps = (n.capabilities || []).map((c) => c === 'templates' ? '模板' : c === 'skills' ? '插件' : '办公').join('、');
        return '<div class="tile node-tile" data-id="' + n.id + '">'
          + '<div class="icon">' + (n.type === 'http' ? '🌐' : n.type === 'local' ? '📁' : '📦') + '</div>'
          + '<div class="title">' + escapeHtml(n.name) + ' <span style="font-size:11px;color:' + statusColor + ';">● ' + statusText + '</span></div>'
          + '<div class="desc">' + escapeHtml(n.url).slice(0, 50) + '…<br>能力：' + caps + (n.lastSyncAt ? '<br>上次同步：' + fmtTime(n.lastSyncAt) : '') + (n.lastError ? '<br style="color:var(--err);">错误：' + escapeHtml(n.lastError) : '') + '</div>'
          + '<div class="ops" style="flex-wrap:wrap;">'
          + '<button class="run node-sync" data-id="' + n.id + '">🔄 同步</button>'
          + '<button class="ghost node-test" data-id="' + n.id + '">测试</button>'
          + '<button class="ghost node-edit" data-id="' + n.id + '">编辑</button>'
          + '<button class="ghost del node-del" data-id="' + n.id + '">删除</button>'
          + '</div></div>';
      }).join('');
      grid.querySelectorAll('button.node-sync').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); syncNode(b.getAttribute('data-id')); }));
      grid.querySelectorAll('button.node-test').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); testNode(b.getAttribute('data-id')); }));
      grid.querySelectorAll('button.node-edit').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); editNode(b.getAttribute('data-id')); }));
      grid.querySelectorAll('button.node-del').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); if (confirm('确定删除此节点？')) deleteNode(b.getAttribute('data-id')); }));
    }

    /* ========== 自定义来源渲染 ========== */
    function renderSourcesGrid(list) {
      const grid = document.getElementById('sourcesGrid');
      if (!grid) return;
      window._sourcesCache = list;
      if (!list.length) { grid.innerHTML = '<div class="empty">还没有自定义来源，点击上方「自定义来源」添加远程数据源</div>'; return; }
      const typeMap = { templates: '模板', skills: '插件', office: '办公' };
      grid.innerHTML = list.map((s) => '<div class="tile" data-id="' + s.id + '">'
        + '<div class="icon">🔗</div>'
        + '<div class="title">' + escapeHtml(s.name) + ' <span style="font-size:11px;color:var(--brand);">' + (typeMap[s.type] || s.type) + '</span></div>'
        + '<div class="desc">' + escapeHtml(s.url).slice(0, 60) + '…<br>状态：' + (s.enabled ? '已启用' : '已禁用') + '</div>'
        + '<div class="ops">'
        + '<button class="ghost source-edit" data-id="' + s.id + '">编辑</button>'
        + '<button class="ghost del source-del" data-id="' + s.id + '">删除</button>'
        + '</div></div>').join('');
      grid.querySelectorAll('button.source-edit').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); editSource(b.getAttribute('data-id')); }));
      grid.querySelectorAll('button.source-del').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); if (confirm('确定删除此来源？')) deleteSource(b.getAttribute('data-id')); }));
    }

    function renderWorkspaceBar() {
      const el = document.getElementById('workspaceCwdBottom');
      if (el) el.textContent = state.workspaceDir || '（未设置）';
    }

    function openPermissions() {
      const p = state.permissions;
      document.querySelector('input[name="readScope"][value="' + p.readScope + '"]').checked = true;
      document.getElementById('permReadPath').value = p.readPath || '';
      document.getElementById('permRead').checked = p.allowRead;
      document.getElementById('permWrite').checked = p.allowWrite;
      document.getElementById('permShell').checked = p.allowShell;
      document.getElementById('permNetwork').checked = p.allowNetwork;
      document.getElementById('permBrowser').checked = p.allowBrowser;
      openModal('permModal');
    }

    function openAgentSelector() {
      const grid = document.getElementById('agentGrid');
      grid.innerHTML = Object.entries(AGENT_TYPES).map(([k, v]) =>
        '<div class="agent-card ' + (state.agentType === k ? 'selected' : '') + '" data-type="' + k + '"><div class="icon">' + v.icon + '</div><div class="title">' + v.label + '</div></div>'
      ).join('');
      grid.querySelectorAll('.agent-card').forEach((c) => c.addEventListener('click', () => {
        state.agentType = c.getAttribute('data-type');
        updateUserBar();
        closeModal('agentModal');
        toast('已切换：' + AGENT_TYPES[state.agentType].label);
      }));
      openModal('agentModal');
    }

    function fillInlineForm(id) {
      const m = state.models.find((x) => x.id === id);
      if (!m) return;
      document.getElementById('imName').value = m.name;
      document.getElementById('imBase').value = m.apiBase || '';
      document.getElementById('imKey').value = ''; // 密钥不回填（服务端加密存储，防泄露）
      document.getElementById('imReasoning').value = m.reasoning || '';
      document.getElementById('imMsg').textContent = '正在编辑：' + m.name + '（密钥已加密存储，留空保持不变）';
      document.getElementById('imMsg').classList.remove('err');
      document.getElementById('imSave').dataset.editing = id;
    }

    function resetInlineForm() {
      document.getElementById('imName').value = '';
      document.getElementById('imBase').value = '';
      document.getElementById('imKey').value = '';
      document.getElementById('imReasoning').value = '';
      document.getElementById('imMsg').textContent = '';
      document.getElementById('imMsg').classList.remove('err');
      document.getElementById('imSave').dataset.editing = '';
    }

    function renderModelListInline() {
      const list = document.getElementById('modelListInline');
      if (!state.models.length) {
        list.innerHTML =
          '<div class="mm-empty">' +
            '<div class="mm-empty-icon">🧠</div>' +
            '<div>还没有模型配置</div>' +
            '<div class="mm-empty-hint">在下方添加第一个模型，保存后即可在对话中使用</div>' +
          '</div>';
        return;
      }
      list.innerHTML = state.models.map((m) => {
        const url = (m.apiBase || '').trim() || '（未填写 API 地址）';
        const meta = m.reasoning ? '已配置推理中间环节' : '未配置推理中间环节';
        const tag = m.default ? '<span class="mm-default-tag">默认</span>' : '';
        const defaultBtn = m.default ? '' : '<button class="mm-act mm-act-primary" data-act="default">设为默认</button>';
        return (
          '<div class="mm-card" data-id="' + escapeHtml(m.id) + '">' +
            '<div class="mm-card-head">' +
              '<span class="mm-card-name">' + escapeHtml(m.name) + '</span>' +
              tag +
            '</div>' +
            '<div class="mm-card-url">' + escapeHtml(url) + '</div>' +
            '<div class="mm-card-meta">' + meta + '</div>' +
            '<div class="mm-card-actions">' +
              defaultBtn +
              '<button class="mm-act" data-act="edit">编辑</button>' +
              '<button class="mm-act mm-act-danger" data-act="del">删除</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');
      list.querySelectorAll('.mm-card').forEach((el) => {
        const id = el.getAttribute('data-id');
        el.querySelectorAll('button').forEach((b) => {
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = b.getAttribute('data-act');
            if (act === 'default') setDefaultModel(id);
            else if (act === 'edit') fillInlineForm(id);
            else if (act === 'del') deleteModel(id);
          });
        });
      });
    }

    function toggleModelManage() {
      const box = document.getElementById('modelManage');
      const open = box.style.display === 'none' || !box.style.display;
      box.style.display = open ? '' : 'none';
      if (open) { renderModelListInline(); resetInlineForm(); }
    }

    function openSettings() {
      // 打开设置时同步会话开关状态，避免界面显示与真实配置不一致
      document.querySelectorAll('.session-toggle').forEach((el) => {
        const key = el.dataset.key;
        if (key && key in state.sessionConfig) el.checked = !!state.sessionConfig[key];
      });
      openModal('settingsModal');
    }

    function persistSessionConfig() {
      localStorage.setItem('fhcode.sessionConfig', JSON.stringify(state.sessionConfig));
    }

    function editModel(id) {
      const m = state.models.find((x) => x.id === id);
      if (!m) return;
      document.getElementById('modelName').value = m.name;
      document.getElementById('modelApiBase').value = m.apiBase || '';
      document.getElementById('modelApiKey').value = ''; // 密钥不回填（服务端加密存储，防泄露）
      document.getElementById('modelReasoning').value = m.reasoning || '';
      document.getElementById('modelFormMsg').textContent = '正在编辑：' + m.name + '（密钥已加密存储，留空保持不变）';
      document.getElementById('modelFormMsg').classList.remove('err');
      document.getElementById('modelSaveBtn').dataset.editing = id;
    }

    function resetModelForm() {
      document.getElementById('modelName').value = '';
      document.getElementById('modelApiBase').value = '';
      document.getElementById('modelApiKey').value = '';
      document.getElementById('modelReasoning').value = '';
      document.getElementById('modelFormMsg').textContent = '';
      document.getElementById('modelFormMsg').classList.remove('err');
      document.getElementById('modelSaveBtn').dataset.editing = '';
    }

    function renderModelList() {
      const list = document.getElementById('modelList');
      if (!state.models.length) {
        renderEmpty(list, t('empty.no_models'));
        return;
      }
      list.innerHTML = state.models.map((m) => (
        '<div class="model-item" data-id="' + escapeHtml(m.id) + '">' +
          '<div><div class="mi-name">' + escapeHtml(m.name) + '</div>' +
          '<div class="mi-base">' + escapeHtml(m.apiBase || '（未填写 API 地址）') + (m.reasoning ? ' · 已配推理内容' : '') + '</div></div>' +
          (m.default ? '<span class="mi-default">默认</span>' : '') +
          '<div class="mi-actions">' +
            (m.default ? '' : '<button data-act="default">设为默认</button>') +
            '<button data-act="edit">编辑</button>' +
            '<button class="danger" data-act="del">删除</button>' +
          '</div>' +
        '</div>'
      )).join('');
      list.querySelectorAll('.model-item').forEach((el) => {
        const id = el.getAttribute('data-id');
        el.querySelectorAll('button').forEach((b) => {
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = b.getAttribute('data-act');
            if (act === 'default') setDefaultModel(id);
            else if (act === 'edit') editModel(id);
            else if (act === 'del') deleteModel(id);
          });
        });
      });
    }

    function openModels() {
      renderModelList();
      resetModelForm();
      openModal('modelModal');
    }

    function renderModelSelect() {
      const sel = document.getElementById('modelSelect');
      const opts = ['<option value="">默认（系统路由）</option>'];
      state.models.forEach((m) => {
        opts.push('<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.name) + (m.default ? ' ★' : '') + '</option>');
      });
      sel.innerHTML = opts.join('');
      sel.value = state.modelId || '';
    }

    function toggleDirectMode() {
      state.directMode = !state.directMode;
      document.getElementById('directModePill').style.display = state.directMode ? 'inline-flex' : 'none';
      const computerTab = document.getElementById('computerTab');
      if (computerTab) {
        computerTab.style.display = state.directMode ? '' : 'none';
        if (state.directMode) {
          // 切换到电脑操作标签页
          document.querySelectorAll('.right-tab').forEach(t => t.classList.remove('active'));
          computerTab.classList.add('active');
          document.querySelectorAll('.preview-panel').forEach(p => p.classList.remove('active'));
          document.getElementById('computerPanel')?.classList.add('active');
        }
      }
      toast(state.directMode ? '已开启「电脑操作」模式，可以用语言控制电脑' : '已关闭「电脑操作」模式');
    }

    function previewImage(path) {
      document.getElementById('previewTitle').textContent = '图片: ' + path;
      const box = document.getElementById('previewContent');
      const img = document.createElement('img');
      img.src = 'file://' + path;
      img.style.maxWidth = '100%';
      img.style.borderRadius = '8px';
      img.addEventListener('error', () => {
        box.innerHTML = '<div class="muted">无法直接显示本地图片，请用系统相册打开</div>';
      });
      box.innerHTML = '';
      box.appendChild(img);
      switchRightTab('preview');
    }

    async function previewFile(path) {
      try {
        const d = await api('/api/files/read', 'POST', { path });
        showPreview('文件: ' + path, d.content, 'file');
        switchRightTab('preview');
      } catch (e) { toast('预览失败：' + e.message); }
    }

    function bindArtifacts(container) {
      container.querySelectorAll('.artifact').forEach((el) => {
        el.addEventListener('click', () => {
          const kind = el.getAttribute('data-kind');
          const path = el.getAttribute('data-path');
          if (kind === 'url') openBrowser(path);
          else previewFile(path);
        });
      });
      container.querySelectorAll('.file-chip').forEach((el) => {
        el.addEventListener('click', () => {
          const path = el.getAttribute('data-path');
          const mime = el.getAttribute('data-type') || '';
          if (mime.startsWith('image/')) previewImage(path);
          else previewFile(path);
        });
      });
    }

    function renderStagedFiles() {
      const box = document.getElementById('stagedArea');
      if (!box) return;
      if (!state.stagedFiles.length) {
        box.classList.remove('show');
        box.innerHTML = '';
        return;
      }
      box.classList.add('show');
      box.innerHTML = state.stagedFiles.map((f) => {
        const isImg = (f.mime || '').startsWith('image/');
        const icon = isImg ? '🖼' : '📎';
        return (
          '<div class="staged-chip" data-id="' + escapeHtml(f.id) + '">' +
            '<span>' + icon + '</span>' +
            '<span class="staged-name">' + escapeHtml(f.name) + '</span>' +
            '<span class="staged-size">' + formatSize(f.size) + '</span>' +
            '<button class="staged-remove" data-act="remove" title="移除">×</button>' +
          '</div>'
        );
      }).join('') + '<span class="staged-hint">💡 点发送时一起上传</span>';
      box.querySelectorAll('.staged-remove').forEach((b) => {
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const chip = b.closest('.staged-chip');
          if (chip) removeStagedFile(chip.getAttribute('data-id'));
        });
      });
    }

    function showPreview(title, content, mode) {
      document.getElementById('previewTitle').textContent = title;
      const box = document.getElementById('previewContent');
      const isCode = mode === 'code' || mode === 'file';
      // 从标题提取文件路径（标题格式："文件: /path/to/file"）
      const filePath = title.startsWith('文件: ') ? title.slice(4).trim() : '';
      if (isCode) {
        box.innerHTML =
          '<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;align-items:center;">' +
            '<button class="ghost-btn" id="previewEditBtn" style="font-size:11px;padding:3px 10px;">✏️ 编辑</button>' +
            '<button class="ghost-btn" id="previewStageBtn" style="font-size:11px;padding:3px 10px;display:none;background:#2d5a3d;color:#fff;">📝 暂存变更</button>' +
            '<button class="ghost-btn" id="previewCancelBtn" style="font-size:11px;padding:3px 10px;display:none;">取消</button>' +
            '<span class="muted" id="previewEditHint" style="font-size:11px;"></span>' +
            '<span class="muted" id="monacoStatus" style="font-size:10px;margin-left:auto;"></span>' +
          '</div>' +
          // P0-1: Monaco 编辑器容器（VSCode 同款内核，语法高亮+智能补全）
          '<div id="monacoContainer" style="width:100%;height:500px;border:1px solid var(--border);border-radius:6px;overflow:hidden;"></div>';
        const editBtn = document.getElementById('previewEditBtn');
        const stageBtn = document.getElementById('previewStageBtn');
        const cancelBtn = document.getElementById('previewCancelBtn');
        const hint = document.getElementById('previewEditHint');
        const monacoStatus = document.getElementById('monacoStatus');
        let monacoEditor = null;
        let originalContent = content;
        let isEditing = false;

        // 初始化 Monaco 只读视图（语法高亮）
        async function initMonacoReadOnly() {
          if (typeof FHMonaco === 'undefined') {
            monacoStatus.textContent = 'Monaco 未加载';
            return;
          }
          try {
            monacoStatus.textContent = '加载编辑器…';
            monacoEditor = await FHMonaco.createEditor('monacoContainer', content, filePath || 'untitled', {
              readOnly: true,
              domReadOnly: true,
              minimap: { enabled: content.length > 500 },
            });
            monacoStatus.textContent = '';
          } catch (e) {
            monacoStatus.textContent = '编辑器加载失败: ' + e.message;
          }
        }

        // 切换到编辑模式
        async function enterEditMode() {
          registerMonacoCompletions();
          if (!monacoEditor) {
            // 如果只读模式还没初始化，先创建可编辑实例
            monacoEditor = await FHMonaco.createEditor('monacoContainer', originalContent, filePath || 'untitled', {
              readOnly: false,
              minimap: { enabled: true },
            });
          } else {
            monacoEditor.updateOptions({ readOnly: false, domReadOnly: false });
          }
          isEditing = true;
          editBtn.style.display = 'none';
          stageBtn.style.display = 'inline-block';
          cancelBtn.style.display = 'inline-block';
          hint.textContent = filePath ? '编辑后点「暂存变更」· Tab 接受内联补全 · Ctrl+Space 选择补全' : '（未关联文件路径）';
          monacoStatus.textContent = '编辑模式';
          // 聚焦到编辑器末尾
          monacoEditor.focus();
          const model = monacoEditor.getModel();
          const lastLine = model.getLineCount();
          monacoEditor.setPosition({ lineNumber: lastLine, column: model.getLineMaxColumn(lastLine) });
        }

        // 退出编辑模式（取消）
        function exitEditMode() {
          if (monacoEditor) {
            monacoEditor.setValue(originalContent);
            monacoEditor.updateOptions({ readOnly: true, domReadOnly: true });
          }
          isEditing = false;
          editBtn.style.display = 'inline-block';
          stageBtn.style.display = 'none';
          cancelBtn.style.display = 'none';
          hint.textContent = '';
          monacoStatus.textContent = '';
        }

        editBtn.addEventListener('click', enterEditMode);
        cancelBtn.addEventListener('click', exitEditMode);
        stageBtn.addEventListener('click', async () => {
          if (!monacoEditor) return;
          const newContent = monacoEditor.getValue();
          if (newContent === originalContent) { toast('内容未变化'); return; }
          const stagePath = filePath || prompt('请输入文件路径（用于暂存变更）：');
          if (!stagePath) return;
          try {
            await api('/api/changes/stage', 'POST', { path: stagePath, content: newContent });
            toast('✅ 已暂存到变更面板');
            originalContent = newContent;
            exitEditMode();
            switchRightTab('changes');
          } catch (e) { toast('暂存失败：' + e.message); }
        });

        // 启动只读视图
        initMonacoReadOnly();
      } else {
        box.innerHTML = '<div style="white-space:pre-wrap;word-break:break-word;">' + content + '</div>';
      }
    }

    /* ========== P0-1: Monaco 补全 Provider 注册（内联 ghost text + 补全弹窗） ========== */
    let _monacoCompletionsRegistered = false;
    function registerMonacoCompletions() {
      if (_monacoCompletionsRegistered || typeof FHMonaco === 'undefined') return;
      _monacoCompletionsRegistered = true;

      // 内联补全（ghost text，Tab 接受）—— Monaco 原生支持，无需手动叠加
      FHMonaco.registerInlineCompletions(async function ({ filePath, content, offset, token }) {
        try {
          const d = await api('/api/completion', 'POST', {
            filePath: filePath,
            fileContent: content,
            cursorOffset: offset,
            mode: 'quick',
          });
          const suggs = Array.isArray(d.suggestions) ? d.suggestions : [];
          if (suggs.length > 0 && suggs[0].text) {
            return { text: suggs[0].text };
          }
          return null;
        } catch (e) {
          return null;
        }
      });

      // 补全项弹窗（Ctrl+Space 触发，↑↓选择，Enter接受）—— Monaco 原生支持
      FHMonaco.registerCompletionItems(async function ({ filePath, content, offset, prefix, token }) {
        try {
          const d = await api('/api/completion', 'POST', {
            filePath: filePath,
            fileContent: content,
            cursorOffset: offset,
            mode: 'full',
          });
          const suggs = Array.isArray(d.suggestions) ? d.suggestions : [];
          return suggs.map((s) => ({
            label: (s.text || '').slice(0, 50) + ((s.text || '').length > 50 ? '…' : ''),
            kind: s.kind === 'function' ? 'Function' : s.kind === 'import' ? 'Module' : s.kind === 'block' ? 'Snippet' : 'Text',
            insertText: s.text || '',
            detail: (s.kind || 'text') + (s.confidence ? ' · ' + Math.round(s.confidence * 100) + '%' : ''),
          }));
        } catch (e) {
          return [];
        }
      });
    }

    function switchRightTab(name) {
      state.rightTab = name;
      document.querySelectorAll('.right-tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-tab') === name));
      document.getElementById('detailPanel').classList.toggle('active', name === 'detail');
      document.getElementById('previewPanel').classList.toggle('active', name === 'preview');
      document.getElementById('computerPanel')?.classList.toggle('active', name === 'computer');
      document.getElementById('changesPanel')?.classList.toggle('active', name === 'changes');
      document.getElementById('designPanel')?.classList.toggle('active', name === 'design');
      document.getElementById('gitPanel')?.classList.toggle('active', name === 'git');
      document.getElementById('teamPanel')?.classList.toggle('active', name === 'team');
      document.getElementById('capabilitiesPanel')?.classList.toggle('active', name === 'capabilities');
      if (name === 'changes') {
        bindChangesButtonsOnce();
        loadChanges();
      }
      if (name === 'design') {
        bindDesignButtonsOnce();
      }
      if (name === 'git') {
        bindGitButtonsOnce();
        loadGitStatus();
      }
      if (name === 'team') {
        bindTeamButtonsOnce();
        loadTeamData();
      }
      if (name === 'capabilities') {
        bindCapabilitiesOnce();
        loadCapabilitiesPlugins();
      }
    }

    // 变更面板顶部按钮只绑定一次
    let _changesButtonsBound = false;
    let _conflictFiles = []; // 冲突文件路径列表
    function bindChangesButtonsOnce() {
      if (_changesButtonsBound) return;
      _changesButtonsBound = true;
      document.getElementById('changesRefreshBtn')?.addEventListener('click', () => { _conflictFiles = []; loadChanges(); });
      document.getElementById('changesCommitBtn')?.addEventListener('click', async () => {
        try {
          const d = await api('/api/changes/commit', 'POST');
          toast(d.success ? '✅ 已提交所有变更' : '⚠️ 部分提交失败：' + (d.error || ''));
          _conflictFiles = [];
          loadChanges();
        } catch (e) { toast('提交失败：' + e.message); }
      });
      document.getElementById('changesDiscardBtn')?.addEventListener('click', async () => {
        if (!confirm('确定丢弃所有暂存变更？')) return;
        try {
          await api('/api/changes/discard', 'POST');
          toast('已丢弃所有变更');
          _conflictFiles = [];
          loadChanges();
        } catch (e) { toast('丢弃失败：' + e.message); }
      });
      // P3: 检测冲突
      document.getElementById('changesDetectBtn')?.addEventListener('click', async () => {
        try {
          const d = await api('/api/changes/detect-conflicts', 'POST');
          _conflictFiles = Array.isArray(d.conflicts) ? d.conflicts.map(c => c.path || c) : [];
          if (_conflictFiles.length > 0) {
            toast('⚠️ 检测到 ' + _conflictFiles.length + ' 个文件冲突（已高亮）');
          } else {
            toast('✅ 无文件冲突');
          }
          loadChanges(); // 重新渲染以高亮冲突文件
        } catch (e) { toast('冲突检测失败：' + e.message); }
      });
    }

    /* ========== P3: 多文件变更面板 ========== */
    let _autoConflictChecked = false; // P1-2: 每次会话仅自动检测一次
    async function loadChanges() {
      try {
        const d = await api('/api/changes', 'GET');
        renderChanges(d);
        // P1-2 增强：加载后自动检测一次冲突（无需手动点击）
        if (!_autoConflictChecked && Array.isArray(d.changes) && d.changes.length > 0) {
          _autoConflictChecked = true;
          try {
            const dc = await api('/api/changes/detect-conflicts', 'POST');
            _conflictFiles = Array.isArray(dc.conflicts) ? dc.conflicts.map(c => c.path || c) : [];
            if (_conflictFiles.length > 0) renderChanges(d);
          } catch { /* 自动检测失败不阻塞 */ }
        }
      } catch (e) {
        document.getElementById('changesList').innerHTML = '<div class="muted" style="text-align:center;padding:20px;">加载失败：' + escapeHtml(e.message) + '</div>';
      }
    }

    function renderChanges(data) {
      const changes = Array.isArray(data.changes) ? data.changes : [];
      const count = changes.length;
      document.getElementById('changesCount').textContent = count;
      // P1-2 增强：冲突计数 badge
      const conflictBadge = document.getElementById('changesConflictCount');
      if (conflictBadge) {
        const n = _conflictFiles.filter(cf => changes.some(c => c.path === cf || c.path.endsWith(cf) || cf.endsWith(c.path))).length;
        conflictBadge.style.display = n > 0 ? 'inline' : 'none';
        conflictBadge.textContent = n + ' 冲突';
      }
      const list = document.getElementById('changesList');
      if (!count) {
        list.innerHTML = '<div class="muted" style="text-align:center;padding:30px;font-size:12px;">暂无暂存变更<br/><span style="font-size:11px;">AI 生成的文件修改会先暂存在这里，审批后才写入磁盘</span></div>';
        return;
      }
      list.innerHTML = changes.map((c, idx) => {
        const typeLabel = c.type === 'create' ? '🆕 新增' : c.type === 'delete' ? '🗑 删除' : '✏️ 修改';
        const typeColor = c.type === 'create' ? '#2d8a4e' : c.type === 'delete' ? '#c0392b' : '#d4a017';
        const isConflict = _conflictFiles.some(cf => c.path === cf || c.path.endsWith(cf) || cf.endsWith(c.path));
        const conflictBorder = isConflict ? 'border:2px solid #c0392b;' : 'border:1px solid var(--border);';
        const conflictBadge = isConflict ? '<span style="color:#c0392b;font-weight:700;margin-left:6px;">⚠️ 冲突</span>' : '';
        const hunks = Array.isArray(c.hunks) ? c.hunks : [];
        let hunksHtml = '';
        if (hunks.length) {
          hunksHtml = '<div style="margin-top:6px;">' + hunks.map((h, hi) => {
            const lines = (h.lines || []).map(l => {
              const cls = l.type === 'add' ? 'diff-add' : l.type === 'del' ? 'diff-del' : 'diff-ctx';
              return '<div class="' + cls + '">' + escapeHtml(l.content) + '</div>';
            }).join('');
            return '<div class="diff-hunk" style="margin-bottom:6px;border:1px solid var(--border);border-radius:4px;overflow:hidden;">'
              + '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 6px;background:var(--bg);font-size:11px;">'
              + '<span class="muted">@@ ' + escapeHtml(String(h.header || '')) + '</span>'
              + '<span style="display:flex;gap:4px;">'
              + '<button class="ghost-btn" style="font-size:10px;padding:1px 6px;" data-act="accept-hunk" data-idx="' + idx + '" data-hunk="' + hi + '">✓</button>'
              + '<button class="ghost-btn" style="font-size:10px;padding:1px 6px;" data-act="reject-hunk" data-idx="' + idx + '" data-hunk="' + hi + '">✕</button>'
              + '</span></div>'
              + '<div style="font-family:monospace;font-size:11px;line-height:1.5;">' + lines + '</div></div>';
          }).join('') + '</div>';
        }
        return '<div class="change-item" style="padding:8px;margin-bottom:8px;' + conflictBorder + 'border-radius:6px;background:var(--card);">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">'
          + '<div style="flex:1;min-width:0;">'
          + '<div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + escapeHtml(c.path) + '">' + escapeHtml(c.path) + conflictBadge + '</div>'
          + '<div style="font-size:11px;margin-top:2px;"><span style="color:' + typeColor + ';">' + typeLabel + '</span>'
          + (c.additions != null ? ' · <span style="color:#2d8a4e;">+' + c.additions + '</span>' : '')
          + (c.deletions != null ? ' · <span style="color:#c0392b;">-' + c.deletions + '</span>' : '')
          + ' · <span class="muted">' + escapeHtml(c.status || 'pending') + '</span></div>'
          + '</div>'
          + '<div style="display:flex;gap:4px;flex-shrink:0;">'
          + '<button class="ghost-btn" style="font-size:11px;padding:3px 8px;background:#2d5a3d;color:#fff;" data-act="accept" data-idx="' + idx + '">接受</button>'
          + '<button class="ghost-btn" style="font-size:11px;padding:3px 8px;" data-act="reject" data-idx="' + idx + '">拒绝</button>'
          + '</div></div>'
          + hunksHtml
          + '</div>';
      }).join('');
      // 绑定事件
      list.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const act = btn.getAttribute('data-act');
          const idx = parseInt(btn.getAttribute('data-idx'));
          const change = changes[idx];
          if (!change) return;
          try {
            if (act === 'accept') {
              await api('/api/changes/accept', 'POST', { path: change.path });
              toast('已接受：' + change.path);
            } else if (act === 'reject') {
              await api('/api/changes/reject', 'POST', { path: change.path });
              toast('已拒绝：' + change.path);
            } else if (act === 'accept-hunk') {
              const hi = parseInt(btn.getAttribute('data-hunk'));
              await api('/api/changes/hunk/accept', 'POST', { path: change.path, hunkIndex: hi });
              toast('已接受 Hunk');
            } else if (act === 'reject-hunk') {
              const hi = parseInt(btn.getAttribute('data-hunk'));
              await api('/api/changes/hunk/reject', 'POST', { path: change.path, hunkIndex: hi });
              toast('已拒绝 Hunk');
            }
            loadChanges();
          } catch (e) { toast('操作失败：' + e.message); }
        });
      });
    }

    async function showArtifacts(dir) {
      try {
        const d = await api('/api/workspace/list?path=' + encodeURIComponent(dir));
        const files = (d.entries || []).filter((e) => e.type !== 'dir');
        const box = document.getElementById('taskDetail');
        const listHtml = files.length
          ? files.map((f) => '<div class="artifact-file" data-path="' + escapeHtml(f.path) + '">📄 ' + escapeHtml(f.name) + '</div>').join('')
          : '<div class="muted">该目录暂无文件产物。</div>';
        const hint = '<div class="muted" style="margin-bottom:8px;">产物文件（来自：' + escapeHtml(dir) + '），点击在右侧预览：</div>';
        const cur = box.innerHTML;
        box.innerHTML = cur + '<hr style="border:none;border-top:1px solid var(--line);margin:10px 0;">' + hint + '<div class="artifact-list">' + listHtml + '</div>';
        box.querySelectorAll('.artifact-file').forEach((el) => el.addEventListener('click', () => {
          previewFile(el.getAttribute('data-path'));
          toast('已打开：' + el.getAttribute('data-path'));
        }));
        switchRightTab('detail');
      } catch (e) { toast('读取产物失败：' + e.message); }
    }

    function renderStepHtml(step) {
      const d = step.data || {};
      if (step.type === 'model.response') {
        const content = (d.content || '').toString();
        const toolCalls = Array.isArray(d.toolCalls) ? d.toolCalls : [];
        let inner = '<div class="reasoning-head">🧠 模型推理 · ' + escapeHtml(d.model || '') + '</div>';
        if (content) inner += '<div style="white-space:pre-wrap;word-break:break-word;">' + renderMarkdown(content) + '</div>';
        if (toolCalls.length) inner += '<div class="muted" style="margin-top:6px;">↳ 计划调用工具：' + toolCalls.map((t) => '<code>' + escapeHtml(t) + '</code>').join('、') + '</div>';
        return '<div class="step reasoning">' + inner + '</div>';
      } else if (step.type === 'tool.call') {
        const argsHtml = formatToolArgs(d.args);
        return '<div class="step toolcall"><div class="tc-name">🔧 调用 ' + escapeHtml(d.name || '') + '</div>' + argsHtml + '</div>';
      } else if (step.type === 'tool.result') {
        const ok = !!d.ok;
        const out = (d.output || '').toString();
        return '<div class="step result ' + (ok ? 'ok' : 'fail') + '"><div class="res-head">' + (ok ? '✅' : '❌') + ' ' + escapeHtml(d.name || '') + ' ' + (ok ? '成功' : '失败') + '</div>' + (out.trim() ? '<div class="res-out">' + escapeHtml(out).slice(0, 500) + '</div>' : '') + '</div>';
      } else if (step.type === 'self-heal') {
        return '<div class="step note">🩹 进入自愈：检测到 <b>' + escapeHtml(d.category || '') + '</b> 类错误，已注入反思重试（第 ' + (d.iteration != null ? d.iteration : '?') + ' 轮）</div>';
      } else if (step.type === 'context.compact') {
        return '<div class="step note">📦 上下文压缩：从 ' + (d.originalLength != null ? d.originalLength : '?') + ' 条压缩至 ' + (d.compressedLength != null ? d.compressedLength : '?') + ' 条，保留首条目标与近期对话</div>';
      }
      return '';
    }

    // 消息操作按钮（复制、创建文档）
    function renderMsgActions() {
      return '<div class="msg-actions">'
        + '<button class="msg-action-btn" data-action="copy" title="复制整条消息">📋 复制</button>'
        + '<button class="msg-action-btn" data-action="create-doc" title="创建文档">📄 建文档</button>'
        + '</div>';
    }

    function renderTaskThread(task) {
      const box = document.getElementById('messages');
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      renderTaskHeader(task);
      if (!task) {
        box.innerHTML = '<div class="msg sys">从左侧「任务列表」选择历史任务查看对话，或在下方输入指令发起新任务。刷新页面会自动清空当前对话视图，历史对话已保存在任务列表中。</div>';
        return;
      }
      const finalAnswer = (task.result && task.result.finalAnswer || '').trim();
      let html = '';
      const conv = Array.isArray(task.conversation) ? task.conversation : [];
      const steps = Array.isArray(task.steps) ? task.steps : [];

      // 统一处理：先显示用户消息，再从 steps 提取思考过程（实时更新），最后显示最终回复
      // 这样确保思考过程能实时显示，不会因为 conversation 有内容就跳过 steps

      // 1. 显示用户消息
      let userMsgShown = false;
      if (conv.length > 0) {
        for (const m of conv) {
          if (m && m.role === 'user' && m.content) {
            html += '<div class="msg user">' + renderMsgActions() + linkifyArtifacts(m.content) + '</div>';
            userMsgShown = true;
            break; // 只显示第一条用户消息，后续的在多轮对话中处理
          }
        }
      }
      if (!userMsgShown && task.goal) {
        html += '<div class="msg user">' + renderMsgActions() + linkifyArtifacts(task.goal) + '</div>';
      }

      // 2. 从 steps 提取思考过程（实时更新，这是关键）
      const thinkingTexts = [];
      for (const s of steps) {
        if (s.type === 'model.response' && s.data && s.data.content && s.data.content.trim()) {
          thinkingTexts.push(s.data.content.trim());
        } else if (s.type === 'self-heal') {
          thinkingTexts.push('刚才遇到点小问题，我调整一下思路再试试。');
        }
      }
      if (thinkingTexts.length > 0) {
        html += '<div class="msg assistant">'
          + renderMsgActions()
          + '<div style="white-space:pre-wrap;word-break:break-word;line-height:1.7;">' + renderPlainText(thinkingTexts.join('\n\n')) + '</div>'
          + '</div>';
      }

      // 3. 如果 conversation 中有完整的 assistant 文本回复（任务完成后），也显示出来
      if (conv.length > 0) {
        const assistantTexts = [];
        for (const m of conv) {
          if (m && m.role === 'assistant' && m.content && m.content.trim() && !(m.toolCalls && m.toolCalls.length > 0)) {
            assistantTexts.push(m.content.trim());
          }
        }
        // 避免和 steps 重复：只显示 steps 中没有的最终回复
        if (assistantTexts.length > 0) {
          const lastAssistantText = assistantTexts[assistantTexts.length - 1];
          const alreadyInSteps = thinkingTexts.some(t => t === lastAssistantText || lastAssistantText.includes(t) || t.includes(lastAssistantText));
          if (!alreadyInSteps && lastAssistantText !== finalAnswer) {
            html += '<div class="msg assistant">'
              + renderMsgActions()
              + '<div style="white-space:pre-wrap;word-break:break-word;line-height:1.7;">' + renderPlainText(lastAssistantText) + '</div>'
              + '</div>';
          }
        }
      }

      // 终态：如果对话流里没有最终回复（旧任务或被中断），再显示 finalAnswer
      const hasFinalInConv = conv.some(m => m.role === 'assistant' && !(m.toolCalls || []).length && (m.content || '').trim());
      if (task.status === 'done' && finalAnswer && !hasFinalInConv) {
        html += '<div class="msg assistant">'
          + renderMsgActions()
          + '<div style="white-space:pre-wrap;word-break:break-word;line-height:1.7;">' + renderPlainText(finalAnswer) + '</div>'
          + '</div>';
      } else if (task.status === 'failed') {
        if (finalAnswer && !hasFinalInConv) {
          html += '<div class="msg assistant">'
            + renderMsgActions()
            + '<div style="white-space:pre-wrap;word-break:break-word;line-height:1.7;">' + renderPlainText(finalAnswer) + '</div>'
            + '</div>';
        }
        html += '<div class="msg assistant error-msg">任务遇到问题：' + escapeHtml(task.error || '未知错误') + '</div>';
      } else if (task.status === 'running') {
        // 计算已运行时间，让用户知道等了多久
        let waitTip = '';
        if (task.createdAt) {
          const elapsed = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / 1000);
          if (elapsed > 5) {
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            const timeStr = mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
            waitTip = `<span style="color:var(--muted);font-size:12px;margin-left:8px;">已等待 ${timeStr}</span>`;
          }
          // 分级超时警告：让用户明确感知任务可能卡住，而非无限期"思考中"
          if (elapsed >= 300 && elapsed < 900) {
            // 5-15 分钟：橙色温和提醒
            waitTip += '<div style="color:#e65100;font-size:12px;margin-top:8px;line-height:1.6;background:#fff3e0;padding:8px 10px;border-radius:6px;border-left:3px solid #ff9800;">'
              + '⚠️ 已等待较久，模型可能正在处理复杂推理或执行耗时操作。'
              + '<br>若长时间无任何输出，可点击右上角「停止」后重新提交。'
              + '</div>';
          } else if (elapsed >= 900 && elapsed < 1500) {
            // 15-25 分钟：红色明确警告
            waitTip += '<div style="color:#c62828;font-size:12px;margin-top:8px;line-height:1.6;background:#ffebee;padding:8px 10px;border-radius:6px;border-left:3px solid #e53935;">'
              + '🚨 任务可能已卡住（已等待超过15分钟无输出）。'
              + '<br>常见原因：模型 API 无响应、网络中断、或工具调用死锁。'
              + '<br>建议点击下方按钮停止任务，检查模型配置后重新提交。'
              + '<br><button onclick="document.getElementById(\'tchStop\')?.click()" style="margin-top:6px;background:#e53935;color:#fff;border:none;padding:4px 14px;border-radius:5px;cursor:pointer;font-size:12px;">⏹ 停止当前任务</button>'
              + '</div>';
          } else if (elapsed >= 1500) {
            // 25 分钟以上：紧急警告，提示即将自动超时
            const remain = Math.max(0, 30 - Math.floor(elapsed / 60));
            waitTip += '<div style="color:#b71c1c;font-size:12px;margin-top:8px;line-height:1.6;background:#ffcdd2;padding:8px 10px;border-radius:6px;border-left:3px solid #c62828;font-weight:500;">'
              + `⛔ 任务即将到达 30 分钟自动超时限制（约 ${remain} 分钟后自动终止）。`
              + '<br>可立即点击下方按钮手动停止，或等待系统自动终止。'
              + '<br><button onclick="document.getElementById(\'tchStop\')?.click()" style="margin-top:6px;background:#c62828;color:#fff;border:none;padding:4px 14px;border-radius:5px;cursor:pointer;font-size:12px;">⏹ 立即停止任务</button>'
              + '</div>';
          } else if (elapsed > 60) {
            // 1-5 分钟：普通提示
            waitTip += '<div style="color:var(--muted);font-size:12px;margin-top:6px;line-height:1.5;">模型正在深度思考或执行复杂操作，请耐心等待...</div>';
          }
        }
        html += '<div class="thinking-indicator">'
          + '<span class="dot"></span><span class="dot"></span><span class="dot"></span>'
          + '<span>思考中...</span>'
          + waitTip
          + '</div>';
      } else if (task.status === 'queued') {
        html += '<div class="msg sys">任务已入队，等待执行…</div>';
      }
      box.innerHTML = html;
      if (nearBottom) box.scrollTop = box.scrollHeight;
    }

    function renderTaskHeader(task) {
      const titleEl = document.getElementById('tchTitle');
      const statusEl = document.getElementById('tchStatus');
      const timeEl = document.getElementById('tchTime');
      const subEl = document.getElementById('tchSub');
      if (!task) {
        titleEl.textContent = '未选择任务';
        statusEl.className = 'badge'; statusEl.textContent = '—';
        timeEl.textContent = '';
        subEl.textContent = '从左侧任务列表选择，或在下方输入指令发起新任务';
        return;
      }
      titleEl.textContent = task.goal.length > 60 ? task.goal.slice(0, 60) + '…' : task.goal;
      statusEl.className = 'badge ' + task.status;
      statusEl.textContent = task.status;
      timeEl.textContent = '创建于 ' + fmtTime(task.createdAt);
      subEl.textContent = '对话流 + 内部执行过程追踪 · 共 ' + (task.steps ? task.steps.length : 0) + ' 个步骤';
      // 仅当任务正在运行/排队时显示「停止」按钮（解救卡死、无法继续的任务）
      const stopEl = document.getElementById('tchStop');
      if (stopEl) stopEl.style.display = (task && (task.status === 'running' || task.status === 'queued')) ? '' : 'none';
    }

    function renderThinkingProcess(msgs) {
      // 收集所有思考文本，直接展示，不折叠、不显示工具调用
      const textParts = [];
      for (const m of msgs) {
        const text = (m.content || '').trim();
        if (text) textParts.push(text);
      }
      const textContent = textParts.join('\n\n');
      if (!textContent) return '';
      // 用普通 assistant 气泡样式展示思考过程，让用户看到模型在想什么
      return '<div class="msg assistant thinking-msg" style="opacity:0.85;">'
        + renderMsgActions()
        + '<div style="white-space:pre-wrap;word-break:break-word;line-height:1.7;">' + renderPlainText(textContent) + '</div>'
        + '</div>';
    }

    function toggleArgs(el) {
      const args = el.parentElement.querySelector('.thinking-args');
      if (!args) return;
      args.classList.toggle('show');
      el.textContent = args.classList.contains('show') ? '收起参数' : '查看参数';
    }

    function toggleThinking(header) {
      const body = header.parentElement.querySelector('.thinking-body');
      if (!body) return;
      const arrow = header.querySelector('.thinking-arrow');
      if (body.style.display === 'none' || body.style.display === '') {
        body.style.display = 'block';
        if (arrow) arrow.textContent = '▼';
      } else {
        body.style.display = 'none';
        if (arrow) arrow.textContent = '▶';
      }
    }

    function renderTaskDetail(id) {
      const t = state.tasks.find((x) => x.id === id);
      const box = document.getElementById('taskDetail');
      if (!t) { box.innerHTML = '<div class="muted">任务不存在。</div>'; return; }
      const r = t.result;
      let ops = '';
      if (t.workspaceDir) {
        ops = '<div class="detail-ops">' +
          '<button class="secondary" data-op="browser">🌐 打开浏览器</button>' +
          '<button class="secondary" data-op="folder" data-path="' + escapeHtml(t.workspaceDir) + '">📂 打开资源管理器</button>' +
          '<button class="secondary" data-op="artifacts" data-path="' + escapeHtml(t.workspaceDir) + '">📑 查看产物文件</button>' +
          '</div>';
      }
      const rows = [
        ops,
        '<div><b>目标</b><br>' + escapeHtml(t.goal) + '</div>',
        '<div><b>状态</b> ' + statusBadge(t.status) + '</div>',
        t.agentType ? '<div><b>智能体</b> ' + escapeHtml(AGENT_TYPES[t.agentType]?.label || t.agentType) + '</div>' : '',
        r ? '<div><b>迭代</b> ' + r.iterations + ' · <b>成本</b> $' + r.costUsd.toFixed(6) + '</div>' : '',
        r && r.logFile ? '<div><b>日志</b> <code>' + escapeHtml(r.logFile) + '</code></div>' : '',
        r && r.finalAnswer ? '<div><b>结果</b><br><pre style="white-space:pre-wrap;word-break:break-word;">' + escapeHtml(r.finalAnswer) + '</pre></div>' : '',
        t.error ? '<div style="color:var(--err)"><b>错误</b><br>' + escapeHtml(t.error) + '</div>' : '',
      ].filter(Boolean).join('<hr style="border:none;border-top:1px solid var(--line);margin:10px 0;">');
      box.innerHTML = rows || '<div class="muted">无详情</div>';
      box.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => handleDetailOp(t, b.getAttribute('data-op'), b.getAttribute('data-path'))));
    }

    function renderSidebarTaskList() {
      const container = document.getElementById('taskListContainer');
      const section = document.getElementById('taskListSection');
      const badge = document.getElementById('taskCountBadge');
      if (!container || !section) return;

      // 置顶任务排在前面，其余按时间倒序
      const sortedTasks = [...state.tasks].sort((a, b) => {
        if (state.pinnedTasks.has(a.id) && !state.pinnedTasks.has(b.id)) return -1;
        if (!state.pinnedTasks.has(a.id) && state.pinnedTasks.has(b.id)) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      const activeTasks = sortedTasks.filter(t => t.status === 'queued' || t.status === 'running' || t.status === 'done' || t.status === 'failed');

      if (activeTasks.length === 0) {
        section.style.display = 'none';
        return;
      }

      section.style.display = 'block';
      badge.textContent = activeTasks.length;

      let html = '';
      activeTasks.slice(0, 15).forEach(t => {
        const icon = t.status === 'running' ? '⏳' : t.status === 'queued' ? '📥' : t.error ? '❌' : '✅';
        const title = t.goal.slice(0, 18) + (t.goal.length > 18 ? '…' : '');
        const isPinned = state.pinnedTasks.has(t.id);
        const activeClass = state.currentTaskId === t.id ? 'active' : '';
        html += `<div class="task-item ${activeClass}" data-task-id="${t.id}" data-pinned="${isPinned}">
          <span class="task-icon">${icon}</span>
          <span class="task-title">${title}</span>
          ${isPinned ? '<span class="task-pinned">📌</span>' : ''}
          <div class="task-actions">
            <button class="pin-btn" data-id="${t.id}" data-pinned="${isPinned}" title="${isPinned ? '取消置顶' : '置顶'}">${isPinned ? '📌' : '📍'}</button>
            ${t.status === 'done' || t.status === 'failed' ? '<button class="delete-btn" data-id="' + t.id + '" title="删除任务">🗑️</button>' : ''}
          </div>
        </div>`;
      });

      container.innerHTML = html;

      // 绑定点击事件
      container.querySelectorAll('.task-item[data-task-id]').forEach(el => {
        el.addEventListener('click', (e) => {
          // 如果是点击pin按钮，不切换任务
          if (e.target.classList.contains('pin-btn')) return;
          const id = el.getAttribute('data-task-id');
          selectTask(id);
        });

        // 右键菜单 - 置顶/取消置顶
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const id = el.getAttribute('data-task-id');
          togglePinTask(id);
        });
      });

      // 绑定pin按钮
      container.querySelectorAll('.pin-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          togglePinTask(id);
        });
      });

      // 绑定删除按钮
      container.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          deleteTask(id);
        });
      });
    }

    function switchView(nav) {
      document.querySelectorAll('.topbar-nav-item').forEach((n) => n.classList.toggle('active', n.getAttribute('data-nav') === nav));
      document.querySelectorAll('.sidebar-icon').forEach((n) => n.classList.toggle('active', n.getAttribute('data-nav') === nav));
      document.querySelectorAll('.view, .page-view').forEach((v) => v.classList.toggle('active', v.getAttribute('data-view') === nav));
      // 切换时显示/隐藏底部工具栏（任务上下文头部始终可见）
      const isChat = nav === 'chat';
      document.getElementById('chatFootbar').style.display = isChat ? 'flex' : 'none';
      // 切换到对话视图时，如果当前任务已完成或不存在，自动开启新对话
      if (isChat) {
        const cur = state.tasks.find((t) => t.id === state.currentTaskId);
        if (!cur || cur.status === 'done' || cur.status === 'failed') {
          startNewChat();
        }
      }
    }

    // 开启新对话：清空当前任务选中，显示空状态，聚焦输入框
    function startNewChat() {
      state.currentTaskId = null;
      renderTaskThread(null);
      renderTaskDetail(null);
      renderSidebarTaskList();
      // 显示任务列表区域
      const taskListSection = document.getElementById('taskListSection');
      if (taskListSection) taskListSection.style.display = 'block';
      // 聚焦输入框
      setTimeout(() => {
        const input = document.getElementById('goalInput');
        if (input) input.focus();
      }, 100);
    }

    function updateUserBar() {
      document.getElementById('topbarPhone').textContent = state.phone || '未登录';
      document.getElementById('sheetPhone').textContent = state.phone || '未登录';
      const a = AGENT_TYPES[state.agentType];
      document.getElementById('skillPill').textContent = (a?.icon || '🤖') + ' ' + (a?.label || '通用助手');
    }

    function showWelcomeModal(welcomeTasks) {
      const modal = document.getElementById('welcomeGuideModal');
      if (!modal) return;
      
      const listEl = document.getElementById('welcomeTaskList');
      if (listEl) {
        if (welcomeTasks.length > 0) {
          listEl.innerHTML = welcomeTasks.map((t, i) => `
            <div class="welcome-task-item" data-task-id="${t.taskId}" data-goal="${encodeURIComponent(t.goal)}">
              <div class="welcome-task-index">${i + 1}</div>
              <div class="welcome-task-content">
                <div class="welcome-task-title">${escapeHtml(t.title || '任务 ' + (i + 1))}</div>
                <div class="welcome-task-desc">${escapeHtml(t.description || t.goal.slice(0, 50) + '…')}</div>
              </div>
              <button class="welcome-task-run" data-id="${t.taskId}">▶ 运行</button>
            </div>
          `).join('');
          
          // 绑定运行按钮
          listEl.querySelectorAll('.welcome-task-run').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const taskId = btn.getAttribute('data-id');
              runWelcomeTask(taskId);
            });
          });
        } else {
          listEl.innerHTML = '<div class="empty-welcome">' + t('empty.preparing_welcome') + '</div>';
        }
      }
      
      modal.classList.add('show');
      toast('🎉 欢迎！系统已为您准备了三个引导任务');
    }

    function showWelcomeGuide(welcomeTasks = []) {
      // 显示欢迎引导弹窗
      showWelcomeModal(welcomeTasks);
    }

    /* ========== P2-1: 设计稿转代码 ========== */
    let _designButtonsBound = false;
    let _designImageBase64 = '';
    let _designLastCode = '';

    function bindDesignButtonsOnce() {
      if (_designButtonsBound) return;
      _designButtonsBound = true;

      const dropZone = document.getElementById('designDropZone');
      const fileInput = document.getElementById('designFileInput');
      const removeBtn = document.getElementById('designRemoveImgBtn');
      const generateBtn = document.getElementById('designGenerateBtn');
      const refineBtn = document.getElementById('designRefineBtn');
      const copyBtn = document.getElementById('designCopyBtn');

      if (!dropZone || !fileInput) return;

      // 点击上传
      dropZone.addEventListener('click', () => fileInput.click());

      // 文件选择
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) handleDesignFile(file);
      });

      // 拖拽上传
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--accent, #2d5a3d)';
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'var(--border)';
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--border)';
        const file = e.dataTransfer?.files?.[0];
        if (file) handleDesignFile(file);
      });

      // 移除图片
      removeBtn?.addEventListener('click', () => {
        _designImageBase64 = '';
        document.getElementById('designImagePreview').style.display = 'none';
        document.getElementById('designDropZone').style.display = 'block';
        document.getElementById('designResult').style.display = 'none';
      });

      // 生成代码
      generateBtn.addEventListener('click', () => generateDesignCode(false));

      // 修正代码
      refineBtn?.addEventListener('click', () => generateDesignCode(true));

      // 复制代码
      copyBtn?.addEventListener('click', () => {
        if (_designLastCode) {
          navigator.clipboard.writeText(_designLastCode).then(() => {
            toast('✅ 代码已复制到剪贴板');
          }).catch(() => {
            toast('复制失败，请手动复制');
          });
        }
      });

      // 结果 tab 切换
      document.querySelectorAll('.design-result-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.design-result-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const target = tab.getAttribute('data-tab');
          document.getElementById('designCodeView').style.display = target === 'code' ? 'block' : 'none';
          document.getElementById('designPreviewView').style.display = target === 'preview' ? 'block' : 'none';
        });
      });
    }

    function handleDesignFile(file) {
      if (!file.type.startsWith('image/')) {
        toast('请上传图片文件');
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        toast('图片大小不能超过 8MB');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        _designImageBase64 = e.target.result;
        const img = document.getElementById('designPreviewImg');
        img.src = _designImageBase64;
        document.getElementById('designImagePreview').style.display = 'block';
        document.getElementById('designDropZone').style.display = 'none';
        document.getElementById('designResult').style.display = 'none';
      };
      reader.readAsDataURL(file);
    }

    async function generateDesignCode(isRefine) {
      if (!_designImageBase64) {
        toast('请先上传设计稿图片');
        return;
      }

      const framework = document.getElementById('designFramework').value;
      const instructions = document.getElementById('designInstructions').value;
      const feedback = isRefine ? document.getElementById('designFeedback').value : '';

      if (isRefine && !feedback.trim()) {
        toast('请输入修正反馈');
        return;
      }

      const statusEl = document.getElementById('designStatus');
      const statusText = document.getElementById('designStatusText');
      const generateBtn = document.getElementById('designGenerateBtn');

      statusEl.style.display = 'block';
      statusText.textContent = isRefine ? '正在修正代码...' : '正在分析设计稿并生成代码...';
      generateBtn.disabled = true;
      generateBtn.style.opacity = '0.6';

      try {
        const body = {
          image: _designImageBase64,
          framework,
        };
        if (instructions) body.instructions = instructions;
        if (isRefine) {
          body.previousCode = _designLastCode;
          body.feedback = feedback;
        }

        const d = await api('/api/design-to-code', 'POST', body);

        if (d.ok && d.code) {
          _designLastCode = d.code;
          document.getElementById('designCode').textContent = d.code;
          document.getElementById('designCodeLang').textContent = d.language || framework;

          // 渲染预览 iframe
          if (d.previewHtml) {
            const iframe = document.getElementById('designPreviewFrame');
            iframe.srcdoc = d.previewHtml;
          }

          document.getElementById('designResult').style.display = 'block';
          document.getElementById('designFeedback').value = '';
          toast(isRefine ? '✅ 代码已修正' : '✅ 代码生成成功');
        } else {
          toast('生成失败: ' + (d.error || '未知错误'));
        }
      } catch (e) {
        toast('请求失败: ' + (e.message || '网络错误'));
      } finally {
        statusEl.style.display = 'none';
        generateBtn.disabled = false;
        generateBtn.style.opacity = '1';
      }
    }

    /* ========== P2-2: Git 集成 ========== */
    let _gitButtonsBound = false;
    let _gitStatus = null;
    let _gitBranches = [];

    function bindGitButtonsOnce() {
      if (_gitButtonsBound) return;
      _gitButtonsBound = true;

      document.getElementById('gitRefreshBtn')?.addEventListener('click', loadGitStatus);
      document.getElementById('gitPullBtn')?.addEventListener('click', gitPull);
      document.getElementById('gitPushBtn')?.addEventListener('click', gitPush);
      document.getElementById('gitInitBtn')?.addEventListener('click', gitInit);
      document.getElementById('gitCommitBtn')?.addEventListener('click', gitCommit);
      document.getElementById('gitAddAllBtn')?.addEventListener('click', () => gitAddAll('modified'));
      document.getElementById('gitResetAllBtn')?.addEventListener('click', gitResetAll);
      document.getElementById('gitBranchSelect')?.addEventListener('change', (e) => gitCheckout(e.target.value));
      document.getElementById('gitCommitMessage')?.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); gitCommit(); }
      });
      document.getElementById('gitLogToggle')?.addEventListener('click', () => {
        const list = document.getElementById('gitLogList');
        const toggle = document.getElementById('gitLogToggle');
        if (list.style.display === 'none') {
          list.style.display = 'block';
          toggle.textContent = '📜 提交历史 ▲';
          loadGitLog();
        } else {
          list.style.display = 'none';
          toggle.textContent = '📜 提交历史 ▼';
        }
      });
      document.getElementById('gitDiffCloseBtn')?.addEventListener('click', closeGitDiff);
      document.getElementById('gitDiffModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'gitDiffModal') closeGitDiff();
      });
    }

    async function loadGitStatus() {
      try {
        const d = await api('/api/git/status', 'GET');
        _gitStatus = d;
        if (!d.isRepo) {
          document.getElementById('gitNoRepo').style.display = 'block';
          document.getElementById('gitContent').style.display = 'none';
          document.getElementById('gitBranchName').textContent = '';
          return;
        }
        document.getElementById('gitNoRepo').style.display = 'none';
        document.getElementById('gitContent').style.display = 'block';
        document.getElementById('gitBranchName').textContent = `(${d.branch}${d.ahead ? ' ↑' + d.ahead : ''}${d.behind ? ' ↓' + d.behind : ''})`;

        // 分类文件
        const staged = d.files.filter((f) => f.indexStatus !== '.' && f.indexStatus !== '?');
        const modified = d.files.filter((f) => f.workTreeStatus !== '.' && f.workTreeStatus !== '?' && f.indexStatus !== '?');
        const untracked = d.files.filter((f) => f.indexStatus === '?');

        document.getElementById('gitStagedCount').textContent = staged.length;
        document.getElementById('gitModifiedCount').textContent = modified.length;
        document.getElementById('gitUntrackedCount').textContent = untracked.length;
        document.getElementById('gitAddAllBtn').style.display = modified.length ? 'inline-block' : 'none';
        document.getElementById('gitResetAllBtn').style.display = staged.length ? 'inline-block' : 'none';

        renderGitFileList('gitStagedList', staged, 'staged');
        renderGitFileList('gitModifiedList', modified, 'modified');
        renderGitFileList('gitUntrackedList', untracked, 'untracked');

        // 加载分支列表
        loadGitBranches();
      } catch (e) {
        toast('Git 状态加载失败: ' + (e.message || '网络错误'));
      }
    }

    function renderGitFileList(containerId, files, type) {
      const container = document.getElementById(containerId);
      if (!files.length) {
        container.innerHTML = '<div class="muted" style="font-size:10px;padding:4px 8px;">无</div>';
        return;
      }
      container.innerHTML = files.map((f, idx) => {
        const statusColor = f.conflict ? '#c0392b' : type === 'staged' ? '#2d8a4e' : type === 'untracked' ? '#888' : '#c0392b';
        const statusLabel = f.indexStatus !== '.' && f.indexStatus !== '?' ? f.indexStatus : f.workTreeStatus;
        const actions = type === 'staged'
          ? `<button class="git-file-btn" data-act="reset" data-idx="${idx}" style="font-size:10px;padding:1px 5px;background:none;border:1px solid var(--border);border-radius:3px;cursor:pointer;color:var(--ink);">取消</button>`
          : `<button class="git-file-btn" data-act="add" data-idx="${idx}" style="font-size:10px;padding:1px 5px;background:none;border:1px solid var(--border);border-radius:3px;cursor:pointer;color:var(--ink);">暂存</button>`;
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:3px 8px;font-size:11px;border-bottom:1px solid var(--border);">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;" class="git-file-path" data-path="${f.path}" data-staged="${type === 'staged'}">
            <span style="color:${statusColor};font-weight:600;margin-right:4px;">${statusLabel}</span>${escapeHtml(f.path)}
          </span>
          ${actions}
        </div>`;
      }).join('');

      // 绑定事件
      container.querySelectorAll('.git-file-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const act = btn.getAttribute('data-act');
          const idx = parseInt(btn.getAttribute('data-idx'));
          const file = files[idx];
          if (!file) return;
          if (act === 'add') {
            await gitAdd([file.path]);
          } else if (act === 'reset') {
            await gitReset([file.path]);
          }
        });
      });
      container.querySelectorAll('.git-file-path').forEach((el) => {
        el.addEventListener('click', () => {
          const path = el.getAttribute('data-path');
          const staged = el.getAttribute('data-staged') === 'true';
          showGitDiff(path, staged);
        });
      });
    }

    async function gitAdd(paths) {
      try {
        const d = await api('/api/git/add', 'POST', { paths });
        if (d.ok) { toast(d.message); loadGitStatus(); }
        else { toast('暂存失败: ' + (d.error || d.message)); }
      } catch (e) { toast('暂存失败: ' + (e.message || '网络错误')); }
    }

    async function gitAddAll(type) {
      if (!_gitStatus) return;
      const files = _gitStatus.files.filter((f) => f.workTreeStatus !== '.' && f.workTreeStatus !== '?' && f.indexStatus !== '?');
      const paths = files.map((f) => f.path);
      if (paths.length) await gitAdd(paths);
    }

    async function gitReset(paths) {
      try {
        const d = await api('/api/git/reset', 'POST', { paths });
        if (d.ok) { toast(d.message); loadGitStatus(); }
        else { toast('取消暂存失败: ' + (d.error || d.message)); }
      } catch (e) { toast('取消暂存失败: ' + (e.message || '网络错误')); }
    }

    async function gitResetAll() {
      if (!_gitStatus) return;
      const files = _gitStatus.files.filter((f) => f.indexStatus !== '.' && f.indexStatus !== '?');
      const paths = files.map((f) => f.path);
      if (paths.length) await gitReset(paths);
    }

    async function gitCommit() {
      const message = document.getElementById('gitCommitMessage').value.trim();
      if (!message) { toast('请输入提交信息'); return; }
      try {
        const d = await api('/api/git/commit', 'POST', { message });
        if (d.ok) {
          toast('✅ 提交成功: ' + (d.hash || '').slice(0, 7));
          document.getElementById('gitCommitMessage').value = '';
          loadGitStatus();
        } else {
          toast('提交失败: ' + (d.error || d.message));
        }
      } catch (e) { toast('提交失败: ' + (e.message || '网络错误')); }
    }

    async function loadGitBranches() {
      try {
        const d = await api('/api/git/branches', 'GET');
        _gitBranches = d.branches || [];
        const select = document.getElementById('gitBranchSelect');
        const localBranches = _gitBranches.filter((b) => !b.remote);
        select.innerHTML = localBranches.map((b) =>
          `<option value="${escapeHtml(b.name)}" ${b.current ? 'selected' : ''}>${b.current ? '★ ' : ''}${escapeHtml(b.name)}${b.ahead ? ' ↑' + b.ahead : ''}${b.behind ? ' ↓' + b.behind : ''}</option>`
        ).join('');
      } catch (e) { /* 静默失败 */ }
    }

    async function gitCheckout(branch) {
      try {
        const d = await api('/api/git/checkout', 'POST', { branch });
        if (d.ok) { toast(d.message); loadGitStatus(); }
        else { toast('切换失败: ' + (d.error || d.message)); loadGitStatus(); }
      } catch (e) { toast('切换失败: ' + (e.message || '网络错误')); }
    }

    async function gitPull() {
      try {
        const d = await api('/api/git/pull', 'POST', {});
        if (d.ok) { toast('✅ ' + d.message); loadGitStatus(); }
        else { toast('拉取失败: ' + (d.error || d.message)); }
      } catch (e) { toast('拉取失败: ' + (e.message || '网络错误')); }
    }

    async function gitPush() {
      try {
        const d = await api('/api/git/push', 'POST', {});
        if (d.ok) { toast('✅ ' + d.message); loadGitStatus(); }
        else { toast('推送失败: ' + (d.error || d.message)); }
      } catch (e) { toast('推送失败: ' + (e.message || '网络错误')); }
    }

    async function gitInit() {
      try {
        const d = await api('/api/git/init', 'POST', {});
        if (d.ok) { toast('✅ ' + d.message); loadGitStatus(); }
        else { toast('初始化失败: ' + (d.error || d.message)); }
      } catch (e) { toast('初始化失败: ' + (e.message || '网络错误')); }
    }

    async function loadGitLog() {
      try {
        const d = await api('/api/git/log?count=20', 'GET');
        const list = document.getElementById('gitLogList');
        if (!d.commits || !d.commits.length) {
          list.innerHTML = '<div class="muted" style="font-size:10px;padding:4px;">无提交历史</div>';
          return;
        }
        list.innerHTML = d.commits.map((c) =>
          `<div style="padding:4px 8px;border-bottom:1px solid var(--border);">
            <div style="font-weight:600;color:var(--ink);">${escapeHtml(c.subject)}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px;">
              <span style="color:#2d5a3d;font-family:monospace;">${c.shortHash}</span>
              · ${escapeHtml(c.author)} · ${new Date(c.date).toLocaleString('zh-CN')}
            </div>
          </div>`
        ).join('');
      } catch (e) { /* 静默失败 */ }
    }

    async function showGitDiff(path, staged) {
      try {
        const d = await api('/api/git/diff', 'POST', { path, staged });
        const modal = document.getElementById('gitDiffModal');
        const title = document.getElementById('gitDiffTitle');
        const content = document.getElementById('gitDiffContent');
        title.textContent = (staged ? '📥 ' : '📝 ') + path;
        if (d.diffs && d.diffs.length) {
          const diff = d.diffs[0];
          let html = '';
          for (const hunk of diff.hunks) {
            html += `<div style="color:#888;background:var(--card);padding:2px 6px;margin:4px 0;font-size:10px;">${escapeHtml(hunk.header)}</div>`;
            for (const line of hunk.lines) {
              const color = line.type === 'add' ? '#2d8a4e' : line.type === 'remove' ? '#c0392b' : 'var(--ink)';
              const bg = line.type === 'add' ? 'rgba(45,138,78,0.1)' : line.type === 'remove' ? 'rgba(192,57,43,0.1)' : 'transparent';
              html += `<div style="color:${color};background:${bg};padding:0 6px;">${line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}${escapeHtml(line.content)}</div>`;
            }
          }
          content.innerHTML = html || '<div class="muted">无差异</div>';
        } else {
          content.innerHTML = '<div class="muted">无差异或二进制文件</div>';
        }
        modal.style.display = 'flex';
      } catch (e) { toast('Diff 加载失败: ' + (e.message || '网络错误')); }
    }

    function closeGitDiff() {
      document.getElementById('gitDiffModal').style.display = 'none';
    }

    /* ========== P2-3: 团队协作 ========== */
    let _teamButtonsBound = false;
    let _teamData = null;
    let _teamTaskFilter = '';

    function bindTeamButtonsOnce() {
      if (_teamButtonsBound) return;
      _teamButtonsBound = true;

      document.getElementById('teamRefreshBtn')?.addEventListener('click', loadTeamData);
      document.getElementById('teamInviteBtn')?.addEventListener('click', teamInviteMember);
      document.getElementById('teamCreateTaskBtn')?.addEventListener('click', teamCreateTask);

      // Tab 切换
      document.querySelectorAll('.team-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.team-tab').forEach((t) => {
            t.classList.remove('active');
            t.style.color = 'var(--muted)';
            t.style.borderBottomColor = 'transparent';
            t.style.fontWeight = 'normal';
          });
          tab.classList.add('active');
          tab.style.color = 'var(--ink)';
          tab.style.borderBottomColor = '#2d5a3d';
          tab.style.fontWeight = '600';
          const target = tab.getAttribute('data-tab');
          document.getElementById('teamMembersTab').style.display = target === 'members' ? 'block' : 'none';
          document.getElementById('teamTasksTab').style.display = target === 'tasks' ? 'block' : 'none';
        });
      });

      // 任务筛选
      document.querySelectorAll('.team-task-filter').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.team-task-filter').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          _teamTaskFilter = btn.getAttribute('data-status') || '';
          renderTeamTasks();
        });
      });
    }

    async function loadTeamData() {
      try {
        const d = await api('/api/team', 'GET');
        _teamData = d;
        document.getElementById('teamName').textContent = d.team?.config?.name || '团队';
        document.getElementById('teamMemberCount').textContent = d.stats?.totalMembers || 0;
        document.getElementById('teamTaskCount').textContent = d.stats?.totalTasks || 0;
        renderTeamMembers();
        renderTeamTasks();
      } catch (e) {
        toast('团队数据加载失败: ' + (e.message || '网络错误'));
      }
    }

    function renderTeamMembers() {
      const container = document.getElementById('teamMembersList');
      const members = _teamData?.team?.members || [];
      if (!members.length) {
        container.innerHTML = '<div class="muted" style="font-size:11px;padding:20px;text-align:center;">暂无成员</div>';
        return;
      }
      const roleColors = { owner: '#c0392b', admin: '#e67e22', developer: '#2d5a3d', viewer: '#7f8c8d' };
      container.innerHTML = members.map((m) =>
        `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-bottom:1px solid var(--border);font-size:11px;">
          <div style="flex:1;overflow:hidden;">
            <div style="font-weight:600;">${escapeHtml(m.name)} <span style="color:${roleColors[m.role] || '#888'};font-size:10px;">[${m.role}]</span></div>
            <div style="font-size:10px;color:var(--muted);">${escapeHtml(m.email)} · ${m.status}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <select class="team-role-select" data-id="${m.id}" style="font-size:10px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;background:var(--card);color:var(--ink);" ${m.role === 'owner' ? 'disabled' : ''}>
              <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>管理员</option>
              <option value="developer" ${m.role === 'developer' ? 'selected' : ''}>开发者</option>
              <option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>观察者</option>
            </select>
            <button class="team-remove-btn" data-id="${m.id}" style="font-size:10px;padding:2px 6px;background:none;border:1px solid var(--border);border-radius:3px;cursor:pointer;color:#c0392b;" ${m.role === 'owner' ? 'disabled style="opacity:0.3;"' : ''}>移除</button>
          </div>
        </div>`
      ).join('');

      container.querySelectorAll('.team-role-select').forEach((sel) => {
        sel.addEventListener('change', async () => {
          const id = sel.getAttribute('data-id');
          const role = sel.value;
          try {
            await api(`/api/team/members/${id}/role`, 'PUT', { role });
            toast('角色已更新');
            loadTeamData();
          } catch (e) { toast('更新失败: ' + (e.message || '网络错误')); }
        });
      });
      container.querySelectorAll('.team-remove-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          if (!confirm('确定移除该成员？')) return;
          try {
            await api(`/api/team/members/${id}`, 'DELETE');
            toast('成员已移除');
            loadTeamData();
          } catch (e) { toast('移除失败: ' + (e.message || '网络错误')); }
        });
      });
    }

    async function teamInviteMember() {
      const name = document.getElementById('teamInviteName').value.trim();
      const email = document.getElementById('teamInviteEmail').value.trim();
      if (!name || !email) { toast('请输入姓名和邮箱'); return; }
      try {
        await api('/api/team/members/invite', 'POST', { name, email, role: 'developer' });
        toast('✅ 邀请已发送');
        document.getElementById('teamInviteName').value = '';
        document.getElementById('teamInviteEmail').value = '';
        loadTeamData();
      } catch (e) { toast('邀请失败: ' + (e.message || '网络错误')); }
    }

    function renderTeamTasks() {
      const container = document.getElementById('teamTasksList');
      let tasks = _teamData?.team?.tasks || [];
      if (_teamTaskFilter) tasks = tasks.filter((t) => t.status === _teamTaskFilter);
      if (!tasks.length) {
        container.innerHTML = '<div class="muted" style="font-size:11px;padding:20px;text-align:center;">暂无任务</div>';
        return;
      }
      const statusColors = { todo: '#7f8c8d', 'in-progress': '#3498db', review: '#e67e22', done: '#2d5a3d' };
      const statusLabels = { todo: '待办', 'in-progress': '进行中', review: '评审', done: '完成' };
      container.innerHTML = tasks.map((t) =>
        `<div style="padding:8px;border-bottom:1px solid var(--border);font-size:11px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="font-weight:600;flex:1;">${escapeHtml(t.title)}</span>
            <span style="font-size:10px;padding:2px 6px;border-radius:3px;background:${statusColors[t.status]}20;color:${statusColors[t.status]};font-weight:600;">${statusLabels[t.status]}</span>
          </div>
          ${t.description ? `<div style="font-size:10px;color:var(--muted);margin-bottom:4px;">${escapeHtml(t.description.slice(0, 100))}</div>` : ''}
          <div style="display:flex;gap:4px;align-items:center;font-size:10px;color:var(--muted);">
            <span>👤 ${t.createdBy}</span>
            <span>·</span>
            <span>${new Date(t.updatedAt).toLocaleDateString('zh-CN')}</span>
            ${t.comments?.length ? `<span>· 💬 ${t.comments.length}</span>` : ''}
            <select class="team-task-status" data-id="${t.id}" style="margin-left:auto;font-size:10px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;background:var(--card);color:var(--ink);">
              <option value="todo" ${t.status === 'todo' ? 'selected' : ''}>待办</option>
              <option value="in-progress" ${t.status === 'in-progress' ? 'selected' : ''}>进行中</option>
              <option value="review" ${t.status === 'review' ? 'selected' : ''}>评审</option>
              <option value="done" ${t.status === 'done' ? 'selected' : ''}>完成</option>
            </select>
            <button class="team-task-delete" data-id="${t.id}" style="font-size:10px;padding:2px 6px;background:none;border:1px solid var(--border);border-radius:3px;cursor:pointer;color:#c0392b;">删除</button>
          </div>
        </div>`
      ).join('');

      container.querySelectorAll('.team-task-status').forEach((sel) => {
        sel.addEventListener('change', async () => {
          const id = sel.getAttribute('data-id');
          const status = sel.value;
          try {
            await api(`/api/team/tasks/${id}`, 'PUT', { status });
            toast('任务状态已更新');
            loadTeamData();
          } catch (e) { toast('更新失败: ' + (e.message || '网络错误')); }
        });
      });
      container.querySelectorAll('.team-task-delete').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          if (!confirm('确定删除该任务？')) return;
          try {
            await api(`/api/team/tasks/${id}`, 'DELETE');
            toast('任务已删除');
            loadTeamData();
          } catch (e) { toast('删除失败: ' + (e.message || '网络错误')); }
        });
      });
    }

    async function teamCreateTask() {
      const title = document.getElementById('teamTaskTitle').value.trim();
      if (!title) { toast('请输入任务标题'); return; }
      try {
        await api('/api/team/tasks', 'POST', { title, createdBy: '当前用户', status: 'todo' });
        toast('✅ 任务已创建');
        document.getElementById('teamTaskTitle').value = '';
        loadTeamData();
      } catch (e) { toast('创建失败: ' + (e.message || '网络错误')); }
    }

    /* ========== P0-3: 能力中心（v7.2 新能力前端接线）========== */
    let _capabilitiesBound = false;
    function bindCapabilitiesOnce() {
      if (_capabilitiesBound) return;
      _capabilitiesBound = true;
      document.getElementById('capVoiceBtn')?.addEventListener('click', runCapabilityVoice);
      document.getElementById('capVoiceInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runCapabilityVoice(); });
      document.getElementById('capKnowledgeSearchBtn')?.addEventListener('click', runCapabilityKnowledge);
      document.getElementById('capKnowledgeQuery')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runCapabilityKnowledge(); });
      document.getElementById('capPluginsBtn')?.addEventListener('click', loadCapabilitiesPlugins);
    }

    async function runCapabilityVoice() {
      const input = document.getElementById('capVoiceInput');
      const out = document.getElementById('capVoiceResult');
      const text = (input?.value || '').trim();
      if (!text) { if (out) out.textContent = '请输入语音指令文本'; return; }
      if (out) out.textContent = '解析中…';
      try {
        const d = await apiVoiceParse(text);
        if (!d.ok) { if (out) out.textContent = '解析失败: ' + (d.error || ''); return; }
        const c = d.command || {};
        if (out) out.textContent = '→ ' + (c.type || '?') + (c.params && Object.keys(c.params).length ? ' 参数: ' + JSON.stringify(c.params) : '') + '  置信度: ' + (c.confidence ?? '?');
      } catch (e) { if (out) out.textContent = '请求失败: ' + (e.message || '网络错误'); }
    }

    async function runCapabilityKnowledge() {
      const input = document.getElementById('capKnowledgeQuery');
      const out = document.getElementById('capKnowledgeResult');
      const query = (input?.value || '').trim();
      if (!query) { if (out) out.innerHTML = '<div class="muted">请输入搜索关键词</div>'; return; }
      if (out) out.innerHTML = '<div class="muted">搜索中…</div>';
      try {
        const d = await apiKnowledgeSearch(query);
        if (!d.ok) { if (out) out.innerHTML = '<div>搜索失败: ' + (d.error || '') + '</div>'; return; }
        const list = d.results || [];
        if (!list.length) { if (out) out.innerHTML = '<div class="muted">未找到匹配资料</div>'; return; }
        if (out) out.innerHTML = list.map((r) => {
          const t = r.document?.title || r.title || '未命名';
          const id = r.document?.id || r.id || '';
          return '<div style="padding:3px 0;border-bottom:1px solid var(--border,#eee);">📄 ' + t +
            (id ? ' <span style="color:var(--muted);font-size:10px;">' + id.slice(0, 18) + '</span>' : '') + '</div>';
        }).join('');
      } catch (e) { if (out) out.innerHTML = '<div>请求失败: ' + (e.message || '网络错误') + '</div>'; }
    }

    async function loadCapabilitiesPlugins() {
      const out = document.getElementById('capPluginsResult');
      if (!out) return;
      out.innerHTML = '<div class="muted">加载中…</div>';
      try {
        const d = await apiPluginsMarket('', '');
        if (!d.ok) { out.innerHTML = '<div>加载失败: ' + (d.error || '') + '</div>'; return; }
        const list = d.plugins || [];
        if (!list.length) { out.innerHTML = '<div class="muted">插件市场为空</div>'; return; }
        out.innerHTML = list.slice(0, 15).map((p) =>
          '<div style="padding:3px 0;border-bottom:1px solid var(--border,#eee);">🧩 ' + (p.name || p.id) +
          ' <span style="color:var(--muted);font-size:10px;">v' + (p.version || '?') + '</span>' +
          '<div style="font-size:10px;color:var(--muted);">' + (p.description || '').slice(0, 40) + '</div></div>'
        ).join('') + (list.length > 15 ? '<div class="muted" style="font-size:10px;margin-top:4px;">…共 ' + list.length + ' 个</div>' : '');
      } catch (e) { out.innerHTML = '<div>请求失败: ' + (e.message || '网络错误') + '</div>'; }
    }

    /* ========== P1-1: ghost text 补全（记忆编辑器）========== */
    let _ghostTimer = null;
    let _ghostSuggestion = '';
    let _ghostBound = false;

    function bindGhostTextOnce() {
      if (_ghostBound) return;
      _ghostBound = true;
      const editor = document.getElementById('memLongEditor');
      const bar = document.getElementById('memGhostBar');
      if (!editor || !bar) return;
      editor.addEventListener('input', () => {
        clearTimeout(_ghostTimer);
        _ghostTimer = setTimeout(() => requestGhost(editor), 350);
      });
      editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && _ghostSuggestion) {
          e.preventDefault();
          acceptGhost(editor);
        } else if (e.key === 'Escape') {
          clearGhost();
        }
      });
      editor.addEventListener('blur', () => setTimeout(clearGhost, 250));
      // 编辑框显示时绑定一次
      document.getElementById('memLongEditor')?.addEventListener('focus', () => { /* 已绑定 */ });
    }

    async function requestGhost(editor) {
      const content = editor.value;
      const bar = document.getElementById('memGhostBar');
      if (!content.trim() || content.length < 10) { clearGhost(); return; }
      try {
        const d = await apiCompletion('memory-note.md', content, { language: 'markdown', mode: 'quick' });
        if (d.ok && Array.isArray(d.suggestions) && d.suggestions.length) {
          const t = d.suggestions[0].text || '';
          if (t && !content.endsWith(t)) {
            _ghostSuggestion = t;
            document.getElementById('memGhostText').textContent = t.slice(0, 200);
            bar.style.display = 'block';
          } else { clearGhost(); }
        } else { clearGhost(); }
      } catch { clearGhost(); }
    }

    function acceptGhost(editor) {
      if (!_ghostSuggestion) return;
      const cur = editor.selectionStart ?? editor.value.length;
      const end = editor.selectionEnd ?? cur;
      editor.value = editor.value.slice(0, cur) + _ghostSuggestion + editor.value.slice(end);
      const pos = cur + _ghostSuggestion.length;
      editor.selectionStart = editor.selectionEnd = pos;
      try { editor.dispatchEvent(new Event('input')); } catch {}
      clearGhost();
    }

    function clearGhost() {
      _ghostSuggestion = '';
      const bar = document.getElementById('memGhostBar');
      if (bar) bar.style.display = 'none';
    }
