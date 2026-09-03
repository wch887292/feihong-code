# 飞虹 Code v7.9.0 升级说明书

**文档版本**：v1.0  
**发布日期**：2026-09-03  
**适用版本**：v7.6.0 → v7.9.0  
**负责人**：飞扬企源研发中心  

---

## 一、版本概述

飞虹 Code v7.9.0 是一次重要的架构升级版本，核心目标是引入 **Hermes Agent 自我进化智能体框架**，实现持久记忆、自演化技能、自动化调度三大核心能力，同时完成后端服务与移动端 APP 的版本对齐。

| 维度 | v7.6.0 | v7.9.0 |
|------|--------|--------|
| 后端版本 | 7.6.0 | **7.9.0** |
| 移动端版本 | 7.8.0 | **7.9.0** |
| 持久记忆 | 基础分层记忆 | **MEMORY.md + USER.md + 自动摘要** |
| 技能系统 | 技能加载器 | **自演化技能 + agentskills.io 兼容** |
| 自动化调度 | 自愈调度器 | **自然语言定时任务** |
| 免密网络层 | 无 | **5节点环形轮转 + Ring Failover** |
| 工具集 | 基础工具 | **TTS + 搜索 + 文件 + 记忆查询** |
| 子系统数量 | 20个 | **21个（新增 Hermes Agent）** |

---

## 二、升级内容详解

### 2.1 后端升级（TypeScript 全栈）

#### 2.1.1 版本号统一
- `package.json`：7.6.0 → **7.9.0**
- `src/cli/version.ts`：`VERSION = '7.6.0'` → **`VERSION = '7.9.0'`**
- 健康检查接口 `/api/health` 返回版本同步更新

#### 2.1.2 编译验证
- TypeScript 编译：**0 错误**
- `dist/` 构建产物：全部重新编译
- 核心文件：`dist/cli/index.js`、`dist/web/server.js`（130KB）、`dist/cli/version.js`

#### 2.1.3 后端已有能力确认（v7.9.0 保持并增强）
- **Agent 核心**（38个文件）：orchestrator、multi-agent、solo-agent、self-heal、self-correction、self-improver、event-driven-agent
- **持久记忆**：layered-memory、context-compactor、experience、auto-summarize
- **技能系统**：skill-loader、skill-market、pua-hooks
- **自我进化**：self-evolve manager（17KB）、hook、self-heal-scheduler
- **多平台桥接**：微信（wecom/mp）、飞书、元宝（配置后启用）
- **工具集**（22个文件）：search、shell、file、browser（8个工具）、mcp、sandbox
- **Web 服务器**（16个文件）：server.ts（122KB）、auth、channels、task-queue、extra-apis
- **知识库**：14个文档加载
- **插件系统**：动态插件管理
- **SSO 认证**：多提供商支持
- **任务队列**：98个任务持久化恢复

### 2.2 移动端升级（Android APP）

#### 2.2.1 新增核心模块：`js/hermes-agent.js`（24KB）
参照 Nous Research Hermes Agent 架构，实现 5 大子系统：

**① MemoryManager — 持久记忆系统**
- `MEMORY.md`：项目上下文 + 长期记忆 + 关键事实，自动沉淀
- `USER.md`：用户画像 + 偏好习惯 + 专业领域，从交互中自动学习
- `digestConversation()`：每轮对话结束自动提取关键事实和用户偏好
- `recall(query)`：关键词检索历史摘要，近期对话加权，最多返回5条
- `setContext/getContext`：项目级键值存储

**② SkillManager — 自演化技能系统**
- 4个内置技能：内容摘要、中英互译、代码审查、小红书文案
- `match(input)`：输入含触发词时自动匹配对应技能
- `execute(skill, content)`：应用技能的增强 prompt 模板
- `extractFromTask()`：从重复任务模式中自动提取可复用技能
- 兼容 **agentskills.io** 开放标准，支持 JSON 安装新技能
- 技能管理：搜索、安装、删除、使用计数追踪

**③ Scheduler — 自动化调度**
- 自然语言时间解析：
  - `每天 9:00` → daily
  - `每周一 10:30` → weekly
  - `每隔 30 分钟` → interval
  - `14:00` → once
- 每30秒后台检查到期任务
- 到期触发 `hermes-scheduled-task` 自定义事件
- 任务管理：启用/禁用/删除/运行计数/下次运行时间

**④ ToolRegistry — 工具集**
- `tts`：文字转语音（浏览器内置 SpeechSynthesis，中文朗读）
- `tts_stop`：停止语音朗读
- `web_search`：免密网页搜索（复用 keyless.js 双源搜索）
- `read_file`：文件读取
- `recall_memory`：持久记忆查询

