# 飞虹 Code v7.0.0 技术说明书

**版本**：7.6.0
**日期**：2026年8月24日
**研发团队**：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心

---

## 1. 产品概述

飞虹 Code（feihong-code）是一款终端 AI 编程智能体，对标 Muse Code / Cursor CLI，支持多模型路由、企业级 RBAC 审计、全自动 SWE Agent，支持离线私有化部署。

### 1.1 核心能力

- 自然语言到代码变更：将用户需求转化为真实、可验证的代码仓库变更
- 多模型路由：支持 DeepSeek、通义千问、Ollama、OpenAI 等多种模型
- 全自动 SWE Agent：自主规划、执行、验证、修复
- 企业级安全：RBAC 权限、审计日志、工作区隔离
- 全平台支持：Web 控制台、Electron 桌面版、CLI 命令行

### 1.2 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 运行时 | Node.js | 18+ |
| 语言 | TypeScript | 5.x |
| Web 框架 | Express | 4.x |
| 数据校验 | Zod | 3.x |
| 前端 | 原生 HTML/CSS/JS | - |
| 桌面端 | Electron | 41.x |
| 打包 | electron-builder | 26.x |
| 构建 | tsc | 5.x |

---

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────┐
│                   用户界面层                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Web 控制台 │  │ 桌面版    │  │ CLI 命令行   │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
└───────┼─────────────┼───────────────┼──────────┘
        │             │               │
        └─────────────┼───────────────┘
                      │
              ┌───────▼───────┐
              │  Express API  │
              │  服务层        │
              └───────┬───────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
  ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
  │ 任务队列   │ │ 模型路由   │ │ 权限审计   │
  │ TaskQueue │ │ Router    │ │ Security  │
  └─────┬─────┘ └─────┬─────┘ └───────────┘
        │             │
  ┌─────▼─────────────▼─────┐
  │    SWE Agent 编排层      │
  │    Orchestrator          │
  └─────┬───────────────────┘
        │
  ┌─────▼───────────────────┐
  │    工具执行层            │
  │  文件操作 / Shell / 浏览器│
  └─────────────────────────┘
```

### 2.2 核心模块

#### 2.2.1 Agent 编排层（src/agent/）

- **orchestrator.ts**：核心编排器，管理对话循环、工具调用、错误恢复
- **prompts.ts**：系统提示词，定义 AI 行为边界和能力要求
- **self-heal.ts**：自我修复模块，错误分类、修复建议生成
- **code-writer.ts**：代码生成模块
- **swe-agent.ts**：SWE Agent 实现
- **experience.ts**：经验检索与复用

#### 2.2.2 Web 服务层（src/web/）

- **server.ts**：Express 服务，API 路由、静态文件服务
- **task-queue.ts**：任务队列，并发控制、任务持久化、状态管理
- **public/**：前端静态资源（HTML/CSS/JS）

#### 2.2.3 CLI 层（src/cli/）

- **index.ts**：CLI 入口，命令解析
- **commands.ts**：命令实现（serve/run/init 等）
- **version.ts**：版本号集中定义
- **repl.ts**：交互式 REPL

#### 2.2.4 桌面端（electron/）

- **main.js**：Electron 主进程，窗口管理、服务器启动、IPC 通信
- **preload.js**：预加载脚本，安全暴露 API 给渲染进程

#### 2.2.5 本地语音识别（funasr-server/）

- **app.py**：FastAPI 服务，基于 faster-whisper
- **requirements.txt**：Python 依赖
- **启动语音识别服务.bat**：Windows 一键启动

---

## 3. 核心机制

### 3.1 任务执行流程

1. **任务提交**：用户通过 Web/桌面/CLI 提交任务
2. **任务入队**：TaskQueue 接收任务，设置状态为 queued
3. **任务执行**：并发控制下取出任务，调用 Orchestrator
4. **编排循环**：Orchestrator 管理模型调用、工具执行、结果验证
5. **错误恢复**：连续错误触发 self-heal，生成修复建议并重试
6. **任务完成**：结果持久化，触发 webhook/通知

### 3.2 对话流渲染机制

- **conversation**：完整对话历史，上限 300 条
- **steps**：思维链路步骤，上限 500 条
- **实时轮询**：前端每 1 秒轮询任务状态
- **纯文本输出**：前端 stripMarkdown 硬防线，剥离所有格式符号
- **思考过程展示**：从 steps 中提取 model.response 内容实时显示

### 3.3 自我修复机制

- **错误分类**：compile-error / runtime-error / build-error / timeout 等 11 类
- **连续错误检测**：遍历所有连续错误消息分类记录
- **修复建议生成**：基于错误类型生成具体排查步骤
- **最大重试次数**：默认 3 次，可配置
- **结构化报告**：错误类型 + 最后错误 + 修复建议 + 下一步操作

### 3.4 权限与安全

- **RBAC 权限**：读范围、写权限、Shell 权限、网络权限、浏览器权限
- **工作区隔离**：文件操作限制在工作区范围内
- **审计日志**：所有操作记录到 event-log
- **安全审批**：危险操作需要用户确认

---

## 4. API 接口

### 4.1 核心 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查 |
| POST | /api/auth/login | 登录 |
| GET | /api/tasks | 任务列表 |
| POST | /api/tasks | 创建任务 |
| GET | /api/tasks/:id | 任务详情 |
| POST | /api/tasks/:id/cancel | 取消任务 |
| DELETE | /api/tasks/:id | 删除任务 |
| POST | /api/tasks/:id/continue | 继续任务 |
| GET | /api/models | 可用模型列表 |
| POST | /api/computer/screenshot | 电脑截图 |
| POST | /api/computer/mouse/move | 鼠标移动 |
| POST | /api/computer/mouse/click | 鼠标点击 |
| POST | /api/computer/keyboard/type | 键盘输入 |
| POST | /api/computer/keyboard/press | 按键 |

### 4.2 本地语音识别 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /health | 健康检查 |
| POST | /api/recognize | 语音识别（文件上传） |
| POST | /api/recognize-bytes | 语音识别（字节流） |

---

## 5. 部署方式

### 5.1 npm 全局安装

```bash
npm install -g feihong-code
fhcode serve
```

### 5.2 源码部署

```bash
git clone https://github.com/wch887292/feihong-code.git
cd feihong-code
npm install
npm run build
node dist/cli/index.js serve
```

### 5.3 桌面版

```bash
# 一键启动
双击 一键启动桌面版.bat

