#!/bin/bash
# 飞虹 Code 部署脚本
# 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
#
# 用法：
#   ./deploy.sh              # 使用默认配置部署
#   ./deploy.sh --update     # 拉取最新代码并重新部署
#   ./deploy.sh --stop       # 停止服务
#   ./deploy.sh --logs       # 查看日志
#   ./deploy.sh --backup     # 备份数据

set -e

# 配置
APP_NAME="feihong-code"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${FH_DATA_DIR:-$HOME/.feihong-code}"
PORT="${FH_WEB_PORT:-8080}"
TOKEN="${FH_WEB_TOKEN:-}"
DOCKER_IMAGE="${DOCKER_IMAGE:-feihong-code:latest}"
USE_DOCKER="${USE_DOCKER:-auto}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# 检查 Docker 是否可用
check_docker() {
  if command -v docker &> /dev/null && docker info &> /dev/null; then
    return 0
  fi
  return 1
}

# 检查 Node.js 是否可用
check_node() {
  if command -v node &> /dev/null; then
    local version=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$version" -ge 18 ]; then
      return 0
    fi
  fi
  return 1
}

# 生成随机令牌
generate_token() {
  if [ -z "$TOKEN" ]; then
    TOKEN=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    info "自动生成访问令牌: $TOKEN"
  fi
}

# Docker 部署
deploy_docker() {
  info "使用 Docker 部署..."

  # 检查 docker-compose 是否可用
  if command -v docker-compose &> /dev/null || docker compose version &> /dev/null; then
    info "使用 docker-compose 部署..."
    FH_WEB_TOKEN="$TOKEN" FH_WEB_PORT="$PORT" docker compose up -d --build
    success "Docker 容器已启动"
  else
    info "使用 docker run 部署..."
    docker build -t "$DOCKER_IMAGE" "$APP_DIR"
    docker rm -f "$APP_NAME" 2>/dev/null || true
    docker run -d \
      --name "$APP_NAME" \
      --restart unless-stopped \
      -p "$PORT:8080" \
      -e FH_WEB_TOKEN="$TOKEN" \
      -e FH_ENTERPRISE=true \
      -v "$DATA_DIR:/data/fhcode" \
      "$DOCKER_IMAGE"
    success "Docker 容器已启动: $APP_NAME"
  fi

  info "服务地址: http://localhost:$PORT"
  info "访问令牌: $TOKEN"
}

# Node.js 直接部署
deploy_node() {
  info "使用 Node.js 直接部署..."

  if ! check_node; then
    error "Node.js >= 18 未安装，请先安装 Node.js 或使用 Docker 部署"
  fi

  cd "$APP_DIR"

  # 安装依赖
  info "安装依赖..."
  npm install --production

  # 构建
  info "构建项目..."
  npm run build

  # 创建数据目录
  mkdir -p "$DATA_DIR"

  # 检查是否已在运行
  if pm2 describe "$APP_NAME" &> /dev/null; then
    info "重启现有服务..."
    FH_WEB_TOKEN="$TOKEN" FH_WEB_PORT="$PORT" FH_HOME="$DATA_DIR" pm2 restart "$APP_NAME"
  elif command -v pm2 &> /dev/null; then
    info "使用 pm2 启动服务..."
    FH_WEB_TOKEN="$TOKEN" FH_WEB_PORT="$PORT" FH_HOME="$DATA_DIR" pm2 start dist/cli/index.js --name "$APP_NAME" -- serve --port "$PORT"
    pm2 save
    success "pm2 服务已启动"
  else
    info "直接启动服务（后台运行）..."
    FH_WEB_TOKEN="$TOKEN" FH_WEB_PORT="$PORT" FH_HOME="$DATA_DIR" nohup node dist/cli/index.js serve --port "$PORT" > "$DATA_DIR/server.log" 2>&1 &
    echo $! > "$DATA_DIR/server.pid"
    success "服务已启动 (PID: $(cat "$DATA_DIR/server.pid"))"
  fi

  info "服务地址: http://localhost:$PORT"
  info "访问令牌: $TOKEN"
}

# 停止服务
stop_service() {
  info "停止服务..."

  # Docker
  if docker ps --format '{{.Names}}' | grep -q "^$APP_NAME$"; then
    docker stop "$APP_NAME" && docker rm "$APP_NAME"
    success "Docker 容器已停止"
  fi

  # docker-compose
  if [ -f "$APP_DIR/docker-compose.yml" ]; then
    cd "$APP_DIR" && docker compose down 2>/dev/null || true
  fi

  # pm2
  if command -v pm2 &> /dev/null && pm2 describe "$APP_NAME" &> /dev/null; then
    pm2 stop "$APP_NAME" && pm2 delete "$APP_NAME"
    success "pm2 服务已停止"
  fi

  # 直接进程
  if [ -f "$DATA_DIR/server.pid" ]; then
    PID=$(cat "$DATA_DIR/server.pid")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      success "进程已停止 (PID: $PID)"
    fi
    rm -f "$DATA_DIR/server.pid"
  fi
}

# 查看日志
show_logs() {
  info "查看日志..."

  if docker ps --format '{{.Names}}' | grep -q "^$APP_NAME$"; then
    docker logs -f "$APP_NAME"
  elif command -v pm2 &> /dev/null && pm2 describe "$APP_NAME" &> /dev/null; then
    pm2 logs "$APP_NAME"
  elif [ -f "$DATA_DIR/server.log" ]; then
    tail -f "$DATA_DIR/server.log"
  else
    warn "未找到运行中的服务"
  fi
}

# 备份数据
backup_data() {
  info "备份数据..."
  BACKUP_FILE="$APP_DIR/backup-$(date +%Y%m%d-%H%M%S).tar.gz"
  tar -czf "$BACKUP_FILE" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
  success "备份完成: $BACKUP_FILE"
}

# 主逻辑
case "${1:-}" in
  --update)
    info "更新并重新部署..."
    cd "$APP_DIR"
    git pull
    stop_service
    ;&
  ""|--start)
    generate_token
    if [ "$USE_DOCKER" = "auto" ]; then
      if check_docker; then
        deploy_docker
      else
        deploy_node
      fi
    elif [ "$USE_DOCKER" = "true" ]; then
      deploy_docker
    else
      deploy_node
    fi
    ;;
  --stop)
    stop_service
    ;;
  --logs)
    show_logs
    ;;
  --backup)
    backup_data
    ;;
  --help|-h)
    echo "飞虹 Code 部署脚本"
    echo ""
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  (无)     部署服务"
    echo "  --update 拉取最新代码并重新部署"
    echo "  --stop   停止服务"
    echo "  --logs   查看日志"
    echo "  --backup 备份数据"
    echo "  --help   显示帮助"
    echo ""
    echo "环境变量:"
    echo "  FH_WEB_PORT    服务端口 (默认: 8080)"
    echo "  FH_WEB_TOKEN   访问令牌 (默认: 自动生成)"
    echo "  FH_DATA_DIR    数据目录 (默认: ~/.feihong-code)"
    echo "  USE_DOCKER     是否使用 Docker (auto/true/false, 默认: auto)"
    echo "  DOCKER_IMAGE   Docker 镜像名 (默认: feihong-code:latest)"
    ;;
  *)
    error "未知选项: $1。使用 --help 查看帮助"
    ;;
esac
