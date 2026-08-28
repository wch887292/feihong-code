# Feihong Code v7.0.0 Technical Specification

**Version**: 7.6.0
**Date**: August 24, 2026
**R&D Team**: Feihongzhi Technology Enterprise Management Co., Ltd. · Feiyang Qiyuan R&D Center

---

## 1. Product Overview

Feihong Code (feihong-code) is a terminal AI coding agent, benchmarked against Muse Code / Cursor CLI, supporting multi-model routing, enterprise-grade RBAC auditing, fully automated SWE Agent, and offline private deployment.

### 1.1 Core Capabilities

- Natural Language to Code Changes: Transform user requirements into real, verifiable code repository changes
- Multi-model Routing: Support DeepSeek, Tongyi Qianwen, Ollama, OpenAI, and other models
- Fully Automated SWE Agent: Autonomous planning, execution, verification, and fixing
- Enterprise-grade Security: RBAC permissions, audit logs, workspace isolation
- Full Platform Support: Web console, Electron desktop, CLI command line

### 1.2 Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 18+ |
| Language | TypeScript | 5.x |
| Web Framework | Express | 4.x |
| Data Validation | Zod | 3.x |
| Frontend | Native HTML/CSS/JS | - |
| Desktop | Electron | 41.x |
| Packaging | electron-builder | 26.x |
| Build | tsc | 5.x |

---

## 2. System Architecture

### 2.1 Overall Architecture

```
┌─────────────────────────────────────────────────┐
│                  User Interface Layer           │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │Web Console│  │ Desktop  │  │ CLI          │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
└───────┼─────────────┼───────────────┼──────────┘
        │             │               │
        └─────────────┼───────────────┘
                      │
              ┌───────▼───────┐
              │  Express API  │
              │  Service Layer│
              └───────┬───────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
  ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
  │Task Queue │ │Model Router│ │Audit      │
  │TaskQueue  │ │Router      │ │Security   │
  └─────┬─────┘ └─────┬─────┘ └───────────┘
        │             │
  ┌─────▼─────────────▼─────┐
  │    SWE Agent Layer       │
  │    Orchestrator          │
  └─────┬───────────────────┘
        │
  ┌─────▼───────────────────┐
  │    Tool Execution Layer  │
  │  File Ops / Shell / Browser│
  └─────────────────────────┘
```

### 2.2 Core Modules

#### 2.2.1 Agent Layer (src/agent/)

- **orchestrator.ts**: Core orchestrator, manages conversation loop, tool calls, error recovery
- **prompts.ts**: System prompts, defines AI behavior boundaries and capability requirements
- **self-heal.ts**: Self-healing module, error classification, fix suggestion generation
- **code-writer.ts**: Code generation module
- **swe-agent.ts**: SWE Agent implementation
- **experience.ts**: Experience retrieval and reuse

#### 2.2.2 Web Service Layer (src/web/)

