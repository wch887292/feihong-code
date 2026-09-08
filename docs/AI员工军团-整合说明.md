# AI 员工军团 · 飞虹整合说明

> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
> 对应飞虹 Code v8.0.0 主线：「企业 AI 底座」的指挥中心层

## 一、这是什么

把 `feihongzhi_agents`（AI 员工军团系统，Python 实现，17 个业务 AI 员工）作为**产品资产**整合进飞虹 Code，
并通过飞虹原生工具桥接 + **复用飞虹模型路由**，让两个体系共用一套模型配置、一套安全策略。

```
飞虹 Code（指挥中心）
 ├─ feihong_agents_list    只读：员工清单 / 任务统计
 ├─ feihong_agents_submit  写（需审批）：提交任务 + 立即执行
 └─ 模型路由 ──→ LLM_PROVIDER=doubao（DOUBAO_API_KEY/MODEL/BASE_URL 透传，apiKey 不回显）
        │
        ▼
 agent-team/（本仓库根目录，Python 框架本体）
 ├─ main.py            CLI：init-db / list-agents / submit / run-once / run-loop / approve / stats
 ├─ core/              数据模型（SQLite）+ 调度器（重试 3 次 / 人工闸门）
 ├─ agents/            L1-L5 五层 17 员工模块（registry.py 注册）
 ├─ llm/               doubao_llm（OpenAI 兼容，零第三方依赖）+ mock_llm
 ├─ skills/            17 个技能包（SKILL.md + run.py）
 └─ feihongzhi.db      任务/线索/客户/内容资产库（首次调用自动 init-db，幂等）
```

## 二、安装与配置

1. **框架**：已复制到仓库根 `agent-team/`（随飞虹分发；`I:\skills\feihongzhi_agents` 为源）。
2. **技能**：17 个技能已安装到用户级技能目录 `%USERPROFILE%\.feihong-code\skills\`（`discoverSkills` 48 个技能中 17 个为 AI 员工）。
3. **模型**：无需单独配置。桥接自动读取飞虹 `models.providers` 中**第一个 openai-compatible 且带 apiKey 的 provider**，
   映射为 `DOUBAO_API_KEY / DOUBAO_MODEL / DOUBAO_BASE_URL` + `LLM_PROVIDER=doubao`；无可用 provider 时回退
   `LLM_PROVIDER=mock`（本地确定性，跑通全链路）。可用环境变量覆盖：
   - `FEIHONG_AGENT_TEAM_DIR`：agent-team 目录（缺省 `<仓库根>/agent-team`）
   - `FEIHONG_PYTHON`：Python 解释器（缺省 `python`，本机 Python 3.14.7 已验证）

## 三、工具契约

| 工具 | 权限 | 入参 | 出参 |
|---|---|---|---|
| `feihong_agents_list` | 只读（any） | `scope: agents(默认)\|stats` | 员工清单表格 / 任务统计 JSON |
| `feihong_agents_submit` | 写（operator/admin 需审批） | `agentId: 1-17（兼容"01"）`、`input: JSON 字符串`、`executeNow: 默认 true` | 任务 JSON + 执行结果 |

- `agentId` 对应员工编号（01-17），清单用 `feihong_agents_list` 查询。
- `input` 字段按对应技能 SKILL.md 声明（如 01 获客：`channels`/`keywords`）。
- 写操作一律走飞虹审批（`approvalTools` 含 `feihong_agents_submit`）；只读沙箱拦截同款名单。
- 安全：apiKey 仅作为子进程环境变量传递，不回显、不落盘、不进审计。

## 四、已验证（2026-09-08）

- 全量单测 **269/269 通过**（含新增 `tests/unit/agents.test.ts` 3 例：无 provider 回退 mock / 键名安全 / 不误填 key）；typecheck 0 错误。
- 真实链路（dist 产品路径）：`list` → 17 员工清单 ✅；`stats` → 任务状态分布 ✅；
  `submit`（mock）→ task_id `T82d867202e43` pending→success，线索入库 3 条 ✅。
- dist 重建：`npx tsc` 成功 + copy-web 手动等价（本机 Node 环境已知问题，见交接记录）。

## 五、使用示例

```
用户：让 01 获客线索雷达找一批客户
飞虹：feihong_agents_submit agentId=1 input={"channels":"[朋友圈,抖音]","keywords":"企业AI"}
      → 审批 → 任务成功 → 线索入库 → feihong_agents_list scope=stats 查看结果
```

## 六、后续可选（未做）

- `run-loop`（持续执行）包装为飞虹后台任务/定时任务。
- `approve`（人工闸门）接入飞虹审批流，替代 Python 侧确认。
- 员工任务结果回写飞虹记忆（memory/），形成「AI 员工 → 指挥中心」闭环复盘。
