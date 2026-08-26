# 飞虹 Code v7.2.0 升级说明书

> **产品名称**：飞虹 Code（feihong-code）
> **版本号**：v7.2.0（自 v7.0.0 升级）
> **发布日期**：2026-08-26
> **发布方**：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心
> **产品定位**：终端 AI 编程智能体，对标 Muse Code / Cursor / Trae / WorkBuddy

---

## 1. 升级概述

### 1.1 为什么升级到 v7.2.0

v7.2.0 是飞虹 Code 从"基础可用"迈向"全面成熟"的关键版本。在 v7.0.0（Electron 桌面版 + 对话流重构）的基础上，本次升级围绕 **Agent 能力、生态集成、差异化创新、跨端交付** 四大方向完成 20+ 项新能力落地，并首次发布安卓版。

### 1.2 版本演进

| 版本 | 日期 | 里程碑 |
|---|---|---|
| v0.6.1 | 2026-08-19 | 对话流输出体验优化 |
| v7.0.0 | 2026-08-24 | Electron 桌面版、对话流全面重构 |
| **v7.2.0** | **2026-08-26** | **全链路升级：Agent能力 + 生态集成 + 差异化创新 + 安卓版** |

### 1.3 交付形态

| 形态 | 说明 | 获取方式 |
|---|---|---|
| **npm 包** | `feihong-code@7.2.0` | `npm i -g feihong-code` |
| **Windows 桌面版** | Electron 绿色版 | `H:\feihong-app\飞虹 Code.exe` |
| **安卓版** | Capacitor APK | `release/飞虹Code-v7.0.0-android.apk`（10.47MB，Android 6.0+） |
| **Web 版** | 内置服务器 | `fhcode serve` → `http://localhost:8081` |

---

## 2. 新增功能详解

### 2.1 阶段一：补全质量突破（对标 Cursor 补全）

#### 2.1.1 跨文件深度上下文
- **原理**：补全时自动构建代码图谱，通过 import 分析 → 依赖文件导出符号 → 使用分析三层检索，将相关符号定义注入补全模型提示词
- **效果**：跨文件场景下补全准确率大幅提升，避免"知道引用但不知道定义"的问题
- **配置**：自动启用，代码图谱最多扫描 500 个文件

#### 2.1.2 补全 Pro 连续推荐
- **原理**：记录用户接受补全的行为（`POST /api/completion/accept`），智能预测下一步操作
- **三种推荐策略**：
  - 函数定义后 → 推荐导出或调用
  - import 后 → 推荐使用方式
  - 连续编辑模式 → 推荐继续编辑
- **接口**：`POST /api/completion/suggest-next`

#### 2.1.3 FIM 训练数据准备
- **脚本**：`scripts/prepare-fim-data.mjs`
- **功能**：一键生成 Fill-in-the-Middle 训练数据（train.jsonl / val.jsonl / meta.json），支持自定义源目录、语言、样本数
- **用途**：为后续专用补全模型微调提供数据基础

### 2.2 阶段二：Agent 能力升级（对标 Cursor Background Agents）

#### 2.2.1 多智能体协同（multi-agent）
- **4 种角色**：架构师 / 开发者 / 测试工程师 / 评审员
- **协作流程**：架构师设计方案 → 开发者实现 → 测试验证 → 评审员审查，最多 3 轮反馈循环
- **质量评分**：0-100 分 + 结构化审查意见
- **接口**：`POST /api/multi-agent/run`、`GET /api/multi-agent/roles`

#### 2.2.2 事件驱动 Agent（event-driven）
- **三种事件源**：
  - **cron 定时任务**：5 段表达式，自动执行
  - **文件变更**：递归监听目录，create/modify/delete，防抖触发
  - **Webhook**：GitHub/GitLab 等来源，事件过滤 + 密钥验证
- **特性**：事件历史持久化（100 条）、手动触发测试、配置启停
- **配置**：`~/.feihong-code/event-driven/config.json`

#### 2.2.3 自定义 Agent 框架（custom-agent）
- **5 个内置模板**：代码审查员 / 测试工程师 / 文档生成器 / 重构专家 / Bug 猎手
- **自定义能力**：Prompt + 工具集定义、分类管理、JSON 导入导出、使用次数统计
- **智能推荐**：输入关键词自动匹配推荐 Agent
- **配置**：`~/.feihong-code/custom-agents/*.json`

### 2.3 阶段三：生态与体验

#### 2.3.1 Electron 桌面端增强
- **全局快捷键**：`Ctrl+Shift+Space`（显示/隐藏）、`Ctrl+Shift+K`（新建任务）、`Ctrl+Shift+L`（快速补全）
- **深度链接**：`fhcode://` 协议，可从外部唤起
- **开机自启**：托盘菜单一键设置
- **增强托盘**：新建任务、快速补全、关于、检查更新

#### 2.3.2 协作工具集成
- **飞书**：交互卡片消息推送、任务完成/失败通知、令牌自动刷新
- **GitHub**：PR 自动审查（批准/请求修改/评论）、Issue 管理、Conventional Commits 提交信息生成

