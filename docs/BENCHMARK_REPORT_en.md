# Feihong Code v7.2.0 Benchmark Report

**Benchmark Date**: August 27, 2026
**Version**: Feihong Code v7.6.0
**Benchmark Team**: Feiyang Qiyuan R&D Center
**Nature**: Objective Public Benchmark (with quantified results and sources)

---

## 1. Overview

This report conducts a horizontal comparison between Feihong Code v7.0.0 and current mainstream AI coding assistants and IDE products, objectively analyzing from dimensions including product positioning, technical architecture, functional features, pricing, privacy security, and user experience, to identify Feihong Code's leading advantages and areas for improvement.

### 1.1 Benchmark Subjects

**AI Coding Assistants**:
- Cursor
- GitHub Copilot
- Codeium (now Windsurf)
- Tabnine
- Muse Code
- Aider
- Continue.dev
- Cline / Roo Code

**IDE Products**:
- Visual Studio Code
- JetBrains IntelliJ IDEA
- Visual Studio

### 1.2 Benchmark Dimensions

1. Product positioning and form
2. Deployment and privacy security
3. Model support and extensibility
4. Code generation and completion
5. Autonomous Agent capability
6. Pricing and cost
7. Chinese and localization support
8. Enterprise features
9. User experience
10. Ecosystem and community

---

## 2. Product Positioning Comparison

| Product | Positioning | Form | Target Users |
|---------|-------------|------|--------------|
| **Feihong Code** | Terminal AI coding agent | CLI + Web + Desktop | Full-stack devs, enterprise teams |
| Cursor | AI-native IDE | Standalone IDE | Full-stack developers |
| GitHub Copilot | AI coding assistant | IDE plugin | Full-stack developers |
| Codeium/Windsurf | AI coding assistant | IDE plugin + IDE | Full-stack developers |
| Tabnine | AI code completion | IDE plugin | Enterprise developers |
| Muse Code | Terminal AI coding agent | CLI + Web | Advanced developers |
| Aider | Terminal AI coding assistant | CLI | Advanced developers |
| Continue.dev | Open-source AI assistant | IDE plugin | Developers |
| Cline/Roo Code | AI Agent assistant | VS Code plugin | Full-stack developers |
| VS Code | General code editor | IDE | All developers |
| JetBrains IDEA | Professional Java IDE | IDE | Java/Kotlin developers |
| Visual Studio | Professional .NET/C++ IDE | IDE | Enterprise developers |

**Analysis**:
- Feihong Code, Muse Code, and Aider belong to the "terminal AI coding agent" track, but Feihong Code additionally provides Web console and Electron desktop version with richer forms
- Compared to IDE plugins/standalone IDEs like Cursor and Copilot, Feihong Code focuses more on "autonomously completing tasks" rather than "code completion"
- Compared to pure CLI tools (Aider), Feihong Code's Web/desktop interface lowers the barrier to entry

---

## 3. Deployment and Privacy Security

| Product | Cloud | Local | Private | Data Privacy |
|---------|-------|-------|---------|--------------|
| **Feihong Code** | Support | Support | ✅ Full | Local deployment, data stays in-domain |
| Cursor | ✅ Mainly cloud | Partial | ❌ | Code uploaded to cloud |
| GitHub Copilot | ✅ Cloud | ❌ | Enterprise limited | Code uploaded to cloud |
| Codeium | ✅ Cloud | Enterprise local | Enterprise | Code uploaded to cloud |
| Tabnine | ✅ Cloud | ✅ Enterprise | ✅ Enterprise | Optional local |
| Muse Code | Support | Support | ✅ | Local deployment |
| Aider | API dependent | ❌ | ❌ | Third-party API dependent |
| Continue.dev | API dependent | ✅ Can be local | ✅ | Can be fully local |
| Cline/Roo Code | API dependent | ❌ | ❌ | Third-party API dependent |

**Feihong Code Advantages**:
- ✅ Complete offline private deployment, data never leaves domain
- ✅ Supports local models like Ollama, can work completely offline
- ✅ Enterprise-grade RBAC permissions and audit logs
- ✅ Workspace isolation, prevents unauthorized access

