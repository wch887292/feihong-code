/* M3 阶段 C：画布视图 —— 卡片节点（思路/素材/AI 产出），增删/拖拽/编辑/本地持久化
 * 复用全局 api() 做鉴权请求（自动携带 token + 请求签名），数据落 dataDir/canvas/board.json，不上云。
 */
(function () {
  var inited = false;
  var nodes = [];
  var dragState = null;

  var TYPE_META = {
    idea: { icon: '💡', label: '思路', color: '#f59e0b' },
    material: { icon: '📎', label: '素材', color: '#3b82f6' },
    ai: { icon: '🤖', label: 'AI 产出', color: '#a855f7' }
  };

  function stage() { return document.getElementById('canvasStage'); }
  function status(msg) { var el = document.getElementById('canvasStatus'); if (el) el.textContent = msg; }
  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  async function load() {
    try {
      var r = await api('/api/canvas/load');
      nodes = (r && Array.isArray(r.nodes)) ? r.nodes : [];
    } catch (_) { nodes = []; }
    renderAll();
    status('已加载 ' + nodes.length + ' 个卡片');
  }

  async function save() {
    try {
      var r = await api('/api/canvas/save', 'POST', { nodes: nodes });
      if (r && r.ok) status('已保存 ' + (r.count || 0) + ' 个卡片');
      else status('保存失败：' + ((r && r.error) || '未知'));
    } catch (e) { status('保存失败：' + e); }
  }

  function renderAll() {
    var s = stage();
    if (!s) return;
    s.innerHTML = '';
    nodes.forEach(function (n) { s.appendChild(renderCard(n)); });
  }

  function renderCard(n) {
    var meta = TYPE_META[n.type] || TYPE_META.idea;
    var card = document.createElement('div');
    card.className = 'canvas-card';
    card.setAttribute('data-id', n.id);
    card.style.left = (n.x || 40) + 'px';
    card.style.top = (n.y || 40) + 'px';
    card.style.borderTopColor = meta.color;
    card.innerHTML =
      '<div class="canvas-card-head">' +
        '<span class="canvas-card-type">' + meta.icon + ' ' + meta.label + '</span>' +
        '<button class="canvas-card-del" title="删除">✕</button>' +
      '</div>' +
      '<div class="canvas-card-title" title="双击编辑">' + escapeHtml(n.title || '未命名') + '</div>' +
      '<div class="canvas-card-body" title="双击编辑">' + escapeHtml(n.text || '') + '</div>';
    card.querySelector('.canvas-card-del').addEventListener('click', function (e) {
      e.stopPropagation();
      nodes = nodes.filter(function (x) { return x.id !== n.id; });
      card.remove();
      status('已删除 1 个卡片（保存后持久化）');
    });
    card.querySelector('.canvas-card-title').addEventListener('dblclick', function () { editCard(n, 'title', card); });
    card.querySelector('.canvas-card-body').addEventListener('dblclick', function () { editCard(n, 'text', card); });
    card.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      dragState = { id: n.id, dx: e.clientX - (n.x || 0), dy: e.clientY - (n.y || 0) };
      card.classList.add('dragging');
      e.preventDefault();
    });
    return card;
  }

  function editCard(n, field, card) {
    var sel = field === 'title' ? '.canvas-card-title' : '.canvas-card-body';
    var el = card.querySelector(sel);
    var input = document.createElement('textarea');
    input.className = 'canvas-card-input';
    input.value = n[field] || '';
    el.replaceWith(input);
    input.focus();
    var done = function () {
      n[field] = input.value.trim();
      var div = document.createElement('div');
      div.className = 'canvas-card-' + field;
      div.title = '双击编辑';
      div.textContent = n[field] || (field === 'title' ? '未命名' : '');
      input.replaceWith(div);
      div.addEventListener('dblclick', function () { editCard(n, field, card); });
    };
    input.addEventListener('blur', done);
    input.addEventListener('keydown', function (e) { if (e.key === 'Escape') input.blur(); });
  }

  function addCard(type) {
    var s = stage();
    if (!s) return;
    var offset = nodes.length * 24;
    var n = { id: genId(), type: type, x: 40 + offset, y: 60 + offset, title: TYPE_META[type].label + '卡片', text: '' };
    nodes.push(n);
    s.appendChild(renderCard(n));
    status('已添加「' + TYPE_META[type].label + '」卡片（保存后持久化）');
  }

  function bindDrag() {
    document.addEventListener('mousemove', function (e) {
      if (!dragState) return;
      var card = stage().querySelector('[data-id="' + dragState.id + '"]');
      if (!card) return;
      var n = nodes.find(function (x) { return x.id === dragState.id; });
      if (!n) return;
      var rect = stage().getBoundingClientRect();
      var x = Math.max(0, Math.min(rect.width - card.offsetWidth, e.clientX - dragState.dx));
      var y = Math.max(0, Math.min(rect.height - card.offsetHeight, e.clientY - dragState.dy));
      n.x = x; n.y = y;
      card.style.left = x + 'px';
      card.style.top = y + 'px';
    });
    document.addEventListener('mouseup', function () {
      if (dragState) {
        var card = stage().querySelector('[data-id="' + dragState.id + '"]');
        if (card) card.classList.remove('dragging');
        dragState = null;
      }
    });
  }

  function bind() {
    document.getElementById('canvasAddIdea').addEventListener('click', function () { addCard('idea'); });
    document.getElementById('canvasAddMaterial').addEventListener('click', function () { addCard('material'); });
    document.getElementById('canvasAddAi').addEventListener('click', function () { addCard('ai'); });
    document.getElementById('canvasSave').addEventListener('click', save);
    document.getElementById('canvasReload').addEventListener('click', load);
    document.getElementById('canvasClear').addEventListener('click', function () {
      if (!window.confirm('确认清空画布所有卡片？')) return;
      nodes = [];
      renderAll();
      save();
    });
    bindDrag();
  }

  window.initCanvasView = function () {
    if (inited) return;
    inited = true;
    bind();
    load();
  };
})();