**⑤ AgentCore — 统一执行循环**
```
用户输入 → 技能匹配 → 记忆注入 → 工具检测 → 大模型回复 → 记忆沉淀
```
- 发送消息时自动检测技能，匹配到则 toast 提示
- 对话结束后自动调用 `onConversationEnd()` 沉淀记忆
- 定时任务到期时触发事件通知主界面

#### 2.2.2 设置面板新增：Hermes Agent 管理区
- **📝 记忆 Tab**：查看/编辑 MEMORY.md 和 USER.md，显示历史任务数和项目上下文数
- **⚡ 技能 Tab**：查看所有技能（内置/自动/自定义），支持 JSON 安装新技能
- **⏰ 调度 Tab**：查看定时任务列表，支持自然语言新建、启用/禁用/删除

#### 2.2.3 免密网络层（Keyless Web Tier，v7.8.0 引入，v7.9.0 保持）
- 5节点环形轮转池：GPT-4o Mini / Claude 3 Haiku / Llama 3.1 70B / Mixtral 8x7B / Wikipedia
- Ring Failover：失败自动轮转下一家，连续失败3次冷却30秒
- 免密搜索：DuckDuckGo HTML + Wikipedia API 双源并行
- 用户未配置模型时自动启用免密层

#### 2.2.4 其他移动端能力（v7.9.0 保持）
- 12款内置 Canvas 小游戏（贪吃蛇/打砖块/弹跳小鸟/飞机射击/2048/打地鼠/俄罗斯方块/记忆翻牌/消消乐/井字棋/跳一跳/五子棋）
- AI 创作中心：文生图/文生视频/图生视频
- 视觉模型：硅基流动 DeepSeek-OCR
- 灵光式闪应用
- 多轮对话（发送锁 + 防抖 + 上下文管理）
- 附件支持：图片/文件/截图/拍照

---

## 三、升级步骤

### 3.1 后端升级

#### 方式一：重新编译（推荐）
```bash
# 1. 进入项目目录
cd H:\Muse Code复刻

# 2. 确认 package.json 版本为 7.9.0
node -e "console.log(require('./package.json').version)"

# 3. 编译 TypeScript
npx tsc

# 4. 验证编译产物
node dist/cli/index.js --version  # 应输出 7.9.0

# 5. 启动服务
$env:FH_WEB_PORT="8080"
node dist/cli/index.js serve

# 6. 验证健康检查
curl http://localhost:8080/api/health
# 应返回 {"ok":true,"version":"7.9.0",...}
```

#### 方式二：一键启动脚本
```bash
node start-web.js
# 自动检查编译 → 清理端口 → 启动服务
```

### 3.2 移动端升级

#### 方式一：安装已构建 APK
```
直接安装 artifacts/fhcode-v7.9.0-release.apk
```

#### 方式二：重新构建 APK
```bash
# 1. 同步前端资源到 android assets
Copy-Item app-mobile\index.html android\app\src\main\assets\public\index.html -Force
Copy-Item app-mobile\css\style.css android\app\src\main\assets\public\css\style.css -Force
Copy-Item app-mobile\js\app.js android\app\src\main\assets\public\js\app.js -Force
Copy-Item app-mobile\js\game-templates.js android\app\src\main\assets\public\js\game-templates.js -Force
Copy-Item app-mobile\js\keyless.js android\app\src\main\assets\public\js\keyless.js -Force
Copy-Item app-mobile\js\hermes-agent.js android\app\src\main\assets\public\js\hermes-agent.js -Force

# 2. 设置 JDK 21
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot"
$env:Path = "$env:JAVA_HOME\bin;" + $env:Path

# 3. 构建
cd android
.\gradlew.bat assembleRelease --no-daemon

# 4. 产物位置
# android\app\build\outputs\apk\release\app-release.apk
```

---

## 四、兼容性说明

### 4.1 运行环境
| 组件 | 最低要求 | 推荐版本 |
|------|----------|----------|
| Node.js | >= 18.0.0 | 22.x LTS |
| 操作系统 | Windows 10+ / Linux / macOS | Windows 11 |
| 浏览器（Web控制台） | Chrome 90+ / Edge 90+ | 最新版 |
| Android（APP） | Android 8.0+ | Android 12+ |
| JDK（APK构建） | JDK 17+ | JDK 21 |

