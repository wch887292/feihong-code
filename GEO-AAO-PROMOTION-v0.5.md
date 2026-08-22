# 飞虹 Code v0.5.1 GEO/AAO 全网推广方案

> **GEO**（Generative Engine Optimization）：优化内容使其被 AI 搜索引擎优先抓取与引用
> **AAO**（AI Agent Optimization）：优化项目结构使其对 AI Agent 工具调用更友好
>
> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
> 版本：v0.5.1 | 2026-08-22

---

## 一、核心卖点提炼（对标四大 SWE Agent）

| 能力维度 | fhcode v0.5.1 | Claude Code | Cursor | Codex | OpenCode |
|---------|---------------|-------------|--------|-------|----------|
| **自我进化** | ✅ 全自动 | ❌ | ❌ | ❌ | ❌ |
| **自我修复** | ✅ 连续3次自愈 | ⚠️ 部分 | ❌ | ⚠️ | ❌ |
| **迭代上限** | 25次（可配） | 未公开 | 未公开 | 未公开 | 未公开 |
| **多模型路由** | DeepSeek/通义/Ollama/OpenAI | 仅Anthropic | 仅Claude | 仅OpenAI | 多模型 |
| **离线私有化** | ✅ 本地Ollama | ❌ | ❌ | ❌ | ⚠️ |
| **企业RBAC** | ✅ 完整审计链 | ✅ | ✅ | ❌ | ❌ |
| **Web控制台** | ✅ BETA | ❌ | ❌ | ❌ | ❌ |
| **开源程度** | MIT 完全开源 | 闭源 | 闭源 | 闭源 | MIT |
| **多子代理并行** | ✅ git worktree | ✅ | ❌ | ❌ | ❌ |

### 独家优势

1. **自我进化闭环（M6）**
   - 任务失败自动记录 → 生成经验 → 后续任务自动应用
   - 每日自动复盘报告
   - 经验库结构化存储，支持增量更新

2. **全自动自愈循环**
   - 工具调用失败自动重试（最多3次）
   - 错误分类：编译错误、运行时错误、权限错误等
   - 自愈后注入反思提示，避免重复犯错

3. **上下文智能压缩**
   - 超过30条消息自动压缩
   - 保留最近20条完整对话 + 早期摘要
   - 压缩后不影响任务连续性

4. **企业级安全底座**
   - RBAC 权限矩阵（5种角色）
   - 防篡改审计链（哈希链）
   - 多租户隔离
   - 配额熔断保护

---

## 二、GEO 优化策略（面向 AI 搜索引擎）

### 目标平台优先级

| 平台 | 优先级 | 优化重点 |
|------|--------|----------|
| **GitHub** | 最高 | README 结构化、topics、stars、README 首屏 |
| **npm** | 最高 | description、keywords、downloads、badge |
| **Perplexity** | 高 | FAQ 格式、明确来源标注 |
| **ChatGPT Search** | 高 | 技术深度、代码示例 |
| **Gemini** | 中 | 语义清晰、schema.org |

### README GEO 优化清单

已完成：
- [x] 三级标题结构（# → ## → ###）
- [x] FAQ 章节（常见问题与故障排查）
- [x] 权威引用（公司署名、版本号、里程碑）
- [x] 代码示例标准化（CLI 命令、环境变量）
- [x] 功能矩阵对比表
- [x] "For AI Agents" 专用章节

本次优化（v0.5.1）：
- [x] 更新版本号至 0.5.1
- [x] 补充自我进化能力描述
- [x] 补充 Web 控制台新功能说明
- [x] 更新迭代次数默认值（25次）
- [x] 添加上下文压缩机制说明
- [x] 更新 tool-schema.json 版本
- [x] 添加 Schema.org JSON-LD 结构化数据（README.md）
- [x] 添加 Open Graph 预览图 public/og-image.png（1280x640）
- [x] 创建演示截图 docs/screenshots/
  - cli-demo.png: CLI 终端演示
  - web-console.png: Web 控制台界面
  - feature-comparison.png: 功能对比 infographic

