#!/usr/bin/env node
/**
 * SWE-bench 真实跑分 harness：使用 fhcode 生产 agent（RealModelExecutor + TestVerifier）
 * 用法：
 *   node scripts/swebench-fhcode.mjs [--instances bench/real/django_inst.json] [--limit N] [--report path]
 *
 * 流程：
 *  1. 加载实例（本地 JSON 或 HuggingFace 官方数据集）
 *  2. 为每个实例准备 worktree（git clone + checkout base_commit + editable 装项目到 py3.8 venv）
 *  3. 调用 fhcode RealModelExecutor（fhcode 生产 agent 驱动修复）
 *  4. 用自定义 TestVerifier（python -m pytest 跑 FAIL_TO_PASS + PASS_TO_PASS）判定 resolved
 *  5. 汇总报告
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

// fhcode 生产模块（从 scripts/ 往上两级）
import { runHarness, loadConfig, loadDotEnv } from '../dist/cli/run.js';
import { RealModelExecutor } from '../dist/harness/executor.js';
import { FileExistsVerifier } from '../dist/harness/verifier.js';
import { MarkdownReporter } from '../dist/harness/reporter.js';
import { normalizeInstance } from '../dist/harness/loader.js';

const ROOT = process.cwd();
const VENV38 = join(ROOT, 'bench/real/venv38');
const WORK_DIR = join(ROOT, 'bench/real/work');
const PYTHON = join(VENV38, 'Scripts', 'python.exe');
const PIP = join(VENV38, 'Scripts', 'pip.exe');

// --- 命令行解析 ---
function parseArgs(argv) {
  const opts = { instances: null, limit: Infinity, report: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--instances' && argv[i + 1]) { opts.instances = argv[++i]; i++; }
    else if (argv[i] === '--limit' && argv[i + 1]) { opts.limit = Number(argv[++i]); i++; }
    else if (argv[i] === '--report' && argv[i + 1]) { opts.report = argv[++i]; i++; }
  }
  return opts;
}

// --- 环境准备 ---
function ensureVenv38() {
  if (!existsSync(PYTHON)) {
    throw new Error('Python 3.8 venv 不存在，请先运行: scripts/setup-py38-venv.mjs');
  }
  // 确保 pytest 在 venv38 里
  try {
    execSync(`${PYTHON} -m pytest --version`, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  } catch {
    console.log('  安装 pytest 到 venv38...');
    execSync(`${PIP} install pytest`, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  }
}

function cloneOrEnsureWorktree(repo, baseCommit, worktreeDir) {
  if (!existsSync(join(WORK_DIR, repo.split('/')[1]))) {
    console.log(`  克隆 ${repo}...`);
    execSync(`git clone --quiet https://github.com/${repo}.git "${join(WORK_DIR, repo.split('/')[1])}"`,
      { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  }
  const repoDir = join(WORK_DIR, repo.split('/')[1]);
  // 创建 worktree
  const wtName = worktreeDir.replace(/[^a-zA-Z0-9_-]/g, '_');
  const wtPath = join(WORK_DIR, wtName);
  if (!existsSync(wtPath)) {
    execSync(`git -C "${repoDir}" worktree add -q "${wtPath}" "${baseCommit}"`,
      { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  }
  // 确认 checkout
  const current = execSync('git rev-parse --short HEAD', { cwd: wtPath, encoding: 'utf8', stdio: 'pipe' }).trim();
  if (current !== baseCommit.slice(0, 8)) {
    throw new Error(`${wtName} 未 checkout 到 ${baseCommit}`);
  }
  return wtPath;
}

function pipInstallEditable(repoDir) {
  try {
    execSync(`${PIP} install -e "${repoDir}"`, {
      cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 120000
    });
  } catch (e) {
    console.log(`  [WARN] pip install editable 失败（老版本可能不兼容）: ${String(e.message).slice(0, 120)}`);
  }
}

// --- 自定义 verifier：Python 项目用 pytest ---
class PythonTestVerifier extends FileExistsVerifier {
  constructor() {
    super('SOLUTION.md');
    this.id = 'python-test-run';
  }

  async verify(cwd, instance) {
    const base = {
      testCommand: `${PYTHON} -m pytest`,
      failToPassCommand: `${PYTHON} -m pytest`,
      passToPassCommand: `${PYTHON} -m pytest`,
      timeoutMs: 300000,
    };
    // 复用 fhcode 的 TestVerifier 逻辑（通过继承并重写 runOne）
    const { runCommand, sanitizeManagedCommand } = await import('../dist/tools/shell/exec.js');

    const runOne = async (cmd, wd, timeout) => {
      const safe = sanitizeManagedCommand(cmd, cmd);
      if (!safe) return -1;
      const res = await runCommand(safe, wd, timeout);
      return res.code;
    };

    const anyFailed = async (cmd, wd) => runOne(cmd, wd, base.timeoutMs).then(code => code !== 0);

    // 0) beforeCommand: 确认修复前 FAIL_TO_PASS 确实失败
    const ftp_cmds = instance.FAIL_TO_PASS.map(ft =>
      `${PYTHON} -m pytest "${ft}" --no-header -q`
    ).join(' ');
    const preFail = await anyFailed(ftp_cmds, cwd);
    if (!preFail) {
      console.log(`    ⚠️ ${instance.instance_id}：修复前 FAIL_TO_PASS 无失败 → 无区分度，不计入总分`);
      return null; // 返回 null 表示"无效样本，剔除"
    }

    // 1) FAIL_TO_PASS：修复后必须通过
    const ftpCode = await runOne(ftp_cmds, cwd, base.timeoutMs);
    if (ftpCode !== 0) return false;

    // 2) PASS_TO_PASS 回归（如有）
    if (instance.PASS_TO_PASS.length > 0) {
      const p2p_cmds = instance.PASS_TO_PASS.map(pt =>
        `${PYTHON} -m pytest "${pt}" --no-header -q`
      ).join(' ');
      const p2pCode = await runOne(p2p_cmds, cwd, base.timeoutMs);
      if (p2pCode !== 0) return false;
    }

    return true;
  }
}

// --- 加载实例 ---
async function loadInstances(instancesPath, limit) {
  let raw;
  if (instancesPath && existsSync(instancesPath)) {
    raw = JSON.parse(readFileSync(instancesPath, 'utf8'));
  } else {
    // 默认从 HuggingFace 加载
    const { load_dataset } = await import('datasets');
    const ds = load_dataset('princeton-nlp/SWE-bench_Verified', 'test');
    raw = Array.from(ds).slice(0, limit);
  }
  if (!Array.isArray(raw)) throw new Error('实例必须是数组');
  return raw.map(r => normalizeInstance(r));
}

// --- 主流程 ---
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  loadDotEnv();

  console.log('\n=== SWE-bench 真实跑分（fhcode 生产 agent）===');
  console.log(`实例数限制: ${opts.limit}, 报告输出: ${opts.report || 'stdout'}`);

  ensureVenv38();

  // 加载实例
  const instances = await loadInstances(opts.instances, opts.limit);
  console.log(`加载实例: ${instances.length} 个`);

  // 对每个实例准备 worktree 并执行
  const results = [];
  const skipped = [];
  for (const inst of instances) {
    const iid = inst.instance_id;
    console.log(`\n[${iid}] 准备环境...`);
    const repoDir = join(WORK_DIR, inst.repo.split('/')[1]);
    const wtName = `wt_${iid}`;
    const wtPath = join(WORK_DIR, wtName);

    try {
      cloneOrEnsureWorktree(inst.repo, inst.base_commit, wtName);
      pipInstallEditable(repoDir);
    } catch (e) {
      console.log(`  ❌ 环境准备失败: ${e.message.slice(0, 100)}`);
      results.push({ instance_id: iid, ok: false, reason: 'env_setup_failed', error: e.message });
      continue;
    }

    // 调用 fhcode RealModelExecutor
    console.log(`  驱动 fhcode 生产 agent...`);
    const executor = new RealModelExecutor({ maxIterations: 20 });
    let execResult;
    try {
      execResult = await executor.execute(inst);
    } catch (e) {
      console.log(`  ❌ agent 执行失败: ${e.message.slice(0, 200)}`);
      results.push({ instance_id: iid, ok: false, reason: 'agent_error', error: e.message });
      continue;
    }

    // 验证
    const verifier = new PythonTestVerifier();
    const resolved = await verifier.verify(execResult.cwd, inst);

    if (resolved === null) {
      skipped.push(iid);
    } else {
      results.push({
        instance_id: iid,
        ok: resolved,
        iterations: execResult.iterations,
        toolCalls: execResult.toolCalls,
        reason: resolved ? 'resolved' : 'unresolved',
      });
    }

    execResult.cleanup();
  }

  // 汇总
  const resolved = results.filter(r => r.ok).length;
  const total = results.length - skipped.length;
  const rate = total > 0 ? resolved / total : 0;

  console.log('\n========== 跑分结果 ==========');
  console.log(`有效实例: ${total}, 已剔除(无区分度): ${skipped.length}`);
  console.log(`Resolved: ${resolved}/${total} (${(rate * 100).toFixed(1)}%)`);
  console.log(`耗时: ~${results.reduce((a, r) => a + (r.iterations || 0), 0)} 轮迭代`);

  console.log('\n--- 逐实例 ---');
  for (const r of results) {
    const icon = r.ok ? '✅' : (r.reason === 'skipped' ? '⚠️' : '❌');
    console.log(`  ${icon} ${r.instance_id}  ${r.reason}${r.iterations ? ` (iter=${r.iterations})` : ''}`);
  }
  if (skipped.length) {
    console.log(`\n⚠️ 剔除实例（无区分度）: ${skipped.join(', ')}`);
  }

  if (opts.report) {
    const report = {
      date: new Date().toISOString().slice(0, 10),
      model: 'agnes-2.5-flash (fhcode RealModelExecutor)',
      dataset: 'SWE-bench_Verified (subset)',
      total,
      resolved,
      rate,
      skipped,
      results,
    };
    writeFileSync(opts.report, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n报告已写入: ${opts.report}`);
  }

  // 退出码：有失败实例则非零（供 CI 门禁）
  if (resolved < total) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });
