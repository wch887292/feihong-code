/* M5：WSL2 内核管理视图 —— 自编译 Linux 7.3 内核（H:/wsl/kernel/bzImage，零占 C: 部署）
 * 功能对齐 exe 控制台：状态总览 / 电源管理 / 后台重编译（轮询日志）/ .wslconfig 内核指向 / 编译日志
 * 复用全局 api() 做鉴权请求（自动携带 token + 请求签名），所有操作本地执行，不上云。
 */
(function () {
  var inited = false;
  var buildJobId = null;
  var buildTimer = null;

  function $(id) { return document.getElementById(id); }
  function status(msg) { var el = $('wslStatus'); if (el) el.textContent = msg; }
  function buildState(msg) { var el = $('wslBuildState'); if (el) el.textContent = msg; }
  function cfgState(msg) { var el = $('wslCfgState'); if (el) el.textContent = msg; }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ================= 状态总览 ================= */

  async function refresh() {
    status('正在读取 WSL 状态…');
    try {
      var r = await api('/api/wsl/status');
      if (!r || !r.ok) { status('读取失败：' + ((r && r.error) || '未知')); return; }
      renderCards(r);
      var k = r.runningKernel || '未启动';
      status('运行内核 ' + k + (r.customActive ? ' · ✅ 自编译内核已生效' : ' · ⚠️ 未在使用自编译内核'));
    } catch (e) { status('读取失败：' + e); }
  }

  function renderCards(r) {
    var box = $('wslCards');
    if (!box) return;
    var cards = [
      { k: 'WSL 发行版', v: r.distro || '-' },
      { k: '运行中的内核', v: r.runningKernel || '未启动', cls: r.runningKernel ? (r.customActive ? 'ok' : 'warn') : 'warn' },
      { k: '自编译内核是否生效', v: r.customActive ? '✅ 已生效（' + r.runningKernel + '）' : '⚠️ 未生效', cls: r.customActive ? 'ok' : 'warn' },
      { k: '.wslconfig 指向', v: r.configKernel || '（未配置 kernel= 行）' },
      { k: '内核镜像（Windows 侧）', v: r.kernelImg || '-' },
      { k: '内核源码（WSL 内）', v: r.srcDir || '-' }
    ];
    var html = cards.map(function (c) {
      return '<div class="wsl-card"><div class="k">' + escapeHtml(c.k) + '</div><div class="v ' + (c.cls || '') + '">' + escapeHtml(c.v) + '</div></div>';
    }).join('');
    if (r.distroList) {
      html += '<div class="wsl-card" style="grid-column:1/-1;"><div class="k">wsl -l -v 发行版列表</div><pre class="wsl-log" style="max-height:120px;">' + escapeHtml(r.distroList) + '</pre></div>';
    }
    if (r.wslStatus) {
      html += '<div class="wsl-card" style="grid-column:1/-1;"><div class="k">wsl --status 原始输出</div><pre class="wsl-log" style="max-height:140px;">' + escapeHtml(r.wslStatus) + '</pre></div>';
    }
    box.innerHTML = html;
  }

  /* ================= 电源管理 ================= */

  async function power(action) {
    var labels = {
      start: '启动发行版',
      restart: '重启 WSL（关机，下次启动自动重拉）',
      shutdown: '全局关机',
      terminate: '终止发行版'
    };
    var label = labels[action] || action;
    status(label + '中…');
    try {
      var r = await api('/api/wsl/power', 'POST', { action: action });
      if (r && r.ok) { status(label + '完成'); }
      else { status(label + '失败：' + ((r && r.error) || (r && r.stderr) || '未知')); }
      setTimeout(refresh, 1500);
    } catch (e) { status(label + '失败：' + e); }
  }

  /* ================= 后台编译 ================= */

  async function startBuild() {
    var input = $('wslBuildJobs');
    var jobs = parseInt(input && input.value, 10) || 12;
    buildState('正在启动编译任务…');
    try {
      var r = await api('/api/wsl/build', 'POST', { jobs: jobs });
      if (!r || !r.ok) { buildState('启动失败：' + ((r && r.error) || '未知')); return; }
      buildJobId = r.jobId;
      var btn = $('wslBuildBtn'); if (btn) btn.disabled = true;
      var stop = $('wslBuildStop'); if (stop) stop.style.display = '';
      buildState('编译中… job ' + buildJobId + '（make -j' + jobs + '）');
      pollBuild();
    } catch (e) { buildState('启动失败：' + e); }
  }

  async function pollBuild() {
    if (!buildJobId) return;
    try {
      var r = await api('/api/wsl/build/status?jobId=' + encodeURIComponent(buildJobId));
      if (r && r.ok && r.job) {
        var j = r.job;
        var logEl = $('wslBuildLog');
        if (logEl) {
          var text = '';
          if (r.logs) text = r.logs.combined || ((r.logs.stdout || '') + (r.logs.stderr ? '\n' + r.logs.stderr : ''));
          logEl.textContent = text || '（暂无输出）';
          logEl.scrollTop = logEl.scrollHeight;
        }
        if (j.status === 'running') {
          buildState('编译中… ' + (j.startedAt || ''));
          buildTimer = setTimeout(pollBuild, 2000);
        } else {
          buildState('编译结束：' + j.status + '（exit ' + j.exitCode + '）' + (j.exitCode === 0 ? ' · 重启 WSL 后生效' : ' · 请检查日志'));
          var btn = $('wslBuildBtn'); if (btn) btn.disabled = false;
          var stop = $('wslBuildStop'); if (stop) stop.style.display = 'none';
          buildJobId = null;
          refresh();
        }
      } else {
        buildState('任务状态查询失败' + (r && r.error ? '：' + r.error : ''));
        buildTimer = setTimeout(pollBuild, 3000);
      }
    } catch (e) {
      buildState('轮询失败：' + e);
      buildTimer = setTimeout(pollBuild, 3000);
    }
  }

  async function stopBuild() {
    if (!buildJobId) return;
    try {
      var r = await api('/api/wsl/build/stop', 'POST', { jobId: buildJobId });
      buildState(r && r.ok ? '已发送停止指令' : '停止失败：' + ((r && r.message) || '未知'));
    } catch (e) { buildState('停止失败：' + e); }
  }

  /* ================= .wslconfig 内核指向 ================= */

  async function loadCfg() {
    cfgState('读取中…');
    try {
      var r = await api('/api/wsl/config');
      var editor = $('wslCfgEditor');
      if (r && r.ok && editor) {
        editor.value = r.content || '';
        cfgState('已读取 ' + r.path + (r.exists ? '' : '（文件不存在，保存将创建）'));
      } else { cfgState('读取失败：' + ((r && r.error) || '未知')); }
    } catch (e) { cfgState('读取失败：' + e); }
  }

  async function saveCfg() {
    var editor = $('wslCfgEditor');
    var text = (editor && editor.value) || '';
    var m = text.match(/^\s*kernel\s*=\s*(.+)$/mi);
    if (!m) { cfgState('保存失败：编辑器中缺少 kernel= 行'); return; }
    cfgState('保存中…');
    try {
      var r = await api('/api/wsl/config', 'POST', { kernel: m[1].trim() });
      if (r && r.ok) {
        cfgState('已保存（原文件已备份为 .wslconfig.bak-*）· 重启 WSL 后生效');
        if (editor) editor.value = r.content || text;
        refresh();
      } else { cfgState('保存失败：' + ((r && r.error) || '未知')); }
    } catch (e) { cfgState('保存失败：' + e); }
  }

  /* ================= 编译日志 ================= */

  async function loadLog() {
    try {
      var r = await api('/api/wsl/log?lines=150');
      var el = $('wslLogBody');
      if (el) el.textContent = (r && r.ok) ? (r.log || '（日志为空）') : ('读取失败：' + ((r && r.error) || '未知'));
    } catch (e) {
      var el2 = $('wslLogBody');
      if (el2) el2.textContent = '读取失败：' + e;
    }
  }

  async function openDir(target) {
    try {
      var r = await api('/api/wsl/open-dir', 'POST', { target: target });
      status(r && r.ok ? '已请求打开 ' + target : ('打开失败：' + ((r && r.error) || '未知')));
    } catch (e) { status('打开失败：' + e); }
  }

  /* ================= 初始化 ================= */

  window.initWslView = function () {
    if (!inited) {
      inited = true;
      $('wslRefresh').addEventListener('click', refresh);
      $('wslStart').addEventListener('click', function () { power('start'); });
      $('wslRestart').addEventListener('click', function () { power('restart'); });
      $('wslTerminate').addEventListener('click', function () { power('terminate'); });
      $('wslShutdown').addEventListener('click', function () { power('shutdown'); });
      $('wslBuildBtn').addEventListener('click', startBuild);
      $('wslBuildStop').addEventListener('click', stopBuild);
      $('wslCfgReload').addEventListener('click', loadCfg);
      $('wslCfgSave').addEventListener('click', saveCfg);
      $('wslLogRefresh').addEventListener('click', loadLog);
      $('wslOpenSrc').addEventListener('click', function () { openDir('\\\\wsl.localhost\\Ubuntu-22.04\\root\\linux-7.3'); });
      $('wslOpenWin').addEventListener('click', function () { openDir('H:/wsl'); });
    }
    refresh();
    loadCfg();
  };
})();
