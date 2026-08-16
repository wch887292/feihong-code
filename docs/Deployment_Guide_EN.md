# Feihong Code (fhcode) — Deployment Guide

**Version**: v0.5.0-b
**Date**: 2026-08-16
**Product**: Feihong Code (feihong-code) — a terminal AI coding agent (a Muse Code reimplementation)
**Attribution**: Jinjiang Feihongzhi Tech Enterprise Management Co., Ltd. · Feiyang Qiyuan R&D Center · Lead: Wu Cihong

---

## 1. Deployment Shapes

| Shape | Scenario | Components |
|-------|----------|------------|
| Standalone CLI | Personal dev / intranet terminal | fhcode CLI (Node.js) |
| Web service | Team sharing / cloud execution | fhcode serve + task queue |
| Docker | Containerized / private deployment | Dockerfile + docker-compose |
| Enterprise private | Multi-tenant / audit / quota | Enterprise mode (FH_ENTERPRISE) |
| IDE integration | In-editor usage | VSCode extension (thin shell) |

---

## 2. Requirements

| Item | Requirement | Notes |
|------|-------------|-------|
| Node.js | ≥ 18 (20/22 recommended) | Runtime |
| npm | ≥ 9 | Package manager |
| git | Recommended | diff/rollback/parallel worktrees |
| Docker | Optional | `FH_SANDBOX_MODE=container` and Docker deployment |
| Network | Optional | Real model APIs / skills marketplace / HF datasets (offline mode needs no internet) |

**Offline deployment notes**: without a model configured, offline mode (Mock-driven) is used automatically with zero external dependencies; model access can point to an intranet Ollama or a private OpenAI-compatible gateway.

---

## 3. Installation & Deployment

### 3.1 npm Global Install

```bash
npm install -g feihong-code
fhcode --version
```

### 3.2 From Source

```bash
git clone https://github.com/wch887292/feihong-code.git
cd feihong-code
npm install
npm run build          # tsc + Web static asset copy
npm test               # 164 unit tests self-check
node scripts/eval.mjs  # local benchmark self-check (10/10)
```

### 3.3 Docker Deployment (Web service)

```bash
# build image
docker build -t feihong-code .

# run the Web console (with task queue)
docker run -d --name fhcode \
  -p 8080:8080 \
  -e FH_WEB_TOKEN=<your-token> \
  -e FH_PROVIDERS='[{"name":"deepseek","type":"openai-compatible","baseUrl":"https://api.deepseek.com/v1","apiKey":"sk-...","tags":["code-gen"]}]' \
  -v fhcode-data:/root/.feihong-code \
  feihong-code
```

### 3.4 docker-compose (recommended)

```yaml
# docker-compose.yml
services:
  fhcode:
    build: .
    ports: ["8080:8080"]
    environment:
      FH_WEB_TOKEN: ${FH_WEB_TOKEN}
      FH_PROVIDERS: ${FH_PROVIDERS}          # model config
      FH_TASK_CONCURRENCY: "2"               # task concurrency cap
      FH_TASK_PERSIST_DIR: /data/tasks       # task persistence (resume after restart)
      FH_ENTERPRISE: "true"                  # enterprise mode
    volumes:
      - fhcode-data:/data
      - fhcode-home:/root/.feihong-code
volumes:
  fhcode-data:
  fhcode-home:
```

---

## 4. Environment Variable Reference (full)

### 4.1 App & Paths

| Variable | Default | Description |
|----------|---------|-------------|
| `FH_HOME` | `~/.feihong-code` | Home dir (sessions/audit/experience/stats/cache) |
| `FH_LOG_DIR` | `$FH_HOME/sessions` | Session log dir (`~` expansion supported) |
| `FH_CONFIG` | — | Config file path (fhcode.config.json) |
| `FHCODE_LANG` | system locale | UI language zh/en |

### 4.2 Model Routing

| Variable | Description |
|----------|-------------|
| `FH_PROVIDERS` | JSON array (highest priority): `{name,type,baseURL,apiKey,tags[],costPer1k}` |
| `FH_MODEL_NAME/TYPE/BASE_URL/API_KEY/TAGS/COST_PER_1K` | Quick single-var setup |
| `FH_MODEL_STRATEGY` | cost/capability/latency |
| `FH_BUDGET_USD` | Per-task cost cap (circuit breaker) |
| `FH_TENANT_BUDGET_USD` | Tenant daily cost cap (overrides policy) |

### 4.3 Security

| Variable | Description |
|----------|-------------|
| `FH_SANDBOX_MODE` | read-only / workspace-write / danger-full-access / container |
| `FH_SANDBOX_IMAGE` | container mode image (default node:22-alpine) |
| `FH_SHELL_ALLOW` | Shell allowlist (comma-separated) |
| `FH_REQUIRE_APPROVAL` | Approval switch (default true) |
| `FH_NETWORK_ALLOW/DENY` | Network domain rules (deny effective in all modes) |
| `FH_HOOKS` | Hooks JSON array (PreToolUse/PostToolUse/PostEdit) |
| `FH_POLICY` | Inline policy JSON (RBAC/blacklists, tighten-only) |

### 4.4 Enterprise Mode

| Variable | Description |
|----------|-------------|
| `FH_ENTERPRISE` | On by default (false reverts to community mode) |
| `FH_TENANT` | Tenant id (default: default) |
| `FH_USER` | User id |
| `FH_ROLE` | viewer/developer/operator/admin |

### 4.5 Web / Cloud Execution

| Variable | Description |
|----------|-------------|
| `FH_WEB_TOKEN` | Web console access token (auto-generated if unset) |
| `FH_WEB_PORT` | Port (default 8080) |
| `FH_TASK_CONCURRENCY` | Task concurrency cap (default 2) |
| `FH_TASK_PERSIST_DIR` | Task persistence dir (default `$FH_HOME/tasks`) |
| `FH_TASK_WEBHOOK_URL` | Task-status webhook (dynamically registrable) |

