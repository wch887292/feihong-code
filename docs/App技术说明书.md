# 飞虹 Code App 技术说明书（移动控制台）

**产品**：飞虹 Code 移动控制台（Android App + 移动版 H5）
**版本**：v1.0.0（APK）· 移动版 H5
**日期**：2026-08-23
**署名**：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

---

## 目录

1. [系统架构总览](#一系统架构总览)
2. [技术栈](#二技术栈)
3. [服务器部署架构](#三服务器部署架构)
4. [安全模型](#四安全模型)
5. [移动版 H5 前端架构](#五移动版-h5-前端架构)
6. [Android 工程详解](#六android-工程详解)
7. [构建指南](#七构建指南)
8. [API 参考](#八api-参考)
9. [部署与运维指南](#九部署与运维指南)
10. [故障排查](#十故障排查)
11. [安全建议](#十一安全建议)
12. [版本记录](#十二版本记录)

---

## 一、系统架构总览

```
┌─────────────────────────────────────────────────────────┐
│                        手机端                            │
│  ┌──────────────────┐    ┌───────────────────────────┐  │
│  │ Android App      │    │ 手机浏览器                │  │
│  │ (WebView 套壳)   │    │ https://www.jb.klai.top/m/│  │
│  └────────┬─────────┘    └─────────────┬─────────────┘  │
│           └──────────────┬─────────────┘                 │
└──────────────────────────┼──────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼──────────────────────────────┐
│          腾讯云服务器 111.229.190.132                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Nginx 1.28（宝塔面板）                             │  │
│  │  ├─ /            页面入口    → Basic Auth          │  │
│  │  ├─ /m/          移动版静态  → 无 Basic（无敏感数据）│  │
│  │  ├─ /api/auth/login        → Basic Auth（防绕过）  │  │
│  │  └─ /api/*       其余 API   → Bearer fail-closed   │  │
│  └───────────────┬───────────────────────────────────┘  │
│                  │ 反代 127.0.0.1:18080                 │
│  ┌───────────────▼───────────────────────────────────┐  │
│  │ Node.js v24 · PM2 进程 fhcode                      │  │
│  │  ├─ Express Web 服务（端口 18080）                 │  │
│  │  ├─ 任务队列（并发 2，持久化）                     │  │
│  │  ├─ Agent 执行器（模型推理/工具调用/自愈）          │  │
│  │  └─ 数据目录 FH_HOME=/www/dk_project/fhcode/data   │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**关键设计**：

- **单后端多端**：手机 App、移动版 H5、电脑 Web 控制台共享同一个后端服务与数据（任务/自动化/模板/模型配置实时互通）
- **移动版为静态壳**：`/m/` 是纯静态 HTML（无服务端渲染），业务全部通过同源 API 完成
- **同源免 CORS**：移动版页面与 API 同域（www.jb.klai.top），无跨域问题

---

## 二、技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 移动端 | Android WebView + Java | minSdk 26 / target 34 |
| 移动端构建 | Gradle + AGP | Gradle 8.7 / AGP 8.2.2 |
| 前端（移动版 H5） | 原生 HTML/CSS/JS 单文件 | - |
| 后端 | Node.js + Express | Node v24 / Express 4 |
| 后端语言 | TypeScript（编译为 CommonJS） | TS 5.9 |
| 进程管理 | PM2 | 6.x |
| 反向代理 | Nginx（宝塔面板） | 1.28 |
| 操作系统 | OpenCloudOS | 9.6 |
| 依赖 | express、zod | - |

---

## 三、服务器部署架构

### 3.1 目录结构

```
/www/dk_project/
├── fhcode/                      # 后端服务（Node）
│   ├── cli/                     # CLI 入口（serve 命令）
│   ├── web/                     # Web 服务 + 静态资源（电脑 Web 控制台）
│   ├── enterprise/              # 企业级模块（审计/RBAC）
│   ├── node_modules/            # 生产依赖（express/zod）
│   ├── data/                    # FH_HOME 数据目录
│   │   ├── models.json          # 大模型配置
│   │   ├── automations.json     # 快捷指令
│   │   ├── templates.json       # 用户模板
│   │   ├── tasks/               # 任务持久化
│   │   ├── tenants/             # 多租户审计
│   │   └── skills/              # 已安装技能
│   ├── .htpasswd                # Basic Auth 凭据文件（www:www 640）
│   ├── .ba_cred                 # Basic Auth 明文凭据备份（root 600）
│   └── .fh_token                # FH_WEB_TOKEN（root 600）
├── fhcode-mobile/               # 移动版 H5 静态目录
│   ├── index.html               # 移动控制台单页
│   └── fhcode-v1.0.0.apk        # Android 安装包
└── (其他既有站点)
```

### 3.2 Nginx 配置要点

站点配置文件：`/www/server/panel/vhost/nginx/www.jb.klai.top.conf`

```nginx
# HTTP → HTTPS 跳转
server {
    listen 80;
    server_name www.jb.klai.top;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name www.jb.klai.top;
    ssl_certificate     /www/server/panel/vhost/cert/www.jb.klai.top/fullchain.pem;
    ssl_certificate_key /www/server/panel/vhost/cert/www.jb.klai.top/privkey.pem;

    # 移动版静态入口（无 Basic Auth，页面无敏感数据）
    location /m/ {
        alias /www/dk_project/fhcode-mobile/;
        index index.html;
        add_header Cache-Control "no-cache";
    }

    # 登录接口：Basic Auth 防绕过
    location = /api/auth/login {
        auth_basic "fhcode Web Console";
        auth_basic_user_file /www/dk_project/fhcode/.htpasswd;
        proxy_pass http://127.0.0.1:18080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 20m;
    }

    # 其余 API：Bearer 校验（fhcode fail-closed）
    location /api/ {
        proxy_pass http://127.0.0.1:18080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 600s;
        proxy_buffering off;
        client_max_body_size 20m;
    }

    # 页面入口：Basic Auth
    location / {
        auth_basic "fhcode Web Console";
        auth_basic_user_file /www/dk_project/fhcode/.htpasswd;
        proxy_pass http://127.0.0.1:18080;
        ...(同上 proxy 配置)...
    }
}
```

### 3.3 PM2 进程

```
PM2 name: fhcode
命令:     FH_WEB_PORT=18080 FH_HOME=/www/dk_project/fhcode/data FH_WEB_TOKEN=<token> \
          pm2 start cli/index.js -- serve --node-args="--max-old-space-size=256"
端口:     18080（内网监听，Nginx 反代）
内存:     限制堆 256MB（服务器总内存 1.9G，需控制）
开机自启: pm2 startup + pm2 save 已配置（systemd）
```

---

## 四、安全模型

### 4.1 三层鉴权设计

```
请求 → Nginx 路由
  ├─ /m/          静态页面 → 直接放行（仅 UI，无敏感数据）
  ├─ /api/auth/login → Basic Auth（Nginx 校验 .htpasswd）→ 后端签发会话 token
  ├─ /api/*       → 无 Basic，由后端 Bearer 校验（未授权 401）
  └─ /            → Basic Auth（电脑 Web 控制台页面）
```

### 4.2 鉴权流程（移动端）

```
1. App 打开 https://www.jb.klai.top/m/（静态页面，无鉴权要求）
2. 用户输入手机号 → 前端 fetch POST /api/auth/login
   携带内置 Basic 凭据头：Authorization: Basic <base64(fhcode:密码)>
   → Nginx 校验通过 → 后端返回 { token: <会话令牌> }
3. 前端将 token 存 localStorage（键 fh.m.token）
4. 后续所有 API 请求携带：Authorization: Bearer <会话令牌>
   → Nginx 放行（/api/ 无 Basic 要求）→ 后端校验 Bearer（fail-closed）
5. 会话过期（401 unauthorized）→ 清 token → 回登录页
```

### 4.3 为什么这么设计

- **浏览器双 Authorization 头冲突**：浏览器登录后 fetch 显式携带 `Authorization: Bearer` 会覆盖浏览器自动附加的 Basic 头；若 /api/ 也要求 Basic，会因双头或覆盖导致 400/401。因此**业务 API 不依赖 Basic**，只依赖 Bearer。
- **登录接口单独保护**：若 /api/auth/login 无 Basic，攻击者可任意调用换取会话 token 绕过保护，故单独加 Basic Auth。
- **移动版页面不设 Basic**：/m/ 页面仅 UI 空壳（登录页），无业务数据，不设保护；真正的数据访问全部经 Bearer 校验。

### 4.4 凭据清单

| 凭据 | 位置 | 用途 |
|------|------|------|
| Basic Auth 账号密码 | /www/dk_project/fhcode/.htpasswd（.ba_cred 备份） | Nginx 层页面/登录保护；App 内置 |
| FH_WEB_TOKEN（主令牌） | /www/dk_project/fhcode/.fh_token | API Bearer 主令牌（服务端启动注入） |
| 会话 token | 后端内存 SessionStore + web-sessions.json | 登录后签发，API 调用鉴权 |

---

## 五、移动版 H5 前端架构

### 5.1 文件

```
app-mobile/index.html   # 单文件应用（HTML + CSS + JS 内联，约 50KB）
```

### 5.2 结构

- **页面**（.page 容器，通过 .active 切换）：登录页、对话页、任务页、自动化页、模板页、我的页
- **底部 Tab**：5 个导航（对话/任务/自动化/模板/我的）
- **弹层**（.sheet-mask）：用户菜单、新建任务、自动化表单、模型配置、权限设置、任务详情
- **全局组件**：Toast 提示、状态徽章、开关组件

### 5.3 状态管理

```javascript
var state = {
  token: '',            // 会话令牌（localStorage: fh.m.token）
  tasks: [],            // 任务列表
  currentTaskId: null,  // 当前选中任务
  automations: [],      // 快捷指令
  models: [],           // 模型配置
  permissions: {...},   // 权限（localStorage: fh.m.perm）
  ...
};
```

所有状态存于内存 + 关键项持久化 localStorage（token/phone/model/perm/theme）。

### 5.4 API 封装

```javascript
function api(path, method, body, extra) {
  var headers = { 'Content-Type': 'application/json' };
  if (extra && extra.basic) headers['Authorization'] = 'Basic ' + BASIC_AUTH;
  else if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  ...
}
```

- 登录请求带 `{ basic: true }` → 附加内置 Basic 头
- 其余请求自动带 Bearer
- 401 统一处理：清 token → 回登录页

### 5.5 轮询机制

登录后每 5 秒轮询 `/api/tasks`，自动刷新任务状态与思维链路（简单可靠，无需 WebSocket）。

---

## 六、Android 工程详解

### 6.1 目录结构

```
fhcode-android/
├── build.gradle               # 根构建（AGP 8.2.2 + 阿里云镜像）
├── settings.gradle            # 工程设置（include ':app'）
├── gradle.properties          # JVM 参数 + android.overridePathCheck=true
├── local.properties           # sdk.dir（本地，不入库）
└── app/
    ├── build.gradle           # app 模块（compileSdk 34 / minSdk 26）
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/com/fhcode/app/MainActivity.java
        └── res/
            ├── values/        # strings/themes/colors
            ├── drawable/      # ic_launcher_foreground.xml（矢量图标前景）
            └── mipmap-anydpi-v26/  # ic_launcher.xml（自适应图标）
```

### 6.2 MainActivity 核心逻辑

```java
public class MainActivity extends Activity {
    private static final String START_URL = "https://www.jb.klai.top/m/";

    onCreate():
      1. 构建根布局：WebView + 顶部水平进度条
      2. WebSettings 配置：
         - setJavaScriptEnabled(true)
         - setDomStorageEnabled(true)      // localStorage 存 token
         - setMixedContentMode(NEVER_ALLOW)
         - setUserAgentString(... + " fhcode-app/1.0.0")
      3. WebViewClient：
         - shouldOverrideUrlLoading：站内链接保留；外部链接（非 jb.klai.top/github）
           交给系统浏览器 Intent
         - onPageStarted/Finished：控制进度条
      4. 加载 START_URL

    onKeyDown(): 返回键优先 WebView 后退
    onPause/onResume/onDestroy(): WebView 生命周期同步
}
```

### 6.3 关键设计决策

- **WebView 加载远程页面而非本地打包**：页面与 API 同源，无 CORS；页面更新无需重新发版 APK
- **无需处理 Basic Auth 弹窗**：`/m/` 页面不要求 Basic；登录 API 的 Basic 由页面 JS 内置处理（`onReceivedHttpAuthRequest` 无需实现）
- **自适应图标**：minSdk 26 起用 adaptive icon（矢量前景 + 纯色背景），免 PNG 资源
- **外链跳系统浏览器**：避免 App 内 WebView 打开第三方页面

---

## 七、构建指南

### 7.1 环境要求

| 组件 | 版本 | 备注 |
|------|------|------|
| JDK | 17（Microsoft Build） | JAVA_HOME 指向 |
| Android SDK | platform 34 + build-tools 34 | ANDROID_HOME 指向 |
| Gradle | 8.7 | 已解压至 C:/Users/Administrator/.workbuddy/tools/gradle-8.7 |

### 7.2 构建命令

```bash
cd fhcode-android
export JAVA_HOME="C:/Program Files/Microsoft/jdk-17.0.12.7-hotspot"
export ANDROID_HOME="C:/Users/Administrator/AppData/Local/Android/Sdk"
"C:/Users/Administrator/.workbuddy/tools/gradle-8.7/bin/gradle.bat" assembleDebug --no-daemon
```

产物：`app/build/outputs/apk/debug/app-debug.apk`

Release 构建：`gradle assembleRelease`（当前 release 也使用 debug 签名，正式发布需配置独立 keystore）。

### 7.3 镜像配置（国内构建必需）

- **Gradle 发行版**：腾讯云镜像 `https://mirrors.cloud.tencent.com/gradle/gradle-8.7-bin.zip`（官方源 178B/s 不可用）
- **Maven 依赖**：build.gradle repositories 已配置阿里云镜像（google/central/gradle-plugin），官方 repo.maven.apache.org 不可达

### 7.4 踩坑记录

| 问题 | 原因 | 解决 |
|------|------|------|
| 依赖解析失败 | repo.maven.apache.org 国内不可达 | 阿里云镜像 |
| 项目路径含中文报错 | AGP 拒绝非 ASCII 路径 | gradle.properties 加 `android.overridePathCheck=true` |
| 官方 Gradle 下载极慢 | 国外 CDN | 腾讯云镜像 |

---

## 八、API 参考

> 基础路径：`https://www.jb.klai.top/api`（移动版与 Web 版共用）
> 鉴权：除标注外均需 `Authorization: Bearer <token>`；登录接口需 Basic Auth

### 8.1 认证

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | /api/auth/login | Basic Auth | 手机号登录，body: `{phone}`，返回 `{token, phone}` |
| GET | /api/auth/me | Bearer | 当前会话用户 |

### 8.2 任务

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/tasks | 创建任务，body: `{goal, agentType?, permissions?, workspaceDir?, modelId?}` |
| GET | /api/tasks | 任务列表（不含 steps/conversation） |
| GET | /api/tasks/:id | 任务详情（含思维链路 steps + 对话 conversation） |
| POST | /api/tasks/:id/messages | 多轮续接，body: `{message}`（执行中返回 409） |
| DELETE | /api/tasks/:id | 删除任务（运行中返回 400） |

### 8.3 自动化

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/automations | 快捷指令列表 |
| POST | /api/automations | 新建，body: `{name, goal}` |
| POST | /api/automations/:id/run | 一键运行 |
| DELETE | /api/automations/:id | 删除 |

### 8.4 模板

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/templates | 返回 `{builtin[], user[]}` |
| POST | /api/templates | 新建，body: `{title, goal, category?}` |
| DELETE | /api/templates/:id | 删除用户模板 |

### 8.5 大模型

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/models | 模型列表 + defaultId |
| POST | /api/models | 保存/更新，body: `{id?, name, apiBase?, apiKey?, reasoning?}` |
| POST | /api/models/:id/default | 设为默认 |
| DELETE | /api/models/:id | 删除 |

### 8.6 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/drives | 服务器磁盘驱动器列表 |
| GET | /api/workspace | 当前工作区 |
| POST | /api/workspace | 切换工作区，body: `{cwd}` |
| GET | /api/workspace/list?path= | 目录浏览 |
| POST | /api/files/read | 读文件，body: `{path}`（≤2MB） |
| POST | /api/upload | 上传，body: `{name, mime, dataBase64}` |
| GET | /api/skills/market?source=&q= | 插件市场 |
| GET | /api/skills/installed | 已安装技能 |
| POST | /api/skills/install | 安装技能 |
| GET | /api/office/capabilities | 办公助理能力 |
| GET | /api/memory/stats / short / long / history | 记忆系统 |
| POST | /api/memory/summarize | 触发记忆总结 |
| GET | /api/health | 健康检查（公开） |

### 8.7 任务状态机

```
queued（排队中）→ running（执行中）→ done（已完成）
                                    ↘ failed（失败）
```

---

## 九、部署与运维指南

### 9.1 服务管理（PM2）

```bash
pm2 status fhcode              # 查看状态
pm2 logs fhcode                # 查看日志（--lines 50 --nostream）
pm2 restart fhcode             # 重启
pm2 stop fhcode                # 停止
pm2 delete fhcode              # 删除进程
pm2 save                       # 保存进程列表（开机自启）
```

### 9.2 更新后端（代码部署）

```bash
# 本地
tsc -p tsconfig.json --outDir dist_tmp      # 编译（dist 被锁时用临时目录）
# 同步 dist_tmp → dist（被锁文件跳过）
# 打包并上传
tar -czf fhcode-deploy.tar.gz -C deploy_pkg .
scp fhcode-deploy.tar.gz root@111.229.190.132:/tmp/
# 服务器
cd /www/dk_project/fhcode && tar -xzf /tmp/fhcode-deploy.tar.gz
npm install --omit=dev --no-audit --no-fund
pm2 restart fhcode
```

### 9.3 更新移动版 H5 / APK

```bash
scp app-mobile/index.html root@111.229.190.132:/www/dk_project/fhcode-mobile/
scp fhcode-v1.0.0.apk root@111.229.190.132:/www/dk_project/fhcode-mobile/
```

### 9.4 数据备份

```bash
# 备份数据目录（模型配置/任务/审计等）
tar -czf /backup/fhcode-data-$(date +%Y%m%d).tar.gz /www/dk_project/fhcode/data
# 备份 Nginx 配置
cp /www/server/panel/vhost/nginx/www.jb.klai.top.conf /backup/
```

### 9.5 资源监控

```bash
pm2 monit fhcode               # 实时资源监控
free -h                        # 服务器内存（1.9G 总量，注意余量）
df -h /                        # 磁盘
```

---

## 十、故障排查

### 10.1 服务 500 / 无响应

```bash
curl -s http://127.0.0.1:18080/api/health   # 后端直连
pm2 logs fhcode --lines 50 --nostream       # 查看错误
```

若 PM2 进程崩溃：检查内存（`free -h`），确认 `--max-old-space-size=256` 生效；重启 `pm2 restart fhcode`。

### 10.2 任务执行失败

1. 服务器**未配置大模型** → Web 界面「大模型设置」添加（最常见）
2. 查看任务详情中的 error 字段
3. 检查 PM2 日志中的 `task failed` 记录

### 10.3 登录失败 / 401

- 页面 401：Basic Auth 凭据错误 → 检查 .htpasswd 与 Nginx 配置
- API 401：token 过期 → 重新登录
- Nginx 500：.htpasswd 权限不足 → `chown www:www` + 640

### 10.4 Nginx 配置修改后

```bash
nginx -t && nginx -s reload
```

### 10.5 Windows 本机文件锁（开发期）

- dist/ 编译产物被 IDE/Defender 锁 → `tsc --outDir dist_tmp` 绕行
- 残留 280MB+ node 进程（tsc）→ `tasklist | grep node` 后逐个 kill

---

## 十一、安全建议

1. **更换默认凭据**：正式启用后建议重新生成 Basic Auth 密码（htpasswd -cb 覆盖 .htpasswd，同步更新 App 内 `BASIC_AUTH` 常量后重新打包 APK）
2. **Release 签名**：正式分发前生成独立 keystore 并配置 signingConfigs.release
3. **App 内置凭据说明**：APK 内嵌 Basic 凭据可被逆向提取（`Zmhjb2RlOnZyVktTQm1IUkVCZQ==` = base64(fhcode:密码)）；如需更高安全，可改为独立 App 专用账号或加设备校验
4. **最小权限**：建议保持默认权限（写入/命令关闭），按需开启
5. **HTTPS**：已全站 HTTPS（宝塔证书），无明文传输
6. **服务器安全组**：18080 为内网端口，仅 Nginx(80/443) 对外；无需开放其他端口
7. **密钥轮换**：FH_WEB_TOKEN 在 .fh_token，更换后重启服务生效

---

## 十二、版本记录

| 版本 | 变更 | 日期 |
|------|------|------|
| v1.0.0 | 移动控制台首发：Android APK + 移动版 H5 + 服务器 /m/ 入口 | 2026-08-23 |

---

**维护**：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

*© 2026 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 保留所有权利*
