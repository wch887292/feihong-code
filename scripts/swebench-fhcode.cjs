#!/usr/bin/env node
/**
 * SWE-bench 真实跑分 harness（fhcode 生产 agent 驱动）
 *
 * 不再依赖 RealModelExecutor（它用临时目录，看不到预建 worktree），
 * 而是直接组装 fhcode 生产 agent 的核心组件：
 *   ModelRouter.fromConfig(cfg) → Orchestrator({ cwd: <worktree> }) → 真实模型修复
 * 验证器使用 PythonTestVerifier（pytest 跑 FAIL_TO_PASS + PASS_TO_PASS）。
 *
 * 用法：
 *   node scripts/swebench-fhcode.cjs [--instances bench/real/django_inst.json] [--limit N] [--report path]
 */
const { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } = require('fs');
const { join } = require('path');
const { execSync } = require('child_process');
const { randomUUID } = require('crypto');

// fhcode 生产组件
const { ModelRouter } = require('../dist/models/model-router.js');
const { Orchestrator } = require('../dist/agent/orchestrator.js');
const { createDefaultRegistry } = require('../dist/tools/index.js');
const { EventLog } = require('../dist/runtime/event-log.js');
const { SessionStore } = require('../dist/runtime/session-store.js');
const { loadDotEnv, loadConfig } = require('../dist/shared/config.js');
const { normalizeInstance } = require('../dist/harness/loader.js');
const { runCommand, sanitizeManagedCommand } = require('../dist/tools/shell/exec.js');

const ROOT = process.cwd();
const VENV38 = join(ROOT, 'bench/real/venv38');
const WORK_DIR = join(ROOT, 'bench/real/work');
const PYTHON = `"${join(VENV38, 'Scripts', 'python.exe')}"`;
const PIP = `"${join(VENV38, 'Scripts', 'pip.exe')}"`;

// --- 命令行 ---
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
  if (!existsSync(join(VENV38, 'Scripts', 'python.exe'))) {
    throw new Error('Python 3.8 venv 不存在');
  }
  try { execSync(`${PYTHON} -m pytest --version`, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }); }
  catch { execSync(`${PIP} install pytest`, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }); }
}

