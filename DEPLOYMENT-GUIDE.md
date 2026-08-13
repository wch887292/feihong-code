# 飞虹 Code (fhcode) 本地部署调试准备

> **晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹**
>
> 版本: 0.2.1 | 生成时间: 2026-08-13

---

## 一、项目状态总览

### ✅ 已通过验证套件（全部 100% 通过）

| 套件 | 结果 | 说明 |
|------|------|------|
| `npm test` | 27/27 ✅ | 单元测试（安全脱敏、路径防护） |
| `verify:m4` | 41/41 ✅ | 企业级 RBAC/审计/多租户/配额 |
| `verify:m6` | 29/29 ✅ | 自我进化（压缩/经验/自愈/追踪） |
| `verify:m7` | 12/12 ✅ | 编程自主能力（分析/生成/审查/测试） |
| `verify:m8` | 27/27 ✅ | 自主编程迭代（规划→编写→测试→审查） |
| `verify:m9` | 25/25 ✅ | SWE Agent 完整链路 |
| `verify:m9-real` | 11/11 ✅ | 真实模型接入端到端验证 |
| `typecheck` | ✅ | TypeScript 无类型错误 |
| `build` | ✅ | 完整构建产物生成 |

### 🔧 本次修复的问题

| 问题 | 严重度 | 修复 |
|------|--------|------|
| `config.ts` APP_VERSION = '0.1.0' 但 package.json = '0.2.1' | 中 | 同步为 '0.2.1' |
| `model-stats` / `experiences` 命令无输出 | 高 | 补充 index.ts 导入和调用 |

---

## 二、本地环境要求

### 必需

- **Node.js** ≥ 18.0.0（推荐 22.x LTS）
- **npm** ≥ 9（或使用 pnpm/yarn）
- **TypeScript** 5.x（开发依赖）

### 可选（增强功能）

- **Ollama**：本地模型推理（需安装并运行 `ollama serve`）
- **Git**：工作树隔离和多代理并行
- **Docker**：容器化部署（见 docker-compose.yml）

---

## 三、安装步骤

### 方法 A：本地开发模式（推荐调试）

```bash
# 1. 克隆仓库
git clone https://github.com/wch887292/feihong-code.git
cd feihong-code

# 2. 安装依赖
npm install

# 3. 类型检查 + 构建
npm run build

# 4. 验证所有测试
npm test
node scripts/verify-m4.mjs
node scripts/verify-m6.mjs
node scripts/verify-m7.mjs
node scripts/verify-m8.mjs
node scripts/verify-m9.mjs
node scripts/verify-m9-real.mjs
```

### 方法 B：全局安装（CLI 使用）

```bash
# 本地链接（开发调试）
npm link

# 或直接安装
npm install -g .
```

### 方法 C：Docker 部署

```bash
docker-compose up -d
# 访问 http://localhost:8080
```

---

## 四、配置模板

### 4.1 环境变量（.env）

```bash
# 复制示例
cp .env.example .env

# 编辑 .env（切勿提交！）
```

### 4.2 模型配置

#### Ollama（本地离线）

```bash
export FH_MODEL_NAME=qwen3:8b
export FH_MODEL_TYPE=ollama
export FH_MODEL_BASE_URL=http://localhost:11434
```

#### DeepSeek（API）

```bash
export FH_PROVIDERS='[
  {"id":"deepseek","type":"openai-compatible","baseURL":"https://api.deepseek.com/v1","apiKey":"sk-xxx","tags":["code-gen","cheap"],"costPer1k":0.0001}
]'
```

#### 通义千问（API）

```bash
export FH_PROVIDERS='[
  {"id":"qwen","type":"openai-compatible","baseURL":"https://dashscope.aliyuncs.com/compatible-mode/v1","apiKey":"sk-xxx","tags":["code-gen","long-context"],"costPer1k":0.0002}
]'
```

### 4.3 企业模式配置

