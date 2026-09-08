---
name: 03_评论区商机识别官
description: 监控目标账号与话题评论区，识别需求与意向，提取商机。属于L1层，优先级P1。触发场景：用户需要评论区商机识别官、或涉及target_accounts相关任务时调用。输出：opportunities、source_evidence。
---

# 03_评论区商机识别官（03）

监控目标账号与话题评论区，识别需求与意向，提取商机

- **所属层级**：L1（优先级 P1）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"target_accounts": "["示例A","示例B"]"}'

# 方式二：标准输入
echo '{"target_accounts": "["示例A","示例B"]"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"target_accounts": "["示例A","示例B"]"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| target_accounts | 目标账号/话题列表 |

## 输出字段

- **opportunities**：商机列表
- **source_evidence**：原文证据

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
