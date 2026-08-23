// i18n 双语字典
    const I18N = {
      zh: {
        'app.title_login': '飞虹 Code 控制台',
        'app.login_hint': '请输入手机号码直接登录',
        'app.brand': '飞虹 Code',
        'login.phone_label': '手机号码',
        'login.btn_login': '手机号登录',
        'nav.chat': '💬 对话',
        'nav.automations': '⚡ 自动化',
        'nav.templates': '📚 模板库',
        'nav.market': '🧩 插件',
        'nav.office': '📎 办公',
        'nav.memory': '🧠 记忆',
        'nav.release': '🚀 发布',
        'sidebar.nav': '导航',
        'sidebar.chat': '对话任务',
        'sidebar.automations': '自动化',
        'sidebar.templates': '模板库',
        'sidebar.market': '插件市场',
        'sidebar.office': '办公助理',
        'sidebar.memory': '记忆系统',
        'sidebar.user': '用户',
        'sidebar.settings': '设置',
        'sidebar.task_list': '任务列表',
        'btn.new_task': '＋ 新建任务',
        'empty.no_tasks': '暂无任务',
        'task.not_selected': '未选择任务',
        'task.select_hint': '从左侧任务列表选择，或在下方输入指令发起新任务',
        'task.refresh': '刷新当前任务',
        'chat.welcome': '点击「＋ 新建任务」开启一个新任务，或直接在下方向当前任务发送消息——所有对话都会归属同一个任务运行。',
        'chat.menu': '＋ 菜单',
        'chat.screenshot': '📷 截图',
        'chat.upload_file': '📄 上传文件',
        'chat.upload_image': '🖼 上传图片',
        'chat.direct_mode': '🖥 直接操作电脑',
        'chat.voice': '🎤 语音输入',
        'chat.agent_type': '🤖 选择智能体类型',
        'chat.agent_default': '🤖 通用助手',
        'chat.listening': '● 正在听…',
        'chat.send': '▶ 发送',
        'common.loading': '加载中…',
        'perm.default': '默认权限',
        'call.hint': '通话',
        'call.voice': '📞 语音',
        'call.video': '🎥 视频',
        'call.hangup': '⛔ 挂断',
        'crop.tip': '按住鼠标拖拽选择截图区域 · 松开确认 · ESC 取消',
        'page.automations.sub': '把常用目标存成指令，一键发起任务',
        'btn.new_automation': '+ 新建指令',
        'empty.no_automations': '还没有快捷指令',
        'page.templates.sub': '点击模板即可填充到输入框',
        'btn.save_template': '+ 保存当前为模板',
        'tpl.builtin': '内置模板',
        'tpl.my': '我的模板',
        'empty.no_templates': '暂无自定义模板',
        'page.market.sub': '聚合 ClawHub 与 Agent-Foundry 技能生态',
        'market.search_placeholder': '搜索…',
        'market.source_all': '全部来源',
        'btn.refresh': '刷新',
        'market.installed': '已安装',
        'empty.no_installed': '暂无已安装技能',
        'page.office.sub': '文档处理快捷入口，点击即生成提示词',
        'page.memory.sub': '短期记忆每日自动整理，沉淀长期知识',
        'btn.refresh_mem': '🔄 刷新',
        'btn.summarize': '✨ 立即总结',
        'mem.stat_short_days': '短期记忆天数',
        'mem.stat_long_items': '长期记忆条目',
        'mem.stat_last_summary': '上次总结',
        'mem.stat_next_summary': '下次自动总结',
        'mem.tab_short': '📅 短期记忆',
        'mem.tab_long': '💾 长期记忆',
        'mem.tab_history': '📜 总结历史',
        'btn.view': '查看',
        'mem.select_date': '选择日期查看短期记忆',
        'empty.no_history': '暂无总结记录',
        'footbar.title': '对话任务',
        'footbar.desc': '提交自然语言需求，云端静默执行并回传结果',
        'footbar.model': '大模型',
        'footbar.model_title': '切换当前使用的大模型',
        'footbar.model_settings': '大模型设置',
        'footbar.model_default': '默认（系统路由）',
        'right.detail': '📦 任务详情',
        'right.preview': '👁 产物预览',
        'right.detail_hint': '从顶部选择一个任务查看详情。',
        'right.preview_title': '预览',
        'right.preview_hint': '点击任务或对话中的文件/代码进行预览。',
        'modal.auto_title': '新建快捷指令',
        'modal.auto_hint': '保存后可在「自动化」页一键发起任务。',
        'modal.auto_name': '指令名称',
        'modal.auto_goal': '目标（提交给模型的需求）',
        'modal.perm_title': '🔒 权限处理窗口',
        'modal.perm_hint': '配置工作期间 AI 可读范围及可操作权限。',
        'modal.perm_read_scope': '可读范围',
        'modal.perm_workspace': '仅当前工作区',
        'modal.perm_specified': '指定目录',
        'modal.perm_all': '全部文件',
        'modal.perm_actions': '操作权限',
        'modal.perm_read': '读取文件',
        'modal.perm_write': '写入文件',
        'modal.perm_shell': '执行命令',
        'modal.perm_network': '访问网络',
        'modal.perm_browser': '浏览器控制',
        'modal.agent_title': '🤖 选择智能体类型',
        'modal.agent_hint': '不同智能体会自动调整提示词与执行策略。',
        'modal.folder_title': '📂 选择工作区文件夹',
        'btn.select_folder': '选择此文件夹',
        'modal.model_title': '🧠 大模型设置',
        'modal.model_hint': '配置自定义大模型，可保存多个并在对话中随时切换。勾选「默认」的项将作为对话默认模型。',
        'modal.model_name': '模型名称 *',
        'modal.model_api': 'API 地址',
        'modal.model_key': '密钥（API Key）',
        'modal.model_reasoning': '推理过程运行内容（中间环节）',
        'btn.save_config': '保存配置',
        'btn.clear_form': '清空表单',
        'btn.close': '关闭',
        'modal.new_task_title': '＋ 新建对话任务',
        'modal.new_task_hint': '创建一个全新任务，中部对话栏的所有消息都将归属该任务运行（支持多轮连续对话）。',
        'modal.new_task_label': '任务描述',
        'modal.new_task_agent': '智能体类型',
        'modal.new_task_workspace': '工作区',
        'btn.create_task': '创建任务',
        'modal.settings_title': '⚙️ 设置',
        'settings.general': '通用',
        'settings.layout': '栏目配置',
        'settings.perm': '权限处理',
        'settings.perm_desc': '配置工作期间可读范围与操作权限',
        'settings.theme': '外观',
        'settings.theme_desc': '切换浅色 / 深色主题',
        'settings.session': '💬 会话管理',
        'menu.version': '体验版',
        'menu.current': '当前',
        'menu.buddy': 'Buddy 加油站',
        'menu.invite': '去邀约',
        'menu.invite_right': '最高得会员',
        'menu.points': '积分余额',
        'menu.growth': '成长计划',
        'menu.growth_right': '连登有奖',
        'menu.help': '帮助与反馈',
        'menu.update': '检查更新',
        'menu.logout': '退出登录',
        'btn.cancel': '取消',
        'btn.save': '保存',
        'sidebar.release': '产品发布',
        'modal.tpl_title_label': '模板标题',
        'modal.tpl_title_ph': '如：SQL 优化',
        'modal.tpl_category': '分类',
        'modal.tpl_category_ph': '自定义',
        'modal.tpl_goal': '目标内容',
        'settings.session_auto_new': '发送消息前自动新建对话',
        'settings.session_auto_open': '页面打开时自动新建对话',
        'settings.session_clear': '新建对话时清空历史上下文',
        'modal.auto_name_ph': '如：每日构建检查',
        'modal.auto_goal_ph': '运行 npm test 并汇总失败用例…',
        'modal.model_name_ph': '如 GPT-4o / 通义千问 / 自建模型',
        'modal.model_api_ph': 'https://api.openai.com/v1',
        'modal.model_key_ph': 'sk-...',
        'modal.model_reasoning_ph': '配置该模型在中间推理环节的运行内容，例如：先列出需求拆解，再给出实现方案，最后输出代码。',
        'modal.perm_path_ph': '输入允许的目录路径',
        // ---- select 的 title 提示（键名固定为 title.<元素id>）----
        'title.modelSelect': '切换当前使用的大模型',
        // ---- 输入框占位符（键名固定为 ph.<元素id>）----
        'ph.goalInput': '输入指令，消息将归属当前任务持续对话；点上方「＋ 新建任务」可开启新任务（创建 → 推理 → 工具验证 → 闭环全程追踪）',
        'ph.marketSearch': '搜索…',
        'ph.autoName': '如：每日构建检查',
        'ph.autoGoal': '运行 npm test 并汇总失败用例…',
        'ph.tplTitle': '如：SQL 优化',
        'ph.tplCategory': '自定义',
        'ph.tplGoal': '粘贴要保存的需求文本…',
        'ph.permReadPath': '输入允许的目录路径',
        'ph.modelName': '如 GPT-4o / 通义千问 / 自建模型',
        'ph.modelApiBase': 'https://api.openai.com/v1',
        'ph.modelApiKey': 'sk-...',
        'ph.modelReasoning': '配置该模型在中间推理环节的运行内容，例如：先列出需求拆解，再给出实现方案，最后输出代码。',
        'ph.ntGoal': '例如：请读取当前工作区 package.json，告诉我其中的 name 与 version 字段',
        'ph.imName': '模型名称 *',
        'ph.imBase': 'API 地址',
      },
      en: {
        'app.title_login': 'Feihong Code Console',
        'app.login_hint': 'Enter phone number to login directly',
        'app.brand': 'Feihong Code',
        'login.phone_label': 'Phone Number',
        'login.btn_login': 'Login',
        'nav.chat': '💬 Chat',
        'nav.automations': '⚡ Automations',
        'nav.templates': '📚 Templates',
        'nav.market': '🧩 Market',
        'nav.office': '📎 Office',
        'nav.release': '🚀 Release',
        'nav.memory': '🧠 Memory',
        'sidebar.nav': 'Nav',
        'sidebar.chat': 'Chat',
        'sidebar.automations': 'Automations',
        'sidebar.templates': 'Templates',
        'sidebar.market': 'Market',
        'sidebar.office': 'Office',
        'sidebar.release': 'Release',
        'sidebar.memory': 'Memory',
        'sidebar.user': 'User',
        'sidebar.settings': 'Settings',
        'sidebar.task_list': 'Tasks',
        'btn.new_task': '＋ New Task',
        'empty.no_tasks': 'No tasks',
        'task.not_selected': 'No task selected',
        'task.select_hint': 'Select from task list or enter commands below',
        'task.refresh': 'Refresh',
        'chat.welcome': 'Click ＋ New Task to start a new task, or send messages to continue the current task.',
        'chat.menu': '＋ Menu',
        'chat.screenshot': '📷 Screenshot',
        'chat.upload_file': '📄 Upload File',
        'chat.upload_image': '🖼 Upload Image',
        'chat.direct_mode': '🖥 Direct Control',
        'chat.voice': '🎤 Voice Input',
        'chat.agent_type': '🤖 Agent Type',
        'chat.agent_default': '🤖 Assistant',
        'chat.listening': '● Listening…',
        'chat.send': '▶ Send',
        'common.loading': 'Loading…',
        'perm.default': 'Default Permissions',
        'call.hint': 'Call',
        'call.voice': '📞 Voice',
        'call.video': '🎥 Video',
        'call.hangup': '⛔ Hang Up',
        'crop.tip': 'Drag to select a screenshot area · Release to confirm · ESC to cancel',
        'page.automations.sub': 'Save common goals as shortcuts, launch tasks with one click',
        'btn.new_automation': '+ New Command',
        'empty.no_automations': 'No shortcuts yet',
        'page.templates.sub': 'Click a template to fill the input box',
        'btn.save_template': '+ Save as Template',
        'tpl.builtin': 'Built-in Templates',
        'tpl.my': 'My Templates',
        'empty.no_templates': 'No custom templates',
        'page.market.sub': 'Aggregating ClawHub & Agent-Foundry skill ecosystems',
        'market.search_placeholder': 'Search…',
        'market.source_all': 'All Sources',
        'btn.refresh': 'Refresh',
        'market.installed': 'Installed',
        'empty.no_installed': 'No installed skills',
        'page.office.sub': 'Document processing shortcuts, generate prompts instantly',
        'page.memory.sub': 'Daily auto-summary of short-term memory, accumulate long-term knowledge',
        'btn.refresh_mem': '🔄 Refresh',
        'btn.summarize': '✨ Summarize Now',
        'mem.stat_short_days': 'Short-term Memory Days',
        'mem.stat_long_items': 'Long-term Memory Items',
        'mem.stat_last_summary': 'Last Summary',
        'mem.stat_next_summary': 'Next Summary',
        'mem.tab_short': '📅 Short-term',
        'mem.tab_long': '💾 Long-term',
        'mem.tab_history': '📜 History',
        'btn.view': 'View',
        'mem.select_date': 'Select date to view',
        'empty.no_history': 'No summary records',
        'footbar.title': 'Chat Task',
        'footbar.desc': 'Submit natural language requirements, cloud silent execution and return results',
        'footbar.model': 'Model',
        'footbar.model_title': 'Switch model',
        'footbar.model_settings': 'Model Settings',
        'footbar.model_default': 'Default (System Route)',
        'right.detail': '📦 Task Detail',
        'right.preview': '👁 Preview',
        'right.detail_hint': 'Select a task from the top to view details.',
        'right.preview_title': 'Preview',
        'right.preview_hint': 'Click files/codes in task or chat to preview.',
        'modal.auto_title': 'New Automation',
        'modal.auto_hint': 'Save for one-click task launch on Automations page.',
        'modal.auto_name': 'Command Name',
        'modal.auto_goal': 'Goal (Requirements for model)',
        'modal.perm_title': '🔒 Permission Window',
        'modal.perm_hint': 'Configure AI readable scope and operable permissions.',
        'modal.perm_read_scope': 'Read Scope',
        'modal.perm_workspace': 'Current Workspace Only',
        'modal.perm_specified': 'Specified Directory',
        'modal.perm_all': 'All Files',
        'modal.perm_actions': 'Operation Permissions',
        'modal.perm_read': 'Read Files',
        'modal.perm_write': 'Write Files',
        'modal.perm_shell': 'Execute Commands',
        'modal.perm_network': 'Access Network',
        'modal.perm_browser': 'Browser Control',
        'modal.agent_title': '🤖 Agent Type',
        'modal.agent_hint': 'Different agents auto-adjust prompts and execution strategies.',
        'modal.folder_title': '📂 Select Workspace Folder',
        'btn.select_folder': 'Select This Folder',
        'modal.model_title': '🧠 Model Settings',
        'modal.model_hint': 'Configure custom models, save multiple and switch anytime. Default model will be used by default.',
        'modal.model_name': 'Model Name *',
        'modal.model_api': 'API URL',
        'modal.model_key': 'API Key',
        'modal.model_reasoning': 'Reasoning Content (Optional)',
        'btn.save_config': 'Save Config',
        'btn.clear_form': 'Clear Form',
        'btn.close': 'Close',
        'modal.new_task_title': '＋ New Chat Task',
        'modal.new_task_hint': 'Create a brand new task. All messages in the chat will belong to this task (supports multi-turn conversation).',
        'modal.new_task_label': 'Task Description',
        'modal.new_task_agent': 'Agent Type',
        'modal.new_task_workspace': 'Workspace',
        'btn.create_task': 'Create Task',
        'modal.settings_title': '⚙️ Settings',
        'settings.general': 'General',
        'settings.layout': 'Layout Config',
        'settings.perm': 'Permissions',
        'settings.perm_desc': 'Configure readable scope and operation permissions',
        'settings.theme': 'Appearance',
        'settings.theme_desc': 'Switch light/dark theme',
        'settings.session': '💬 Session Management',
        'menu.version': 'Trial Version',
        'menu.current': 'Current',
        'menu.buddy': 'Buddy Station',
        'menu.invite': 'Invite',
        'menu.invite_right': 'Get Premium',
        'menu.points': 'Points Balance',
        'menu.growth': 'Growth Plan',
        'menu.growth_right': 'Streak Bonus',
        'menu.help': 'Help & Feedback',
        'menu.update': 'Check Update',
        'menu.logout': 'Logout',
        'btn.cancel': 'Cancel',
        'btn.save': 'Save',
        'sidebar.release': 'Release',
        'modal.tpl_title_label': 'Template Title',
        'modal.tpl_title_ph': 'e.g. SQL optimization',
        'modal.tpl_category': 'Category',
        'modal.tpl_category_ph': 'Custom',
        'modal.tpl_goal': 'Goal Content',
        'settings.session_auto_new': 'Auto new conversation before sending',
        'settings.session_auto_open': 'Auto new conversation on page open',
        'settings.session_clear': 'Clear history on new conversation',
        'modal.auto_name_ph': 'e.g. Daily build check',
        'modal.auto_goal_ph': 'Run npm test and summarize failures…',
        'modal.model_name_ph': 'e.g. GPT-4o / Qwen / custom model',
        'modal.model_api_ph': 'https://api.openai.com/v1',
        'modal.model_key_ph': 'sk-...',
        'modal.model_reasoning_ph': 'Configure what this model runs in intermediate reasoning steps, e.g. break down requirements first, then propose a solution, then output code.',
        'modal.perm_path_ph': 'Enter allowed directory path',
        // ---- select title hints (key = title.<element id>) ----
        'title.modelSelect': 'Switch the active LLM',
        // ---- input placeholders (key = ph.<element id>) ----
        'ph.goalInput': 'Type an instruction. Messages stay in the current task; click "+ New Task" above to start a new one (create → reason → verify → close the loop).',
        'ph.marketSearch': 'Search…',
        'ph.autoName': 'e.g. Daily build check',
        'ph.autoGoal': 'Run npm test and summarize failing cases…',
        'ph.tplTitle': 'e.g. SQL Optimization',
        'ph.tplCategory': 'Custom',
        'ph.tplGoal': 'Paste the requirement text to save…',
        'ph.permReadPath': 'Enter an allowed directory path',
        'ph.modelName': 'e.g. GPT-4o / Qwen / Self-hosted',
        'ph.modelApiBase': 'https://api.openai.com/v1',
        'ph.modelApiKey': 'sk-...',
        'ph.modelReasoning': 'Define what this model does during intermediate reasoning, e.g. break down requirements first, then propose a plan, then output code.',
        'ph.ntGoal': 'e.g. Read package.json in the current workspace and tell me its name and version fields',
        'ph.imName': 'Model name *',
        'ph.imBase': 'API endpoint',
      }
    };
    
    let currentLang = localStorage.getItem('fhcode.lang') || 'zh';
    
    function t(key) {
      const dict = I18N[currentLang] || I18N.zh;
      return dict[key] || key;
    }
    
    /**
     * 安全地把某个元素的 i18n 文案落地。
     * 关键约束（曾导致「模型无法切换」「侧边栏图标消失」的线上问题）：
     *  - <select> 绝对不能写 textContent，否则会把所有 <option> 一次性清空；
     *  - <input>/<textarea> 只改 placeholder，且必须命中专用键，避免误翻；
     *  - 含子元素的容器（图标 + 标签）只改 title / 直接文本节点，绝不整体覆盖。
     */
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

    function switchLang(lang) {
      currentLang = lang;
      localStorage.setItem('fhcode.lang', lang);
      document.querySelectorAll('[data-i18n]').forEach((el) => {
        try { applyI18nToEl(el); } catch (e) { console.warn('[i18n] 应用失败', el, e); }
      });
      document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
      });
      document.documentElement.lang = lang;
      // 语言切换后重建由 JS 动态渲染的下拉/列表，保证选项文案与选中值不丢失
      try { if (typeof renderModelSelect === 'function') renderModelSelect(); } catch {}
    }
    
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => switchLang(btn.getAttribute('data-lang')));
    });
    
    // 初始化语言
    switchLang(currentLang);
    
    const AGENT_TYPES = {
      general: { label: '通用助手', icon: '🤖' },
      'fix-code': { label: '修复代码', icon: '🐛' },
      'write-code': { label: '编写代码', icon: '✍️' },
      'exec-command': { label: '执行命令', icon: '⚡' },
    };

    const state = {
      token: '',
      phone: '',
      tasks: [],
      currentTaskId: null,
      submittedTaskIds: new Set(),
      completedTaskIds: new Set(),
      pinnedTasks: new Set(), // 置顶任务ID集合
      market: [],
      installed: new Set(),
      agentType: 'general',
      directMode: false,
      permissions: {
        readScope: 'workspace',
        readPath: '',
        allowRead: true,
        allowWrite: false,
        allowShell: false,
        allowNetwork: true,
        allowBrowser: false,
      },
      workspaceDir: '',
      rightTab: 'detail',
      models: [],
      defaultModelId: null,
      modelId: '',
      // 待发送附件暂存区（截图/上传文件/上传图片，点发送时才上传并发给 AI）
      stagedFiles: [],
      // 会话管理配置
      sessionConfig: {
        autoResetOnNew: false,    // 打开时自动新建对话
        autoResetOnOpen: false,   // 发送消息时自动重置
        clearHistoryOnNew: true,  // 新建时清空历史
      },
      procOpen: false,            // 「执行过程」折叠面板是否展开（轮询刷新时保留）
    };

    (function initSession() {
      const urlToken = new URLSearchParams(location.search).get('token');
      if (urlToken) localStorage.setItem('fhcode.token', urlToken);
      const savedModel = localStorage.getItem('fhcode.model');
      if (savedModel !== null) state.modelId = savedModel;
      state.token = localStorage.getItem('fhcode.token') || '';
      state.phone = localStorage.getItem('fhcode.phone') || '';
      try {
        const p = JSON.parse(localStorage.getItem('fhcode.permissions') || '{}');
        if (p) Object.assign(state.permissions, p);
      } catch {}
      // 恢复主题偏好（脚本位于 body 尾部，尽早生效避免闪烁）
      if (localStorage.getItem('fhcode.theme') === 'dark') {
        document.documentElement.classList.add('dark');
      }
      // 加载会话配置
      try {
        const sc = JSON.parse(localStorage.getItem('fhcode.sessionConfig') || '{}');
        if (sc.autoResetOnNew != null) state.sessionConfig.autoResetOnNew = sc.autoResetOnNew;
        if (sc.autoResetOnOpen != null) state.sessionConfig.autoResetOnOpen = sc.autoResetOnOpen;
        if (sc.clearHistoryOnNew != null) state.sessionConfig.clearHistoryOnNew = sc.clearHistoryOnNew;
      } catch {}
      // autoResetOnOpen: 页面打开时自动新建对话（不自动选中旧任务，显示空白输入区）
      if (state.sessionConfig.autoResetOnOpen && state.token) {
        state.currentTaskId = null;
        const box = document.getElementById('messages');
        if (box) box.innerHTML = '<div class="msg sys">已按设置自动新建对话，输入指令即可发起新任务。</div>';
      }
    })();

    function authHeaders() {
      return state.token ? { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
    }
    async function api(path, method = 'GET', body) {
      const res = await fetch(path, { method, headers: authHeaders(), body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        // 401：令牌确实被服务端拒绝，清除并回到登录页。
        // 会话已落盘（web-sessions.json），正常重启不会再走到这里；
        // 走到这里说明令牌真的过期或被吊销，此时给出明确提示，避免用户以为是"莫名跳回登录"。
        if (res.status === 401 && d.error === 'unauthorized') {
          if (state.token) {
            console.warn('[api] token 已被服务端拒绝，清除并回到登录页:', path);
            localStorage.removeItem('fhcode.token');
            state.token = '';
            try { toast('登录已过期，请重新登录'); } catch {}
          }
          const overlay = document.getElementById('loginOverlay');
          if (overlay) overlay.style.display = 'flex';
          throw new Error('登录已过期，请重新登录');
        }
        throw new Error(d.error || ('HTTP ' + res.status));
      }
      return res.json();
    }
    function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function fmtTime(iso) { try { return new Date(iso).toLocaleString(); } catch { return iso || ''; } }
    function toast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg; el.classList.add('show');
      clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2200);
    }
    function openModal(id) { document.getElementById(id).classList.add('show'); }
    function closeModal(id) { document.getElementById(id).classList.remove('show'); }
    // 消息气泡通用操作：复制 / 编辑 / 分享 / 创建文档
    function bubbleActions(e, content) {
      e.stopPropagation();
      const menu = document.getElementById('bubbleMenu');
      if (menu) menu.remove();
      const m = document.createElement('div');
      m.id = 'bubbleMenu';
      m.style.cssText = 'position:fixed;z-index:10001;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.18);padding:4px 0;min-width:140px;font-size:13px;';
      const items = [
        { label: '📋 复制', action: 'copy' },
        { label: '✏️ 编辑', action: 'edit' },
        { label: '🔗 分享链接', action: 'share' },
        { label: '📄 创建文档', action: 'doc' },
      ];
      items.forEach((it) => {
        const el = document.createElement('div');
        el.className = 'dropdown-item';
        el.textContent = it.label;
        el.style.cssText = 'padding:7px 16px;cursor:pointer;';
        el.addEventListener('mouseenter', () => { el.style.background = 'var(--brand-soft)'; });
        el.addEventListener('mouseleave', () => { el.style.background = ''; });
        el.addEventListener('click', () => {
          m.remove();
          handleBubbleAction(it.action, content);
        });
        m.appendChild(el);
      });
      document.body.appendChild(m);
      const rect = e.target.getBoundingClientRect();
      m.style.right = (window.innerWidth - rect.right + 4) + 'px';
      m.style.top = rect.top + 'px';
    }
    async function handleBubbleAction(action, content) {
      if (action === 'copy') {
        try { await navigator.clipboard.writeText(content); toast('已复制到剪贴板'); }
        catch { document.execCommand('copy'); toast('已复制'); }
      } else if (action === 'edit') {
        const edited = prompt('编辑内容：', content);
        if (edited != null && edited.trim()) {
          // 就近更新对应的消息气泡正文（最终回复块 / 对话气泡）
          const box = document.getElementById('messages');
          if (box) {
            const candidates = box.querySelectorAll('.step.final > div:last-child, .msg.assistant, .msg.user');
            for (let i = candidates.length - 1; i >= 0; i--) {
              if ((candidates[i].textContent || '').trim() === (content || '').trim()) {
                candidates[i].textContent = edited;
                break;
              }
            }
          }
          toast('已更新消息内容（本地预览）');
        }
      } else if (action === 'share') {
        const payload = btoa(unescape(encodeURIComponent(content.slice(0, 2000))));
        const url = location.origin + location.pathname + '#share/' + payload;
        try { await navigator.clipboard.writeText(url); toast('分享链接已复制'); }
        catch { prompt('复制以下链接分享给他人：', url); }
      } else if (action === 'doc') {
        const title = prompt('文档标题（默认： fhcode-回复）：', 'fhcode-回复-' + Date.now());
        if (!title) return;
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = title.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_\-]/g, '_') + '.md';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('文档已下载');
      }
    }

    /* ========== 登录 ========== */
    async function doLogin() {
      const input = document.getElementById('loginPhone');
      const status = document.getElementById('loginStatus');
      const btn = document.getElementById('loginBtn');
      const phone = (input.value || '').trim();
      if (!/^\d{6,20}$/.test(phone)) { status.textContent = '请输入有效的手机号码'; status.classList.add('err'); return; }
      btn.disabled = true;
      status.textContent = '登录中…';
      status.classList.remove('err');
      try {
        const d = await api('/api/auth/login', 'POST', { phone });
        if (!d || !d.token) throw new Error('服务端未返回令牌');
        state.token = d.token;
        state.phone = d.phone || phone;
        localStorage.setItem('fhcode.token', state.token);
        localStorage.setItem('fhcode.phone', state.phone);
        // 保存引导任务（供首次登录后展示）
        if (d.isFirstLogin && d.welcomeTasks) {
          await saveWelcomeTasks(d.welcomeTasks);
        }
        status.classList.remove('err');
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('appLayout').classList.add('show');
        await afterLogin();
      } catch (e) {
        status.textContent = '登录失败：' + e.message;
        status.classList.add('err');
      } finally {
        btn.disabled = false;
      }
    }
    document.getElementById('loginBtn').addEventListener('click', doLogin);
    document.getElementById('loginPhone').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

    async function afterLogin() {
      updateUserBar();
      // 检查是否是首次登录，如果是则显示欢迎引导
      const isFirstLogin = await checkFirstLogin();
      if (isFirstLogin) {
        // 从 localStorage 恢复 welcomeTasks（登录时已创建）
        const savedWelcomeTasks = localStorage.getItem('fhcode.welcomeTasks');
        if (savedWelcomeTasks) {
          try {
            const tasks = JSON.parse(savedWelcomeTasks);
            if (tasks.length > 0) {
              showWelcomeGuide(tasks);
              return; // 引导流程已启动，跳过常规加载
            }
          } catch {}
        }
        showWelcomeGuide([]);
      }
      await Promise.allSettled([loadTasks(), loadAutomations(), loadTemplates(), loadMarket(), loadOffice(), loadWorkspace(), loadModels(), loadMemoryStats()]);
      startRefresh();
    }

    async function checkFirstLogin() {
      if (!state.token) return false;
      try {
        const d = await api('/api/auth/me');
        if (d.isFirstLogin === true) {
          // 保存首次登录标记，供后续使用
          localStorage.setItem('fhcode.firstLogin', 'true');
        }
        return d.isFirstLogin === true;
      } catch {
        return false;
      }
    }

    function showWelcomeGuide(welcomeTasks = []) {
      // 显示欢迎引导弹窗
      showWelcomeModal(welcomeTasks);
    }

    function showWelcomeModal(welcomeTasks) {
      const modal = document.getElementById('welcomeGuideModal');
      if (!modal) return;
      
      const listEl = document.getElementById('welcomeTaskList');
      if (listEl) {
        if (welcomeTasks.length > 0) {
          listEl.innerHTML = welcomeTasks.map((t, i) => `
            <div class="welcome-task-item" data-task-id="${t.taskId}" data-goal="${encodeURIComponent(t.goal)}">
              <div class="welcome-task-index">${i + 1}</div>
              <div class="welcome-task-content">
                <div class="welcome-task-title">${escapeHtml(t.title || '任务 ' + (i + 1))}</div>
                <div class="welcome-task-desc">${escapeHtml(t.description || t.goal.slice(0, 50) + '…')}</div>
              </div>
              <button class="welcome-task-run" data-id="${t.taskId}">▶ 运行</button>
            </div>
          `).join('');
          
          // 绑定运行按钮
          listEl.querySelectorAll('.welcome-task-run').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const taskId = btn.getAttribute('data-id');
              runWelcomeTask(taskId);
            });
          });
        } else {
          listEl.innerHTML = '<div class="empty-welcome">正在为您准备引导任务，请稍候…</div>';
        }
      }
      
      modal.classList.add('show');
      toast('🎉 欢迎！系统已为您准备了三个引导任务');
    }

    async function runWelcomeTask(taskId) {
      try {
        // 加载任务详情
        const d = await api('/api/tasks/' + taskId);
        state.currentTaskId = d.task.id;
        
        // 关闭引导弹窗
        const modal = document.getElementById('welcomeGuideModal');
        if (modal) modal.classList.remove('show');
        
        // 显示任务列表
        const taskListSection = document.getElementById('taskListSection');
        if (taskListSection) taskListSection.style.display = 'block';
        
        // 加载并刷新任务
        await loadTasks();
        selectTask(taskId);
        toast('已启动引导任务：' + (d.task.goal.slice(0, 20) + '…'));
      } catch (e) {
        toast('启动任务失败：' + e.message);
      }
    }

    // 运行所有引导任务
    async function runAllWelcomeTasks() {
      const tasks = JSON.parse(localStorage.getItem('fhcode.welcomeTasks') || '[]');
      if (tasks.length === 0) {
        toast('暂无引导任务');
        return;
      }
      // 关闭弹窗
      const modal = document.getElementById('welcomeGuideModal');
      if (modal) modal.classList.remove('show');
      // 显示任务列表
      const taskListSection = document.getElementById('taskListSection');
      if (taskListSection) taskListSection.style.display = 'block';
      // 运行第一个任务
      await runWelcomeTask(tasks[0].taskId);
      toast('已开始执行引导任务，共 ' + tasks.length + ' 个');
    }

    // 绑定"全部运行"按钮
    document.getElementById('welcomeRunAllBtn')?.addEventListener('click', runAllWelcomeTasks);

    // 在登录后保存 welcomeTasks 到 localStorage
    async function saveWelcomeTasks(tasks) {
      if (tasks && tasks.length > 0) {
        localStorage.setItem('fhcode.welcomeTasks', JSON.stringify(tasks));
      }
    }

    function updateUserBar() {
      document.getElementById('topbarPhone').textContent = state.phone || '未登录';
      document.getElementById('sheetPhone').textContent = state.phone || '未登录';
      const a = AGENT_TYPES[state.agentType];
      document.getElementById('skillPill').textContent = (a?.icon || '🤖') + ' ' + (a?.label || '通用助手');
    }

    /* ========== 导航切换 ========== */
    function switchView(nav) {
      document.querySelectorAll('.topbar-nav-item').forEach((n) => n.classList.toggle('active', n.getAttribute('data-nav') === nav));
      document.querySelectorAll('.sidebar-icon').forEach((n) => n.classList.toggle('active', n.getAttribute('data-nav') === nav));
      document.querySelectorAll('.view, .page-view').forEach((v) => v.classList.toggle('active', v.getAttribute('data-view') === nav));
      // 切换时显示/隐藏底部工具栏（任务上下文头部始终可见）
      const isChat = nav === 'chat';
      document.getElementById('chatFootbar').style.display = isChat ? 'flex' : 'none';
    }

    document.querySelectorAll('.topbar-nav-item').forEach((el) => {
      el.addEventListener('click', () => switchView(el.getAttribute('data-nav')));
    });
    document.querySelectorAll('.sidebar-icon[data-nav]').forEach((el) => {
      el.addEventListener('click', () => switchView(el.getAttribute('data-nav')));
    });

    /* ========== 用户菜单 ========== */
    const userMenuMask = document.getElementById('userMenuMask');
    document.getElementById('topbarUser').addEventListener('click', () => userMenuMask.classList.add('show'));
    document.getElementById('sidebarUser').addEventListener('click', () => userMenuMask.classList.add('show'));
    userMenuMask.addEventListener('click', (e) => { if (e.target === userMenuMask) userMenuMask.classList.remove('show'); });
    document.querySelectorAll('#userMenu .sheet-item').forEach((el) => {
      el.addEventListener('click', () => {
        const action = el.getAttribute('data-action');
        userMenuMask.classList.remove('show');
        switch (action) {
          case 'settings': openModal('settingsModal'); break;
          case 'models': openModels(); break;
          case 'theme': toggleTheme(); break;
          case 'help': openBrowser('https://github.com/wch887292/feihong-code/issues'); break;
          case 'buddy': openBrowser('https://www.klai.top'); break;
          case 'invite': toast('邀请链接已复制（演示）'); break;
          case 'points': toast('积分余额：0（演示）'); break;
          case 'growth': toast('连续登录 1 天（演示）'); break;
          case 'version': toast('当前为体验版'); break;
          case 'update': checkUpdate(); break;
          case 'logout':
            localStorage.removeItem('fhcode.token');
            localStorage.removeItem('fhcode.phone');
            location.reload();
            break;
        }
      });
    });

    document.getElementById('sidebarSettings').addEventListener('click', () => {
      userMenuMask.classList.remove('show');
      openModal('settingsModal');
    });

    function openBrowser(url) {
      api('/api/open/browser', 'POST', { url }).then(() => toast('已在系统浏览器打开')).catch((e) => toast('打开失败：' + e.message));
    }
    async function checkUpdate() {
      try {
        const d = await api('/api/health');
        toast('当前版本 ' + d.version + '，已是最新（演示）');
      } catch (e) { toast('检查失败：' + e.message); }
    }
    function toggleTheme() {
      const dark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('fhcode.theme', dark ? 'dark' : 'light');
      toast(dark ? '已切换为深色主题' : '已切换为浅色主题');
    }

    /* ========== 任务列表与详情 ========== */
    function statusBadge(s) { return '<span class="badge ' + s + '">' + s + '</span>'; }
    async function loadTasks() {
      if (!state.token) return;
      try {
        const d = await api('/api/tasks');
        state.tasks = d.tasks || [];
        renderSidebarTaskList();
        // 刷新页面：不自动选中旧任务，聊天区保持清空；
        // 历史任务全部保留在左侧「任务列表」，点击即可回看对话。
        if (state.currentTaskId) {
          await refreshCurrentThread();
        } else {
          renderTaskThread(null);
        }
      }
      catch (e) { console.warn('加载任务失败', e); }
    }
    async function selectTask(id) {
      state.currentTaskId = id;
      renderSidebarTaskList();
      renderTaskDetail(id);
      await refreshCurrentThread();
      switchRightTab('detail');
    }
    function renderSidebarTaskList() {
      const container = document.getElementById('taskListContainer');
      const section = document.getElementById('taskListSection');
      const badge = document.getElementById('taskCountBadge');
      if (!container || !section) return;

      // 置顶任务排在前面，其余按时间倒序
      const sortedTasks = [...state.tasks].sort((a, b) => {
        if (state.pinnedTasks.has(a.id) && !state.pinnedTasks.has(b.id)) return -1;
        if (!state.pinnedTasks.has(a.id) && state.pinnedTasks.has(b.id)) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      const activeTasks = sortedTasks.filter(t => t.status === 'queued' || t.status === 'running' || t.status === 'done' || t.status === 'failed');

      if (activeTasks.length === 0) {
        section.style.display = 'none';
        return;
      }

      section.style.display = 'block';
      badge.textContent = activeTasks.length;

      let html = '';
      activeTasks.slice(0, 15).forEach(t => {
        const icon = t.status === 'running' ? '⏳' : t.status === 'queued' ? '📥' : t.error ? '❌' : '✅';
        const title = t.goal.slice(0, 18) + (t.goal.length > 18 ? '…' : '');
        const isPinned = state.pinnedTasks.has(t.id);
        const activeClass = state.currentTaskId === t.id ? 'active' : '';
        html += `<div class="task-item ${activeClass}" data-task-id="${t.id}" data-pinned="${isPinned}">
          <span class="task-icon">${icon}</span>
          <span class="task-title">${title}</span>
          ${isPinned ? '<span class="task-pinned">📌</span>' : ''}
          <div class="task-actions">
            <button class="pin-btn" data-id="${t.id}" data-pinned="${isPinned}" title="${isPinned ? '取消置顶' : '置顶'}">${isPinned ? '📌' : '📍'}</button>
            ${t.status === 'done' || t.status === 'failed' ? '<button class="delete-btn" data-id="' + t.id + '" title="删除任务">🗑️</button>' : ''}
          </div>
        </div>`;
      });

      container.innerHTML = html;

      // 绑定点击事件
      container.querySelectorAll('.task-item[data-task-id]').forEach(el => {
        el.addEventListener('click', (e) => {
          // 如果是点击pin按钮，不切换任务
          if (e.target.classList.contains('pin-btn')) return;
          const id = el.getAttribute('data-task-id');
          selectTask(id);
        });

        // 右键菜单 - 置顶/取消置顶
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const id = el.getAttribute('data-task-id');
          togglePinTask(id);
        });
      });

      // 绑定pin按钮
      container.querySelectorAll('.pin-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          togglePinTask(id);
        });
      });

      // 绑定删除按钮
      container.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          deleteTask(id);
        });
      });
    }

    // 切换置顶状态
    function togglePinTask(taskId) {
      if (state.pinnedTasks.has(taskId)) {
        state.pinnedTasks.delete(taskId);
        toast('已取消置顶');
      } else {
        state.pinnedTasks.add(taskId);
        toast('已置顶');
      }
      renderSidebarTaskList();
    }

    // 删除任务
    async function deleteTask(taskId) {
      if (!confirm('确定要删除这个任务吗？')) return;
      try {
        await api('/api/tasks/' + taskId, 'DELETE');
        toast('任务已删除');
        state.tasks = state.tasks.filter((t) => t.id !== taskId);
        // 若删除的是当前任务，清空选中并回退到最新任务或空白态
        if (state.currentTaskId === taskId) {
          state.currentTaskId = null;
          if (state.tasks.length) {
            state.currentTaskId = state.tasks[0].id;
            renderTaskDetail(state.currentTaskId);
            await refreshCurrentThread();
          } else {
            renderTaskThread(null);
          }
        }
        renderSidebarTaskList();
      } catch (e) {
        toast('删除失败：' + e.message);
      }
    }
    function renderTaskDetail(id) {
      const t = state.tasks.find((x) => x.id === id);
      const box = document.getElementById('taskDetail');
      if (!t) { box.innerHTML = '<div class="muted">任务不存在。</div>'; return; }
      const r = t.result;
      let ops = '';
      if (t.workspaceDir) {
        ops = '<div class="detail-ops">' +
          '<button class="secondary" data-op="browser">🌐 打开浏览器</button>' +
          '<button class="secondary" data-op="folder" data-path="' + escapeHtml(t.workspaceDir) + '">📂 打开资源管理器</button>' +
          '<button class="secondary" data-op="artifacts" data-path="' + escapeHtml(t.workspaceDir) + '">📑 查看产物文件</button>' +
          '</div>';
      }
      const rows = [
        ops,
        '<div><b>目标</b><br>' + escapeHtml(t.goal) + '</div>',
        '<div><b>状态</b> ' + statusBadge(t.status) + '</div>',
        t.agentType ? '<div><b>智能体</b> ' + escapeHtml(AGENT_TYPES[t.agentType]?.label || t.agentType) + '</div>' : '',
        r ? '<div><b>迭代</b> ' + r.iterations + ' · <b>成本</b> $' + r.costUsd.toFixed(6) + '</div>' : '',
        r && r.logFile ? '<div><b>日志</b> <code>' + escapeHtml(r.logFile) + '</code></div>' : '',
        r && r.finalAnswer ? '<div><b>结果</b><br><pre style="white-space:pre-wrap;word-break:break-word;">' + escapeHtml(r.finalAnswer) + '</pre></div>' : '',
        t.error ? '<div style="color:var(--err)"><b>错误</b><br>' + escapeHtml(t.error) + '</div>' : '',
      ].filter(Boolean).join('<hr style="border:none;border-top:1px solid var(--line);margin:10px 0;">');
      box.innerHTML = rows || '<div class="muted">无详情</div>';
      box.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => handleDetailOp(t, b.getAttribute('data-op'), b.getAttribute('data-path'))));
    }
    async function handleDetailOp(task, op, path) {
      if (op === 'folder') {
        try { await api('/api/open/folder', 'POST', { path: path || task.workspaceDir }); toast('已打开资源管理器'); }
        catch (e) { toast('打开失败：' + e.message); }
      } else if (op === 'browser') {
        const url = extractUrl(task.result?.finalAnswer) || 'https://www.klai.top';
        openBrowser(url);
      } else if (op === 'artifacts') {
        await showArtifacts(path || task.workspaceDir);
      } else if (op === 'preview' || op === 'code') {
        const text = task.result?.finalAnswer || '';
        showPreview('任务产物', linkifyArtifacts(text), 'text');
        switchRightTab('preview');
      }
    }
    /* ========== 任务思维链路渲染 ========== */
    /** 切换思考过程折叠/展开 */
    function toggleThinking(header) {
      const body = header.parentElement.querySelector('.thinking-body');
      if (!body) return;
      const arrow = header.querySelector('.thinking-arrow');
      if (body.style.display === 'none' || body.style.display === '') {
        body.style.display = 'block';
        if (arrow) arrow.textContent = '▼';
      } else {
        body.style.display = 'none';
        if (arrow) arrow.textContent = '▶';
      }
    }
    /** 切换工具调用参数详情显示/隐藏 */
    function toggleArgs(el) {
      const args = el.parentElement.querySelector('.thinking-args');
      if (!args) return;
      args.classList.toggle('show');
      el.textContent = args.classList.contains('show') ? '收起参数' : '查看参数';
    }

    /** 群组渲染助手消息为 Cursor 风格的思考过程 + 回复 */
    function renderThinkingProcess(msgs) {
      // 收集所有工具调用和文本内容
      const allToolCalls = [];
      const textParts = [];
      for (const m of msgs) {
        const calls = m.toolCalls || [];
        allToolCalls.push(...calls);
        const text = (m.content || '').trim();
        if (text) textParts.push(text);
      }
      const textContent = textParts.join('\n\n');

      // 构建工具调用摘要（按工具名称分组统计）
      const toolCounts = {};
      for (const tc of allToolCalls) {
        const name = tc.name || 'unknown';
        toolCounts[name] = (toolCounts[name] || 0) + 1;
      }
      // 工具名称 → 友好中文描述
      const toolLabels = {
        'read': '读取文件', 'write': '写入文件', 'edit': '编辑文件',
        'search': '搜索文件', 'grep': '搜索文件', 'glob': '搜索文件',
        'run': '执行命令', 'execute': '执行命令', 'command': '执行命令',
        'web_search': '搜索网络', 'web_fetch': '访问网页',
        'list': '列出目录', 'ls': '列出目录',
        'delete': '删除文件', 'remove': '删除文件',
      };
      const summaryParts = Object.entries(toolCounts).map(([name, count]) => {
        const label = toolLabels[name] || name;
        return label + ' ' + count + ' 次';
      });
      const summaryText = summaryParts.join('、');

      // 工具调用 → 带图标的一行描述
      const stepIcons = {
        'read': '📖', 'write': '✏️', 'edit': '✏️',
        'search': '🔍', 'grep': '🔍', 'glob': '🔍',
        'run': '⚡', 'execute': '⚡', 'command': '⚡',
        'web_search': '🌐', 'web_fetch': '🌐',
        'list': '📂', 'ls': '📂',
        'delete': '🗑️', 'remove': '🗑️',
      };

      let html = '<div class="msg assistant thinking-msg">';

      // 可折叠的思考过程头部
      html += '<div class="thinking-header" onclick="toggleThinking(this)">';
      html += '<span class="thinking-arrow">▶</span>';
      html += '<span class="thinking-label">思考过程</span>';
      if (summaryText) {
        html += '<span class="thinking-summary"> · ' + escapeHtml(summaryText) + '</span>';
      }
      html += '</div>';

      // 可折叠的思考过程主体
      html += '<div class="thinking-body" style="display:none;">';
      for (const tc of allToolCalls) {
        const name = tc.name || 'unknown';
        const icon = stepIcons[name] || '🔧';
        const label = toolLabels[name] || name;
        const args = tc.arguments ? JSON.stringify(tc.arguments, null, 2) : '';
        // 从参数中提取关键信息显示
        let brief = escapeHtml(label);
        if (tc.arguments) {
          const arg = tc.arguments;
          if (arg.path) brief += ' <code>' + escapeHtml(arg.path) + '</code>';
          else if (arg.query) brief += ' <code>' + escapeHtml(String(arg.query).slice(0, 60)) + '</code>';
          else if (arg.url) brief += ' <code>' + escapeHtml(arg.url) + '</code>';
          else if (arg.command) brief += ' <code>' + escapeHtml(String(arg.command).slice(0, 60)) + '</code>';
        }
        html += '<div class="thinking-step">';
        html += '<span class="thinking-step-icon">' + icon + '</span>';
        html += '<span class="thinking-step-text">' + brief + '</span>';
        if (args) {
          html += '<span class="thinking-step-detail" onclick="toggleArgs(this)">查看参数</span>';
        }
        html += '</div>';
        if (args) {
          html += '<pre class="thinking-args">' + escapeHtml(args) + '</pre>';
        }
      }
      html += '</div>';

      // 回复内容
      if (textContent) {
        html += '<div class="thinking-reply">' + renderMarkdown(textContent) + '</div>';
      }

      html += '</div>';
      return html;
    }

    // 拉取当前选中任务的完整详情（含思维链路步骤）并渲染
    async function refreshCurrentThread() {
      if (!state.currentTaskId) { renderTaskThread(null); return; }
      try {
        const d = await api('/api/tasks/' + state.currentTaskId);
        const t = d.task;
        const idx = state.tasks.findIndex((x) => x.id === t.id);
        if (idx >= 0) state.tasks[idx] = t; else state.tasks.push(t);
        renderTaskThread(t);
      } catch (e) { console.warn('刷新当前任务线程失败', e); renderTaskThread(null); }
    }

    function renderTaskHeader(task) {
      const titleEl = document.getElementById('tchTitle');
      const statusEl = document.getElementById('tchStatus');
      const timeEl = document.getElementById('tchTime');
      const subEl = document.getElementById('tchSub');
      if (!task) {
        titleEl.textContent = '未选择任务';
        statusEl.className = 'badge'; statusEl.textContent = '—';
        timeEl.textContent = '';
        subEl.textContent = '从左侧任务列表选择，或在下方输入指令发起新任务';
        return;
      }
      titleEl.textContent = task.goal.length > 60 ? task.goal.slice(0, 60) + '…' : task.goal;
      statusEl.className = 'badge ' + task.status;
      statusEl.textContent = task.status;
      timeEl.textContent = '创建于 ' + fmtTime(task.createdAt);
      subEl.textContent = '对话流 + 内部执行过程追踪 · 共 ' + (task.steps ? task.steps.length : 0) + ' 个步骤';
      // 仅当任务正在运行/排队时显示「停止」按钮（解救卡死、无法继续的任务）
      const stopEl = document.getElementById('tchStop');
      if (stopEl) stopEl.style.display = (task && (task.status === 'running' || task.status === 'queued')) ? '' : 'none';
    }

    // 将单个任务渲染为对话框：对话流（用户↔助手干净气泡）+ 内部执行过程（默认折叠）
    function renderTaskThread(task) {
      const box = document.getElementById('messages');
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      renderTaskHeader(task);
      if (!task) {
        box.innerHTML = '<div class="msg sys">从左侧「任务列表」选择历史任务查看对话，或在下方输入指令发起新任务。刷新页面会自动清空当前对话视图，历史对话已保存在任务列表中。</div>';
        return;
      }
      const steps = task.steps || [];
      const finalAnswer = (task.result && task.result.finalAnswer || '').trim();
      let html = '';
      const conv = Array.isArray(task.conversation) ? task.conversation : [];

      if (conv.length > 0) {
        // 分组处理：连续 assistant 消息合并为一个思考过程
        let i = 0;
        while (i < conv.length) {
          const m = conv[i];
          if (!m) { i++; continue; }
          // 过滤 tool 消息
          if (m.role === 'tool') { i++; continue; }

          if (m.role === 'user') {
            html += '<div class="msg user">' + linkifyArtifacts(m.content || '') + '</div>';
            i++;
            continue;
          }

          if (m.role === 'assistant') {
            // 收集连续 assistant 消息
            const assistantMsgs = [];
            while (i < conv.length && conv[i] && conv[i].role === 'assistant') {
              assistantMsgs.push(conv[i]);
              i++;
            }

            const hasToolCalls = assistantMsgs.some(msg => (msg.toolCalls || []).length > 0);
            const allText = assistantMsgs.map(msg => (msg.content || '').trim()).filter(Boolean).join('\n\n');

            if (hasToolCalls) {
              // 有工具调用 → 渲染为豆包风格思考过程（默认折叠）
              html += renderThinkingProcess(assistantMsgs);
            } else if (allText) {
              // 纯文本回复 → 普通气泡，markdown 渲染
              html += '<div class="msg assistant">' + renderMarkdown(allText) + '</div>';
            }
          } else {
            i++;
          }
        }
      } else if (task.goal) {
        // 首轮尚未产生对话流时，至少呈现用户原始指令
        html += '<div class="msg user">' + linkifyArtifacts(task.goal) + '</div>';
      }

      // 终态：最终回复（干净气泡）/ 失败提示
      if (task.status === 'done') {
        if (task.result && task.result.finalAnswer) {
          const safeText = JSON.stringify(task.result.finalAnswer);
          html += '<div class="msg assistant final-msg">'
            + '<div class="final-head">📬 最终回复</div>'
            + '<div class="final-actions">'
            + '<button onclick="bubbleActions(event, ' + safeText + ')" title="复制/编辑/分享/创建文档">⚙️ 操作</button>'
            + '</div>'
            + '<div style="margin-top:4px;cursor:text;user-select:text;">' + renderMarkdown(task.result.finalAnswer) + '</div>'
            + '</div>';
        }
      } else if (task.status === 'failed') {
        if (task.result && task.result.finalAnswer) {
          const safeText = JSON.stringify(task.result.finalAnswer);
          html += '<div class="msg assistant final-msg"><div class="final-head">📬 部分回复</div>'
            + '<div class="final-actions"><button onclick="bubbleActions(event, ' + safeText + ')" title="操作">⚙️</button></div>'
            + '<div style="margin-top:4px;cursor:text;user-select:text;">' + renderMarkdown(task.result.finalAnswer) + '</div></div>';
        }
        html += '<div class="msg assistant error-msg">⛔ 任务失败：' + escapeHtml(task.error || '未知错误') + '</div>';
      } else if (task.status === 'running') {
        // 运行中：在最后添加思考中指示
        html += '<div class="thinking-indicator">'
          + '<span class="dot"></span><span class="dot"></span><span class="dot"></span>'
          + '<span>思考中...</span>'
          + '</div>';
      } else if (task.status === 'queued') {
        html += '<div class="msg sys">📥 任务已入队，等待执行…</div>';
      }
      box.innerHTML = html;
      if (nearBottom) box.scrollTop = box.scrollHeight;
    }
    // 单条执行步骤渲染（思维链路、工具调用、验证结果、自愈/压缩等）
    function renderStepHtml(step) {
      const d = step.data || {};
      if (step.type === 'model.response') {
        const content = (d.content || '').toString();
        const toolCalls = Array.isArray(d.toolCalls) ? d.toolCalls : [];
        let inner = '<div class="reasoning-head">🧠 模型推理 · ' + escapeHtml(d.model || '') + '</div>';
        if (content) inner += '<div style="white-space:pre-wrap;word-break:break-word;">' + renderMarkdown(content) + '</div>';
        if (toolCalls.length) inner += '<div class="muted" style="margin-top:6px;">↳ 计划调用工具：' + toolCalls.map((t) => '<code>' + escapeHtml(t) + '</code>').join('、') + '</div>';
        return '<div class="step reasoning">' + inner + '</div>';
      } else if (step.type === 'tool.call') {
        const argsHtml = formatToolArgs(d.args);
        return '<div class="step toolcall"><div class="tc-name">🔧 调用 ' + escapeHtml(d.name || '') + '</div>' + argsHtml + '</div>';
      } else if (step.type === 'tool.result') {
        const ok = !!d.ok;
        const out = (d.output || '').toString();
        return '<div class="step result ' + (ok ? 'ok' : 'fail') + '"><div class="res-head">' + (ok ? '✅' : '❌') + ' ' + escapeHtml(d.name || '') + ' ' + (ok ? '成功' : '失败') + '</div>' + (out.trim() ? '<div class="res-out">' + escapeHtml(out).slice(0, 500) + '</div>' : '') + '</div>';
      } else if (step.type === 'self-heal') {
        return '<div class="step note">🩹 进入自愈：检测到 <b>' + escapeHtml(d.category || '') + '</b> 类错误，已注入反思重试（第 ' + (d.iteration != null ? d.iteration : '?') + ' 轮）</div>';
      } else if (step.type === 'context.compact') {
        return '<div class="step note">📦 上下文压缩：从 ' + (d.originalLength != null ? d.originalLength : '?') + ' 条压缩至 ' + (d.compressedLength != null ? d.compressedLength : '?') + ' 条，保留首条目标与近期对话</div>';
      }
      return '';
    }
    /* 轻量 Markdown 渲染（用于模型推理内容） */
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
    /* 工具参数格式化为 key: value 列表 */
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
    async function showArtifacts(dir) {
      try {
        const d = await api('/api/workspace/list?path=' + encodeURIComponent(dir));
        const files = (d.entries || []).filter((e) => e.type !== 'dir');
        const box = document.getElementById('taskDetail');
        const listHtml = files.length
          ? files.map((f) => '<div class="artifact-file" data-path="' + escapeHtml(f.path) + '">📄 ' + escapeHtml(f.name) + '</div>').join('')
          : '<div class="muted">该目录暂无文件产物。</div>';
        const hint = '<div class="muted" style="margin-bottom:8px;">产物文件（来自：' + escapeHtml(dir) + '），点击在右侧预览：</div>';
        const cur = box.innerHTML;
        box.innerHTML = cur + '<hr style="border:none;border-top:1px solid var(--line);margin:10px 0;">' + hint + '<div class="artifact-list">' + listHtml + '</div>';
        box.querySelectorAll('.artifact-file').forEach((el) => el.addEventListener('click', () => {
          previewFile(el.getAttribute('data-path'));
          toast('已打开：' + el.getAttribute('data-path'));
        }));
        switchRightTab('detail');
      } catch (e) { toast('读取产物失败：' + e.message); }
    }

    /* ========== 右侧 Tab ========== */
    document.querySelectorAll('.right-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchRightTab(tab.getAttribute('data-tab')));
    });
    function switchRightTab(name) {
      state.rightTab = name;
      document.querySelectorAll('.right-tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-tab') === name));
      document.getElementById('detailPanel').classList.toggle('active', name === 'detail');
      document.getElementById('previewPanel').classList.toggle('active', name === 'preview');
    }
    function showPreview(title, content, mode) {
      document.getElementById('previewTitle').textContent = title;
      const box = document.getElementById('previewContent');
      if (mode === 'code' || mode === 'file') {
        box.innerHTML = '<pre>' + escapeHtml(content) + '</pre>';
      } else {
        box.innerHTML = '<div style="white-space:pre-wrap;word-break:break-word;">' + content + '</div>';
      }
    }

    /* ========== 对话与发送 ========== */
    async function sendTask() {
      const input = document.getElementById('goalInput');
      let goal = input.value.trim();
      // 允许只发送文件（无文本）
      if (!goal && !state.stagedFiles.length) return;
      if (!state.token) { toast('请先登录'); return; }
      if (state.directMode) goal = goal ? ('[直接操作电脑] ' + goal) : '[直接操作电脑]（仅附件）';
      const btn = document.getElementById('sendBtn');
      btn.disabled = true;
      try {
        // 上传暂存的附件（仅在点发送时才上传）
        const attachments = await uploadStagedFiles();

        // autoResetOnNew: 发送消息前自动新建对话，旧任务保留在历史
        if (state.sessionConfig.autoResetOnNew && state.currentTaskId) {
          toast('自动新建对话，旧任务保留在历史');
          state.currentTaskId = null;
        }
        // 已有当前任务 → 多轮续接：消息归属同一任务生命周期
        if (state.currentTaskId) {
          const cur = state.tasks.find((t) => t.id === state.currentTaskId);
          if (cur && (cur.status === 'queued' || cur.status === 'running')) {
            toast('当前任务执行中，请等待完成后再继续对话');
            return;
          }
          const d = await api('/api/tasks/' + state.currentTaskId + '/messages', 'POST', {
            message: goal || '（仅附件）',
            attachments,
          });
          input.value = '';
          clearStagedFiles();
          renderSidebarTaskList();
          renderTaskDetail(d.task.id);
          renderTaskThread(d.task);
          await loadTasks();
          toast(attachments.length ? `已发送（含 ${attachments.length} 个附件），继续当前任务对话` : '已发送，继续当前任务对话');
          return;
        }
        const d = await api('/api/tasks', 'POST', {
          goal: goal || '（仅附件）',
          agentType: state.agentType,
          permissions: state.permissions,
          workspaceDir: state.workspaceDir || undefined,
          modelId: state.modelId || undefined,
          attachments: attachments.length ? attachments : undefined,
        });
        input.value = '';
        clearStagedFiles();
        // 新任务即成为当前任务，中部围绕其单一生命周期可视化追踪
        state.currentTaskId = d.task.id;
        const taskListSection = document.getElementById('taskListSection');
        if (taskListSection) taskListSection.style.display = 'block';
        renderSidebarTaskList();
        renderTaskDetail(d.task.id);
        renderTaskThread({ id: d.task.id, goal: goal || '（仅附件）', status: 'queued', createdAt: new Date().toISOString(), steps: [], conversation: [{ role: 'user', content: goal || '（仅附件）' }] });
        await loadTasks();
        toast(attachments.length ? `任务已提交（含 ${attachments.length} 个附件），开始追踪思维链路` : '任务已提交，开始追踪思维链路');
      } catch (e) { toast('提交失败：' + e.message); }
      finally { btn.disabled = false; }
    }

    /* ========== 输入区·附件暂存（点发送时统一上传） ========== */
    function stageFile(file) {
      const id = 'sf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      state.stagedFiles.push({ id, name: file.name, mime: file.mime, dataUrl: file.dataUrl, size: estimateDataUrlSize(file.dataUrl) });
      renderStagedFiles();
    }
    function removeStagedFile(id) {
      state.stagedFiles = state.stagedFiles.filter((f) => f.id !== id);
      renderStagedFiles();
    }
    function clearStagedFiles() {
      state.stagedFiles = [];
      renderStagedFiles();
    }
    function estimateDataUrlSize(dataUrl) {
      // base64 长度 × 0.75 估算字节
      const b64 = (dataUrl || '').split(',')[1] || '';
      return Math.round(b64.length * 0.75);
    }
    function formatSize(n) {
      if (!Number.isFinite(n)) return '';
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      return (n / 1024 / 1024).toFixed(2) + ' MB';
    }
    function renderStagedFiles() {
      const box = document.getElementById('stagedArea');
      if (!box) return;
      if (!state.stagedFiles.length) {
        box.classList.remove('show');
        box.innerHTML = '';
        return;
      }
      box.classList.add('show');
      box.innerHTML = state.stagedFiles.map((f) => {
        const isImg = (f.mime || '').startsWith('image/');
        const icon = isImg ? '🖼' : '📎';
        return (
          '<div class="staged-chip" data-id="' + escapeHtml(f.id) + '">' +
            '<span>' + icon + '</span>' +
            '<span class="staged-name">' + escapeHtml(f.name) + '</span>' +
            '<span class="staged-size">' + formatSize(f.size) + '</span>' +
            '<button class="staged-remove" data-act="remove" title="移除">×</button>' +
          '</div>'
        );
      }).join('') + '<span class="staged-hint">💡 点发送时一起上传</span>';
      box.querySelectorAll('.staged-remove').forEach((b) => {
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const chip = b.closest('.staged-chip');
          if (chip) removeStagedFile(chip.getAttribute('data-id'));
        });
      });
    }
    async function uploadStagedFiles() {
      if (!state.stagedFiles.length) return [];
      const paths = [];
      for (const f of state.stagedFiles) {
        try {
          const base64 = (f.dataUrl || '').split(',')[1] || '';
          const d = await api('/api/upload', 'POST', { name: f.name, mime: f.mime, dataBase64: base64 });
          paths.push(d.path);
        } catch (e) { toast('上传失败：' + f.name + '（' + e.message + '）'); }
      }
      return paths;
    }
    function appendMsg(role, text, extras = {}) {
      const box = document.getElementById('messages');
      const el = document.createElement('div');
      el.className = 'msg ' + role;
      if (extras.html) el.innerHTML = extras.html;
      else if (extras.file) {
        el.innerHTML = '<span class="file-chip" data-path="' + escapeHtml(extras.file) + '" data-type="' + escapeHtml(extras.mime || 'file') + '">📎 ' + escapeHtml(extras.name) + '</span>';
      } else {
        el.innerHTML = linkifyArtifacts(text);
      }
      box.appendChild(el);
      box.scrollTop = box.scrollHeight;
      bindArtifacts(el);
    }
    document.getElementById('sendBtn').addEventListener('click', sendTask);
    document.getElementById('goalInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendTask(); });
    document.getElementById('tchRefresh').addEventListener('click', () => { refreshCurrentThread(); toast('已刷新当前任务'); });
    document.getElementById('tchStop').addEventListener('click', async () => {
      if (!state.currentTaskId) return;
      try {
        await api('/api/tasks/' + state.currentTaskId + '/stop', 'POST');
        toast('已发送停止指令，任务即将终止');
        await refreshCurrentThread();
      } catch (e) { toast('停止失败：' + e.message); }
    });
    document.getElementById('tchNewTask').addEventListener('click', () => { try { openNewTaskModal(); } catch { toast('新建任务面板不可用'); } });
    document.getElementById('screenshotBtn').addEventListener('click', takeScreenshot);

    /* ========== 输入框右键菜单（复制/剪切/粘贴/全选） ========== */
    const goalInput = document.getElementById('goalInput');
    goalInput.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // 移除旧菜单
      const old = document.getElementById('textCtxMenu');
      if (old) old.remove();
      // 记录右键时的选中区间（菜单点击会令文本框失焦，故需先记住）
      const sel = { start: goalInput.selectionStart, end: goalInput.selectionEnd };
      const hasSel = sel.end > sel.start;
      // 创建右键菜单
      const menu = document.createElement('div');
      menu.id = 'textCtxMenu';
      menu.style.cssText = 'position:fixed;z-index:10000;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:4px 0;min-width:160px;';
      const items = [
        { label: '📋 复制', action: 'copy', disabled: !hasSel },
        { label: '✂️ 剪切', action: 'cut', disabled: !hasSel },
        { label: '📌 粘贴', action: 'paste' },
        { label: '⬛ 全选', action: 'selectall' },
      ];
      // 恢复文本框聚焦与选中，供 execCommand 兜底使用
      const restoreSel = () => {
        goalInput.focus();
        goalInput.setSelectionRange(sel.start, sel.end);
      };
      items.forEach((it) => {
        const el = document.createElement('div');
        el.className = 'dropdown-item';
        el.textContent = it.label;
        el.style.cssText = 'padding:6px 16px;cursor:' + (it.disabled ? 'default' : 'pointer') + ';font-size:13px;opacity:' + (it.disabled ? 0.4 : 1) + ';';
        el.addEventListener('mouseenter', () => { if (!it.disabled) el.style.background = 'var(--brand-soft)'; });
        el.addEventListener('mouseleave', () => { el.style.background = ''; });
        el.addEventListener('click', async () => {
          menu.remove();
          if (it.disabled) return;
          if (it.action === 'copy') {
            const selText = goalInput.value.slice(sel.start, sel.end);
            try { await navigator.clipboard.writeText(selText); toast('已复制'); }
            catch { restoreSel(); document.execCommand('copy'); toast('已复制'); }
          } else if (it.action === 'cut') {
            const selText = goalInput.value.slice(sel.start, sel.end);
            try { await navigator.clipboard.writeText(selText); } catch {}
            goalInput.setRangeText('', sel.start, sel.end, 'preserve');
            goalInput.focus();
            goalInput.setSelectionRange(sel.start, sel.start);
            if (selText) toast('已剪切');
          } else if (it.action === 'paste') {
            let text = '';
            try { text = await navigator.clipboard.readText().catch(() => ''); } catch {}
            if (text) {
              goalInput.setRangeText(text, sel.start, sel.end, 'end');
              goalInput.focus();
            } else {
              // 读取失败则回退到系统粘贴（依赖当前选中）
              restoreSel();
              document.execCommand('paste');
            }
          } else if (it.action === 'selectall') {
            goalInput.focus();
            goalInput.select();
          }
        });
        menu.appendChild(el);
      });
      document.body.appendChild(menu);
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
    });
    // 点击其他地方或失焦关闭右键菜单
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('textCtxMenu');
      if (menu && !menu.contains(e.target)) menu.remove();
    });
    document.addEventListener('blur', () => {
      const menu = document.getElementById('textCtxMenu');
      if (menu) menu.remove();
    });
    // 支持在输入框内直接粘贴图片（与「上传图片/截图」共用同一暂存区，发送时一起上传）
    goalInput.addEventListener('paste', (e) => {
      if (!e.clipboardData) return;
      const items = e.clipboardData.items;
      const images = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) images.push(f);
        }
      }
      if (!images.length) return; // 非图片粘贴（文本等）交给浏览器默认行为
      e.preventDefault();
      images.forEach((file, idx) => {
        const reader = new FileReader();
        reader.onload = () => {
          const name = file.name || ('paste-image-' + (idx + 1) + '.png');
          stageFile({ name, mime: file.type || 'image/png', dataUrl: String(reader.result) });
          toast('已暂存图片：' + name + '（点发送时一起发给 AI）');
        };
        reader.readAsDataURL(file);
      });
    });

    /* ========== 新建对话任务 ========== */
    async function openNewTaskModal() {
      // 智能体类型下拉
      const agentSel = document.getElementById('ntAgentType');
      agentSel.innerHTML = Object.entries(AGENT_TYPES)
        .map(([k, v]) => '<option value="' + k + '"' + (state.agentType === k ? ' selected' : '') + '>' + v.icon + ' ' + v.label + '</option>')
        .join('');
      // 工作区下拉：默认（沿用当前底部所选）+ 磁盘根目录
      const wsSel = document.getElementById('ntWorkspaceDir');
      const cur = state.workspaceDir || '';
      wsSel.innerHTML = '<option value="">默认（' + (cur || '服务器工作区') + '）</option>';
      try {
        const d = await api('/api/drives');
        (d.drives || []).forEach((dr) => {
          if (dr !== cur) wsSel.innerHTML += '<option value="' + escapeHtml(dr) + '">' + escapeHtml(dr) + '</option>';
        });
      } catch {}
      document.getElementById('ntGoal').value = '';
      openModal('newTaskModal');
      setTimeout(() => document.getElementById('ntGoal').focus(), 60);
    }
    async function createNewTask() {
      const goal = document.getElementById('ntGoal').value.trim();
      if (!goal) { toast('请填写任务描述'); return; }
      const btn = document.getElementById('ntCreateBtn');
      btn.disabled = true;
      try {
        const wsVal = document.getElementById('ntWorkspaceDir').value;
        const payload = {
          goal,
          agentType: document.getElementById('ntAgentType').value || state.agentType,
          permissions: state.permissions,
          modelId: state.modelId || undefined,
        };
        // 工作区：仅在明确选择了目录时覆盖
        const d = await api('/api/tasks', 'POST', wsVal ? Object.assign(payload, { workspaceDir: wsVal }) : payload);
        document.getElementById('goalInput').value = '';
        state.currentTaskId = d.task.id;
        const taskListSection = document.getElementById('taskListSection');
        if (taskListSection) taskListSection.style.display = 'block';
        renderSidebarTaskList();
        renderTaskDetail(d.task.id);
        renderTaskThread({ id: d.task.id, goal, status: 'queued', createdAt: new Date().toISOString(), steps: [], conversation: [{ role: 'user', content: goal }] });
        switchView('chat');
        closeModal('newTaskModal');
        await loadTasks();
        toast('新任务已创建，所有对话将归属该任务');
      } catch (e) { toast('创建失败：' + e.message); }
      finally { btn.disabled = false; }
    }
    document.getElementById('newTaskBtn')?.addEventListener('click', openNewTaskModal);
    document.getElementById('tchNewTask')?.addEventListener('click', openNewTaskModal);
    document.getElementById('ntCreateBtn')?.addEventListener('click', createNewTask);
    document.getElementById('ntGoal')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) createNewTask(); });

    /* ========== 产物链接化 ========== */
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
    function bindArtifacts(container) {
      container.querySelectorAll('.artifact').forEach((el) => {
        el.addEventListener('click', () => {
          const kind = el.getAttribute('data-kind');
          const path = el.getAttribute('data-path');
          if (kind === 'url') openBrowser(path);
          else previewFile(path);
        });
      });
      container.querySelectorAll('.file-chip').forEach((el) => {
        el.addEventListener('click', () => {
          const path = el.getAttribute('data-path');
          const mime = el.getAttribute('data-type') || '';
          if (mime.startsWith('image/')) previewImage(path);
          else previewFile(path);
        });
      });
    }
    async function previewFile(path) {
      try {
        const d = await api('/api/files/read', 'POST', { path });
        showPreview('文件: ' + path, d.content, 'file');
        switchRightTab('preview');
      } catch (e) { toast('预览失败：' + e.message); }
    }
    function previewImage(path) {
      document.getElementById('previewTitle').textContent = '图片: ' + path;
      const box = document.getElementById('previewContent');
      const img = document.createElement('img');
      img.src = 'file://' + path;
      img.style.maxWidth = '100%';
      img.style.borderRadius = '8px';
      img.addEventListener('error', () => {
        box.innerHTML = '<div class="muted">无法直接显示本地图片，请用系统相册打开</div>';
      });
      box.innerHTML = '';
      box.appendChild(img);
      switchRightTab('preview');
    }
    function extractUrl(text) {
      if (!text) return '';
      const m = text.match(/(https?:\/\/[^\s]+)/);
      return m ? m[1] : '';
    }

    /* ========== 中间菜单 ========== */
    const convMenuWrap = document.getElementById('convMenuWrap');
    const convMenu = document.getElementById('convMenu');
    document.getElementById('convMenuBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      convMenu.classList.toggle('show');
    });
    document.addEventListener('click', (e) => { if (!convMenuWrap.contains(e.target)) convMenu.classList.remove('show'); });
    convMenu.querySelectorAll('.dropdown-item').forEach((el) => {
      el.addEventListener('click', () => {
        convMenu.classList.remove('show');
        const action = el.getAttribute('data-action');
        if (action === 'screenshot') takeScreenshot();
        else if (action === 'upload-file') document.getElementById('fileInput').click();
        else if (action === 'upload-image') document.getElementById('imageInput').click();
        else if (action === 'direct-mode') toggleDirectMode();
        else if (action === 'voice') startVoice();
        else if (action === 'agent-type') openAgentSelector();
      });
    });

    function toggleDirectMode() {
      state.directMode = !state.directMode;
      document.getElementById('directModePill').style.display = state.directMode ? 'inline-flex' : 'none';
      toast(state.directMode ? '已开启「直接操作电脑」模式' : '已关闭「直接操作电脑」模式');
    }

    async function takeScreenshot() {
      try {
        const overlay = document.getElementById('cropOverlay');
        const selection = document.getElementById('cropSelection');
        const video = document.getElementById('cropVideo');
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        video.srcObject = stream;
        await video.play();
        overlay.style.display = 'block';
        selection.style.display = 'none';
        let startX = 0, startY = 0, drawing = false;
        const onDown = (e) => {
          drawing = true;
          startX = e.clientX; startY = e.clientY;
          selection.style.display = 'block';
          selection.style.left = startX + 'px';
          selection.style.top = startY + 'px';
          selection.style.width = '0px';
          selection.style.height = '0px';
        };
        const onMove = (e) => {
          if (!drawing) return;
          const x = Math.min(e.clientX, startX), y = Math.min(e.clientY, startY);
          const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
          selection.style.left = x + 'px';
          selection.style.top = y + 'px';
          selection.style.width = w + 'px';
          selection.style.height = h + 'px';
        };
        const finish = async (e) => {
          if (!drawing) return;
          drawing = false;
          window.removeEventListener('mousedown', onDown);
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', finish);
          const x = Math.min(e.clientX, startX), y = Math.min(e.clientY, startY);
          const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
          overlay.style.display = 'none';
          if (w < 8 || h < 8) { stream.getTracks().forEach((t) => t.stop()); return; }
          try {
            const srcW = video.videoWidth, srcH = video.videoHeight;
            const scaleX = srcW / window.innerWidth, scaleY = srcH / window.innerHeight;
            const sx = Math.round(x * scaleX), sy = Math.round(y * scaleY);
            const sw = Math.round(w * scaleX), sh = Math.round(h * scaleY);
            const canvas = document.createElement('canvas');
            canvas.width = sw; canvas.height = sh;
            canvas.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
            stream.getTracks().forEach((t) => t.stop());
            const dataUrl = canvas.toDataURL('image/png');
            stageFile({ name: 'screenshot.png', mime: 'image/png', dataUrl });
            toast('截图已加入暂存，点发送时一起发给 AI');
          } catch (err) { toast('截图失败：' + err.message); }
        };
        const onKey = (e) => {
          if (e.key === 'Escape') {
            overlay.style.display = 'none';
            stream.getTracks().forEach((t) => t.stop());
            window.removeEventListener('mousedown', onDown);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', finish);
            window.removeEventListener('keydown', onKey);
          }
        };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', finish);
        window.addEventListener('keydown', onKey);
      } catch (e) { toast('截图失败：' + e.message); }
    }

    function handleUpload(input, mimePrefix) {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        stageFile({ name: file.name, mime: file.type || mimePrefix, dataUrl: String(reader.result) });
        toast('已暂存：' + file.name + '（点发送时一起发给 AI）');
      };
      reader.readAsDataURL(file);
      input.value = '';
    }
    document.getElementById('fileInput').addEventListener('change', function() { handleUpload(this, 'application/octet-stream'); });
    document.getElementById('imageInput').addEventListener('change', function() { handleUpload(this, 'image/png'); });

    /* ========== 大模型配置（三重加密：密钥 RSA 加密传输，服务端 AES 加密落盘） ========== */
    // 第二重（通信层）：用服务器 RSA 公钥加密敏感文本（如模型 API Key）
    async function rsaEncryptText(text) {
      if (!text) return '';
      const d = await api('/api/security/public-key');
      const b64 = String(d.publicKey || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
      if (!b64) throw new Error('未获取到加密公钥');
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const key = await crypto.subtle.importKey('spki', buf.buffer, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
      const enc = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(text));
      return btoa(String.fromCharCode.apply(null, new Uint8Array(enc)));
    }
    async function loadModels() {
      try {
        const d = await api('/api/models');
        state.models = d.models || [];
        state.defaultModelId = d.defaultId || null;
        const manual = localStorage.getItem('fhcode.model');
        if (manual !== null && manual !== '') {
          state.modelId = manual;
        } else {
          state.modelId = state.defaultModelId || '';
        }
        renderModelSelect();
      } catch (e) { console.warn('加载大模型失败', e); }
    }
    function renderModelSelect() {
      const sel = document.getElementById('modelSelect');
      const opts = ['<option value="">默认（系统路由）</option>'];
      state.models.forEach((m) => {
        opts.push('<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.name) + (m.default ? ' ★' : '') + '</option>');
      });
      sel.innerHTML = opts.join('');
      sel.value = state.modelId || '';
    }
    function openModels() {
      renderModelList();
      resetModelForm();
      openModal('modelModal');
    }
    function renderModelList() {
      const list = document.getElementById('modelList');
      if (!state.models.length) {
        list.innerHTML = '<div class="empty">还没有大模型配置，请在下方添加。</div>';
        return;
      }
      list.innerHTML = state.models.map((m) => (
        '<div class="model-item" data-id="' + escapeHtml(m.id) + '">' +
          '<div><div class="mi-name">' + escapeHtml(m.name) + '</div>' +
          '<div class="mi-base">' + escapeHtml(m.apiBase || '（未填写 API 地址）') + (m.reasoning ? ' · 已配推理内容' : '') + '</div></div>' +
          (m.default ? '<span class="mi-default">默认</span>' : '') +
          '<div class="mi-actions">' +
            (m.default ? '' : '<button data-act="default">设为默认</button>') +
            '<button data-act="edit">编辑</button>' +
            '<button class="danger" data-act="del">删除</button>' +
          '</div>' +
        '</div>'
      )).join('');
      list.querySelectorAll('.model-item').forEach((el) => {
        const id = el.getAttribute('data-id');
        el.querySelectorAll('button').forEach((b) => {
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = b.getAttribute('data-act');
            if (act === 'default') setDefaultModel(id);
            else if (act === 'edit') editModel(id);
            else if (act === 'del') deleteModel(id);
          });
        });
      });
    }
    function resetModelForm() {
      document.getElementById('modelName').value = '';
      document.getElementById('modelApiBase').value = '';
      document.getElementById('modelApiKey').value = '';
      document.getElementById('modelReasoning').value = '';
      document.getElementById('modelFormMsg').textContent = '';
      document.getElementById('modelFormMsg').classList.remove('err');
      document.getElementById('modelSaveBtn').dataset.editing = '';
    }
    function editModel(id) {
      const m = state.models.find((x) => x.id === id);
      if (!m) return;
      document.getElementById('modelName').value = m.name;
      document.getElementById('modelApiBase').value = m.apiBase || '';
      document.getElementById('modelApiKey').value = ''; // 密钥不回填（服务端加密存储，防泄露）
      document.getElementById('modelReasoning').value = m.reasoning || '';
      document.getElementById('modelFormMsg').textContent = '正在编辑：' + m.name + '（密钥已加密存储，留空保持不变）';
      document.getElementById('modelFormMsg').classList.remove('err');
      document.getElementById('modelSaveBtn').dataset.editing = id;
    }
    async function saveModel() {
      const name = document.getElementById('modelName').value.trim();
      const apiBase = document.getElementById('modelApiBase').value.trim();
      const apiKey = document.getElementById('modelApiKey').value;
      const reasoning = document.getElementById('modelReasoning').value;
      const msg = document.getElementById('modelFormMsg');
      if (!name) { msg.textContent = '请填写模型名称'; msg.classList.add('err'); return; }
      const editing = document.getElementById('modelSaveBtn').dataset.editing;
      try {
        const body = { name, apiBase, reasoning };
        // 三重加密·通信层：密钥经 RSA 公钥加密传输，杜绝明文出网（编辑留空则服务端保留原密钥）
        if (apiKey) body.apiKeyEnc = await rsaEncryptText(apiKey);
        if (editing) body.id = editing;
        const d = await api('/api/models', 'POST', body);
        msg.textContent = '已保存：' + d.model.name;
        msg.classList.remove('err');
        await loadModels();
        renderModelList();
        resetModelForm();
      } catch (e) { msg.textContent = '保存失败：' + e.message; msg.classList.add('err'); }
    }
    async function deleteModel(id) {
      try {
        await api('/api/models/' + encodeURIComponent(id), 'DELETE');
        toast('已删除配置');
        await loadModels();
        renderModelList();
      } catch (e) { toast('删除失败：' + e.message); }
    }
    async function setDefaultModel(id) {
      try {
        const d = await api('/api/models/' + encodeURIComponent(id) + '/default', 'POST');
        state.defaultModelId = d.defaultId;
        state.modelId = d.defaultId;
        localStorage.setItem('fhcode.model', '');
        renderModelSelect();
        renderModelList();
        renderModelListInline();
        toast('已设为默认大模型');
      } catch (e) { toast('设置失败：' + e.message); }
    }
    // 持久化会话配置到 localStorage
    function persistSessionConfig() {
      localStorage.setItem('fhcode.sessionConfig', JSON.stringify(state.sessionConfig));
    }
    // 切换会话模式（打开/发送时自动重置）
    document.querySelectorAll('.session-toggle').forEach((el) => {
      el.addEventListener('change', () => {
        const key = el.dataset.key;
        state.sessionConfig[key] = el.checked;
        persistSessionConfig();
        toast('会话配置已保存');
      });
    });
    document.getElementById('modelSaveBtn').addEventListener('click', saveModel);
    document.getElementById('modelResetBtn').addEventListener('click', resetModelForm);
    document.getElementById('modelSettingsShortcut').addEventListener('click', openModels);
    document.getElementById('modelSelect').addEventListener('change', (e) => {
      state.modelId = e.target.value || '';
      localStorage.setItem('fhcode.model', state.modelId);
      const m = state.models.find((x) => x.id === state.modelId);
      toast(m ? ('已切换：' + m.name) : '已切换：系统默认路由');
    });

    /* ========== 设置面板 ========== */
    function openSettings() {
      // 打开设置时同步会话开关状态，避免界面显示与真实配置不一致
      document.querySelectorAll('.session-toggle').forEach((el) => {
        const key = el.dataset.key;
        if (key && key in state.sessionConfig) el.checked = !!state.sessionConfig[key];
      });
      openModal('settingsModal');
    }
    document.querySelectorAll('#settingsModal .settings-cat').forEach((c) => {
      c.addEventListener('click', () => {
        const cat = c.getAttribute('data-cat');
        document.querySelectorAll('#settingsModal .settings-cat').forEach((x) => x.classList.toggle('active', x === c));
        document.querySelectorAll('#settingsModal .settings-group').forEach((g) => {
          g.style.display = g.getAttribute('data-group') === cat ? '' : 'none';
        });
      });
    });
    document.querySelectorAll('#settingsModal .settings-item').forEach((it) => {
      it.addEventListener('click', () => {
        const act = it.getAttribute('data-action');
        if (act === 'perm') { closeModal('settingsModal'); openPermissions(); }
        else if (act === 'theme') { closeModal('settingsModal'); toggleTheme(); }
        else if (act === 'model-custom') { toggleModelManage(); }
      });
    });
    function toggleModelManage() {
      const box = document.getElementById('modelManage');
      const open = box.style.display === 'none' || !box.style.display;
      box.style.display = open ? '' : 'none';
      if (open) { renderModelListInline(); resetInlineForm(); }
    }
    function renderModelListInline() {
      const list = document.getElementById('modelListInline');
      if (!state.models.length) {
        list.innerHTML =
          '<div class="mm-empty">' +
            '<div class="mm-empty-icon">🧠</div>' +
            '<div>还没有模型配置</div>' +
            '<div class="mm-empty-hint">在下方添加第一个模型，保存后即可在对话中使用</div>' +
          '</div>';
        return;
      }
      list.innerHTML = state.models.map((m) => {
        const url = (m.apiBase || '').trim() || '（未填写 API 地址）';
        const meta = m.reasoning ? '已配置推理中间环节' : '未配置推理中间环节';
        const tag = m.default ? '<span class="mm-default-tag">默认</span>' : '';
        const defaultBtn = m.default ? '' : '<button class="mm-act mm-act-primary" data-act="default">设为默认</button>';
        return (
          '<div class="mm-card" data-id="' + escapeHtml(m.id) + '">' +
            '<div class="mm-card-head">' +
              '<span class="mm-card-name">' + escapeHtml(m.name) + '</span>' +
              tag +
            '</div>' +
            '<div class="mm-card-url">' + escapeHtml(url) + '</div>' +
            '<div class="mm-card-meta">' + meta + '</div>' +
            '<div class="mm-card-actions">' +
              defaultBtn +
              '<button class="mm-act" data-act="edit">编辑</button>' +
              '<button class="mm-act mm-act-danger" data-act="del">删除</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');
      list.querySelectorAll('.mm-card').forEach((el) => {
        const id = el.getAttribute('data-id');
        el.querySelectorAll('button').forEach((b) => {
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = b.getAttribute('data-act');
            if (act === 'default') setDefaultModel(id);
            else if (act === 'edit') fillInlineForm(id);
            else if (act === 'del') deleteModel(id);
          });
        });
      });
    }
    function resetInlineForm() {
      document.getElementById('imName').value = '';
      document.getElementById('imBase').value = '';
      document.getElementById('imKey').value = '';
      document.getElementById('imReasoning').value = '';
      document.getElementById('imMsg').textContent = '';
      document.getElementById('imMsg').classList.remove('err');
      document.getElementById('imSave').dataset.editing = '';
    }
    function fillInlineForm(id) {
      const m = state.models.find((x) => x.id === id);
      if (!m) return;
      document.getElementById('imName').value = m.name;
      document.getElementById('imBase').value = m.apiBase || '';
      document.getElementById('imKey').value = ''; // 密钥不回填（服务端加密存储，防泄露）
      document.getElementById('imReasoning').value = m.reasoning || '';
      document.getElementById('imMsg').textContent = '正在编辑：' + m.name + '（密钥已加密存储，留空保持不变）';
      document.getElementById('imMsg').classList.remove('err');
      document.getElementById('imSave').dataset.editing = id;
    }
    async function saveInlineModel() {
      const name = document.getElementById('imName').value.trim();
      const apiBase = document.getElementById('imBase').value.trim();
      const apiKey = document.getElementById('imKey').value;
      const reasoning = document.getElementById('imReasoning').value;
      const msg = document.getElementById('imMsg');
      if (!name) { msg.textContent = '请填写模型名称'; msg.classList.add('err'); return; }
      const editing = document.getElementById('imSave').dataset.editing;
      try {
        const body = { name, apiBase, reasoning };
        // 三重加密·通信层：密钥 RSA 加密传输
        if (apiKey) body.apiKeyEnc = await rsaEncryptText(apiKey);
        if (editing) body.id = editing;
        const d = await api('/api/models', 'POST', body);
        msg.textContent = '已保存：' + d.model.name;
        msg.classList.remove('err');
        await loadModels();
        renderModelListInline();
        resetInlineForm();
      } catch (e) { msg.textContent = '保存失败：' + e.message; msg.classList.add('err'); }
    }
    document.getElementById('imSave').addEventListener('click', saveInlineModel);
    document.getElementById('imReset').addEventListener('click', resetInlineForm);
    document.getElementById('modelManageClose')?.addEventListener('click', () => { document.getElementById('modelManage').style.display = 'none'; });

    /* ========== 通话控件 ========== */
    let callStream = null;
    async function startCall(kind) {
      const status = document.getElementById('callStatus');
      try {
        const constraints = kind === 'video' ? { audio: true, video: true } : { audio: true };
        callStream = await navigator.mediaDevices.getUserMedia(constraints);
        status.textContent = (kind === 'video' ? '视频通话中' : '语音通话中') + '…';
        document.getElementById('hangupCallBtn').style.display = 'inline-block';
        toast('已发起' + (kind === 'video' ? '视频' : '语音') + '通话（演示）');
      } catch (e) {
        status.textContent = '';
        toast('无法发起通话：' + e.message);
      }
    }
    function hangupCall() {
      if (callStream) { callStream.getTracks().forEach((t) => t.stop()); callStream = null; }
      document.getElementById('callStatus').textContent = '';
      document.getElementById('hangupCallBtn').style.display = 'none';
      toast('已挂断');
    }
    document.getElementById('voiceCallBtn').addEventListener('click', () => startCall('voice'));
    document.getElementById('videoCallBtn').addEventListener('click', () => startCall('video'));
    document.getElementById('hangupCallBtn').addEventListener('click', hangupCall);

    function startVoice() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) { toast('当前浏览器不支持语音输入'); return; }
      const rec = new SpeechRecognition();
      rec.lang = 'zh-CN';
      rec.continuous = false;
      rec.interimResults = false;
      const badge = document.getElementById('voiceBadge');
      badge.style.display = 'inline-flex';
      rec.onresult = (e) => {
        const text = e.results[0][0].transcript;
        const input = document.getElementById('goalInput');
        input.value = (input.value ? input.value + ' ' : '') + text;
      };
      rec.onerror = (e) => { toast('语音识别失败：' + e.error); badge.style.display = 'none'; };
      rec.onend = () => { badge.style.display = 'none'; };
      rec.start();
    }

    /* ========== 智能体选择 ========== */
    function openAgentSelector() {
      const grid = document.getElementById('agentGrid');
      grid.innerHTML = Object.entries(AGENT_TYPES).map(([k, v]) =>
        '<div class="agent-card ' + (state.agentType === k ? 'selected' : '') + '" data-type="' + k + '"><div class="icon">' + v.icon + '</div><div class="title">' + v.label + '</div></div>'
      ).join('');
      grid.querySelectorAll('.agent-card').forEach((c) => c.addEventListener('click', () => {
        state.agentType = c.getAttribute('data-type');
        updateUserBar();
        closeModal('agentModal');
        toast('已切换：' + AGENT_TYPES[state.agentType].label);
      }));
      openModal('agentModal');
    }
    document.getElementById('skillPill').addEventListener('click', openAgentSelector);

    /* ========== 权限窗口 ========== */
    function openPermissions() {
      const p = state.permissions;
      document.querySelector('input[name="readScope"][value="' + p.readScope + '"]').checked = true;
      document.getElementById('permReadPath').value = p.readPath || '';
      document.getElementById('permRead').checked = p.allowRead;
      document.getElementById('permWrite').checked = p.allowWrite;
      document.getElementById('permShell').checked = p.allowShell;
      document.getElementById('permNetwork').checked = p.allowNetwork;
      document.getElementById('permBrowser').checked = p.allowBrowser;
      openModal('permModal');
    }
    document.getElementById('permSaveBtn').addEventListener('click', () => {
      const scope = document.querySelector('input[name="readScope"]:checked')?.value || 'workspace';
      state.permissions = {
        readScope: scope,
        readPath: document.getElementById('permReadPath').value.trim(),
        allowRead: document.getElementById('permRead').checked,
        allowWrite: document.getElementById('permWrite').checked,
        allowShell: document.getElementById('permShell').checked,
        allowNetwork: document.getElementById('permNetwork').checked,
        allowBrowser: document.getElementById('permBrowser').checked,
      };
      localStorage.setItem('fhcode.permissions', JSON.stringify(state.permissions));
      closeModal('permModal');
      toast('权限配置已保存');
    });

    /* ========== 工作区 ========== */
    async function loadWorkspace() {
      if (!state.token) {
        console.warn('[workspace] 未登录，跳过加载');
        return;
      }
      try {
        const d = await api('/api/workspace');
        state.workspaceDir = d.cwd;
        // 持久化到 localStorage
        localStorage.setItem('fhcode.workspaceDir', d.cwd);
        renderWorkspaceBar();
        console.log('[workspace] 加载成功:', d.cwd);
      } catch (e) {
        console.error('[workspace] 加载失败:', e.message);
        toast('工作区加载失败，请检查登录状态');
      }
    }
    async function loadWorkspaceTree(dir) {
      // 已废弃：左侧工作区树已移除，保留此函数仅供兼容
      return;
    }
    // 工作区跳转功能已移除（旧布局左侧工作区树）

    function renderWorkspaceBar() {
      const el = document.getElementById('workspaceCwdBottom');
      if (el) el.textContent = state.workspaceDir || '（未设置）';
    }
    document.getElementById('workspacePermBadge')?.addEventListener('click', () => openPermissions());
    document.getElementById('workspacePickBtn')?.addEventListener('click', () => {
      openFolderPicker();
    });

    let fpCurrent = '';
    function getDirectoryName(path) {
      console.log('[getDirectoryName] input:', path);
      // 处理 Windows 驱动器根目录: C:, D:, H: 等
      if (!path || path === '' || path === '/') return '/';
      // 检查是否是纯驱动器字母（如 H:）
      if (/^[A-Za-z]:$/.test(path)) { const r = path + '\\'; console.log('[getDirectoryName] result:', r); return r; }
      // 检查是否是驱动器根目录（如 H:\）
      if (/^[A-Za-z]:\\$/.test(path)) { console.log('[getDirectoryName] result:', path); return path; }
      const parts = path.split(/[/\\]/).filter(Boolean);
      console.log('[getDirectoryName] parts:', parts);
      if (parts.length <= 1) {
        const driveMatch = parts[0].match(/^([A-Za-z]):$/);
        if (driveMatch) { const r = driveMatch[1] + ':' + '\\'; console.log('[getDirectoryName] result:', r); return r; }
        return parts[0] || '/';
      }
      const parentParts = parts.slice(0, -1);
      const firstPart = parentParts[0];
      if (/^[A-Za-z]:$/.test(firstPart)) {
        // Windows 驱动器根目录特殊处理
        const r = firstPart + '\\' + parentParts.slice(1).join('\\');
        console.log('[getDirectoryName] result:', r, '(parentParts:', parentParts + ')');
        return r;
      }
      const r = parentParts.join('\\');
      console.log('[getDirectoryName] result:', r);
      return r;
    }
    async function openFolderPicker() {
      console.log('[folderPicker] 打开文件夹选择器');
      console.log('[folderPicker] 当前 state.workspaceDir:', state.workspaceDir);
      console.log('[folderPicker] 当前 state.token:', state.token ? '已登录' : '未登录');

      // 如果 workspaceDir 为空，尝试从 localStorage 恢复或询问用户
      let initialDir = state.workspaceDir;
      if (!initialDir) {
        // 尝试从 localStorage 恢复
        const savedCwd = localStorage.getItem('fhcode.workspaceDir');
        if (savedCwd) {
          initialDir = savedCwd;
          console.log('[folderPicker] 从 localStorage 恢复工作区:', initialDir);
        } else {
          // 使用默认路径
          initialDir = '.';
          console.log('[folderPicker] 使用默认路径:', initialDir);
        }
      }

      fpCurrent = initialDir || '.';
      const fpPathEl = document.getElementById('fpPath');
      if (fpPathEl) fpPathEl.textContent = fpCurrent || '（根目录）';

      try {
        console.log('[folderPicker] 加载目录列表:', fpCurrent);
        await loadFolderPicker(fpCurrent);
        console.log('[folderPicker] 目录加载成功');
      } catch (e) {
        console.error('[folderPicker] 加载失败:', e);
        toast('读取目录失败：' + e.message);
        return;
      }
      openModal('folderPickerModal');
      console.log('[folderPicker] 模态框已打开');
    }
    async function loadFolderPicker(dir) {
      console.log('[folderPicker] 加载:', dir);
      const d = await api('/api/workspace/list?path=' + encodeURIComponent(dir));
      fpCurrent = d.cwd;
      const fpPathEl = document.getElementById('fpPath');
      if (fpPathEl) fpPathEl.textContent = fpCurrent;
      const tree = document.getElementById('fpTree');
      if (!tree) {
        console.error('[folderPicker] fpTree 元素不存在');
        return;
      }
      const parentPath = getDirectoryName(d.cwd);
      // 如果在驱动器根目录，不显示".."，改为显示驱动器列表
      const isDriveRoot = /^[A-Za-z]:\\$/.test(d.cwd);
      let upButtonHtml = '';
      if (!isDriveRoot && parentPath && parentPath !== d.cwd) {
        upButtonHtml = '<div class="file-item" data-path="' + escapeHtml(parentPath) + '" data-type="up">⬆ ..</div>';
      } else if (isDriveRoot) {
        // 动态获取可用驱动器列表
        const drives = await getDrivesList();
        upButtonHtml = '<div class="file-item drive-switcher">' +
          '<span>🖥 切换驱动器</span>' +
          drives.map(d => '<div class="drive-option" data-drive="' + d + '">' + d + '</div>').join('') +
          '</div>';
      }
      tree.innerHTML = upButtonHtml +
        d.entries.map((e) => '<div class="file-item ' + (e.type === 'dir' ? 'dir' : '') + '" data-path="' + escapeHtml(e.path) + '" data-type="' + e.type + '">' + (e.type === 'dir' ? '📁' : '📄') + ' ' + escapeHtml(e.name) + '</div>').join('');
      console.log('[folderPicker] 目录渲染完成, 条目数:', d.entries.length);
    }
    // 驱动器列表缓存
    let _drivesCache = null;
    async function getDrivesList() {
      if (_drivesCache) return _drivesCache;
      try {
        const d = await api('/api/drives');
        _drivesCache = d.drives || [];
        return _drivesCache;
      } catch {
        return ['C:\\', 'D:\\', 'E:\\', 'F:\\', 'H:\\'];
      }
    }

    document.getElementById('fpConfirm')?.addEventListener('click', async () => {
      console.log('[folderPicker] 点击确认, 当前选择:', fpCurrent);
      try {
        console.log('[folderPicker] 提交切换工作区...');
        const result = await api('/api/workspace', 'POST', { cwd: fpCurrent });
        console.log('[folderPicker] API 返回:', result);
        state.workspaceDir = fpCurrent;
        // 持久化到 localStorage
        localStorage.setItem('fhcode.workspaceDir', fpCurrent);
        renderWorkspaceBar();
        closeModal('folderPickerModal');
        toast('已切换工作区：' + fpCurrent);
      } catch (e) {
        console.error('[folderPicker] 切换失败:', e);
        toast('设置失败：' + e.message);
      }
    });

    /* ========== 自动化、模板、市场、办公助理 ========== */
    async function loadAutomations() {
      try { const d = await api('/api/automations'); renderAutoGrid(d.automations || []); }
      catch (e) { console.warn('加载自动化失败', e); }
    }
    function renderAutoGrid(list) {
      const grid = document.getElementById('autoGrid');
      if (!list.length) { grid.innerHTML = '<div class="empty">还没有快捷指令</div>'; return; }
      grid.innerHTML = list.map((a) => '<div class="tile" data-id="' + a.id + '"><div class="icon">⚡</div><div class="title">' + escapeHtml(a.name) + '</div><div class="desc">' + escapeHtml(a.goal).slice(0, 60) + (a.goal.length > 60 ? '…' : '') + '<br>已运行 ' + a.runCount + ' 次</div><div class="ops"><button class="run" data-id="' + a.id + '">▶ 运行</button><button class="ghost del" data-id="' + a.id + '">删除</button></div></div>').join('');
      grid.querySelectorAll('button.run').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); runAuto(b.getAttribute('data-id')); }));
      grid.querySelectorAll('button.del').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); delAuto(b.getAttribute('data-id')); }));
    }
    async function runAuto(id) {
      try { const d = await api('/api/automations/' + id + '/run', 'POST'); toast('已发起任务，运行次数 ' + d.runCount); await loadTasks(); }
      catch (e) { toast('运行失败：' + e.message); }
    }
    async function delAuto(id) {
      try { await api('/api/automations/' + id, 'DELETE'); await loadAutomations(); toast('已删除'); }
      catch (e) { toast('删除失败：' + e.message); }
    }
    document.getElementById('newAutoBtn')?.addEventListener('click', () => openModal('autoModal'));
    document.getElementById('autoSaveBtn')?.addEventListener('click', async () => {
      const name = document.getElementById('autoName').value.trim();
      const goal = document.getElementById('autoGoal').value.trim();
      if (!name || !goal) { toast('请填写名称与目标'); return; }
      try { await api('/api/automations', 'POST', { name, goal }); closeModal('autoModal');
        const n = document.getElementById('autoName');
        const g = document.getElementById('autoGoal');
        if (n) n.value = ''; if (g) g.value = '';
        await loadAutomations(); toast('已保存'); }
      catch (e) { toast('保存失败：' + e.message); }
    });

    async function loadTemplates() {
      try { const d = await api('/api/templates'); renderBuiltin(d.builtin || []); renderUserTpl(d.user || []); }
      catch (e) { console.warn('加载模板失败', e); }
    }
    function tplCard(t, deletable) {
      return '<div class="tile" data-goal="' + encodeURIComponent(t.goal) + '"><div class="icon">' + (t.icon || '📄') + '</div><div class="title">' + escapeHtml(t.title) + '</div><div class="desc">' + escapeHtml(t.category || '') + ' · ' + escapeHtml(t.goal).slice(0, 40) + '…</div><div class="ops"><button class="use" data-goal="' + encodeURIComponent(t.goal) + '">填入输入框</button>' + (deletable ? '<button class="ghost del" data-id="' + t.id + '">删除</button>' : '') + '</div></div>';
    }
    function renderBuiltin(list) {
      const grid = document.getElementById('builtinGrid');
      if (!list.length) { grid.innerHTML = '<div class="empty">无内置模板</div>'; return; }
      grid.innerHTML = list.map((t) => tplCard(t, false)).join('');
      bindTplCards(grid);
    }
    function renderUserTpl(list) {
      const grid = document.getElementById('userTplGrid');
      if (!list.length) { grid.innerHTML = '<div class="empty">暂无自定义模板</div>'; return; }
      grid.innerHTML = list.map((t) => tplCard(t, true)).join('');
      bindTplCards(grid);
    }
    function bindTplCards(grid) {
      grid.querySelectorAll('button.use').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const inp = document.getElementById('goalInput');
        if (inp) inp.value = decodeURIComponent(b.getAttribute('data-goal'));
        switchView('chat');
        if (inp) inp.focus();
        toast('已填入输入框，去发送吧');
      }));
      grid.querySelectorAll('button.del').forEach((b) => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await api('/api/templates/' + b.getAttribute('data-id'), 'DELETE'); await loadTemplates(); toast('已删除'); }
        catch (err) { toast('删除失败：' + err.message); }
      }));
    }
    document.getElementById('newTplBtn')?.addEventListener('click', () => {
      const goal = document.getElementById('goalInput')?.value?.trim() || '';
      const inp = document.getElementById('tplGoal');
      if (inp) inp.value = goal;
      openModal('tplModal');
    });
    document.getElementById('tplSaveBtn')?.addEventListener('click', async () => {
      const title = document.getElementById('tplTitle').value.trim();
      const goal = document.getElementById('tplGoal').value.trim();
      const category = document.getElementById('tplCategory').value.trim();
      if (!title || !goal) { toast('请填写标题与内容'); return; }
      try { await api('/api/templates', 'POST', { title, goal, category }); closeModal('tplModal');
        const t = document.getElementById('tplTitle');
        const g = document.getElementById('tplGoal');
        const c = document.getElementById('tplCategory');
        if (t) t.value = ''; if (g) g.value = ''; if (c) c.value = '';
        await loadTemplates(); toast('已保存模板'); }
      catch (e) { toast('保存失败：' + e.message); }
    });

    async function loadMarket() {
      const q = document.getElementById('marketSearch').value.trim();
      const source = document.getElementById('marketSource').value;
      const grid = document.getElementById('marketGrid');
      grid.innerHTML = '<div class="empty">加载中…</div>';
      try {
        const params = new URLSearchParams({ source });
        if (q) params.set('q', q);
        const d = await api('/api/skills/market?' + params.toString());
        state.market = d.skills || [];
        await loadInstalled();   // 先加载已安装集合，市场按钮才能正确显示「已安装」态
        renderMarketGrid();
      } catch (e) { grid.innerHTML = '<div class="empty" style="color:var(--err)">加载失败：' + escapeHtml(e.message) + '</div>'; }
    }
    function renderMarketGrid() {
      const grid = document.getElementById('marketGrid');
      if (!state.market.length) { grid.innerHTML = '<div class="empty">没有找到技能</div>'; return; }
      grid.innerHTML = state.market.map((s) => {
        const installed = state.installed.has(s.id);
        const btn = installed
          ? '<button class="install" disabled style="opacity:.55;cursor:default;">✅ 已安装</button>'
          : '<button class="install" data-id="' + encodeURIComponent(s.id) + '" data-name="' + encodeURIComponent(s.name) + '" data-source="' + s.source + '">安装</button>';
        return '<div class="tile"><div class="icon">' + (s.source === 'clawhub' ? '🧩' : '🛠') + '</div><div class="title">' + escapeHtml(s.name) + '</div><div class="desc">' + escapeHtml(s.description).slice(0, 70) + '…<br><span class="muted">' + (s.source === 'clawhub' ? 'ClawHub' : 'Agent-Foundry') + ' · 下载 ' + (s.downloads || 0) + '</span></div><div class="ops">' + btn + '</div></div>';
      }).join('');
      grid.querySelectorAll('button.install').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        installSkill(b.getAttribute('data-id'), b.getAttribute('data-name'), b.getAttribute('data-source'));
      }));
    }
    async function installSkill(idEnc, nameEnc, source) {
      const id = decodeURIComponent(idEnc);
      const name = decodeURIComponent(nameEnc);
      try { await api('/api/skills/install', 'POST', { id, name, source }); toast('已安装：' + name); await loadInstalled(); }
      catch (e) { toast('安装失败：' + e.message); }
    }
    async function loadInstalled() {
      try {
        const d = await api('/api/skills/installed');
        state.installed = new Set((d.skills || []).map((s) => s.id));
        const grid = document.getElementById('installedGrid');
        if (!d.skills || !d.skills.length) { grid.innerHTML = '<div class="empty">暂无已安装技能</div>'; return; }
        grid.innerHTML = d.skills.map((s) => '<div class="tile"><div class="icon">✅</div><div class="title">' + escapeHtml(s.name) + '</div><div class="desc">' + escapeHtml(s.description || '').slice(0, 60) + '…</div></div>').join('');
      } catch (e) { console.warn('加载已安装失败', e); }
    }
    document.getElementById('marketRefresh')?.addEventListener('click', loadMarket);
    let marketTimer;
    document.getElementById('marketSearch')?.addEventListener('input', () => { clearTimeout(marketTimer); marketTimer = setTimeout(loadMarket, 400); });
    document.getElementById('marketSource')?.addEventListener('change', loadMarket);

    async function loadOffice() {
      try {
        const d = await api('/api/office/capabilities');
        const grid = document.getElementById('officeGrid');
        grid.innerHTML = (d.capabilities || []).map((c) => '<div class="tile" data-prompt="' + encodeURIComponent(c.prompt) + '"><div class="icon">' + c.icon + '</div><div class="title">' + escapeHtml(c.title) + '</div><div class="desc">' + escapeHtml(c.desc) + '</div><div class="ops"><button class="use" data-prompt="' + encodeURIComponent(c.prompt) + '">生成提示词</button></div></div>').join('');
        grid.querySelectorAll('button.use').forEach((b) => b.addEventListener('click', (e) => {
          e.stopPropagation();
          const inp = document.getElementById('goalInput');
          if (inp) inp.value = decodeURIComponent(b.getAttribute('data-prompt'));
          switchView('chat');
          if (inp) inp.focus();
          toast('已填入提示词');
        }));
      } catch (e) { document.getElementById('officeGrid').innerHTML = '<div class="empty" style="color:var(--err)">加载失败：' + escapeHtml(e.message) + '</div>'; }
    }

    document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => closeModal(el.getAttribute('data-close'))));
    document.querySelectorAll('.mask').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('show'); }));
    // 文件夹选择器点击事件（只绑定一次，避免累积）
    document.getElementById('fpTree')?.addEventListener('click', async (e) => {
      const driveOption = e.target.closest('.drive-option');
      if (driveOption) {
        e.stopPropagation();
        const drive = driveOption.getAttribute('data-drive');
        console.log('[folderPicker] 选择驱动器:', drive);
        try { await loadFolderPicker(drive); } catch (err) { toast('读取失败：' + err.message); }
        return;
      }
      const item = e.target.closest('.file-item');
      if (!item) return;
      const type = item.getAttribute('data-type');
      const path = item.getAttribute('data-path');
      console.log('[folderPicker] 点击:', type, path);
      if (type === 'dir' || type === 'up') {
        try { await loadFolderPicker(path); } catch (e) { toast('读取失败：' + e.message); }
      } else if (type) {
        previewFile(path);
      }
    });
    function startRefresh() { setInterval(loadTasks, 5000); }

    /* ========== 记忆系统 ========== */
    async function loadMemoryStats() {
      try {
        const d = await api('/api/memory/stats');
        document.getElementById('statShortDays').textContent = d.shortTermFiles + ' 天';
        document.getElementById('statLongNotes').textContent = d.longTermNotes + ' 条';
        document.getElementById('statLastSum').textContent = d.lastSummarize || '暂无';
        // 计算下次自动总结时间（今晚24:00）
        const now = new Date();
        const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
        document.getElementById('statNextSum').textContent = next.toLocaleString('zh-CN', { hour12: false });
      } catch (e) { console.warn('加载记忆统计失败', e); }
    }

    async function loadMemoryContent(dateStr) {
      try {
        const d = await api('/api/memory/short?date=' + dateStr);
        const content = document.getElementById('memShortContent');
        if (!d || !d.content) {
          content.innerHTML = '<div class="empty">当天暂无记录</div>';
          return;
        }
        content.innerHTML = formatMarkdown(d.content);
        document.getElementById('memDateLabel').textContent = '📅 ' + dateStr;
      } catch (e) { toast('加载失败：' + e.message); }
    }

    async function loadLongTermMemory() {
      try {
        const d = await api('/api/memory/long');
        const content = document.getElementById('memLongContent');
        if (!d || !d.content) {
          content.innerHTML = '<div class="empty">长期记忆为空</div>';
          return;
        }
        content.innerHTML = formatMarkdown(d.content);
      } catch (e) { toast('加载失败：' + e.message); }
    }

    async function loadSummaryHistory() {
      try {
        const d = await api('/api/memory/history?limit=20');
        const content = document.getElementById('memHistoryContent');
        const list = d.history || [];
        if (!list.length) {
          content.innerHTML = '<div class="empty">暂无总结历史</div>';
          return;
        }
        content.innerHTML = list.map(h =>
          '<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">' +
          '<strong>' + h.date + '</strong> → ' + h.newEntries + ' 条新增, ' + h.updatedEntries + ' 条更新<br>' +
          '<span class="muted">' + h.timestamp + '</span>' +
          '</div>'
        ).join('');
      } catch (e) { toast('加载失败：' + e.message); }
    }

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

    function initMemoryUI() {
      // 设置默认日期为今天
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('memDateInput').value = today;
      loadMemoryContent(today);

      // 事件只绑定一次（多次进出记忆页会累积监听器，导致一次点击多次请求）
      if (!window._memUIInited) {
        window._memUIInited = true;

        // Tab 切换
        document.querySelectorAll('.mem-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            document.querySelectorAll('.mem-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.mem-panel').forEach(p => p.classList.toggle('active', false));
            tab.classList.add('active');
            const panelId = tab.getAttribute('data-memtab') + 'Panel';
            document.getElementById(panelId)?.classList.add('active');
          });
        });

        // 查看按钮
        document.getElementById('memLoadDay')?.addEventListener('click', () => {
          const dateStr = document.getElementById('memDateInput').value;
          if (dateStr) loadMemoryContent(dateStr);
        });

        // 刷新按钮
        document.getElementById('memRefreshBtn')?.addEventListener('click', () => {
          loadMemoryStats();
          const dateStr = document.getElementById('memDateInput').value;
          if (dateStr) loadMemoryContent(dateStr);
          loadLongTermMemory();
        });

        // 立即总结按钮
        document.getElementById('memSummarizeBtn')?.addEventListener('click', async () => {
          const btn = document.getElementById('memSummarizeBtn');
          btn.disabled = true;
          btn.textContent = '⏳ 总结中...';
          try {
            const dateStr = document.getElementById('memDateInput').value || today;
            const d = await api('/api/memory/summarize', 'POST', { date: dateStr });
            toast('✅ ' + (d.message || '总结完成'));
            loadMemoryStats();
            loadSummaryHistory();
          } catch (e) {
            toast('总结失败：' + e.message);
          } finally {
            btn.disabled = false;
            btn.textContent = '✨ 立即总结';
          }
        });
      }

      // 每次进入都刷新数据（事件不重复绑定，数据实时刷新）
      loadMemoryStats();
      loadLongTermMemory();
      loadSummaryHistory();
    }

    // 当切换到记忆页面时初始化
    const origSwitchView = switchView;
    window.switchView = function(nav) {
      origSwitchView(nav);
      if (nav === 'memory') {
        setTimeout(initMemoryUI, 100);
      }
    };

    if (state.token && state.phone) {
      document.getElementById('loginOverlay').style.display = 'none';
      document.getElementById('appLayout').classList.add('show');
      afterLogin();
    }
