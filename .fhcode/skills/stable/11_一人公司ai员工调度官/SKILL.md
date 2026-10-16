---
name: 11_一人公司AI员工调度官
description: 编排、调度、监控全部 AI 员工，管理任务全生命周期。属于L5层，优先级基建。触发场景：用户需要一人公司AI员工调度官、或涉及tasks相关任务时调用。输出：schedule。
---

# 11_一人公司AI员工调度官（11）

编排、调度、监控全部 AI 员工，管理任务全生命周期

- **所属层级**：L5（优先级 基建）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"tasks": "["示例A","示例B"]"}'

# 方式二：标准输入
echo '{"tasks": "["示例A","示例B"]"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"tasks": "["示例A","示例B"]"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| tasks | 待编排任务列表 |

## 输出字段

- **schedule**：执行顺序与策略

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
