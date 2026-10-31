# 飞虹Code 三端交付手册

> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
> 版本 v1.0 ｜ 2026-10-31 ｜ 基于 v83–v86 与 v8.13.8/8.13.9 实战复盘沉淀

---

## 〇、一句话总纲

> **先探针，后动手；先判据，后功能；先核验，后宣称。**
> 任何一个"已完成"的结论，必须由**磁盘/网络实测**支撑，不接受 session 状态、代码审阅或口头推断。

---

## 一、交付前必须知道的三件事（架构铁律）

### 1.1 三端拓扑

```
┌──────────┐        ┌─────────────────────┐        ┌──────────────┐
│  手机端   │        │   云端中继 fhrelay    │        │   家电脑      │
│ app.js   │───────▶│ api.klai.top/fhrelay │───────▶│ 8082 单端口  │
│ (APK)    │◀───────│ (云端执行体 v885)     │◀───────│ + /mcp 端点  │
└──────────┘        └─────────────────────┘        └──────────────┘
     │                      │                              │
     │ sync 体系            │ bridge 体系                 │
     │ sync.klai.top:8787   │ api.klai.top:18085          │
     └──────────────────────┴──────────────────────────────┘
```

**8082 单端口承担三项职责**（v8.13 起）：
- Web 控制台（手机局域网直连）
- 云桥接（家电脑 bridge 注册 + 指令执行 + 产物回传）
- MCP 端点（顶层 `/mcp`，供语音 Agent 调 `fhcode_*` 工具）

### 1.2 双令牌体系（两把钥匙，勿混）

| 体系 | 令牌来源 | 用途 |
|---|---|---|
| **sync 体系** | `web-token.json` 的 `token` 字段（`0f63d84d…`） | 同步任务页、对话快照上报 |
| **bridge 体系** | `web-token.json` 的 `bridgeToken` 字段（`30587308…`） | 手机直连/云桥、本机 8082、bridge 设备注册 |

> **铁律**：桥接侧（手机直连/云桥/8082/bridge 注册）一律 `bridgeToken`；同步侧（同步页/快照）一律 sync token。
> 曾因拆分时桥接侧误用 `saved.token`，导致本地电脑/云电脑链路全 401。

### 1.3 三个执行体

| 执行体 | 位置 | 职责 |
|---|---|---|
| 家电脑 8082 | 本机 | 主力执行体（真实桌面环境） |
| 云端 v885 | 服务器 pm2 | 关机续跑兜底（家电脑离线时自动接管） |
| 云端中继 18085 | 服务器 | 指令队列中转 + 产物存储 |

---

## 二、标准交付流程（7 步，可复制粘贴）

### 步骤 0 · 立项：建任务清单

**不要凭记忆开工。** 先建 TaskCreate 清单，每个任务写清"验收标准"。

```
TaskCreate: 修复任务历史持久化（localStorage 配额降级）
  description: saveTasks 改为分级降级写入：持久化剥离 artifacts base64、
               消息截断、超配额逐级裁剪旧任务，失败明确提示。loadTasks 容错。
```

### 步骤 1 · 探针：先定位真根因

**禁止"看代码猜根因"。** 三种探针按优先级：

```bash
# ① 服务存活探针
curl -s -m 5 http://127.0.0.1:8082/api/health
netstat -ano | grep -E ":8082|:18777" | grep LISTENING

# ② 云端状态探针（必须带 HMAC 签名）
node -e "
const fs=require('fs'),https=require('https');
const TOK=JSON.parse(fs.readFileSync('C:/Users/Administrator/.feihong-code/web-token.json','utf8')).bridgeToken;
https.request({host:'api.klai.top',path:'/fhrelay/api/bridge/devices',method:'GET',
headers:{'Authorization':'Bearer '+TOK}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{
const j=JSON.parse(d);const now=Date.now();
(j.devices||[]).forEach(x=>{const age=x.lastSeenAt?Math.round((now-Date.parse(x.lastSeenAt))/1000):null;
console.log((x.name||'')+' | '+(age!==null&&age<=120?'✅在线':'❌离线')+' | 距今='+age+'s');});});})
.on('error',e=>console.error('ERR',e.message)).end();"

# ③ 日志探针（真实死因常在日志里，不在代码里）
tail -40 "C:/Users/Administrator/AppData/Local/Temp/fhrelay_keepalive.log"
```

