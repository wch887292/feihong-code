---
name: 05_同行爆款雷达
description: 监控同行爆款内容，提炼可复制模式。属于L2层，优先级P2。触发场景：用户需要同行爆款雷达、或涉及competitor_accounts相关任务时调用。输出：hot_contents、patterns。
---

# 05_同行爆款雷达（05）

监控同行爆款内容，提炼可复制模式

- **所属层级**：L2（优先级 P2）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"competitor_accounts": "["示例A","示例B"]"}'

# 方式二：标准输入
echo '{"competitor_accounts": "["示例A","示例B"]"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"competitor_accounts": "["示例A","示例B"]"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| competitor_accounts | 同行账号列表 |

## 输出字段

- **hot_contents**：爆款列表
- **patterns**：可复用模式

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
