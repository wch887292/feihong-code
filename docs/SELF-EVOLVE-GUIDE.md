# 自我进化系统使用指南

> 版本: v0.5.1 | 最后更新: 2026-08-22

---

## 概述

自我进化（Self-Evolve）是 feihong-code 的核心能力之一，使系统能够从失败中学习、积累经验并持续优化。该系统包含三个主要组件：

1. **失败记录** - 自动捕获执行过程中的错误
2. **经验学习** - 分析历史失败，生成解决方案
3. **每日复盘** - 总结当日工作，优化策略

---

## 快速开始

### 启用自我进化

```bash
# CLI 模式
fhcode "你的任务" --self-evolve

# Web 控制台
# 在设置中启用 "Self-Evolve" 开关
```

### 查看进化状态

```bash
# 查看当前进化状态
fhcode evolve status

# 查看失败记录
fhcode evolve failures

# 查看学习经验
fhcode evolve lessons
```

---

## 核心功能

### 1. 失败记录机制

系统自动记录以下类型的失败：

| 错误类型 | 触发条件 | 记录内容 |
|----------|----------|----------|
| `MODEL_TIMEOUT` | 模型响应超时 | 超时时长、模型名称 |
| `AUTH_FAILURE` | API 认证失败 | 错误代码、提供商 |
| `RATE_LIMIT` | 请求频率限制 | 限制值、重置时间 |
| `EXECUTION_ERROR` | 工具执行失败 | 工具名、错误信息 |
| `PERMISSION_DENIED` | 权限不足 | 操作类型、所需权限 |

**存储位置**: `~/.fhcode/evolve/failures.jsonl`

### 2. 经验学习引擎

系统会分析失败记录，生成可复用的解决方案：

```typescript
// 经验数据结构
interface LearnedLesson {
  errorType: string;           // 错误类型
  pattern: string;             // 问题模式
  solution: string;            // 解决方案
  confidence: number;          // 置信度 (0-1)
  usageCount: number;          // 应用次数
  createdAt: Date;             // 创建时间
}
```

**查看学习经验**:
```bash
fhcode evolve lessons --recent  # 查看最近学习的经验
fhcode evolve lessons --type MODEL_TIMEOUT  # 按类型筛选
```

### 3. 每日复盘报告

系统每天自动生成复盘报告：

```bash
# 手动生成复盘报告
fhcode evolve report --date 2026-08-22

# 查看今日报告
fhcode evolve report --today
```

**报告内容**:
- 今日失败统计
- 已应用的解决方案
- 未解决的问题
- 优化建议

---

## 配置选项

### 基本配置

编辑 `~/.fhcode/config.json`:

```json
{
  "selfEvolve": {
    "enabled": true,
    "maxFailuresToRemember": 100,
    "lessonConfidenceThreshold": 0.7,
    "dailyReportEnabled": true,
    "autoApplyLessons": true
  }
}
```

### 配置参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `true` | 是否启用自我进化 |
| `maxFailuresToRemember` | `100` | 最大保留失败记录数 |
| `lessonConfidenceThreshold` | `0.7` | 经验应用的最低置信度 |
| `dailyReportEnabled` | `true` | 是否生成每日报告 |
| `autoApplyLessons` | `true` | 是否自动应用学习到的经验 |

---

## 高级用法

### 强制重新学习

```bash
# 清除所有学习经验，重新开始
fhcode evolve reset --lessons

# 仅清除失败记录
fhcode evolve reset --failures

# 完全重置（谨慎使用）
fhcode evolve reset --all
```

### 导出学习数据

```bash
# 导出失败记录
fhcode evolve export --type failures --format json

# 导出学习经验
fhcode evolve export --type lessons --format json

# 导出复盘报告
fhcode evolve export --type report --format markdown
```

### 导入外部经验

```bash
# 从 JSON 文件导入经验
fhcode evolve import --file lessons.json

# 从 GitHub Gist 导入
fhcode evolve import --url https://gist.github.com/...
```

---

## 与企业安全集成

自我进化系统完全兼容企业安全策略：

- **审计链**: 所有失败记录和解决方案变更都会记录到审计日志
- **权限控制**: 可通过 RBAC 控制谁可以查看/修改学习经验
- **数据隔离**: 多租户场景下，各租户的学习经验相互隔离

### 安全配置示例

```json
{
  "selfEvolve": {
    "enabled": true,
    "auditEnabled": true,
    "dataIsolation": "tenant",
    "maxRetentionDays": 90
  }
}
```

---

## 故障排查

### 常见问题

**Q: 自我进化没有正常工作？**

检查项:
1. 确认 `selfEvolve.enabled` 为 `true`
2. 检查 `~/.fhcode/evolve/` 目录权限
3. 查看日志: `cat ~/.fhcode/logs/evolve.log`

**Q: 学习经验没有生效？**

检查项:
1. 确认 `autoApplyLessons` 为 `true`
2. 检查经验的 `confidence` 是否达到阈值
3. 查看应用日志: `fhcode evolve lessons --verbose`

**Q: 每日报告没有生成？**

检查项:
1. 确认 `dailyReportEnabled` 为 `true`
2. 报告在每天 23:59 自动生成，检查当时系统是否运行
3. 手动生成测试: `fhcode evolve report --today`

### 日志位置

| 日志类型 | 路径 |
|----------|------|
| 主日志 | `~/.fhcode/logs/main.log` |
| 进化日志 | `~/.fhcode/logs/evolve.log` |
| 审计日志 | `~/.fhcode/audit/audit.jsonl` |

---

## 最佳实践

### 1. 定期审查学习经验

```bash
# 每周审查一次
fhcode evolve lessons --review

# 清理低置信度经验
fhcode evolve clean --confidence < 0.5
```

### 2. 分享成功经验

将学习到的经验分享给团队：

```bash
# 导出团队可用的经验
fhcode evolve export --scope team --format json
```

### 3. 监控进化指标

关注以下指标评估自我进化效果：

- **失败率下降趋势**: 同类错误重复发生次数应逐渐减少
- **经验应用成功率**: 自动应用的解决方案成功率应 > 80%
- **问题解决时长**: 从首次失败到解决方案生成的时间

---

## 技术架构

### 数据流

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  任务执行    │ ──→ │  失败捕获    │ ──→ │  经验学习    │
└─────────────┘     └─────────────┘     └─────────────┘
                                       ┌─────────────┐
                                       │  每日复盘    │
                                       └─────────────┘
                                             │
                                             ↓
                                       ┌─────────────┐
                                       │  策略优化    │
                                       └─────────────┘
```

### 核心类

```typescript
// 自我进化管理器
class SelfEvolveManager {
  init(): void;
  recordFailure(errorType: string, error: any, attemptedSolutions?: string[]): void;
  searchSolution(errorType: string, errorMessage: string): Lesson[];
  generateDailyReport(): Report;
}

// 经验数据模型
interface LearnedLesson {
  id: string;
  errorType: string;
  pattern: string;
  solution: string;
  confidence: number;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 相关链接

- [错误码参考](./error-codes.md)
- [企业部署指南](../DEPLOYMENT-GUIDE.md)
- [自我进化实现细节](./self-evolve-implementation.md)

---

*本系统由飞扬企源研发中心 (FyqyRDC) 开发*