**探针纪律**：
- 一次只验一个假设，验完再下一个
- 每个探针输出必须能**证伪**（不只是"看起来对"）
- 发现与假设不符 → 立刻回到探针，不许硬凑解释

### 步骤 2 · 定位：区分"表象"与"根因"

**根因分层法**（本次实战验证有效）：

| 层 | 问自己 | 案例 |
|---|---|---|
| L1 表象 | 用户看到什么？ | 手机显示"离线" |
| L2 直接原因 | 哪一行代码/配置导致？ | `lastSeenAt` 超 120s |
| L3 根因 | 为什么会有这个状态？ | 计划任务命令被损坏 → 服务没起 |
| L4 设计缺陷 | 为什么坏了不能自愈？ | register 死锁（唯一出路被自己堵死） |

> **只修 L2 是治标**。本次同时修了 L3（重建计划任务）和 L4（register 死锁旁路），
> 才真正做到"开机即恢复、断了能自愈"。

### 步骤 3 · 改代码：分层落地

按"后端 → 前端 → 文档"顺序，每层改完立刻语法校验：

```bash
# TypeScript 后端
cd /h/feihong-code
"C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" node_modules/typescript/bin/tsc
# ⚠️ 不要用 node_modules/.bin/tsc —— 那是 shim，不能直接 node 调用

# 纯 JS 前端（app-mobile/js/app.js）
"C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" --check app-mobile/js/app.js
```

**改完必查**：是否有函数名写错、变量未导入、`noUnusedLocals` 报错。

### 步骤 4 · 写测试：把 bug 变成可复现用例

**每个修复配一个自动化回归脚本**，这是本次能快速验证的关键。

```javascript
// scripts/test-task-persist.cjs 结构示例
// 1) vm 沙箱加载真实源码片段（不是复制粘贴的副本）
// 2) 可控 mock（localStorage 配额可调）
// 3) 断言修复前会失败的场景
```

实测战绩：`scripts/test-task-persist.cjs` **28/28**、`scripts/check-home-alive.cjs` **9/9**。

### 步骤 5 · 构建：APK 四步链路

```bash
cd /h/feihong-code

# ① 版本号对齐（build.gradle：versionCode 与 versionName 必须同步递增）
#    android/app/build.gradle: versionCode 86 / versionName "8.13.8"

# ② 同步 web 资源（注意是 .bin/cap，不是 @capacitor/cli/bin/cap.js）
node_modules/.bin/cap sync android

# ③ 注入双令牌（保留守卫占位符！）
node scripts/inject-mobile-token.cjs

# ④ 构建（走后台，可能 1-2 分钟）
cd android && ./gradlew assembleRelease
```

**注入器铁律**（v76 事故教训）：
`inject-mobile-token.cjs` 只替换每文件**第一处**占位符。以下检测位是故意保留的：
- `app.js:1062` 守卫 `indexOf('<FH_DEFAULT_TOKEN>')`
- `app.js:1090` 与 `sync-task.js` 的 `indexOf('<FH_SYNC_TOKEN>')`

> 全文盲替换会把注入值清空 → v76 事故。核验时必须确认 `<FH_DEFAULT_TOKEN>` **仍在包内**。

### 步骤 6 · 核验：解包实证（不信构建日志）

```bash
# 一键核验（推荐）：版本号/双令牌/守卫/函数/源码一致性，10 项
node scripts/verify-apk.cjs
```

**核验清单（每次出包必查）**：

| 项 | 判据 |
|---|---|
| 版本号 | `versionCode` / `versionName` 与预期一致 |
| 双令牌 | app.js 命中 bridge+sync 各 1 次；sync-task.js 命中 sync 1 次 |
| 守卫占位符 | `<FH_DEFAULT_TOKEN>` **仍在包内** |
| 功能函数 | 本次新增函数全部命中 |
| 源码一致 | APK 内 app.js ≡ 磁盘 app.js（见下方归一化说明） |
| 交叉验证 | 版本号须与 `aapt dump badging` 同值 |

