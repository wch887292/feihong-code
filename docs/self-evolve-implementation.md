# Self-Evolve 实现指南

## 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Self-Evolve Manager                      │
├─────────────────────────────────────────────────────────────┤
│  • failures.json  - 失败记录存储                              │
│  • skills-index.json - 技能索引                               │
│  • history.json   - 操作历史                                 │
│  • config.json    - 配置参数                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       Hook System                            │
├─────────────────────────────────────────────────────────────┤
│  • onToolFailure() - 工具调用失败时触发                        │
│  • onTaskComplete() - 任务完成时触发                          │
│  • dailyReview()   - 每日自动复盘                            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    CLI Interface                             │
├─────────────────────────────────────────────────────────────┤
│  • self-evolve init          - 初始化系统                     │
│  • self-evolve status        - 查看状态                       │
│  • self-evolve failures      - 管理失败记录                   │
│  • self-evolve skills        - 管理技能库                     │
│  • self-evolve review        - 定期复盘                       │
│  • self-evolve analyze       - 分析错误模式                   │
│  • self-evolve create-skill  - 创建新技能                     │
└─────────────────────────────────────────────────────────────┘
```

## 数据模型

### 失败记录 (failure.json)
```json
{
  "id": "uuid",
  "timestamp": "ISO时间",
  "task": "任务描述",
  "error_type": "错误类型",
  "error_message": "错误信息",
  "attempted_solutions": [],
  "root_cause": "根本原因",
  "solution": "解决方案",
  "created_skill": false,
  "skill_name": null,
  "status": "pending|resolved|manual"
}
```

### 技能索引 (skills-index.json)
```json
{
  "name": "技能名称",
  "description": "技能描述",
  "triggers": ["触发词"],
  "error_pattern": "错误模式",
  "solution": "解决方案",
  "created_at": "创建时间",
  "usage_count": 0,
  "version": "1.0.0"
}
```

## 集成到主流程

### 1. 在工具调用链中添加 Hook

在 `src/tools/` 下的工具调用失败时：

```typescript
// 示例：在 shell 工具中
try {
  const result = await executeCommand(command);
  // 成功处理
} catch (error) {
  // 记录失败
  selfEvolveHook.onToolFailure({
    tool: 'shell',
    input: { command },
    error: error.message,
    attemptedSolutions: []
  });
  throw error;
}
```

### 2. 在任务完成时检查

```typescript
// 在任务完成后
selfEvolveHook.onTaskComplete({
  success: isSuccess,
  task: taskDescription,
  error: error?.message
});
```

### 3. 定期复盘

可以设置 cron job 或定时任务：

```bash
# 每天凌晨2点复盘
0 2 * * * fhcode self-evolve review --daily
```

## 扩展开发

### 添加新的错误类型

在 `manager.js` 的 `categorizeError` 方法中添加：

```javascript
if (msg.includes('新的错误关键词')) {
  return 'new-error-type';
}
```

### 创建自定义 Hook

```typescript
class CustomHook {
  onToolFailure(context) {
    // 自定义逻辑
    this.manager.recordFailure(...);
  }
}
```

## 最佳实践

1. **及时记录**：失败后立即记录，不要延迟
2. **详细上下文**：记录完整的错误信息和复现步骤
3. **尝试多种方案**：记录所有尝试过的解决方案
4. **定期复盘**：每天至少一次复盘分析
5. **渐进改进**：每次只优化一个方面

## 故障排除

### 数据丢失
- 检查 `~/.feihong-code/self-evolve/` 目录权限
- 确保有写入权限

### 技能未生效
- 检查技能索引是否正确更新
- 确认 SKILL.md 文件格式正确
- 重启系统重新加载技能

### 复盘失败
- 检查配置文件是否存在
- 确认磁盘空间充足
- 查看日志文件获取详细错误

## 版本兼容性

- Node.js >= 18.0.0
- TypeScript >= 5.0
- 飞虹 Code >= 0.5.0
