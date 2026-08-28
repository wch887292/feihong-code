# Feihong Code (fhcode) — User Manual

**Version**: v7.6.0
**Date**: 2026-08-16
**Product**: Feihong Code (feihong-code) — a terminal AI coding agent (a Muse Code reimplementation)
**Attribution**: Jinjiang Feihongzhi Tech Enterprise Management Co., Ltd. · Feiyang Qiyuan R&D Center · Lead: Wu Cihong

---

## 1. Quick Start

### 1.1 Requirements

- Node.js ≥ 18 (20/22 recommended)
- npm ≥ 9
- git (needed for diff/rollback/parallel worktrees)
- Docker (only for `FH_SANDBOX_MODE=container`)

### 1.2 Installation

```bash
# Option A: build from source (recommended)
git clone https://github.com/wch887292/feihong-code.git
cd feihong-code
npm install
npm run build

# Option B: npm global install
npm install -g feihong-code
fhcode --version   # verify
```

### 1.3 Up and Running in Seconds

```bash
# Without a model configured, offline mode (Mock-driven loop) is used automatically
fhcode "write a hello.ts"

# Configure a real model (DeepSeek example) to go live
export FH_PROVIDERS='[{"name":"deepseek","type":"openai-compatible","baseUrl":"https://api.deepseek.com/v1","apiKey":"sk-...","tags":["code-gen","reasoning"],"priority":1}]'
fhcode "fix the token validation bug in src/auth.ts"
```

---

## 2. Command Reference

```bash
# Basics
fhcode                              Enter interactive REPL (TUI enabled on TTY)
fhcode "<request>"                  Run a single request
fhcode --stream "<request>"         Stream output (live task progress)
fhcode --yes "<request>"            Skip approvals (use with care)
fhcode --lang zh|en                 Set UI language

# Read-only skills
fhcode /plan "<goal>"               Generate an implementation plan
fhcode /grill [path]                Red-team code review (text)
fhcode review [path] [--json]       Structured code review (--json for IDE/CI)
fhcode /goal "<goal>"               Decompose and save a high-level goal

# Session management (M3)
fhcode sessions                     List historical sessions
fhcode resume <id>                  Resume from checkpoint
fhcode diff [id]                    Show session/workspace diff
fhcode rollback <id> --yes          Roll back session changes (destructive)

# Enterprise (M4)
fhcode whoami                       Current tenant/user/role/quota
fhcode policy                       Show active RBAC policy
fhcode audit [verify]               Audit records / hash-chain verification
fhcode tenants                      Tenant usage summary

# Self-evolution (M6/M8/M9)
fhcode model-stats                  Model performance stats
fhcode experiences [path]           Experience library
fhcode code-write "<goal>"          Autonomous coding
fhcode quality-gate [path]          Quality-gate review
fhcode self-improve                 Self-improvement stats
fhcode swe "<goal>"                 Fully autonomous SWE agent
fhcode team "<goal>"                Multi-agent collaboration (shared board + message bus)

# Ecosystem
fhcode skill-market search "<keyword>"   Search the skills marketplace (agentskills.io)
fhcode skill-market install <name>       Install a skill
fhcode skill-market list                 List local skills
fhcode plugin install <dir|git-url>      Install a plugin
fhcode plugin list                       List plugins
fhcode doctor                            Environment self-check
```

**Useful flags**: `--parallel` (parallel worktrees) / `--repo` (swe target repo / marketplace source) / `--context-file <path>` (attach a file as context) / `--max-iterations N` / `--max-retries N` / `--plan-only` / `--verify-only` / `--json`.

---

## 3. Model Configuration

### 3.1 Priority

1. `FH_PROVIDERS` (JSON array, highest priority)
2. `fhcode.config.json` (project config `models.providers`)
3. Single env vars `FH_MODEL_*`

### 3.2 Local Ollama

```bash
export FH_MODEL_NAME=qwen3:8b
export FH_MODEL_TYPE=ollama
export FH_MODEL_BASE_URL=http://localhost:11434
export FH_MODEL_TAGS=code-gen,reasoning,local
```

### 3.3 DeepSeek / Qwen

```bash
# DeepSeek
export FH_PROVIDERS='[{"name":"deepseek","type":"openai-compatible","baseUrl":"https://api.deepseek.com/v1","apiKey":"sk-...","tags":["code-gen","reasoning"],"costPer1k":0.0001}]'
# Qwen (Alibaba)
export FH_PROVIDERS='[{"name":"qwen","type":"openai-compatible","baseUrl":"https://dashscope.aliyuncs.com/compatible-mode/v1","apiKey":"...","tags":["code-gen","long-context"]}]'
```

### 3.4 Routing Strategy

```bash
export FH_MODEL_STRATEGY=cost        # cost | capability | latency
export FH_BUDGET_USD=0.5             # per-task cost cap (circuit breaker)
```
Providers tagged `cheap` are preferred for `swe`/parallel sub-tasks (P1-1 model split).

---

## 4. Typical Workflows

### 4.1 Single Task

```bash
fhcode "implement an HTTP server listening on port 3000"
# Streaming + attach a file as context
fhcode --stream --context-file src/auth.ts "review and fix the security issues in this file"
```

### 4.2 Fully Autonomous SWE (swe)

```bash
fhcode swe "fix the add function bug in src/calc.ts so tests/calc.test.ts passes" \
  --repo /path/to/project \
  --max-tasks 3 --max-iterations 5
# --plan-only / --verify-only / --max-retries N (self-heal retries)
```

### 4.3 Multi-Agent Collaboration (team)

```bash
fhcode team "implement a login module and a user management module and write integration tests"
# Goal auto-decomposed → agents claim concurrently → message bus reports → team report
```

