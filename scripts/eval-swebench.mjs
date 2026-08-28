#!/usr/bin/env node
/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * v0.5.0-b M2.1：SWE-bench 数据集加载器（下载 + 缓存 + 解析）。
 *
 * 数据源：
 *  - 默认 HuggingFace datasets-server 免认证 API（rows 分页拉取）
 *  - 可用 FH_SWEBENCH_DATA_URL 覆盖为镜像/离线 JSON（国内网络友好）
 *  - 缓存到 ~/.feihong-code/bench/swebench-<split>.json，二次运行免下载
 *
 * 用法：
 *   node scripts/eval-swebench.mjs --split lite --limit 5          # 列表
 *   node scripts/eval-swebench.mjs --split lite --limit 5 --json   # 结构化输出
 *   FH_SWEBENCH_DATA_URL=https://mirror.example/swebench.json node scripts/eval-swebench.mjs --limit 3
 *
 * 输出字段（对齐 SWE-bench 官方实例结构）：
 *   instance_id / repo / base_commit / problem_statement / patch / test_patch /
 *   FAIL_TO_PASS / PASS_TO_PASS / created_at / version
 */
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, writeFileSync as ws } from 'fs';
import { homedir, tmpdir } from 'os';
import { randomUUID } from 'crypto';

const require = createRequire(import.meta.url);
const __baseDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(__baseDir, '..', 'dist');

const HF_BASE = 'https://datasets-server.huggingface.co';
const DATASETS = {
  lite: { id: 'SWE-bench/SWE-bench_Lite', split: 'test' },
  verified: { id: 'SWE-bench/SWE-bench_Verified', split: 'test' },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] ?? fallback : fallback;
  };
  return {
    split: get('--split', 'lite'),
    limit: Number(get('--limit', '10')),
    json: args.includes('--json'),
    offset: Number(get('--offset', '0')),
    run: args.includes('--run'), // M2.4: 执行模式（mock 驱动实例闭环 + 报告）
    report: get('--report', ''), // 报告输出路径（缺省 stdout）
  };
}

function cachePath(split) {
  const dir = join(homedir(), '.feihong-code', 'bench');
  return { dir, file: join(dir, `swebench-${split}.json`) };
}

