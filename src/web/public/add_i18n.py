#!/usr/bin/env python3
"""为 index.html 添加 data-i18n 标记"""
import re

with open('H:/Muse Code复刻/src/web/public/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# i18n mapping: Chinese text -> key
i18n_map = [
    # Login
    ('飞虹 Code 控制台', 'app.title_login'),
    ('请输入手机号码直接登录', 'app.login_hint'),
    ('手机号码', 'login.phone_label'),
    ('手机号登录', 'login.btn_login'),
    # Topbar brand
    ('飞虹 Code', 'app.brand'),
    # Topbar nav
    ('💬 对话', 'nav.chat'),
    ('⚡ 自动化', 'nav.automations'),
    ('📚 模板库', 'nav.templates'),
    ('🧩 插件', 'nav.market'),
    ('📎 办公', 'nav.office'),
    ('🧠 记忆', 'nav.memory'),
    # Sidebar
    ('导航', 'sidebar.nav'),
    ('对话任务', 'sidebar.chat'),
    ('自动化', 'sidebar.automations'),
    ('模板库', 'sidebar.templates'),
    ('插件市场', 'sidebar.market'),
    ('办公助理', 'sidebar.office'),
    ('记忆系统', 'sidebar.memory'),
    ('用户', 'sidebar.user'),
    ('设置', 'sidebar.settings'),
    # Task list
    ('任务列表', 'sidebar.task_list'),
    ('＋ 新建任务', 'btn.new_task'),
    ('暂无任务', 'empty.no_tasks'),
    # Task context header
    ('未选择任务', 'task.not_selected'),
    ('从左侧任务列表选择，或在下方输入指令发起新任务', 'task.select_hint'),
    ('刷新当前任务', 'task.refresh'),
    # Chat area
    ('点击「＋ 新建任务」开启一个新任务，或直接在下方向当前任务发送消息——所有对话都会归属同一个任务运行。', 'chat.welcome'),
    ('输入指令，消息将归属当前任务持续对话；点上方「＋ 新建任务」可开启新任务（创建 → 推理 → 工具验证 → 闭环全程追踪）', 'chat.input_placeholder'),
    ('＋ 菜单', 'chat.menu'),
    ('📷 截图', 'chat.screenshot'),
    ('📄 上传文件', 'chat.upload_file'),
    ('🖼 上传图片', 'chat.upload_image'),
    ('🖥 直接操作电脑', 'chat.direct_mode'),
    ('🎤 语音输入', 'chat.voice'),
    ('🤖 选择智能体类型', 'chat.agent_type'),
    ('🤖 通用助手', 'chat.agent_default'),
    ('● 正在听…', 'chat.listening'),
    ('▶ 发送', 'chat.send'),
    ('加载中…', 'common.loading'),
    ('默认权限', 'perm.default'),
    ('通话', 'call.hint'),
    ('📞 语音', 'call.voice'),
    ('🎥 视频', 'call.video'),
    ('⛔ 挂断', 'call.hangup'),
    # Automations page
    ('把常用目标存成指令，一键发起任务', 'page.automations.sub'),
    ('+ 新建指令', 'btn.new_automation'),
    ('还没有快捷指令', 'empty.no_automations'),
    # Templates page
    ('点击模板即可填充到输入框', 'page.templates.sub'),
    ('+ 保存当前为模板', 'btn.save_template'),
    ('内置模板', 'tpl.builtin'),
    ('我的模板', 'tpl.my'),
    ('暂无自定义模板', 'empty.no_templates'),
    # Market page
    ('聚合 ClawHub 与 Agent-Foundry 技能生态', 'page.market.sub'),
    ('搜索…', 'market.search_placeholder'),
    ('全部来源', 'market.source_all'),
    ('刷新', 'btn.refresh'),
    ('已安装', 'market.installed'),
    ('暂无已安装技能', 'empty.no_installed'),
    # Office page
    ('文档处理快捷入口，点击即生成提示词', 'page.office.sub'),
    # Memory page
    ('短期记忆每日自动整理，沉淀长期知识', 'page.memory.sub'),
    ('🔄 刷新', 'btn.refresh_mem'),
    ('✨ 立即总结', 'btn.summarize'),
    ('短期记忆天数', 'mem.stat_short_days'),
    ('长期记忆条目', 'mem.stat_long_items'),
    ('上次总结', 'mem.stat_last_summary'),
    ('下次自动总结', 'mem.stat_next_summary'),
    ('📅 短期记忆', 'mem.tab_short'),
    ('💾 长期记忆', 'mem.tab_long'),
    ('📜 总结历史', 'mem.tab_history'),
    ('查看', 'btn.view'),
    ('选择日期查看短期记忆', 'mem.select_date'),
    ('暂无总结记录', 'empty.no_history'),
    # Bottom toolbar
    ('提交自然语言需求，云端静默执行并回传结果', 'footbar.desc'),
    ('大模型', 'footbar.model'),
    ('切换当前使用的大模型', 'footbar.model_title'),
    ('大模型设置', 'footbar.model_settings'),
    ('默认（系统路由）', 'footbar.model_default'),
    # Right panel
    ('📦 任务详情', 'right.detail'),
    ('👁 产物预览', 'right.preview'),
    ('从顶部选择一个任务查看详情。', 'right.detail_hint'),
    ('预览', 'right.preview_title'),
    ('点击任务或对话中的文件/代码进行预览。', 'right.preview_hint'),
    # Modals
    ('新建快捷指令', 'modal.auto_title'),
    ('保存后可在「自动化」页一键发起任务。', 'modal.auto_hint'),
    ('指令名称', 'modal.auto_name'),
    ('目标（提交给模型的需求）', 'modal.auto_goal'),
    ('运行 npm test 并汇总失败用例…', 'modal.auto_goal_ph'),
    ('取消', 'btn.cancel'),
    ('保存', 'btn.save'),
    ('保存为模板', 'modal.tpl_title'),
    ('模板标题', 'modal.tpl_title_label'),
    ('分类', 'modal.tpl_category'),
    ('目标内容', 'modal.tpl_goal'),
    ('粘贴要保存的需求文本…', 'modal.tpl_goal_ph'),
    ('自定义', 'modal.tpl_category_ph'),
    ('如：每日构建检查', 'modal.auto_name_ph'),
    ('如：SQL 优化', 'modal.tpl_title_ph'),
    # Permission modal
    ('🔒 权限处理窗口', 'modal.perm_title'),
    ('配置工作期间 AI 可读范围及可操作权限。', 'modal.perm_hint'),
    ('可读范围', 'modal.perm_read_scope'),
    ('仅当前工作区', 'modal.perm_workspace'),
    ('指定目录', 'modal.perm_specified'),
    ('输入允许的目录路径', 'modal.perm_path_ph'),
    ('全部文件', 'modal.perm_all'),
    ('操作权限', 'modal.perm_actions'),
    ('读取文件', 'modal.perm_read'),
    ('写入文件', 'modal.perm_write'),
    ('执行命令', 'modal.perm_shell'),
    ('访问网络', 'modal.perm_network'),
    ('浏览器控制', 'modal.perm_browser'),
    # Agent modal
    ('🤖 选择智能体类型', 'modal.agent_title'),
    ('不同智能体会自动调整提示词与执行策略。', 'modal.agent_hint'),
    # Crop overlay
    ('按住鼠标拖拽选择截图区域 · 松开确认 · ESC 取消', 'crop.tip'),
    # Folder picker
    ('📂 选择工作区文件夹', 'modal.folder_title'),
    ('选择此文件夹', 'btn.select_folder'),
    # Model modal
    ('🧠 大模型设置', 'modal.model_title'),
    ('配置自定义大模型，可保存多个并在对话中随时切换。勾选「默认」的项将作为对话默认模型。', 'modal.model_hint'),
    ('模型名称 *', 'modal.model_name'),
    ('如 GPT-4o / 通义千问 / 自建模型', 'modal.model_name_ph'),
    ('API 地址', 'modal.model_api'),
    ('https://api.openai.com/v1', 'modal.model_api_ph'),
    ('密钥（API Key）', 'modal.model_key'),
    ('sk-...', 'modal.model_key_ph'),
    ('推理过程运行内容（中间环节）', 'modal.model_reasoning'),
    ('配置该模型在中间推理环节的运行内容，例如：先列出需求拆解，再给出实现方案，最后输出代码。', 'modal.model_reasoning_ph'),
    ('保存配置', 'btn.save_config'),
    ('清空表单', 'btn.clear_form'),
    ('关闭', 'btn.close'),
    # New task modal
    ('＋ 新建对话任务', 'modal.new_task_title'),
    ('创建一个全新任务，中部对话栏的所有消息都将归属该任务运行（支持多轮连续对话）。', 'modal.new_task_hint'),
    ('任务描述', 'modal.new_task_label'),
    ('智能体类型', 'modal.new_task_agent'),
    ('工作区', 'modal.new_task_workspace'),
    ('例如：请读取当前工作区 package.json，告诉我其中的 name 与 version 字段', 'modal.new_task_ph'),
    ('工作区默认使用底部当前所选目录；若选择「默认」，则沿用服务器工作区。', 'modal.new_task_ws_hint'),
    ('创建任务', 'btn.create_task'),
    # Settings modal
    ('⚙️ 设置', 'modal.settings_title'),
    ('通用', 'settings.general'),
    ('栏目配置', 'settings.layout'),
    ('权限处理', 'settings.perm'),
    ('配置工作期间可读范围与操作权限', 'settings.perm_desc'),
    ('外观', 'settings.theme'),
    ('切换浅色 / 深色主题', 'settings.theme_desc'),
    ('💬 会话管理', 'settings.session'),
    ('发送消息前自动新建对话', 'settings.session_auto_new'),
    ('页面打开时自动新建对话', 'settings.session_auto_open'),
    ('新建对话时清空历史上下文', 'settings.session_clear'),
    ('大模型自定义设置', 'settings.model_custom'),
    ('自由添加并配置自定义大模型，提供大模型选择列表，可设为默认', 'settings.model_custom_desc'),
    # User menu
    ('体验版', 'menu.version'),
    ('当前', 'menu.current'),
    ('Buddy 加油站', 'menu.buddy'),
    ('去邀约', 'menu.invite'),
    ('最高得会员', 'menu.invite_right'),
    ('积分余额', 'menu.points'),
    ('成长计划', 'menu.growth'),
    ('连登有奖', 'menu.growth_right'),
    ('帮助与反馈', 'menu.help'),
    ('检查更新', 'menu.update'),
    ('退出登录', 'menu.logout'),
]

def add_i18n_attributes(content):
    """给HTML元素添加data-i18n属性"""
    lines = content.split('\n')
    result = []
    in_script = False
    in_style = False

    for line in lines:
        # Track script/style boundaries
        if '<script>' in line.lower() or '<script ' in line.lower():
            in_script = True
        if '</script>' in line.lower():
            in_script = False
        if '<style>' in line.lower() or '<style ' in line.lower():
            in_style = True
        if '</style>' in line.lower():
            in_style = False

        # Only process HTML lines (not inside script/style)
        if not in_script and not in_style:
            new_line = line
            for cn_text, key in i18n_map:
                if cn_text in new_line:
                    # Add data-i18n attribute before the closing >
                    # Find the opening tag
                    match = re.search(r'<([a-zA-Z][^>]*)>', new_line)
                    if match and 'data-i18n' not in new_line:
                        tag_content = match.group(1)
                        # Insert data-i18n attribute
                        new_tag = tag_content.rstrip('>') + f' data-i18n="{key}">'
                        new_line = new_line[:match.start()] + '<' + new_tag + new_line[match.end():]
            line = new_line

        result.append(line)

    return '\n'.join(result)

new_content = add_i18n_attributes(content)

# Count replacements
count = sum(1 for cn, _ in i18n_map if cn in new_content)
print(f'Applied {count}/{len(i18n_map)} i18n markers')

with open('H:/Muse Code复刻/src/web/public/index.html', 'w', encoding='utf-8') as f:
    f.write(new_content)
print('Done')