### 4.4 Skills Marketplace & Plugins

```bash
fhcode skill-market search "code review"
fhcode skill-market install code-review     # auto-discovered in tasks after install
fhcode plugin install ./my-plugin           # packages skills+hooks+MCP
```

### 4.5 Session Resume & Rollback

```bash
fhcode sessions                 # find the session id
fhcode resume <id>              # continue after interruption
fhcode diff <id>                # inspect changes
fhcode rollback <id> --yes      # roll back (destructive)
```

### 4.6 Environment Self-Check

```bash
fhcode doctor
# ✅ Node version / git / model config / network / home dir / sandbox mode
```

---

## 5. REPL / TUI

```bash
fhcode          # interactive mode (TUI enabled automatically on TTY)
```
- TUI: sticky header shows mode/runId/iterations/cost/state; content scrolls; wheel to scroll back
- Type a request and press Enter; `exit`/`quit`/Ctrl+D to leave
- Slash skills supported: `/plan` `/grill` `/goal`

---

## 6. VSCode Extension

Package in `vscode-extension/` (`npx @vscode/vsce package`) or load via F5:

| Command | Description |
|---------|-------------|
| `fhcode: Run task (with selection context)` | Selected code auto-injected as `<selection>` context |
| `fhcode: Inline review current file` | `review --json` → inline diagnostics (red/yellow/blue) |
| `fhcode: View workspace diff` | Native diff editor HEAD↔workspace |
| `fhcode: Show recent task output` | Focus the Output Channel |

Settings: `fhcode.binaryPath` / `fhcode.offline` / `fhcode.reviewOnSave` (auto-review on save, default on).

---

## 7. Web Console (Cloud Execution)

```bash
fhcode serve --port 8080
# open http://localhost:8080 in a browser
```

**Task panel**: enter the token (printed by the terminal as `FH_WEB_TOKEN`) → submit a goal → poll status → expand result details.

**API usage** (Bearer auth):

```bash
TOKEN=$(echo $FH_WEB_TOKEN)
# submit a task
curl -X POST http://localhost:8080/api/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"goal":"write a hello.ts"}'
# query
curl http://localhost:8080/api/tasks -H "Authorization: Bearer $TOKEN"
curl http://localhost:8080/api/tasks/<id> -H "Authorization: Bearer $TOKEN"
# register a webhook (task-status callback, schedulable by CI)
curl -X POST http://localhost:8080/api/webhook \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://your-ci.example.com/hook"}'
```

---

## 8. Message Channels

```bash
# Telegram notifications (task status changes)
export FH_CHANNEL_TELEGRAM_BOT_TOKEN=bot:xxx
export FH_CHANNEL_TELEGRAM_CHAT_ID=12345
# WeCom group bot (multiple keys)
export FH_CHANNEL_WECOM_KEY=key1,key2
# Outbound allowlist (optional; once set, only allowlisted channels may send)
export FH_CHANNEL_ALLOW=telegram,wecom
```

---

## 9. Sandbox & Safe Usage

```bash
export FH_SANDBOX_MODE=workspace-write      # default
export FH_SANDBOX_MODE=read-only            # read-only survey (no writes/exec)
export FH_SANDBOX_MODE=danger-full-access   # full access (dangerous commands still blocked)
export FH_SANDBOX_MODE=container            # run shell inside a Docker container
export FH_SANDBOX_IMAGE=node:22-alpine      # container image

# Network domain rules
export FH_NETWORK_DENY=evil.example.com
# export FH_NETWORK_ALLOW=api.example.com

# Deterministic hooks (PreToolUse non-zero exit blocks)
export FH_HOOKS='[{"event":"PreToolUse","command":"node scripts/guard.js","tools":["run_shell"]}]'
```

---

## 10. eval Benchmark & Regression Gate

```bash
# Local benchmark (5 scenarios + 5 acceptance tasks, real-artifact verification)
npm run build && npm run eval

# Save baseline + compare gate (fails when below baseline; CI-ready)
node scripts/eval.mjs --save-baseline bench/eval-baseline.json
node scripts/eval.mjs --baseline bench/eval-baseline.json

# SWE-bench dataset loading (HF or mirror)
node scripts/eval-swebench.mjs --split lite --limit 5
node scripts/eval-swebench.mjs --split lite --limit 5 --run --report report.md
FH_SWEBENCH_DATA_URL=https://mirror.example/swebench.json node scripts/eval-swebench.mjs --limit 3
```

---

## 11. FAQ

| Problem | Solution |
|---------|----------|
| Real mode wanted without model config | Set `FH_PROVIDERS` or `FH_MODEL_NAME` to leave offline mode |
| Task aborted by cost cap | Raise `FH_BUDGET_USD` or role `maxCostUsd`, resume with `fhcode resume` |
| Quota rejected (QUOTA_EXCEEDED) | Adjust `FH_TENANT_BUDGET_USD` or policy `tenantDailyBudgetUsd` |
| review returns empty | Confirm the path is a file/dir with supported extensions (ts/js/tsx/jsx/json/md/py/go/java) |
| Marketplace fetch fails | Check network or set `FH_SWEBENCH_DATA_URL` / `--repo` mirror |
| Switch language | `fhcode --lang en` or `FHCODE_LANG=en` |

---

## 12. Troubleshooting & Logs

```bash
export FH_LOG_LEVEL=debug        # verbose logs
fhcode doctor                    # environment self-check
fhcode audit verify              # audit chain integrity
# Event logs: ~/.feihong-code/sessions/<runId>.jsonl
# Checkpoints: ~/.feihong-code/sessions/<runId>.session.json
```

---

*Full configuration reference: see Configuration Reference and Deployment Guide; error codes: see FAQ & Troubleshooting.*