> **归一化说明（避免假阳性）**：APK 内是注入后的真实令牌（64 位 hex），
> 磁盘源码里是占位符 `<FH_BRIDGE_TOKEN>`。比对时**两侧都要归一化**：
> `re.sub(r"[0-9a-f]{64}", "<TOKEN>")` **且** `re.sub(r"<FH_(BRIDGE|SYNC|DEFAULT)_TOKEN>", "<TOKEN>")`。
> 只归一化一侧会产生"存在差异"的**假阳性**（本次实测踩到并修正）。

> **交叉验证原则**：关键结论至少用**两个独立工具**确认。
> 本次用自研 `verify-apk.cjs`（纯 Node 解 AXML）与 `aapt dump badging` 双测 versionCode，
> 一致才算通过。首个版本的 AXML 解析器因 `TYPE_INT_DEC` 的值存在属性数据区
> （而非 rawValue 字段）而返回 -1 —— **核验脚本自身也要被核验**。

### 步骤 7 · 部署 + 提交 + 交付

```bash
# 云端部署（精确插入单端点，禁止整体覆盖）
python scripts/deploy-cloud-artifacts.py
#   → 自动备份 *.bak-YYYYMMDD → node --check → pm2 restart

# 提交（只提交本次改动，不碰遗留 modified / 业务产物）
git add <明确的文件列表>
git commit -m "..."

# 交付
present_files([apk_path, ...])
```

**提交铁律**：
- 只 `git add` **明确列举**的文件，绝不 `git add .`
- 判断未跟踪文件性质：该入库的（测试夹具、回归脚本）补提交；业务产物（报告 HTML）不入库
- `dist/` 在 `.gitignore` → 编译产物不入库，只需提交 `src/`

---

## 三、验证矩阵（交付前逐项打勾）

| # | 层 | 验证项 | 方法 | 通过标准 |
|---|---|---|---|---|
| 1 | 本地 | 8082 健康 | `curl /api/health` | HTTP 200 |
| 2 | 本地 | MCP 端点 | `POST /mcp` initialize | 返回 serverInfo |
| 3 | 本地 | 保活守护 | `netstat :18777` | LISTENING |
| 4 | 本地 | 计划任务 | `schtasks /query /v /fo list` | 3 个任务「已启用」+ 命令完整 |
| 5 | 本地 | 设备心跳 | 本地设备表 lastSeenAt | ≤120s |
| 6 | 本地 | 密钥落盘 | `bridge-device-secret` 存在 | 长度 ≥16 |
| 7 | 云端 | 设备表 | `GET /fhrelay/api/bridge/devices` | 家电脑 ≤120s |
| 8 | 云端 | 中继端点 | POST/GET artifacts | 404（非 500）= 端点活着 |
| 9 | APK | 版本号 | `aapt dump badging` | 与预期一致 |
| 10 | APK | 双令牌 | 解包计数 | 各 1 次 + 守卫保留 |
| 11 | APK | 源码一致 | 解包 diff | 无差异 |
| 12 | 回归 | 单元/集成测试 | `node --import tsx --test` | 全绿 |
| 13 | 自愈 | **杀进程复现** | 杀 8082+守护 → 触发任务 | 35s 内自动恢复 |
| 14 | 安全 | 匿名注册 | 无令牌 POST register | 401（边界未放宽） |

> **第 13 项是本次新增的黄金检查项**。之前一直用"任务状态=已启用"当健康证明，
> 结果命令早就损坏成 `by user disabled ...` 却浑然不觉。**必须真杀真验。**

---

## 四、踩坑清单（实战血泪，勿再犯）

### 🔴 P0 级：会直接导致交付失败

