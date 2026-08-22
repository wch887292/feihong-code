#!/usr/bin/env node
/**
 * Quick Start Script for Self-Evolve
 * 快速开始脚本
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 飞虹 Code Self-Evolve 快速开始\n');

// 检查是否已安装
const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
const baseDir = path.join(homeDir, '.feihong-code', 'self-evolve');

if (fs.existsSync(baseDir)) {
  console.log('✅ Self-Evolve 系统已安装');
  console.log(`   目录: ${baseDir}\n`);
} else {
  console.log('📦 正在初始化 Self-Evolve 系统...');
  
  try {
    // 运行初始化
    const managerScript = path.join(__dirname, '..', 'src', 'self-evolve', 'manager.js');
    execSync(`node "${managerScript}" init`, { stdio: 'inherit' });
    console.log('✅ 系统初始化完成\n');
  } catch (error) {
    console.error('❌ 初始化失败:', error.message);
    process.exit(1);
  }
}

// 显示状态
console.log('📊 系统状态:');
try {
  const managerScript = path.join(__dirname, '..', 'src', 'self-evolve', 'manager.js');
  const output = execSync(`node "${managerScript}" status`, { encoding: 'utf8' });
  console.log(output);
} catch (error) {
  console.log('   (无法获取状态)\n');
}

// 演示如何使用
console.log('💡 常用命令:\n');
console.log('   fe status                    - 查看系统状态');
console.log('   fe failures list             - 列出失败记录');
console.log('   fe skills list               - 列出技能库');
console.log('   fe review --daily            - 每日复盘');
console.log('   fe analyze                   - 分析错误模式');
console.log('   fe create-skill <options>    - 创建新技能\n');

// 显示示例
console.log('📝 创建技能的示例:\n');
console.log('   # 创建处理编译错误的技能');
console.log('   fe create-skill \\');
console.log('     --name compile-error-handler \\');
console.log('     --description "处理TypeScript编译错误" \\');
console.log('     --pattern compile-error \\');
console.log('     --solution "检查导入路径、类型定义、依赖安装" \\');
console.log('     --triggers "error TS, syntax error, cannot find module"\n');

console.log('✅ 快速开始完成!');
console.log('   运行 "fe status" 查看更多详情\n');
