# 飞虹 Code API 文档

**版本**：v7.9.1  
**基础 URL**：`http://localhost:8080`  
**认证方式**：Bearer Token（FH_WEB_TOKEN）  
**数据格式**：JSON  

---

## 目录

1. [认证方式](#认证方式)
2. [公开接口](#公开接口)
3. [受保护接口](#受保护接口)
4. [错误响应](#错误响应)
5. [数据模型](#数据模型)
6. [示例代码](#示例代码)

---

## 认证方式

### 获取 Token

后端启动时自动生成 `FH_WEB_TOKEN`，输出在启动日志中：

```
[飞虹 Code] Web 控制台访问令牌 (FH_WEB_TOKEN): xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

也可通过环境变量设置：
```bash
$env:FH_WEB_TOKEN = "your-secret-token"
node dist/cli/index.js serve
```

### 使用 Token

所有受保护接口需在请求头中携带 Token：

```http
Authorization: Bearer <FH_WEB_TOKEN>
Content-Type: application/json
```

### cURL 示例

```bash
curl -X GET http://localhost:8080/api/tasks \
  -H "Authorization: Bearer <FH_WEB_TOKEN>"
```

---

## 公开接口

### 1. 健康检查

检查后端服务是否正常运行。

**请求**
```
GET /api/health
```

**响应** `200 OK`
```json
{
  "ok": true,
  "product": "飞虹 Code",
  "version": "7.9.1",
  "signature": "晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹",
  "enterprise": true,
  "lang": "zh",
  "wechat": "disabled",
  "feishu": "disabled",
  "yuanbao": "disabled",
  "time": "2026-09-03T03:22:41.905Z"
}
```

**字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| ok | boolean | 服务是否正常 |
| product | string | 产品名称 |
| version | string | 当前版本号 |
| signature | string | 版权签名 |
| enterprise | boolean | 是否企业版 |
| lang | string | 语言 |
| wechat | string | 微信桥接状态（disabled/enabled） |
| feishu | string | 飞书桥接状态 |
| yuanbao | string | 元宝桥接状态 |
| time | string | 服务器时间（ISO 8601） |

**示例**
```bash
curl http://localhost:8080/api/health
```

---

## 受保护接口

> 以下接口均需携带 `Authorization: Bearer <FH_WEB_TOKEN>` 请求头。

### 2. 版本信息

获取详细的版本和构建信息。

**请求**
```
GET /api/version
```

**响应** `200 OK`
```json
{
  "version": "7.9.1",
  "buildTime": "2026-09-03T10:00:00.000Z",
  "commit": "abc1234",
  "nodeVersion": "v22.23.2",
  "platform": "win32"
}
```

**错误响应** `401 Unauthorized`
```json
{
  "error": "Unauthorized",
  "code": 401
}
```

---

### 3. 系统状态

获取当前系统运行状态。

**请求**
```
GET /api/status
```

**响应** `200 OK`
```json
{
  "status": "running",
  "uptime": 3600,
  "memory": {
    "rss": 238026752,
    "heapTotal": 104857600,
    "heapUsed": 62914560
  },
  "cpu": {
    "usage": 5.2,
    "cores": 8
  },
  "activeTasks": 3,
  "queuedTasks": 0
}
```

---

### 4. 配置管理

获取或更新系统配置。

**获取配置**
```
GET /api/config
```

**更新配置**
```
POST /api/config
Content-Type: application/json

{
  "model": "agnes-2.5-flash",
  "apiBase": "https://api.agnes-ai.cn/v1",
  "temperature": 0.7,
  "maxTokens": 4096
}
```

**响应** `200 OK`
```json
{
  "success": true,
  "config": { ... }
}
```

---

### 5. 功能特性

获取可用功能特性列表。

**请求**
```
GET /api/features
```

**响应** `200 OK`
```json
{
  "features": [
    { "id": "chat", "name": "AI 对话", "enabled": true },
    { "id": "games", "name": "游戏中心", "enabled": true },
    { "id": "creative", "name": "AI 创作", "enabled": true },
    { "id": "hermes", "name": "Hermes Agent", "enabled": true },
    { "id": "keyless", "name": "免密网络层", "enabled": true },
    { "id": "wechat", "name": "微信桥接", "enabled": false },
    { "id": "feishu", "name": "飞书桥接", "enabled": false }
  ]
}
```

---

### 6. 模型管理

获取可用模型列表。

**请求**
```
GET /api/models
```

**响应** `200 OK`
```json
{
  "models": [
    {
      "id": "agnes-2.5-flash",
      "name": "Agnes 2.5 Flash",
      "provider": "agnes",
      "apiBase": "https://api.agnes-ai.cn/v1",
      "contextWindow": 128000,
      "maxOutput": 8192,
      "supportsStreaming": true,
      "supportsVision": false
    }
  ],
  "defaultModel": "agnes-2.5-flash"
}
```

**添加模型**
```
POST /api/models
Content-Type: application/json

{
  "id": "custom-model",
  "name": "自定义模型",
  "provider": "openai-compatible",
  "apiBase": "https://api.example.com/v1",
  "apiKey": "sk-xxx",
  "contextWindow": 32000
}
```

---

### 7. 模型提供商

获取配置的模型提供商列表。

**请求**
```
GET /api/providers
```

**响应** `200 OK`
```json
{
  "providers": [
    {
      "id": "agnes",
      "name": "Agnes AI",
      "apiBase": "https://api.agnes-ai.cn/v1",
      "models": ["agnes-2.5-flash"],
      "status": "connected"
    },
    {
      "id": "siliconflow",
      "name": "硅基流动",
      "apiBase": "https://api.siliconflow.cn/v1",
      "models": ["deepseek-ai/DeepSeek-OCR"],
      "status": "connected"
    }
  ]
}
```

---

### 8. Agent 管理

管理 AI Agent 实例。

**获取 Agent 列表**
```
GET /api/agents
```

**响应** `200 OK`
```json
{
  "agents": [
    {
      "id": "agent-001",
      "name": "代码助手",
      "type": "solo",
      "status": "idle",
      "createdAt": "2026-09-01T10:00:00.000Z",
      "lastActive": "2026-09-03T08:00:00.000Z"
    }
  ],
  "total": 5
}
```

**创建 Agent**
```
POST /api/agents
Content-Type: application/json

{
  "name": "新 Agent",
  "type": "solo",
  "systemPrompt": "你是一个专业的代码助手",
  "model": "agnes-2.5-flash"
}
```

**获取单个 Agent**
```
GET /api/agents/:id
```

**删除 Agent**
```
DELETE /api/agents/:id
```

---

### 9. 技能管理

管理可复用技能。

**获取技能列表**
```
GET /api/skills
```

**响应** `200 OK`
```json
{
  "skills": [
    {
      "id": "skill-summarize",
      "name": "内容摘要",
      "description": "对长文本进行结构化摘要",
      "trigger": "摘要|总结|概括",
      "tags": ["文本处理", "效率"],
      "useCount": 12,
      "builtin": true,
      "createdAt": "2026-09-01T00:00:00.000Z"
    }
  ],
  "total": 4
}
```

**安装技能**
```
POST /api/skills
Content-Type: application/json

{
  "name": "新技能",
  "description": "技能描述",
  "trigger": "触发词",
  "prompt": "提示词模板，{{content}}表示用户输入",
  "tags": ["自定义"]
}
```

**删除技能**
```
DELETE /api/skills/:id
```

---

### 10. 工具列表

获取可用工具列表。

**请求**
```
GET /api/tools
```

**响应** `200 OK`
```json
{
  "tools": [
    { "name": "web_search", "description": "网页搜索", "enabled": true },
    { "name": "file_read", "description": "文件读取", "enabled": true },
    { "name": "shell_exec", "description": "Shell 执行", "enabled": true },
    { "name": "browser", "description": "浏览器自动化", "enabled": true },
    { "name": "tts", "description": "文字转语音", "enabled": true }
  ],
  "total": 8
}
```

---

### 11. 任务队列

管理异步任务队列。

**获取任务列表**
```
GET /api/tasks?status=pending&limit=20&offset=0
```

**查询参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| status | string | 筛选状态（pending/running/completed/failed） |
| limit | number | 每页数量（默认20） |
| offset | number | 偏移量（默认0） |

**响应** `200 OK`
```json
{
  "tasks": [
    {
      "id": "task-001",
      "type": "chat",
      "status": "completed",
      "progress": 100,
      "createdAt": "2026-09-03T10:00:00.000Z",
      "completedAt": "2026-09-03T10:00:05.000Z",
      "result": { "summary": "任务完成" }
    }
  ],
  "total": 98,
  "pending": 0,
  "running": 0
}
```

**创建任务**
```
POST /api/tasks
Content-Type: application/json

{
  "type": "chat",
  "input": "你好",
  "model": "agnes-2.5-flash"
}
```

**获取任务状态**
```
GET /api/tasks/:id
```

**取消任务**
```
POST /api/tasks/:id/cancel
```

**删除任务**
```
DELETE /api/tasks/:id
```

---

### 12. 知识库

管理知识库文档。

**获取文档列表**
```
GET /api/knowledge
```

**响应** `200 OK`
```json
{
  "documents": [
    {
      "id": "doc-001",
      "title": "飞虹 Code 使用指南",
      "type": "markdown",
      "size": 10240,
      "tags": ["指南", "使用"],
      "createdAt": "2026-09-01T00:00:00.000Z"
    }
  ],
  "total": 14
}
```

**上传文档**
```
POST /api/knowledge
Content-Type: multipart/form-data

file: <文件>
title: 文档标题
tags: ["标签1","标签2"]
```

**搜索知识库**
```
GET /api/knowledge/search?q=关键词
```

**删除文档**
```
DELETE /api/knowledge/:id
```

---

### 13. 插件管理

管理系统插件。

**获取插件列表**
```
GET /api/plugins
```

**响应** `200 OK`
```json
{
  "plugins": [
    {
      "id": "plugin-001",
      "name": "示例插件",
      "version": "1.0.0",
      "description": "插件描述",
      "enabled": true,
      "installedAt": "2026-09-01T00:00:00.000Z"
    }
  ],
  "total": 0
}
```

**启用/禁用插件**
```
POST /api/plugins/:id/toggle
```

**卸载插件**
```
DELETE /api/plugins/:id
```

---

## 错误响应

### 错误格式

所有错误响应遵循统一格式：

```json
{
  "error": "错误描述",
  "code": 400,
  "details": {}
}
```

### 常见错误码

| 状态码 | 说明 | 原因 |
|--------|------|------|
| 400 | Bad Request | 请求参数错误 |
| 401 | Unauthorized | 未携带或 Token 无效 |
| 403 | Forbidden | 无权限访问 |
| 404 | Not Found | 资源不存在 |
| 409 | Conflict | 资源冲突 |
| 429 | Too Many Requests | 请求频率超限 |
| 500 | Internal Server Error | 服务器内部错误 |
| 503 | Service Unavailable | 服务暂不可用 |

### 认证错误示例

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "error": "Unauthorized",
  "code": 401
}
```

---

## 数据模型

### Health

```typescript
interface Health {
  ok: boolean;
  product: string;
  version: string;
  signature: string;
  enterprise: boolean;
  lang: string;
  wechat: 'disabled' | 'enabled';
  feishu: 'disabled' | 'enabled';
  yuanbao: 'disabled' | 'enabled';
  time: string; // ISO 8601
}
```

### Model

```typescript
interface Model {
  id: string;
  name: string;
  provider: string;
  apiBase: string;
  contextWindow: number;
  maxOutput: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
}
```

### Skill

```typescript
interface Skill {
  id: string;
  name: string;
  description: string;
  trigger: string; // | 分隔多个触发词
  prompt: string;  // 支持 {{content}} {{变量}}
  tools: string[];
  tags: string[];
  version: string;
  useCount: number;
  builtin?: boolean;
  autoExtracted?: boolean;
  llmExtracted?: boolean;
  createdAt: string;
  improvedAt?: string;
}
```

### Task

```typescript
interface Task {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  input: any;
  result?: any;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}
```

### Agent

```typescript
interface Agent {
  id: string;
  name: string;
  type: 'solo' | 'orchestrator' | 'team';
  status: 'idle' | 'running' | 'error';
  systemPrompt?: string;
  model?: string;
  createdAt: string;
  lastActive?: string;
}
```

---

## 示例代码

### Node.js 示例

```javascript
const BASE_URL = 'http://localhost:8080';
const TOKEN = 'your-fh-web-token';

async function api(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
      ...options.headers
    }
  });
  if (!res.ok) throw new Error(`API Error: ${res.status}`);
  return res.json();
}

// 健康检查（无需认证）
const health = await fetch(`${BASE_URL}/api/health`).then(r => r.json());
console.log('版本:', health.version);

// 获取任务列表（需认证）
const tasks = await api('/api/tasks?status=completed&limit=10');
console.log('任务数:', tasks.total);

// 创建任务
const newTask = await api('/api/tasks', {
  method: 'POST',
  body: JSON.stringify({ type: 'chat', input: '你好' })
});
console.log('任务ID:', newTask.id);
```

### Python 示例

```python
import requests

BASE_URL = 'http://localhost:8080'
TOKEN = 'your-fh-web-token'
HEADERS = {'Authorization': f'Bearer {TOKEN}'}

# 健康检查
health = requests.get(f'{BASE_URL}/api/health').json()
print(f"版本: {health['version']}")

# 获取模型列表
models = requests.get(f'{BASE_URL}/api/models', headers=HEADERS).json()
print(f"模型数: {len(models['models'])}")

# 创建技能
skill = requests.post(
    f'{BASE_URL}/api/skills',
    headers=HEADERS,
    json={
        'name': '代码优化',
        'description': '优化代码性能和可读性',
        'trigger': '优化代码|代码优化|性能优化',
        'prompt': '请优化以下代码，提升性能和可读性：\n\n{{content}}'
    }
).json()
print(f"技能ID: {skill.get('id')}")
```

### cURL 示例

```bash
# 健康检查
curl http://localhost:8080/api/health

# 获取任务列表
curl -X GET http://localhost:8080/api/tasks \
  -H "Authorization: Bearer <TOKEN>"

# 创建任务
curl -X POST http://localhost:8080/api/tasks \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"type":"chat","input":"你好"}'

# 安装技能
curl -X POST http://localhost:8080/api/skills \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"新技能","description":"描述","trigger":"触发词","prompt":"模板"}'
```

---

## 速率限制

| 接口类型 | 限制 |
|----------|------|
| 公开接口（/api/health） | 无限制 |
| 受保护接口 | 100 次/分钟 |
| 文件上传 | 10 次/分钟，单文件最大 50MB |

超出限制返回 `429 Too Many Requests`。

---

## 变更日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v7.9.1 | 2026-09-03 | 新增 favicon/robots、LLM 辅助技能提炼、集成测试框架 |
| v7.9.0 | 2026-09-03 | Hermes Agent 完整框架（持久记忆+自演化技能+自动化调度+工具集） |
| v7.8.0 | 2026-09-02 | 免密网络层（Keyless Web Tier）+ Hermes 记忆基础 |
| v7.6.0 | 2026-08-30 | 基础版本，20个子系统 |

---

*本文档随版本更新而维护，最新版本以项目仓库 docs/ 目录为准。*
