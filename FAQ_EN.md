# FAQ — Feihong Code (fhcode)

> 中文 README: [README.md](README.md) · 中文常见问题见 docs/常见问题与故障排查.md

**Q1. What is fhcode and how is it different from Claude Code / Cursor / Aider?**
fhcode is a terminal-native AI coding agent (like Meta Muse Code). Its differentiators: multi-model routing across DeepSeek / Tongyi / Ollama / OpenAI-compatible gateways, offline/on-prem operation (data stays in your intranet via local Ollama), and enterprise-grade RBAC + tamper-proof audit chain. It is MIT-licensed and self-hostable.

**Q2. Do I need an API key to try it?**
No. Without `FH_PROVIDERS` (or with `FH_OFFLINE=true`), fhcode runs a full closed loop using a built-in Mock driver — you can see planning → file writes → summary without any LLM. Run `fhcode "your goal"` after `npm i -g feihong-code`.

**Q3. Which models are supported?**
Any OpenAI-compatible endpoint (DeepSeek, Tongyi/Qwen, Agnes, OpenAI, etc.) and local Ollama. Configure via `FH_PROVIDERS` JSON (baseURL / apiKey / model). The router auto-selects and falls back based on the `FH_MODEL_STRATEGY` (`cost`/`capability`/`latency`).

**Q4. How do I connect a real model?**
```bash
cp .env.example .env
# edit .env: set FH_PROVIDERS with your baseURL / apiKey / model
fhcode "refactor src/utils date formatting into its own module"
```

**Q5. Does it work fully offline / on-prem?**
Yes. Use local Ollama (`FH_MODEL_TYPE=ollama`, `FH_MODEL_BASE_URL=http://localhost:11434`). No data leaves the intranet. This is the primary use case for the enterprise RBAC/audit features.

**Q6. What is the SWE Agent (`fhcode swe`)?**
A fully autonomous software-engineering flow: read repo → decompose task → implement + run tests/verification → self-heal retry → report. Supports `--max-iterations` and other flags. Ideal for "fix issue Y in repo X" type goals.

**Q7. How does `--parallel` work and why did my subtasks fail with 429?**
`--parallel` splits a goal into subtasks, each in an isolated `git worktree`, running concurrently. Free API tiers strictly rate-limit concurrency (HTTP 429). Fixes: upgrade the API plan, run large goals sequentially in single-command mode, or verify the mechanism offline with `FH_OFFLINE=true fhcode --parallel "..."`.

**Q8. How do I recover an interrupted task?**
Every task writes a checkpoint `<runId>.session.json`. Use `fhcode sessions` to list, `fhcode resume <id>` to continue, `fhcode diff <id>` to see session-scope changes, and `fhcode rollback <id> --yes` to revert (dangerous, requires `--yes`).

**Q9. What is the enterprise mode (M4)?**
Enterprise mode (on by default) adds: RBAC (four roles viewer/developer/operator/admin with deny-first blacklists), a tamper-proof sha256 audit hash chain (`fhcode audit verify`), physical multi-tenant directory isolation, and cost quota circuit-breakers. Disable with `FH_ENTERPRISE=false` (degrades to M3).

**Q10. How do permissions and approvals work?**
Dangerous commands and sensitive paths (`.env`, `.ssh/id_rsa`, etc.) are denied-first — even admin cannot bypass. Other shell commands use an allowlist (`FH_SHELL_ALLOW`); in TTY mode each dangerous op prompts `y/n`, in CI/pipe mode non-allowlisted commands are rejected and logged.

**Q11. Is my API key safe?**
Yes. `.env` is gitignored and excluded from the npm package. Audit logs redact secret values (`apiKey=`/`Bearer`/`sk-xxx` → `***`) and never echo full keys. If the audit write fails, tool execution is refused.

**Q12. Which Node.js version is required?**
Node.js >= 18. The published package exposes the `fhcode` bin (on Windows: `fhcode.cmd`). Source builds use `npm run build` (tsc → dist/).

**Q13. How do I deploy it?**
Three ways: `npm install -g feihong-code` (global), Docker (multi-stage `Dockerfile` includes `git` for `--parallel`), or via CI (GitHub Actions 3 pipelines, all offline, zero Secrets). See docs/部署指南.md.

**Q14. Where are sessions / audit logs stored?**
Under `<FH_HOME>` (default `~/.feihong-code`), split per tenant: `sessions/`, `audit/`, `goals/`. Tenant IDs are strictly validated to prevent `../` traversal; tenants are fully isolated.

**Q15. The project is MIT — can I use it commercially?**
Yes. fhcode is MIT-licensed and self-hostable. Enterprise features (RBAC/audit/tenant/quota) are part of the open-source codebase. For commercial deployment support, contact the Feihongzhi klAI team (see Community Support in README).

---

*Jinjiang Feihongzhi Technology Enterprise Management Co., Ltd. · Feiyang Qiyuan R&D Center · Lead: Wu Cihong*
