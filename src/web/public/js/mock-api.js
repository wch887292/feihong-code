/**
 * 飞虹 Code - 安卓版 Mock API 层 (mock-api.js)
 *
 * 在 Android WebView 中无本地 Node.js 后端时提供离线演示数据。
 * 通过拦截 window.fetch 对 /api/ 请求返回本地模拟数据，保证 UI 完整可用。
 *
 * 模式：
 *  - 默认：本地 Mock 模式（离线演示）
 *  - 可在设置中填写服务器地址切换为远程模式（真实调用后端）
 *
 * 此文件在 api.js 之前加载，必须在最顶部定义，保证 window.fetch 被优先拦截。
 */
(function () {
  if (window.__feihongMockInstalled) return;
  window.__feihongMockInstalled = true;

  // ========== 远程服务器配置 ==========
  var REMOTE_KEY = 'fhcode.remote.base';
  function getRemoteBase() {
    try { return localStorage.getItem(REMOTE_KEY) || ''; } catch (e) { return ''; }
  }

  // ========== Mock 数据 ==========
  var MODELS = [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek', reasoning: false, enabled: true },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek', reasoning: true, enabled: true },
    { id: 'qwen-max', name: '通义千问 Max', provider: 'qwen', reasoning: false, enabled: true },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', reasoning: false, enabled: true }
  ];

  var SKILLS = [
    { id: 'code-review', name: '代码审查', desc: '自动审查代码质量与安全', enabled: true },
    { id: 'test-gen', name: '测试生成', desc: '自动生成单元测试用例', enabled: true },
    { id: 'doc-gen', name: '文档生成', desc: '自动生成 API 文档', enabled: true },
    { id: 'refactor', name: '重构专家', desc: '代码重构与优化', enabled: true },
    { id: 'bug-hunt', name: 'Bug 猎手', desc: '自动定位与修复 Bug', enabled: true }
  ];

  var OFFICE_CAPS = [
    { title: '生成周报', icon: '📊', prompt: '帮我生成一份本周工作周报', desc: '自动生成结构化周报' },
    { title: '写邮件', icon: '✉️', prompt: '帮我写一封商务邮件', desc: '专业邮件撰写' },
    { title: 'PPT 大纲', icon: '📑', prompt: '帮我生成一份 PPT 大纲', desc: '结构化演示大纲' },
    { title: '会议纪要', icon: '📝', prompt: '帮我整理会议纪要', desc: '智能会议纪要' },
    { title: '数据分析', icon: '📈', prompt: '帮我分析这份数据', desc: '数据洞察分析' },
    { title: '翻译文档', icon: '🌐', prompt: '帮我翻译这段内容', desc: '中英互译' }
  ];

  var ROLES = [
    { id: 'architect', name: '架构师', icon: '🏛️', desc: '系统设计、技术选型' },
    { id: 'developer', name: '开发者', icon: '💻', desc: '代码实现' },
    { id: 'tester', name: '测试工程师', icon: '🧪', desc: '测试用例设计' },
    { id: 'reviewer', name: '评审员', icon: '🔍', desc: '代码审查' }
  ];

  var CUSTOM_AGENTS = [
    { id: 'builtin-代码审查员', name: '代码审查员', category: 'review', desc: '专业代码审查，安全漏洞/性能/最佳实践', useCount: 12 },
    { id: 'builtin-测试工程师', name: '测试工程师', category: 'testing', desc: '自动生成测试用例', useCount: 8 },
    { id: 'builtin-文档生成器', name: '文档生成器', category: 'documentation', desc: '自动生成代码文档', useCount: 6 },
    { id: 'builtin-重构专家', name: '重构专家', category: 'refactoring', desc: '代码重构优化', useCount: 9 },
    { id: 'builtin-Bug猎手', name: 'Bug 猎手', category: 'debugging', desc: 'Bug 分析和修复', useCount: 15 }
  ];

  // ========== Mock 路由处理 ==========
  function handleMock(path, method, body) {
    var p = path.split('?')[0];
    var lower = p.toLowerCase();

    // 健康检查
    if (lower === '/api/health') {
      return ok({ product: '飞虹 Code', version: '7.0.0', enterprise: true, signature: '安卓版 · 离线演示模式', mode: 'mock', time: new Date().toISOString() });
    }

    // 模型
    if (lower === '/api/models' && method === 'GET') return ok({ models: MODELS });
    if (lower === '/api/models' && method === 'POST') {
      var m = body || {};
      MODELS.push({ id: 'custom-' + Date.now(), name: m.name || '自定义模型', provider: 'custom', reasoning: !!m.reasoning, enabled: true });
      return ok({ model: MODELS[MODELS.length - 1] });
    }

    // 技能
    if (lower === '/api/skills/installed') return ok({ skills: SKILLS });
    if (lower === '/api/skills' ) return ok({ skills: SKILLS });

    // 办公能力
    if (lower === '/api/office/capabilities') return ok({ capabilities: OFFICE_CAPS });

    // 多智能体角色
    if (lower === '/api/multi-agent/roles') return ok({ roles: ROLES });
    if (lower === '/api/multi-agent/run') {
      var goal = (body && body.goal) || '完成任务';
      return ok({
        goal: goal,
        rounds: [
          { role: '架构师', output: '设计方案：采用模块化架构，定义清晰接口边界。\n- 技术选型：TypeScript + 分层设计\n- 接口定义：RESTful API\n- 错误处理：统一异常捕获', score: 85 },
          { role: '开发者', output: '代码实现：完成核心模块开发。\n- 实现业务逻辑\n- 编写单元测试\n- 补充类型定义', score: 88 }
        ],
        finalVerdict: '通过',
        qualityScore: 86,
        issues: []
      });
    }

    // 自定义 Agent
    if (lower === '/api/custom-agents') return ok({ agents: CUSTOM_AGENTS });
    if (lower.indexOf('/api/custom-agents/match') === 0) {
      var inp = (body && body.input) || '';
      var matched = CUSTOM_AGENTS.filter(function (a) {
        return !inp || a.name.indexOf(inp) !== -1 || a.desc.indexOf(inp) !== -1;
      }).slice(0, 3);
      return ok({ agents: matched });
    }
    if (lower.indexOf('/api/custom-agents/') === 0 && method === 'GET') {
      var id = p.split('/').pop();
      var agent = CUSTOM_AGENTS.find(function (a) { return a.id === id; });
      return ok({ agent: agent || CUSTOM_AGENTS[0] });
    }

    // 事件驱动
    if (lower === '/api/event-driven/config') return ok({ config: { enabled: true, tasks: [] } });
    if (lower === '/api/event-driven/events') return ok({ events: [] });
    if (lower === '/api/event-driven/cron') return ok({ tasks: [] });

    // 记忆
    if (lower === '/api/memory/history') return ok({ history: [] });
    if (lower === '/api/memory/long') return ok({ content: '这是长期记忆区域。在安卓离线演示模式下，长期记忆功能暂未启用。\n\n连接远程服务器后，将自动同步您的记忆数据。' });
    if (lower === '/api/memory/short') return ok({ content: '当天暂无记录' });
    if (lower === '/api/memory/stats') return ok({ shortTermFiles: 0, longTermNotes: 0, lastSummarize: '暂无' });

    // 补全
    if (lower.indexOf('/api/completion') === 0) {
      return ok({
        completions: [
          { text: 'async function handleRequest(req, res) {\n  try {\n    const data = await fetchData(req.params.id);\n    res.json({ ok: true, data });\n  } catch (e) {\n    res.status(500).json({ ok: false, error: e.message });\n  }\n}', score: 0.95 },
          { text: 'function validate(input) {\n  if (!input) throw new Error("input is required");\n  return input.trim();\n}', score: 0.88 }
        ]
      });
    }

    // 会话 / 统计
    if (lower === '/api/sessions') return ok({ sessions: [] });
    if (lower.indexOf('/api/team') === 0) {
      if (method === 'GET') return ok({ members: [], tasks: [] });
      return ok({ ok: true });
    }
    if (lower.indexOf('/api/git') === 0) {
      if (method === 'GET') return ok({ branches: [], status: { clean: true }, commits: [] });
      return ok({ ok: true });
    }
    if (lower.indexOf('/api/design-to-code') === 0) {
      return ok({ ok: true, html: '<!-- 安卓演示模式：设计稿转代码需连接远程服务器 -->' });
    }
    if (lower.indexOf('/api/solo') === 0) {
      return ok({ ok: true, status: 'idle' });
    }
    if (lower.indexOf('/api/mcp') === 0) {
      return ok({ servers: [] });
    }

    // 登录/认证
    if (lower === '/api/auth/login' || lower === '/api/login') {
      return ok({ token: 'mock-token-' + Date.now(), user: { name: '演示用户', role: 'admin' } });
    }

    // 对话 / Agent 执行
    if (lower.indexOf('/api/chat') === 0 || lower.indexOf('/api/agent') === 0 || lower.indexOf('/api/task') === 0) {
      var prompt = (body && (body.prompt || body.message || body.goal || body.input)) || '任务';
      return ok({
        id: 'mock-' + Date.now(),
        answer: '【安卓离线演示】\n\n已收到任务：' + prompt + '\n\n当前处于离线演示模式，AI 生成能力需要连接远程飞虹 Code 服务器。\n\n在「设置」中填写服务器地址后，即可使用完整 AI 能力（多模型路由、Agent 执行、代码补全等）。',
        done: true
      });
    }

    // 配置
    if (lower === '/api/config' || lower === '/api/settings') {
      return ok({ config: { mode: 'mock', remoteBase: getRemoteBase(), version: '7.0.0' } });
    }

    // 兜底：GET 返回空结构，其他返回 ok
    if (method === 'GET') return ok({ ok: true, data: [] });
    return ok({ ok: true, data: [] });
  }

  function ok(data) {
    return {
      ok: true,
      status: 200,
      json: function () { return Promise.resolve(data); },
      text: function () { return Promise.resolve(JSON.stringify(data)); }
    };
  }

  // ========== 拦截 fetch ==========
  var originalFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

    // 远程模式：配置了服务器地址且请求的是 /api/ 相对路径时，转发到远程
    var remoteBase = getRemoteBase();
    if (remoteBase && url.indexOf('/api/') === 0) {
      var remoteUrl = remoteBase.replace(/\/$/, '') + url;
      return originalFetch.call(window, remoteUrl, init).catch(function (e) {
        // 远程失败时降级到 Mock
        return Promise.resolve(handleMock(url, method, parseBody(init)));
      });
    }

    // Mock 模式：拦截 /api/ 请求
    if (url.indexOf('/api/') === 0) {
      return Promise.resolve(handleMock(url, method, parseBody(init)));
    }

    // 其他请求（静态资源等）正常处理
    return originalFetch.apply(window, arguments);
  };

  function parseBody(init) {
    if (!init || !init.body) return null;
    try { return JSON.parse(init.body); } catch (e) { return null; }
  }

  // ========== 暴露远程模式切换接口 ==========
  window.FeiHongApp = window.FeiHongApp || {};
  window.FeiHongApp.setRemote = function (base) {
    try { localStorage.setItem(REMOTE_KEY, base || ''); } catch (e) {}
    return base;
  };
  window.FeiHongApp.getRemote = function () { return getRemoteBase(); };
  window.FeiHongApp.isMock = function () { return !getRemoteBase(); };

  console.log('[MockAPI] 飞虹 Code 安卓离线 Mock 层已加载 (mode=' + (getRemoteBase() ? 'remote' : 'mock') + ')');
})();
