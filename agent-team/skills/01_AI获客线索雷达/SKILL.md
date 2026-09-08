---
name: 01_AI获客线索雷达
description: 全域线索发现、清洗与入库，构建线索池。属于L1层，优先级P0。触发场景：用户需要AI获客线索雷达、或涉及channels、keywords相关任务时调用。输出：total、leads、dedup_rule。
---

# 01_AI获客线索雷达（01）

全域线索发现、清洗与入库，构建线索池

- **所属层级**：L1（优先级 P0）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"channels": "["示例A","示例B"]"}'

# 方式二：标准输入
echo '{"channels": "["示例A","示例B"]"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"channels": "["示例A","示例B"]"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| channels | 线索渠道列表，如 ["评论区","小红书","公众号"] |
| keywords | 获客关键词 |

## 输出字段

- **total**：线索总数
- **leads**：线索列表
- **dedup_rule**：去重规则

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
