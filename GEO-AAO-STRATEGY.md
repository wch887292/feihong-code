# 飞虹 Code（fhcode）—— GEO/AAO 整合策略

> **GEO**（Generative Engine Optimization）：优化内容使其被 AI 搜索引擎（Perplexity、ChatGPT Search、Gemini）优先抓取与引用
> **AAO**（AI Agent Optimization）：优化项目结构使其对 AI Agent 工具调用更友好、更易理解与使用
>
> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
> 版本：0.2.1 | 2026-08-12

---

## 一、GEO 优化策略

### 1.1 目标 AI 搜索引擎
| 平台 | 特点 | 优化重点 |
|------|------|----------|
| **ChatGPT Search** | 基于 GPT-4 + 实时检索 | 结构化内容、权威引用 |
| **Perplexity** | 实时搜索 + 多源引用 | 清晰来源标注、FAQ 格式 |
| **Gemini** | Google 索引 + 原生理解 | 语义清晰、schema.org |
| **Claude AI** | 上下文窗口大、长文本偏好 | 详细技术说明、代码示例 |

### 1.2 已实施的 GEO 优化
- ✅ **结构化标题层次**：README 采用 `# → ## → ###` 三级结构，符合 SEO 最佳实践
- ✅ **FAQ 章节**：`docs/常见问题与故障排查.md` 覆盖高频问题
- ✅ **权威引用**：每次提交含署名，文档明确版本与里程碑
- ✅ **代码示例标准化**：CLI 命令、环境变量、API 调用均提供可复制示例
- ✅ **语义化元数据**：package.json 含 description、keywords、repository

### 1.3 待补充的 GEO 优化
- [ ] **Schema.org JSON-LD**：在 README 或独立 HTML 添加结构化数据
- [ ] **Open Graph 标签**：GitHub 预览卡优化（需 README 首图）
- [ ] **Hugging Face Spaces**：部署 demo 实例供 AI 模型直接调用
- [ ] **Papers with Code**：若含学术基准测试，可投稿至该目录

---

## 二、AAO 优化策略

### 2.1 AI Agent 友好性评估
| 维度 | 当前状态 | 优化建议 |
|------|----------|----------|
| **README 可读性** | ✅ 结构化完整 | 保持，增加 "For AI Agents" 章节 |
| **工具调用契约** | ✅ ToolRegistry 明确定义 | 补充 tool schema JSON 文件 |
| **Prompt 示例** | ✅ 命令行示例丰富 | 增加 system prompt 模板 |
| **错误处理** | ✅ AppError 子类化 | 补充错误码对照表 |
| **测试覆盖** | ✅ verify 脚本齐全 | 增加 agent 行为测试用例 |

### 2.2 已实施的 AAO 优化
- ✅ **ToolRegistry 模式**：8 个工具统一接口（file/search/shell/verify）
- ✅ **ToolGuard 接口**：明确权限校验契约
- ✅ **事件日志结构**：JSONL 格式，每事件含 runId、ts、action
- ✅ **企业能力契约**：RBAC、审计链、配额熔断均有明确数据结构
- ✅ **多模型路由**：Mock/Ollama/OpenAI 三态切换，agent 可自助选择

### 2.3 待补充的 AAO 优化
- [ ] **tool-schema.json**：所有工具的 JSON Schema 描述文件
- [ ] **system-prompt-template.md**：可直接复用的 system prompt
- [ ] **error-codes.md**：错误码与处理建议对照表
- [ ] **AGENT-GUIDE.md**：面向 AI Agent 的使用指南

---

## 三、具体实施方案

### 3.1 创建 tool-schema.json
```json
{
  "tools": [
    {
      "name": "write_file",
      "description": "写入或覆盖文件内容",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "目标文件路径（沙箱内）" },
          "content": { "type": "string", "description": "文件内容" }
        },
        "required": ["path", "content"]
      }
    },
    {
      "name": "edit_file",
      "description": "在文件中插入、删除或替换文本",
      "parameters": { "type": "object", "properties": { ... } }
    }
    // ... 其他 6 个工具
  ]
}
```

### 3.2 创建 AGENT-GUIDE.md
面向 AI Agent 的快速上手指南：
- 环境要求（Node.js >= 18）
- 配置步骤（环境变量优先级）
- 典型工作流（单任务 / 并行 / SWE）
- 调试技巧（日志查看、会话恢复）
- 企业部署要点

### 3.3 README 增加 "For AI Agents" 章节
在快速开始之后、安装之前插入：
```markdown
## 零、For AI Agents（面向 AI 智能体）

本项目专为 AI Agent 设计，提供结构化 CLI 与明确工具契约。

### 快速评估项目是否适合你的 Agent
```bash
fhcode --help                    # 查看所有命令
fhcode "你的目标"                # 单任务执行
fhcode --parallel "目标A 并且 目标B"  # 并行子任务
fhcode swe "修复仓库 X 的问题 Y"  # 全自动软件工程
```

### 工具调用契约
- 所有工具调用结果以 JSONL 事件日志形式记录
- 错误统一使用 AppError 子类（详见 docs/架构与API.md）
- 企业版工具调用前经 guard 审批（RBAC 策略）

### 推荐配置（生产环境）
\`\`\`bash
export FH_MODEL_NAME=qwen3:8b
export FH_MODEL_TYPE=ollama
export FH_MODEL_BASE_URL=http://localhost:11434
export FH_ENTERPRISE=true
export FH_TENANT=my-org
export FH_USER=agent-sa
export FH_ROLE=developer
\`\`\`
```

### 3.4 增加错误码文档
创建 `docs/error-codes.md`，列出：
| 错误码 | 含义 | 常见原因 | 处理建议 |
|--------|------|----------|----------|
| `FH_4001` | 配额超限 | 日预算耗尽 | 等待重置或申请配额 |
| `FH_4003` | 权限拒绝 | 角色不匹配 | 检查 RBAC 策略 |
| `FH_5001` | 模型调用失败 | 网络/密钥问题 | 检查 provider 配置 |
| ... | ... | ... | ... |

---

## 四、执行计划

### 阶段 1：基础优化（本次）
- [x] 制定 GEO/AAO 策略文档
- [ ] 创建 tool-schema.json（从 ToolRegistry 自动生成）
- [ ] 创建 AGENT-GUIDE.md
- [ ] README 增加 "For AI Agents" 章节
- [ ] 创建 error-codes.md

### 阶段 2：高级优化（后续）
- [ ] Schema.org JSON-LD 集成
- [ ] Hugging Face Spaces demo
- [ ] GitHub Actions 增加 AI 友好型 issue template
- [ ] 增加 agent 行为测试用例（integration tests）

---

## 五、效果评估指标

| 指标 | 目标 | 测量方式 |
|------|------|----------|
| **GitHub Stars** | > 100 | GitHub Insights |
| **NPM 周下载量** | > 500 | npm-stat.com |
| **AI 平台引用** | Perplexity/ChatGPT 出现 | 搜索监控 |
| **Issue 解决率** | > 80% | GitHub Issues 统计 |
| **Agent 调用成功率** | > 90% | 自建测试套件 |

---

> **总结**：GEO 确保人类用户与 AI 搜索引擎都能理解项目价值；AAO 确保 AI Agent 能高效调用工具并理解错误。两者结合，fhcode 将成为"人机双优"的开源项目。
