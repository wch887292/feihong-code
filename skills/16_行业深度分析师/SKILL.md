---
name: 16_行业深度分析师
description: 输出行业趋势与竞争格局分析。属于L4层，优先级P3。触发场景：用户需要行业深度分析师、或涉及industry、scope相关任务时调用。输出：report。
---

# 16_行业深度分析师（16）

输出行业趋势与竞争格局分析

- **所属层级**：L4（优先级 P3）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"industry": "示例输入"}'

# 方式二：标准输入
echo '{"industry": "示例输入"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"industry": "示例输入"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| industry | 行业 |
| scope | 范围 |

## 输出字段

- **report**：行业分析报告

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