#### 2.3.3 Figma 设计稿转代码
- **能力**：Figma API 拉取 → 组件识别（按钮/输入框/卡片/导航等）→ 设计令牌提取（颜色/字体/间距/阴影）→ 多框架代码生成
- **支持框架**：Tailwind CSS / React / Vue / HTML
- **接口**：`src/integrations/figma.ts`

#### 2.3.4 SSO 单点登录
- **支持协议**：SAML 2.0 / OIDC / OAuth 2.0 / LDAP
- **支持平台**：飞书 / 企业微信 / 钉钉扫码登录
- **特性**：登录 URL 生成、回调处理、24 小时会话、token 验证、用户管理

### 2.4 阶段四：差异化创新

#### 2.4.1 语音编程
- **28 种语音指令**：文件操作 / 代码操作 / 编辑操作 / 视图操作 / AI 操作
- **语音转代码**：函数模板、类模板，多语言支持
- **语音上下文**：会话历史、当前文件跟踪、过期清理
- **示例**："运行" → 执行代码；"跳到第100行" → 跳转；"生成一个排序函数" → AI 生成

#### 2.4.2 AI 原生资料库
- **文档管理**：7 种类型、分类标签、版本管理
- **智能检索**：多维评分（标题/摘要/关键词/标签/内容）、高亮片段
- **自动摘要**：自动提取关键句子
- **关键词提取**：中英文分词 + 停用词过滤

#### 2.4.3 插件市场
- **插件生命周期**：安装 / 卸载 / 启用 / 禁用
- **市场浏览**：搜索、分类、下载量、评分
- **插件 API**：命令注册、视图注册、补全提供者、通知等
- **权限系统**：workspace / git / terminal / ui 权限声明

#### 2.4.4 PWA 移动端适配
- **manifest.json**：可安装、独立显示、3 个快捷方式
- **Service Worker**：离线缓存、API 网络优先、推送通知、通知点击跳转

### 2.5 新增：安卓版

- **技术方案**：Capacitor 8 打包 Web 前端
- **包信息**：`com.feihong.code`，versionCode 1，Android 6.0+（API 23），targetSdk 35
- **双模式**：
  - **离线演示模式**（默认）：内置 mock-api.js 拦截层，完整展示 UI
  - **远程连接模式**：设置中填写服务器地址，连接完整后端
- **图标**：紫蓝渐变 + F 字母自适应图标（5 档密度 + adaptive icon）
- **应用名**：飞虹 Code（深色主题 #1a1a2e）

### 2.6 SWE 成绩对外文案（P3-2）

**背景**：早期对外文档中的对标多为无依据定性表述（如"与 Cursor 处于同一梯队"），缺少量化跑分。v7.2.0 更新为"真实跑分 + 来源标注 + 诚实口径"三要素文案。

- **飞虹 Code 真实成绩**（对外唯一声称口径）：自建 SWE-bench 格式任务集（problem_statement + FAIL_TO_PASS）5 个自包含 JS 任务，真实模型驱动 Orchestrator 修复，预定义测试 `node --test` 真实断言验证，**测试通过率 80%（4/5）**；harness 闭环 mock 2/2、真实模型生成率 3/3。复现：`node scripts/_swe-bench-real.mjs`
- **行业公开对标**（SWE-bench Verified，2026）：Claude Opus 4.8=88.6%、Opus 4.7=87.6%、GPT-5.2=80.0%、Gemini 3.1 Pro=80.6%、豆包 Doubao-Seed-Code+TRAE=78.80%、TRAE=75.2%（字节官方）、Cursor≈51.7%（默认配置，MarkTechPost）
- **诚实声明**：
  1. 自建任务集 ≠ 官方 Verified 500 任务，**不可直接横向对比**，仅展示相对量级
  2. Verified 已被确认数据污染（SWE-ABS：强化测试后平均下降 14.56pp，榜首 78.80%→62.20%），高分须谨慎解读
  3. 官方 Verified 需 Docker+pytest，本机未复测，**不对官方榜单声明成绩**
- **更新文件**：`docs/BENCHMARK_REPORT_zh.md` / `docs/BENCHMARK_REPORT_en.md`（新增第十三章量化对标章节）、`docs/geo-feihong-code.html`（FAQ 新增 SWE 成绩问答）、本说明书

---

## 3. 升级操作步骤

### 3.1 升级 npm 包

```bash
# 全局升级
npm i -g feihong-code@7.2.0

# 项目内升级
npm i feihong-code@7.2.0

# 验证版本
fhcode --version
```

### 3.2 从源码构建升级

```bash
# 拉取最新代码
git pull origin master

# 安装依赖（若新增依赖）
npm install

# 构建
npm run build

# 类型检查
npm run typecheck

# 运行
npm start
```

### 3.3 Windows 桌面版升级

