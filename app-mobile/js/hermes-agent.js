/* ============================================================
 * 飞虹 Code — Hermes Agent 核心模块
 * 参照 Nous Research Hermes Agent 架构
 *  - MemoryManager: 持久记忆（MEMORY.md / USER.md / 自动摘要）
 *  - SkillManager: 自演化技能系统（兼容 agentskills.io）
 *  - Scheduler: 自然语言自动化调度
 *  - ToolRegistry: 工具集（TTS/搜索/文件/文生图）
 *  - AgentCore: 统一 Agent 执行循环
 * ============================================================ */

/* ============================================================
 * 1. MemoryManager — 持久记忆系统
 * ============================================================ */
var MemoryManager = (function () {
  var LS_MEMORY = 'fh.hermes.memory.md';
  var LS_USER = 'fh.hermes.user.md';
  var LS_HISTORY = 'fh.hermes.history';
  var LS_CONTEXTS = 'fh.hermes.contexts';

  var memory = { content: '', updatedAt: 0 };
  var user = { content: '', updatedAt: 0 };
  var history = [];       // 历史任务摘要
  var contexts = {};      // 项目上下文

  function load() {
    try {
      var m = localStorage.getItem(LS_MEMORY);
      if (m) memory = JSON.parse(m);
      var u = localStorage.getItem(LS_USER);
      if (u) user = JSON.parse(u);
      var h = localStorage.getItem(LS_HISTORY);
      if (h) history = JSON.parse(h);
      var c = localStorage.getItem(LS_CONTEXTS);
      if (c) contexts = JSON.parse(c);
    } catch (e) { initDefaults(); }
    if (!memory.content) initDefaults();
  }

  function initDefaults() {
    memory = {
      content: '# MEMORY.md — 飞虹 Agent 持久记忆\n\n' +
        '## 项目上下文\n- 当前项目：飞虹 Code 移动端 APP\n' +
        '- 技术栈：纯前端 + Capacitor 打包 Android\n' +
        '- 核心能力：对话/游戏/创作/免密网络层\n\n' +
        '## 长期记忆\n（自动沉淀中…）\n\n' +
        '## 关键事实\n（从对话中自动提取）\n',
      updatedAt: Date.now()
    };
    user = {
      content: '# USER.md — 用户画像\n\n' +
        '## 基本偏好\n- 语言：中文\n' +
        '- 风格：直接、高效、可落地\n\n' +
        '## 使用习惯\n（从交互中自动学习）\n\n' +
        '## 专业领域\n（逐步识别）\n',
      updatedAt: Date.now()
    };
    history = [];
    contexts = {};
    save();
  }

  function save() {
    try {
      localStorage.setItem(LS_MEMORY, JSON.stringify(memory));
      localStorage.setItem(LS_USER, JSON.stringify(user));
      localStorage.setItem(LS_HISTORY, JSON.stringify(history.slice(-100)));
      localStorage.setItem(LS_CONTEXTS, JSON.stringify(contexts));
    } catch (e) { /* 存储满时忽略 */ }
  }

  /* 获取记忆注入提示词（拼接到系统提示中） */
  function getContextPrompt() {
    var prompt = '## 系统记忆（你拥有持久记忆，以下是之前沉淀的信息）\n\n';
    prompt += '### 项目上下文\n' + extractSection(memory.content, '项目上下文') + '\n\n';
    prompt += '### 用户偏好\n' + extractSection(user.content, '基本偏好') + '\n';
    prompt += extractSection(user.content, '使用习惯') + '\n\n';
    if (history.length) {
      prompt += '### 最近任务（' + history.length + '条）\n';
      history.slice(-5).forEach(function (h) {
        prompt += '- [' + new Date(h.time).toLocaleDateString() + '] ' + h.summary.slice(0, 60) + '\n';
      });
    }
    prompt += '\n请利用以上记忆提供更个性化的回答。如果用户提到之前的内容，主动回忆。\n\n';
    return prompt;
  }

  function extractSection(content, title) {
    var re = new RegExp('##+\\s*' + title + '[\\s\\S]*?(?=##+|$)', 'i');
    var m = content.match(re);
    return m ? m[0].replace(/^##+\s*.*/, '').trim() : '（暂无）';
  }

  /* 自动摘要对话并沉淀到记忆 */
  function digestConversation(messages, taskType) {
    if (!messages || !messages.length) return;
    var userMsgs = messages.filter(function (m) { return m.role === 'user'; });
    var assistantMsgs = messages.filter(function (m) { return m.role === 'assistant'; });
    if (!userMsgs.length) return;

    var summary = userMsgs[userMsgs.length - 1].content.slice(0, 80);
    var record = {
      time: Date.now(),
      type: taskType || 'chat',
      summary: summary,
      msgCount: messages.length
    };
    history.push(record);

    // 提取关键事实到 MEMORY.md
    var keyFacts = extractKeyFacts(messages);
    if (keyFacts.length) {
      appendToSection('关键事实', keyFacts);
    }

    // 提取用户偏好到 USER.md
    var prefs = extractUserPreferences(messages);
    if (prefs.length) {
      appendToSection('使用习惯', prefs, true);
    }

    save();
  }

  function extractKeyFacts(messages) {
    var facts = [];
    var text = messages.map(function (m) { return m.content; }).join(' ');
    // 简单规则提取：项目名、技术栈、版本号、关键决策
    var patterns = [
      /(项目|产品|APP)叫?\s*([^\s，。！？]{2,20})/g,
      /(版本|v)(\d+\.\d+\.\d+)/g,
      /(用|使用|基于)\s*([^\s，。！？]{2,15})\s*(开发|构建|打包)/g
    ];
    patterns.forEach(function (re) {
      var m;
      while ((m = re.exec(text)) !== null) {
        var fact = m[0].trim();
        if (fact.length > 5 && facts.indexOf(fact) < 0) facts.push(fact);
      }
    });
    return facts.slice(0, 3);
  }

  function extractUserPreferences(messages) {
    var prefs = [];
    var text = messages.map(function (m) { return m.content; }).join(' ');
    if (/我喜欢|我偏好|我习惯|我倾向/.test(text)) {
      var m = text.match(/(我喜欢|我偏好|我习惯|我倾向)[^，。！？\n]{2,40}/g);
      if (m) prefs = m.slice(0, 3);
    }
    if (/不要|别|禁止/.test(text) && /每次|总是|以后/.test(text)) {
      var m2 = text.match(/(不要|别|禁止)[^，。！？\n]{2,30}/g);
      if (m2) prefs = prefs.concat(m2.slice(0, 2));
    }
    return prefs;
  }

  function appendToSection(section, items, isUser) {
    var target = isUser ? user : memory;
    var lines = items.map(function (item) { return '- ' + item; }).join('\n');
    var re = new RegExp('(##+\\s*' + section + '[\\s\\S]*?)(?=##+|$)');
    if (re.test(target.content)) {
      target.content = target.content.replace(re, '$1\n' + lines + '\n');
    } else {
      target.content += '\n## ' + section + '\n' + lines + '\n';
    }
    target.updatedAt = Date.now();
  }

  /* 回忆：根据查询检索历史记忆 */
  function recall(query, limit) {
    limit = limit || 5;
    var results = [];
    var q = (query || '').toLowerCase();
    var keywords = q.split(/\s+/).filter(function (w) { return w.length > 1; });

    // 搜索历史任务
    history.forEach(function (h) {
      var score = 0;
      var text = h.summary.toLowerCase();
      keywords.forEach(function (kw) { if (text.indexOf(kw) >= 0) score += 10; });
      if (score > 0) results.push({ type: 'history', item: h, score: score });
    });

    // 搜索 MEMORY.md
    var memText = memory.content.toLowerCase();
    keywords.forEach(function (kw) {
      if (memText.indexOf(kw) >= 0) results.push({ type: 'memory', score: 5 });
    });

    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, limit);
  }

  /* 获取 MEMORY.md / USER.md 内容 */
  function getMemoryMD() { return memory.content; }
  function getUserMD() { return user.content; }
  function getHistory() { return history; }

  /* 手动更新记忆文件 */
  function updateMemoryMD(content) { memory.content = content; memory.updatedAt = Date.now(); save(); }
  function updateUserMD(content) { user.content = content; user.updatedAt = Date.now(); save(); }

  /* 项目上下文管理 */
  function setContext(key, value) { contexts[key] = { value: value, time: Date.now() }; save(); }
  function getContext(key) { return contexts[key] ? contexts[key].value : null; }
  function getAllContexts() { return contexts; }

  return {
    load: load,
    save: save,
    getContextPrompt: getContextPrompt,
    digestConversation: digestConversation,
    recall: recall,
    getMemoryMD: getMemoryMD,
    getUserMD: getUserMD,
    getHistory: getHistory,
    updateMemoryMD: updateMemoryMD,
    updateUserMD: updateUserMD,
    setContext: setContext,
    getContext: getContext,
    getAllContexts: getAllContexts
  };
})();

