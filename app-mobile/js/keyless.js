/* ============================================================
 * 飞虹 Code — Keyless Web Tier（免密网络层）
 * 学习 Hermes Agent（Nous Research）的自我进化理念
 *  - 5 节点环形轮转池 + ring failover（环形故障转移）
 *  - 免密网页搜索（DuckDuckGo HTML + Wikipedia）
 *  - Hermes 风格持久记忆 + 技能沉淀 + 跨会话回忆
 * ============================================================ */

/* ========== 1. 免密模型环形轮转池 ========== */
/* DuckDuckGo AI 聚合了 OpenAI / Anthropic / Meta / Mistral 四家厂商，
   加上 Wikipedia 知识源，构成 5 节点环形池。全部免注册免 key。 */
var KEYLESS_POOL = [
  {
    id: 'ddg-gpt4o',
    vendor: 'OpenAI (via DuckDuckGo)',
    name: 'GPT-4o Mini',
    model: 'gpt-4o-mini',
    type: 'duckchat',
    weight: 30
  },
  {
    id: 'ddg-claude',
    vendor: 'Anthropic (via DuckDuckGo)',
    name: 'Claude 3 Haiku',
    model: 'claude-3-haiku-20240307',
    type: 'duckchat',
    weight: 25
  },
  {
    id: 'ddg-llama',
    vendor: 'Meta (via DuckDuckGo)',
    name: 'Llama 3.1 70B',
    model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    type: 'duckchat',
    weight: 25
  },
  {
    id: 'ddg-mixtral',
    vendor: 'Mistral (via DuckDuckGo)',
    name: 'Mixtral 8x7B',
    model: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
    type: 'duckchat',
    weight: 15
  },
  {
    id: 'wiki-knowledge',
    vendor: 'Wikipedia (知识源)',
    name: 'Wikipedia 知识引擎',
    model: 'wiki',
    type: 'wiki',
    weight: 5
  }
];

var ringState = {
  index: 0,
  failures: {},   // 每个节点的连续失败次数
  cooldown: {},   // 冷却到期时间戳
  currentVqd: null,
  vqdExpiry: 0
};

/* 获取当前活跃节点（跳过冷却中的） */
function getActiveNode() {
  var now = Date.now();
  for (var i = 0; i < KEYLESS_POOL.length; i++) {
    var idx = (ringState.index + i) % KEYLESS_POOL.length;
    var node = KEYLESS_POOL[idx];
    if (!ringState.cooldown[node.id] || now > ringState.cooldown[node.id]) {
      return { node: node, index: idx };
    }
  }
  // 全部冷却中，返回权重最高的
  return { node: KEYLESS_POOL[0], index: 0 };
}

/* 环形轮转：切换到下一个节点 */
function advanceRing(reason) {
  var old = KEYLESS_POOL[ringState.index];
  ringState.failures[old.id] = (ringState.failures[old.id] || 0) + 1;
  // 连续失败3次，冷却30秒
  if (ringState.failures[old.id] >= 3) {
    ringState.cooldown[old.id] = Date.now() + 30000;
    ringState.failures[old.id] = 0;
  }
  ringState.index = (ringState.index + 1) % KEYLESS_POOL.length;
  console.log('[Keyless] ring advance:', old.name, '→', KEYLESS_POOL[ringState.index].name, reason || '');
}

/* 标记节点成功，重置失败计数 */
function markNodeSuccess(nodeId) {
  ringState.failures[nodeId] = 0;
  delete ringState.cooldown[nodeId];
}

/* ========== 2. DuckDuckGo AI 免密调用 ========== */
var DDG_STATUS_URL = 'https://duckduckgo.com/duckchat/v1/status';
var DDG_CHAT_URL = 'https://duckduckgo.com/duckchat/v1/chat';

/* 获取 vqd-4 token（DuckDuckGo 的会话凭证） */
function fetchVqdToken(callback) {
  var now = Date.now();
  if (ringState.currentVqd && now < ringState.vqdExpiry) {
    callback(ringState.currentVqd);
    return;
  }
  var xhr = new XMLHttpRequest();
  xhr.open('GET', DDG_STATUS_URL, true);
  xhr.setRequestHeader('Accept', 'text/event-stream');
  xhr.onload = function () {
    var vqd = xhr.getResponseHeader('x-vqd-4');
    if (vqd) {
      ringState.currentVqd = vqd;
      ringState.vqdExpiry = now + 5 * 60 * 1000; // 5分钟有效
      callback(vqd);
    } else {
      callback(null);
    }
  };
  xhr.onerror = function () { callback(null); };
  xhr.ontimeout = function () { callback(null); };
  xhr.timeout = 8000;
  xhr.send();
}