/** 从 HF datasets-server 分页拉取 rows */
async function fetchHfRows(dataset, split, offset, length) {
  const url = `${HF_BASE}/rows?dataset=${encodeURIComponent(dataset)}&config=default&split=${split}&offset=${offset}&length=${length}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'fhcode/0.5' } });
  if (!res.ok) throw new Error(`HF API HTTP ${res.status}（${url}）`);
  const data = await res.json();
  if (!Array.isArray(data.rows)) throw new Error('HF API 响应缺少 rows 字段');
  return data.rows.map((r) => r.row);
}

/** 从镜像/离线 JSON 文件加载全部实例（数组或 {instances: []} 均可） */
function loadMirror(fileOrUrl) {
  const read = async () => {
    if (/^https?:\/\//i.test(fileOrUrl)) {
      const res = await fetch(fileOrUrl, { headers: { 'User-Agent': 'fhcode/0.5' } });
      if (!res.ok) throw new Error(`镜像 HTTP ${res.status}`);
      return await res.text();
    }
    return readFileSync(fileOrUrl, 'utf8');
  };
  return read().then((text) => {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed.instances ?? [];
  });
}

/** 归一化实例字段（容忍 HF 字符串化数组 / 缺失字段） */
function normalizeInstance(row) {
  const parseList = (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      try {
        const parsed = JSON.parse(v);
        return Array.isArray(parsed) ? parsed : [v];
      } catch {
        return [v];
      }
    }
    return [];
  };
  return {
    instance_id: row.instance_id ?? 'unknown',
    repo: row.repo ?? '',
    base_commit: row.base_commit ?? '',
    problem_statement: row.problem_statement ?? '',
    patch: row.patch ?? '',
    test_patch: row.test_patch ?? '',
    FAIL_TO_PASS: parseList(row.FAIL_TO_PASS),
    PASS_TO_PASS: parseList(row.PASS_TO_PASS),
    created_at: row.created_at ?? '',
    version: row.version ?? '',
  };
}

/**
 * M2.4：mock 模式执行单个 SWE-bench 实例——
 * 在临时工作区写入 problem_statement，用 ScriptedMockProvider 驱动编排器
 * 跑「勘察→写方案文件→总结」闭环，验证 pipeline 可用并记录指标。
 * （真实模型/容器验证属 M2.2/M2.3，后续迭代接入）
 */
async function runInstance(inst) {
  const { Orchestrator } = require(join(distDir, 'agent', 'orchestrator.js'));
  const { ScriptedMockProvider } = require(join(distDir, 'models', 'providers', 'mock.provider.js'));
  const { createDefaultRegistry } = require(join(distDir, 'tools', 'index.js'));
  const { EventLog } = require(join(distDir, 'runtime', 'event-log.js'));
  const { SessionStore } = require(join(distDir, 'runtime', 'session-store.js'));

  const runId = randomUUID();
  const logDir = mkdtempSync(join(tmpdir(), 'fhcode-swebench-'));
  const cwd = mkdtempSync(join(tmpdir(), 'fhcode-swebench-ws-'));
  const stats = { toolCalls: 0 };

  // 问题陈述作为任务目标；mock 步骤：读问题文件 → 写方案 → 总结
  const steps = [
    {
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 't1', name: 'write_file', arguments: { path: 'SOLUTION.md', content: `# Solution for ${inst.instance_id}\n\n${(inst.problem_statement || '').slice(0, 500)}` } },
        ],
      },
    },
    { message: { role: 'assistant', content: `已完成 ${inst.instance_id} 方案`, toolCalls: [] } },
  ];

  try {
    const provider = new ScriptedMockProvider(steps);
    const router = { chat: async (req) => provider.chat(req), getStats: () => [] };
    const tools = createDefaultRegistry();
    const eventLog = new EventLog(runId, logDir);
    const session = new SessionStore(runId, cwd);
    const orch = new Orchestrator({
      router,
      tools,
      eventLog,
      session,
      cwd,
      security: { shellAllowlist: [], requireApproval: false },
      maxIterations: 4,
      maxCostUsd: 0,
      onEvent: (ev) => {
        if (ev.type === 'tool.result') stats.toolCalls++;
      },
    });
    const result = await orch.run(inst.problem_statement || inst.instance_id);
    const solutionOk = existsSync(join(cwd, 'SOLUTION.md'));
    return {
      instance_id: inst.instance_id,
      repo: inst.repo,
      problem: (inst.problem_statement || '').split('\n')[0].slice(0, 80),
      failToPass: inst.FAIL_TO_PASS.length,
      passToPass: inst.PASS_TO_PASS.length,
      ok: result.ok && solutionOk,
      iterations: result.iterations,
      toolCalls: stats.toolCalls,
      solutionWritten: solutionOk,
    };
  } finally {
    rmSync(logDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** M2.4：生成 markdown 报告（表格 + 汇总）与 JSON 数据 */
function buildReport(results, meta) {
  const completed = results.filter((r) => r.ok).length;
  const lines = [];
  lines.push('# SWE-bench 跑分报告（mock 模式）');
  lines.push('');
  lines.push(`- 数据集: ${meta.split} · 实例数: ${results.length} · 完成: ${completed} · 通过率: ${results.length ? Math.round((completed / results.length) * 100) : 0}%`);
  lines.push(`- 运行时间: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| instance_id | repo | 问题 | F2P | P2P | 结果 | 迭代 | 工具 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(`| ${r.instance_id} | ${r.repo} | ${r.problem} | ${r.failToPass} | ${r.passToPass} | ${r.ok ? '✅' : '❌'} | ${r.iterations} | ${r.toolCalls} |`);
  }
  lines.push('');
  lines.push(`汇总: ${completed}/${results.length} 通过（mock pipeline 验证，真实模型/容器验证见 M2.2/M2.3）`);
  return {
    markdown: lines.join('\n'),
    json: { meta, results, summary: { total: results.length, completed, rate: results.length ? completed / results.length : 0 } },
  };
}
export async function loadSwebenchInstances({ split = 'lite', force = false } = {}) {
  const { dir, file } = cachePath(split);
  if (!force && existsSync(file)) {
    try {
      const rows = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(rows)) return rows;
    } catch {
      /* 缓存损坏则重新拉取 */
    }
  }
  const mirror = process.env.FH_SWEBENCH_DATA_URL;
  let rows;
  if (mirror) {
    rows = await loadMirror(mirror);
  } else {
    const ds = DATASETS[split];
    if (!ds) throw new Error(`未知 split: ${split}（可选 lite|verified）`);
    // 分页拉取（每页 100）
    rows = [];
    for (let offset = 0; offset < 300; offset += 100) {
      const page = await fetchHfRows(ds.id, ds.split, offset, 100);
      rows.push(...page);
      if (page.length < 100) break;
    }
  }
  const normalized = rows.map(normalizeInstance);
  // 写缓存
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(normalized), 'utf8');
    console.error(`[swebench] 已缓存 ${normalized.length} 条 -> ${file}`);
  } catch {
    /* 缓存失败不影响使用 */
  }
  return normalized;
}

async function main() {
  const { split, limit, json, offset, run, report } = parseArgs();
  console.log(`=========== v0.5.0-b SWE-bench 加载器/执行器（${split}） ===========\n`);
  try {
    const all = await loadSwebenchInstances({ split });
    const slice = all.slice(offset, offset + limit);
    console.log(`数据集共 ${all.length} 条，本次处理 ${slice.length} 条（offset=${offset}）`);

    if (run) {
      // M2.4 执行模式：mock 驱动实例闭环 + 报告
      console.log('\n--- 执行实例（mock pipeline 验证） ---');
      const results = [];
      for (const inst of slice) {
        const r = await runInstance(inst);
        results.push(r);
        console.log(`  ${r.ok ? '✅' : '❌'} ${r.instance_id.padEnd(30)} ${r.problem.slice(0, 40)}  iter=${r.iterations} tools=${r.toolCalls}`);
      }
      const rep = buildReport(results, { split, limit, offset });
      if (report) {
        writeFileSync(report, rep.markdown, 'utf8');
        console.log(`\n报告已写入: ${report}`);
      } else {
        console.log('\n' + rep.markdown);
      }
      if (json) console.log('\n=== JSON ===\n' + JSON.stringify(rep.json, null, 2));
      // 有失败实例 → 退出码非零（供 CI 门禁复用）
      if (rep.json.summary.completed < rep.json.summary.total) process.exitCode = 1;
      console.log(`\n晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹`);
      return;
    }

    if (json) {
      console.log(JSON.stringify(slice, null, 2));
      return;
    }
    for (const inst of slice) {
      console.log(`\n[${inst.instance_id}] repo=${inst.repo} base=${inst.base_commit?.slice(0, 7)}`);
      console.log(`  问题: ${(inst.problem_statement || '').split('\n')[0].slice(0, 100)}`);
      console.log(`  FAIL_TO_PASS: ${inst.FAIL_TO_PASS.length} · PASS_TO_PASS: ${inst.PASS_TO_PASS.length} · patch: ${(inst.patch || '').length}B`);
    }
  } catch (e) {
    console.error(`❌ 运行失败: ${e instanceof Error ? e.message : String(e)}`);
    console.error('提示：可用 FH_SWEBENCH_DATA_URL 指向镜像/离线 JSON，或检查网络后重试。');
    process.exit(1);
  }
  console.log(`\n晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹`);
}

// 直接运行（node scripts/eval-swebench.mjs）时执行 main
// 用 pathToFileURL 归一化比较，兼容 Windows 盘符路径（import.meta.url 带 file:/// 前缀）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('运行失败:', e);
    process.exit(1);
  });
}
