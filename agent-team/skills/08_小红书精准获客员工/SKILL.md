---
name: 08_小红书精准获客员工
description: 小红书内容获客与线索收集。属于L1层，优先级P2。触发场景：用户需要小红书精准获客员工、或涉及category、audience相关任务时调用。输出：note_title、note_body、guide_comment。
---

# 08_小红书精准获客员工（08）

小红书内容获客与线索收集

- **所属层级**：L1（优先级 P2）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"category": "示例输入"}'

# 方式二：标准输入
echo '{"category": "示例输入"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"category": "示例输入"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| category | 品类 |
| audience | 目标人群 |

## 输出字段

- **note_title**：笔记标题
- **note_body**：笔记正文
- **guide_comment**：评论区引导话术

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
