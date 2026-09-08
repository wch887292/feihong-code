---
name: 04_客户聊天成交分析官
description: 分析聊天记录，诊断成交卡点，输出建议话术。属于L3层，优先级P0。触发场景：用户需要客户聊天成交分析官、或涉及transcript相关任务时调用。输出：diagnosis。
---

# 04_客户聊天成交分析官（04）

分析聊天记录，诊断成交卡点，输出建议话术

- **所属层级**：L3（优先级 P0）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"transcript": "客户：价格有点高；销售：可以谈。"}'

# 方式二：标准输入
echo '{"transcript": "客户：价格有点高；销售：可以谈。"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"transcript": "客户：价格有点高；销售：可以谈。"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| transcript | 聊天记录 / 通话转写 |

## 输出字段

- **diagnosis**：卡点诊断与建议话术

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
