/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 对话式专家创建向导（对标纳米Work 定制 AI 专家 4 步）：
 *   1) 选角色/场景   2) 填系统提示与工具集   3) 选算力档位   4) 命名/分类/保存
 * 非交互模式：fhcode agent-new --name X --prompt Y --tools a,b --tier full --category business
 */
import { createInterface } from 'readline';
import { resolveHomeDir } from '../../shared/config';
import { CustomAgentManager, BUILTIN_AGENTS, type CustomAgentDefinition } from '../../agent/custom-agent';
import { normalizeTier, type ComputeTier } from '../../models/tier';

export interface AgentNewOptions {
  name?: string;
  prompt?: string;
  tools?: string;
  tier?: ComputeTier;
  category?: string;
}

const DEFAULT_TOOLS = ['run_shell', 'write_file', 'read_file', 'search_files', 'web_fetch'];

type AgentData = Omit<CustomAgentDefinition, 'id' | 'createdAt' | 'updatedAt' | 'usageCount' | 'builtin'>;

function buildAgentData(opts: AgentNewOptions): AgentData {
  const tools = opts.tools ? opts.tools.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_TOOLS;
  return {
    name: opts.name ?? '未命名专家',
    description: opts.name ?? '自定义专家',
    systemPrompt: opts.prompt ?? '',
    tools,
    modelConfig: { temperature: 0.3, maxTokens: 4096, timeoutMs: 120000 },
    triggers: opts.name ? [opts.name] : [],
    icon: '🤖',
    category: opts.category ?? 'business',
    enabled: true,
    author: 'fhcode-user',
    version: '1.0.0',
    tier: opts.tier,
  };
}

export async function runAgentNewCmd(opts: AgentNewOptions = {}): Promise<void> {
  const manager = new CustomAgentManager(resolveHomeDir());

  // 非交互模式：核心参数齐全直接创建（便于自动化 / 脚本调用）
  if (opts.name && opts.prompt) {
    const agent = manager.createAgent(buildAgentData(opts));
    console.log(`✓ 已创建专家：${agent.name}（${agent.id}）`);
    printUsage(agent);
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));

  console.log('\n=== 飞虹 Code · 定制 AI 专家（对标纳米Work 4步创建）===\n');
  console.log('可选角色模板：');
  BUILTIN_AGENTS.forEach((a, i) => console.log(`  ${i + 1}. ${a.name} — ${a.description}`));
  console.log('  0. 自定义（从空白开始）');
  const sel = (await ask('请选择角色模板序号（0 自定义）：')).trim();
  const idx = Number(sel) - 1;
  const template: AgentData | null =
    sel !== '0' && BUILTIN_AGENTS[idx] ? (BUILTIN_AGENTS[idx] as AgentData) : null;

  // 步骤 2：系统提示与工具集
  let systemPrompt = template?.systemPrompt ?? '';
  if (template) {
    console.log(`\n预填系统提示（前200字）：\n${systemPrompt.slice(0, 200)}`);
    const edit = (await ask('是否修改系统提示？(y/N)：')).trim().toLowerCase();
    if (edit === 'y') systemPrompt = (await ask('请输入系统提示：')).trim();
  } else {
    systemPrompt = (await ask('请输入系统提示（专家角色与能力描述）：')).trim();
  }

  let tools = template?.tools?.length ? template.tools : DEFAULT_TOOLS;
  const toolsStr = (await ask(`可用工具（逗号分隔，回车用默认）：\n[${tools.join(',')}]\n`)).trim();
  if (toolsStr) tools = toolsStr.split(',').map((s) => s.trim()).filter(Boolean);

  // 步骤 3：算力档位（联动 ① 算力档位智能调度）
  const tierInput = (await ask('选择算力档位（light 轻量 / save 省钱 / full 满血，默认 full）：')).trim();
  const tier = normalizeTier(tierInput) ?? 'full';

  // 步骤 4：命名 / 分类 / 保存
  const name = (await ask('专家名称（如：服装厂分钱诊断专家）：')).trim() || template?.name || '未命名专家';
  const category =
    (await ask('分类（coding/review/business…，默认 business）：')).trim() || template?.category || 'business';
  const description = (await ask('一句话描述：')).trim() || template?.description || name;

  rl.close();

  const agent = manager.createAgent({
    ...buildAgentData({ name, prompt: systemPrompt, tools: tools.join(','), tier, category }),
    description,
    triggers: [name, ...(template?.triggers ?? [])].slice(0, 8),
    icon: template?.icon ?? '🤖',
  });
  console.log(`\n✓ 已创建专家：${agent.name}（${agent.id}）`);
  printUsage(agent);
}

function printUsage(agent: CustomAgentDefinition): void {
  console.log(`  触发词：${agent.triggers.join('、') || '（无）'}`);
  console.log(`  分类：${agent.category}　档位：${agent.tier ?? 'full（默认满血）'}`);
  console.log('  之后对话中输入触发词即可自动推荐该专家；或用 fhcode <需求> 自动匹配。');
}
