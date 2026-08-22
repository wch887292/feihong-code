---
name: self-evolve
description: 自我学习与迭代升级系统：自动记录失败任务、提取错误模式、创建解决技能、定期复盘优化。当遇到无解决方案问题时，自动生成新技能。
---

# /self-evolve 技能：自我学习与迭代升级

**元技能**：这是一个让飞虹 Code 能够自我进化、持续改进的智能系统。

## 核心能力

### 1. 失败任务追踪
- 每日自动扫描执行历史，识别失败的操作
- 记录：触发上下文、错误类型、错误信息、尝试方案、最终结果
- 存储到 `~/.feihong-code/self-evolve/failures.json`

### 2. 错误模式识别
- 分析历史失败，识别重复出现的错误模式
- 分类存储：编译错误、运行时错误、路径问题、权限问题、API限制等
- 建立错误→解决方案的映射关系

### 3. 技能自动生成
- 当遇到无法解决的新问题时，自动创建针对性技能
- 技能格式遵循 SKILL.md 标准
- 保存到 `~/.feihong-code/skills/` 目录

### 4. 定期迭代升级
- 每日复盘：分析当日失败，提取经验教训
- 每周评估：统计成功率趋势，优化技能库
- 版本更新：当发现系统性改进机会时，建议功能升级

## 工作流程

### 日常维护流程
```
1. 任务执行完成后 → 检查是否成功
2. 如果失败 → 记录到失败库
3. 检查错误是否已知 → 是则应用已有方案
4. 如果是新问题 → 分析根因，创建解决方案技能
5. 定期复盘 → 优化系统行为
```

### 新问题解决流程
```
遇到问题 → 搜索错误库 → 找到方案则应用
                ↓ 未找到
           深度分析 → 提取错误模式
                ↓
           创建技能 → 保存到新技能库
                ↓
           验证效果 → 记录成功修复
                ↓
           更新文档 → 标注解决方案
```

## 数据存储

### 失败记录格式
```json
{
  "id": "uuid",
  "timestamp": "ISO时间",
  "task": "任务描述",
  "error_type": "错误类型",
  "error_message": "错误信息",
  "attempted_solutions": ["方案1", "方案2"],
  "root_cause": "根本原因",
  "solution": "解决方案",
  "created_skill": "是否创建新技能",
  "skill_name": "新技能名称（如有）",
  "status": "resolved|pending|manual"
}
```

### 技能索引格式
```json
{
  "name": "技能名称",
  "description": "技能描述",
  "triggers": ["触发关键词"],
  "error_pattern": "匹配的错误模式",
  "solution": "解决方案",
  "created_at": "创建时间",
  "usage_count": 使用次数
}
```

## 使用方法

### 启动自我学习模式
```bash
fhcode self-evolve --init
```

### 查看失败记录
```bash
fhcode self-evolve --status
fhcode self-evolve --failures [--type <类型>]
```

### 手动触发复盘
```bash
fhcode self-evolve --review --daily
fhcode self-evolve --review --weekly
```

### 创建新技能
```bash
fhcode self-evolve --create-skill --name <技能名> --problem <问题描述>
```

## 纪律

- **诚实记录**：失败就是失败，不伪造成功
- **及时复盘**：每日至少一次复盘分析
- **渐进改进**：每次迭代只优化一个方面
- **验证优先**：新技能必须经过测试验证
- **可追溯**：所有变更记录保存历史版本

## 扩展能力

此技能可与其他技能配合：
- `/self-heal`：配合自愈，自动创建修复技能
- `/plan`：计划时考虑历史失败
- `/goal`：目标设定参考迭代进度
