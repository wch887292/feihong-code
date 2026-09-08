---
name: 06_每日精准获客选题官
description: 按目标客户画像与行业热点生成每日获客选题。属于L1层，优先级P1。触发场景：用户需要每日精准获客选题官、或涉及persona、hot_topics相关任务时调用。输出：date、topics。
---

# 06_每日精准获客选题官（06）

按目标客户画像与行业热点生成每日获客选题

- **所属层级**：L1（优先级 P1）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"persona": "示例输入"}'

# 方式二：标准输入
echo '{"persona": "示例输入"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"persona": "示例输入"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| persona | 目标客户画像 |
| hot_topics | 行业热点列表 |

## 输出字段

- **date**：选题日期
- **topics**：选题清单

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
