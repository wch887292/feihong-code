# Feihong Code (fhcode) — Technical Manual

**Version**: v0.5.0-b
**Date**: 2026-08-16
**Product**: Feihong Code (feihong-code) — a terminal AI coding agent (a Muse Code reimplementation)
**Attribution**: Jinjiang Feihongzhi Tech Enterprise Management Co., Ltd. · Feiyang Qiyuan R&D Center · Lead: Wu Cihong

---

## 1. Product Overview

Feihong Code (fhcode) is an AI coding agent that runs across terminal / Web / IDE surfaces, centered on the "natural language → code loop". It supports multi-model routing, enterprise-grade security, fully autonomous software engineering and self-improvement. It has zero third-party runtime dependencies (only express + zod), works offline, and can be privately deployed.

**Capability matrix (v0.5.0)**:

| Area | Capabilities |
|------|--------------|
| Orchestration | ReAct loop, planner, context compaction, checkpoint resume, cost circuit breaker, self-healing loop |
| Models | Multi-model routing (cost/capability/latency strategies + fallback + stats-based ranking), OpenAI-compatible / Ollama / Mock |
| Tools | File read/write/edit, search, managed shell, build check, test run, web retrieval, skill loading |
| Self-improvement | Experience library (RL-style upsert/recall), reflector feedback loop, self-healing, eval benchmark, SWE-bench harness |
| Security | Four-tier sandbox, network domain rules, deterministic hooks, RBAC, audit hash chain, quota circuit breaker, redaction, inbound signature verification |
| Ecosystem | SKILL.md skill standard, Skills marketplace (agentskills.io), MCP, plugin distribution, Agent teams |
| Delivery | CLI/TUI, Web console (task panel), VSCode extension, cross-process task queue, message channels |

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Access Layer                          │
│  CLI (index/run/repl/TUI) · Web (server/task-queue) · IDE ext │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                     Orchestration agent/                    │
│  Orchestrator(ReAct) · planner · repo-reader · swe-agent     │
│  subagent(nested) · team(message bus) · self-heal · experience│
│  quality-gate · code-writer · repo-context · symbol-index    │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
┌──────────────▼──────────────┐  ┌─────────────▼──────────────┐
│        Model Layer models/   │  │         Tool Layer tools/   │
│  ModelRouter(strategy+stats) │  │  file/search/shell/verify   │
│  OpenAICompatible/Ollama/Mock│  │  web(MCP) / skills(load)    │
│  sandbox(4 tiers+net rules)  │  │  tool.registry(zod+guard)   │
└──────────────┬──────────────┘  └─────────────┬──────────────┘
               │                               │
