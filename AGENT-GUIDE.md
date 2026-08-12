# AGENT-GUIDE.md — 面向 AI Agent 的使用指南

> **本文档专为 AI Agent 设计**，提供快速上手所需的环境、配置、工具契约与最佳实践。
>
> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
> 版本：0.2.1 | 2026-08-12

---

## 一、项目简介

**飞虹 Code（fhcode）** 是一款运行在终端的 AI 编程智能体，支持：

- **自然语言 → 代码闭环**：描述需求，自动规划、编写、验证
- **多模型路由**：DeepSeek / 通义 / Ollama（本地）/ OpenAI 兼容
- **企业级安全**：RBAC、审计链、多租户、配额熔断
- **全自动软件工程**：`swe` 命令可自主完成仓库级开发任务

**GitHub**：`github.com/wch887292/feihong-code`（待上线）

---

## 二、环境要求

```bash
# 必需
Node.js >= 18（推荐 20 或 22）
npm >= 9

# 可选但推荐
git（--parallel 模式需要 worktree）
tsx（开发模式）
```

**验证环境**：
```bash
node --version  # 应 >= 18.0.0
npm --version   # 应 >= 9.0.0
```

---

## 三、快速安装

### 方式一：从源码构建（推荐）
```bash
git clone https://github.com/wch887292/feihong-code.git
cd feihong-code
npm install
npm run build
```

### 方式二：全局安装
```bash
npm install -g feihong-code
fhcode --version  # 验证安装
```

---

## 四、模型配置（关键）

### 4.1 环境变量优先级
1. `FH_PROVIDERS`（JSON 数组，最高优先级）
2. `fhcode.config.json`（项目配置文件）
3. 单环境变量 `FH_MODEL_*`（快速接入）

### 4.2 Ollama 本地模型（推荐测试）
```bash
export FH_MODEL_NAME=qwen3:8b
export FH_MODEL_TYPE=ollama
export FH_MODEL_BASE_URL=http://localhost:11434
export FH_MODEL_TAGS=code-gen,reasoning,local
```

### 4.3 DeepSeek（推荐生产）
```bash
export FH_PROVIDERS='[{"name":"deepseek","type":"openai-compatible","baseUrl":"https://api.deepseek.com/v1","apiKey":"sk-...","tags":["code-gen","reasoning"],"priority":1}]'
```

### 4.4 离线 Mock（测试）
```bash
export FH_OFFLINE=true
# 或使用空 providers
export FH_PROVIDERS='[]'
```

---

## 五、典型工作流

### 5.1 单任务执行
```bash
# 基础用法
fhcode "实现一个 HTTP 服务器，监听 3000 端口"

# 带约束
fhcode --max-iterations 10 --yes "修复 src/auth.ts 中的 token 验证 bug"
```

### 5.2 并行子任务
```bash
# 自动拆分目标，worktree 隔离执行
fhcode --parallel "实现登录模块 并且 添加用户管理 并且 写集成测试"
```

### 5.3 全自动软件工程
```bash
# 读取整个仓库 → 规划 → 实现 → 验证 → 报告
fhcode swe "修复 src/calc.ts 的 add 函数 bug，让 tests/calc.test.ts 通过" \
  --repo /path/to/project \
  --max-tasks 3 \
  --max-iterations 5
```

### 5.4 只读技能
```bash
# 生成实现计划
fhcode /plan "实现登录并且添加支付"

# 红队审查（安全审计）
fhcode /grill src/

# 目标跟踪
fhcode /goal
```

---

## 六、工具调用契约

### 6.1 工具清单
| 类别 | 工具 | 说明 |
|------|------|------|
| 文件 | `write_file` | 写入/覆盖文件 |
| 文件 | `edit_file` | 插入/删除/替换文本 |
| 文件 | `read_file` | 读取文件内容 |
| 文件 | `list_files` | 列出目录内容 |
| 搜索 | `grep` | 正则搜索 |
| Shell | `run_shell` | 执行命令 |
| 验证 | `build_check` | 检查编译 |
| 验证 | `run_tests` | 运行测试 |

### 6.2 工具参数格式
所有工具调用遵循 JSON Schema：
```json
{
  "tool_calls": [
    {
      "type": "function",
      "function": {
        "name": "write_file",
        "arguments": "{\"path\":\"src/main.ts\",\"content\":\"export const x = 1;\"}"
      }
    }
  ]
}
```

### 6.3 工具返回格式
```json
{
  "tool_call_id": "call_abc123",
  "output": "已写入 src/main.ts（25 字节）",
  "error": null
}
```

---

## 七、错误处理

### 7.1 常见错误码
| 错误码 | 含义 | 处理建议 |
|--------|------|----------|
| `FH_4001` | 配额超限 | 等待重置或申请配额 |
| `FH_4003` | 权限拒绝 | 检查 RBAC 策略 |
| `FH_5001` | 模型调用失败 | 检查 provider 配置 |
| `FH_5002` | 上下文压缩失败 | 使用 /plan 重新规划 |
| `FH_6001` | 文件路径越权 | 检查沙箱规则 |

### 7.2 调试技巧
```bash
# 查看详细日志
export FH_LOG_LEVEL=debug
fhcode "你的任务"

# 查看会话历史
fhcode sessions

# 恢复上次会话
fhcode resume <session-id>
```

---

## 八、企业部署

### 8.1 必需环境变量
```bash
export FH_ENTERPRISE=true
export FH_TENANT=my-org
export FH_USER=agent-sa
export FH_ROLE=developer
export FH_WEB_TOKEN=<web-console-token>
```

### 8.2 Web 控制台
```bash
# 启动服务
fhcode serve --port 8080

# 访问
# http://localhost:8080
```

---

## 九、验证套件

```bash
# 全量验证
npm run verify

# 单项验证
npm run verify:m4  # 企业能力
npm test           # 单元测试
node scripts/verify-m9.mjs  # SWE 能力
```

---

## 十、联系与反馈

- **GitHub Issues**：提交 bug 或功能请求
- **文档**：详见 `docs/` 目录
- **署名**：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
