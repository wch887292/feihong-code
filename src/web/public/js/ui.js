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
      if (mode === 'code' || mode === 'file') {
        box.innerHTML = '<pre>' + escapeHtml(content) + '</pre>';
      } else {
        box.innerHTML = '<div style="white-space:pre-wrap;word-break:break-word;">' + content + '</div>';
      }
    }

    function switchRightTab(name) {
      state.rightTab = name;
      document.querySelectorAll('.right-tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-tab') === name));
      document.getElementById('detailPanel').classList.toggle('active', name === 'detail');
      document.getElementById('previewPanel').classList.toggle('active', name === 'preview');
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
          if (elapsed > 60) {
            waitTip += '<div style="color:var(--muted);font-size:12px;margin-top:6px;line-height:1.5;">模型正在深度思考或执行复杂操作，请耐心等待...<br>如果等待超过3分钟，可以尝试点击「停止」后重新提交。</div>';
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