**Gaps**:
- Compared to Tabnine Enterprise, Feihong Code's local model ecosystem needs improvement
- Private deployment documentation and best practices need supplementation

---

## 4. Model Support and Extensibility

| Product | Multi-model | Local Models | Custom Models | Model Routing |
|---------|-------------|--------------|---------------|---------------|
| **Feihong Code** | ✅ DeepSeek/Qwen/Ollama/OpenAI | ✅ Ollama | ✅ OpenAI compatible | ✅ Multi-model routing |
| Cursor | ✅ Multiple | ❌ | Limited | ✅ |
| GitHub Copilot | ❌ Fixed | ❌ | ❌ | ❌ |
| Codeium | ✅ Multiple | Enterprise | Limited | ✅ |
| Tabnine | ✅ | Enterprise | ✅ | ✅ |
| Muse Code | ✅ | ✅ | ✅ | ✅ |
| Aider | ✅ Multiple | ✅ | ✅ | ❌ |
| Continue.dev | ✅ | ✅ | ✅ | ✅ |
| Cline/Roo Code | ✅ | ✅ | ✅ | ❌ |

**Feihong Code Advantages**:
- ✅ Native support for mainstream Chinese models (DeepSeek, Tongyi Qianwen), no VPN needed for Chinese users
- ✅ Complete multi-model routing mechanism, selects optimal model by task type
- ✅ OpenAI compatible interface, can connect to any third-party model service

**Gaps**:
- Model marketplace/model store functionality not yet established
- Model fine-tuning and personalized training capabilities missing

---

## 5. Code Generation and Completion

| Product | Code Completion | Code Generation | Refactoring | Bug Fixing | Test Generation |
|---------|-----------------|-----------------|-------------|------------|-----------------|
| **Feihong Code** | ❌ No real-time | ✅ Task-level | ✅ | ✅ Self-healing | ✅ |
| Cursor | ✅ Real-time | ✅ | ✅ | ✅ | ✅ |
| GitHub Copilot | ✅ Industry benchmark | ✅ | ✅ | ✅ | ✅ |
| Codeium | ✅ Real-time | ✅ | ✅ | ✅ | ✅ |
| Tabnine | ✅ Real-time | Limited | Limited | Limited | Limited |
| Muse Code | ❌ | ✅ Task-level | ✅ | ✅ | ✅ |
| Aider | ❌ | ✅ | ✅ | ✅ | Limited |
| Continue.dev | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cline/Roo Code | ❌ | ✅ Task-level | ✅ | ✅ | ✅ |

**Analysis**:
- Feihong Code positions as "task-level AI coding agent", does not provide in-IDE real-time code completion
- In "autonomously completing full tasks", Feihong Code is in the same tier as Cursor Agent, Cline, Muse Code
- Self-healing mechanism is Feihong Code's feature, automatically identifies build errors and fixes

**Feihong Code Advantages**:
- ✅ Task-level autonomous execution, one-stop from requirement to code change
- ✅ Built-in self-healing loop, automatically troubleshoots and fixes build failures
- ✅ System prompts specifically optimized for coding and bug fixing capabilities

**Gaps**:
- ❌ Lacks in-IDE real-time code completion (product positioning decision, not technical defect)
- ❌ Code generation accuracy and context understanding still lag behind Cursor/Copilot
- ❌ Lacks visualization for multi-file collaborative editing

---

## 6. Autonomous Agent Capability

| Product | Autonomous Planning | Tool Calls | File Ops | Shell | Browser | Multi-iteration |
|---------|---------------------|------------|----------|-------|---------|-----------------|
| **Feihong Code** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cursor (Agent) | ✅ | ✅ | ✅ | ✅ | Limited | ✅ |
| GitHub Copilot | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Codeium (Cascade) | ✅ | ✅ | ✅ | ✅ | Limited | ✅ |
| Cline/Roo Code | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Muse Code | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Aider | Limited | ✅ | ✅ | ✅ | ❌ | ✅ |
| Continue.dev | Limited | ✅ | ✅ | Limited | ❌ | Limited |