function cloneOrEnsureWorktree(repo, baseCommit, worktreeDir) {
  const shortRepo = repo.split('/')[1];
  // 优先尝试 <repo> 目录；若目标 commit 不在其中则回退到 <repo>_repo
  let repoDir = join(WORK_DIR, shortRepo);
  if (existsSync(repoDir)) {
    try {
      execSync(`git cat-file -t "${baseCommit}"`, { cwd: repoDir, encoding: 'utf8', stdio: 'pipe' });
    } catch (_) {
      // commit 不存在于此仓库，尝试同名 _repo 目录
      const altDir = join(WORK_DIR, shortRepo + '_repo');
      if (existsSync(altDir)) repoDir = altDir;
    }
  }
  const wtPath = require('path').resolve(join(WORK_DIR, worktreeDir));
  // 若工作区已存在且 checkout 正确则直接返回
  if (existsSync(wtPath)) {
    const current = execSync('git rev-parse --short=8 HEAD', { cwd: wtPath, encoding: 'utf8', stdio: 'pipe' }).trim();
    if (current === baseCommit.slice(0, 8)) {
      // reset 到干净状态
      execSync('git checkout -- . && git clean -fd', { cwd: wtPath, encoding: 'utf8', stdio: 'pipe' });
      return wtPath;
    }
  }
  // 确保 repo 仓库存在
  if (!existsSync(repoDir)) {
    console.log(`  克隆 ${repo}...`);
    execSync(`git clone --quiet https://github.com/${repo}.git "${repoDir}"`,
      { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  }
  execSync(`git -C "${repoDir}" worktree add -q "${wtPath}" "${baseCommit}"`,
    { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  return wtPath;
}

function pipInstallEditable(repoDir) {
  try {
    execSync(`${PIP} install -e "${repoDir}"`, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
  } catch (e) {
    console.log(`  [WARN] pip editable 失败: ${String(e.message).slice(0, 100)}`);
  }
}

// --- fhcode 生产 agent 执行器（直接组装 Orchestrator，cwd=预建 worktree）---
async function runWithFhcodeAgent(cwd, problemStatement, maxIterations = 25) {
  loadDotEnv();
  const cfg = loadConfig();
  if (!cfg.models.providers.length) throw new Error('未配置模型 provider');
  const router = ModelRouter.fromConfig(cfg);
  const tools = createDefaultRegistry();
  const runId = randomUUID();
  const logDir = mkdtempSync(join(require('os').tmpdir(), 'fhcode-sweb-'));
  const session = new SessionStore(runId, cwd);
  const eventLog = new EventLog(runId, logDir);
  let toolCalls = 0;
  const orch = new Orchestrator({
    router, tools, eventLog, session, cwd,
    security: { shellAllowlist: [], requireApproval: false },
    maxIterations, maxCostUsd: 0,
    onEvent: (ev) => { if (ev.type === 'tool.result') toolCalls++; },
  });
  const result = await orch.run(problemStatement);
  // 清理临时日志
  rmSync(logDir, { recursive: true, force: true });
  return { iterations: result.iterations, toolCalls, resolved: result.ok, finalAnswer: result.finalAnswer };
}

// --- Python 测试验证器 ---
async function verifyPython(cwd, instance) {
  const timeoutMs = 300000;
  const runOne = async (cmd, wd) => {
    const safe = sanitizeManagedCommand(cmd, cmd);
    if (!safe) return -1;
    const res = await runCommand(safe, wd, timeoutMs);
    return res.code;
  };

  // 0) 区分度检测：修复前 FAIL_TO_PASS 必须确实失败
  const fmt = (f) => `"${PYTHON}" -m pytest "${f}" --no-header -q`;
  const ftp_cmds = instance.FAIL_TO_PASS.map(fmt).join(' ');
  const preFail = (await runOne(ftp_cmds, cwd)) !== 0;
  if (!preFail) {
    console.log(`    ⚠️ ${instance.instance_id}：修复前 FAIL_TO_PASS 无失败 → 剔除`);
    return 'skipped';
  }
  // 1) FAIL_TO_PASS 通过后
  if ((await runOne(ftp_cmds, cwd)) !== 0) return false;
  // 2) PASS_TO_PASS 回归
  if (instance.PASS_TO_PASS.length > 0) {
    const p2p_cmds = instance.PASS_TO_PASS.map(fmt).join(' ');
    if ((await runOne(p2p_cmds, cwd)) !== 0) return false;
  }
  return true;
}

// --- 加载实例 ---
async function loadInstances(instancesPath, limit) {
  let raw;
  if (instancesPath && existsSync(instancesPath)) {
    raw = JSON.parse(readFileSync(instancesPath, 'utf8'));
    if (limit < Infinity) raw = raw.slice(0, limit);
  } else {
    console.log('  从 HuggingFace 加载 SWE-bench_Verified（首次较慢）...');
    const { load_dataset } = require('datasets');
    raw = Array.from(load_dataset('princeton-nlp/SWE-bench_Verified', 'test')).slice(0, limit);
  }
  return Array.isArray(raw) ? raw.map(r => normalizeInstance(r)) : [];
}

// --- 主流程 ---
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  loadDotEnv();
  console.log('\n=== SWE-bench 跑分（fhcode 生产 agent: Orchestrator + RealModelExecutor 同款 router）===');
  console.log(`模型: agnes-2.5-flash | 实例限制: ${opts.limit} | 报告: ${opts.report || 'stdout'}`);
  ensureVenv38();

  const instances = await loadInstances(opts.instances, opts.limit);
  console.log(`加载实例: ${instances.length} 个`);

  const results = [];
  const skipped = [];

  for (const inst of instances) {
    const iid = inst.instance_id;
    console.log(`\n[${iid}]`);
    // 优先复用已有 worktree（dj_11099 命名），其次新建 wt_iid
    const existingWt = join(WORK_DIR, iid.replace(/__/g, '_'));
    const wtName = existsSync(existingWt) ? iid.replace(/__/g, '_') : `wt_${iid}`;
    let wtPath;
    try {
      wtPath = cloneOrEnsureWorktree(inst.repo, inst.base_commit, wtName);
      pipInstallEditable(wtPath);
      console.log(`  worktree: ${wtPath}`);
      console.log(`  驱动 fhcode 生产 agent（最大 25 轮迭代）...`);
      const agentResult = await runWithFhcodeAgent(wtPath, inst.problem_statement, 25);
      console.log(`  agent: iter=${agentResult.iterations} tools=${agentResult.toolCalls} ok=${agentResult.resolved}`);
      const verified = await verifyPython(wtPath, inst);
      if (verified === 'skipped') skipped.push(iid);
      else results.push({ instance_id: iid, ok: verified, iterations: agentResult.iterations, toolCalls: agentResult.toolCalls, reason: verified ? 'resolved' : 'unresolved' });
    } catch (e) {
      console.log(`  ❌ ${e.message.slice(0, 120)}`);
      results.push({ instance_id: iid, ok: false, reason: 'error', error: e.message.slice(0, 200) });
    }
  }

  const resolved = results.filter(r => r.ok).length;
  const total = results.length - skipped.length;
  const rate = total > 0 ? resolved / total : 0;

  console.log('\n========== SWE-bench 真实跑分（fhcode 生产 agent）==========');
  console.log(`有效实例: ${total}  |  剔除: ${skipped.length}`);
  console.log(`Resolved: ${resolved}/${total}  (${(rate * 100).toFixed(1)}%)`);
  console.log('\n--- 逐实例 ---');
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    console.log(`  ${icon} ${r.instance_id}  ${r.reason}${r.iterations ? ` (iter=${r.iterations})` : ''}`);
  }
  if (skipped.length) console.log(`\n⚠️ 剔除: ${skipped.join(', ')}`);

  // 不设置 exitCode；SWE-bench 本来就不会 100% 通过
  if (opts.report) {
    writeFileSync(opts.report, JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      model: 'agnes-2.5-flash (fhcode 生产 agent)',
      dataset: 'SWE-bench_Verified (subset)',
      total, resolved, rate, skipped, results,
    }, null, 2), 'utf8');
    console.log(`\n报告已写入: ${opts.report}`);
  }
  if (resolved < total) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(2); });
