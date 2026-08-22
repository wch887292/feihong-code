#!/usr/bin/env node
/**
 * Self-Evolve Manager - 自我迭代升级管理器
 * 负责记录失败、创建技能、定期复盘
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// 确保uuid已安装或实现简单的UUID
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

class SelfEvolveManager {
  constructor() {
    this.baseDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.feihong-code', 'self-evolve');
    this.failuresFile = path.join(this.baseDir, 'failures.json');
    this.skillsIndexFile = path.join(this.baseDir, 'skills-index.json');
    this.historyFile = path.join(this.baseDir, 'history.json');
    
    this.ensureDirs();
    this.loadData();
  }

  ensureDirs() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    // 确保用户技能目录也存在
    const userSkillsDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.feihong-code', 'skills');
    if (!fs.existsSync(userSkillsDir)) {
      fs.mkdirSync(userSkillsDir, { recursive: true });
    }
  }

  loadData() {
    this.failures = this.loadJSON(this.failuresFile, []);
    this.skillsIndex = this.loadJSON(this.skillsIndexFile, []);
    this.history = this.loadJSON(this.historyFile, []);
  }

  loadJSON(file, defaultValue) {
    try {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        return JSON.parse(content);
      }
    } catch (e) {
      console.error(`加载 ${file} 失败:`, e.message);
    }
    return defaultValue;
  }

  saveData() {
    this.saveJSON(this.failuresFile, this.failures);
    this.saveJSON(this.skillsIndexFile, this.skillsIndex);
    this.saveJSON(this.historyFile, this.history);
  }

  saveJSON(file, data) {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error(`保存 ${file} 失败:`, e.message);
    }
  }

  /**
   * 记录任务失败
   */
  recordFailure(task, error, attemptedSolutions = [], rootCause = null) {
    const failure = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      task: task,
      error_type: this.categorizeError(error),
      error_message: typeof error === 'string' ? error : (error?.message || String(error)),
      attempted_solutions: attemptedSolutions,
      root_cause: rootCause || '待分析',
      solution: null,
      created_skill: false,
      skill_name: null,
      status: 'pending'
    };

    this.failures.push(failure);
    this.history.push({
      type: 'failure',
      timestamp: failure.timestamp,
      failure_id: failure.id
    });
    
    this.saveData();
    console.log(`[自我迭代] 记录失败任务 #${failure.id.slice(0, 8)}`);
    return failure;
  }

  /**
   * 错误分类
   */
  categorizeError(error) {
    const msg = typeof error === 'string' ? error.toLowerCase() : '';
    
    if (msg.includes('error ts') || msg.includes('syntax error') || msg.includes('编译')) {
      return 'compile-error';
    }
    if (msg.includes('typeerror') || msg.includes('referenceerror')) {
      return 'runtime-error';
    }
    if (msg.includes('path traversal') || msg.includes('outside workspace')) {
      return 'path-error';
    }
    if (msg.includes('timeout') || msg.includes('etimedout')) {
      return 'timeout';
    }
    if (msg.includes('permission denied') || msg.includes('eacces')) {
      return 'permission-error';
    }
    if (msg.includes('rate limit') || msg.includes('429') || msg.includes('5xx')) {
      return 'api-error';
    }
    return 'unknown';
  }

  /**
   * 搜索已知解决方案
   */
  searchSolution(errorType, errorMessage) {
    // 先按类型精确匹配
    let matches = this.skillsIndex.filter(s => s.error_pattern === errorType);
    
    // 再按关键词模糊匹配
    if (matches.length === 0) {
      const keywords = errorMessage.toLowerCase().split(/\s+/).filter(k => k.length > 3);
      for (const keyword of keywords) {
        matches = this.skillsIndex.filter(s => 
          s.triggers && s.triggers.some(t => t.includes(keyword))
        );
        if (matches.length > 0) break;
      }
    }

    return matches;
  }

  /**
   * 标记问题已解决
   */
  markResolved(failureId, solution, skillName = null) {
    const failure = this.failures.find(f => f.id === failureId);
    if (!failure) return null;

    failure.solution = solution;
    failure.status = 'resolved';
    if (skillName) {
      failure.created_skill = true;
      failure.skill_name = skillName;
    }

    this.history.push({
      type: 'resolved',
      timestamp: new Date().toISOString(),
      failure_id: failureId,
      solution: solution
    });

    this.saveData();
    console.log(`[自我迭代] 问题 #${failureId.slice(0, 8)} 已解决`);
    return failure;
  }

  /**
   * 创建新技能
   */
  createSkill(name, description, triggers, errorPattern, solution) {
    const skill = {
      name,
      description,
      triggers: triggers || [name],
      error_pattern: errorPattern,
      solution,
      created_at: new Date().toISOString(),
      usage_count: 0,
      version: '1.0.0'
    };

    // 添加到索引
    this.skillsIndex.push(skill);

    // 创建SKILL.md文件
    this.saveSkillToFile(skill);

    // 更新相关失败记录
    this.failures.forEach(f => {
      if (f.error_type === errorPattern || 
          (f.error_message && f.error_message.toLowerCase().includes(name.toLowerCase()))) {
        f.solution = `应用技能: ${name}`;
        f.status = 'resolved';
        f.created_skill = true;
        f.skill_name = name;
      }
    });

    this.history.push({
      type: 'skill_created',
      timestamp: new Date().toISOString(),
      skill_name: name
    });

    this.saveData();
    console.log(`[自我迭代] 新技能已创建: ${name}`);
    return skill;
  }

  /**
   * 保存技能到文件
   */
  saveSkillToFile(skill) {
    const skillDir = path.join(
      process.env.HOME || process.env.USERPROFILE || '.',
      '.feihong-code',
      'skills',
      skill.name
    );
    
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }

    const triggersText = skill.triggers ? skill.triggers.join(', ') : skill.name;
    const content = `---
name: ${skill.name}
description: ${skill.description}
triggers: [${triggersText}]
---

# ${skill.name} 技能

**自动创建的解决技能**

## 触发条件
${skill.triggers ? skill.triggers.join('\n- ') : skill.name}

## 错误模式
${skill.error_pattern}

## 解决方案
${skill.solution}

## 创建时间
${skill.created_at}
`;

    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf8');
  }

  /**
   * 生成每日复盘报告
   */
  generateDailyReport() {
    const today = new Date().toISOString().split('T')[0];
    const todayFailures = this.failures.filter(f => f.timestamp.startsWith(today));
    const todayResolutions = this.history.filter(h => 
      h.timestamp.startsWith(today) && h.type === 'resolved'
    );

    const report = {
      date: today,
      total_failures: todayFailures.length,
      resolved: todayResolutions.length,
      pending: todayFailures.filter(f => f.status !== 'resolved').length,
      new_skills: this.history.filter(h => 
        h.timestamp.startsWith(today) && h.type === 'skill_created'
      ).length,
      failures: todayFailures.map(f => ({
        id: f.id.slice(0, 8),
        type: f.error_type,
        message: f.error_message.slice(0, 100),
        status: f.status
      }))
    };

    // 保存报告
    const reportFile = path.join(this.baseDir, `report-${today}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

    console.log(`[自我迭代] 每日报告已生成: ${today}`);
    console.log(`  - 失败任务: ${report.total_failures}`);
    console.log(`  - 已解决: ${report.resolved}`);
    console.log(`  - 待处理: ${report.pending}`);
    console.log(`  - 新技能: ${report.new_skills}`);

    return report;
  }

  /**
   * 统计分析
   */
  getStatistics() {
    const totalFailures = this.failures.length;
    const resolved = this.failures.filter(f => f.status === 'resolved').length;
    const byType = {};
    
    this.failures.forEach(f => {
      byType[f.error_type] = (byType[f.error_type] || 0) + 1;
    });

    return {
      total_failures: totalFailures,
      resolved: resolved,
      pending: totalFailures - resolved,
      resolution_rate: totalFailures > 0 ? ((resolved / totalFailures) * 100).toFixed(1) + '%' : '0%',
      by_type: byType,
      total_skills: this.skillsIndex.length,
      history_entries: this.history.length
    };
  }

  /**
   * 列出所有失败记录
   */
  listFailures(filters = {}) {
    let result = this.failures;
    
    if (filters.type) {
      result = result.filter(f => f.error_type === filters.type);
    }
    if (filters.status) {
      result = result.filter(f => f.status === filters.status);
    }
    if (filters.days) {
      const cutoff = new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000);
      result = result.filter(f => new Date(f.timestamp) >= cutoff);
    }

    return result;
  }

  /**
   * 列出所有技能
   */
  listSkills() {
    return this.skillsIndex;
  }

  /**
   * 初始化系统
   */
  init() {
    this.ensureDirs();
    this.loadData();
    
    // 创建初始数据文件（如果不存在）
    if (!fs.existsSync(this.failuresFile)) {
      this.saveData();
    }

    console.log('[自我迭代] 系统已初始化');
    console.log(`  - 基础目录: ${this.baseDir}`);
    console.log(`  - 失败记录: ${this.failures.length} 条`);
    console.log(`  - 技能库: ${this.skillsIndex.length} 个`);
    console.log(`  - 历史记录: ${this.history.length} 条`);
  }
}

module.exports = { SelfEvolveManager };

// CLI 入口
if (require.main === module) {
  const manager = new SelfEvolveManager();
  const args = process.argv.slice(2);
  
  if (args[0] === 'init') {
    manager.init();
  } else if (args[0] === 'status') {
    console.log(JSON.stringify(manager.getStatistics(), null, 2));
  } else if (args[0] === 'failures' && args[1] === 'list') {
    const filters = {};
    if (args[2] === '--type' && args[3]) filters.type = args[3];
    if (args[2] === '--days' && args[3]) filters.days = parseInt(args[3]);
    console.log(JSON.stringify(manager.listFailures(filters), null, 2));
  } else if (args[0] === 'skills' && args[1] === 'list') {
    console.log(JSON.stringify(manager.listSkills(), null, 2));
  } else if (args[0] === 'review' && args[1] === '--daily') {
    manager.generateDailyReport();
  } else {
    console.log('自我迭代管理系统');
    console.log('用法:');
    console.log('  self-evolve init              - 初始化系统');
    console.log('  self-evolve status            - 查看统计');
    console.log('  self-evolve failures list     - 列出失败');
    console.log('  self-evolve skills list       - 列出技能');
    console.log('  self-evolve review --daily    - 每日复盘');
  }
}