# 或手动
npm run build
npm run electron
```

### 5.4 本地语音识别服务

```bash
cd funasr-server
双击 启动语音识别服务.bat
# 服务地址：http://localhost:8082
```

---

## 6. 配置说明

### 6.1 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| FH_WEB_PORT | Web 服务端口 | 8080 |
| FH_WEB_TOKEN | 访问令牌 | 自动生成 |
| FH_HOME | 数据目录 | ~/.feihong-code |
| FH_TASK_CONCURRENCY | 任务并发数 | 2 |
| FH_TASK_PERSIST_DIR | 任务持久化目录 | FH_HOME/tasks |
| FH_TASK_WEBHOOK_URL | 任务 Webhook | - |

### 6.2 模型配置

支持多模型路由，可在 Web 控制台配置：
- DeepSeek（deepseek-chat / deepseek-coder）
- 通义千问（qwen-turbo / qwen-max）
- Ollama（本地模型）
- OpenAI 兼容接口

---

## 7. 扩展开发

### 7.1 新增工具

在 `src/agent/tools/` 下新增工具定义，遵循 Zod schema 规范。

### 7.2 新增技能

在工作区 `.feihong/skills/` 下创建技能目录，包含 SKILL.md 和脚本。

### 7.3 插件系统

模板库支持自定义来源，通过节点连接外部插件系统。

---

## 8. 性能指标

| 指标 | 数值 |
|------|------|
| 启动时间 | < 3 秒 |
| 任务并发 | 默认 2，可配置 |
| 对话历史 | 300 条 |
| 思维步骤 | 500 条 |
| 前端轮询间隔 | 1 秒 |
| 构建时间 | < 10 秒 |
| 桌面版内存 | ~200MB |

---

## 9. 目录结构

```
feihong-code/
├── src/                    # 源码
│   ├── agent/             # Agent 核心
│   ├── cli/               # CLI 命令行
│   ├── models/            # 模型抽象
│   ├── runtime/           # 运行时
│   ├── shared/            # 共享工具
│   └── web/               # Web 服务
├── electron/              # Electron 桌面端
├── funasr-server/         # 本地语音识别服务
├── docs/                  # 文档
├── dist/                  # 构建输出
├── package.json
├── tool-schema.json
└── README.md
```

---

*晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心*