┌──────────────▼───────────────────────────────▼──────────────┐
│     Security enterprise/ + runtime/hooks                    │
│  tenant(multi-tenant) · policy(RBAC) · audit(hash chain)    │
│  guard · hooks(PreToolUse/PostEdit) · channels              │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│        Infrastructure shared/ + runtime/                    │
│  config(env-first) · i18n(zh/en) · logger(redacting JSON)   │
│  event-log(JSONL) · session-persist · git · worktree        │
└─────────────────────────────────────────────────────────────┘
```

**Module layout** (`src/`):

| Directory | Responsibility |
|-----------|----------------|
| `cli/` | Arg parsing, command dispatch, run assembly, REPL/TUI, version |
| `agent/` | Orchestrator, planner, SWE, subagents, teams, self-heal, experience, symbol index, repo context |
| `models/` | Model router, providers (OpenAI-compatible/Ollama/Mock), cost estimation, DTO validation |
| `tools/` | Tool system: file/search/shell/verify/web/MCP/skill loading/sandbox |
| `enterprise/` | Multi-tenancy, RBAC policy, audit chain, quota, guard |
| `runtime/` | Event log, session persistence, git helpers, worktree, hooks |
| `shared/` | Config, i18n, logger (redacting), error hierarchy, types |
| `skills/` | Skill standard (SKILL.md loading), skill marketplace (agentskills.io), /plan /grill /goal |
| `plugins/` | Plugin distribution (plugin.json packaging skills+hooks+MCP) |
| `web/` | Web console, task queue, message channels, inbound signature verification |

---

## 3. Core Modules

### 3.1 Orchestrator (agent/orchestrator.ts)

ReAct main loop `run(goal, resume?)`, per iteration:
1. `router.chat()` calls the model (with capability-tag routing)
2. No tool calls → task complete; otherwise `executeToolRound()` executes tools and feeds back tool messages
3. Error detection: `roundErrors > 0` → `handleRecovery()` (classify → inject reflection → retry, cap `maxRetryErrors`)
4. Context compaction: when `shouldCompact()` triggers, the system instruction is preserved (H4 fix)
5. Checkpoint persistence (`persist` callback) + event stream (`onEvent`, P0-1 streaming output)

**Event stream (P0-1)**: `OrchestratorEvent` discriminated union — model.response / tool.call / tool.result / self-heal / context.compact / session.end. The CLI stream renderer, TUI header driver and eval counters all consume the same event source.

**Cost circuit breaker (M4)**: `cost >= maxCostUsd` aborts immediately with a `resume` hint; `maxCostUsd=0` means unlimited.

**Experience feedback (M6)**: at session end, `extractExperience()` (table-driven EXTRACTORS) → `upsertExperience` (stable id merge, sessionCount accumulation, success-rate weighted average); self-healed sessions additionally persist `extractFixPattern`.

### 3.2 Model Router (models/model-router.ts)

- Strategies: `cost` (by costPer1k) / `latency` (local-first) / `capability` (tag-weighted)
- Ranking: `rank(tags)` capability filter + historical success-rate weight (≥3 calls, up to +0.3)
- Fallback: try in order; failures recorded under `p.model` (fix: no empty model-name entries); throw last error if all fail
- Stats: `updateStat()` auto-persists (`statsHomeDir`, P5 loop-closure fix); `model-stats` command reads them
- Sub-task split (P1-1): `tags: ['code-gen','cheap']` routes sub-tasks to low-cost models

### 3.3 Tool System (tools/)

- `ToolRegistry`: register/find/execute, zod argument validation, errors normalized to `ToolResult`
- Execution chain (defense in depth): **sandbox → PreToolUse hook → RBAC guard → tool → PostToolUse/PostEdit hook**
- Four-tier sandbox (P0-2/P5-4): `read-only` / `workspace-write` / `danger-full-access` / `container` (Docker-mount workspace for shell)
- Network domain rules: `FH_NETWORK_ALLOW/DENY` apply to run_shell command URLs and web tool URLs alike
- Hooks (P2-1): `FH_HOOKS` JSON array; PreToolUse non-zero exit blocks, PostEdit fires after edits; placeholders `{cwd}{tool}{path}{runId}{ok}`

### 3.4 SWE Agent (agent/swe-agent.ts + swe-planner + swe-verifier)

Repository read (`repo-reader`, throttled/ignored rules) → task decomposition (`planSweTask`) → per-task "implement (runSubTask) + verify (build/test) + self-heal retry" → report. Supports `--plan-only` / `--verify-only` / `--max-tasks` / `--max-retries`.

**Subagents (P3-4)**: `runSubAgent` depth control (default 3 levels); decomposable goals recursively spawn subagents (sub-directory isolation) when depth is not exhausted, with per-level summarized results (`summarizeSubTaskAnswer`, P2-2).

### 3.5 Agent Teams (agent/team.ts, P4-2)

- `TeamBus`: message bus (send/receive/broadcast, directed and fan-out)
- `TaskBoard`: shared task list (atomic claim to prevent duplicates, status+owner double check)
- `runTeam`: multiple agents claim and execute concurrently; `ok=false` marks failed (fix); produces a team report

### 3.6 Enterprise Security (enterprise/)

| Module | Mechanism |
|--------|-----------|
| tenant | Tenant-isolated directories (`tenants/<id>/{sessions,audit,goals}`) |
| policy | RBAC: role-tool matrix (viewer/developer/operator/admin) + denyShell blacklist + denyPaths sensitive paths, deny-first |
| audit | Hash chain (SHA-256, seq/prevHash linkage), cross-process file lock + exponential backoff, redaction before write, `audit verify` |
| quota | Tenant daily cost budget (`FH_TENANT_BUDGET_USD`), fail-fast live re-check before start (M14 fix) |
| guard | "Policy → approval → audit" pre-tool hook; audit failure = deny |

### 3.7 Skills & Marketplace (skills/)

- **SKILL.md standard (P1-2)**: frontmatter (name/description) + body; progressive disclosure — index (≤8KB) resident in system prompt, body loaded on demand via `load_skill` tool (Tier-2)
- Discovery: repo `.agents/skills` / `.claude/skills` upward walk + bundled `skills/` + user `~/.feihong-code/skills` + plugin skill dirs
- **Marketplace (P6)**: agentskills.io discovery spec (`/.well-known/agent-skills/index.json`); `skill-market search/install/list`; RFC 3986 URL resolution, sha256 digest verification, tar.gz unpack (zero-dep hand-written, path-traversal protected)
- **Plugins (P3-3)**: `plugin.json` packaging skills+hooks+MCP; user/project two-level discovery; `plugin install` (local dir/git clone)

### 3.8 Web & Cloud Execution (web/)

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Public health check (unauthenticated) |
| `POST/GET /api/tasks`, `GET /api/tasks/:id` | Task queue (Bearer auth, P4-1) |
| `POST/GET /api/webhook` | Webhook scheduling registration/query (P5-2) |
| other `/api/...` | Require `FH_WEB_TOKEN` Bearer (fail-closed, timing-safe comparison) |

**Task queue (P4-1/P6-4)**: state machine queued→running→done|failed; concurrency cap (`FH_TASK_CONCURRENCY`); cross-process persistence (`FH_TASK_PERSIST_DIR`, one file per task with atomic writes; on restart queued tasks re-enqueue, running zombies marked failed); webhook status callbacks (status snapshot, fixing the lost-queued race).

**Message channels (P5-6/O6)**: Telegram (`FH_CHANNEL_TELEGRAM_BOT_TOKEN`+`CHAT_ID`) and WeCom (`FH_CHANNEL_WECOM_KEY`, multiple keys) outbound push; outbound allowlist `FH_CHANNEL_ALLOW`; inbound signature tools `verifyHmacSignature` (HMAC-SHA256 timing-safe) / `verifyWecomSignature` (WeCom SHA1 sort).

### 3.9 IDE Extension (vscode-extension/)

Thin-shell design (all logic in the CLI): `fhcode.run` (selection context injection `<selection>`), `fhcode.review` (`review --json` → editor inline diagnostics via DiagnosticCollection + CodeAction suggestions), `fhcode.diff` (native diff editor HEAD↔workspace via `fhcode-head` scheme), `fhcode.output`; settings `binaryPath` / `offline` / `reviewOnSave`.

---

## 4. Protocols & Standards

| Protocol | Description |
|----------|-------------|
| Tool-call contract | OpenAI-style `tool_calls` (name/arguments JSON); results fed back as role=tool messages (toolCallId matched) |
| MCP | stdio transport (NDJSON JSON-RPC 2.0): initialize → notifications/initialized → tools/list → tools/call; tools registered as `<server>_<tool>` |
| SKILL.md | open agent skills compatible (frontmatter name/description + body, progressive disclosure) |
| agentskills.io | discovery index 0.2.0: `$schema` validation, skill-md/archive, digest `sha256:<hex>` |
| webhook | `POST {url}` JSON: `{event:'task.status', task:{...}, ts}` (status snapshot) |
| inbound signature | HMAC-SHA256 (`sha256=<hex>` header) or WeCom SHA1 sort |
| checkpoint | `<runId>.session.json` (full dialogue/iterations/cost/touchedFiles), resume continues |

---

## 5. Security Design

1. **Defense in depth**: sandbox (technical boundary) → hooks (deterministic control) → RBAC policy (permission) → audit (trace) → quota (cost)
2. **Sandbox**: four tiers + network domain rules (deny effective in all modes, allow blocks non-matching in workspace-write); `container` tier Docker isolation
3. **Command protection**: run_shell injection metacharacter blocking (`[;&|`$(){}<>!]` etc.); managed commands (run_tests/build_check) allow only package-manager scripts
4. **Path safety**: `safeJoin` (lexical + realpath symlink validation); policy denyPaths sensitive-path blacklist (.env/.git/config/keys etc.)
5. **Audit**: tamper-evident hash chain (`verifyAudit` checks seq/prevHash/hash); redaction before write (SECRET_RE/Bearer/JWT/sk-)
6. **Log redaction**: sensitive keys masked whole-value + value patterns (sk-/JWT/long tokens)
7. **Web auth**: Bearer token timing-safe comparison, fail-closed; 1MB body limit
8. **Inbound security**: webhook signature verification (HMAC/WeCom), channel allowlist
9. **Skill security**: marketplace digest verification against tampering, tar.gz path-traversal protection, mandatory name frontmatter