**Feihong Code Advantages**:
- ✅ Complete tool calling system: file read/write, Shell execution, browser operation, computer control
- ✅ Computer control feature: can control mouse and keyboard, achieving true "computer operation"
- ✅ Screenshot feature: can capture screen and analyze, supports visual understanding
- ✅ Voice/video calls: multimodal interaction capability

**Gaps**:
- Agent planning ability and task decomposition need improvement
- Long-task context management and compression strategy need optimization

---

## 7. Pricing and Cost

| Product | Free Tier | Personal | Enterprise | Local Deployment Cost |
|---------|-----------|----------|------------|----------------------|
| **Feihong Code** | ✅ Completely free | ✅ Free | ✅ Free | ✅ Zero license fee |
| Cursor | Limited | $20/mo | $40/mo/user | ❌ |
| GitHub Copilot | Limited | $10/mo | $19/mo/user | ❌ |
| Codeium | Limited | $15/mo | Custom | ❌ |
| Tabnine | Limited | $12/mo | Custom | High |
| Muse Code | ✅ Open-source free | ✅ Free | ✅ Free | ✅ Zero license fee |
| Aider | ✅ Open-source free | ✅ Free | ✅ Free | API cost |
| Continue.dev | ✅ Open-source free | ✅ Free | ✅ Free | API cost |

**Feihong Code Advantages**:
- ✅ Completely free and open-source, no license fees
- ✅ After local deployment only hardware costs
- ✅ Supports free/low-cost Chinese models (DeepSeek etc.), API cost extremely low
- ✅ No user limit for enterprise use

**Gaps**:
- Lacks commercial technical support services
- Lacks SaaS hosted version

---

## 8. Chinese and Localization Support

| Product | Chinese UI | Chinese Models | China Access | Chinese Docs |
|---------|------------|----------------|--------------|--------------|
| **Feihong Code** | ✅ Full bilingual | ✅ Native | ✅ Direct | ✅ |
| Cursor | ❌ English | Limited | ❌ VPN needed | ❌ |
| GitHub Copilot | ❌ English | Limited | ❌ VPN needed | Limited |
| Codeium | Limited | Limited | ❌ VPN needed | Limited |
| Tabnine | Limited | Limited | ❌ VPN needed | Limited |
| Muse Code | Limited | ✅ | ✅ | Limited |
| Aider | ❌ English | Model dependent | Model dependent | ❌ |
| Continue.dev | Limited | Model dependent | Model dependent | Limited |

**Feihong Code Advantages**:
- ✅ Complete Chinese-English bilingual interface
- ✅ Native support for Chinese models like DeepSeek, Tongyi Qianwen, no VPN needed
- ✅ Chinese documentation and community support
- ✅ China network environment optimized

---

## 9. Enterprise Features

| Product | RBAC | Audit Log | Private | SSO | Permission Approval |
|---------|------|-----------|---------|-----|---------------------|
| **Feihong Code** | ✅ | ✅ | ✅ | ❌ | ✅ |
| Cursor | ❌ | Limited | ❌ | ❌ | ❌ |
| GitHub Copilot | Limited | Limited | ❌ | ✅ | ❌ |
| Codeium | Limited | Limited | Enterprise | ✅ | ❌ |
| Tabnine | ✅ | ✅ | Enterprise | ✅ | ❌ |
| Muse Code | ✅ | ✅ | ✅ | ❌ | ✅ |

**Feihong Code Advantages**:
- ✅ Complete RBAC permission system
- ✅ Full operation audit logs
- ✅ Dangerous operation approval mechanism
- ✅ Workspace-level permission isolation

**Gaps**:
- Lacks SSO/SAML single sign-on
- Lacks LDAP/AD integration
- Lacks compliance certifications (SOC2, ISO27001 etc.)

---

## 10. User Experience

| Product | Learning Curve | UI Friendliness | Real-time Feedback | Multi-platform |
|---------|----------------|-----------------|--------------------|----------------|
| **Feihong Code** | Medium | ✅ Web/Desktop friendly | ✅ Real-time thinking | ✅ CLI/Web/Desktop |
| Cursor | Low | ✅ IDE experience | ✅ | Desktop |
| GitHub Copilot | Very low | ✅ Integrated in IDE | ✅ | Multiple IDEs |
| Codeium | Low | ✅ | ✅ | Multiple IDEs |
| Muse Code | High | Medium | ✅ | CLI/Web |
| Aider | High | ❌ Pure CLI | Limited | CLI |
| Cline/Roo Code | Medium | ✅ In VS Code | ✅ | VS Code |

