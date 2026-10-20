---
name: yizhou-thinking
description: "【yizhou-thinking】 一舟商业思考（yizhou thinking）— 面向内容型个人IP、小团队知识付费、直播成交、平台经营、产品迭代与AI无人公司的统一商业判断 skill。用于：诊断生意卡点、分析内容与直播转化、判断平台风险与合规、评估产品/报价/训练营设计、做战略取舍，以及把内容型个人IP的经营逻辑沉淀成可复用的判断系统。当用户提到“一舟商业思考 / yizhou thinking / 商业思考 skill / 商业思考模型 / 按这套方式判断 / 帮我诊断这个生意 / 帮我看内容为什么不转化 / 该冲还是该收 / 要不要做这个项目 / 直播为什么卖不动 / 这个动作有无平台风险 / 怎么把这个想法沉淀成一舟方法论”时使用。"
---

# 一舟商业思考（yizhou thinking）

把完整执行细节放在 `references/full-workflow.md`，主入口只保留触发、路由和交付约束。

## 核心定位

- 当前 skill：`一舟思考-yizhou-thinking`。
- YAML name：`yizhou-thinking`。
- 触发依据优先看 YAML description；用户用中文核心名、英文 slug 或旧名调用时都执行本 skill。
- 执行前必须读取 `references/full-workflow.md`，不要只凭本页摘要执行。

## 工作流

1. 先判断用户任务是否匹配本 skill 的触发场景。
2. 读取 `references/full-workflow.md` 中的完整流程、红线、命令和 Gotchas。
3. 按完整流程执行；涉及脚本时优先使用本目录 `scripts/`。
4. 输出前做一次自检：是否满足用户目标、是否遵守完整手册里的禁止项、是否说明产出位置。

## 输出要求

- 先给结论或产出，不写长篇解释。
- 涉及文件生成时，给出完整路径。
- 涉及外部发布、发送、交易、删除等不可逆动作时，按工作区安全规则处理。
- 若完整手册与本页冲突，以本页的命名/映射规则和完整手册的业务细节共同为准。

## 何时读取 references

- 每次执行都读 `references/full-workflow.md`。
- 如果用户只问“这个 skill 是什么”，可以只读本页并简要回答。

## Gotchas

- 不要因为主入口变短就省略完整流程。
- 不要把旧英文目录当成新源码；源码以 `一舟思考-yizhou-thinking` 为准。
- 不要复制旧版本内容到多个入口，避免再次漂移。