1. 关闭正在运行的飞虹 Code
2. 替换 `H:\feihong-app` 目录为最新版
3. 启动 `飞虹 Code.exe`
4. 验证：托盘图标 → 关于飞虹 Code → 版本应为 v7.2.0

### 3.4 安卓版安装

1. 将 `飞虹Code-v7.0.0-android.apk` 传输到手机
2. 允许"未知来源"后安装
3. 首次打开进入离线演示模式
4. 需要完整功能时：设置 → 填写服务器地址 `http://服务器IP:端口`

### 3.5 配置远程服务器（安卓完整功能）

```bash
# 服务器端启动飞虹 Code Web 服务
fhcode serve --port 8081 --host 0.0.0.0

# 安卓端设置
# 设置界面填写: http://服务器IP:8081
```

---

## 4. 接口变更说明

### 4.1 新增 API（40+）

| 模块 | 接口 | 说明 |
|---|---|---|
| 补全 | `POST /api/completion/accept` | 记录补全接受 |
| 补全 | `POST /api/completion/suggest-next` | 连续推荐 |
| 多智能体 | `POST /api/multi-agent/run` | 执行多角色协同 |
| 多智能体 | `GET /api/multi-agent/roles` | 角色列表 |
| 事件驱动 | `GET/POST /api/event-driven/config` | 配置管理 |
| 事件驱动 | `POST /api/event-driven/trigger` | 手动触发 |
| 事件驱动 | `POST /api/event-driven/webhook/:path` | Webhook 接收 |
| 自定义Agent | `POST /api/custom-agents/match` | 关键词匹配 |
| 自定义Agent | `POST /api/custom-agents/:id/execute` | 执行 Agent |
| 协作 | 飞书/GitHub 集成 | `src/integrations/collaboration.ts` |
| Figma | 设计稿转代码 | `src/integrations/figma.ts` |
| SSO | 单点登录 | `src/integrations/sso.ts` |
| 语音 | 语音编程 | `src/voice/voice-programming.ts` |
| 知识库 | AI 资料库 | `src/knowledge/library.ts` |
| 插件 | 插件市场 | `src/plugins/manager.ts` |

### 4.2 兼容性

- **完全向后兼容** v7.0.0 全部配置与 API
- 既有 CLI 命令不变（`fhcode chat/serve/swe` 等）
- 配置文件路径不变（`~/.feihong-code/`）

---

## 5. 配置说明

### 5.1 新增配置目录

```
~/.feihong-code/
├── event-driven/
│   ├── config.json     # 事件驱动配置
│   └── events.json     # 事件历史
├── custom-agents/      # 自定义 Agent（每个 Agent 一个 JSON）
├── knowledge/          # AI 资料库（index.json + documents/）
└── plugins/            # 插件目录 + plugin-registry.json
```

### 5.2 环境变量

| 变量 | 说明 |
|---|---|
| `FH_WEB_PORT` | Web 服务端口（默认 8081） |
| `FH_WEB_HOST` | 监听地址（远程需设 0.0.0.0） |

---

## 6. 升级验证清单

按顺序执行以下验证：

| # | 验证项 | 命令/操作 | 预期结果 |
|---|---|---|---|
| 1 | 版本号 | `fhcode --version` | 显示 7.2.0 |
| 2 | 构建 | `npm run typecheck` | 退出码 0 |
| 3 | 服务启动 | `fhcode serve` | 健康检查 200 |
| 4 | 多智能体 | `GET /api/multi-agent/roles` | 返回 4 角色 |
| 5 | 自定义Agent | `GET /api/custom-agents` | 返回 5 内置 |
| 6 | 事件驱动 | `GET /api/event-driven/config` | 返回配置 |
| 7 | 补全 | `POST /api/completion` | 返回补全候选 |
| 8 | 桌面版 | 启动 exe | 托盘图标出现 |
| 9 | 安卓版 | 安装 APK | 打开进入演示模式 |

---

## 7. 已知问题与注意事项

1. **GitHub workflow 文件**：`.github/workflows/release.yml` 因 PAT 缺少 `workflow` scope 未包含在 v7.2.0 PR 中，需在 GitHub 补权限后单独提交
2. **安卓离线模式**：AI 生成能力需连接远程服务器，离线仅展示 UI 与演示数据
3. **Android 构建路径**：因项目路径含中文，Android 构建需在纯 ASCII 路径（`H:\feihong-android`）执行
4. **语音编程**：安卓端语音识别依赖系统 WebView 支持
5. **Figma/飞书/GitHub 集成**：需在配置中填写对应 API Key 后方可使用

---

## 8. 回滚方案

如需回滚到 v7.0.0：

```bash
# npm 回滚
npm i -g feihong-code@7.0.0

# 桌面版
# 使用 v7.0.0 的 feihong-app 备份目录

# 配置回滚
# v7.2.0 新增配置目录删除即可，不影响 v7.0.0 既有配置
```

---

*本说明书由晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心编制*
*如需技术支持请联系：飞虹智（klai.top）*