/* ============================================================
 * 2. SkillManager — 自演化技能系统（兼容 agentskills.io）
 * ============================================================ */
var SkillManager = (function () {
  var LS_SKILLS = 'fh.hermes.skills';
  var skills = [];

  /* agentskills.io 标准格式：
   * { id, name, description, trigger, prompt, tools, tags, version, createdAt, useCount }
   */
  function load() {
    try {
      var raw = localStorage.getItem(LS_SKILLS);
      if (raw) skills = JSON.parse(raw);
    } catch (e) { skills = []; }
    if (!skills.length) initBuiltinSkills();
  }

  function initBuiltinSkills() {
    skills = [
      {
        id: 'skill-summarize',
        name: '内容摘要',
        description: '对长文本/文章/对话进行结构化摘要',
        trigger: '摘要|总结|概括|提炼',
        prompt: '请对以下内容进行结构化摘要，分点列出核心要点：\n\n{{content}}',
        tools: [],
        tags: ['文本处理', '效率'],
        version: '1.0.0',
        createdAt: Date.now(),
        useCount: 0,
        builtin: true
      },
      {
        id: 'skill-translate',
        name: '中英互译',
        description: '中英文双向翻译，保持专业术语准确',
        trigger: '翻译|translate|英文|中文',
        prompt: '请将以下内容翻译为{{target_lang}}，保持专业术语准确、语气自然：\n\n{{content}}',
        tools: [],
        tags: ['翻译', '语言'],
        version: '1.0.0',
        createdAt: Date.now(),
        useCount: 0,
        builtin: true
      },
      {
        id: 'skill-code-review',
        name: '代码审查',
        description: '对代码进行安全性、性能、规范审查',
        trigger: '代码审查|code review|审查代码|检查代码',
        prompt: '请对以下代码进行审查，从安全性、性能、代码规范三个维度列出问题和改进建议：\n\n```\n{{content}}\n```',
        tools: [],
        tags: ['开发', '代码'],
        version: '1.0.0',
        createdAt: Date.now(),
        useCount: 0,
        builtin: true
      },
      {
        id: 'skill-xiaohongshu',
        name: '小红书文案',
        description: '生成小红书风格种草文案，含emoji和话题标签',
        trigger: '小红书|种草文案|小红书文案',
        prompt: '请生成一篇小红书风格的种草文案，要求：1.标题吸引眼球 2.正文含emoji 3.分点描述 4.结尾加话题标签\n\n主题：{{content}}',
        tools: [],
        tags: ['营销', '文案'],
        version: '1.0.0',
        createdAt: Date.now(),
        useCount: 0,
        builtin: true
      }
    ];
    save();
  }

  function save() {
    try { localStorage.setItem(LS_SKILLS, JSON.stringify(skills)); } catch (e) {}
  }

  /* 匹配技能：根据输入文本找到最相关的技能 */
  function match(input) {
    if (!input) return null;
    var text = input.toLowerCase();
    var best = null, bestScore = 0;
    skills.forEach(function (s) {
      var score = 0;
      if (s.trigger) {
        var triggers = s.trigger.split('|');
        triggers.forEach(function (t) {
          if (text.indexOf(t.trim().toLowerCase()) >= 0) score += 20;
        });
      }
      if (s.name && text.indexOf(s.name.toLowerCase()) >= 0) score += 15;
      if (s.description && text.indexOf(s.description.toLowerCase()) >= 0) score += 5;
      if (s.tags) {
        s.tags.forEach(function (tag) {
          if (text.indexOf(tag.toLowerCase()) >= 0) score += 8;
        });
      }
      if (score > bestScore) { bestScore = score; best = s; }
    });
    return bestScore >= 15 ? best : null;
  }

  /* 执行技能：生成完整 prompt */
  function execute(skill, content, vars) {
    if (!skill) return content;
    var prompt = skill.prompt || content;
    prompt = prompt.replace(/\{\{content\}\}/g, content);
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        prompt = prompt.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), vars[k]);
      });
    }
    skill.useCount = (skill.useCount || 0) + 1;
    save();
    return prompt;
  }

  /* 从任务中自动提炼技能 */
  function extractFromTask(messages, taskName) {
    if (!messages || messages.length < 2) return null;
    var userMsg = messages[0].content;
    var assistantMsg = messages[messages.length - 1].content;
    if (userMsg.length < 5 || assistantMsg.length < 20) return null;

    var skill = {
      id: 'skill-' + Date.now(),
      name: taskName || ('自定义技能-' + new Date().toLocaleDateString()),
      description: userMsg.slice(0, 50),
      trigger: userMsg.slice(0, 15),
      prompt: '用户需求：' + userMsg + '\n\n请按以下方式处理：\n{{content}}',
      tools: [],
      tags: ['自动提炼'],
      version: '0.1.0',
      createdAt: Date.now(),
      useCount: 0,
      autoExtracted: true
    };
    skills.push(skill);
    save();
    return skill;
  }

  /* 搜索技能 */
  function search(query) {
    if (!query) return skills;
    var q = query.toLowerCase();
    return skills.filter(function (s) {
      return (s.name + s.description + s.tags.join(' ') + s.trigger).toLowerCase().indexOf(q) >= 0;
    });
  }

  /* 安装技能（兼容 agentskills.io 格式） */
  function install(skillData) {
    if (!skillData || !skillData.name) return false;
    // 检查是否已存在
    var existing = skills.find(function (s) { return s.id === skillData.id || s.name === skillData.name; });
    if (existing) {
      Object.assign(existing, skillData);
    } else {
      skillData.id = skillData.id || ('skill-' + Date.now());
      skillData.createdAt = skillData.createdAt || Date.now();
      skillData.useCount = 0;
      skills.push(skillData);
    }
    save();
    return true;
  }

  /* 删除技能 */
  function remove(id) {
    skills = skills.filter(function (s) { return s.id !== id; });
    save();
  }

  function getAll() { return skills; }
  function getById(id) { return skills.find(function (s) { return s.id === id; }); }

  /* ========== LLM 辅助技能提炼（v7.9.1 增强） ========== */
  var modelCaller = null;

  /* 注入模型调用函数（由 app.js 注入 callModelStream） */
  function setModelCaller(caller) {
    if (typeof caller === 'function') modelCaller = caller;
  }

  /* 使用 LLM 从对话中提炼技能（比简单规则更准确） */
  function extractWithLLM(messages, taskName, callback) {
    if (!messages || messages.length < 2) {
      if (callback) callback(null, '对话不足，无法提炼');
      return null;
    }
    if (!modelCaller) {
      // 无 LLM 时回退到简单规则提炼
      var simple = extractFromTask(messages, taskName);
      if (callback) callback(simple, '已使用规则提炼（未配置LLM）');
      return simple;
    }

    var userMsg = messages[0].content;
    var assistantMsg = messages[messages.length - 1].content;
    var prompt = '请分析以下对话，提炼一个可复用的技能模板。\n\n' +
      '【用户需求】\n' + userMsg.slice(0, 500) + '\n\n' +
      '【助手回复】\n' + assistantMsg.slice(0, 500) + '\n\n' +
      '请严格按以下JSON格式输出（不要输出其他内容）：\n' +
      '{\n' +
      '  "name": "技能名称（简洁，4-8字）",\n' +
      '  "description": "技能描述（20-50字）",\n' +
      '  "trigger": "触发关键词1|关键词2|关键词3",\n' +
      '  "prompt": "技能提示词模板，用{{content}}表示用户输入",\n' +
      '  "tags": ["标签1","标签2"]\n' +
      '}';

    modelCaller(prompt, function (result) {
      try {
        // 尝试从结果中提取 JSON
        var jsonMatch = result.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          if (callback) callback(null, 'LLM返回格式无法解析');
          return;
        }
        var data = JSON.parse(jsonMatch[0]);
        if (!data.name || !data.prompt) {
          if (callback) callback(null, 'LLM返回缺少必要字段');
          return;
        }
        var skill = {
          id: 'skill-' + Date.now(),
          name: data.name,
          description: data.description || '',
          trigger: data.trigger || data.name,
          prompt: data.prompt,
          tools: data.tools || [],
          tags: data.tags || ['LLM提炼'],
          version: '0.1.0',
          createdAt: Date.now(),
          useCount: 0,
          autoExtracted: true,
          llmExtracted: true
        };
        skills.push(skill);
        save();
        if (callback) callback(skill, 'LLM提炼成功');
      } catch (e) {
        if (callback) callback(null, '解析失败: ' + e.message);
      }
    });
    return null; // 异步执行，通过 callback 返回
  }

  /* 根据用户输入建议可能需要的技能（LLM 辅助） */
  function suggestSkill(input, callback) {
    if (!input || !modelCaller) {
      // 无 LLM 时回退到简单匹配
      var matched = match(input);
      if (callback) callback(matched ? [matched] : []);
      return;
    }
    var existingNames = skills.map(function (s) { return s.name + '(' + s.trigger + ')'; }).join('、');
    var prompt = '用户输入："' + input.slice(0, 200) + '"\n\n' +
      '现有技能库：' + existingNames + '\n\n' +
      '请判断：1.现有技能中哪个最匹配（返回名称）；2.是否建议创建新技能（如是，给出名称和触发词）。\n' +
      '严格按JSON输出：{"matched":"现有技能名或null","suggestNew":true/false,"newName":"新技能名","newTrigger":"触发词"}';

    modelCaller(prompt, function (result) {
      try {
        var jsonMatch = result.match(/\{[\s\S]*\}/);
        if (!jsonMatch) { if (callback) callback([]); return; }
        var data = JSON.parse(jsonMatch[0]);
        var suggestions = [];
        if (data.matched) {
          var m = skills.find(function (s) { return s.name === data.matched; });
          if (m) suggestions.push({ type: 'existing', skill: m });
        }
        if (data.suggestNew && data.newName) {
          suggestions.push({ type: 'new', name: data.newName, trigger: data.newTrigger });
        }
        if (callback) callback(suggestions);
      } catch (e) {
        if (callback) callback([]);
      }
    });
  }

  /* 根据用户反馈改进技能（LLM 辅助） */
  function improveSkill(skillId, feedback, callback) {
    var skill = getById(skillId);
    if (!skill) { if (callback) callback(null, '技能不存在'); return; }
    if (!modelCaller) { if (callback) callback(null, '未配置LLM'); return; }

    var prompt = '当前技能：\n' +
      '名称：' + skill.name + '\n' +
      '描述：' + skill.description + '\n' +
      '触发词：' + skill.trigger + '\n' +
      '提示词模板：' + skill.prompt + '\n\n' +
      '用户反馈：' + feedback + '\n\n' +
      '请根据反馈改进技能，严格按JSON输出完整的改进后技能：\n' +
      '{"name":"","description":"","trigger":"","prompt":"","tags":[]}';

    modelCaller(prompt, function (result) {
      try {
        var jsonMatch = result.match(/\{[\s\S]*\}/);
        if (!jsonMatch) { if (callback) callback(null, 'LLM返回无法解析'); return; }
        var data = JSON.parse(jsonMatch[0]);
        if (data.name) skill.name = data.name;
        if (data.description) skill.description = data.description;
        if (data.trigger) skill.trigger = data.trigger;
        if (data.prompt) skill.prompt = data.prompt;
        if (data.tags) skill.tags = data.tags;
        skill.version = (parseFloat(skill.version || '0.1') + 0.1).toFixed(1);
        skill.improvedAt = Date.now();
        save();
        if (callback) callback(skill, '技能已改进至 v' + skill.version);
      } catch (e) {
        if (callback) callback(null, '改进失败: ' + e.message);
      }
    });
  }

  /* 批量提炼：从历史对话中批量提取技能 */
  function batchExtract(tasks, maxCount, callback) {
    if (!tasks || !tasks.length) { if (callback) callback([]); return; }
    maxCount = maxCount || 3;
    var extracted = [];
    var processed = 0;
    var toProcess = tasks.slice(0, maxCount * 2); // 多处理一些，过滤无效的

    function processNext() {
      if (processed >= toProcess.length || extracted.length >= maxCount) {
        if (callback) callback(extracted);
        return;
      }
      var task = toProcess[processed++];
      if (!task.messages || task.messages.length < 2) { processNext(); return; }
      extractWithLLM(task.messages, task.title || task.name, function (skill, msg) {
        if (skill) extracted.push(skill);
        setTimeout(processNext, 100); // 避免请求过快
      });
    }
    processNext();
  }

  return {
    load: load,
    save: save,
    match: match,
    execute: execute,
    extractFromTask: extractFromTask,
    search: search,
    install: install,
    remove: remove,
    getAll: getAll,
    getById: getById,
    setModelCaller: setModelCaller,
    extractWithLLM: extractWithLLM,
    suggestSkill: suggestSkill,
    improveSkill: improveSkill,
    batchExtract: batchExtract
  };
})();

