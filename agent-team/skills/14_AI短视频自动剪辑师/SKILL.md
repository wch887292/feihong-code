---
name: 14_AI短视频自动剪辑师
description: 素材自动剪辑成片、批量出片。属于L2层，优先级P1。触发场景：用户需要AI短视频自动剪辑师、或涉及clips、script、template相关任务时调用。输出：video。
---

# 14_AI短视频自动剪辑师（14）

素材自动剪辑成片、批量出片

- **所属层级**：L2（优先级 P1）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{"clips": "["示例A","示例B"]"}'

# 方式二：标准输入
echo '{"clips": "["示例A","示例B"]"}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{"clips": "["示例A","示例B"]"}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
| clips | 素材列表 |
| script | 脚本 |
| template | 模板 |

## 输出字段

- **video**：成片元数据

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
