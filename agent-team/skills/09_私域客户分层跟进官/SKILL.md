---
name: 09_私域客户分层跟进官
description: 私域客户分层、差异化跟进与维护。属于L3层，优先级P0。触发场景：用户需要私域客户分层跟进官、或涉及customers相关任务时调用。输出：tiers、follow_up_plan。
---

# 09_私域客户分层跟进官（09）

私域客户分层、差异化跟进与维护

- **所属层级**：L3（优先级 P0）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"customers": "[{"customer_id":"C1","company_name":"客户A","contact_name":"李总"}]"}'

# 方式二：标准输入
echo '{"customers": "[{"customer_id":"C1","company_name":"客户A","contact_name":"李总"}]"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"customers": "[{"customer_id":"C1","company_name":"客户A","contact_name":"李总"}]"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| customers | 客户列表 |

## 输出字段

- **tiers**：分层标签
- **follow_up_plan**：跟进计划

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
