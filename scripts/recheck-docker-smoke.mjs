#!/usr/bin/env node
/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P0→P2 交付遗留：docker 容器执行层自动复跑（幂等脚本）
 * 背景：_p2-smoke.mjs 的「docker 容器执行层真实运行」依赖 docker daemon；
 *       本机 client 在但 daemon 未起时该项失败（非内核/分发层改动导致）。
 * 本脚本幂等：
 *  - daemon 未起 → 落 docs/docker-smoke-result.md 为 PENDING，优雅退出 0（可重复跑、不报错）
 *  - daemon 起   → 自动实测 runCommandInContainer 容器执行层，结果落 docs/docker-smoke-result.md
 * 用法：node scripts/recheck-docker-smoke.mjs
 * 配合 WorkBuddy 定时任务：daemon 起来那一次即自动补齐并留存结果。
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const resultDir = join(repoRoot, 'docs');
const resultPath = join(resultDir, 'docker-smoke-result.md');

/** 检测 docker daemon 是否可用（用 docker info 而非 docker --version，后者只测 client） */
function dockerDaemonUp() {
  try {
    execSync('docker info >/dev/null 2>&1', { stdio: 'ignore', timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

function writeResult(status, body) {
  mkdirSync(resultDir, { recursive: true });
  const ts = new Date().toISOString();
  const lines = [
    '# P0→P2 交付 · docker 容器执行层复跑结果',
    '> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹',
    `> 最近更新：${ts}`,
    '',
    `## 状态：${status}`,
    '',
    '## 明细',
    body,
    '',
    '> 由 `scripts/recheck-docker-smoke.mjs` 幂等生成；daemon 未起为 PENDING，daemon 起来自动实测补齐。',
    '',
  ];
  writeFileSync(resultPath, lines.join('\n'), 'utf8');
}

async function main() {
  // 依赖 dist 产物（runCommandInContainer 在 dist/tools/shell/exec.js）
  const execJs = join(repoRoot, 'dist', 'tools', 'shell', 'exec.js');
  if (!existsSync(execJs)) {
    writeResult(
      '⚠️ SKIPPED（需先 build）',
      `- 时间：${new Date().toISOString()}\n- 原因：未找到 \`${execJs}\`，请先跑 \`npm run build\` 再复跑本脚本。`,
    );
    console.log('⚠️ 未找到 dist/tools/shell/exec.js，请先 npm run build。本次跳过（结果已落 docs/docker-smoke-result.md）。');
    return; // 幂等，不报错
  }

  if (!dockerDaemonUp()) {
    writeResult(
      '⏸ PENDING（docker daemon 未起）',
      `- 时间：${new Date().toISOString()}\n- 检测：\`docker info\` 退出非 0，daemon 未启动（client 在）。\n- 处理：daemon 起来后复跑 \`node scripts/recheck-docker-smoke.mjs\` 即自动实测容器执行层。`,
    );
    console.log('⏸ docker daemon 未起，容器执行层维持 PENDING（结果已落 docs/docker-smoke-result.md）。daemon 起来后复跑即自动补齐。');
    return;
  }

  // daemon 已起：实测容器执行层
  let body;
  let status;
  try {
    const { runCommandInContainer } = await import(execJs);
    const r = await runCommandInContainer('echo container-ok && node --version', process.cwd(), 60000);
    const ok = r.code === 0 && /container-ok/.test(r.stdout);
    status = ok ? '✅ PASS（容器执行层实测通过）' : `❌ FAIL（容器执行层 exit=${r.code}）`;
    body = [
      `- 时间：${new Date().toISOString()}`,
      '- 检测：`docker info` exit 0，daemon 可用',
      "- 实测：`runCommandInContainer('echo container-ok && node --version')`",
      `- 结果：exit=${r.code}，stdout=${JSON.stringify((r.stdout || '').slice(0, 200))}`,
      ok
        ? '- 结论：容器执行层真实运行通过，P0→P2 遗留清零。'
        : '- 结论：daemon 在但容器执行层仍失败，需进一步排查（非 P0→P2 分发层改动范围）。',
    ].join('\n');
  } catch (e) {
    status = '❌ FAIL（调用异常）';
    body = `- 时间：${new Date().toISOString()}\n- 检测：daemon 可用，但 runCommandInContainer 抛出：${String(e)}\n- 结论：需进一步排查。`;
  }
  writeResult(status, body);
  console.log(status);
  if (status.startsWith('❌')) process.exitCode = 1;
}

main();
