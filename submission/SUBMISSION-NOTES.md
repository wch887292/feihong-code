# Awesome-Selfhosted Submission: Feihong Code (fhcode)

## Software Entry

```yaml
name: Feihong Code (fhcode)
website_url: https://www.klai.top
source_code_url: https://github.com/wch887292/feihong-code
description: Terminal AI coding agent with multi-model routing, enterprise RBAC/audit/tenant, self-evolving healing loop, and offline private deployment. MIT open source.
licenses:
  - MIT
platforms:
  - Node.js >= 18
  - TypeScript
  - Docker
tags:
  - Software Development - IDE & Tools
  - Generative AI
demo_url: https://github.com/wch887292/feihong-code
related_software_url: https://github.com/wch887292/feihong-code/blob/master/AGENT-GUIDE.md
```

## Why This Project Fits awesome-selfhosted

### Self-Hosting
- **Fully offline capable**: Run locally with Ollama without any external API dependency
- **Private deployment**: On-premise or cloud VM deployment supported via Docker
- **No telemetry**: Zero tracking, all data stays local
- **Enterprise security**: RBAC, audit chain, multi-tenant isolation

### Open Source
- **MIT License**: Fully permissive, commercial-friendly
- **Transparent codebase**: All features visible and auditable
- **Community driven**: Actively accepting contributions

### Technical Highlights
1. **Multi-Model Routing**: DeepSeek, Qwen, Ollama, OpenAI compatible
2. **Self-Evolution**: Automatic failure recording → experience learning → daily review
3. **Self-Healing Loop**: Up to 3 auto-retry attempts with reflection
4. **Enterprise Grade**: RBAC (5 roles), hash-chain audit, quota management
5. **SWE Agent**: Full software engineering automation (M0-M9.1)
6. **Web Console**: Browser-based management interface

### Installation
```bash
npm install -g feihong-code
# or
docker run -v "$PWD/.env:/app/.env" feihong-code
```

### Use Cases
- Individual developers needing offline AI coding assistance
- Enterprises requiring audit trails and permission control
- Teams wanting multi-tenant isolation
- Privacy-conscious users avoiding cloud AI APIs

## Verification Checklist

- [x] Project is free and open source (MIT)
- [x] Self-hosted deployment possible (npm/Docker)
- [x] No required third-party services (works with local Ollama)
- [x] Working installation documentation
- [x] Project actively maintained (first release > 4 months ago)
- [x] Clear description and categorization
- [x] License clearly stated
- [x] Source code on GitHub

## Category Recommendation

**Primary**: Software Development - IDE & Tools
**Secondary**: Generative AI

The project is a terminal-based AI coding assistant that helps developers write, debug, and manage code through natural language commands. It fits naturally alongside tools like Aider, OpenCode, and Claude Code.

---

*Submitted by: 吴赐虹 (Wu Cihong)*
*Organization: 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心*
*Date: 2026-08-22*
