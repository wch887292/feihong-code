/**
 * GitHub MCP Server 接入冒烟测试
 */
const {
  loadGithubMcpConfig, isValidGithubToken, isGithubMcpAvailable,
  buildGithubMcpConfig, getGithubMcpServers, getGithubMcpStatus,
  GITHUB_MCP_TOOL_CATALOG,
} = require('../dist/integrations/github-mcp');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('=== 1. 配置加载 ===');
const cfg = loadGithubMcpConfig();
check('loadGithubMcpConfig 返回配置', !!cfg);
check('默认未启用', cfg.enabled === false);
check('默认包名正确', cfg.packageName === '@modelcontextprotocol/server-github');
check('默认命令为 npx', cfg.command === 'npx');
check('默认 token 为空', cfg.token === '');

// 环境变量配置
process.env.FH_GITHUB_MCP_ENABLED = 'true';
process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'ghp_' + 'a'.repeat(36);
const cfg2 = loadGithubMcpConfig();
check('环境变量启用识别', cfg2.enabled === true);
check('环境变量 token 读取', cfg2.token.startsWith('ghp_'));
check('token 长度正确', cfg2.token.length === 40);

console.log('\n=== 2. Token 校验 ===');
check('经典 Token (ghp_) 有效', isValidGithubToken('ghp_' + 'a'.repeat(36)) === true);
check('细粒度 Token (github_pat_) 有效', isValidGithubToken('github_pat_' + 'a'.repeat(50)) === true);
check('OAuth Token (gho_) 有效', isValidGithubToken('gho_' + 'a'.repeat(36)) === true);
check('用户 Token (ghu_) 有效', isValidGithubToken('ghu_' + 'a'.repeat(36)) === true);
check('安装 Token (ghs_) 有效', isValidGithubToken('ghs_' + 'a'.repeat(36)) === true);
check('刷新 Token (ghr_) 有效', isValidGithubToken('ghr_' + 'a'.repeat(36)) === true);
check('空 token 无效', isValidGithubToken('') === false);
check('短 token 无效', isValidGithubToken('ghp_short') === false);
check('无前缀 token 无效', isValidGithubToken('a'.repeat(40)) === false);
check('null token 无效', isValidGithubToken(null) === false);

console.log('\n=== 3. 可用性判断 ===');
check('启用+有效token 可用', isGithubMcpAvailable(cfg2) === true);

// 无效 token
process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'invalid';
const cfg3 = loadGithubMcpConfig();
check('启用+无效token 不可用', isGithubMcpAvailable(cfg3) === false);

// 未启用
process.env.FH_GITHUB_MCP_ENABLED = 'false';
process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'ghp_' + 'a'.repeat(36);
const cfg4 = loadGithubMcpConfig();
check('未启用+有效token 不可用', isGithubMcpAvailable(cfg4) === false);

console.log('\n=== 4. McpServerConfig 生成 ===');
process.env.FH_GITHUB_MCP_ENABLED = 'true';
process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'ghp_' + 'a'.repeat(36);
const cfg5 = loadGithubMcpConfig();
const mcpCfg = buildGithubMcpConfig(cfg5);
check('name=github', mcpCfg.name === 'github');
check('command=npx', mcpCfg.command === 'npx');
check('args 包含 -y', mcpCfg.args.includes('-y'));
check('args 包含包名', mcpCfg.args.includes('@modelcontextprotocol/server-github'));
check('env 包含 GITHUB_PERSONAL_ACCESS_TOKEN', !!mcpCfg.env.GITHUB_PERSONAL_ACCESS_TOKEN);
check('env token 正确', mcpCfg.env.GITHUB_PERSONAL_ACCESS_TOKEN === cfg5.token);
check('env 禁用 npm fund', mcpCfg.env.npm_config_fund === 'false');
check('initTimeoutMs=60000', mcpCfg.initTimeoutMs === 60000);
check('callTimeoutMs=120000', mcpCfg.callTimeoutMs === 120000);

console.log('\n=== 5. getGithubMcpServers ===');
const servers = getGithubMcpServers();
check('启用时返回 1 个服务器', servers.length === 1);
check('服务器 name=github', servers[0].name === 'github');

// 未启用时返回空
process.env.FH_GITHUB_MCP_ENABLED = 'false';
const servers2 = getGithubMcpServers();
check('未启用时返回空数组', servers2.length === 0);

// 无效 token 时返回空
process.env.FH_GITHUB_MCP_ENABLED = 'true';
process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'invalid';
const servers3 = getGithubMcpServers();
check('无效 token 时返回空数组', servers3.length === 0);

console.log('\n=== 6. 工具目录 ===');
check('工具目录非空', GITHUB_MCP_TOOL_CATALOG.length > 0);
const categories = GITHUB_MCP_TOOL_CATALOG.map(c => c.category);
check('包含仓库分类', categories.includes('仓库'));
check('包含 Issue 分类', categories.includes('Issue'));
check('包含 PR 分类', categories.includes('Pull Request'));
check('包含代码分类', categories.includes('代码'));
const totalTools = GITHUB_MCP_TOOL_CATALOG.reduce((sum, c) => sum + c.tools.length, 0);
check('工具总数 > 20', totalTools > 20, '共 ' + totalTools + ' 个工具');

console.log('\n=== 7. 状态报告 ===');
process.env.FH_GITHUB_MCP_ENABLED = 'true';
process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'ghp_' + 'a'.repeat(36);
const status = getGithubMcpStatus();
check('status.enabled=true', status.enabled === true);
check('status.available=true', status.available === true);
check('status.tokenConfigured=true', status.tokenConfigured === true);
check('status.tokenValid=true', status.tokenValid === true);
check('status.package 正确', status.package === '@modelcontextprotocol/server-github');
check('status.command=npx', status.command === 'npx');
check('status.toolCount > 0', status.toolCount > 0);

// 配置文件方式
const fileCfg = { githubMcp: { enabled: true, token: 'ghp_' + 'b'.repeat(36) } };
const status2 = getGithubMcpStatus(fileCfg);
check('配置文件方式 token 读取', status2.tokenConfigured === true);

console.log('\n========== 汇总 ==========');
console.log('PASS: ' + pass + '  FAIL: ' + fail);
console.log(fail === 0 ? '✅ 全部冒烟测试通过' : '❌ 存在失败项');

// 清理环境变量
delete process.env.FH_GITHUB_MCP_ENABLED;
delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

process.exit(fail === 0 ? 0 : 1);
