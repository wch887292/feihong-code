# feihong-code v0.5.1 发布说明

**发布时间**：2026-08-22  
**版本**：0.5.1  
**状态**：✅ 已发布到 npm

---

## 一、新增功能

### 1. Web 控制台会话管理配置

在设置面板新增「会话管理」分组，支持三种智能会话模式：

- **发送消息前自动新建对话**：每次发消息时自动创建全新对话
- **页面打开时自动新建对话**：刷新页面后自动清空当前任务
- **新建对话时清空历史上下文**：确保新任务不受历史干扰

配置自动持久化到 `localStorage`，关闭浏览器后仍保持。

### 2. 对话气泡交互功能

最终回复气泡右上角新增 ⚙️ 操作按钮，hover 时显示快捷菜单：

| 功能 | 说明 |
|------|------|
| 📋 复制 | 一键复制回复内容到剪贴板 |
| ✏️ 编辑 | 弹出编辑框，可修改内容 |
| 🔗 分享链接 | 生成 base64 编码的 URL，方便跨设备分享 |
| 📄 创建文档 | 下载为 `.md` Markdown 文件 |

### 3. 迭代次数优化

| 组件 | 原默认值 | 新默认值 | 说明 |
|------|---------|---------|------|
| orchestrator | 12 次 | **25 次** | 核心引擎循环上限 |
| CLI 运行命令 | 6 次 | **15 次** | 单任务执行上限 |
| SWE Agent 模式 | 6 次 | **15 次** | 全自动软件工程上限 |

用户仍可通过 `--max-iterations N` 手动指定任意值。

### 4. 上下文压缩阈值优化

- 压缩触发阈值：保持 30 条消息
- 保留最近对话：**10 轮 → 20 条消息**（更保守的压缩策略）
- 压缩质量提升：保留更多关键信息，减少遗忘

---

## 二、技术改进

### TypeScript 编译修复

修复了 `src/self-evolve/hook.ts` 的类型声明问题，添加 `manager.d.ts` 类型文件，确保构建成功。

### 代码结构优化

- `sessionConfig` 状态统一管理
- 持久化逻辑集中到 `persistSessionConfig()` 函数
- 错误处理更健壮，localStorage 读写均有 try-catch 保护

---

## 三、对标竞品优势

| 能力 | fhcode v0.5.1 | Claude Code | Cursor | Codex | OpenCode |
|------|---------------|-------------|--------|-------|----------|
| **自我进化** | ✅ 全自动 | ❌ | ❌ | ❌ | ❌ |
| **自我修复** | ✅ 3次自愈 | ⚠️ 部分 | ❌ | ⚠️ | ❌ |
| **迭代上限** | 25次（可配） | 未公开 | 未公开 | 未公开 | 未公开 |
| **多模型路由** | DeepSeek/通义/Ollama/OpenAI | 仅Anthropic | 仅Claude | 仅OpenAI | 多模型 |
| **离线私有化** | ✅ 本地Ollama | ❌ | ❌ | ❌ | ⚠️ |
| **企业RBAC** | ✅ 完整审计链 | ✅ | ✅ | ❌ | ❌ |
| **Web控制台** | ✅ BETA | ❌ | ❌ | ❌ | ❌ |

---

## 四、安装升级

### npm 安装（推荐）

```bash
# 全局安装
npm install -g feihong-code@0.5.1

# 国内镜像
npm install -g feihong-code@0.5.1 --registry=https://registry.npmmirror.com
```

### 验证安装

```bash
fhcode --version
# 输出：0.5.1

fhcode chat
# 进入离线对话模式
```

---

## 五、中英文双语支持

```bash
# CLI 语言切换
fhcode --lang zh    # 中文界面
fhcode --lang en    # English interface

# 环境变量（自动检测系统 locale）
export FHCODE_LANG=zh   # 中文
export FHCODE_LANG=en   # English
```

Web 控制台同样支持一键切换。

---

## 六、技术栈

- **运行时**：Node.js >= 18
- **语言**：TypeScript 5.x
- **依赖**：express ^4.21.2, zod ^4.4.3
- **许可证**：MIT

---

## 七、相关链接

- 📦 **npm 包**：https://www.npmjs.com/package/feihong-code
- 🐙 **GitHub**：https://github.com/wch887292/feihong-code
- 🌐 **官网**：https://www.klai.top
- 📖 **文档**：https://github.com/wch887292/feihong-code#readme

---

## 八、署名

- **公司**：晋江市飞虹智科技企业管理有限公司
- **中心**：飞扬企源研发中心
- **负责人**：吴赐虹

---

*© 2026 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹*
*Released under the [MIT License](./LICENSE).*
