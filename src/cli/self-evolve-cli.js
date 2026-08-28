#!/usr/bin/env node
/**
 * Self-Evolve CLI - 自我迭代升级命令行接口
 *
 * 说明：本文件不依赖 commander（此前为未声明的第三方依赖，导致全新安装时
 * `Cannot find module 'commander'` 崩溃）。改为手写参数解析，自包含、零依赖，
 * 与 src/self-evolve/manager.js 的 CLI 入口语义保持一致。
 * 主入口：`fhcode self-evolve <subcommand>`（见 run.ts runSelfEvolve）。
 */

const { SelfEvolveManager } = require('../self-evolve/manager.js');

const manager = new SelfEvolveManager();

/** 简单标志解析：支持 `--flag value` 与 `--flag=value` */
function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
      const inline = eq >= 0 ? a.slice(eq + 1) : undefined;
      flags[name] = inline !== undefined ? inline : args[i + 1];
      if (inline === undefined && flags[name] !== undefined && !flags[name].startsWith('-')) i++;
      else if (inline === undefined) flags[name] = true;
    } else if (a.startsWith('-') && a.length === 2) {
      flags[a.slice(1)] = args[i + 1];
      if (flags[a.slice(1)] !== undefined && !String(flags[a.slice(1)]).startsWith('-')) i++;
      else flags[a.slice(1)] = true;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function printUsage() {
  console.log('自我迭代管理系统（fhcode self-evolve）');
  console.log('用法:');
  console.log('  fhcode self-evolve init                    - 初始化系统');
  console.log('  fhcode self-evolve status                  - 查看统计');
  console.log('  fhcode self-evolve failures list [-t 类型] [-s 状态] [-d 天数]  - 列出失败');
  console.log('  fhcode self-evolve skills list             - 列出技能');
  console.log('  fhcode self-evolve create-skill -n 名称 -d 描述 -p 模式 -s 方案 [-t 触发词]  - 创建技能');
  console.log('  fhcode self-evolve review --daily          - 每日复盘');
  console.log('  fhcode self-evolve analyze [-d 天数]       - 错误模式分析');
}

/** 统一的子命令入口：既可被 `fhcode self-evolve` 主 CLI 复用，也可独立运行 */
function runCli(argv) {
  const args = Array.isArray(argv) ? argv.slice() : process.argv.slice(2);
  if (args.length === 0) {
    printUsage();
    return;
  }
  const { flags, positional } = parseFlags(args);
  const [cmd, sub] = positional;

  if (cmd === 'init') {
    manager.init();
  } else if (cmd === 'status') {
    const stats = manager.getStatistics();
    console.log('\n📊 自我迭代系统状态');
    console.log('='.repeat(40));
    console.log(`总失败记录: ${stats.total_failures}`);
    console.log(`已解决:     ${stats.resolved}`);
    console.log(`待处理:     ${stats.pending}`);
    console.log(`解决率:     ${stats.resolution_rate}`);
    console.log(`技能库:     ${stats.total_skills} 个技能`);
    console.log(`共享经验库: ${stats.total_experiences} 条经验（experiences.jsonl，与 self-improve 共用）`);
    if (Object.keys(stats.by_type).length > 0) {
      console.log('错误类型分布:');
      Object.entries(stats.by_type).forEach(([type, count]) => console.log(`  ${type}: ${count}`));
    }
  } else if (cmd === 'failures' && sub === 'list') {
    const filters = {};
    if (flags.t || flags.type) filters.type = flags.t || flags.type;
    if (flags.s || flags.status) filters.status = flags.s || flags.status;
    if (flags.d || flags.days) filters.days = parseInt(flags.d || flags.days, 10);
    const failures = manager.listFailures(filters);
    if (failures.length === 0) {
      console.log('暂无失败记录');
      return;
    }
    console.log(`\n找到 ${failures.length} 条失败记录:\n`);
    failures.forEach((f) => {
      const icon = f.status === 'resolved' ? '✅' : '⏳';
      console.log(`${icon} [${f.id.slice(0, 8)}] ${f.error_type}`);
      console.log(`   任务: ${String(f.task).slice(0, 60)}`);
      console.log(`   错误: ${String(f.error_message).slice(0, 80)}`);
      if (f.solution) console.log(`   解决: ${String(f.solution).slice(0, 60)}`);
      console.log('');
    });
  } else if (cmd === 'skills' && sub === 'list') {
    const skills = manager.listSkills();
    if (skills.length === 0) {
      console.log('技能库为空');
      return;
    }
    console.log(`\n技能库 (${skills.length} 个技能):\n`);
    skills.forEach((s) => {
      console.log(`📦 ${s.name} v${s.version}`);
      console.log(`   ${s.description}`);
      console.log(`   触发词: ${(s.triggers || []).join(', ') || '无'}`);
      console.log(`   使用次数: ${s.usage_count}`);
      console.log('');
    });
  } else if (cmd === 'create-skill') {
    const name = flags.n || flags.name;
    const description = flags.d || flags.description;
    const pattern = flags.p || flags.pattern;
    const solution = flags.s || flags.solution;
    if (!name || !description || !pattern || !solution) {
      console.error('create-skill 需要 -n/--name -d/--description -p/--pattern -s/--solution');
      process.exitCode = 1;
      return;
    }
    const triggers = (flags.t || flags.triggers || '').split(',').map((t) => t.trim()).filter(Boolean) || [name];
    const skill = manager.createSkill(name, description, triggers, pattern, solution);
    console.log(`\n✅ 技能已创建: ${skill.name}`);
    console.log(`   位置: ~/.feihong-code/skills/${skill.name}/SKILL.md`);
  } else if (cmd === 'review' && (flags.daily || flags.d === 'daily')) {
    const report = manager.generateDailyReport();
    console.log('\n📅 每日复盘报告');
    console.log('='.repeat(40));
    console.log(`日期: ${report.date}`);
    console.log(`失败任务: ${report.total_failures}`);
    console.log(`已解决: ${report.resolved}`);
    console.log(`待处理: ${report.pending}`);
    console.log(`新技能: ${report.new_skills}`);
    report.failures.forEach((f) => {
      const icon = f.status === 'resolved' ? '✅' : '⏳';
      console.log(`  ${icon} [${f.id}] ${f.type}: ${f.message}`);
    });
  } else if (cmd === 'analyze') {
    const days = parseInt(flags.d || flags.days || '7', 10);
    const recentFailures = manager.listFailures({ days });
    const byType = {};
    recentFailures.forEach((f) => {
      (byType[f.error_type] = byType[f.error_type] || []).push(f);
    });
    console.log(`\n🔍 最近 ${days} 天的错误模式分析`);
    console.log('='.repeat(40));
    Object.entries(byType).forEach(([type, failures]) => {
      console.log(`\n${type} (${failures.length} 次)`);
      const existing = manager.skillsIndex.find((s) => s.error_pattern === type);
      if (existing) console.log(`  ✅ 已有技能: ${existing.name}`);
      else {
        console.log(`  ⚠️  建议创建新技能`);
        console.log(`     示例: fhcode self-evolve create-skill \\`);
        console.log(`       --name ${type}-handler --description "处理${type}" --pattern ${type} --solution "根据具体情况处理"`);
      }
    });
  } else if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printUsage();
  } else {
    printUsage();
    process.exitCode = 1;
  }
}

module.exports = { runCli };

if (require.main === module) {
  runCli(process.argv.slice(2));
}