- **server.ts**: Express service, API routes, static file serving
- **task-queue.ts**: Task queue, concurrency control, task persistence, state management
- **public/**: Frontend static assets (HTML/CSS/JS)

#### 2.2.3 CLI Layer (src/cli/)

- **index.ts**: CLI entry, command parsing
- **commands.ts**: Command implementation (serve/run/init etc.)
- **version.ts**: Centralized version definition
- **repl.ts**: Interactive REPL

#### 2.2.4 Desktop (electron/)

- **main.js**: Electron main process, window management, server startup, IPC communication
- **preload.js**: Preload script, safely exposes API to renderer process

#### 2.2.5 Local Speech Recognition (funasr-server/)

- **app.py**: FastAPI service, based on faster-whisper
- **requirements.txt**: Python dependencies
- **启动语音识别服务.bat**: Windows one-click startup

---

## 3. Core Mechanisms

### 3.1 Task Execution Flow

1. **Task Submission**: User submits task via Web/Desktop/CLI
2. **Task Enqueue**: TaskQueue receives task, sets status to queued
3. **Task Execution**: Picks up task under concurrency control, calls Orchestrator
4. **Orchestration Loop**: Orchestrator manages model calls, tool execution, result verification
5. **Error Recovery**: Continuous errors trigger self-heal, generate fix suggestions and retry
6. **Task Completion**: Result persisted, triggers webhook/notification

### 3.2 Conversation Flow Rendering

- **conversation**: Complete conversation history, limit 300 messages
- **steps**: Thinking chain steps, limit 500
- **Real-time Polling**: Frontend polls task status every 1 second
- **Pure Text Output**: Frontend stripMarkdown hard defense, strips all formatting symbols
- **Thinking Process Display**: Extract model.response content from steps for real-time display

### 3.3 Self-healing Mechanism

- **Error Classification**: 11 categories including compile-error / runtime-error / build-error / timeout
- **Continuous Error Detection**: Traverse all continuous error messages for classification recording
- **Fix Suggestion Generation**: Generate specific troubleshooting steps based on error type
- **Max Retries**: Default 3, configurable
- **Structured Report**: Error type + last error + fix suggestion + next step

### 3.4 Permissions and Security

- **RBAC Permissions**: Read scope, write permission, Shell permission, network permission, browser permission
- **Workspace Isolation**: File operations limited to workspace scope
- **Audit Logs**: All operations recorded to event-log
- **Security Approval**: Dangerous operations require user confirmation

---

## 4. API Interfaces

### 4.1 Core APIs

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Health check |
| POST | /api/auth/login | Login |
| GET | /api/tasks | Task list |
| POST | /api/tasks | Create task |
| GET | /api/tasks/:id | Task detail |
| POST | /api/tasks/:id/cancel | Cancel task |
| DELETE | /api/tasks/:id | Delete task |
| POST | /api/tasks/:id/continue | Continue task |
| GET | /api/models | Available model list |
| POST | /api/computer/screenshot | Computer screenshot |
| POST | /api/computer/mouse/move | Mouse move |
| POST | /api/computer/mouse/click | Mouse click |
| POST | /api/computer/keyboard/type | Keyboard type |
| POST | /api/computer/keyboard/press | Key press |

### 4.2 Local Speech Recognition API

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| POST | /api/recognize | Speech recognition (file upload) |
| POST | /api/recognize-bytes | Speech recognition (byte stream) |

---

## 5. Deployment

### 5.1 npm Global Install

```bash
npm install -g feihong-code
fhcode serve
```

### 5.2 Source Deployment

```bash
git clone https://github.com/wch887292/feihong-code.git
cd feihong-code
npm install
npm run build
node dist/cli/index.js serve
```

### 5.3 Desktop Version

```bash
# One-click startup
Double-click 一键启动桌面版.bat

# Or manual
npm run build
npm run electron
```

### 5.4 Local Speech Recognition Service

```bash
cd funasr-server
Double-click 启动语音识别服务.bat
# Service URL: http://localhost:8082
```

---

## 6. Configuration

### 6.1 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| FH_WEB_PORT | Web service port | 8080 |
| FH_WEB_TOKEN | Access token | Auto-generated |
| FH_HOME | Data directory | ~/.feihong-code |
| FH_TASK_CONCURRENCY | Task concurrency | 2 |
| FH_TASK_PERSIST_DIR | Task persistence dir | FH_HOME/tasks |
| FH_TASK_WEBHOOK_URL | Task webhook | - |

### 6.2 Model Configuration

Supports multi-model routing, configurable in Web console:
- DeepSeek (deepseek-chat / deepseek-coder)
- Tongyi Qianwen (qwen-turbo / qwen-max)
- Ollama (local models)
- OpenAI compatible interfaces

---

## 7. Extension Development

### 7.1 Add New Tool

Add tool definition under `src/agent/tools/`, following Zod schema specification.

### 7.2 Add New Skill

Create skill directory under workspace `.feihong/skills/`, containing SKILL.md and scripts.

### 7.3 Plugin System

Template library supports custom sources, connects to external plugin systems through nodes.

---

## 8. Performance Metrics

| Metric | Value |
|--------|-------|
| Startup Time | < 3 seconds |
| Task Concurrency | Default 2, configurable |
| Conversation History | 300 messages |
| Thinking Steps | 500 |
| Frontend Poll Interval | 1 second |
| Build Time | < 10 seconds |
| Desktop Memory | ~200MB |

---

## 9. Directory Structure

```
feihong-code/
├── src/                    # Source code
│   ├── agent/             # Agent core
│   ├── cli/               # CLI
│   ├── models/            # Model abstraction
│   ├── runtime/           # Runtime
│   ├── shared/            # Shared utilities
│   └── web/               # Web service
├── electron/              # Electron desktop
├── funasr-server/         # Local speech recognition
├── docs/                  # Documentation
├── dist/                  # Build output
├── package.json
├── tool-schema.json
└── README.md
```

---

*Feihongzhi Technology Enterprise Management Co., Ltd. · Feiyang Qiyuan R&D Center*