---

## 6. Performance & Quality Baseline (measured at v0.5.0-b)

| Metric | Value |
|--------|-------|
| Unit tests | 164/164 green (16 modules + 10 feature areas) |
| Milestone assertions | M4 41 · M6 29 · M7 12 · M8 27 · M9 25 = 134 green |
| eval benchmark | 10/10 (5 scenarios + 5 acceptance, real-artifact verification, 100% pass) |
| SWE-bench loader | HF datasets-server / mirror / cache, mock execution + report |
| Complexity | 676 functions, 52 hotspots with cc≥10 (core decision functions kept; rule-based ones table-driven) |
| Dependencies | Runtime only express + zod (no other runtime deps, offline-capable) |

---

## 7. Configuration Model (iron rule: all config from env, validated at startup, fail-fast)

Priority: `FH_PROVIDERS` (JSON) > `fhcode.config.json` > single env vars `FH_MODEL_*`; security lists (deny blacklists) are unions that can only be tightened. Full reference: see Configuration Reference and Deployment Guide.

---

## 8. Versioning & Roadmap

- v0.4.0: P0-P5 full capabilities (streaming/sandbox/MCP/Skills/plugins/cloud queue/channels/symbol index)
- v0.5.0 (released 2026-08-17): consolidates IDE deep integration first round (review --json + inline review + context input), SWE-bench harness integration (dataset loading + mock execution + report), eval regression gate, O6 inbound signature verification & security hardening
- Planned v0.5.0-c/d: containerized SWE execution + real-model benchmark; inbound channel scheduling (see planning doc)

---

*This manual is updated with each release; capabilities are authoritative in the source code and `fhcode --help`.*
