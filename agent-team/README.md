# 飞虹智 · AI 员工军团系统（feihongzhi_agents）

17 个 AI 员工模块 + 11 调度官的一人公司运营系统。按开发文档《AI 员工军团系统开发文档》实现。

## 快速开始

```bash
# 1. 初始化数据库
python3 main.py init-db

# 2. 查看 17 个 AI 员工清单
python3 main.py list-agents

# 3. 跑通 M1 销售闭环演示（01线索雷达 → 02跟进销冠 → 04成交分析 → 09私域分层）
python3 main.py demo-pipeline

# 4. 提交单个任务并执行
python3 main.py submit 12 --input '{"topic": "工厂老板如何用AI获客"}'
python3 main.py run-once

# 5. 任务统计
python3 main.py stats
```

## 接入真实大模型

复制 `.env.example` 为 `.env`，填入豆包 API Key 后设置 `LLM_PROVIDER=doubao`。

## 目录结构

```
core/       数据模型(SQLite)、任务协议与状态机、11 调度官、BaseAgent 基类
llm/        LLM 适配器（mock 本地模拟 / 豆包 API）
agents/     17 个 AI 员工模块（按五层组织）
tests/      单元测试
```

## 开发状态

- [x] M0 基建：任务协议、数据模型、调度官骨架、模块框架（当前版本）
- [ ] M1 销售闭环：接入真实 LLM 与真实线索源
- [ ] M2 内容引擎 / M3 渠道扩展 / M4 战略决策（按路线图推进）
