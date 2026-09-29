/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * MCP Server 独立入口（stdio 协议专用）。
 * 为什么独立：CLI 入口（src/cli/index.ts）的 import 链带有多处初始化副作用
 * （browser 工具加载日志、自我迭代系统输出等），会污染 MCP stdio 的 stdout 协议流。
 * 本入口在最前面把日志切到 stderr（FH_LOG_STREAM=stderr），再按需加载工具，
 * 保证 stdout 只输出 JSON-RPC 消息。
 *
 * tunnel-client 的 mcp-command 应指向本入口（fhcode tunnel init 自动生成）。
 */
process.env.FH_LOG_STREAM = 'stderr';

// 注意：以下使用 require 而非 import —— 必须保证环境变量先于任何模块副作用生效
const { createDefaultRegistry } = require('../tools') as typeof import('../tools');
const {
  loadTunnelConfig,
  defaultTunnelConfig,
  tunnelConfigReady,
} = require('./tunnel-config') as typeof import('./tunnel-config');
const { runMcpServer } = require('./mcp-server') as typeof import('./mcp-server');

async function main(): Promise<void> {
  const cfg = loadTunnelConfig() ?? defaultTunnelConfig();
  if (!tunnelConfigReady(cfg)) {
    process.stderr.write('[fhcode-mcp] 隧道未配置，以默认只读白名单启动（read_file/list_dir/grep）。\n');
    process.stderr.write('[fhcode-mcp] 配置隧道后可暴露更多工具: fhcode tunnel init --tunnel-id ... --api-key ...\n');
  }
  const registry = createDefaultRegistry();
  await runMcpServer(registry, cfg);
}

main().catch((e: unknown) => {
  process.stderr.write(
    '[fhcode-mcp] MCP Server 启动失败: ' + (e instanceof Error ? e.message : String(e)) + '\n',
  );
  process.exit(1);
});