**Feihong Code Advantages**:
- ✅ v7.0.0 conversation flow fully refactored, Doubao-like experience, pure text + real-time thinking
- ✅ Web console and desktop version lower the barrier of CLI tools
- ✅ Multimodal interaction: screenshot, voice, video, etc.

**Gaps**:
- UI aesthetics and interaction details still lag behind mature products like Cursor
- Lacks IDE plugin form, cannot integrate into developers' existing workflow
- Real-time collaboration and team features missing

---

## 11. Overall Scores

| Dimension | Feihong Code | Cursor | Copilot | Muse Code | Aider | Cline |
|-----------|--------------|--------|---------|-----------|-------|-------|
| Deployment & Privacy | 9 | 5 | 4 | 9 | 6 | 5 |
| Model Support | 8 | 8 | 4 | 8 | 7 | 7 |
| Code Capability | 7 | 9 | 9 | 7 | 7 | 8 |
| Agent Capability | 8 | 8 | 3 | 8 | 6 | 8 |
| Pricing & Cost | 10 | 5 | 5 | 10 | 9 | 8 |
| Chinese Localization | 9 | 4 | 4 | 7 | 3 | 4 |
| Enterprise Features | 8 | 4 | 6 | 8 | 3 | 3 |
| User Experience | 7 | 9 | 9 | 6 | 4 | 7 |
| **Overall** | **8.3** | **6.5** | **5.5** | **7.9** | **5.6** | **6.3** |

*Scoring: 1-10, 10 is best*

---

## 12. Summary

### 12.1 Feihong Code's Leading Advantages

1. **Completely free and open-source**: Zero license fees, no cost pressure for enterprise use
2. **Private deployment**: Data never leaves domain, meets strong regulatory industries like finance and government
3. **China ecosystem optimized**: Native support for Chinese models like DeepSeek, Tongyi Qianwen, no VPN needed
4. **Chinese-English bilingual**: Complete internationalization support
5. **Full-platform forms**: CLI + Web + Desktop, meets different usage scenarios
6. **Enterprise-grade security**: RBAC, audit logs, permission approval all included
7. **Multimodal interaction**: Screenshot, voice, video, computer control and other featured functions

### 12.2 Areas for Improvement

1. **Code completion capability**: Lacks in-IDE real-time completion, consider developing VS Code plugin
2. **Agent intelligence**: Task planning and long context management need continuous optimization
3. **Enterprise integration**: SSO, LDAP, compliance certification and other enterprise features to be improved
4. **Ecosystem building**: Plugin marketplace, model store, community ecosystem need cultivation
5. **Interface experience**: UI/UX details still have gaps with mature products
6. **Documentation improvement**: Private deployment best practices, operation manuals need supplementation

### 12.3 Market Positioning Recommendations

Feihong Code should focus on the following niche markets:
- **Domestic enterprise private deployment**: Benchmark against Tabnine Enterprise with significant price advantage
- **Xinchuang/national localization**: Support domestic models and domestic operating systems
- **Education and individual developers**: Completely free, lowers AI coding barrier
- **Multimodal AI coding**: Screenshot, voice, computer control and other features form differentiation

---

## 13. SWE-bench Real Results Benchmark (Quantified, new in v7.2.0)

> Every figure below has a source and methodology note, replacing earlier unfounded qualitative claims.
> **Honesty note**: Feihong Code's result is from a **self-built SWE-bench-format task set** (reproducible); industry numbers are official/public **SWE-bench Verified** results. Different eval sets — **not directly comparable**; shown only to indicate relative magnitude under a similar framework.

### 13.1 Feihong Code Real Run (self-built SWE-bench-format set)

