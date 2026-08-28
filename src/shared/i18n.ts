/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 国际化（i18n）基础设施：中英文双语界面支持。
 *  - t(key, params?)        取当前语言字符串并做 {name} 插值
 *  - detectLang()           自动检测语言（FHCODE_LANG > 系统 locale）
 *  - setLang/getLang        运行时切换（供 --lang 参数使用）
 *
 * 设计：纯数据 + 轻量函数，无外部依赖，避免循环引用。
 */
export type Lang = 'zh' | 'en';

/** 归一化任意语言写法为 'zh' | 'en' | null（无法识别返回 null） */
export function normalizeLang(raw?: string | null): Lang | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'zh' || v === 'zh-cn' || v === 'zh-tw' || v === 'chinese' || v === '中文') return 'zh';
  if (v === 'en' || v === 'en-us' || v === 'en-gb' || v === 'english') return 'en';
  if (v.startsWith('zh')) return 'zh';
  if (v.startsWith('en')) return 'en';
  return null;
}

/** 自动检测当前语言：FHCODE_LANG 优先，其次系统 locale，未识别默认中文 */
export function detectLang(): Lang {
  const env = normalizeLang(process.env.FHCODE_LANG);
  if (env) return env;
  const locale = (
    process.env.LANG ||
    process.env.LC_ALL ||
    process.env.LANGUAGE ||
    ''
  ).toLowerCase();
  if (locale.includes('zh') || locale.includes('cn')) return 'zh';
  if (locale.includes('en')) return 'en';
  return 'zh';
}

let currentLang: Lang = detectLang();

export function getLang(): Lang {
  return currentLang;
}

/** 设置当前语言；仅接受 'zh' / 'en'，其它忽略（保持现状） */
export function setLang(lang?: Lang | string | null): void {
  const norm = normalizeLang(lang);
  if (norm) currentLang = norm;
}

