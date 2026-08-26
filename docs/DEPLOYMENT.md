# 飞虹 Code CI/CD 部署指南

> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

## 目录

1. [CI 持续集成](#1-ci-持续集成)
2. [CD 持续部署](#2-cd-持续部署)
3. [Docker 部署](#3-docker-部署)
4. [Node.js 直接部署](#4-nodejs-直接部署)
5. [环境变量配置](#5-环境变量配置)
6. [生产环境最佳实践](#6-生产环境最佳实践)

---

## 1. CI 持续集成

### 1.1 工作流概览

项目已配置完整的 CI 工作流（`.github/workflows/ci.yml`），包含 4 个并行 Job：

| Job | 说明 | 触发条件 |
|---|---|---|
| **build** | 多 Node 版本构建 + 离线冒烟测试 | 每次 push/PR |
| **enterprise** | M4 企业能力验证（RBAC/审计/多租户/配额） | 每次 push/PR |
| **security** | 供应链安全 + 密钥扫描 + npm audit | 每次 push/PR |
| **docker** | Docker 镜像构建校验 + 容器冒烟 | 每次 push/PR |

### 1.2 触发条件

```yaml
on:
  push:
    branches: [master, main]
  pull_request:
  workflow_dispatch:  # 手动触发
```

### 1.3 离线安全设计

CI 全程离线运行，不使用任何 API Key / Secrets：

```yaml
env:
  FH_OFFLINE: 'true'
  FH_PROVIDERS: '[]'
```

- PR 来自 fork 也能安全跑完
- 不消耗任何模型 API 额度
- 所有测试基于本地规则引擎

### 1.4 质量门禁

CI 通过以下检查才能合并：

- ✅ TypeScript 类型检查（`npm run typecheck`）
- ✅ 项目构建（`npm run build`）
- ✅ CLI 可用性验证
- ✅ 离线端到端闭环测试
- ✅ 企业能力断言（RBAC/审计链/租户隔离/配额）
- ✅ 发布包安全检查（无密钥/无源码）
- ✅ 仓库密钥扫描
- ✅ Docker 镜像构建 + 容器冒烟

---

## 2. CD 持续部署

### 2.1 发布工作流

项目配置了自动发布工作流（`.github/workflows/release.yml`），包含 5 个阶段：

| 阶段 | 说明 |
|---|---|
| **version** | 准备版本号（从 tag 或手动输入） |
| **build** | 构建 + 测试 + 上传产物 |
| **npm-publish** | 发布到 npm registry |
| **docker-publish** | 构建并推送 Docker 镜像 |
| **github-release** | 创建 GitHub Release + 变更日志 |

### 2.2 触发方式

**方式一：推送标签（推荐）**

```bash
# 创建并推送标签
git tag v1.0.0
git push origin v1.0.0
```

**方式二：手动触发**

在 GitHub Actions 页面选择 "Release" 工作流，点击 "Run workflow"，输入版本号（如 `1.0.0`、`patch`、`minor`、`major`）。

### 2.3 所需 Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置：

| Secret | 说明 | 获取方式 |
|---|---|---|
| `NPM_TOKEN` | npm 发布令牌 | npmjs.com → Access Tokens → Generate New Token |
| `DOCKERHUB_USERNAME` | Docker Hub 用户名 | hub.docker.com 注册账号 |
| `DOCKERHUB_TOKEN` | Docker Hub 访问令牌 | Docker Hub → Account Settings → Security |

> `GH_TOKEN` 由 GitHub 自动注入，无需手动配置。

### 2.4 发布产物

每次发布会生成：

1. **npm 包**：`feihong-code@<version>`
   ```bash
   npm install -g feihong-code
   ```

2. **Docker 镜像**：`<username>/feihong-code:<version>` 和 `:latest`
   ```bash
   docker pull <username>/feihong-code:latest
   ```

3. **GitHub Release**：包含变更日志和安装说明

---

## 3. Docker 部署

### 3.1 快速启动

```bash
# 克隆项目
git clone <repo-url> feihong-code
cd feihong-code

# 使用 docker-compose 启动
FH_WEB_TOKEN=$(openssl rand -hex 32) docker compose up -d

# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f
```

### 3.2 docker-compose.yml 说明

```yaml
services:
  fhcode:
    build: .
    image: feihong-code:0.1.0
    container_name: fhcode
    ports:
      - "8080:8080"
    environment:
      - FH_HOME=/data/fhcode
      - FH_WEB_PORT=8080
      - FH_WEB_TOKEN=${FH_WEB_TOKEN:-change-me-in-production}
      - FH_ENTERPRISE=true
    volumes:
      - fhcode-data:/data/fhcode
    restart: unless-stopped
```

### 3.3 使用预构建镜像

```bash
# 拉取官方镜像
docker pull <username>/feihong-code:latest

# 运行容器
docker run -d \
  --name fhcode \
  --restart unless-stopped \
  -p 8080:8080 \
  -e FH_WEB_TOKEN=your-secret-token \
  -e FH_ENTERPRISE=true \
  -v fhcode-data:/data/fhcode \
  <username>/feihong-code:latest
```

### 3.4 数据持久化

- 容器内数据目录：`/data/fhcode`（对应 `FH_HOME`）
- Docker 命名卷：`fhcode-data`
- 包含：会话记录、审计链、租户数据、团队配置

备份数据：

```bash
docker run --rm -v fhcode-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/fhcode-backup-$(date +%Y%m%d).tar.gz -C /data fhcode
```

---

## 4. Node.js 直接部署

### 4.1 环境要求

- Node.js >= 18
- npm >= 9
- （推荐）pm2 进程管理器

### 4.2 安装与启动

```bash
# 克隆项目
git clone <repo-url> feihong-code
cd feihong-code

# 安装依赖
npm install --production

# 构建
npm run build

# 方式一：使用 pm2（推荐）
npm install -g pm2
FH_WEB_TOKEN=your-secret-token pm2 start dist/cli/index.js --name fhcode -- serve --port 8080
pm2 save
pm2 startup  # 开机自启

# 方式二：直接运行
FH_WEB_TOKEN=your-secret-token node dist/cli/index.js serve --port 8080
```

### 4.3 pm2 常用命令

```bash
pm2 status          # 查看状态
pm2 logs fhcode     # 查看日志
pm2 restart fhcode  # 重启
pm2 stop fhcode     # 停止
pm2 delete fhcode   # 删除
```

---

## 5. 环境变量配置

### 5.1 核心配置

| 变量 | 默认值 | 说明 |
|---|---|---|
| `FH_HOME` | `~/.feihong-code` | 数据目录（会话/审计/租户） |
| `FH_WEB_PORT` | `8080` | Web 服务端口 |
| `FH_WEB_TOKEN` | （空） | Web 访问令牌（生产环境必填） |
| `FH_ENTERPRISE` | `true` | 启用企业级 RBAC/审计 |

### 5.2 企业级配置

| 变量 | 说明 |
|---|---|
| `FH_TENANT` | 租户 ID（多租户隔离） |
| `FH_USER` | 当前用户 ID |
| `FH_ROLE` | 用户角色（owner/admin/developer/viewer） |
| `FH_TENANT_BUDGET_USD` | 租户日成本预算上限 |

### 5.3 模型配置

| 变量 | 说明 |
|---|---|
| `FH_PROVIDERS` | 模型提供商配置（JSON 数组） |
| `FH_OFFLINE` | 离线模式（不调用外部 API） |

---

## 6. 生产环境最佳实践

### 6.1 安全配置

```bash
# 1. 使用强随机令牌
export FH_WEB_TOKEN=$(openssl rand -hex 32)

# 2. 启用企业模式
export FH_ENTERPRISE=true

# 3. 配置租户隔离
export FH_TENANT=production-tenant
export FH_USER=admin
export FH_ROLE=owner

# 4. 设置成本预算
export FH_TENANT_BUDGET_USD=50
```

### 6.2 反向代理（Nginx）

```nginx
server {
    listen 80;
    server_name fhcode.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 6.3 HTTPS 配置（Let's Encrypt）

```bash
# 安装 certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d fhcode.your-domain.com

# 自动续期（已内置）
sudo certbot renew --dry-run
```

### 6.4 监控与告警

```bash
# 健康检查
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/health

# Docker 健康检查
docker inspect --format='{{.State.Health.Status}}' fhcode
```

### 6.5 备份策略

```bash
# 每日备份（添加到 crontab）
0 2 * * * /path/to/feihong-code/deploy.sh --backup

# 保留最近 30 天
find /path/to/backups -name "backup-*.tar.gz" -mtime +30 -delete
```

### 6.6 升级流程

```bash
# 1. 备份数据
./deploy.sh --backup

# 2. 拉取最新代码并重新部署
./deploy.sh --update

# 3. 验证服务
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/health

# 4. 查看日志确认无异常
./deploy.sh --logs
```

---

## 附录：一键部署脚本

项目提供 `deploy.sh` 一键部署脚本，支持 Docker 和 Node.js 两种方式：

```bash
# 部署服务
./deploy.sh

# 更新并重新部署
./deploy.sh --update

# 停止服务
./deploy.sh --stop

# 查看日志
./deploy.sh --logs

# 备份数据
./deploy.sh --backup
```

脚本会自动检测 Docker 是否可用，优先使用 Docker 部署；如不可用则回退到 Node.js 直接部署。