```bash
# 启用企业级安全（默认开启）
export FH_ENTERPRISE=true

# 设置租户和用户
export FH_TENANT=my-org
export FH_USER=admin
export FH_ROLE=admin  # viewer | developer | operator | admin

# 成本预算（美元/任务）
export FH_BUDGET_USD=1.0

# Shell 白名单
export FH_SHELL_ALLOW=git,npm,pnpm,node,ls,cat

# 审批策略
export FH_REQUIRE_APPROVAL=true
```

---

## 五、调试指南

### 5.1 快速验证

```bash
# 版本号
fhcode --version

# 帮助信息
fhcode --help

# 当前用户身份
fhcode whoami

# 查看权限策略
fhcode policy

# 审计日志
fhcode audit --limit 10

# 模型统计（执行任务后生成）
fhcode model-stats

# 经验库
fhcode experiences
```

### 5.2 单任务执行

```bash
# 离线模式（无需 API Key）
fhcode "创建一个 hello.py 文件"

# 真实模型模式
export FH_MODEL_NAME=qwen3:8b
export FH_MODEL_TYPE=ollama
fhcode "实现一个 REST API 用户模块"
```

### 5.3 Web 控制台

```bash
# 启动 Web 服务
fhcode serve --port 8080

# 访问
# http://localhost:8080
# 令牌在启动时输出，或设置 FH_WEB_TOKEN=<自定义>
```

### 5.4 故障排查

#### 问题 1：构建失败

```bash
# 清理缓存
rm -rf dist node_modules/.cache
npm run build
```

#### 问题 2：API 调用失败

```bash
# 检查环境变量
echo $FH_PROVIDERS
echo $FH_MODEL_NAME

# 测试 API 连通性
curl -X POST https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer $FH_DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}]}'
```

#### 问题 3：权限拒绝

```bash
# 查看当前角色权限
fhcode policy

# 检查审计日志
fhcode audit --limit 20
```

#### 问题 4：会话恢复

```bash
# 列出历史会话
fhcode sessions

# 恢复会话
fhcode resume <run-id>

# 查看变更
fhcode diff <run-id>

# 回滚（危险操作需 --yes）
fhcode rollback <run-id> --yes
```

---

## 六、已知限制与注意事项

### 6.1 代码复杂度警告

以下文件复杂度超过质量门禁阈值（15），但验证全部通过：

| 文件 | 复杂度 | 状态 |
|------|--------|------|
| `experience.ts` | 24 | ⚠️ 需重构（功能完整） |
| `orchestrator.ts` | 19 | ⚠️ 需重构（核心稳定） |

**建议**：后续迭代可提取子函数降低复杂度，不影响当前功能。

### 6.2 缺失单元测试

以下核心模块缺少测试，已标记为技术债务：

- `code-review.ts`
- `code-writer.ts`
- `context-compactor.ts`
- `experience.ts`
- `orchestrator.ts`
- `swe-agent.ts`
- `swe-planner.ts`
- `swe-verifier.ts`

**建议**：M10 迭代补充这些模块的单元测试。

### 6.3 Windows Defender 干扰

Windows 环境下 Defender 可能锁定 `app.asar`，导致构建失败。解决方案：

```powershell
# 添加项目目录到 Defender 排除项
Add-MpPreference -ExclusionPath "H:\Muse Code复刻"
```

---

## 七、下一步计划

### 短期（本周）

- [ ] 补充缺失单元测试（8 个核心模块）
- [ ] 重构 experience.ts 和 orchestrator.ts 降低复杂度
- [ ] 本地部署调试全流程验证

### 中期（本月）

- [ ] M10：测试覆盖率提升至 80%
- [ ] M11：性能优化与内存管理
- [ ] M12：安全加固与合规审计

### 长期（下季度）

- [ ] 前端可视化增强
- [ ] 多模型对比实验平台
- [ ] 企业部署方案落地

---

## 八、联系方式

- **公司**：晋江市飞虹智科技企业管理有限公司
- **中心**：飞扬企源研发中心
- **负责人**：吴赐虹
- **GitHub**：https://github.com/wch887292/feihong-code
- **官网**：https://www.klai.top

---

*文档生成时间：2026-08-13 21:40 GMT+8*
