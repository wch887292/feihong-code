/**
 * 飞虹 Code 模型优化任务启动器
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 背景（2026-10-01 踩坑复盘）：.env 的 FH_PROVIDERS 中 agnes 未挂 code-gen 标签，
 * 被 orchestrator 能力过滤丢弃，任务全部落到单价 $1/千token 的 dots3，
 * 且 dots3 用 <dots_function_call> 文本格式 tool call + 4096 截断 → 工具静默失效。
 *
 * 本启动器：读 .env 的 FH_PROVIDERS → 动态改写（agnes 补 code-gen 成首选、
 * dots3 单价归 0 作 fallback）→ 以显式环境变量启动 fhcode（显式 env 优先于 .env）。
 * 不修改 .env 文件本身。
 *
 * 用法：node launch-optimize.mjs "<短目标>" <goal文件相对路径> <日志文件相对路径>
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const ROOT = 'H:/Muse Code复刻';
const [goalText, goalFile, logFile] = process.argv.slice(2);
if (!goalText || !goalFile || !logFile) {
  console.error('用法: node launch-optimize.mjs "<短目标>" <goal文件> <日志文件>');
  process.exit(2);
}

const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const m = envText.match(/^FH_PROVIDERS=(.*)$/m);
if (!m) {
  console.error('.env 中未找到 FH_PROVIDERS');
  process.exit(2);
}
let providers;
try {
  providers = JSON.parse(m[1].trim().replace(/^['"]|['"]$/g, ''));
} catch (e) {
  console.error('FH_PROVIDERS 解析失败:', e.message);
  process.exit(2);
}

providers = providers.map((p) => {
  if (p.id === 'agnes') {
    // 补 code-gen：让 cost 策略把最便宜的 agnes 排到首选
    return { ...p, tags: Array.from(new Set([...(p.tags || []), 'code-gen'])) };
  }
  if (p.id === 'dots3') {
    // dots3 仅作 fallback：单价归 0，即使轮换到它也不会触发成本闸
    return { ...p, costPer1k: 0 };
  }
  return p;
});

const env = {
  ...process.env,
  FH_PROVIDERS: JSON.stringify(providers),
  FH_BUDGET_USD: '50',
};
delete env.NODE_OPTIONS;
delete env.CODEBUDDY_SESSION_ID;

const logFd = fs.openSync(path.resolve(ROOT, logFile), 'w');
const child = spawn(
  process.execPath,
  ['dist/cli/index.js', goalText, '--context-file', path.resolve(ROOT, goalFile)],
  { cwd: ROOT, env, stdio: ['ignore', logFd, logFd] },
);
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (e) => {
  console.error('启动失败:', e.message);
  process.exit(1);
});