### 4.6 Message Channels

| Variable | Description |
|----------|-------------|
| `FH_CHANNEL_TELEGRAM_BOT_TOKEN/CHAT_ID` | Telegram notifications |
| `FH_CHANNEL_WECOM_KEY` | WeCom bot keys (comma-separated, multiple) |
| `FH_CHANNEL_ALLOW` | Outbound channel allowlist |

### 4.7 Marketplace / Benchmark

| Variable | Description |
|----------|-------------|
| `FH_SKILL_MARKET` | Skills marketplace source (default agentskills.io) |
| `FH_SWEBENCH_DATA_URL` | SWE-bench data mirror/offline JSON (intranet-friendly) |

---

## 5. Enterprise Private Deployment

### 5.1 Directory Layout (tenant isolation)

```
$FH_HOME/
├── tenants/<tenantId>/
│   ├── sessions/          # session checkpoints
│   ├── audit/             # audit hash chain (audit-YYYY-MM.jsonl)
│   └── goals/             # goal files
├── policy.json            # global policy (RBAC/blacklists)
├── experiences/           # experience library
├── model-stats.jsonl      # model stats
├── skills/                # user-level skills
├── plugins/               # user-level plugins
└── bench/                 # eval/SWE-bench cache & baselines
```

### 5.2 Production Recommendations

1. **Token management**: always set `FH_WEB_TOKEN` explicitly (auto-generated is session-only); inject via a secrets manager
2. **Audit compliance**: run `fhcode audit verify` periodically to validate hash-chain integrity; audit files are monthly-sharded for archiving
3. **Quota governance**: set `FH_TENANT_BUDGET_USD` for tenant daily budgets; tasks are fail-fast rejected when exceeded
4. **Backups**: back up `$FH_HOME` (sessions/audit/experience) daily; keep `FH_TASK_PERSIST_DIR` on a separate volume
5. **Multi-instance**: the task queue persists per file; instances sharing the persist dir cross-recover (queued re-enqueues, running zombies marked failed)
6. **Intranet models**: point `FH_PROVIDERS` at an intranet Ollama/private gateway to run fully offline

### 5.3 Security Baseline (production must)

```bash
export FH_REQUIRE_APPROVAL=true
export FH_SANDBOX_MODE=workspace-write     # or container
export FH_NETWORK_DENY=...                 # as needed
export FH_ENTERPRISE=true
export FH_CHANNEL_ALLOW=telegram,wecom     # channel allowlist (optional)
```

---

## 6. Web Service Operations

### 6.1 Start & Health Check

```bash
fhcode serve --port 8080
curl http://localhost:8080/api/health   # unauthenticated health check
```

### 6.2 Task Queue API (Bearer auth)

```bash
TOKEN=$FH_WEB_TOKEN
# submit / list / query / webhook register
curl -X POST http://localhost:8080/api/tasks -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"goal":"..."}'
curl http://localhost:8080/api/tasks -H "Authorization: Bearer $TOKEN"
curl http://localhost:8080/api/tasks/<id> -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:8080/api/webhook -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"url":"https://ci.example.com/hook"}'
```

### 6.3 Restart Recovery

- Tasks persist to `$FH_HOME/tasks/<id>.json` (atomic writes)
- After restart: queued tasks re-enqueue, running zombies are marked failed, terminal states remain queryable
- webhook/channel notifications re-fire on the queued node during recovery

---

## 7. CI/CD Integration (regression gate)

```yaml
# .github/workflows/ci.yml excerpt
- name: Build & test
  run: |
    npm ci
    npm run typecheck
    npm test
    npm run build

- name: eval regression gate (baseline compare)
  run: |
    npm run build
    node scripts/eval.mjs --baseline bench/eval-baseline.json
  # fails when current pass is below baseline

- name: Update baseline (main branch)
  if: github.ref == 'refs/heads/main'
  run: node scripts/eval.mjs --save-baseline bench/eval-baseline.json
```

### SWE-bench harness (optional)

```bash
node scripts/eval-swebench.mjs --split lite --limit 20 --run --report report.md
# offline/intranet: point FH_SWEBENCH_DATA_URL at a mirror JSON
```

---

## 8. Upgrades & Rollback

| Action | Command |
|--------|---------|
| Upgrade npm package | `npm install -g feihong-code@latest` |
| Upgrade from source | `git pull && npm install && npm run build` |
| Check version | `fhcode --version` / `fhcode doctor` |
| Rollback | npm install a previous version / git checkout an old tag (data dir is compatible and does not roll back with code) |

> Data compatibility: session checkpoints/audit/experience are JSON/JSONL text formats, backward compatible across minor versions; back up `$FH_HOME` before upgrading.

---

## 9. Troubleshooting

| Symptom | Diagnosis |
|---------|-----------|
| 401 after service start | `FH_WEB_TOKEN` unset or mismatched with the caller (Bearer header) |
| Tasks stuck queued | Concurrency full (`FH_TASK_CONCURRENCY`) or persist dir not writable |
| Model calls fail | Run `fhcode doctor` to check network reachability and provider config |
| Shell fails inside Docker | Confirm `FH_SANDBOX_MODE`/image; `FH_SANDBOX_IMAGE` must include required tools |
| Abnormal task states after restart | Running zombies are marked failed (expected); queued tasks auto-resume |
| Marketplace/dataset fetch fails | Use a mirror on intranet: `FH_SKILL_MARKET` / `FH_SWEBENCH_DATA_URL` |

---

*Full configuration: see Configuration Reference; error codes and detailed troubleshooting: see FAQ & Troubleshooting.*
