/* M4 阶段 D：智能体编排面板 —— 左侧角色模板 → 中间可拖拽节点画布（全局目标中枢并行扇出）→ 生成 YAML/JSON → 一键发起并行执行
 * 复用全局 api() 鉴权请求；数据落 dataDir/orchestrator/runs（Apache-2.0 私有化，不上云）。
 */
(function () {
  var inited = false;
  var agents = [];                 // [{id, role, name, icon, desc, goal, x, y, el}]
  var templates = [];
  var dragState = null;
  var seq = 0;

  function stage() { return document.getElementById('orchStage'); }
  function status(msg) { var el = document.getElementById('orchStatus'); if (el) el.textContent = msg; }
  function genId() { seq += 1; return 'a' + Date.now().toString(36) + seq; }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ================= 模板加载 ================= */
  async function loadTemplates() {
    try {
      var d = await api('/api/orchestrator/templates');
      templates = (d && d.templates) || [];
      if (d && d.offline) status('就绪 · 本机未配置模型，将以离线合成模式演示并行编排');
      renderPalette();
    } catch (e) {
      document.getElementById('orchTplList').innerHTML = '<div class="empty">模板加载失败：' + escapeHtml(e.message) + '</div>';
    }
  }

  function renderPalette() {
    var list = document.getElementById('orchTplList');
    if (!list) return;
    list.innerHTML = '';
    templates.forEach(function (t, i) {
      var row = document.createElement('div');
      row.className = 'orch-tpl';
      row.setAttribute('draggable', 'true');
      row.innerHTML =
        '<span class="orch-tpl-icon">' + (t.icon || '🤖') + '</span>' +
        '<div class="orch-tpl-meta"><div class="orch-tpl-name">' + escapeHtml(t.name) + '</div>' +
        '<div class="orch-tpl-desc">' + escapeHtml(t.desc || '') + '</div></div>';
      row.addEventListener('click', function () { addAgent(t); });
      row.addEventListener('dragstart', function (e) {
        if (e.dataTransfer) e.dataTransfer.setData('text/orch-tpl', String(i));
      });
      list.appendChild(row);
    });
  }

  /* ================= 添加智能体节点 ================= */
  function addAgent(t, x, y) {
    var s = stage();
    if (!s) return;
    var idx = agents.length;
    var n = {
      id: genId(),
      role: t.role || 'agent',
      name: t.name || ('智能体' + (idx + 1)),
      icon: t.icon || '🤖',
      desc: t.desc || '',
      goal: '',
      x: typeof x === 'number' ? x : 40 + (idx % 3) * 240,
      y: typeof y === 'number' ? y : 130 + Math.floor(idx / 3) * 160,
      el: null,
    };
    agents.push(n);
    s.appendChild(renderAgent(n));
    drawLinks();
    status('已添加「' + n.name + '」· 共 ' + agents.length + ' 个智能体（并行）');
  }

  function renderAgent(n) {
    var card = document.createElement('div');
    card.className = 'orch-node';
    card.setAttribute('data-id', n.id);
    card.style.left = n.x + 'px';
    card.style.top = n.y + 'px';
    card.innerHTML =
      '<div class="orch-node-head" data-role="' + escapeHtml(n.role) + '">' +
        '<span class="orch-node-icon">' + n.icon + '</span>' +
        '<span class="orch-node-name" title="双击重命名">' + escapeHtml(n.name) + '</span>' +
        '<span class="orch-node-role">' + escapeHtml(n.role) + '</span>' +
        '<button class="orch-node-del" title="删除">✕</button>' +
      '</div>' +
      '<textarea class="orch-node-goal" placeholder="给这个智能体的子目标（留空则复用全局目标）"></textarea>';
    card.querySelector('.orch-node-goal').value = n.goal || '';

    card.querySelector('.orch-node-del').addEventListener('click', function (e) {
      e.stopPropagation();
      agents = agents.filter(function (x) { return x.id !== n.id; });
      card.remove();
      drawLinks();
      status('已删除「' + n.name + '」· 剩余 ' + agents.length + ' 个');
    });
    card.querySelector('.orch-node-name').addEventListener('dblclick', function () {
      var v = window.prompt('智能体名称', n.name);
      if (v != null) { n.name = v.trim() || n.name; card.querySelector('.orch-node-name').textContent = n.name; }
    });
    card.querySelector('.orch-node-goal').addEventListener('input', function (e) {
      n.goal = e.target.value;
    });

    // 拖拽移动
    card.querySelector('.orch-node-head').addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      dragState = { id: n.id, dx: e.clientX - n.x, dy: e.clientY - n.y };
      card.classList.add('dragging');
      e.preventDefault();
    });

    n.el = card;
    return card;
  }

  /* ================= SVG 并行连线（中枢 → 各 agent） ================= */
  function drawLinks() {
    var s = stage();
    var svg = document.getElementById('orchLinks');
    var hub = document.getElementById('orchHub');
    if (!s || !svg || !hub) return;
    var sRect = s.getBoundingClientRect();
    var hRect = hub.getBoundingClientRect();
    var hx = hRect.left - sRect.left + hRect.width / 2;
    var hy = hRect.top - sRect.top + hRect.height;
    svg.setAttribute('width', String(s.scrollWidth));
    svg.setAttribute('height', String(s.scrollHeight));
    var lines = '';
    agents.forEach(function (n) {
      if (!n.el) return;
      var r = n.el.getBoundingClientRect();
      var ax = r.left - sRect.left + r.width / 2;
      var ay = r.top - sRect.top;
      lines += '<line x1="' + hx + '" y1="' + hy + '" x2="' + ax + '" y2="' + ay + '" class="orch-link"/>';
    });
    svg.innerHTML = lines;
  }

  /* ================= 生成配置 ================= */
  function buildConfig() {
    var goal = (document.getElementById('orchGoal').value || '').trim();
    return {
      goal: goal,
      agents: agents.map(function (n) {
        return { id: n.id, name: n.name, role: n.role, goal: (n.goal || '').trim() || goal };
      }),
    };
  }

  function toYaml(cfg) {
    function s(v) { var t = String(v == null ? '' : v); return /[:#{}\[\]\n"]/.test(t) ? '"' + t.replace(/"/g, '\\"') + '"' : t; }
    function indent(lines, n) { return lines.map(function (l) { return '  '.repeat(n) + l; }).join('\n'); }
    var out = 'goal: ' + s(cfg.goal) + '\nagents:\n';
    cfg.agents.forEach(function (a) {
      out += '- id: ' + s(a.id) + '\n';
      out += '  name: ' + s(a.name) + '\n';
      out += '  role: ' + s(a.role) + '\n';
      out += '  goal: ' + s(a.goal) + '\n';
    });
    return out;
  }

  function showConfig(asYaml) {
    var cfg = buildConfig();
    var box = document.getElementById('orchConfig');
    if (!box) return;
    box.style.display = 'block';
    var text = asYaml ? toYaml(cfg) : JSON.stringify(cfg, null, 2);
    box.innerHTML = '<div class="orch-config-head">' + (asYaml ? '⚙ 编排配置 (YAML)' : '{} 编排配置 (JSON)') +
      ' · <button id="orchCfgCopy" class="ghost">复制</button> <button id="orchCfgClose" class="ghost">收起</button></div>' +
      '<pre class="orch-config-pre">' + escapeHtml(text) + '</pre>';
    box.querySelector('#orchCfgCopy').addEventListener('click', function () {
      try { navigator.clipboard.writeText(text); status('配置已复制到剪贴板'); } catch (e) { status('复制失败：' + e.message); }
    });
    box.querySelector('#orchCfgClose').addEventListener('click', function () { box.style.display = 'none'; });
  }

  /* ================= 一键发起（并行执行） ================= */
  async function run() {
    var cfg = buildConfig();
    if (!agents.length) { status('请先添加至少一个智能体'); return; }
    var btn = document.getElementById('orchRun');
    var resultsBody = document.getElementById('orchResultsBody');
    btn.disabled = true;
    btn.textContent = '⏳ 并行执行中…';
    status('正在并行执行 ' + agents.length + ' 个智能体…');
    resultsBody.innerHTML = '<div class="empty">⏳ 执行中…</div>';
    try {
      var payload = {
        goal: cfg.goal,
        agents: cfg.agents.map(function (a) { return { id: a.id, name: a.name, role: a.role, goal: a.goal }; }),
      };
      var d = await api('/api/orchestrator/run', 'POST', payload);
      if (!d || !d.ok) { resultsBody.innerHTML = '<div class="empty" style="color:var(--err)">发起失败：' + escapeHtml((d && d.error) || '未知') + '</div>'; return; }
      renderResults(d);
      status('✅ 并行执行完成 · ' + agents.length + ' 个智能体 · 耗时 ' + Math.round((d.durationMs || 0) / 1000) + 's' + (d.offline ? '（离线合成）' : ''));
    } catch (e) {
      resultsBody.innerHTML = '<div class="empty" style="color:var(--err)">请求失败：' + escapeHtml(e.message) + '</div>';
    } finally {
      btn.disabled = false;
      btn.textContent = '▶ 一键发起（并行执行）';
    }
  }

  function renderResults(d) {
    var body = document.getElementById('orchResultsBody');
    if (!body) return;
    var results = d.results || [];
    var html = '<div class="orch-run-meta">runId: ' + escapeHtml(d.runId || '-') +
      ' · 耗时 ' + Math.round((d.durationMs || 0) / 1000) + 's · ' +
      (d.offline ? '🔌 离线合成' : '🌐 在线模型') + '</div>';
    results.forEach(function (r, i) {
      html +=
        '<div class="orch-result-card">' +
          '<div class="orch-result-head">' +
            '<span class="orch-result-idx">' + (i + 1) + '</span>' +
            '<span class="orch-result-name">' + escapeHtml(r.name) + '</span>' +
            '<span class="orch-result-role">' + escapeHtml(r.role || 'agent') + '</span>' +
            '<span class="orch-result-badge ' + (r.ok ? 'ok' : 'fail') + '">' + (r.ok ? 'OK' : 'FAIL') + '</span>' +
            '<span class="orch-result-time">' + Math.round((r.durationMs || 0)) + 'ms</span>' +
          '</div>' +
          '<pre class="orch-result-content">' + escapeHtml((r.content || '').slice(0, 4000)) + '</pre>' +
        '</div>';
    });
    html += '<div class="orch-run-summary">' + escapeHtml(d.summary || '') + '</div>';
    body.innerHTML = html;
  }

  /* ================= 拖放 / 绑定 ================= */
  function bindDrag() {
    document.addEventListener('mousemove', function (e) {
      if (!dragState) return;
      var n = agents.find(function (x) { return x.id === dragState.id; });
      var card = n && n.el;
      if (!card) return;
      var sRect = stage().getBoundingClientRect();
      var x = Math.max(0, Math.min(sRect.width - card.offsetWidth, e.clientX - dragState.dx - sRect.left));
      var y = Math.max(0, Math.min(sRect.height - card.offsetHeight, e.clientY - dragState.dy - sRect.top));
      n.x = x; n.y = y;
      card.style.left = x + 'px';
      card.style.top = y + 'px';
      drawLinks();
    });
    document.addEventListener('mouseup', function () {
      if (dragState) {
        var n = agents.find(function (x) { return x.id === dragState.id; });
        if (n && n.el) n.el.classList.remove('dragging');
        dragState = null;
      }
    });
  }

  function bind() {
    document.getElementById('orchAddEmpty').addEventListener('click', function () {
      addAgent({ role: 'agent', name: '智能体' + (agents.length + 1), icon: '🤖', desc: '' });
    });
    document.getElementById('orchGenJson').addEventListener('click', function () { showConfig(false); });
    document.getElementById('orchGenYaml').addEventListener('click', function () { showConfig(true); });
    document.getElementById('orchRun').addEventListener('click', run);

    var s = stage();
    if (s) {
      s.addEventListener('dragover', function (e) { e.preventDefault(); });
      s.addEventListener('drop', function (e) {
        e.preventDefault();
        var raw = e.dataTransfer && e.dataTransfer.getData('text/orch-tpl');
        if (raw === '' || raw == null) return;
        var i = parseInt(raw, 10);
        if (isNaN(i) || !templates[i]) return;
        var sRect = s.getBoundingClientRect();
        var x = e.clientX - sRect.left - 90;
        var y = e.clientY - sRect.top - 20;
        addAgent(templates[i], Math.max(0, x), Math.max(0, y));
      });
      // 窗口尺寸变化重绘连线
      window.addEventListener('resize', drawLinks);
    }
    bindDrag();
  }

  window.initOrchestratorView = function () {
    if (inited) { drawLinks(); return; }
    inited = true;
    bind();
    loadTemplates();
    // 预置一个 2 智能体并行示例，便于首次直接进入即可验收
    if (!agents.length) {
      addAgent({ role: 'researcher', name: '调研分析师', icon: '🔍', desc: '梳理核心发现' }, 40, 130);
      addAgent({ role: 'coder', name: '开发者', icon: '💻', desc: '产出代码方案' }, 300, 130);
      var g = document.getElementById('orchGoal');
      if (g && !g.value) g.value = '为服装厂老板设计一套合伙分红方案';
      drawLinks();
    }
  };
})();