### 4.2 数据兼容性
- **localStorage 数据**：v7.6.0 → v7.9.0 完全兼容，现有对话记录、模型配置、游戏进度全部保留
- **Hermes 记忆数据**：新增 `fh.hermes.memory.md`、`fh.hermes.user.md`、`fh.hermes.history`、`fh.hermes.skills` 等 key，首次启动自动初始化
- **后端任务队列**：98个历史任务自动恢复，无需迁移
- **知识库**：14个文档自动加载，无需迁移

### 4.3 API 兼容性
- `/api/health`：公开接口，返回字段新增 `version`（已更新为 7.9.0）
- 其他 `/api/*` 接口：保持向后兼容，认证机制不变
- 新增 Hermes Agent 相关接口：通过 Web 控制台前端调用，不影响现有 API

---

## 五、回滚方案

### 5.1 后端回滚
```bash
# 1. 停止当前服务
# 找到占用 8080 端口的进程并终止
netstat -ano | findstr :8080
taskkill /PID <进程ID> /F

# 2. 恢复旧版本代码
git checkout v7.6.0  # 或从备份恢复

# 3. 重新编译
npx tsc

# 4. 启动旧版本
node dist/cli/index.js serve
```

### 5.2 移动端回滚
- 安装历史版本 APK：`artifacts/fhcode-v7.8.0-release.apk`
- 或 `artifacts/fhcode-v7.7.6-release.apk`

### 5.3 数据回滚
- Hermes Agent 新增的 localStorage key 不影响现有功能，删除即可：
  ```javascript
  localStorage.removeItem('fh.hermes.memory.md');
  localStorage.removeItem('fh.hermes.user.md');
  localStorage.removeItem('fh.hermes.history');
  localStorage.removeItem('fh.hermes.skills');
  localStorage.removeItem('fh.hermes.scheduled');
  ```

---

## 六、已知问题与限制

| # | 问题 | 影响 | 状态 |  workaround |
|---|------|------|------|------------|
| 1 | 免密层 DuckDuckGo AI 在电脑端网络环境不可达 | 免密聊天在电脑端测试可能失败 | 已知 | 手机端 WebView 跨域限制更宽松，实际以手机实测为准 |
| 2 | 不存在的 API 路径返回 401 而非 404 | 无（安全设计） | 预期行为 | 认证中间件优先，不暴露 API 存在性 |
| 3 | favicon.ico / robots.txt 404 | 无（可选资源） | 已知 | 后续版本补充 |
| 4 | 微信/飞书/元宝桥接默认 disabled | 多平台消息网关不可用 | 预期 | 配置环境变量后启用 |
| 5 | 后端日志中文在 PowerShell 显示乱码 | 仅显示问题，不影响功能 | 已知 | 日志文件本身为 UTF-8 编码 |
| 6 | Hermes 技能自动提炼基于简单规则 | 复杂任务模式可能无法准确提取 | 已知 | 后续版本引入 LLM 辅助提炼 |
| 7 | 自动化调度依赖 APP 前台运行 | APP 后台被杀时定时任务不执行 | 已知 | 后续版本引入后台 Service 或推送唤醒 |

---

## 七、验证清单

升级完成后，请逐项验证：

### 后端验证
- [ ] `node dist/cli/index.js --version` 输出 `7.9.0`
- [ ] 服务启动后端口 8080 正常监听
- [ ] `curl http://localhost:8080/api/health` 返回 `version: "7.9.0"`
- [ ] 首页 `http://localhost:8080/` 返回 200，标题含"飞虹 Code"
- [ ] 未认证访问 `/api/tasks` 返回 401
- [ ] 启动日志显示 11 个子系统全部初始化
- [ ] 无严重错误日志

### 移动端验证
- [ ] APP 版本显示 v7.9.0
- [ ] 设置 → Hermes Agent 面板可正常打开
- [ ] 记忆 Tab 显示 MEMORY.md 和 USER.md 内容
- [ ] 技能 Tab 显示 4 个内置技能
- [ ] 调度 Tab 可创建"每天 9:00"定时任务
- [ ] 发送"帮我翻译这段话"自动匹配"中英互译"技能
- [ ] 多轮对话正常（第二轮能记住第一轮内容）
- [ ] 12 款小游戏全部可玩
- [ ] 创作中心文生图/文生视频/图生视频入口正常

---

## 八、联系方式

- **项目负责人**：吴赐虹
- **研发团队**：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心
- **技术支持**：通过飞虹 Code Web 控制台提交反馈

---

*本文档随版本更新而维护，最新版本以项目仓库 docs/ 目录为准。*