/* DuckDuckGo AI 聊天（流式） */
function duckChat(node, messages, onDelta, onDone, onError) {
  fetchVqdToken(function (vqd) {
    if (!vqd) { onError(new Error('无法获取 DuckDuckGo 会话凭证')); return; }
    var xhr = new XMLHttpRequest();
    xhr.open('POST', DDG_CHAT_URL, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('x-vqd-4', vqd);
    xhr.setRequestHeader('Accept', 'text/event-stream');
    var fullContent = '';
    var lastPos = 0;
    var done = false;
    function parseSSE(text) {
      var lines = text.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line.indexOf('data:') !== 0) continue;
        var data = line.slice(5).trim();
        if (data === '[DONE]' || data === 'done') { done = true; continue; }
        try {
          var json = JSON.parse(data);
          if (json.message && json.message.content) {
            var delta = json.message.content;
            if (delta && typeof delta === 'string') {
              fullContent += delta;
              if (onDelta) onDelta(delta);
            }
          }
        } catch (e) { /* 忽略 */ }
      }
    }
    xhr.onprogress = function () {
      if (done) return;
      var text = xhr.responseText || '';
      if (text.length > lastPos) { parseSSE(text.slice(lastPos)); lastPos = text.length; }
    };
    xhr.onload = function () {
      if (xhr.status !== 200) {
        onError(new Error('HTTP ' + xhr.status));
        return;
      }
      var text = xhr.responseText || '';
      if (text.length > lastPos) parseSSE(text.slice(lastPos));
      if (fullContent) { markNodeSuccess(node.id); if (onDone) onDone(fullContent); }
      else { onError(new Error('模型返回空内容')); }
    };
    xhr.onerror = function () { onError(new Error('网络错误')); };
    xhr.ontimeout = function () { onError(new Error('请求超时')); };
    xhr.timeout = 45000;
    // 只取最近的对话上下文（DuckDuckGo 免费额度有限）
    var recentMsgs = messages.slice(-6);
    xhr.send(JSON.stringify({
      model: node.model,
      messages: recentMsgs,
      new: false
    }));
  });
}

/* ========== 3. Wikipedia 知识引擎（终极降级） ========== */
function wikiKnowledge(messages, onDelta, onDone, onError) {
  var lastMsg = messages[messages.length - 1];
  var query = lastMsg ? lastMsg.content : '';
  if (!query) { onError(new Error('空查询')); return; }
  var url = 'https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
    encodeURIComponent(query) + '&format=json&origin=*&srlimit=3';
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.onload = function () {
    try {
      var data = JSON.parse(xhr.responseText);
      var results = data.query && data.query.search ? data.query.search : [];
      if (!results.length) {
        var fallback = '我目前连接的是 Wikipedia 知识引擎，未找到与「' + query + '」相关的条目。你可以换个关键词，或者在设置中配置自定义大模型获得更全面的回答。';
        if (onDelta) onDelta(fallback);
        if (onDone) onDone(fallback);
        return;
      }
      var answer = '📚 根据 Wikipedia 知识检索结果：\n\n';
      results.forEach(function (r, i) {
        var snippet = r.snippet.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 150);
        answer += (i + 1) + '. **' + r.title + '**\n   ' + snippet + '…\n\n';
      });
      answer += '💡 以上为 Wikipedia 摘要，如需完整内容可访问对应条目。';
      if (onDelta) onDelta(answer);
      markNodeSuccess('wiki-knowledge');
      if (onDone) onDone(answer);
    } catch (e) { onError(e); }
  };
  xhr.onerror = function () { onError(new Error('Wikipedia 连接失败')); };
  xhr.timeout = 10000;
  xhr.send();
}

