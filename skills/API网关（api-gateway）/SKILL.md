---
name: api-gateway
description: Unified gateway for calling external APIs when user needs to fetch data from or send data to web services, SaaS platforms, or REST/GraphQL APIs including GitHub, Slack, Notion, and Chinese services.
---

# API 网关（API Gateway）

## 核心定位

统一处理外部 API 调用：识别目标服务、检查凭证、构造请求（含认证头、分页、限流）、执行、解析响应、处理错误。支持链式调用多个服务。

不适用于：需要浏览器渲染的动态内容（用 browser-automation skill）；没有 API 的网站（用 content-scraper skill）。

---

## 触发场景

- 用户说"从 GitHub/Slack/Notion/飞书/Twitter 获取数据"
- 用户说"调用 XX 的 REST API"
- 需要整合多个外部服务的数据
- 需要处理带分页的大量数据拉取

---

## 支持服务分类

### 代码与开发
| 服务 | 常用操作 |
|------|----------|
| GitHub | 搜索仓库、列 Issues、读 PR、读文件内容、创建 Issue |
| GitLab | 同 GitHub，endpoint 前缀为 `/api/v4/` |
| npm Registry | 查包信息、版本列表、周下载量 |
| PyPI | 查包信息、依赖树 |

### 通讯与协作
| 服务 | 常用操作 |
|------|----------|
| Slack | 发消息、查频道历史、搜索消息 |
| 飞书 | 发消息、查多维表格、创建文档 |
| 钉钉 | 发群消息、查通讯录 |
| Discord | 发消息、读取频道消息 |

### 内容与知识
| 服务 | 常用操作 |
|------|----------|
| Notion | 查数据库、创建页面、更新属性 |
| Airtable | 列记录、创建记录、批量更新 |
| Confluence | 查页面内容、创建页面 |

### AI 与 LLM
| 服务 | 常用操作 |
|------|----------|
| OpenAI | Chat Completion、Embeddings、文件上传 |
| Anthropic | Messages API |
| Replicate | 运行模型、查询任务状态 |

### 数据与搜索
| 服务 | 常用操作 |
|------|----------|
| Exa | 语义搜索、内容抓取 |
| SerpAPI | Google 搜索结果 |
| NewsAPI | 新闻搜索、按关键词过滤 |
| Alpha Vantage | 股票数据、汇率 |

### 国内服务
| 服务 | 常用操作 |
|------|----------|
| 飞书开放平台 | 消息、多维表格、云文档 |
| 百度 AI | OCR、NLP 分析、翻译 |
| 高德地图 | 地理编码、路线规划、POI 搜索 |
| 快递 100 | 物流查询 |

---

## 工作流

### Step 1：识别目标服务和操作

从用户请求中提取：
- 目标服务名称
- 操作类型（读取/写入/搜索）
- 资源标识符（仓库名、频道 ID、用户名等）
- 过滤条件和分页需求

如果服务不在支持列表中，询问用户提供 API 文档 URL，然后根据文档构造请求。

### Step 2：凭证检查

凭证配置模式（按优先级）：
```bash
# 方式 1：环境变量（推荐）
export GITHUB_TOKEN=YOUR_GITHUB_TOKEN
export SLACK_BOT_TOKEN=YOUR_TOKEN
export NOTION_API_KEY=YOUR_API_KEY

# 方式 2：会话中临时提供（不持久化）
用户在对话中直接提供 token
```

凭证缺失时的标准提示：
```
检测到缺少 {SERVICE}_TOKEN。

请选择：
A. 在终端运行：export {SERVICE}_TOKEN=你的token，然后重试
B. 直接提供 token（本次会话使用，不保存）
C. 跳过认证（仅适用于该服务的公开 API）

获取 token 的地址：{官方文档链接}
```

安全规则：不将凭证写入文件或日志；输出中仅显示 token 前 8 位（`YOUR_TOKEN...`）。

### Step 3：构造 API 请求

**通用认证头**
```python
# Bearer Token（GitHub, Notion, OpenAI, 飞书等）
headers = {"Authorization": f"Bearer {token}"}

# API Key 自定义头
headers = {"X-API-Key": api_key}           # Airtable
headers = {"api-key": api_key}              # Azure OpenAI

# Basic Auth
import base64
creds = base64.b64encode(f"{user}:{password}".encode()).decode()
headers = {"Authorization": f"Basic {creds}"}
```

