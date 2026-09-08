---
name: 10_GEO商机诊断官
description: 基于地理与经营数据诊断潜在商机。属于L4层，优先级P3。触发场景：用户需要GEO商机诊断官、或涉及region、business_type相关任务时调用。输出：diagnosis。
---

# 10_GEO商机诊断官（10）

基于地理与经营数据诊断潜在商机

- **所属层级**：L4（优先级 P3）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"region": "示例输入"}'

# 方式二：标准输入
echo '{"region": "示例输入"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"region": "示例输入"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| region | 目标区域 |
| business_type | 业态 |

## 输出字段

- **diagnosis**：商机诊断报告

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