| 坑 | 现象 | 正确做法 |
|---|---|---|
| **计划任务命令被写坏** | `schtasks /create` 被打断 → 命令变成 `by user disabled ...`，上次结果 `-2147024894` | 创建后**必须** `/query /v` 查「要运行的任务」核对；并做杀进程复现 |
| **register 死锁** | 设备心跳过期 → register 401 → 心跳永不恢复 → 永久卡死（实测 22 天） | 已修：持所有者令牌可无条件重新注册（`isOwnerRequest`） |
| **localStorage 配额** | `saveTasks` 抛 QuotaExceededError 被 catch 吞掉 → 此后所有保存失败 → 历史全空 | 持久化**绝不存 base64**；分级降级写入，每级真实尝试 |
| **schtasks 输出编码** | 中文 Win 输出 GBK，Node utf8 解码乱码 → 误判"命令异常（空）" | `TextDecoder('gbk').decode(buffer)` + buffer 读取 |
| **Git Bash 路径转换** | `/query` 被当路径转换 → 找不到命令 | `export MSYS_NO_PATHCONV=1` |
| **`.bin/tsc` 是 shim** | `node node_modules/.bin/tsc` 报错 | 用 `node node_modules/typescript/bin/tsc` |
| **`cap` 入口路径** | `node_modules/@capacitor/cli/bin/cap.js` MODULE_NOT_FOUND | 用 `node_modules/.bin/cap` |
| **`taskkill //F`** | Git Bash 下 `//F` 不被识别 | PowerShell `Stop-Process -Id <pid> -Force` |
| **注入器全文替换** | 把守卫占位符也替换了 → 注入值被清空（v76 事故） | 只替换第一处；核验守卫仍在 |
| **部署漏声明** | 插入代码漏 `const cmdId = req.params.cmdId;` → 运行时 ReferenceError 500 | 部署后**真发一个请求**验证，不只看 node --check |

### 🟡 P1 级：会导致误判

| 坑 | 现象 | 正确做法 |
|---|---|---|
| **只看 session 状态** | `status=done` 但磁盘 0 落盘 | 永远以磁盘/网络实测为准 |
| **两套在线判据** | 设备页测 `pcUrl/api/health`（指向中继时永远可达）→ 永远"已连接"；任务下发测心跳 → 真离线 | 统一走 `localPcOnline()` |
| **产物 base64 内联** | 50 项 × 270KB base64 → 撑爆 5MB 配额 | DOM 与持久化只存元数据，下载时按 `cmdId` 懒加载 |
| **任务队列僵尸** | `executeTask` 挂起不结算 → `running--` 永不执行 → 并发槽泄漏 → 队列死锁 | `Promise.race` 僵尸回收（maxDuration+5min 强制结算） |
| **fhcode 空转** | agent 反复循环、429 限流 | 按铁律停掉 fhcode，助手直接 Edit 兜底 |
| **云端精简副本** | v885 是 8.8.5 副本（356 行 vs 本地 460 行），**不可整体覆盖** | 只用 Python 精确插入端点 + 备份 + `--check` + pm2 |
| **提交漏夹具** | 619ed33 提交了测试却漏了 fixtures → 新克隆必然失败 | 提交前查 `git status`，判定未跟踪文件性质 |
| **`log()` 不存在** | 在路由模块里误用未定义的 log → 编译失败 | 先 grep 确认辅助函数存在 |
| **核验脚本自身有 bug** | 自研 AXML 解析器把 `TYPE_INT_DEC` 的值读成 rawValue → versionCode 报 -1 | **核验脚本也要被核验**：与 aapt 交叉验证，两工具同值才算过 |
| **单侧归一化假阳性** | 只把 APK 侧令牌抹成 `<TOKEN>`，磁盘侧占位符没抹 → 误报"源码有差异" | 两侧都要归一化（hex + `<FH_*_TOKEN>`） |

---

## 五、交付后的常态化运维

### 5.1 一键体检（先跑这个，别瞎猜）

```bash
cd /h/feihong-code
node scripts/check-home-alive.cjs    # 家电脑保活体检（9 项）
node scripts/verify-apk.cjs          # APK 产物核验（10 项）
node scripts/test-task-persist.cjs   # 任务持久化回归（28 项）
node scripts/smoke-artifacts.cjs     # 产物回传链路冒烟
```

`check-home-alive.cjs` 9 项：计划任务命令完整性（含 `by user disabled` 损坏特征检测）/ 8082 健康 / 18777 守护锁 / 本地设备心跳 / deviceSecret 落盘 / 云端心跳 / 近 10 分钟 401 计数。

