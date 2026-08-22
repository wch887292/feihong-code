# Hacker News Show HN 提交

## 标题

```
Show HN: fhcode – Terminal AI coding agent with self-evolving healing loop (MIT)
```

或中文版：
```
Show HN: 飞虹 Code – 终端 AI 编程智能体，支持自我进化与企业级权限
```

## 正文

```markdown
Hi HN!

I built fhcode (飞虹 Code) – an open-source terminal AI coding agent that can 
self-evolve from failures and supports enterprise RBAC/audit.

Why another AI coding tool? Claude Code and Cursor are great but closed-source 
and require cloud APIs. For teams needing data privacy and on-premise deployment, 
there aren't many options.

Key features:

• **Self-evolving**: Records failures, learns solutions, auto-applies to future tasks
• **Self-healing**: Up to 3 auto-retry attempts with reflection on errors
• **Multi-model routing**: DeepSeek, Qwen, Ollama (local), OpenAI compatible
• **Enterprise grade**: RBAC (5 roles), hash-chain audit, multi-tenant isolation
• **Offline capable**: Works with local Ollama, no API key required
• **SWE Agent**: Full software engineering automation (M0-M9.1 milestones)

Quick start:
```bash
npm install -g feihong-code
fhcode "write a hello world in TypeScript"
```

For enterprise:
```bash
export FH_ENTERPRISE=true
export FH_TENANT=my-org
export FH_ROLE=developer
fhcode whoami  # see your permissions
```

Repo: https://github.com/wch887292/feihong-code
npm: https://www.npmjs.com/package/feihong-code
Docs: https://github.com/wch887292/feihong-code/blob/master/README.md

MIT licensed. Built in China for the global open-source community.

Questions? Ask away!
```

## 评论区回复模板

**Q: How is this different from Aider/Cline/OpenCode?**

A: Great question! Key differentiators:
1. **Self-evolution**: fhcode learns from failures and improves over time - other tools don't have this
2. **Enterprise RBAC**: Full role-based access control with audit chain (not common in similar tools)
3. **Multi-tenant**: Physical directory isolation for different teams/organizations
4. **Chinese ecosystem**: Native support for DeepSeek, Qwen alongside OpenAI models
5. **Fully offline**: Can run entirely locally with Ollama

All three are MIT open source, which is great for the community.

**Q: What's the roadmap?**

A: We're targeting:
- v0.6: Web console production release
- v0.7: Plugin system for custom tools
- v0.8: Multi-language UI (currently Chinese/English)
- Long-term: Full SWE agent benchmarking (SWE-bench)

**Q: Who's behind this?**

A: Developed by 飞扬企源研发中心 (Feiyang Qiyuan R&D Center), part of 晋江市飞虹智科技企业管理有限公司. We're a AI service company based in Quanzhou, China, focused on helping manufacturing companies adopt AI.

---

*Note: Post during US business hours (7-10 AM EST) for best visibility*