/* ============================ 中文词条 ============================ */
const ZH: Record<string, string> = {
  'app.product': '飞虹 Code',
  'app.tagline': '终端 AI 编程智能体（对标 Muse Code / Claude Code / Cursor CLI · 自研内核差异化）',
  'app.signature':
    '晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹',
  'cli.brand': '[飞虹 Code]',
  'cli.help': `飞虹 Code (fhcode) v{version}

用法:
  fhcode                             进入交互 REPL
  fhcode "<需求>"                   单命令模式执行一条需求
  fhcode --parallel "<需求>"         多子代理并行（M2：git worktree 隔离）
  fhcode /plan "<目标>"              生成实现计划（只读）
  fhcode /grill [路径]               红队式代码审查（只读）
  fhcode /goal "<目标>"              分解并保存高层目标
  fhcode sessions                    列出历史会话（M3 恢复与审计）
  fhcode resume <id>                 从检查点恢复中断的会话（M3）
  fhcode diff [<id>]                 展示会话/工作区变更（M3）
  fhcode rollback <id> [--yes]       回滚会话改动（M3，危险操作需 --yes）

企业能力 (M4):
  fhcode whoami                      当前租户 / 用户 / 角色 / 隔离目录 / 配额
  fhcode policy                      查看生效的 RBAC 策略与角色矩阵
  fhcode audit [--limit N]           查看审计记录（默认最近 20 条）
  fhcode audit verify                校验审计哈希链是否被篡改
  fhcode tenants                     列出全部租户与用量汇总
  fhcode doctor                      环境自检（版本/git/provider/路径/网络）

自我进化 (M6):
  fhcode model-stats                 查看各模型性能统计
  fhcode experiences [路径]          列出经验库

Web 控制台 (M5):
  fhcode serve [--port 8080]         启动 Web 管理控制台（默认 http://localhost:8080）
                                    令牌由 FH_WEB_TOKEN 或自动生成（控制台仅观测，不执行）

自主编程 (M8):
  fhcode code-write "<目标>"         自主编写代码（规划→编写→测试→审查→修复）
  fhcode quality-gate [路径]         质量门禁审查（安全+质量+测试覆盖）
  fhcode self-improve                自我改进统计与历史

全自动软件工程 Agent (M9):
  fhcode swe "<目标>"                读取仓库→拆解规划→实现+验证+自愈→报告
                                     --repo <路径> 指定仓库(默认当前目录)
                                     --plan-only 仅规划不执行
                                     --verify-only 仅跑验证不实现
                                     --max-tasks N 限制子任务数(默认8)
                                     --max-retries N 单任务自愈重试(默认2)

  fhcode --version                   显示版本 (-v)
  fhcode --help                      显示帮助 (-h)
  fhcode --lang <zh|en>              设置界面语言（中文/英文）

说明: 未配置 FH_PROVIDERS 时自动进入离线模式（脚本化 Mock 驱动闭环验证）。
配置 FH_PROVIDERS（OpenAI 兼容 / Ollama）后，将调用真实大模型执行任务。
企业模式默认开启（租户隔离 + RBAC + 审计链 + 配额），可用 FH_ENTERPRISE=false 关闭。
署名: {signature}`,

  'repl.welcome': '飞虹 Code REPL（输入需求回车执行，exit 退出）',
  'repl.hint': '提示：未配置 FH_PROVIDERS 时自动离线模式运行；支持 /plan /grill /goal 技能。\n',
  'repl.prompt': '飞虹> ',
  'repl.errorPrefix': '执行出错: ',
  'repl.unknownSkill': '未知技能: /{cmd}（支持 /plan /grill /goal）',
  'repl.bye': '\n再见。',
  'repl.stateReady': '就绪',
  'repl.stateRunning': '运行中',

  'stream.toolCalling': '调用工具: {tools}',
  'stream.toolOk': '成功',
  'stream.toolFail': '失败',
  'stream.selfHeal': '自愈重试: {category}',
  'stream.compact': '上下文压缩: {from} → {to} 条消息',
  'stream.done': '任务结束 · 迭代 {iter} 次 · 成本 {cost}',

  'run.identity': '身份 tenant={tenant} user={user} role={role}',
  'run.start': '开始任务 (runId={id}{mode})',
  'run.resultTitle': '===== 执行结果 =====',
  'run.summary': '迭代 {iter} 次 · 成本 {cost} · 日志 {log}',
  'run.checkpoint':
    '会话检查点: {path}（可用 fhcode sessions / resume / diff 管理）',
  'run.offlineFileYes': '(离线模式演示文件已写入: {file})',
  'run.offlineFileNo':
    '(离线模式未产生演示文件，工作区: {cwd}；如为策略拒绝可用 fhcode audit 查看原因)',
  'run.offlineFragment': ', 离线模式',
  'run.modeOffline': '离线',
  'run.modeLive': '真实',

  'run.parallelMode': '[飞虹 Code] 并行模式：{offline}',
  'run.parallelResult': '===== 并行执行结果 =====',
  'run.parallelRepo': '仓库根: {root} · 工作树已清理: {trees}',

  'run.noSessions': '（无历史会话）',
  'run.sessionList': '历史会话（{mode}模式，目录 {home}）:',
  'run.sessionItem':
    '- {id} | {status} | 迭代{iter} | 成本{cost} | 文件{files} | {time}',
  'run.sessionGoal': '    目标: {goal}',

  'run.resumeDone': '会话 {id} 已完成，无需恢复。',
  'run.resumeStart': '[飞虹 Code] 恢复会话 {id} (状态: {status}, 已迭代 {iter} 次)',

  'run.diffSession': '[飞虹 Code] 会话 {id} 的变更 (cwd={cwd}):',
  'run.diffCwd': '[飞虹 Code] 当前目录 ({cwd}) 工作区变更:',

  'run.rollbackStart': '[飞虹 Code] 回滚会话 {id} 的 {n} 个文件 (cwd={cwd})',
  'run.rollbackReverted': '已还原(已跟踪): {files}',
  'run.rollbackRemoved': '已删除(未跟踪): {files}',
  'run.rollbackNote': '注意: {errors}',

  'err.enterpriseDisabled':
    '企业模式已关闭（FH_ENTERPRISE=false），该命令不可用。',
  'err.runFailed': '[飞虹 Code] 运行失败 ({code}): {message}',
  'err.unexpected': '运行出错: ',
  'err.hint': '（详细日志见结构化 JSON 输出；配置类错误请检查 FH_PROVIDERS / .env）',

  'mode.offline': '离线',
  'mode.live': '真实',

  'audit.empty': '（租户 {tenant} 暂无审计记录，目录 {dir}）',
  'audit.header': '审计记录 {rows}/{all} 条（租户 {tenant}）:',
  'audit.row':
    '#{seq} {ts} [{decision}] {action} by {user}({role}) run={run}',
  'audit.resource': '      资源: {resource}',
  'audit.reason': '      理由: {reason}',
  'audit.chainTail': '链尾哈希: {hash}…',
  'audit.verifyOk': '✅ 审计链完整：{total} 条记录，哈希链自洽未被篡改。',
  'audit.verifyFail': '❌ 审计链校验失败：共 {total} 条，断点在第 {brokenAt} 条',

  'tenants.empty': '（暂无租户数据，执行一次任务后自动创建）',
  'tenants.header': '租户用量汇总:',
  'tenants.tableHeader': '  租户ID                会话数   累计成本      审计条数   最近活跃',
  'tenants.row':
    '  {id} {sessions}   {cost}   {audit}   {last}',

  'modelStats.empty': '（暂无模型性能数据，执行任务后自动生成）',
  'modelStats.noRecords': '（无模型统计记录）',
  'modelStats.title': '模型性能统计（M6）:',
  'modelStats.tableHeader':
    '  提供者ID          模型               总调用  成功  失败  成功率  平均延迟  总成本',

  'exp.empty': '（暂无经验记录，完成任务后自动积累）',
  'exp.header': '经验库 ({n} 条，来源: {dir}):',
  'exp.tableHeader': '  ID                              类型                 标题                    成功率  使用次数',
  'exp.more': '  ... 共 {n} 条，显示前 10 条',

  'doctor.title': '===== fhcode doctor 环境自检 =====',
  'doctor.node': 'Node 版本',
  'doctor.git': 'git 可用性',
  'doctor.gitMissing': 'git 不可用（diff/rollback/并行模式将受限）',
  'doctor.config': '模型配置',
  'doctor.configEmpty': '未配置 provider（将自动进入离线模式）',
  'doctor.provider': '供应商',
  'doctor.network': '网络连通',
  'doctor.networkOffline': '离线模式，跳过网络探测',
  'doctor.home': '主目录可写',
  'doctor.sandbox': '沙箱模式',
  'doctor.sandboxUnavailable': '（配置不可用）',
  'doctor.docker': 'Docker 沙箱（container 档）',
  'doctor.allOk': '✅ 环境就绪，无异常项',
  'doctor.issues': '⚠️ 发现 {n} 项异常，请根据提示处理',
  'skillMarket.localSeed': '（网络不可达，已使用本地种子源 templates/market/index.json）',
  'skillMarket.registered': '✅ 已自动注册到本地技能索引（当前共 {n} 个技能）',
  'skillMarket.notRegisteredWarn': '⚠️ 技能已安装但未被本地索引发现：{name}（请检查 SKILL.md 格式）',

  'plugin.installUsage': '用法: fhcode plugin install <本地目录|git URL>',
  'plugin.installed': '✅ 插件已安装: {name}（{dir}）',
  'plugin.installFailed': '❌ 插件安装失败: ',
  'plugin.empty': '（未安装任何插件）',
  'plugin.listTitle': '已安装插件:',

  'skillMarket.localEmpty': '（本地无已安装技能）',
  'skillMarket.localTitle': '本地已安装技能（{n} 个）:',
  'skillMarket.fetchFailed': '❌ 拉取市场索引失败（{base}）: ',
  'skillMarket.schemaWarn': '⚠️ 市场索引 schema 未识别（{schema}），按 0.1.0 兼容处理',
  'skillMarket.searchEmpty': '（市场无匹配 "{q}" 的技能）',
  'skillMarket.searchTitle': '市场「{q}」搜索结果（{n} 个，来源 {base}）:',
  'skillMarket.installHint': '安装: fhcode skill-market install <技能名> [--repo <市场源>]',
  'skillMarket.installUsage': '用法: fhcode skill-market install <技能名> [--repo <市场源>]',
  'skillMarket.notFound': '❌ 市场中未找到技能: {name}',
  'skillMarket.installed': '✅ 技能已安装: {name}（{dir}），任务中自动发现',
  'skillMarket.installFailed': '❌ 技能安装失败: ',

  'team.start': 'Agent Team 启动（{mode}）: 共享任务清单 + 消息总线协作',
  'team.reportTitle': '===== Agent Team 协作报告 =====',

  'serve.url': '[飞虹 Code] Web 控制台: {url}',
  'serve.token': '[飞虹 Code] 访问令牌 (FH_WEB_TOKEN): {token}',
  'serve.stop': '[飞虹 Code] 按 Ctrl+C 停止',
  'serve.tokenAuto':
    '[飞虹 Code] Web 控制台令牌已自动生成（FH_WEB_TOKEN）: {token}',
  'serve.started': '[飞虹 Code] Web 控制台已启动: http://localhost:{port}',

  'codewrite.resultTitle': '===== M8 自主编写结果 =====',
  'codewrite.files': '生成文件: {files}',

  'quality.failed': '⚠️ {n} 个文件未通过门禁，请修复后再提交',

  'selfimp.title': '===== M6/M8 自我迭代系统状态 =====',
  'selfimp.reflections': '反思次数: {n}',
  'selfimp.successRate': '成功率: {p}%',
  'selfimp.avgDuration': '平均耗时: {ms}ms',
  'selfimp.expLib': '经验库: {n} 条独特经验, 累计验证权重 {w}',
  'selfimp.topExp': 'Top 经验（按被复用次数）:',
  'selfimp.expItem': '  [{count}×] {type} | {title}',
  'selfimp.recent': '最近改进记录:',
  'selfimp.record': '  {ts} | {ok} | 模式: {n} 条',
  'selfimp.improvement': '    → {imp}',
  'selfimp.noRecords': '（暂无改进记录，完成任务后自动生成）',
  'selfimp.learnPreview': '----- 学习提示预览（目标: {goal}）-----',
  'selfimp.noLearned': '（暂无可注入经验）',

  'swe.noProvider':
    '[飞虹 Code] 未配置真实模型供应商，无法进入真实模式。请通过以下任一方式接入：\n' +
    '  1) 环境变量: FH_MODEL_NAME=<模型> FH_MODEL_TYPE=ollama|openai-compatible FH_MODEL_BASE_URL=<地址> [FH_MODEL_API_KEY=<令牌>]\n' +
    '  2) 配置文件: ./fhcode.config.json 的 models.providers 数组\n' +
    '  3) FH_PROVIDERS 环境变量(JSON 数组)\n' +
    '本地 Ollama 示例: FH_MODEL_NAME=qwen2.5-coder:1.5b FH_MODEL_TYPE=ollama fhcode swe "..."',
  'swe.start': '[飞虹 Code] 启动全自动软件工程 Agent（{offline}，仓库={cwd}）',
  'swe.reportTitle': '===== 全自动软件工程 Agent 报告 =====',
  'harness.start': '[飞虹 Code] 启动评测 harness（{mode} 模式 · split={split} · limit={limit}）',
  'harness.noProvider': '[飞虹 Code] 未配置真实模型供应商（请设置 FH_PROVIDERS 或 FH_MODEL_NAME 后使用 --mode real）',
  'harness.reportWritten': '报告已写入: {path}',
  'harness.summary': '汇总: {completed}/{total} 通过（通过率 {rate}%）',

  'approve.prompt': '[审批] 是否允许执行: {action}\n  输入 y/yes 允许，其他拒绝: ',

  'enterprise.whoamiTitle': '当前身份（企业模式）',
  'enterprise.tenantId': '租户 ID',
  'enterprise.userId': '用户 ID',
  'enterprise.role': '角色',
  'enterprise.sessionDir': '隔离目录',
  'enterprise.quota': '配额',
  'enterprise.quotaUsed': '已用',
  'enterprise.quotaLimit': '上限',
  'enterprise.policyTitle': '生效策略与角色矩阵',
  'enterprise.roleColumn': '角色',
  'enterprise.permissionsColumn': '权限',
  'enterprise.unlimited': '无限',
  'enterprise.unknown': '未知',
  'enterprise.on': '开启',
  'enterprise.off': '关闭 (FH_ENTERPRISE=false)',
  'enterprise.none': '（无）',
  'enterprise.whoami.tenant': '租户 (tenant): {v}',
  'enterprise.whoami.user': '用户 (user)  : {v}',
  'enterprise.whoami.role': '角色 (role)  : {v}',
  'enterprise.whoami.isoDir': '隔离目录     : {v}',
  'enterprise.whoami.session': '  会话       : {v}',
  'enterprise.whoami.audit': '  审计       : {v}',
  'enterprise.whoami.goal': '  目标       : {v}',
  'enterprise.whoami.taskCap': '单任务上限   : {v}',
  'enterprise.whoami.used': '今日已用     : {v}',
  'enterprise.whoami.auditCount': '审计记录数   : {v}',
  'enterprise.whoami.mode': '企业模式     : {v}',
  'policy.version': '策略版本: v{v}',
  'policy.role': '当前角色: {v}',
  'policy.allow': '  直接允许: {v}',
  'policy.approval': '  需审批  : {v}',
  'policy.taskCap': '单任务成本上限: {v}',
  'policy.tenantCap': '租户日成本上限: {v}',
  'policy.denyShell': '危险命令黑名单({n}): {v}',
  'policy.denyPaths': '敏感路径黑名单({n}): {v}',
  'policy.matrixTitle': '全角色矩阵:',
  'policy.matrixRow': '  {role} allow=[{allow}] approval=[{approval}] max=${max}',
  'quality.reportTitle': '===== 质量门禁报告 =====',
  'quality.fileResult': '{file}: {status}',
  'quality.pass': '✅ 通过',
  'quality.fail': '❌ 未通过',
  'quality.check': '  {mark} {name}: {value} {req}',
  'quality.req': '(要求: {threshold})',
  'quality.total': '总计: {passed}/{total} 通过',
};

