/* M2 阶段 B：内置浏览器视图（对标 Skyalytic Wing「浏览器」模块）
 * - 复用全局 api() 做鉴权请求（自动携带 token + 请求签名）
 * - <webview> 提供页面加载/观察/操作能力
 * - 观察/操作数据写入本地审计日志（Apache-2.0 私有化，不上云），呼应企业审计差异化
 */
(function () {
  let inited = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function initBrowserView() {
    if (inited) return;
    inited = true;
    const webview = $('browserWebview');
    const urlInput = $('browserUrl');
    const status = $('browserStatus');
    if (!webview) return;

    function setStatus(s) { if (status) status.textContent = s; }
    function currentUrl() {
      try { return webview.getURL ? webview.getURL() : (urlInput && urlInput.value) || ''; }
      catch (_) { return (urlInput && urlInput.value) || ''; }
    }
    function isBlank() { const u = currentUrl(); return !u || u === 'about:blank'; }

    function navigate(raw) {
      let target = (raw || (urlInput && urlInput.value) || '').trim();
      if (!target) return;
      if (!/^https?:\/\//i.test(target) && target !== 'about:blank') target = 'https://' + target;
      if (urlInput) urlInput.value = target;
      try { webview.src = target; setStatus('加载中：' + target); }
      catch (e) { setStatus('导航失败：' + e.message); }
    }

    $('browserGo') && $('browserGo').addEventListener('click', function () { navigate(); });
    if (urlInput) urlInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') navigate(); });
    $('browserBack') && $('browserBack').addEventListener('click', function () { try { webview.goBack(); } catch (_) {} });
    $('browserFwd') && $('browserFwd').addEventListener('click', function () { try { webview.goForward(); } catch (_) {} });
    $('browserReload') && $('browserReload').addEventListener('click', function () { try { webview.reload(); } catch (_) {} });
    $('browserPreset') && $('browserPreset').addEventListener('change', function (e) { if (e.target.value) navigate(e.target.value); });

    if (webview.addEventListener) {
      webview.addEventListener('did-start-loading', function () { setStatus('加载中…'); });
      webview.addEventListener('did-stop-loading', function () {
        const u = currentUrl();
        if (urlInput) urlInput.value = u;
        setStatus('完成：' + u);
      });
      webview.addEventListener('did-navigate', function (e) {
        const u = (e && e.url) || currentUrl();
        if (urlInput) urlInput.value = u;
        setStatus('已导航：' + u);
      });
      webview.addEventListener('did-fail-load', function (e) {
        setStatus('加载失败：' + ((e && e.errorDescription) || (e && e.errorCode) || '未知错误'));
      });
    }

    // 让 AI 观察当前页（提取标题 + 正文，截断后上报）
    $('browserObserve') && $('browserObserve').addEventListener('click', async function () {
      if (isBlank()) { toast('请先导航到一个网页'); return; }
      const u = currentUrl();
      setStatus('AI 观察中…');
      try {
        const title = await webview.executeJavaScript('document.title || ""').catch(function () { return ''; });
        const text = await webview.executeJavaScript('(document.body ? document.body.innerText : (document.documentElement ? document.documentElement.innerText : "")) || ""').catch(function () { return ''; });
        const payload = { url: u, title: title || '', text: (text || '').slice(0, 8000) };
        const d = await api('/api/browser/observe', 'POST', payload);
        setStatus('AI 已观察：' + u + '（' + payload.text.length + ' 字）');
        toast('已发送给 AI 观察 · 写入本地审计日志 #' + (d.id || ''));
      } catch (e) { setStatus('观察失败：' + e.message); toast('观察失败：' + e.message); }
    });

    // 让 AI 操作此页（记录动作意图，交 agent 运行时执行）
    $('browserAct') && $('browserAct').addEventListener('click', async function () {
      if (isBlank()) { toast('请先导航到一个网页'); return; }
      const action = window.prompt('描述要 AI 在此页执行的操作（例如：点击登录按钮并填入账号）：');
      if (!action) return;
      const u = currentUrl();
      setStatus('AI 操作中…');
      try {
        const d = await api('/api/browser/act', 'POST', { url: u, action: action.slice(0, 2000) });
        setStatus('AI 操作已记录：' + action);
        toast('操作已记录 · 计划：' + (d.plan || '待 agent 运行时执行'));
      } catch (e) { setStatus('操作失败：' + e.message); toast('操作失败：' + e.message); }
    });

    // 审计日志
    $('browserLog') && $('browserLog').addEventListener('click', async function () {
      try {
        const d = await api('/api/browser/log');
        const obs = (d.observations || []).map(function (x) { return { at: x.at, kind: '观察', url: x.url }; });
        const acts = (d.actions || []).map(function (x) { return { at: x.at, kind: '操作', url: x.action }; });
        const lines = obs.concat(acts);
        if (!lines.length) { toast('暂无审计记录'); return; }
        const html = lines.slice(-40).reverse().map(function (x) {
          return '<div class="blog-row"><span class="blog-at">' + esc(x.at) + '</span>' +
            '<span class="blog-kind">' + esc(x.kind) + '</span>' +
            '<span class="blog-url">' + esc(x.url || '') + '</span></div>';
        }).join('');
        const box = document.createElement('div');
        box.className = 'browser-log-pop';
        box.innerHTML = '<div class="browser-log-head">📜 浏览器审计日志（本地 · ' + lines.length + ' 条）</div>' + html;
        document.body.appendChild(box);
        box.addEventListener('click', function () { box.remove(); });
      } catch (e) { toast('读取日志失败：' + e.message); }
    });
  }

  // 暴露给 ui.js 的 switchView 钩子
  window.initBrowserView = initBrowserView;
  if (document.readyState !== 'loading') {
    const active = document.querySelector('.page-view.browser-view.active') ||
      document.querySelector('.sidebar-icon[data-nav="browser"].active');
    if (active) initBrowserView();
  }
})();