/* ========== 4. 免密聊天主入口（环形故障转移） ========== */
function keylessChat(messages, onDelta, onDone, onError, attempt) {
  attempt = attempt || 0;
  if (attempt >= KEYLESS_POOL.length) {
    if (onError) onError(new Error('所有免密节点均不可用，请在设置中配置自定义模型'));
    return;
  }
  var active = getActiveNode();
  var node = active.node;
  console.log('[Keyless] using:', node.name, '(attempt', attempt + 1, ')');
  function handleError(err) {
    console.log('[Keyless] node failed:', node.name, err.message);
    advanceRing('error: ' + err.message);
    setTimeout(function () {
      keylessChat(messages, onDelta, onDone, onError, attempt + 1);
    }, 300);
  }
  try {
    if (node.type === 'duckchat') {
      duckChat(node, messages, onDelta, function (full) {
        ringState.index = active.index; // 成功后固定在该节点
        if (onDone) onDone(full);
      }, handleError);
    } else if (node.type === 'wiki') {
      wikiKnowledge(messages, onDelta, function (full) {
        ringState.index = active.index;
        if (onDone) onDone(full);
      }, handleError);
    } else {
      handleError(new Error('未知节点类型'));
    }
  } catch (e) { handleError(e); }
}

/* ========== 5. 免密网页搜索 ========== */
/* DuckDuckGo HTML 搜索 + Wikipedia，双源免密 */
function keylessSearch(query, callback) {
  var results = { duckduckgo: [], wikipedia: [] };
  var completed = 0;
  var total = 2;
  function done() {
    completed++;
    if (completed >= total) callback(results);
  }
  // Wikipedia 搜索（CORS 友好）
  try {
    var wikiUrl = 'https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
      encodeURIComponent(query) + '&format=json&origin=*&srlimit=5';
    var wxhr = new XMLHttpRequest();
    wxhr.open('GET', wikiUrl, true);
    wxhr.onload = function () {
      try {
        var data = JSON.parse(wxhr.responseText);
        if (data.query && data.query.search) {
          results.wikipedia = data.query.search.map(function (r) {
            return {
              title: r.title,
              snippet: r.snippet.replace(/<[^>]+>/g, ''),
              url: 'https://zh.wikipedia.org/wiki/' + encodeURIComponent(r.title.replace(/ /g, '_'))
            };
          });
        }
      } catch (e) { /* 忽略 */ }
      done();
    };
    wxhr.onerror = function () { done(); };
    wxhr.timeout = 8000;
    wxhr.send();
  } catch (e) { done(); }
  // DuckDuckGo HTML 搜索（通过 no-cors 或代理）
  try {
    var ddgUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    var dxhr = new XMLHttpRequest();
    dxhr.open('GET', ddgUrl, true);
    dxhr.onload = function () {
      try {
        var html = dxhr.responseText;
        // 解析结果链接和标题
        var re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        var match;
        var count = 0;
        while ((match = re.exec(html)) !== null && count < 8) {
          var title = match[2].replace(/<[^>]+>/g, '').trim();
          var url = match[1].replace(/&amp;/g, '&');
          // 提取摘要
          var snipRe = new RegExp(match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]{0,500}?result__snippet[^>]*>([\\s\\S]*?)<\\/a>');
          var snipMatch = html.match(snipRe);
          var snippet = snipMatch ? snipMatch[1].replace(/<[^>]+>/g, '').trim() : '';
          results.duckduckgo.push({ title: title, url: url, snippet: snippet });
          count++;
        }
      } catch (e) { /* 忽略 */ }
      done();
    };
    dxhr.onerror = function () { done(); };
    dxhr.timeout = 8000;
    dxhr.send();
  } catch (e) { done(); }
}

/* 格式化搜索结果为文本 */
function formatSearchResults(results, query) {
  var text = '🔍 搜索「' + query + '」结果：\n\n';
  if (results.duckduckgo && results.duckduckgo.length) {
    text += '【网页结果】\n';
    results.duckduckgo.forEach(function (r, i) {
      text += (i + 1) + '. ' + r.title + '\n   ' + (r.snippet || '').slice(0, 120) + '\n   ' + r.url + '\n\n';
    });
  }
  if (results.wikipedia && results.wikipedia.length) {
    text += '【百科结果】\n';
    results.wikipedia.forEach(function (r, i) {
      text += (i + 1) + '. ' + r.title + '\n   ' + (r.snippet || '').slice(0, 120) + '\n   ' + r.url + '\n\n';
    });
  }
  if (!results.duckduckgo.length && !results.wikipedia.length) {
    text += '未找到相关结果。';
  }
  return text;
}