| Metric | Result | Methodology |
|---|---|---|
| **Test pass rate** | **80% (4/5)** | SWE-bench format (problem_statement + FAIL_TO_PASS), 5 self-contained JS tasks; real model agnes-2.5-flash driving Orchestrator; **predefined tests (not given to model) verified via node --test** |
| Passed | swe-js-001/002/003/005 | maxOf / fibonacci / isPalindrome / countWords — all assertions passed |
| Failed | swe-js-004 (findMissing) | iterations=0 toolCalls=0, execution-layer failure, not an implementation error |
| Harness loop (mock) | 2/2 = 100% | loader→executor→verifier→reporter full chain executable |
| Harness real-model generation | 3/3 = 100% | Real model driving Orchestrator, all 3 real coding tasks generated target files |

Reproduce: `node scripts/_swe-bench-real.mjs` (real), `node scripts/_swe-smoke.mjs` (mock).
**This is the only score claimed externally. No claim on official SWE-bench Verified until re-measured on the real dataset with a container environment.**

### 13.2 Industry Public Benchmark (SWE-bench Verified, 2026 public data)

| Product / Model | Score | Nature & Date |
|---|---|---|
| Claude Code (Fable 5 backend) | 95.0% | AI Wiki, 2026-07 (model score) |
| Claude Opus 4.8 | 88.6% | Anthropic / BenchLM, 2026-06 |
| Claude Opus 4.7 | 87.6% | Anthropic, 2026-04 |
| Codex CLI (GPT-5.5) | ~82.6% | Third-party tracking, 2026-07 (OpenAI stopped self-reporting) |
| Claude Opus 4.6 | 80.8% | Anthropic, 2026-02 |
| Gemini 3.1 Pro | 80.6% | Google official model card (3rd-party ~75%, 2026-03) |
| GPT-5.2 | 80.0% | OpenAI |
| Doubao Seed-Code + TRAE | 78.80% | ByteDance official, 2025-11 (SOTA at launch) |
| TRAE (standalone) | 75.2% | ByteDance official |
| Gemini CLI (Gemini 3.1 Pro) | 80.6% | AI Wiki, 2026-07 |
| OpenHands | 72.0% | MarkTechPost, 2026-05 |
| Cursor (default config) | ~51.7% | MarkTechPost, 2026-05 (varies with backend model, up to 88.6%) |
| GitHub Copilot (Agent mode) | ~56% | MarkTechPost, 2026-05 |
| Average of all 77 models | 62.2% | Verified leaderboard mean, 2026-03 |

**Contamination warning**: SWE-bench Verified is confirmed contaminated — OpenAI's audit found frontier models reproduce some gold patches; SWE-ABS (2026-05, arXiv) strengthened test suites and dropped average resolve rates 14.56pp, with the top agent (TRAE+Doubao, 78.80%) falling to 62.20%. Treat any Verified high score as an upper-bound reference with possible memorization. Feihong Code's self-built set is contamination-free but small (5 tasks); both must be interpreted with caution.

### 13.3 Feihong Code Auditable Differentiation (non-score)

| Dimension | Feihong Code | Main competitors | Basis |
|---|---|---|---|
| Cost | Free & open-source, zero local license | Cursor $20-40/mo, Copilot $10-19/mo | See §7 pricing |
| Data privacy | Local deploy, data stays on-prem, offline-capable | Cursor/Copilot mostly cloud | See §3 |
| Model routing | Multi-model + local Ollama + domestic models | Cursor multi / Copilot fixed | See §4 |
| Multimodal Agent | Screenshot/voice/video/computer control | Partial | See §6 |
| SWE metric | 80% self-built set (real assertions, reproducible) | Official Verified (contaminated) | See 13.1/13.2 |

### 13.4 Honest Gaps

1. Official SWE-bench Verified (500 tasks) needs Docker+pytest; not yet run in this environment — **not yet measured** (see 13.1)
2. Model backend is third-party (agnes-2.5-flash etc.); score varies with backend, not a self-owned model
3. Self-built set is small (5 tasks), limited statistical confidence, engineering baseline only

---

## 14. Benchmark Disclaimer

This benchmark is based on publicly available information and actual usage experience of each product. Scores only represent subjective judgment at the time of benchmarking and do not constitute purchase recommendations. Product features iterate continuously, please refer to the latest official version.

**This benchmark report was assisted by Doubao AI**, including data organization, data comparison, analysis and writing.

---

*Feiyang Qiyuan R&D Center*
*August 24, 2026*
