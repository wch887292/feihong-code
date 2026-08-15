# Feihong Code (fhcode)

> **Terminal AI Coding Agent** · Inspired by Meta Muse Code · Full M0→M9.1 complete · Enterprise RBAC / Audit / SWE Agent
> Jinjiang Feihongzhi Technology Enterprise Management Co., Ltd. · Feiyang Qiyuan R&D Center · Lead: Wu Cihong

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://typescriptlang.org)
[![GitHub stars](https://img.shields.io/github/stars/wch887292/feihong-code?style=social)](https://github.com/wch887292/feihong-code/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/wch887292/feihong-code)](https://github.com/wch887292/feihong-code/issues)
[![npm version](https://img.shields.io/npm/v/feihong-code.svg)](https://www.npmjs.com/package/feihong-code)
[![npm downloads (monthly)](https://img.shields.io/npm/dm/feihong-code.svg)](https://www.npmjs.com/package/feihong-code)
[![npm downloads (total)](https://img.shields.io/npm/dt/feihong-code.svg)](https://www.npmjs.com/package/feihong-code)
[![CI Status](https://github.com/wch887292/feihong-code/actions/workflows/ci.yml/badge.svg)](https://github.com/wch887292/feihong-code/actions)

> 中文: [README.md](README.md)

**🔍 Keywords**: AI Agent · Code Generation · SWE Agent · CLI · Multi-model Routing · Enterprise RBAC · Offline-ready

**📦 One-line install**: `npm install -g feihong-code` · China mirror: `npm install -g feihong-code --registry=https://registry.npmmirror.com`
**🚀 5-minute quick start**: `fhcode --version` → `fhcode chat` (offline mode works with no API key)

---

## 🌐 Brand & Official Site

This project is developed and maintained by **Jinjiang Feihongzhi Technology Enterprise Management Co., Ltd. · Feiyang Qiyuan R&D Center**, and is a core component of the Feihongzhi klAI open-source ecosystem.

- 🏠 **Official site**: [https://www.klai.top](https://www.klai.top) — Feihongzhi klAI · Quanzhou manufacturing-AI service provider
- 📦 **Open-source matrix**: [https://www.klai.top/opensource.html](https://www.klai.top/opensource.html)
- 🤖 **AI Agent portal**: [https://www.klai.top/openclaw.html](https://www.klai.top/openclaw.html)

---

## 0. For AI Agents

fhcode is purpose-built for AI agents, exposing a structured CLI and explicit tool contracts. See [`AGENT-GUIDE.md`](./AGENT-GUIDE.md) and [`tool-schema.json`](./tool-schema.json).

**Quickly assess whether fhcode fits your agent**:
```bash
fhcode --help                    # list all commands
fhcode "your goal"              # single-task execution
fhcode --parallel "goal A and goal B"  # parallel subtasks
fhcode swe "fix issue Y in repo X"     # fully autonomous software engineering
```

**Recommended config (production)**:
```bash
export FH_MODEL_NAME=qwen3:8b
export FH_MODEL_TYPE=ollama
export FH_MODEL_BASE_URL=http://localhost:11434
export FH_ENTERPRISE=true
export FH_TENANT=my-org
export FH_USER=agent-sa
export FH_ROLE=developer
```

---

## 1. Product Positioning

**Feihong Code (fhcode)** is a **terminal AI coding agent** inspired by Meta Muse Code: describe requirements in natural language, and the agent autonomously completes the closed loop of **planning → read/write code → run verification → report results**.

**🎯 Use cases**:
- Code generation and modification (functions, modules, full features)
- Batch refactoring and code review
- Offline scripting tasks and automation workflows
- A shared agent foundation for multiple teams within an enterprise
- Fully autonomous software engineering (SWE Agent): read repo → decompose task → implement + test verification → report

- Not bound to any single LLM vendor — a **multi-model routing layer** dispatches on demand across DeepSeek / Tongyi (Qwen) / Ollama (local) / any OpenAI-compatible gateway.
- All behavior uses an **append-only event log** as the single source of truth — fully auditable and recoverable.
- Follows a **safety & compliance baseline**: file sandbox, shell allowlist, secret redaction, dangerous-action approval.
- **M2 parallel sub-agents**: physical isolation of multiple sub-agent workspaces via `git worktree`, concurrent progress without interference.

---

### 🆚 Comparison with other tools

| Capability | **fhcode** | Claude Code | Cursor CLI | Aider | OpenCode |
|---|---|---|---|---|---|
| Native terminal CLI | ✅ | ✅ | ⚠️ (in-editor) | ✅ | ✅ |
| Multi-model routing (DeepSeek/Tongyi/Ollama/OpenAI) | ✅ | ❌ (Anthropic only) | ⚠️ | ⚠️ | ✅ |
| Offline / on-prem (data stays in intranet) | ✅ (local Ollama) | ❌ | ❌ | ⚠️ | ✅ |
| Enterprise RBAC / audit chain | ✅ | ❌ | ❌ | ❌ | ❌ |
| Fully autonomous SWE Agent (M0→M9.1) | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| Parallel sub-agents (M2) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Self-evolution (M6) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Open-source / self-hostable (MIT) | ✅ | ❌ | ❌ | ✅ Apache-2.0 | ✅ MIT |

> Best for: teams and individual developers who need **data to stay in the intranet**, require **enterprise permission auditing**, and want to **mix multiple LLM vendors**.

## 2. Core Features

### 🔥 Highlights
- ✅ **Natural language → code closed loop**: describe needs, auto-invoke tools to edit code and verify
- ✅ **Multi-model routing**: DeepSeek / Tongyi / Ollama / OpenAI-compatible gateways, auto-select + fallback
- ✅ **Offline-ready**: full closed loop demo with no API key (built-in Mock driver)
- ✅ **Enterprise security**: RBAC permission matrix, tamper-proof audit chain, multi-tenant isolation, quota circuit-breaker
- ✅ **Fully autonomous SWE Agent**: read repo → decompose → implement + test verification → self-heal retry → report

### 🛠️ Feature Matrix
| Milestone | Capability | Status |
|--------|------|------|
| **M0-M1** | CLI basics, model routing, file/shell tools, offline closed loop | ✅ Done |
| **M2** | Parallel sub-agents (git worktree isolation) + `/plan` `/grill` `/goal` skills | ✅ Done |
| **M3** | Session recovery, diff/rollback, interactive approval flow | ✅ Done |
| **M4** | RBAC permissions, hash-chain audit, multi-tenant, quota governance, 3 CI pipelines | ✅ Done |
| **M5** | Web admin console (BETA) | ✅ BETA |
| **M6** | Self-heal loop, context compression, experience learning, model performance tracking | ✅ Done |
| **M7** | Static code analysis, templated generation, AI code review, repo understanding, test generation | ✅ Done |
| **M8** | CodeWriter six-step loop, QualityGate, SelfImprover | ✅ Done |
| **M9** | Fully autonomous software-engineering Agent (swe command) | ✅ Done |
| **M9.1** | Real model integration (3-tier provider resolution), exec discipline hardening | ✅ Done |

### 🌟 Technical Highlights
- **Zero framework intrusion**: only depends on `express` + `zod`
- **Full TypeScript type safety**: `tsc --noEmit` zero errors
- **Complete test coverage**: 27+ unit tests, 41+ assertions for the M4 enterprise suite
- **CI/CD ready**: GitHub Actions 3 pipelines (build/enterprise/security), runnable with zero Secrets
- **Docker multi-stage build**: containerized deployment supported

---

## 3. Installation

### Option A: Build from source (recommended for dev / intranet)

```bash
git clone https://github.com/wch887292/feihong-code.git
cd feihong-code
npm install
npm run build              # compile to dist/
node dist/cli/index.js --version
```

Or one-line install (script provided):
```bash
bash install.sh
```

### Option B: Global install (published to npm)

```bash
# official registry
npm install -g feihong-code
# China mirror (faster)
npm install -g feihong-code --registry=https://registry.npmmirror.com
fhcode --version           # call the bin directly (on Windows: fhcode.cmd)
# Alias package also supported: npm install -g feihong-cli (same source, same bin fhcode)
```

> Requires Node.js >= 18. The entry `dist/cli/index.js` already carries the `#!/usr/bin/env node` shebang.
> Source and issue tracking have migrated to the GitCode mirror: <https://gitcode.com/gcw_YuRlTP0G/feihong-code>

### Option C: Docker

```bash
docker build -t feihong-code .
docker run --rm feihong-code --version
# mount secret and log volumes to enable real models:
docker run --rm -v "$PWD/.env:/app/.env" -v feihong-data:/data/feihong-code feihong-code "your requirement"
```

---

## 4. Quick Start

### 4.1 Offline mode (no API key needed)

```bash
node dist/cli/index.js "write a hello.ts and print a sentence"
```

When `FH_PROVIDERS` is not configured, the built-in Mock driver runs the full closed loop (plan → call tools to write files → summarize).

### 4.2 Connect a real LLM

```bash
cp .env.example .env
# edit .env, fill in FH_PROVIDERS (baseURL / apiKey / model, etc.)
fhcode "extract the date formatting in src/utils into a standalone module and add tests"
```

Example real config (verified Agnes gateway):
```json
FH_PROVIDERS='[{"id":"agnes","type":"openai-compatible","baseURL":"https://api.agnes-ai.cn/v1","apiKey":"<your-key>","model":"agnes-2.5-flash","tags":["code-gen"],"costPer1k":0.001}]'
```

### 4.3 Parallel sub-agents

```bash
fhcode --parallel "implement login module AND add user management AND write integration tests"
```

Auto-splits into 3 subtasks, each running concurrently in an isolated `git worktree` workspace, cleaned up afterward.

> ⚠️ **Parallel concurrency quota**: `--parallel` fires concurrent API calls. Free tiers (e.g. Agnes free) strictly rate-limit concurrency (HTTP 429), which may fail subtasks. Suggestions: ① upgrade the API plan; ② use single-command mode for large goals sequentially; ③ or verify the parallel mechanism with `FH_OFFLINE=true fhcode --parallel "..."` (offline, no quota used).

### 4.4 Interactive REPL

```bash
fhcode            # enter REPL without args, input requirements line by line; exit to quit
```

### 4.5 Read-only skills (no code changes)

```bash
fhcode /plan  "implement login AND add payment AND write reports"   # generate implementation plan
fhcode /grill src                              # red-team style code review
fhcode /goal  "build multi-sub-agent system AND improve docs"       # decompose and save goals
```

### 4.6 Recovery & Audit (M3)

Every task persists the **full conversation, iteration count, cost, and changed files** as a session checkpoint (`<runId>.session.json`), recoverable and auditable at any time:

```bash
fhcode sessions                                  # list historical sessions (status/iterations/cost/file count)
fhcode resume <id>                              # resume an interrupted task from checkpoint (offline or real)
fhcode diff <id>                                # show changes of that session relative to baseline (session scope)
fhcode rollback <id> --yes                      # roll back changes produced by that session (dangerous, requires --yes)
```

- `resume`: after interruption (process crash / max iterations reached), load checkpoint, rebuild conversation, continue ReAct loop until final result.
- `diff`: generate git diff only for **this session's touchedFiles** (untracked files shown via `--no-index`), never the whole repo.
- `rollback`: tracked files `git checkout --`, untracked files deleted directly; **refuses execution without confirmation (--yes) or outside a git repo** to avoid accidental deletion.

> Session id supports 8-char prefix (the prefix shown in the `sessions` list), no full uuid needed.
> Offline mode sessions land in a temp dir with an independent git workspace, also supporting full diff / rollback demos.

### 4.7 Interactive Approval (M3)

When `FH_REQUIRE_APPROVAL=true` (default), dangerous operations require approval:

- **TTY interactive terminal**: prompts `y/n` per action at runtime (`run_shell`, file writes, etc. must be explicitly approved).
- **Non-interactive (CI / pipe)**: falls back to allowlist approver when no TTY — commands hitting `FH_SHELL_ALLOW` auto-pass, others rejected and logged.

```bash
fhcode "delete temp cache and rebuild"      # TTY asks per shell command; non-TTY only allowlisted commands pass
```

### 4.8 Enterprise capabilities: permissions / audit / multi-tenant / quota (M4)

Enterprise mode is **on by default** (`FH_ENTERPRISE=false` disables it and degrades to M3 behavior). Identity is injected via environment variables, convenient for container/gateway delivery:

```bash
export FH_TENANT=acme        # tenant ID (default: default)
export FH_USER=wuchihong     # user identifier (default: system username)
export FH_ROLE=developer     # viewer | developer | operator | admin

fhcode whoami                # current tenant/user/role/isolation dir/today's usage
fhcode policy                # effective RBAC policy and four-role matrix
fhcode audit --limit 20      # audit records (last 20 by default)
fhcode audit verify          # verify audit hash-chain integrity
fhcode tenants               # all tenants' usage summary (sessions/cost/audit count)
```

**① Permissions (RBAC + deny-first)**

| Role | Directly allowed | Requires approval | Per-task cap |
| --- | --- | --- | --- |
| `viewer` | `read_file` `list_dir` `grep` | — | $0.1 |
| `developer` | above + `write_file` `edit_file` `run_tests` `build_check` | `run_shell` | $1 |
| `operator` | all | `run_shell` | $5 |
| `admin` | all | `run_shell` | unlimited |

Judgment order: **dangerous-command blacklist → sensitive-path blacklist → sandbox boundary → role matrix → shell allowlist**. The first three are **deny-first, admin cannot bypass**: 23 dangerous commands like `rm -rf /`, `mkfs`, `curl | sh`, and 11 sensitive paths like `.env`, `.ssh/id_rsa`, `.npmrc`, `.kube/config` are always rejected and logged.

Policy can be overridden via `policy.json` (global `<FH_HOME>/policy.json` → tenant `<tenant dir>/policy.json` → `FH_POLICY` inline JSON), **blacklists union, can only tighten not loosen**.

**② Audit (tamper-proof hash chain)**

Each audit record carries `prevHash` and its own `sha256`, forming a chain; any rewrite, deletion, or insertion breaks the chain:

```bash
$ fhcode audit verify
✅ Audit chain intact: 3 records, hash chain self-consistent, unmodified.
# If tampered:
❌ Audit chain verification failed: 5 records total, break at record 3
   Content tampered: hash inconsistent (expected 8b3a6990664e…)
```

Record content is auto-redacted (`apiKey=` / `Bearer` / `sk-xxx` → `***`); if audit write fails, **tool execution is uniformly rejected** — rather not do it than do it without a trace.

**③ Multi-tenant (physical directory isolation)**

```
<FH_HOME>/tenants/<tenantId>/
├── sessions/     session checkpoints and event logs
├── audit/        audit chain (split by month audit-YYYY-MM.jsonl)
├── goals/        /goal artifacts
└── policy.json   tenant-level policy override (optional)
```

Tenant ID validated by `^[A-Za-z0-9._-]{1,64}$` to prevent `../` traversal; `sessions` / `audit` / `goals` are completely invisible across tenants. Default tenant auto-inherits when an old-version dir exists, so upgrade loses no history.

**④ Quota (cost circuit-breaker)**

- **Per task**: exceeds the role's `maxCostUsd` immediately aborts; raise it then `resume` to continue.
- **Tenant daily budget**: `FH_TENANT_BUDGET_USD` (or policy `tenantDailyBudgetUsd`) fail-fasts before task start, **incurring no model cost**:

```bash
$ FH_TENANT_BUDGET_USD=0.30 fhcode "over-budget task"
[Feihong Code] Run failed (QUOTA_EXCEEDED): tenant acme today's cost $0.420000 reached cap $0.3, task rejected.
```

---

## 5. Command Reference

| Command | Description |
| --- | --- |
| `fhcode` | Enter interactive REPL (requirements line by line) |
| `fhcode "<req>"` | Single-command mode executes one requirement |
| `fhcode --parallel "<req>"` | Parallel sub-agents (git worktree isolation) |
| `fhcode /plan "<goal>"` | Generate structured implementation plan (read-only) |
| `fhcode /grill [path]` | Red-team code review (read-only, current dir by default) |
| `fhcode /goal "<goal>"` | Decompose and save high-level goals to `~/.feihong-code/goals` |
| `fhcode sessions` | List historical session checkpoints (status/iterations/cost/file count) |
| `fhcode resume <id>` | Resume and continue an interrupted task from checkpoint |
| `fhcode diff [<id>]` | Show session-scope (or current workspace) changes |
| `fhcode rollback <id> [--yes]` | Roll back session changes (dangerous, requires `--yes`) |
| `fhcode whoami` | Current tenant / user / role / isolation dir / today's usage (M4) |
| `fhcode policy` | View effective RBAC policy and role matrix (M4) |
| `fhcode audit [--limit N]` | View audit records, last 20 by default (M4) |
| `fhcode audit verify` | Verify audit hash-chain integrity (M4) |
| `fhcode tenants` | List all tenants and usage summary (M4) |
| `fhcode model-stats` | View per-model performance stats (M6) |
| `fhcode experiences` | List experience library (M6) |
| `fhcode code-write "<goal>"` | Autonomous code writing: plan→write→test→review→fix (M8) |
| `fhcode quality-gate [path]` | Quality-gate review: security+quality+test coverage (M8) |
| `fhcode self-improve` | Self-improvement stats and history (M8) |
| `fhcode swe "<goal>"` | Fully autonomous SWE Agent: read repo→decompose→implement+verify+self-heal→report (M9, supports `--max-iterations` etc.) |
| `fhcode --version` / `-v` | Show version and attribution |
| `fhcode --help` / `-h` | Show help |

> Offline mode automatically when `FH_PROVIDERS` (or `FH_OFFLINE=true`) is not configured.

---

## 6. Tool System

| Category | Tool | Description |
| --- | --- | --- |
| File | `read_file` / `write_file` / `edit_file` / `list_dir` | Sandboxed read/write, prevents `../` traversal |
| Search | `grep` | Recursive code-content search (ignores node_modules/.git) |
| Shell | `run_shell` | Allowlist + danger interception + approval |
| Verify | `run_tests` / `build_check` | Run test suite / build check (default `npm test` / `npm run build`) |

All tool inputs are validated by **zod**, errors normalized to `ToolError`; file operations are always confined to the `cwd` sandbox.

---

## 7. Security Model

1. **Path sandbox**: `safeJoin` validates each path stays within `cwd`, preventing `../` privilege escalation.
2. **Shell allowlist**: `run_shell` passes only when the first word hits `FH_SHELL_ALLOW`; in non-interactive CLI, allowlisted commands auto-pass via the default approver, others rejected and logged.
3. **Secret redaction**: logs replace values by key name (`apikey|secret|token|...`) with `[REDACTED]`, and never echo full API keys.
4. **Approval interception**: when `FH_REQUIRE_APPROVAL=true` (default), dangerous operations go through an approval channel; **TTY interactive terminal prompts `y/n` per action**, non-interactive (CI/pipe) falls back to allowlist approver — allowlisted auto-pass, others rejected and logged.
5. **`.env` not in repo**: excluded by `.gitignore`; `package.json`'s `files` allowlist ensures `npm publish` won't carry `.env`.
6. **RBAC policy engine (M4)**: role-tool matrix + **deny-first** dangerous-command / sensitive-path blacklist, `admin` cannot bypass; policy can only be **tightened** by lower-level config.
7. **Tamper-proof audit (M4)**: all actions (allow/deny/approved/rejected) written to a sha256 hash chain, `fhcode audit verify` locates tampering; **audit write failure rejects execution**.
8. **Tenant isolation & quota (M4)**: sessions / audit / goals in physically separate dirs, tenant ID strictly validated; per-task cost circuit-breaker + tenant daily budget fail-fast.

> From M4, the guard is the **sole authoritative gate**: policy judgment, manual approval, and audit logging all complete once before tool execution, the tool layer no longer re-prompts, avoiding "approval conflicts" and repeated questions.

---

## 8. Configuration Reference (.env)

| Variable | Description | Default / Example |
| --- | --- | --- |
| `FH_HOME` | App home dir (optional) | `~/.feihong-code` |
| `FH_LOG_DIR` | Session log dir | `~/.feihong-code/sessions` |
| `FH_PROVIDERS` | Model provider JSON array | see `docs/配置参考.md` |
| `FH_MODEL_STRATEGY` | Routing strategy: `cost`/`capability`/`latency` | `cost` |
| `FH_BUDGET_USD` | Per-task budget cap (USD, alert only, no block) | `0.5` |
| `FH_SHELL_ALLOW` | Shell allowlist (comma-separated, hit = no approval) | `git,npm,node,ls,cat` |
| `FH_REQUIRE_APPROVAL` | Whether dangerous ops need approval | `true` |
| `FH_ENTERPRISE` | Enterprise mode switch (perm/audit/tenant/quota) | `true` |
| `FH_TENANT` | Tenant ID (decides isolation dir) | `default` |
| `FH_USER` | User identifier (written to audit actor) | system username |
| `FH_ROLE` | Role: `viewer`/`developer`/`operator`/`admin` | `developer` |
| `FH_TENANT_BUDGET_USD` | Tenant daily cost cap (0 = unlimited) | `0` |
| `FH_POLICY` | Inline policy JSON (highest priority) | unset |

> Full config in [`docs/配置参考.md`](./docs/配置参考.md). `.env` contains secrets, never commit it.

---

## 9. Architecture (feature-first layering)

```
src/
├── cli/          entry, arg parsing, REPL, runtime assembly (run.ts)
├── shared/       infra: config / errors / logger / types
├── agent/        Orchestrator (ReAct loop) / Planner / Prompts / parallel orchestration / sub-agents
├── tools/        tool implementations (file / shell / search / verify) + registry + security sandbox
├── models/       model routing ModelRouter + providers (openai-compatible / ollama / mock)
├── runtime/      event log EventLog, session state SessionStore, checkpoint persistence, git diff/rollback, git worktree isolation
├── enterprise/   M4 enterprise: tenant (multi-tenant) / policy (RBAC) / audit (hash chain) / quota / guard
└── skills/       advanced skills: /plan /grill /goal
```

**Single-command flow**: `CLI → Orchestrator → ModelRouter (pick model) → model returns tool call → ToolRegistry (validate+exec) → result back to model → loop until done → checkpoint + event log archived each round`.

**Parallel flow**: `CLI --parallel → decompose goal → create git worktree per subtask (isolated branch) → Promise.allSettled concurrent sub-agents → collect results → force-clean worktrees`.

**Recovery flow (M3)**: `sessions list checkpoints → resume <id> load checkpoint rebuild conversation → continue ReAct loop → final result`; `diff/rollback` based on checkpoint's touchedFiles for session-scope git compare and revert.

**Enterprise control flow (M4)**: `env inject identity (tenant/user/role) → load policy (default→global→tenant→inline) → quota pre-check → every tool call through guard: policy judge → manual approval if needed → write hash-chain audit → allow/deny`.

> Architecture details in [`docs/架构与API.md`](./docs/架构与API.md).

---

## 10. Development

```bash
npm install
npm run build      # tsc compile to dist/
npm run dev        # tsx runs source directly (no build)
npm run typecheck  # type-check only
npm run verify:m4  # M4 enterprise assertion suite (41 items, all offline)
npm run verify     # typecheck + build + M4 assertions, one command full chain
node dist/cli/index.js --version
```

### Engineering conventions (full-stack iron rules)
1. Boundaries must be validated (CLI args / model responses / tool inputs → zod).
2. Centralized config (`shared/config.ts`, startup validation, fail-fast, lazy load).
3. Typed errors (`AppError` subclasses, no bare `throw`).
4. Structured logging (JSON + `runId`, secret redaction).
5. Single source of truth (behavior anchored to `runtime/event-log`).

---

## 11. Deployment

- **npm global**: `npm install -g .` or after publish `npm install -g feihong-code`.
- **Docker**: see `Dockerfile` (multi-stage, includes `git` to support `--parallel`).
- **CI**: see `.github/workflows/ci.yml`, three pipelines all offline, zero Secrets:
  - `build`: Node 18/20/22 matrix → typecheck → compile → offline e2e → read-only skills;
  - `enterprise`: M4 assertion suite (41 items) + CLI enterprise command smoke + **tenant isolation assertion** (beta tenant must not read other tenants' sessions);
  - `security`: `npm pack` allowlist check (forbid `.env`/`src`/`policy.json` in package) + repo plaintext secret scan + `npm audit`.
- **Publish**: `npm publish` carries only the `files` allowlist (dist + docs), secrets safe.
- Deployment details in [`docs/部署指南.md`](./docs/部署指南.md), enterprise landing in [`docs/企业部署与合规.md`](./docs/企业部署与合规.md).

---

## 12. Milestone Progress

| Milestone | Content | Status |
| --- | --- | --- |
| **M0 Scaffold** | Project structure, shared infra, CLI entry | ✅ Done |
| **M1 P0 Loop** | Model routing, file/shell tools, REPL, event log, offline loop verification | ✅ Done |
| **M2 Sub-agents** | `git worktree` isolation, parallel sub-agents, `/plan` `/grill` `/goal` skills | ✅ Done |
| **M2 Real integration (B)** | Connect OpenAI-compatible real model (Agnes), ReAct loop works | ✅ Done |
| **M3 Recovery & Audit** | `sessions`/`resume` checkpoint resume, `diff`/`rollback` session-scope change mgmt, interactive approval | ✅ Done |
| **M4 Enterprise** | RBAC policy engine, tamper-proof audit chain, multi-tenant isolation & quota, 3-pipeline CI | ✅ Done |
| **M5 Web Console** | Read-only observation panel (tenant/policy/audit/quota visualization) | ✅ BETA |
| **M6 Self-evolution** | Self-heal loop, context compression, experience learning, model perf tracking | ✅ Done |
| **M7 Coding ability** | Code analysis/gen/review/repo understanding/test gen | ✅ Done |
| **M8 Autonomous iteration** | CodeWriter six-step loop, QualityGate, SelfImprover | ✅ Done |
| **M9 Fully autonomous SWE** | Repo read→decompose→implement+verify→self-heal→report | ✅ Done |
| **M9.1 Real model** | 3-tier provider access, exec discipline hardening, mock full-chain verification | ✅ Done |

---

## 13. Documentation Navigation

> **AI Agent quick start**
- [AGENT-GUIDE.md](./AGENT-GUIDE.md) — guide for AI agents (env, config, tool contracts)
- [tool-schema.json](./tool-schema.json) — JSON Schema for all tools
- [GEO-AAO-STRATEGY.md](./GEO-AAO-STRATEGY.md) — generative-engine optimization & agent-optimization strategy

> **Authoritative docs (stable, preferred)**
- [Technical Spec](./docs/技术说明书.md) — architecture, enterprise capability details, data contracts, CLI/Web API, deployment architecture, security model, build verification
- [User Manual](./docs/使用说明书.md) — install, quick start, command overview, core workflows, enterprise/Web console usage, config, troubleshooting

> **Supplementary reference**
- [User Handbook](./docs/用户手册.md) — per-command details, tool docs, approval & security, best practices
- [Config Reference](./docs/配置参考.md) — all `FH_*` env vars and `FH_PROVIDERS` explained
- [Architecture & API](./docs/架构与API.md) — layering, orchestration loop, model routing, tool protocol, event log
- [Deployment Guide](./docs/部署指南.md) — npm / Docker / CI / publish / secret security
- [Enterprise Deployment & Compliance](./docs/企业部署与合规.md) — RBAC role design, audit forensics, multi-tenant plan, quota governance (M4)
- [FAQ & Troubleshooting](./docs/常见问题与故障排查.md) — FAQ and troubleshooting
- [Product Dev Docs](./docs/产品开发文档.md) — requirements/milestones/design decisions (evolving)

> Stable deployment artifacts: `Dockerfile`, `docker-compose.yml`, `install.sh`, `CHANGELOG.md` (see repo root).

---

## 🤝 Community Support

Follow Feihongzhi klAI for the latest open-source updates and technical tutorials:

![Community QR](https://github.com/wch887292/feihong-code/releases/download/v1.0.0-community/qrcode-community.png)

Scan to join the **Feihongzhi WeChat assistant** for:
- Technical Q&A and deployment guidance
- Open-source project update notifications
- Localization service booking (Quanzhou area)
- Enterprise AI digitalization consulting

---

*Jinjiang Feihongzhi Technology Enterprise Management Co., Ltd. · Feiyang Qiyuan R&D Center · Lead: Wu Cihong*

## 14. Copyright & Attribution

- **Company**: Jinjiang Feihongzhi Technology Enterprise Management Co., Ltd.
- **R&D Center**: Feiyang Qiyuan R&D Center
- **Lead**: Wu Cihong

© 2026 Jinjiang Feihongzhi Technology Enterprise Management Co., Ltd. · Feiyang Qiyuan R&D Center · Lead: Wu Cihong
Released under the [MIT License](./LICENSE).
