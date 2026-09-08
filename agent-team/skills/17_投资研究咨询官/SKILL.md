---
name: 17_投资研究咨询官
description: 项目 / 投资研究与尽调辅助。属于L4层，优先级P3。触发场景：用户需要投资研究咨询官、或涉及company、materials相关任务时调用。输出：report。
---

# 17_投资研究咨询官（17）

项目 / 投资研究与尽调辅助

- **所属层级**：L4（优先级 P3）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"company": "示例输入"}'

# 方式二：标准输入
echo '{"company": "示例输入"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"company": "示例输入"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| company | 项目/公司 |
| materials | 材料摘要 |

## 输出字段

- **report**：投研报告

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