/* ============================ 英文词条 ============================ */
const EN: Record<string, string> = {
  'app.product': 'fhcode',
  'app.tagline': 'Terminal AI coding agent (a Muse Code reimplementation)',
  'app.signature':
    'Jinjiang Feihongzhi Tech Enterprise Management Co., Ltd. · Feiyang Qiyuan R&D Center · Lead: Wu Cihong',
  'cli.brand': '[fhcode]',
  'cli.help': `fhcode (Feihong Code) v{version}

Usage:
  fhcode                             Enter interactive REPL
  fhcode "<request>"                Run a single request
  fhcode --parallel "<request>"     Multi-subagent parallel mode (M2: git worktree isolation)
  fhcode /plan "<goal>"             Generate an implementation plan (read-only)
  fhcode /grill [path]              Red-team code review (read-only)
  fhcode /goal "<goal>"             Decompose and save a high-level goal
  fhcode sessions                    List historical sessions (M3 resume & audit)
  fhcode resume <id>                Resume an interrupted session from checkpoint (M3)
  fhcode diff [<id>]                Show session/workspace diff (M3)
  fhcode rollback <id> [--yes]      Roll back session changes (M3, destructive, needs --yes)

Enterprise (M4):
  fhcode whoami                      Current tenant / user / role / isolated dir / quota
  fhcode policy                      Show active RBAC policy & role matrix
  fhcode audit [--limit N]           View audit records (last 20 by default)
  fhcode audit verify               Verify audit hash-chain integrity
  fhcode tenants                     List all tenants & usage summary
  fhcode doctor                      Environment self-check (version/git/providers/paths/network)

Self-evolution (M6):
  fhcode model-stats                 View per-model performance stats
  fhcode experiences [path]          List the experience library

Web console (M5):
  fhcode serve [--port 8080]         Start the Web console (default http://localhost:8080)
                                    Token from FH_WEB_TOKEN or auto-generated (observe-only)

Autonomous coding (M8):
  fhcode code-write "<goal>"         Autonomous code writing (plan→write→test→review→fix)
  fhcode quality-gate [path]         Quality-gate review (security+quality+test coverage)
  fhcode self-improve                Self-improvement stats & history

Autonomous SWE Agent (M9):
  fhcode swe "<goal>"                 Read repo→plan→implement+verify+self-heal→report
                                     --repo <path>  target repo (default cwd)
                                     --plan-only   plan only, no execution
                                     --verify-only verification only, no implementation
                                     --max-tasks N max subtasks (default 8)
                                     --max-retries N self-heal retries per task (default 2)

  fhcode --version                   Show version (-v)
  fhcode --help                      Show help (-h)
  fhcode --lang <zh|en>              Set UI language (Chinese / English)

Notes: offline mode is used automatically when FH_PROVIDERS is unset (scripted Mock drives the loop).
With FH_PROVIDERS (OpenAI-compatible / Ollama) configured, real LLMs run the tasks.
Enterprise mode is on by default (tenant isolation + RBAC + audit chain + quota); disable with FH_ENTERPRISE=false.
Signature: {signature}`,

  'repl.welcome': 'fhcode REPL (type a request and press Enter to run; type exit to quit)',
  'repl.hint': 'Hint: offline mode is used automatically when FH_PROVIDERS is not configured; /plan /grill /goal skills supported.\n',
  'repl.prompt': 'fhcode> ',
  'repl.errorPrefix': 'Error: ',
  'repl.unknownSkill': 'Unknown skill: /{cmd} (supported: /plan /grill /goal)',
  'repl.bye': '\nGoodbye.',
  'repl.stateReady': 'ready',
  'repl.stateRunning': 'running',

  'stream.toolCalling': 'Calling tools: {tools}',
  'stream.toolOk': 'ok',
  'stream.toolFail': 'failed',
  'stream.selfHeal': 'Self-heal retry: {category}',
  'stream.compact': 'Context compacted: {from} → {to} messages',
  'stream.done': 'Done · {iter} iterations · cost {cost}',

  'run.identity': 'Identity tenant={tenant} user={user} role={role}',
  'run.start': 'Task started (runId={id}{mode})',
  'run.resultTitle': '===== Result =====',
  'run.summary': 'Iterations: {iter} · Cost: {cost} · Log: {log}',
  'run.checkpoint':
    'Session checkpoint: {path} (manage with fhcode sessions / resume / diff)',
  'run.offlineFileYes': '(Offline demo file written: {file})',
  'run.offlineFileNo':
    '(No offline demo file produced; workspace: {cwd}. If blocked by policy, see fhcode audit for the reason)',
  'run.offlineFragment': ', offline mode',
  'run.modeOffline': 'offline',
  'run.modeLive': 'live',

  'run.parallelMode': '[fhcode] parallel mode: {offline}',
  'run.parallelResult': '===== Parallel Result =====',
  'run.parallelRepo': 'Repo root: {root} · Worktrees cleaned: {trees}',

  'run.noSessions': '(No historical sessions)',
  'run.sessionList': 'Sessions ({mode} mode, dir {home}):',
  'run.sessionItem':
    '- {id} | {status} | iter {iter} | cost {cost} | files {files} | {time}',
  'run.sessionGoal': '    goal: {goal}',

  'run.resumeDone': 'Session {id} already completed, no need to resume.',
  'run.resumeStart': '[fhcode] resuming session {id} (status: {status}, iterations: {iter})',

  'run.diffSession': '[fhcode] changes of session {id} (cwd={cwd}):',
  'run.diffCwd': '[fhcode] workspace changes in {cwd}:',

  'run.rollbackStart': '[fhcode] rolling back {n} files of session {id} (cwd={cwd})',
  'run.rollbackReverted': 'Reverted (tracked): {files}',
  'run.rollbackRemoved': 'Removed (untracked): {files}',
  'run.rollbackNote': 'Note: {errors}',

  'err.enterpriseDisabled':
    'Enterprise mode is disabled (FH_ENTERPRISE=false); this command is unavailable.',
  'err.runFailed': '[fhcode] run failed ({code}): {message}',
  'err.unexpected': 'Unexpected error: ',
  'err.hint':
    '(Detailed logs are in structured JSON output; for config errors check FH_PROVIDERS / .env)',

  'mode.offline': 'offline',
  'mode.live': 'live',

  'audit.empty': '(No audit records for tenant {tenant}; dir {dir})',
  'audit.header': 'Audit records {rows}/{all} (tenant {tenant}):',
  'audit.row':
    '#{seq} {ts} [{decision}] {action} by {user}({role}) run={run}',
  'audit.resource': '      resource: {resource}',
  'audit.reason': '      reason: {reason}',
  'audit.chainTail': 'Chain tail hash: {hash}…',
  'audit.verifyOk': '✅ Audit chain intact: {total} records, hash chain self-consistent and unaltered.',
  'audit.verifyFail': '❌ Audit chain verification failed: {total} records, broken at record #{brokenAt}',

  'tenants.empty': '(No tenant data yet; created automatically after one task)',
  'tenants.header': 'Tenant usage summary:',
  'tenants.tableHeader': '  TenantID            Sessions   TotalCost       Audits    LastActive',
  'tenants.row':
    '  {id} {sessions}   {cost}   {audit}   {last}',

  'modelStats.empty': '(No model performance data yet; generated automatically after tasks)',
  'modelStats.noRecords': '(No model stats recorded)',
  'modelStats.title': 'Model performance stats (M6):',
  'modelStats.tableHeader':
    '  ProviderID          Model               Calls  OK  Fail  Rate   AvgLat   TotalCost',

  'exp.empty': '(No experiences yet; accumulated automatically after tasks)',
  'exp.header': 'Experience library ({n} entries, source: {dir}):',
  'exp.tableHeader': '  ID                              Type                Title                  Rate   Uses',
  'exp.more': '  ... {n} entries total, showing first 10',

  'doctor.title': '===== fhcode doctor environment check =====',
  'doctor.node': 'Node version',
  'doctor.git': 'git availability',
  'doctor.gitMissing': 'git unavailable (diff/rollback/parallel mode will be limited)',
  'doctor.config': 'Model config',
  'doctor.configEmpty': 'No provider configured (offline mode will be used automatically)',
  'doctor.provider': 'Provider',
  'doctor.network': 'Network reachability',
  'doctor.networkOffline': 'Offline mode, skipping network probe',
  'doctor.home': 'Home dir writable',
  'doctor.sandbox': 'Sandbox mode',
  'doctor.sandboxUnavailable': '(config unavailable)',
  'doctor.docker': 'Docker sandbox (container mode)',
  'doctor.allOk': '✅ Environment ready, no issues',
  'doctor.issues': '⚠️ {n} issue(s) found, please fix them as suggested',

  'plugin.installUsage': 'Usage: fhcode plugin install <local-dir|git-url>',
  'plugin.installed': '✅ Plugin installed: {name} ({dir})',
  'plugin.installFailed': '❌ Plugin install failed: ',
  'plugin.empty': '(No plugins installed)',
  'plugin.listTitle': 'Installed plugins:',

  'skillMarket.localEmpty': '(No local skills installed)',
  'skillMarket.localTitle': 'Local skills ({n}):',
  'skillMarket.fetchFailed': '❌ Failed to fetch market index ({base}): ',
  'skillMarket.schemaWarn': '⚠️ Unrecognized market index schema ({schema}), treating as 0.1.0',
  'skillMarket.searchEmpty': '(No skills match "{q}" in the market)',
  'skillMarket.searchTitle': 'Market results for "{q}" ({n} found, source {base}):',
  'skillMarket.installHint': 'Install: fhcode skill-market install <skill-name> [--repo <market-url>]',
  'skillMarket.installUsage': 'Usage: fhcode skill-market install <skill-name> [--repo <market-url>]',
  'skillMarket.localSeed': '(network unreachable, using local seed templates/market/index.json)',
  'skillMarket.registered': '✅ auto-registered to local skill index (total {n} skills)',
  'skillMarket.notRegisteredWarn': '⚠️ installed but NOT discovered by local index: {name} (check SKILL.md format)',
  'skillMarket.notFound': '❌ Skill not found in market: {name}',
  'skillMarket.installed': '✅ Skill installed: {name} ({dir}), auto-discovered in tasks',
  'skillMarket.installFailed': '❌ Skill install failed: ',

  'team.start': 'Agent Team started ({mode}): shared task board + message bus',
  'team.reportTitle': '===== Agent Team Report =====',

  'serve.url': '[fhcode] Web console: {url}',
  'serve.token': '[fhcode] access token (FH_WEB_TOKEN): {token}',
  'serve.stop': '[fhcode] press Ctrl+C to stop',
  'serve.tokenAuto':
    '[fhcode] Web console token auto-generated (FH_WEB_TOKEN): {token}',
  'serve.started': '[fhcode] Web console started: http://localhost:{port}',

  'codewrite.resultTitle': '===== M8 Autonomous Write Result =====',
  'codewrite.files': 'Generated files: {files}',

  'quality.failed': '⚠️ {n} file(s) failed the quality gate, fix them before committing',

  'selfimp.title': '===== M6/M8 Self-Improvement System Status =====',
  'selfimp.reflections': 'Reflections: {n}',
  'selfimp.successRate': 'Success rate: {p}%',
  'selfimp.avgDuration': 'Avg duration: {ms}ms',
  'selfimp.expLib': 'Experience library: {n} unique experiences, cumulative weight {w}',
  'selfimp.topExp': 'Top experiences (by reuse count):',
  'selfimp.expItem': '  [{count}×] {type} | {title}',
  'selfimp.recent': 'Recent improvements:',
  'selfimp.record': '  {ts} | {ok} | patterns: {n}',
  'selfimp.improvement': '    → {imp}',
  'selfimp.noRecords': '(No improvement records yet; generated automatically after tasks)',
  'selfimp.learnPreview': '----- Learned-prompt preview (goal: {goal}) -----',
  'selfimp.noLearned': '(No experience available to inject)',

  'swe.noProvider':
    '[fhcode] No real model provider configured; cannot enter live mode. Connect via one of:\n' +
    '  1) Env vars: FH_MODEL_NAME=<model> FH_MODEL_TYPE=ollama|openai-compatible FH_MODEL_BASE_URL=<url> [FH_MODEL_API_KEY=<token>]\n' +
    '  2) Config file: models.providers array in ./fhcode.config.json\n' +
    '  3) FH_PROVIDERS env var (JSON array)\n' +
    'Local Ollama example: FH_MODEL_NAME=qwen2.5-coder:1.5b FH_MODEL_TYPE=ollama fhcode swe "..."',
  'swe.start': '[fhcode] launching autonomous SWE agent ({offline}, repo={cwd})',
  'swe.reportTitle': '===== Autonomous SWE Agent Report =====',
  'harness.start': '[fhcode] starting evaluation harness ({mode} mode · split={split} · limit={limit})',
  'harness.noProvider': '[fhcode] No real model provider configured (set FH_PROVIDERS or FH_MODEL_NAME, then use --mode real)',
  'harness.reportWritten': 'Report written to: {path}',
  'harness.summary': 'Summary: {completed}/{total} passed ({rate}%)',

  'approve.prompt': '[approve] allow execution: {action}\n  type y/yes to allow, anything else to deny: ',

  'enterprise.whoamiTitle': 'Current identity (enterprise mode)',
  'enterprise.tenantId': 'Tenant ID',
  'enterprise.userId': 'User ID',
  'enterprise.role': 'Role',
  'enterprise.sessionDir': 'Isolated dir',
  'enterprise.quota': 'Quota',
  'enterprise.quotaUsed': 'used',
  'enterprise.quotaLimit': 'limit',
  'enterprise.policyTitle': 'Active policy & role matrix',
  'enterprise.roleColumn': 'Role',
  'enterprise.permissionsColumn': 'Permissions',
  'enterprise.unlimited': 'unlimited',
  'enterprise.unknown': 'unknown',
  'enterprise.on': 'on',
  'enterprise.off': 'off (FH_ENTERPRISE=false)',
  'enterprise.none': 'none',
  'enterprise.whoami.tenant': 'Tenant: {v}',
  'enterprise.whoami.user': 'User  : {v}',
  'enterprise.whoami.role': 'Role  : {v}',
  'enterprise.whoami.isoDir': 'Isolated dir : {v}',
  'enterprise.whoami.session': '  session     : {v}',
  'enterprise.whoami.audit': '  audit       : {v}',
  'enterprise.whoami.goal': '  goal        : {v}',
  'enterprise.whoami.taskCap': 'Per-task cap : {v}',
  'enterprise.whoami.used': 'Used today   : {v}',
  'enterprise.whoami.auditCount': 'Audit count : {v}',
  'enterprise.whoami.mode': 'Enterprise   : {v}',
  'policy.version': 'Policy version: v{v}',
  'policy.role': 'Current role: {v}',
  'policy.allow': '  allow: {v}',
  'policy.approval': '  approval: {v}',
  'policy.taskCap': 'Per-task cost cap: {v}',
  'policy.tenantCap': 'Tenant daily cap: {v}',
  'policy.denyShell': 'Dangerous shell blacklist ({n}): {v}',
  'policy.denyPaths': 'Sensitive path blacklist ({n}): {v}',
  'policy.matrixTitle': 'Full role matrix:',
  'policy.matrixRow': '  {role} allow=[{allow}] approval=[{approval}] max=${max}',
  'quality.reportTitle': '===== Quality Gate Report =====',
  'quality.fileResult': '{file}: {status}',
  'quality.pass': '✅ passed',
  'quality.fail': '❌ failed',
  'quality.check': '  {mark} {name}: {value} {req}',
  'quality.req': '(required: {threshold})',
  'quality.total': 'Total: {passed}/{total} passed',
};

/**
 * 取当前语言字符串并做 {name} 插值。
 * 缺失 key 时回退中文，再回退 key 本身，保证永不崩溃。
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const table = currentLang === 'en' ? EN : ZH;
  let s: string | undefined = table[key];
  if (s == null) s = ZH[key];
  if (s == null) return key;
  if (params) {
    for (const k of Object.keys(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(params[k]));
    }
  }
  return s;
}

/** 便捷：返回当前语言下的品牌标签（如 [飞虹 Code] / [fhcode]） */
export function brandTag(): string {
  return t('cli.brand');
}
