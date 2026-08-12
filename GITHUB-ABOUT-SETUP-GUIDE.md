# GitHub Repository About 配置指南

> 飞虹 Code（fhcode）- 提升仓库可见度的最终配置步骤

## 当前状态

- **Repository URL**: https://github.com/wch887292/feihong-code
- **Description**: (未设置)
- **Topics**: (未设置)
- **Homepage**: (未设置)

## 自动配置（推荐）

### 方式一：GitHub CLI（需刷新 Token 权限）

```bash
# 检查当前 Token 权限
gh auth status

# 刷新 Token，添加 write:repository 权限
gh auth refresh -h github.com -s repo,write:repository

# 执行更新
gh repo edit wch887292/feihong-code \
  --description "飞虹 Code — 终端 AI 编程智能体，对标 Meta Muse Code。支持多模型路由（DeepSeek/通义/Ollama）、企业级 RBAC 权限、防篡改审计链、多租户隔离、配额治理、全自动 SWE Agent。M0→M9.1 全部完成，生产就绪。" \
  --homepage "https://github.com/wch887292/feihong-code" \
  --add-topic ai-agent --add-topic coding-agent --add-topic swe-agent --add-topic autonomous-agent \
  --add-topic multi-agent --add-topic cli --add-topic llm --add-topic typescript \
  --add-topic deepseek --add-topic ollama --add-topic openai --add-topic rbac \
  --add-topic enterprise --add-topic multi-tenant --add-topic code-generation \
  --add-topic test-generation --add-topic self-evolving --add-topic offline-mode --add-topic muse-code
```

### 方式二：GitHub Web 界面（最简单）

1. 访问 https://github.com/wch887292/feihong-code
2. 点击右上角 **Settings** 按钮
3. 在 **About** 部分填写：
   - **Description**: 飞虹 Code — 终端 AI 编程智能体，对标 Meta Muse Code。支持多模型路由（DeepSeek/通义/Ollama）、企业级 RBAC 权限、防篡改审计链、多租户隔离、配额治理、全自动 SWE Agent。M0→M9.1 全部完成，生产就绪。
   - **Website**: https://github.com/wch887292/feihong-code
   - **Topics**: 输入以下标签（每行一个或逗号分隔）
     ```
     ai-agent, coding-agent, swe-agent, autonomous-agent, multi-agent, cli, llm, typescript, deepseek, ollama, openai, rbac, enterprise, multi-tenant, code-generation, test-generation, self-evolving, offline-mode, muse-code
     ```
4. 点击 **Save changes**

### 方式三：GitHub API（使用个人访问 Token）

```bash
# 创建新的 Personal Access Token（Fine-grained）
# 访问: https://github.com/settings/tokens/new
# 选择权限: Repository permissions -> Administration -> Read and write

TOKEN="your_new_token_here"
REPO="wch887292/feihong-code"

curl -X PATCH "https://api.github.com/repos/$REPO" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "飞虹 Code — 终端 AI 编程智能体，对标 Meta Muse Code。支持多模型路由（DeepSeek/通义/Ollama）、企业级 RBAC 权限、防篡改审计链、多租户隔离、配额治理、全自动 SWE Agent。M0→M9.1 全部完成，生产就绪。",
    "homepage": "https://github.com/wch887292/feihong-code",
    "topics": ["ai-agent", "coding-agent", "swe-agent", "autonomous-agent", "multi-agent", "cli", "llm", "typescript", "deepseek", "ollama", "openai", "rbac", "enterprise", "multi-tenant", "code-generation", "test-generation", "self-evolving", "offline-mode", "muse-code"]
  }'
```

## 推荐的 Topics 列表

这些标签将提升项目在 GitHub 搜索和 AI 搜索引擎中的可见度：

| 类别 | Topics |
|------|--------|
| **AI/Agent** | ai-agent, coding-agent, swe-agent, autonomous-agent, multi-agent |
| **技术栈** | cli, llm, typescript, deepseek, ollama, openai |
| **企业功能** | rbac, enterprise, multi-tenant, code-generation, test-generation |
| **特色** | self-evolving, offline-mode, muse-code |

## 验证配置

```bash
# 检查仓库信息
curl -s "https://api.github.com/repos/wch887292/feihong-code" | jq '.description, .topics'

# 或使用 gh CLI
gh repo view wch887292/feihong-code --json description,topics
```

## 注意事项

1. **Token 权限**：确保使用具有 `repo` 和 `write:repository` scopes 的 Token
2. **Topics 数量**：GitHub 最多允许 20 个 Topics
3. **Description 长度**：建议 300 字符以内，确保在 GitHub 列表中完整显示
4. **索引延迟**：GitHub 搜索索引可能有 5-10 分钟延迟

## SEO 优化建议

已完成的 GEO/AAO 优化：
- ✅ README.md 包含结构化关键词（AI Agent、SWE、多模型路由等）
- ✅ package.json 包含 20 个关键词
- ✅ AGENT-GUIDE.md 面向 AI Agent 优化
- ✅ tool-schema.json 提供标准化接口定义
- ✅ 完整的文档体系（14 份技术文档）

补充优化：
- [ ] 设置 GitHub Repository Topics
- [ ] 设置仓库描述
- [ ] 可选：添加 GitHub Sponsors 按钮到 README
- [ ] 可选：配置 GitHub Pages 部署文档站点

---

**晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹**
