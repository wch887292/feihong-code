---
name: 15_公众号自动运营发布官
description: 公众号内容生成、排期与定时发布。属于L2层，优先级P1。触发场景：用户需要公众号自动运营发布官、或涉及topic、schedule相关任务时调用。输出：article。
---

# 15_公众号自动运营发布官（15）

公众号内容生成、排期与定时发布

- **所属层级**：L2（优先级 P1）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"topic": "示例输入"}'

# 方式二：标准输入
echo '{"topic": "示例输入"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"topic": "示例输入"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| topic | 选题 |
| schedule | 发布时间 |

## 输出字段

- **article**：文章与排期

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
