# 飞虹 Code · 安全白皮书（政企售前材料）

> 版本：v7.5.0-dev · 更新：2026-08-26
> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
> **合规声明**：本文档为**自评估**材料，明确区分「已实现」与「目标项」，**不宣称已取得 SOC2/ISO27001 正式认证**。正式认证计划见第 5 节。

## 1. 产品定位与数据流

飞虹 Code 是本地优先的终端 AI 编程智能体（Muse Code 参照复刻），核心原则：**代码与配置默认留在本地工作区**，模型调用可通过本地/私有化模型供应商完成，满足政企数据不出域的诉求。

数据流：
```
用户输入 → 本地 Agent 编排（Orchestrator）→ 工具执行（文件/shell/网络）→ 沙箱+审批+审计 → 结果回写工作区
                        ↓
                模型供应商（本地/私有化/云端可选）
```

## 2. 安全控制清单（已实现）

| 控制域 | 实现 | 位置 |
|---|---|---|
| 沙箱模式 | read-only / workspace-write / danger-full-access / container（Docker 隔离）四档 | `src/tools/sandbox.ts` |
| 容器隔离加固（P7-2） | docker run 默认 `--network none` + `--memory 512m` + `--pids-limit 256` + `--cap-drop ALL` + `no-new-privileges`，镜像/内存/网络可配 | `src/tools/shell/exec.ts` |
| 命令审批 | shell 执行默认需审批（requireApproval），支持交互/自动审批器 | `src/agent/approvers` |
| 危险命令黑名单 | rm -rf / 格式化 / 提权等拦截，danger-full-access 也生效 | `src/tools/shell` |
| 网络域名规则 | http(s) 目标 allow/deny 白黑名单，URL 工具与 shell 均校验 | `src/tools/sandbox.ts` |
| 变更审批流 | AI 写文件先暂存 → diff 审阅 → 接受/拒绝（含 hunk 级）后才落盘 | `src/agent/change-manager.ts` |
| RBAC / 多租户 | 策略 deny 优先，租户隔离与用量配额 | `src/enterprise` / `src/rbac` |
| 审计与哈希链 | 审计日志 + 哈希链校验（防篡改） | `src/agent/audit` |
| 会话检查点 | 可恢复会话，支持 rollback 回滚 AI 改动 | `src/runtime/session-persist.ts` |
| 供应链安全 | `npm audit` + CycloneDX SBOM + osv-scanner（可选） | `npm run security` |
| 凭证存储 | 密钥/令牌进系统安全存储（secure-store），不出现在日志 | `src/tools/secure-store.ts` |

## 3. SOC 2 五大信任服务标准 · 自评估

| 标准 | 当前状态 | 主要差距 | 行动项 |
|---|---|---|---|
| **安全**（保护系统防未授权访问） | 中 | 沙箱/审批/审计/RBAC 已具备，但无独立渗透测试报告 | 每季度外部渗透测试 + 漏洞赏金计划 |
| **可用性**（系统可访问可运行） | 中 | 无 HA/容灾设计与 SLA 承诺 | 私有化交付提供 HA 架构图与 RTO/RPO 目标 |
| **处理完整性**（处理无错误、可授权） | 中 | 变更审批流覆盖文件写入，但 shell 高权操作依赖审批器配置 | 强制默认 requireApproval + 变更审批覆盖率指标 |
| **保密性**（数据访问受限） | 高（本地优先架构天然优势） | 多租户密钥轮换策略待完善 | 增加密钥定期轮换与最小权限复核 |
| **隐私**（PII 收集/使用/处置） | 中 | 需输出正式 DPA（见 docs/DPA.md）与数据处置清单 | 发布 DPA + 数据保留/删除策略 |

## 4. ISO/IEC 27001 关键控制点 · 自评估

对齐 ISO 27001:2022 附录 A 关键控制：

| 控制（A.x） | 现状 | 说明 |
|---|---|---|
| A.5.15 访问控制 | 已实现 | RBAC 策略 + deny 优先 |
| A.8.28 安全编码 | 部分 | OWASP 审计 skill + 安全 CI；需固化到流水线门禁 |
| A.8.8 漏洞管理 | 部分 | npm audit/SBOM 已就绪；需漏洞 SLA 与修复流程 |
| A.8.12 数据防泄漏 | 已实现 | 沙箱隔离 + 网络白名单 + 凭证脱敏 |
| A.8.24 加密 | 部分 | 凭证加密存储；传输层加密取决于部署（私有化建议 TLS） |
| A.8.26 应用安全测试 | 部分 | 需 SAST/DAST 流水线接入 |
| A.8.31 隔离环境 | 已实现 | Docker 容器隔离档位（不信任代码场景） |
| A.8.9 配置管理 / A.5.23 云安全 | 部分 | 私有化部署建议基线配置清单 |

## 5. 正式认证路线图（目标，非已认证）

| 阶段 | 内容 | 预计 |
|---|---|---|
| 1 | SAST/DAST 流水线接入 + 渗透测试基线 | v7.6 |
| 2 | SOC 2 Type I 差距评估与整改 | v7.7 |
| 3 | SOC 2 Type I 认证 + ISO 27001 差距评估 | v8.0 |
| 4 | ISO 27001 认证 | v8.x |

## 6. 政企采购对接建议

- 售前演示建议：`fhcode doctor` 展示沙箱档位与 Docker 探测；`fhcode audit verify` 展示审计哈希链；`fhcode policy` 展示 RBAC 策略
- 需要补签材料：`docs/DPA.md`（数据处理协议）
- 明确边界：飞虹 Code 提供安全**框架**与**默认安全**，具体合规责任按部署环境与使用方策略共同落实

> 本白皮书用于售前沟通与安全评估说明，不构成任何正式合规认证声明。