/* ============================================================
 * 3. Scheduler — 自然语言自动化调度
 * ============================================================ */
var Scheduler = (function () {
  var LS_TASKS = 'fh.hermes.scheduled';
  var tasks = [];
  var checkTimer = null;

  function load() {
    try {
      var raw = localStorage.getItem(LS_TASKS);
      if (raw) tasks = JSON.parse(raw);
    } catch (e) { tasks = []; }
  }

  function save() {
    try { localStorage.setItem(LS_TASKS, JSON.stringify(tasks)); } catch (e) {}
  }

  /* 解析自然语言时间表达 */
  function parseTime(expression) {
    var now = new Date();
    var target = new Date(now);

    // 每天 HH:MM
    var daily = expression.match(/每天\s*(\d{1,2})[:：](\d{2})/);
    if (daily) {
      target.setHours(parseInt(daily[1]), parseInt(daily[2]), 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1);
      return { timestamp: target.getTime(), repeat: 'daily', nextRun: target.getTime() };
    }

    // 每周X HH:MM
    var weekly = expression.match(/每周(一|二|三|四|五|六|日|天)\s*(\d{1,2})[:：](\d{2})/);
    if (weekly) {
      var dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
      var targetDay = dayMap[weekly[1]];
      var diff = (targetDay - now.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      target.setDate(now.getDate() + diff);
      target.setHours(parseInt(weekly[2]), parseInt(weekly[3]), 0, 0);
      return { timestamp: target.getTime(), repeat: 'weekly', nextRun: target.getTime(), weekday: targetDay };
    }

    // 每隔N小时/分钟
    var interval = expression.match(/每隔?\s*(\d+)\s*(小时|分钟|天)/);
    if (interval) {
      var num = parseInt(interval[1]);
      var unit = interval[2];
      var ms = unit === '小时' ? num * 3600000 : unit === '分钟' ? num * 60000 : num * 86400000;
      return { timestamp: now.getTime() + ms, repeat: 'interval', intervalMs: ms, nextRun: now.getTime() + ms };
    }

    // HH:MM（今天/明天）
    var time = expression.match(/(\d{1,2})[:：](\d{2})/);
    if (time) {
      target.setHours(parseInt(time[1]), parseInt(time[2]), 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1);
      return { timestamp: target.getTime(), repeat: 'once', nextRun: target.getTime() };
    }

    return null;
  }

  /* 创建定时任务 */
  function create(expression, prompt, name) {
    var parsed = parseTime(expression);
    if (!parsed) return { success: false, error: '无法解析时间表达：' + expression };
    var task = {
      id: 'task-' + Date.now(),
      name: name || ('定时任务-' + tasks.length),
      expression: expression,
      prompt: prompt,
      schedule: parsed,
      enabled: true,
      createdAt: Date.now(),
      lastRun: null,
      runCount: 0
    };
    tasks.push(task);
    save();
    return { success: true, task: task };
  }

  /* 检查并执行到期任务 */
  function checkDue(onExecute) {
    var now = Date.now();
    var due = tasks.filter(function (t) { return t.enabled && t.schedule.nextRun <= now; });
    due.forEach(function (t) {
      if (onExecute) onExecute(t);
      t.lastRun = now;
      t.runCount++;
      // 计算下次运行时间
      if (t.schedule.repeat === 'daily') {
        t.schedule.nextRun = now + 86400000;
      } else if (t.schedule.repeat === 'weekly') {
        t.schedule.nextRun = now + 7 * 86400000;
      } else if (t.schedule.repeat === 'interval') {
        t.schedule.nextRun = now + t.schedule.intervalMs;
      } else {
        t.enabled = false; // 一次性任务执行后禁用
      }
    });
    if (due.length) save();
    return due;
  }

  /* 启动调度检查（每30秒检查一次） */
  function start(onExecute) {
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = setInterval(function () { checkDue(onExecute); }, 30000);
    // 立即检查一次
    checkDue(onExecute);
  }

  function stop() { if (checkTimer) clearInterval(checkTimer); checkTimer = null; }

  function getAll() { return tasks; }
  function remove(id) { tasks = tasks.filter(function (t) { return t.id !== id; }); save(); }
  function toggle(id) {
    var t = tasks.find(function (x) { return x.id === id; });
    if (t) { t.enabled = !t.enabled; save(); }
  }

  return {
    load: load,
    save: save,
    parseTime: parseTime,
    create: create,
    checkDue: checkDue,
    start: start,
    stop: stop,
    getAll: getAll,
    remove: remove,
    toggle: toggle
  };
})();

/* ============================================================
 * 4. ToolRegistry — 工具集
 * ============================================================ */
var ToolRegistry = (function () {
  var tools = {};

  function register(name, handler, description) {
    tools[name] = { handler: handler, description: description || name };
  }

  function execute(name, args) {
    if (!tools[name]) return { success: false, error: '工具不存在：' + name };
    try {
      var result = tools[name].handler(args || {});
      return { success: true, result: result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function list() {
    return Object.keys(tools).map(function (k) {
      return { name: k, description: tools[k].description };
    });
  }

  /* TTS 语音合成（使用浏览器内置 SpeechSynthesis） */
  register('tts', function (args) {
    if (!('speechSynthesis' in window)) return '当前设备不支持语音合成';
    var text = args.text || '';
    var lang = args.lang || 'zh-CN';
    var utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.rate = args.rate || 1.0;
    utter.pitch = args.pitch || 1.0;
    speechSynthesis.speak(utter);
    return '正在朗读：' + text.slice(0, 30) + '...';
  }, '文字转语音朗读');

  register('tts_stop', function () {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    return '已停止朗读';
  }, '停止语音朗读');

  /* 网页搜索（复用免密层） */
  register('web_search', function (args) {
    if (typeof keylessSearch === 'function') {
      keylessSearch(args.query || '', function (results) {
        window.__lastSearch = results;
      });
      return '搜索已发起：' + args.query;
    }
    return '搜索功能不可用';
  }, '免密网页搜索');

  /* 文件读取 */
  register('read_file', function (args) {
    return '文件读取：' + (args.path || '未指定路径');
  }, '读取文件内容');

  /* 记忆查询 */
  register('recall_memory', function (args) {
    var results = MemoryManager.recall(args.query || '', args.limit || 5);
    return JSON.stringify(results);
  }, '查询持久记忆');

  return {
    register: register,
    execute: execute,
    list: list
  };
})();

/* ============================================================
 * 5. AgentCore — 统一 Agent 执行循环
 * ============================================================ */
var AgentCore = (function () {
  var initialized = false;

  function init() {
    if (initialized) return;
    MemoryManager.load();
    SkillManager.load();
    Scheduler.load();
    initialized = true;

    // 启动调度器（定时任务到期时触发对话）
    Scheduler.start(function (task) {
      console.log('[Hermes] 定时任务触发：', task.name, task.prompt);
      // 定时任务触发时，可以通过事件通知主界面
      var event = new CustomEvent('hermes-scheduled-task', { detail: task });
      window.dispatchEvent(event);
    });
  }

  /* 处理用户输入：技能匹配 + 记忆注入 + 工具调用 */
  function processInput(input, context) {
    var result = {
      originalInput: input,
      enhancedPrompt: input,
      matchedSkill: null,
      memoryContext: '',
      toolsToCall: [],
      shouldRespond: true
    };

    // 1. 技能匹配
    var skill = SkillManager.match(input);
    if (skill) {
      result.matchedSkill = skill;
      result.enhancedPrompt = SkillManager.execute(skill, input);
    }

    // 2. 记忆注入
    result.memoryContext = MemoryManager.getContextPrompt();

    // 3. 工具检测（简单关键词触发）
    if (/朗读|读出来|语音|TTS|tts/.test(input)) {
      result.toolsToCall.push({ tool: 'tts', args: { text: input.replace(/朗读|读出来|语音/, '') } });
    }
    if (/搜索|查一下|搜一下|百度|谷歌/.test(input)) {
      result.toolsToCall.push({ tool: 'web_search', args: { query: input } });
    }

    return result;
  }

  /* 对话结束后沉淀记忆 */
  function onConversationEnd(messages, taskType) {
    MemoryManager.digestConversation(messages, taskType);
  }

  /* 获取系统提示词（含记忆） */
  function getSystemPrompt() {
    return MemoryManager.getContextPrompt();
  }

  return {
    init: init,
    processInput: processInput,
    onConversationEnd: onConversationEnd,
    getSystemPrompt: getSystemPrompt
  };
})();

/* 自动初始化 */
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { AgentCore.init(); });
  } else {
    AgentCore.init();
  }
}
