# 飞虹 Code v8.0.0 升级说明书

**文档版本**：v1.0
**发布日期**：2026-09-03
**适用版本**：v7.9.1 → v8.0.0
**负责人**：飞扬企源研发中心

---

## 一、版本概述

飞虹 Code v8.0.0 是**中期架构改进版本（v8.0 预研落地）**，依据《项目客观分析与测试说明书》的三项中期改进建议实施：

| 改进项 | 状态 | 说明 |
|--------|------|------|
| ① SQLite 数据存储 | ✅ 已落地 | 本地电脑部署，基于 Node 内置 `node:sqlite`，零外部依赖 |
| ② Docker 沙盒执行 | ✅ 代码已落地 | 本地电脑部署，补全 sandbox.ts 的 container 模式真实执行层 |
| ③ Honcho 云端记忆 | ✅ 已落地 | 本地配置，SQLite 持久化 + 用户建模 + 语义检索 |

| 维度 | v7.9.1 | v8.0.0 |
|------|--------|--------|
| 后端版本 | 7.9.1 | **8.0.0** |
| 数据存储 | 文件/JSON（tasks/memory/knowledge） | **SQLite 统一存储（feihong.db）** |
| 沙盒执行 | container 模式框架（未实现） | **Docker 容器真实执行层** |
| 记忆系统 | 文件记忆（短期+长期） | **文件记忆 + Honcho 用户建模语义记忆** |
| 新模块 | — | **sqlite-store.ts / docker-sandbox.ts / honcho-store.ts** |
| 新 API | — | **/api/storage/stats、/api/honcho/** | 
| 集成测试 | 33 用例 100% | **34 用例 100%** |
| 冒烟测试 | 51 项 | **+19 项（v8.0 专项）** |

---

## 二、升级内容详解

### 2.1 ① SQLite 数据存储（本地电脑部署）

**新增文件**：`src/shared/sqlite-store.ts`（21KB，独立模块，不覆盖现有文件存储）

#### 技术选型
- 使用 **Node.js v22 内置 `node:sqlite`**（`DatabaseSync`），**零 npm 外部依赖**，无安装成本
- 数据库文件：默认 `$FH_HOME/feihong.db`（可 `FH_DB_PATH` 覆盖）
- WAL 日志模式 + 外键约束，启动自动建表 + 版本化迁移（SCHEMA_VERSION=1）

#### 数据表设计（10 张表）
| 表名 | 用途 | 替代原文件存储 |
|------|------|----------------|
| `meta` | Schema 版本管理 | — |
| `kv` | 通用键值（models/config/settings） | `models.json` |
| `tasks` | 任务持久化 | `~/.feihong-code/tasks/<id>.json` |
| `models` | 模型配置（API Key 加密） | `models.json` |
| `agents` | Agent 注册表 | — |
| `skills` | 技能库 | 技能 JSON |
| `memory` | 记忆键值（MEMORY.md 等） | `memory/*.md` |
| `memory_history` | 会话摘要历史 | auto-summarize 摘要 |
| `users` + `user_memory` | Honcho 用户建模 | — |
| `knowledge` | 知识库文档 | `knowledge/*.md` |

#### 安全特性
- **敏感字段 AES-256-GCM 加密**：`models.api_key`、`config.value` 落盘前用 `secure-store` 主密钥加密（`v1:iv:cipher:tag` 格式）
- 加密/解密自动透明处理，调用方无感知
- 解密失败自动回退（兼容旧明文数据）

#### 与现有文件存储的关系
- SQLite 作为**新增统一存储层**，原文件存储（tasks/memory/knowledge）保留不破坏
- 任务队列等可选用 SQLite 落盘或原文件落盘

### 2.2 ② Docker 沙盒执行（本地电脑部署）

**新增文件**：`src/tools/docker-sandbox.ts`（8KB，补全 sandbox.ts 的 container 模式）

#### 技术实现
- 通过子进程调用 **Docker CLI**（不依赖 dockerode，减少依赖）
- 执行模式：`docker run --rm` 一次性容器，执行完自动销毁
- 工作区挂载：bind mount 宿主机目录 → 容器 `/workspace`

#### 安全加固
| 机制 | 说明 |
|------|------|
| 网络禁用 | 默认 `--network none`（可 `FH_SANDBOX_NETWORK=true` 开启） |
| 只读挂载 | 默认 `readonly`（可 `FH_SANDBOX_READONLY=false` 关闭） |
| 资源限制 | 内存 `-m 512m`、CPU `--cpus 1`（可配置） |
| 危险命令拦截 | 拒绝 `rm -rf /`、`mkfs`、`dd 写块设备`、fork 炸弹 |
| 超时强杀 | 默认 60s，超时 `docker kill` 强杀 |

#### 配置项
| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `FH_SANDBOX_IMAGE` | `node:22-alpine` | 沙盒镜像 |
| `FH_SANDBOX_NETWORK` | `false` | 是否启用网络 |
| `FH_SANDBOX_READONLY` | `true` | 工作区是否只读 |
| `FH_SANDBOX_TIMEOUT` | `60000` | 执行超时（毫秒） |

> **环境依赖**：需要本机 Docker daemon 可用（`docker info` 能返回 ServerVersion）。若本机 Docker Desktop / WSL2 未就绪，执行会返回明确错误提示，不影响其它功能。

### 2.3 ③ Honcho 云端记忆（本地配置）

**新增文件**：`src/memory/honcho-store.ts`（8KB，对标 Honcho/GetZep 语义记忆）

#### 能力对标
| Honcho 能力 | 本地实现 |
|-------------|----------|
| 用户建模 | `users` 表：姓名/偏好/特质画像 |
| 事实记忆 | `user_memory` 表：内容 + 重要度（0~1） |
| 会话摘要 | `memory_history` 表：跨会话检索 |
| 语义检索 | 关键词匹配 + 重要度排序 + 时间加权 |
| 记忆注入 | `buildContextPrompt()` 生成个性化上下文提示词 |

#### 本地部署策略
- 默认 **SQLite 持久化**（复用 sqlite-store），零外部服务依赖
- 可选 `FH_HONCHO_URL` 指向外部 Honcho 服务（API 兼容预留）
- 数据目录 `$FH_HOME/honcho/`
- 与现有文件记忆（`memory/index.ts`）互补共存

#### 记忆自动沉淀
`digestConversation()` 从用户消息自动提取：
- 偏好类事实（"我喜欢/我偏好/我习惯..."）
- 自我介绍（"我叫/我是/我从事..."）
- 自动生成会话摘要并入库

### 2.4 后端 API 新增

| API | 方法 | 说明 |
|-----|------|------|
| `/api/storage/stats` | GET | SQLite 各表统计（tasks/models/skills/...） |
| `/api/honcho/context` | GET | 用户画像 + 记忆 + 上下文提示词 |
| `/api/honcho/remember` | POST | 记录用户事实记忆 |
| `/api/honcho/recall` | GET | 关键词检索记忆 |

**健康检查增强**：`/api/health` 新增 `storage`（SQLite 状态）和 `honcho`（记忆状态）字段。

---

## 三、版本号变更

| 文件 | 变更 |
|------|------|
| `package.json` | `"version": "7.9.1"` → `"8.0.0"` |
| `src/cli/version.ts` | `VERSION = '7.9.1'` → `'8.0.0'` |
| `tests/integration/api.test.js` | 版本断言更新 + 新增 v8.0 存储状态断言 |

---

## 四、编译与测试验证

### 4.1 编译
```
npx tsc    # 0 错误（本机环境可用 node_modules/.bin/tsc.cmd）
```
产物：
- `dist/shared/sqlite-store.js`（21KB）
- `dist/tools/docker-sandbox.js`（8.6KB）
- `dist/memory/honcho-store.js`（9.5KB）

### 4.2 冒烟测试（新增 `tests/smoke-v8.js`，25 项）
| 模块 | 通过 | 说明 |
|------|------|------|
| SQLite 存储 | 11/11 | KV/任务/模型加密/技能/记忆/用户建模/统计 |
| Docker 沙盒 | 6/6 | 可用性/配置/容器执行/输出/Node版本/危险命令拦截 |
| Honcho 记忆 | 8/8 | 画像/事实/检索/提示词/自动沉淀 |
| **合计** | **25/25** | **100% 通过** |

### 4.3 集成测试
`tests/integration/api.test.js`：**34/34 通过（100%）**，含新增存储状态断言。

### 4.4 运行时验证
- 后端启动：`$env:FH_WEB_PORT="8080"; node dist/cli/index.js serve`
- 健康检查：`version=8.0.0`、`storage.ok=true`、`honcho.ok=true`
- 新 API 实测：storage/stats、honcho/remember、honcho/context 全部正常

---

## 五、Docker 沙盒环境说明

**代码已完成、编译通过、冒烟测试 6/6 全部通过。**

环境配置过程中遇到并解决的问题：
- **问题**：Docker Desktop 启动报错 `invalid character 'ï' looking for beginning of value`，daemon 无法启动
- **根因**：PowerShell `Set-Content -Encoding UTF8` 写入 `daemon.json` 时带了 UTF-8 BOM（`EF BB BF`），Docker JSON 解析器无法识别
- **修复**：改用 .NET `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)` 无 BOM 写入
- **镜像加速器**：配置 4 个国内源（docker.1ms.run / docker.m.daocloud.io / hub-mirror.c.163.com / mirror.baidubce.com），解决 Docker Hub 网络不可达问题
- **验证结果**：`node:22-alpine` 镜像拉取成功，容器执行 `echo` + `node -v` 正常，危险命令（`rm -rf /etc`）被拦截

**后续验证方法**：
```powershell
node tests/smoke-v8.js --only=docker
```
预期输出：`✅ Docker 可用`、`✅ 容器执行成功`、`✅ 危险命令拦截`（6/6 通过）

---

## 六、升级步骤

```powershell
# 1. 拉取最新代码
git pull

# 2. 编译
node_modules\.bin\tsc.cmd

# 3. 重启后端（先停旧进程）
Stop-Process -Name node -Force
$env:FH_WEB_PORT="8080"
node dist/cli/index.js serve

# 4. 验证
Invoke-RestMethod http://localhost:8080/api/health   # version=8.0.0, storage.ok=true, honcho.ok=true

# 5. 可选：验证 Docker 沙盒（需 Docker daemon 就绪）
node tests/smoke-v8.js --only=docker
```

---

## 七、环境变量速查（v8.0 新增）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FH_DB_PATH` | `$FH_HOME/feihong.db` | SQLite 数据库路径 |
| `FH_HONCHO_USER` | `default` | Honcho 当前用户 ID |
| `FH_HONCHO_URL` | 空 | 外部 Honcho 服务 URL（预留） |
| `FH_HONCHO_API_KEY` | 空 | 外部 Honcho API Key（预留） |
| `FH_SANDBOX_IMAGE` | `node:22-alpine` | 沙盒镜像 |

---

## 八、风险与后续

| 项 | 说明 |
|----|------|
| `node:sqlite` 实验性 | Node v22 标注 experimental，可能随版本调整 API；已用独立模块封装，影响可控 |
| Docker 环境 | 需本机 Docker daemon 可用；后续可增加"未就绪自动降级本地 shell"策略 |
| 迁移范围 | 当前 SQLite 为新增存储层，未强制替换文件存储；后续可逐步迁移任务队列/知识库 |
| v8.1 展望 | 任务队列 SQLite 落盘、知识库 SQLite 全文检索、Honcho 远程模式联调 |

---

*本文档由飞扬企源研发中心编制，随代码同步更新。*
