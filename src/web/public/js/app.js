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
    
    
    /**
     * 安全地把某个元素的 i18n 文案落地。
     * 关键约束（曾导致「模型无法切换」「侧边栏图标消失」的线上问题）：
     *  - <select> 绝对不能写 textContent，否则会把所有 <option> 一次性清空；
     *  - <input>/<textarea> 只改 placeholder，且必须命中专用键，避免误翻；
     *  - 含子元素的容器（图标 + 标签）只改 title / 直接文本节点，绝不整体覆盖。
     */

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


    /* ========== 导航切换 ========== */

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
    async function selectTask(id) {
      state.currentTaskId = id;
      renderSidebarTaskList();
      renderTaskDetail(id);
      await refreshCurrentThread();
      switchRightTab('detail');
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
    /** 切换工具调用参数详情显示/隐藏 */

    /** 群组渲染助手消息为 Cursor 风格的思考过程 + 回复 */

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


    // 将单个任务渲染为对话框：对话流（用户↔助手干净气泡）+ 内部执行过程（默认折叠）
    // 单条执行步骤渲染（思维链路、工具调用、验证结果、自愈/压缩等）
    /* 轻量 Markdown 渲染（用于模型推理内容） */
    /* 工具参数格式化为 key: value 列表 */

    /* ========== 右侧 Tab ========== */
    document.querySelectorAll('.right-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchRightTab(tab.getAttribute('data-tab')));
    });

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
    // 持久化会话配置到 localStorage
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
    document.getElementById('skillPill').addEventListener('click', openAgentSelector);

    /* ========== 权限窗口 ========== */
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
    // 工作区跳转功能已移除（旧布局左侧工作区树）

    document.getElementById('workspacePermBadge')?.addEventListener('click', () => openPermissions());
    document.getElementById('workspacePickBtn')?.addEventListener('click', () => {
      openFolderPicker();
    });

    let fpCurrent = '';
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

    document.getElementById('marketRefresh')?.addEventListener('click', loadMarket);
    let marketTimer;
    document.getElementById('marketSearch')?.addEventListener('input', () => { clearTimeout(marketTimer); marketTimer = setTimeout(loadMarket, 400); });
    document.getElementById('marketSource')?.addEventListener('change', loadMarket);


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
