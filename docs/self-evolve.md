# Self-Evolve 自我迭代系统

## 概述

Self-Evolve 是飞虹 Code 的自我学习与迭代升级系统，能够：
- 自动记录任务执行中的失败
- 分析错误模式并提取经验教训
- 当遇到无法解决的问题时，自动生成新技能
- 定期复盘优化系统行为

## 快速开始

### 1. 初始化系统

```bash
# 运行初始化脚本
bash scripts/self-evolve-setup.sh

# 或使用 CLI
fhcode self-evolve init
```

### 2. 查看状态

```bash
fhcode self-evolve status
```

输出示例：
```
📊 自我迭代系统状态
========================================
总失败记录: 15
已解决:     12
待处理:     3
解决率:     80.0%
技能库:     5 个技能
```

### 3. 列出失败记录

```bash
# 列出所有失败
fhcode self-evolve failures list

# 按类型过滤
fhcode self-evolve failures list --type compile-error

# 最近7天
fhcode self-evolve failures list --days 7
```

### 4. 查看技能库

```bash
fhcode self-evolve skills list
```

### 5. 每日复盘

```bash
fhcode self-evolve review --daily
```

### 6. 分析错误模式

```bash
# 分析最近7天
fhcode self-evolve analyze

# 分析最近30天
fhcode self-evolve analyze --days 30
```

### 7. 创建新技能

当遇到新的错误模式时：

```bash
fhcode self-evolve create-skill \
  --name path-traversal-handler \
  --description "处理路径穿越错误" \
  --pattern path-error \
  --solution "检查路径安全性，确保在workspace范围内" \
  --triggers "path traversal, outside workspace, EACCES"
```

## 数据存储

所有数据存储在 `~/.feihong-code/self-evolve/` 目录：

```
~/.feihong-code/self-evolve/
├── config.json          # 配置文件
├── failures.json        # 失败记录
├── skills-index.json    # 技能索引
├── history.json         # 操作历史
├── version.txt          # 版本信息
└── report-YYYY-MM-DD.json  # 每日报告
```

技能文件存储在 `~/.feihong-code/skills/<skill-name>/SKILL.md`

## 工作原理

### 失败记录流程

1. 任务执行失败 → 自动记录到 failures.json
2. 搜索已知解决方案 → 找到则应用
3. 未找到 → 标记为待处理
4. 用户手动解决或系统自动创建技能
5. 定期复盘优化

### 技能创建流程

1. 检测新的错误模式
2. 分析根因
3. 生成解决方案
4. 创建 SKILL.md 文件
5. 更新技能索引
6. 验证效果

## 扩展开发

### 添加自定义 Hook

在 `src/self-evolve/hook.ts` 中扩展：

```typescript
export class SelfEvolveHook {
  onToolFailure(context) { /* 自定义逻辑 */ }
  onTaskComplete(context) { /* 自定义逻辑 */ }
}
```

### 集成到主流程

在工具调用链中添加钩子：

```typescript
// 在工具调用失败时
selfEvolveHook.onToolFailure({
  tool: 'shell',
  input: { command: 'npm test' },
  error: new Error('test failed')
});
```

## 纪律

- 诚实记录失败，不伪造成功
- 每日至少一次复盘
- 新技能必须经过验证
- 所有变更可追溯

## 与现有系统集成

Self-Evolve 可以与以下技能配合：

- `/self-heal`：自动创建修复技能
- `/plan`：计划时参考历史失败
- `/goal`：目标设定参考迭代进度

## 版本历史

- v1.0.0 (2026-08-16): 初始版本，基础功能完成
