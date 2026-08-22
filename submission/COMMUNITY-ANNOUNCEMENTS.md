# fhcode v0.5.1 发布公告

## Discord 公告

```markdown
🦞 **飞虹 Code v0.5.1 正式发布！**

一个完全开源的终端 AI 编程智能体，对标 Meta Muse Code。

✨ 新特性：
• 自我进化系统 - 自动从失败中学习
• 自愈循环 - 工具调用失败自动重试
• 迭代上限提升至 25 次
• Web 控制台会话管理配置
• 对话气泡交互（复制/编辑/分享）

🚀 快速开始：
```bash
npm install -g feihong-code
fhcode "你的需求"
```

🔗 GitHub: https://github.com/wch887292/feihong-code
📦 npm: https://www.npmjs.com/package/feihong-code

支持 DeepSeek / 通义 / Ollama / OpenAI，MIT 开源！
```

## 微信公众号/知乎推文

```markdown
# 飞虹 Code v0.5.1：中国自研 AI 编程智能体，对标 Claude Code

## 为什么需要 fhcode？

目前主流 AI 编程工具（Claude Code、Cursor、Codex）都存在以下问题：
- ❌ 闭源商业软件，无法私有化部署
- ❌ 数据必须上传到第三方服务器
- ❌ 缺乏企业级权限控制和审计能力

fhcode 是专为**数据不出内网**场景设计的终端 AI 编程智能体。

## 核心能力

### 1. 多模型路由
支持 DeepSeek、通义千问、Ollama（本地）、OpenAI 兼容网关，自动选优+fallback

### 2. 企业级安全
- RBAC 权限矩阵（5 种角色）
- 防篡改审计哈希链
- 多租户物理隔离
- 配额成本熔断

### 3. 自我进化（M6）
- 任务失败自动记录 → 生成经验 → 后续任务自动应用
- 每日自动复盘报告
- 经验库结构化存储

### 4. 自愈循环
- 工具调用失败自动重试（最多 3 次）
- 错误分类：编译错误、运行时错误、权限错误等
- 自愈后注入反思提示，避免重复犯错

## 快速开始

```bash
# 安装
npm install -g feihong-code

# 离线模式（无需 API Key）
fhcode "帮我写一个 hello.ts 并打印一句话"

# 接入真实模型
export FH_MODEL_NAME=qwen3:8b
export FH_MODEL_TYPE=ollama
fhcode "实现登录模块"
```

## 与主流工具对比

| 能力 | fhcode | Claude Code | Cursor | Codex |
|------|--------|-------------|--------|-------|
| 自我进化 | ✅ | ❌ | ❌ | ❌ |
| 离线私有化 | ✅ | ❌ | ❌ | ❌ |
| 企业RBAC | ✅ | ✅ | ✅ | ❌ |
| 多模型路由 | ✅ | ❌ | ❌ | ❌ |
| 开源 | MIT | 闭源 | 闭源 | 闭源 |

🔗 项目地址：https://github.com/wch887292/feihong-code
```

## 知乎问答回复模板

```markdown
**Q: 有什么好的本地 AI 编程助手推荐？**

A: 推荐试试 **飞虹 Code（fhcode）**，国产开源项目，GitHub 地址：https://github.com/wch887292/feihong-code

核心亮点：
1. **完全开源**：MIT 协议，可私有化部署
2. **多模型支持**：DeepSeek、通义、Ollama、OpenAI 兼容
3. **离线可用**：本地 Ollama 无需联网
4. **企业级**：RBAC 权限、审计链、多租户隔离
5. **自我进化**：自动从失败中学习，持续优化

安装简单：
```bash
npm install -g feihong-code
fhcode "你的需求"
```

适合需要**数据不出内网**、有**企业权限审计**需求的团队。
```

---

*晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹*