**分页处理（通用模板）**
```python
import requests

def paginate_api(url, headers, params=None,
                 results_key="items", cursor_field=None, page_field="page"):
    results = []
    page = 1
    cursor = None

    while True:
        p = dict(params or {})
        if cursor_field and cursor:
            p[cursor_field] = cursor
        elif not cursor_field:
            p[page_field] = page

        resp = requests.get(url, headers=headers, params=p, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        batch = data.get(results_key, [])
        results.extend(batch)

        if not batch:
            break
        if cursor_field:
            cursor = data.get("next_cursor") or data.get("nextPageToken")
            if not cursor:
                break
        else:
            if len(batch) < p.get("per_page", 100):
                break
            page += 1

    return results

# 平台特定分页参数：
# GitHub:  results_key="", page_field="page", per_page 用 Link header
# Notion:  cursor_field="start_cursor", results_key="results"
# Slack:   cursor_field="cursor", 在 response_metadata.next_cursor
# Airtable: cursor_field="offset", results_key="records"
```

**限流重试**
```python
import time

def with_rate_limit(fn, *args, max_retries=3, **kwargs):
    for attempt in range(max_retries):
        resp = fn(*args, **kwargs)
        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", 60))
            print(f"限流，等待 {wait} 秒后重试（第 {attempt+1} 次）")
            time.sleep(wait)
            continue
        return resp
    raise Exception(f"连续 {max_retries} 次被限流，停止重试")
```

### Step 4：执行并记录

每次请求记录（用于调试）：
- 请求 URL（脱敏：移除 token query param）
- HTTP 方法和状态码
- 响应耗时

### Step 5：错误处理

**错误处理矩阵**

| 状态码 | 含义 | 处理动作 |
|--------|------|----------|
| 400 | 请求参数错误 | 打印响应体中的 error/message 字段，提示检查参数 |
| 401 | 认证失败 | 见下方详细处理 |
| 403 | 权限不足 | 说明需要什么 scope，提示在服务控制台添加 |
| 404 | 资源不存在 | 确认资源标识符（仓库名/ID/路径）是否正确 |
| 422 | 语义错误 | 打印 errors 数组，逐条说明 |
| 429 | 超出限流 | 等待 Retry-After 秒，最多重试 3 次 |
| 500/502/503 | 服务端错误 | 等待 5 秒重试，最多 2 次；失败则报告服务不可用 |
| 网络超时 | 连接问题 | 重试一次，超时阈值 30 秒 |

**401 详细诊断**
```
认证失败（401）。排查顺序：
1. Token 是否过期 → 检查创建时间和有效期设置
2. Token scope 是否不足 → 当前操作需要：{required_scopes}
3. Authorization 头格式 → 该服务使用 Bearer / Basic / 无前缀？
4. 环境变量是否生效 → 运行 echo ${TOKEN_VAR_NAME} 确认

当前 token 前缀：{token[:8]}...
```

### Step 6：链式调用

多个 API 调用时，明确依赖关系：

```
示例：从 GitHub Issue 获取内容 → 翻译 → 发送到 Slack

[并行] Step 1a: GitHub GET /repos/{owner}/{repo}/issues/{n}
               → 提取 title, body, labels
       Step 1b: GitHub GET /repos/{owner}/{repo}/issues/{n}/comments
               → 提取评论列表

[依赖 1a] Step 2: 翻译 API POST（如需）
               → 输入 body，输出中文

[依赖 2] Step 3: Slack POST /chat.postMessage
               → 发送格式化消息
```

独立步骤并行执行；有依赖的步骤等上一步完成后执行，显式传入上一步的输出字段。

---

## 输出格式

```
## API 调用结果

服务：{service_name}
操作：{GET/POST} {endpoint}
状态：成功（200）/ 失败（{状态码}：{错误描述}）

### 响应数据
{结构化 JSON，超过 100 条记录时截断并标注 "总计 N 条，显示前 20 条"}

### 统计
- 总记录数：{n}
- 分页次数：{n} 次请求
- 耗时：{ms}ms

### 后续建议（如适用）
{基于返回数据可以做的下一步操作}
```

---

## Gotchas

**飞书 API 的 token 有效期**
- `tenant_access_token` 有效期 2 小时，必须在每次调用前检查是否过期并刷新
- 刷新端点：`POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`
- 消息卡片必须用 JSON schema，不接受 Markdown 字符串

**GitHub 两套 API 的限流不同**
- REST API：认证用户 5000 req/hour；未认证 60 req/hour
- 搜索 API 独立限流：30 req/minute（认证）
- GraphQL API 更高效：单次可批量获取多个资源，推荐用于复杂查询

**Notion 内容结构**
- 页面内容是块（Block）树，不是平铺文本
- 获取页面内容需要递归调用 `GET /blocks/{id}/children`
- 数据库属性嵌套很深：`page.properties.{field}.{type}.{value}`

**GitHub 分页特殊性**
- 使用响应头 `Link` 中的 `rel="next"` URL，不是 cursor 参数
- 最后一页没有 `rel="next"`，以此判断终止

**写操作安全规则**
- POST/PUT/DELETE 操作不自动重试（可能造成重复提交）
- 写操作前展示将要执行的操作摘要，等待用户确认
- 不在错误消息中暴露含 token 的完整 URL