退出码 0 = 全绿，1 = 有故障项。

### 5.2 三个保活任务

| 任务 | 触发 | 作用 |
|---|---|---|
| `FHDirect8082` | 登录时 | 拉起 8082（Web 控制台 + 桥接 + MCP） |
| `FHKeepalive` | 登录时 | 拉起双 bridge + 巡检守护（18777 锁） |
| `FHWatchdog` | **每 5 分钟** | 进程被杀后的兜底自愈 |

> FHWatchdog 的安全性：cloud-keepalive 自带 18777 端口锁，重复启动立即退出
> （日志"已有保活实例（锁 18777 被占），退出"）→ 周期触发无副作用。

### 5.3 故障速查表

| 症状 | 先查 | 常见原因 |
|---|---|---|
| 手机显示离线 | `node scripts/check-home-alive.cjs` | 计划任务损坏 / 进程被杀 / 网络断 |
| 一个显示连接一个离线 | 判据是否统一到 `localPcOnline()` | 设备页测可达性、下发测心跳 |
| 重开任务历史空 | localStorage 配额 | base64 内联 → 分级降级 |
| 语音执行报连接失败 | `netstat :8082` / `:18777` | 漏启端口（MCP 已并入 8082） |
| 产物拉取 404 | 云端 GET 端点是否部署 | 方法不匹配（POST vs GET） |
| 任务卡 queued 不动 | 僵尸任务回收 | 并发槽泄漏 |

---

## 六、角色分工（不可越界）

| 角色 | 职责 | 禁止 |
|---|---|---|
| **飞虹Code (fhcode)** | 任务执行本体：写代码、跑 git/npm、跑测试 | — |
| **助手 (WorkBuddy)** | ① 下发窄 goal ② 修 fhcode 遗留 bug（退化/空转/大会话吐空）③ **验证产物（磁盘实测）** | **绝不亲自代写业务代码本体** |

**fhcode 下发命令模板**：

```bash
cd "<报告输出目录>" && MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
FH_SANDBOX_MODE=danger-full-access FH_REQUIRE_APPROVAL=false \
node "H:/feihong-code/dist/cli/index.js" "<窄 goal>"
```

- goal 里路径一律用正斜杠盘符（`H:/`），反斜杠会破坏引号
- goal 内不要出现半角括号，用全角括号
- 大任务（多文件 / 需读旧码对齐 / >30s）一律后台下发，再 `TaskOutput(block=true)` 等
- fhcode 会延续 session，前几轮先读自身代码属正常
- fhcode 空转时：停掉 → 查 session 文件定位根因 → 助手兜底修 → 重新下发

---

## 七、交付物清单模板

每次交付应产出：

- [ ] **可安装产物**：APK（release 签名）+ 路径
- [ ] **验证证据**：版本号(aapt) / 令牌注入计数 / 守卫保留 / 函数命中 / 源码一致
- [ ] **自检脚本**：本次修复对应的回归测试（可重跑）
- [ ] **运维工具**：一键体检脚本
- [ ] **提交记录**：commit hash + 改动文件清单
- [ ] **记忆更新**：当日日志 + 长期约定
- [ ] **present_files**：产物呈现

---

## 八、给下一位执行者的十条提醒

1. **先探针，后动手** —— 不看日志就改代码，等于蒙眼手术
2. **修 L4 设计缺陷** —— 只修表象，下个故障周期照旧
3. **真杀真验** —— 任务"已启用"不等于能跑起来
4. **解包实证** —— BUILD SUCCESSFUL 不等于产物正确
5. **令牌别混** —— bridge 侧用 bridgeToken，sync 侧用 sync token
6. **GBK 陷阱** —— schtasks 输出必须按 gbk 解码
7. **持久化不存 base64** —— 分级降级，每级真实尝试
8. **提交要列举** —— 绝不 `git add .`，业务产物不入库
9. **云端不整体覆盖** —— v885 是精简副本，只精确插入
10. **写进记忆** —— 坑不记录，下一个人还要再踩一遍

---

*本文档由 2026-10-31 全链路复盘实测产出，所有结论均有磁盘/网络证据支撑。*
