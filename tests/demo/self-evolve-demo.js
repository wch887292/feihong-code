#!/usr/bin/env node
/**
 * Self-Evolve 集成测试 - 演示完整工作流
 */

const { SelfEvolveManager } = require('../src/self-evolve/manager.js');
const fs = require('fs');
const path = require('path');

// 设置测试环境
const testDir = path.join(process.env.TEMP || '/tmp', 'self-evolve-demo');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

console.log('🚀 飞虹 Code 自我迭代系统 - 演示\n');
console.log('='.repeat(50));

const manager = new SelfEvolveManager();
manager.init();

// 模拟一些常见的失败场景
console.log('\n📝 场景1: 编译错误');
const buildError = manager.recordFailure(
  'npm run build',
  'error TS2307: Cannot find module \'./missing-file\' or its corresponding type declarations.'
);
console.log(`   记录失败 #${buildError.id.slice(0, 8)}`);

console.log('\n📝 场景2: 路径穿越错误');
const pathError = manager.recordFailure(
  'read_file("../etc/passwd")',
  'Path traversal detected: ../etc/passwd is outside workspace'
);
console.log(`   记录失败 #${pathError.id.slice(0, 8)}`);

console.log('\n📝 场景3: 权限错误');
const permError = manager.recordFailure(
  'write_file("/system/config", data)',
  'EACCES: permission denied, write \'/system/config\''
);
console.log(`   记录失败 #${permError.id.slice(0, 8)}`);

console.log('\n📝 场景4: API限流');
const apiError = manager.recordFailure(
  'load_skill(\'external-skill\')',
  '429 Too Many Requests - rate limit exceeded'
);
console.log(`   记录失败 #${apiError.id.slice(0, 8)}`);

// 查看当前状态
console.log('\n📊 当前系统状态:');
const stats = manager.getStatistics();
console.log(`   总失败: ${stats.total_failures}`);
console.log(`   已解决: ${stats.resolved}`);
console.log(`   待处理: ${stats.pending}`);
console.log(`   解决率: ${stats.resolution_rate}`);

// 解决第一个编译错误
console.log('\n🔧 手动解决编译错误...');
manager.markResolved(buildError.id, '创建缺失的文件 missing-file.ts');

// 分析错误模式
console.log('\n🔍 分析错误模式...');
const recentFailures = manager.listFailures({ days: 1 });
const byType = {};
recentFailures.forEach(f => {
  byType[f.error_type] = (byType[f.error_type] || 0) + 1;
});

console.log('   错误类型分布:');
Object.entries(byType).forEach(([type, count]) => {
  console.log(`     ${type}: ${count}`);
});

// 为路径错误创建技能
console.log('\n📦 为路径穿越错误创建技能...');
const pathSkill = manager.createSkill(
  'path-security-handler',
  '处理路径穿越安全问题',
  ['path traversal', 'outside workspace', 'EACCES'],
  'path-error',
  '1. 验证路径在workspace范围内\n2. 使用相对路径而非绝对路径\n3. 对输入进行规范化处理'
);
console.log(`   已创建技能: ${pathSkill.name}`);

// 为权限错误创建技能
console.log('\n📦 为权限错误创建技能...');
const permSkill = manager.createSkill(
  'permission-handler',
  '处理权限相关问题',
  ['permission denied', 'EACCES', 'EPERM'],
  'permission-error',
  '1. 检查文件/目录权限\n2. 使用sudo或改变权限\n3. 考虑是否需要提升权限'
);
console.log(`   已创建技能: ${permSkill.name}`);

// 查看技能库
console.log('\n📚 技能库:');
manager.listSkills().forEach(skill => {
  console.log(`   - ${skill.name}: ${skill.description}`);
});

// 生成每日报告
console.log('\n📅 生成每日复盘报告...');
const report = manager.generateDailyReport();

console.log('\n' + '='.repeat(50));
console.log('✅ 演示完成!');
console.log('\n数据存储位置:');
console.log(`   ${manager.baseDir}`);
console.log('\n技能存储位置:');
console.log(`   ~/.feihong-code/skills/`);
