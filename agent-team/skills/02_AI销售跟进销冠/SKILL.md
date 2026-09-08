---
name: 02_AI销售跟进销冠
description: 按话术自动跟进、多轮触达客户（对外动作需人工确认）。属于L3层，优先级P0。触发场景：用户需要AI销售跟进销冠、或涉及customer、strategy相关任务时调用。输出：follow_up。
---

# 02_AI销售跟进销冠（02）

按话术自动跟进、多轮触达客户（对外动作需人工确认）

- **所属层级**：L3（优先级 P0）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"customer": "示例输入"}'

# 方式二：标准输入
echo '{"customer": "示例输入"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"customer": "示例输入"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| customer | 客户对象（company_name/contact_name） |
| strategy | 跟进策略 |

## 输出字段

- **follow_up**：跟进消息与下一步

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