/* ========== 6. Hermes 风格持久记忆 ========== */
/* 学习 Hermes Agent 的闭环学习理念：
   - 持久记忆：跨会话存储对话摘要
   - 技能沉淀：从复杂任务中提取可复用模式
   - 跨会话回忆：关键词检索历史摘要 */
var LS_HERMES_MEMORY = 'fh.hermes.memory';
var LS_HERMES_SKILLS = 'fh.hermes.skills';
var hermesMemory = { summaries: [], lastCompact: 0 };
var hermesSkills = [];

function loadHermesMemory() {
  try {
    var raw = localStorage.getItem(LS_HERMES_MEMORY);
    if (raw) hermesMemory = JSON.parse(raw);
  } catch (e) { hermesMemory = { summaries: [], lastCompact: 0 }; }
  if (!hermesMemory.summaries) hermesMemory.summaries = [];
}
function saveHermesMemory() {
  try { localStorage.setItem(LS_HERMES_MEMORY, JSON.stringify(hermesMemory)); } catch (e) {}
}
function loadHermesSkills() {
  try {
    var raw = localStorage.getItem(LS_HERMES_SKILLS);
    if (raw) hermesSkills = JSON.parse(raw);
  } catch (e) { hermesSkills = []; }
}
function saveHermesSkills() {
  try { localStorage.setItem(LS_HERMES_SKILLS, JSON.stringify(hermesSkills)); } catch (e) {}
}

/* 记录对话摘要（Hermes 风格持久记忆） */
function rememberConversation(messages, summary) {
  if (!summary && messages.length) {
    var last = messages[messages.length - 1];
    summary = (last.role === 'user' ? '问：' : '答：') + (last.content || '').slice(0, 100);
  }
  hermesMemory.summaries.push({
    time: Date.now(),
    summary: summary,
    msgCount: messages.length
  });
  // 最多保留50条摘要
  if (hermesMemory.summaries.length > 50) {
    hermesMemory.summaries = hermesMemory.summaries.slice(-50);
  }
  saveHermesMemory();
}

/* 跨会话回忆：关键词检索历史摘要 */
function recallMemory(query, limit) {
  limit = limit || 3;
  if (!hermesMemory.summaries.length) return [];
  var keywords = (query || '').toLowerCase().split(/\s+/).filter(function (w) { return w.length > 1; });
  var scored = hermesMemory.summaries.map(function (s) {
    var score = 0;
    var text = s.summary.toLowerCase();
    keywords.forEach(function (kw) { if (text.indexOf(kw) >= 0) score += 10; });
    score += (Date.now() - s.time) < 86400000 ? 5 : 0; // 近期加分
    return { item: s, score: score };
  });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.filter(function (s) { return s.score > 0; }).slice(0, limit).map(function (s) { return s.item; });
}

/* 技能沉淀：从重复任务模式中提取可复用技能 */
function 沉淀Skill(name, pattern, template) {
  hermesSkills.push({
    id: 'skill_' + Date.now(),
    name: name,
    pattern: pattern,
    template: template,
    createdAt: Date.now(),
    useCount: 0
  });
  saveHermesSkills();
}

/* 匹配技能：根据输入找到相关技能 */
function matchSkill(input) {
  if (!hermesSkills.length) return null;
  var text = (input || '').toLowerCase();
  for (var i = 0; i < hermesSkills.length; i++) {
    if (text.indexOf(hermesSkills[i].pattern.toLowerCase()) >= 0) {
      hermesSkills[i].useCount++;
      saveHermesSkills();
      return hermesSkills[i];
    }
  }
  return null;
}

/* 初始化 Hermes 记忆系统 */
function initHermes() {
  loadHermesMemory();
  loadHermesSkills();
}

/* ========== 7. 免密层状态查询 ========== */
function getKeylessStatus() {
  var active = getActiveNode();
  return {
    enabled: true,
    activeNode: active.node.name,
    activeVendor: active.node.vendor,
    poolSize: KEYLESS_POOL.length,
    nodes: KEYLESS_POOL.map(function (n) {
      return {
        name: n.name,
        vendor: n.vendor,
        failures: ringState.failures[n.id] || 0,
        cooldown: ringState.cooldown[n.id] ? Math.max(0, Math.ceil((ringState.cooldown[n.id] - Date.now()) / 1000)) : 0
      };
    }),
    memoryCount: hermesMemory.summaries.length,
    skillCount: hermesSkills.length
  };
}
