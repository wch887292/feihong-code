/* M3 阶段 C：画布视图 —— 卡片节点（思路/素材/AI 产出），增删/拖拽/编辑/本地持久化
 * 素材卡支持上传文件（按钮 + 拖放）、图片缩略图预览、系统默认程序打开。
 * 复用全局 api() 做鉴权请求（自动携带 token + 请求签名），数据落 dataDir/canvas/board.json 与 dataDir/canvas/files/，不上云。
 */
(function () {
  var inited = false;
  var nodes = [];
  var dragState = null;
  var blobUrls = [];                        // 缩略图 objectURL，避免泄漏
  var MAX_UPLOAD = 6 * 1024 * 1024;         // 后端 JSON 限 8MB，base64 膨胀 4/3 → 单文件 6MB 安全上限

  var TYPE_META = {
    idea: { icon: '💡', label: '思路', color: '#f59e0b' },
    material: { icon: '📎', label: '素材', color: '#3b82f6' },
    ai: { icon: '🤖', label: 'AI 产出', color: '#a855f7' }
  };

  var IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i;

  function stage() { return document.getElementById('canvasStage'); }
  function status(msg) { var el = document.getElementById('canvasStatus'); if (el) el.textContent = msg; }
  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isImage(f) { return /^image\//i.test(f.mime || '') || IMG_EXT.test(f.name || ''); }
  function fmtSize(n) {
    var b = Number(n) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }
  function fileIcon(f) {
    var mime = f.mime || '', name = f.name || '';
    if (isImage(f)) return '🖼';
    if (/pdf/i.test(mime) || /\.pdf$/i.test(name)) return '📕';
    if (/sheet|excel|csv/i.test(mime) || /\.(xlsx?|csv)$/i.test(name)) return '📊';
    if (/word|document/i.test(mime) || /\.docx?$/i.test(name)) return '📄';
    if (/zip|compressed|rar|7z/i.test(mime) || /\.(zip|rar|7z|tar|gz)$/i.test(name)) return '🗜';
    if (/^video\//i.test(mime)) return '🎬';
    if (/^audio\//i.test(mime)) return '🎵';
    if (/^text\/|json/i.test(mime)) return '📝';
    return '📎';
  }

  /* ================= 加载 / 保存 ================= */

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
      return !!(r && r.ok);
    } catch (e) { status('保存失败：' + e); return false; }
  }

  /* ================= 渲染 ================= */

  function renderAll() {
    var s = stage();
    if (!s) return;
    blobUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (_) {} });
    blobUrls = [];
    s.innerHTML = '';
    nodes.forEach(function (n) { s.appendChild(renderCard(n)); });
  }

  function renderCard(n) {
    var meta = TYPE_META[n.type] || TYPE_META.idea;
    var card = document.createElement('div');
    card.className = 'canvas-card';
    card.setAttribute('data-id', n.id);
    card.setAttribute('data-type', n.type || 'idea');
    card.style.left = (n.x || 40) + 'px';
    card.style.top = (n.y || 40) + 'px';
    card.style.borderTopColor = meta.color;
    card.innerHTML =
      '<div class="canvas-card-head">' +
        '<span class="canvas-card-type">' + meta.icon + ' ' + meta.label + '</span>' +
        '<button class="canvas-card-del" title="删除">✕</button>' +
      '</div>' +
      '<div class="canvas-card-title" title="双击编辑">' + escapeHtml(n.title || '未命名') + '</div>' +
      '<div class="canvas-card-body" title="双击编辑">' + escapeHtml(n.text || '') + '</div>' +
      (n.type === 'material'
        ? '<div class="canvas-card-files">' +
            '<button class="canvas-file-add" title="选择本地文件上传">📤 上传文件</button>' +
            '<div class="canvas-file-list"></div>' +
            '<div class="canvas-file-hint">也可把文件直接拖到这张卡片上</div>' +
          '</div>'
        : '');

    card.querySelector('.canvas-card-del').addEventListener('click', function (e) {
      e.stopPropagation();
      nodes = nodes.filter(function (x) { return x.id !== n.id; });
      card.remove();
      status('已删除 1 个卡片（保存后持久化）');
    });
    card.querySelector('.canvas-card-title').addEventListener('dblclick', function () { editCard(n, 'title', card); });
    card.querySelector('.canvas-card-body').addEventListener('dblclick', function () { editCard(n, 'text', card); });

    if (n.type === 'material') {
      card.querySelector('.canvas-file-add').addEventListener('click', function (e) {
        e.stopPropagation();
        pickFiles(n, card);
      });
      // 拖放上传：文件直接拖到素材卡
      card.addEventListener('dragover', function (e) {
        if (!e.dataTransfer) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        card.classList.add('drop-hot');
      });
      card.addEventListener('dragleave', function () { card.classList.remove('drop-hot'); });
      card.addEventListener('drop', function (e) {
        if (!e.dataTransfer) return;
        e.preventDefault();
        e.stopPropagation();
        card.classList.remove('drop-hot');
        uploadFiles(n, e.dataTransfer.files, card);
      });
      renderFiles(n, card);
    }

    card.addEventListener('mousedown', function (e) {
      if (e.target.closest('button') || e.target.closest('.canvas-file-row')) return;
      dragState = { id: n.id, dx: e.clientX - (n.x || 0), dy: e.clientY - (n.y || 0) };
      card.classList.add('dragging');
      e.preventDefault();
    });
    return card;
  }

  /* ================= 素材：文件列表 ================= */

  function renderFiles(n, card) {
    var list = card.querySelector('.canvas-file-list');
    if (!list) return;
    list.innerHTML = '';
    var files = Array.isArray(n.files) ? n.files : [];
    if (!files.length) {
      list.innerHTML = '<div class="canvas-file-empty">暂无附件</div>';
      return;
    }
    files.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'canvas-file-row';
      row.innerHTML =
        '<span class="canvas-file-icon">' + fileIcon(f) + '</span>' +
        '<span class="canvas-file-name" title="' + escapeHtml(f.name || '') + '\n点击用系统默认程序打开">' + escapeHtml(f.name || '未命名') + '</span>' +
        '<span class="canvas-file-size">' + fmtSize(f.size) + '</span>' +
        '<button class="canvas-file-open" title="用默认程序打开">↗</button>' +
        '<button class="canvas-file-folder" title="打开所在文件夹">📂</button>' +
        '<button class="canvas-file-del" title="移除该附件（不删除磁盘文件）">✕</button>';

      row.querySelector('.canvas-file-name').addEventListener('click', function () { openAsset(f, 'file'); });
      row.querySelector('.canvas-file-open').addEventListener('click', function (e) { e.stopPropagation(); openAsset(f, 'file'); });
      row.querySelector('.canvas-file-folder').addEventListener('click', function (e) { e.stopPropagation(); openAsset(f, 'folder'); });
      row.querySelector('.canvas-file-del').addEventListener('click', function (e) {
        e.stopPropagation();
        n.files = (n.files || []).filter(function (x) { return x.id !== f.id; });
        renderFiles(n, card);
        status('已移除附件引用（点「保存」后持久化）');
      });

      if (isImage(f)) {
        var thumb = document.createElement('img');
        thumb.className = 'canvas-file-thumb';
        thumb.alt = f.name || '';
        var iconEl = row.querySelector('.canvas-file-icon');
        if (iconEl) iconEl.replaceWith(thumb);
        loadThumb(f, thumb);
      }
      list.appendChild(row);
    });
  }

  function loadThumb(f, imgEl) {
    if (!f.stored) return;
    try {
      fetch('/api/canvas/file?name=' + encodeURIComponent(f.stored), { headers: authHeaders(), cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.blob(); })
        .then(function (b) {
          var url = URL.createObjectURL(b);
          blobUrls.push(url);
          imgEl.src = url;
        })
        .catch(function () { imgEl.replaceWith(document.createTextNode('🖼')); });
    } catch (_) { imgEl.replaceWith(document.createTextNode('🖼')); }
  }

  async function openAsset(f, mode) {
    if (!f || !f.stored) { status('该附件缺少磁盘文件名，无法打开'); return; }
    try {
      var r = await api('/api/canvas/open', 'POST', { name: f.stored, mode: mode });
      if (r && r.ok) status((mode === 'folder' ? '已打开所在文件夹：' : '已用默认程序打开：') + (f.name || f.stored));
      else status('打开失败：' + ((r && r.error) || '未知'));
    } catch (e) { status('打开失败：' + e); }
  }

  /* ================= 素材：上传 ================= */

  function pickFiles(n, card) {
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', function () {
      uploadFiles(n, input.files, card);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  function readAsBase64(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        res(s.indexOf(',') >= 0 ? s.split(',')[1] : s);
      };
      fr.onerror = function () { rej(fr.error || new Error('读取文件失败')); };
      fr.readAsDataURL(file);
    });
  }

  async function uploadFiles(n, fileList, card) {
    var files = fileList ? Array.prototype.slice.call(fileList) : [];
    if (!files.length) return;
    n.files = Array.isArray(n.files) ? n.files : [];
    var okCount = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (f.size > MAX_UPLOAD) {
        status('跳过「' + f.name + '」：' + fmtSize(f.size) + ' 超过 6MB 上限');
        continue;
      }
      try {
        status('正在上传「' + f.name + '」…');
        var b64 = await readAsBase64(f);
        var r = await api('/api/canvas/upload', 'POST', {
          name: f.name,
          mime: f.type || 'application/octet-stream',
          dataBase64: b64
        });
        if (!r || !r.ok) { status('上传失败「' + f.name + '」：' + ((r && r.error) || '未知')); continue; }
        n.files.push({ id: genId(), name: r.name, stored: r.stored, mime: r.mime, size: r.size });
        okCount++;
        renderFiles(n, card);
      } catch (e) { status('上传失败「' + f.name + '」：' + e); }
    }
    if (okCount) {
      renderFiles(n, card);
      await save();                                    // 上传即落库，避免忘点保存丢失
      status('已上传并保存 ' + okCount + ' 个附件（共 ' + n.files.length + ' 个）');
    }
  }

  /* ================= 编辑 / 新增 ================= */

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
    if (!s) return null;
    var offset = nodes.length * 24;
    var n = {
      id: genId(), type: type, x: 40 + offset, y: 60 + offset,
      title: TYPE_META[type].label + '卡片', text: '',
      files: type === 'material' ? [] : undefined
    };
    nodes.push(n);
    s.appendChild(renderCard(n));
    status('已添加「' + TYPE_META[type].label + '」卡片（保存后持久化）');
    return n;
  }

  /* ================= 拖拽 / 绑定 ================= */

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

    // 工具栏「上传素材」：新建一张素材卡并直接弹出文件选择
    var upBtn = document.getElementById('canvasUploadMaterial');
    if (upBtn) {
      upBtn.addEventListener('click', function () {
        var n = addCard('material');
        if (!n) return;
        var card = stage().querySelector('[data-id="' + n.id + '"]');
        if (card) pickFiles(n, card);
      });
    }

    document.getElementById('canvasSave').addEventListener('click', save);
    document.getElementById('canvasReload').addEventListener('click', load);
    document.getElementById('canvasClear').addEventListener('click', function () {
      if (!window.confirm('确认清空画布所有卡片？（磁盘上的素材文件不会被删除）')) return;
      nodes = [];
      renderAll();
      save();
    });

    // 防止文件拖到画板空白处时浏览器直接打开该文件
    var s = stage();
    if (s) {
      s.addEventListener('dragover', function (e) { e.preventDefault(); });
      s.addEventListener('drop', function (e) { e.preventDefault(); });
    }
    bindDrag();
  }

  window.initCanvasView = function () {
    if (inited) return;
    inited = true;
    bind();
    load();
  };
})();
