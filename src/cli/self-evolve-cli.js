#!/usr/bin/env node
/**
 * Self-Evolve CLI - 自我迭代升级命令行接口
 */

const { SelfEvolveManager } = require('../self-evolve/manager.js');
const commander = require('commander');

const program = new commander.Command();
const manager = new SelfEvolveManager();

program
  .name('self-evolve')
  .description('飞虹 Code 自我学习与迭代升级系统')
  .version('1.0.0');

// init 命令
program
  .command('init')
  .description('初始化自我迭代系统')
  .action(() => {
    manager.init();
  });

// status 命令
program
  .command('status')
  .description('查看自我迭代统计信息')
  .action(() => {
    const stats = manager.getStatistics();
    console.log('\n📊 自我迭代系统状态');
    console.log('='.repeat(40));
    console.log(`总失败记录: ${stats.total_failures}`);
    console.log(`已解决:     ${stats.resolved}`);
    console.log(`待处理:     ${stats.pending}`);
    console.log(`解决率:     ${stats.resolution_rate}`);
    console.log(`技能库:     ${stats.total_skills} 个技能`);
    console.log('');
    
    if (Object.keys(stats.by_type).length > 0) {
      console.log('错误类型分布:');
      Object.entries(stats.by_type).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
    }
  });

// failures 命令
program
  .command('failures')
  .description('管理失败记录')
  .addCommand(
    new commander.Command('list')
      .description('列出失败记录')
      .option('-t, --type <type>', '按错误类型过滤')
      .option('-s, --status <status>', '按状态过滤 (pending/resolved)')
      .option('-d, --days <days>', '最近N天的记录')
      .action((options) => {
        const filters = {};
        if (options.type) filters.type = options.type;
        if (options.status) filters.status = options.status;
        if (options.days) filters.days = parseInt(options.days);
        
        const failures = manager.listFailures(filters);
        
        if (failures.length === 0) {
          console.log('暂无失败记录');
          return;
        }
        
        console.log(`\n找到 ${failures.length} 条失败记录:\n`);
        failures.forEach(f => {
          const statusIcon = f.status === 'resolved' ? '✅' : '⏳';
          console.log(`${statusIcon} [${f.id.slice(0, 8)}] ${f.error_type}`);
          console.log(`   任务: ${f.task.slice(0, 60)}${f.task.length > 60 ? '...' : ''}`);
          console.log(`   错误: ${f.error_message.slice(0, 80)}${f.error_message.length > 80 ? '...' : ''}`);
          if (f.solution) {
            console.log(`   解决: ${f.solution.slice(0, 60)}...`);
          }
          console.log('');
        });
      })
  );

// skills 命令
program
  .command('skills')
  .description('管理技能库')
  .addCommand(
    new commander.Command('list')
      .description('列出所有技能')
      .action(() => {
        const skills = manager.listSkills();
        
        if (skills.length === 0) {
          console.log('技能库为空');
          return;
        }
        
        console.log(`\n技能库 (${skills.length} 个技能):\n`);
        skills.forEach(s => {
          console.log(`📦 ${s.name} v${s.version}`);
          console.log(`   ${s.description}`);
          console.log(`   触发词: ${s.triggers ? s.triggers.join(', ') : '无'}`);
          console.log(`   使用次数: ${s.usage_count}`);
          console.log('');
        });
      })
  );

// create-skill 命令
program
  .command('create-skill')
  .description('创建新技能')
  .requiredOption('-n, --name <name>', '技能名称')
  .requiredOption('-d, --description <description>', '技能描述')
  .requiredOption('-p, --pattern <pattern>', '错误模式/类型')
  .requiredOption('-s, --solution <solution>', '解决方案')
  .option('-t, --triggers <triggers>', '触发词（逗号分隔）', '')
  .action((options) => {
    const triggers = options.triggers 
      ? options.triggers.split(',').map(t => t.trim()) 
      : [options.name];
    
    const skill = manager.createSkill(
      options.name,
      options.description,
      triggers,
      options.pattern,
      options.solution
    );
    
    console.log(`\n✅ 技能已创建: ${skill.name}`);
    console.log(`   位置: ~/.feihong-code/skills/${skill.name}/SKILL.md`);
  });

// review 命令
program
  .command('review')
  .description('定期复盘')
  .addCommand(
    new commander.Command('--daily')
      .description('生成每日复盘报告')
      .action(() => {
        const report = manager.generateDailyReport();
        
        console.log('\n📅 每日复盘报告');
        console.log('='.repeat(40));
        console.log(`日期: ${report.date}`);
        console.log(`失败任务: ${report.total_failures}`);
        console.log(`已解决: ${report.resolved}`);
        console.log(`待处理: ${report.pending}`);
        console.log(`新技能: ${report.new_skills}`);
        
        if (report.failures.length > 0) {
          console.log('\n今日失败详情:');
          report.failures.forEach(f => {
            const icon = f.status === 'resolved' ? '✅' : '⏳';
            console.log(`  ${icon} [${f.id}] ${f.type}: ${f.message}`);
          });
        }
      })
  );

// analyze 命令
program
  .command('analyze')
  .description('分析错误模式，建议创建技能')
  .option('-d, --days <days>', '分析最近N天', '7')
  .action((options) => {
    const days = parseInt(options.days);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const recentFailures = manager.listFailures({ days });
    const byType = {};
    
    recentFailures.forEach(f => {
      if (!byType[f.error_type]) {
        byType[f.error_type] = [];
      }
      byType[f.error_type].push(f);
    });
    
    console.log(`\n🔍 最近 ${days} 天的错误模式分析`);
    console.log('='.repeat(40));
    
    Object.entries(byType).forEach(([type, failures]) => {
      console.log(`\n${type} (${failures.length} 次)`);
      
      // 检查是否已有解决方案
      const existing = manager.skillsIndex.find(s => s.error_pattern === type);
      if (existing) {
        console.log(`  ✅ 已有技能: ${existing.name}`);
      } else {
        console.log(`  ⚠️  建议创建新技能`);
        console.log(`     示例: fhcode self-evolve create-skill \\`);
        console.log(`       --name ${type}-handler \\`);
        console.log(`       --description "处理${type}" \\`);
        console.log(`       --pattern ${type} \\`);
        console.log(`       --solution "根据具体情况处理" \\`);
        console.log(`       --triggers "${type}, error"`);
      }
    });
  });

// 主入口
program.parse(process.argv);
