---
name: 13_博主账号深度拆解官
description: 拆解对标账号的定位、选题、结构与转化路径。属于L2层，优先级P2。触发场景：用户需要博主账号深度拆解官、或涉及account相关任务时调用。输出：report。
---

# 13_博主账号深度拆解官（13）

拆解对标账号的定位、选题、结构与转化路径

- **所属层级**：L2（优先级 P2）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"account": "示例输入"}'

# 方式二：标准输入
echo '{"account": "示例输入"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"account": "示例输入"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| account | 对标账号 |

## 输出字段

- **report**：拆解报告

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
