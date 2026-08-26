/**
 * 飞虹 Code - Monaco Editor 封装模块
 * VSCode 同款编辑器内核，提供语法高亮、智能补全、内联 ghost text 等能力
 *
 * 依赖：index.html 中已加载 vendor/monaco/vs/loader.js（AMD loader）
 */
(function (global) {
  'use strict';

  let monacoInstance = null;
  let initPromise = null;
  const editors = new Map(); // containerId -> editor instance
  let inlineCompletionProvider = null;
  let completionItemProvider = null;

  /** 根据文件扩展名推断 Monaco language id */
  function detectLanguage(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const map = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      json: 'json', md: 'markdown', html: 'html', css: 'css', scss: 'scss',
      less: 'less', py: 'python', java: 'java', c: 'c', cpp: 'cpp', h: 'cpp',
      cs: 'csharp', go: 'go', rs: 'rust', php: 'php', rb: 'ruby', swift: 'swift',
      kt: 'kotlin', scala: 'scala', sh: 'shell', bash: 'shell', zsh: 'shell',
      sql: 'sql', yaml: 'yaml', yml: 'yaml', xml: 'xml', vue: 'html', svelte: 'html',
      proto: 'protobuf', dockerfile: 'dockerfile', toml: 'ini', ini: 'ini',
    };
    if (filePath.toLowerCase().endsWith('dockerfile')) return 'dockerfile';
    return map[ext] || 'plaintext';
  }

  /** 初始化 Monaco（只执行一次，返回 Promise） */
  function initMonaco() {
    if (monacoInstance) return Promise.resolve(monacoInstance);
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve, reject) => {
      if (typeof global.require === 'undefined') {
        reject(new Error('Monaco loader.js 未加载，请检查 vendor/monaco/vs/loader.js'));
        return;
      }
      global.require.config({ paths: { vs: 'vendor/monaco/vs' } });
      global.require(['vs/editor/editor.main'], function () {
        monacoInstance = global.monaco;
        // 配置默认主题（跟随系统深色/浅色）
        const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        monacoInstance.editor.setTheme(isDark ? 'vs-dark' : 'vs');
        resolve(monacoInstance);
      }, reject);
    });
    return initPromise;
  }

  /**
   * 在指定容器中创建 Monaco 编辑器
   * @param {HTMLElement|string} container - 容器元素或 ID
   * @param {string} value - 初始内容
   * @param {string} filePath - 文件路径（用于推断语言）
   * @param {object} options - 额外选项
   * @returns {Promise<monaco.editor.IStandaloneCodeEditor>}
   */
  async function createEditor(container, value, filePath, options = {}) {
    const monaco = await initMonaco();
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) throw new Error('编辑器容器不存在: ' + container);

    // 如果该容器已有编辑器，先销毁
    const existing = editors.get(el.id || container);
    if (existing) {
      existing.dispose();
      editors.delete(el.id || container);
    }

    const language = detectLanguage(filePath);
    const editor = monaco.editor.create(el, {
      value: value || '',
      language: language,
      theme: undefined, // 使用全局主题
      automaticLayout: true,
      fontSize: 13,
      lineNumbers: 'on',
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      tabSize: 2,
      renderWhitespace: 'selection',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      // P0-1: 启用内联补全（ghost text，Tab 接受）
      inlineSuggest: { enabled: true, showToolbar: 'always' },
      // 启用快速建议（输入时自动触发补全弹窗）
      quickSuggestions: { other: true, comments: false, strings: true },
      quickSuggestionsDelay: 200,
      ...options,
    });

    const key = el.id || container;
    editors.set(key, editor);
    return editor;
  }

  /** 获取编辑器实例 */
  function getEditor(container) {
    const key = typeof container === 'string' ? container : container.id;
    return editors.get(key);
  }

  /** 销毁编辑器 */
  function disposeEditor(container) {
    const key = typeof container === 'string' ? container : container.id;
    const editor = editors.get(key);
    if (editor) {
      editor.dispose();
      editors.delete(key);
    }
  }

  /**
   * 注册内联补全 Provider（ghost text，Tab 接受）
   * @param {function} fetchFn - 异步补全函数，参数 {filePath, content, offset}，返回 {text: string}
   */
  function registerInlineCompletions(fetchFn) {
    initMonaco().then((monaco) => {
      if (inlineCompletionProvider) {
        inlineCompletionProvider.dispose();
      }
      inlineCompletionProvider = monaco.languages.registerInlineCompletionsProvider('*', {
        provideInlineCompletions: async function (model, position, context, token) {
          try {
            const filePath = model.uri.path || 'untitled';
            const content = model.getValue();
            const offset = model.getOffsetAt(position);
            const result = await fetchFn({ filePath, content, offset, token });
            if (!result || !result.text) return { items: [] };
            const item = {
              range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
              insertText: result.text,
              filterText: result.text.slice(0, 20),
            };
            return { items: [item] };
          } catch (e) {
            return { items: [] };
          }
        },
        freeInlineCompletions: function () {},
      });
    });
  }

  /**
   * 注册补全项 Provider（Ctrl+Space 触发弹窗，↑↓选择，Enter接受）
   * @param {function} fetchFn - 异步补全函数，参数 {filePath, content, offset, prefix}，返回数组 [{label, kind, insertText, detail}]
   */
  function registerCompletionItems(fetchFn) {
    initMonaco().then((monaco) => {
      if (completionItemProvider) {
        completionItemProvider.dispose();
      }
      completionItemProvider = monaco.languages.registerCompletionItemProvider('*', {
        triggerCharacters: ['.', '(', ',', ' '],
        provideCompletionItems: async function (model, position, context, token) {
          try {
            const filePath = model.uri.path || 'untitled';
            const content = model.getValue();
            const offset = model.getOffsetAt(position);
            const word = model.getWordUntilPosition(position);
            const prefix = word.word || '';
            const suggestions = await fetchFn({ filePath, content, offset, prefix, token });
            if (!Array.isArray(suggestions) || !suggestions.length) return { suggestions: [] };
            const range = new monaco.Range(
              position.lineNumber, word.startColumn,
              position.lineNumber, position.column
            );
            return {
              suggestions: suggestions.map((s) => ({
                label: s.label || s.insertText || '',
                kind: monaco.languages.CompletionItemKind[s.kind] || monaco.languages.CompletionItemKind.Text,
                insertText: s.insertText || '',
                detail: s.detail || '',
                range: range,
              })),
            };
          } catch (e) {
            return { suggestions: [] };
          }
        },
      });
    });
  }

  /** 暴露全局 API */
  global.FHMonaco = {
    init: initMonaco,
    createEditor: createEditor,
    getEditor: getEditor,
    disposeEditor: disposeEditor,
    detectLanguage: detectLanguage,
    registerInlineCompletions: registerInlineCompletions,
    registerCompletionItems: registerCompletionItems,
  };
})(window);
