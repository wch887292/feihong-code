#!/usr/bin/env node
/**
 * Self-Evolve Manager - 自我迭代升级管理器
 * 负责记录失败、创建技能、定期复盘
 */

const fs = require('fs');
const path = require('path');

// 注意：不再 require('uuid')——该依赖从未安装且 uuidv4 从未被使用，
// 本项目自带 generateId()（下方 RFC-4122 v4 实现），移除后 CLI 不再崩溃。

// 实现简单的 UUID v4
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
    // 双系统收敛：失败/技能/解决 统一回流到共享经验库（experiences.jsonl），
    // 与新一代 self-improve（src/agent/experience.ts）共用同一存储，供 orchestrator 检索注入。
    this.experiencesDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.feihong-code', 'experiences');
    this.experiencesFile = path.join(this.experiencesDir, 'experiences.jsonl');

    this.ensureDirs();
    this.loadData();
  }

  /** 稳定短哈希（与 src/agent/experience.ts shortHash 语义一致，保证跨系统 id 可对齐） */
  static shortHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /** 生成与 experience.ts 一致的稳定经验 id */
  static experienceId(type, key) {
    return `exp-${SelfEvolveManager.shortHash(`${type}:${key}`)}`;
  }

  /** 读取共享经验库全部记录 */
  loadExperiences() {
    if (!fs.existsSync(this.experiencesFile)) return [];
    try {
      return fs
        .readFileSync(this.experiencesFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * 追加/合并一条经验到共享经验库（upsert 语义，与 experience.ts 一致）：
   * 同 id 已存在 → sessionCount+1、成功率按次数加权平均、标签合并、刷新 lastUsedAt；
   * 否则新增。失败学习因此回流到 orchestrator 的检索闭环。
   */
  upsertExperience(type, key, title, content, tags, successRate) {
    const id = SelfEvolveManager.experienceId(type, key);
    const now = new Date().toISOString();
    const entry = {
      id,
      type,
      title,
      content,
      metadata: {
        sessionCount: 1,
        successRate: typeof successRate === 'number' ? successRate : 0,
        tags,
        createdAt: now,
        lastUsedAt: now,
      },
    };
    try {
      if (!fs.existsSync(this.experiencesDir)) fs.mkdirSync(this.experiencesDir, { recursive: true });
      const existing = this.loadExperiences();
      const idx = existing.findIndex((e) => e && e.id === id);
      if (idx >= 0) {
        const prev = existing[idx];
        const prevCount = prev.metadata && prev.metadata.sessionCount ? prev.metadata.sessionCount : 0;
        entry.metadata = {
          sessionCount: prevCount + 1,
          successRate: (prev.metadata.successRate * prevCount + entry.metadata.successRate) / (prevCount + 1),
          tags: [...new Set([...(prev.metadata.tags || []), ...tags])],
          createdAt: prev.metadata.createdAt || now,
          lastUsedAt: now,
        };
        existing[idx] = entry;
      } else {
        existing.push(entry);
      }
      fs.writeFileSync(this.experiencesFile, existing.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    } catch (e) {
      console.error(`[自我迭代] 写入共享经验库失败: ${e.message}`);
    }
    return entry;
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
    // 双系统收敛：共享经验库目录
    if (!fs.existsSync(this.experiencesDir)) {
      fs.mkdirSync(this.experiencesDir, { recursive: true });
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
        // 去除 BOM（EF BB BF），兼容 PowerShell Set-Content -Encoding UTF8 等写入的带 BOM JSON
        const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
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
    // 双系统收敛：失败 → error-pattern 经验回流共享库
    this.upsertExperience(
      'error-pattern',
      failure.error_type,
      `常见错误模式: ${failure.error_type}`,
      `任务「${String(failure.task).slice(0, 120)}」遇到 ${failure.error_type} 类错误：${String(failure.error_message).slice(0, 200)}。规避建议：提前校验前置条件（路径/权限/依赖），增加超时重试与最小改动原则。`,
      [failure.error_type, 'failure'],
      0
    );
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
    // 双系统收敛：解决 → success-pattern 经验回流共享库（含可复用方案）
    if (solution) {
      this.upsertExperience(
        'success-pattern',
        `fix:${failure.error_type}`,
        `自愈修复经验: ${failure.error_type}`,
        `问题「${String(failure.task).slice(0, 120)}」的 ${failure.error_type} 类错误已解决${skillName ? `（应用技能 ${skillName}）` : ''}，可用方案：${String(solution).slice(0, 300)}`,
        [failure.error_type, 'self-heal', 'fix', 'success'],
        1.0
      );
    }
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
    // 双系统收敛：新技能 → success-pattern 经验回流共享库（未来任务可检索到该技能）
    this.upsertExperience(
      'success-pattern',
      `skill:${name}`,
      `技能沉淀: ${name}`,
      `已沉淀可复用技能「${name}」（触发词：${triggers.join(', ')}；错误模式：${errorPattern}），处理方案：${String(solution).slice(0, 300)}。未来遇到同类问题直接应用该技能。`,
      [name, errorPattern, 'skill', 'success'],
      1.0
    );
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
      history_entries: this.history.length,
      total_experiences: this.loadExperiences().length
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