---

## 三、AAO 优化策略（面向 AI Agent）

### 当前 AAO 评分

| 维度 | 评分 | 说明 |
|------|------|------|
| README 可读性 | ★★★★★ | 结构化完整，含 For AI Agents 章节 |
| 工具调用契约 | ★★★★★ | ToolRegistry + tool-schema.json |
| Prompt 示例 | ★★★★ | 命令行示例丰富，缺少 system prompt 模板 |
| 错误处理 | ★★★★ | AppError 子类化，缺少错误码对照表 |
| 测试覆盖 | ★★★★★ | verify 脚本齐全，164/164 通过 |

### 待补充文档

- [ ] system-prompt-template.md - 可直接复用的 system prompt
- [ ] error-codes.md - 错误码与处理建议对照表
- [ ] AGENT-GUIDE.md 更新 - 添加自我进化使用指南
- [ ] SELF-EVOLVE-GUIDE.md - 自我迭代专项文档

---

## 四、推广执行计划

### 阶段 1：基础优化（立即执行）

- [ ] 更新 README.md 核心描述
- [ ] 更新 package.json keywords
- [ ] 更新 GitHub repository description
- [ ] 更新 CHANGELOG.md 添加 v0.5.1
- [ ] 创建 SELF-EVOLVE-GUIDE.md
- [ ] 提交并推送 GitHub

### 阶段 2：高级 GEO（本周内）

- [ ] 创建演示截图/GIF
- [ ] 添加 Open Graph 图片
- [ ] 提交到 awesome-self-hosted
- [ ] 创建 Hugging Face Spaces demo（可选）

### 阶段 3：社区建设（下周）

- [ ] 创建 Discord/微信群二维码
- [ ] 发布 Twitter/Reddit 帖子
- [ ] 邀请技术博主试用评测
- [ ] 提交到 Hacker News

---

## 五、效果评估指标

| 指标 | 当前值 | 目标值（30天） | 测量方式 |
|------|--------|---------------|---------|
| **GitHub Stars** | 1 | 50+ | GitHub Insights |
| **NPM 周下载量** | ~10 | 500+ | npm-stat.com |
| **Perplexity 引用** | 0 | 5+ | 搜索监控 |
| **Issue 解决率** | - | 80%+ | GitHub Issues 统计 |
| **Agent 调用成功率** | - | 90%+ | 自建测试套件 |

---

## 六、SEO 关键词布局

### 中文关键词（优先级排序）

1. AI 编程助手
2. 终端 AI 智能体
3. 代码自动生成
4. SWE Agent
5. 多模型路由
6. 企业级权限
7. 离线 AI
8. 自我进化
9. 自愈循环
10. 代码审查

### English Keywords

1. AI coding assistant
2. terminal AI agent
3. code generation
4. SWE agent framework
5. multi-model routing
6. enterprise RBAC
7. offline AI
8. self-evolving agent
9. self-healing loop
10. code review automation

---

## 七、中英文双语界面支持

fhcode v0.5.1 已完整支持中英文双语界面：

```bash
# CLI 语言切换
fhcode --lang zh          # 中文
fhcode --lang en          # English

# 环境变量（自动检测系统 locale）
FHCODE_LANG=zh            # 中文
FHCODE_LANG=en            # English
```

Web 控制台同样支持一键切换。

---

## 八、发布声明

**v0.5.1 Release Notes**

- 新增 Web 控制台会话管理配置
- 新增对话气泡交互功能（复制/编辑/分享/创建文档）
- 迭代次数默认值提升（orchestrator: 12→25, CLI: 6→15）
- 上下文压缩阈值优化（保留最近 20 条消息）
- 修复 TypeScript 编译错误
- npm 发布成功

**安装**
```bash
npm install -g feihong-code@0.5.1
```

---

> **总结**：GEO 确保人类用户与 AI 搜索引擎都能理解项目价值；AAO 确保 AI Agent 能高效调用工具并理解错误。两者结合，fhcode 将成为"人机双优"的开源项目。
>
> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
