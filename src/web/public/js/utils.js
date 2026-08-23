/**
 * 工具函数模块：纯函数，无状态依赖，可被任意模块调用
 */

    function formatMarkdown(text) {
      // 简单 Markdown 转换
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
    }

    function getDirectoryName(path) {
      if (!path || path === '' || path === '/') return '/';
      if (/^[A-Za-z]:$/.test(path)) return path + '\\';
      if (/^[A-Za-z]:\\$/.test(path)) return path;
      const parts = path.split(/[/\\]/).filter(Boolean);
      if (parts.length <= 1) {
        const driveMatch = parts[0].match(/^([A-Za-z]):$/);
        if (driveMatch) return driveMatch[1] + ':\\';
        return parts[0] || '/';
      }
      const parentParts = parts.slice(0, -1);
      if (/^[A-Za-z]:$/.test(parentParts[0])) {
        return parentParts[0] + '\\' + parentParts.slice(1).join('\\');
      }
      return parentParts.join('\\');
    }

    /** 渲染空状态提示，减少重复的 innerHTML 赋值代码 */
    function renderEmpty(el, text) {
      if (el) el.innerHTML = '<div class="empty">' + (text || '') + '</div>';
    }

    function extractUrl(text) {
      if (!text) return '';
      const m = text.match(/(https?:\/\/[^\s]+)/);
      return m ? m[1] : '';
    }

    function linkifyArtifacts(text) {
      let html = escapeHtml(text);
      // 占位符保护：先提取已识别的片段，避免后续正则把已插入的 <span> 标签二次包裹
      const tokens = [];
      const protect = (s) => { const k = '\u0000TOK' + tokens.length + '\u0000'; tokens.push(s); return k; };
      // 1) URL：排除结尾标点与 HTML 实体
      html = html.replace(/(https?:\/\/[^\s<>"'()]+)/g, (m) => protect('<span class="artifact" data-kind="url" data-path="' + m + '">' + m + '</span>'));
      // 2) Windows 绝对路径（支持正/反斜杠、中文、空格，排除结尾标点）
      html = html.replace(/([A-Za-z]:[\\\/][^\s<>"'()]+?)(?=[\s<>"'，。；：、)）]|$)/g, (m) => protect('<span class="artifact" data-kind="file" data-path="' + m + '">' + m + '</span>'));
      // 3) Unix 风格绝对路径（至少两级目录，避免误匹配 "2023/2024"、"a/b" 等相对写法）
      html = html.replace(/(\/(?:[A-Za-z0-9_\-.]+\/){1,}[A-Za-z0-9_\-.]*)/g, (m) => protect('<span class="artifact" data-kind="file" data-path="' + m + '">' + m + '</span>'));
      tokens.forEach((s, i) => { html = html.split('\u0000TOK' + i + '\u0000').join(s); });
      return html;
    }

    function formatSize(n) {
      if (!Number.isFinite(n)) return '';
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      return (n / 1024 / 1024).toFixed(2) + ' MB';
    }

    function estimateDataUrlSize(dataUrl) {
      // base64 长度 × 0.75 估算字节
      const b64 = (dataUrl || '').split(',')[1] || '';
      return Math.round(b64.length * 0.75);
    }

    function formatToolArgs(args) {
      if (!args || typeof args !== 'object') return '';
      const keys = Object.keys(args);
      if (!keys.length) return '';
      const rows = keys.map(function (k) {
        let v = args[k];
        if (v == null) v = '';
        else if (typeof v === 'object') v = JSON.stringify(v);
        return '<div><span style="color:var(--ink-2,#6b7280);">' + escapeHtml(k) + ':</span> ' + escapeHtml(String(v)) + '</div>';
      });
      return '<div class="tc-args">' + rows.join('') + '</div>';
    }

    function renderMarkdown(text) {
      let html = escapeHtml(text == null ? '' : text);
      const codeBlocks = [];
      html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
        const idx = codeBlocks.length;
        codeBlocks.push('<pre style="background:var(--bg,#f5f6fa);padding:10px;border-radius:8px;overflow-x:auto;font-size:12px;margin:6px 0;white-space:pre-wrap;word-break:break-word;"><code>' + code + '</code></pre>');
        return '\x00CB' + idx + '\x00';
      });
      html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg,#f5f6fa);padding:1px 5px;border-radius:4px;font-size:12px;">$1</code>');
      html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      html = html.replace(/^### (.*)$/gm, '<div style="font-weight:700;margin:8px 0 4px;">$1</div>');
      html = html.replace(/^## (.*)$/gm, '<div style="font-weight:700;font-size:15px;margin:10px 0 4px;">$1</div>');
      html = html.replace(/^# (.*)$/gm, '<div style="font-weight:700;font-size:16px;margin:10px 0 4px;">$1</div>');
      html = html.replace(/^[-*] (.*)$/gm, '<div style="padding-left:14px;">• $1</div>');
      html = html.replace(/^(\d+)\. (.*)$/gm, '<div style="padding-left:20px;">$1. $2</div>');
      html = html.replace(/(https?:\/\/[^\s<>"'()]+)/g, '<a href="$1" style="color:var(--brand,#4f6ef7);text-decoration:underline;" target="_blank">$1</a>');
      html = html.replace(/\n/g, '<br>');
      html = html.replace(/\x00CB(\d+)\x00/g, function (_, idx) { return codeBlocks[parseInt(idx)]; });
      return html;
    }

    function statusBadge(s) { return '<span class="badge ' + s + '">' + s + '</span>'; }

    function closeModal(id) { document.getElementById(id).classList.remove('show'); }

    function openModal(id) { document.getElementById(id).classList.add('show'); }

    function toast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg; el.classList.add('show');
      clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2200);
    }

    function fmtTime(iso) { try { return new Date(iso).toLocaleString(); } catch { return iso || ''; } }

    function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    function applyI18nToEl(el) {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const dict = I18N[currentLang] || I18N.zh;
      const tag = el.tagName;

      // 1) 输入类控件：只处理 placeholder，用 ph.<id> 专用键；缺失则保留中文原文
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (el._i18nPhZh === undefined) el._i18nPhZh = el.getAttribute('placeholder') || '';
        const phKey = 'ph.' + (el.id || '');
        if (dict[phKey] != null) el.placeholder = dict[phKey];
        else el.placeholder = el._i18nPhZh;
        return;
      }

      // 2) <select>：只翻 title，内容交给 renderModelSelect 等渲染函数管理
      if (tag === 'SELECT') {
        if (el._i18nTitleZh === undefined) el._i18nTitleZh = el.getAttribute('title') || '';
        const tiKey = 'title.' + (el.id || '');
        if (dict[tiKey] != null) el.title = dict[tiKey];
        else el.title = el._i18nTitleZh;
        return;
      }

      // 3) 含元素子节点：保留子元素，只替换 title 与直接文本节点
      if (el.firstElementChild) {
        if (el.hasAttribute('title')) el.title = t(key);
        let done = false;
        el.childNodes.forEach((node) => {
          if (node.nodeType === 3 && node.nodeValue.trim()) {
            node.nodeValue = done ? '' : t(key);
            done = true;
          }
        });
        return;
      }

      // 4) 纯文本元素：直接覆盖
      el.textContent = t(key);
    }

    function t(key) {
      const dict = I18N[currentLang] || I18N.zh;
      return dict[key] || key;
    }
