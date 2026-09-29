#!/usr/bin/env bash
# ============================================================================
# fhcode 云电脑实例编排器 · 一键部署脚本（本地运行，SSH 推送到云端）
# ----------------------------------------------------------------------------
# 作用：
#   1) 把 cloud-pc-manager.js + cloud-agent.js + 视觉桌面镜像文件 推到云端
#   2) 复用已有 .fh_token（升级安全，不重生成，避免设备掉线）
#   3) 用 PM2 拉起 cloud-pc-manager（自动择优 Mode A 视觉桌面 / Mode B 无头沙箱）
#   4) 打印手机端使用说明
#
# 用法：
#   bash deploy-cloud-pc.sh                 # 仅部署管理器（Mode B 无头可用）
#   bash deploy-cloud-pc.sh ./fhcode-cloudpc.tar.gz   # 额外导入视觉桌面镜像(make Mode A 可用)
#
# 前置：本机 ~/.ssh/id_ed25519 可免密登录云端 root
# ============================================================================
set -e

CLOUD_HOST="111.229.190.132"
CLOUD_USER="root"
SSH_KEY="$HOME/.ssh/id_ed25519"
FHCODE_DIR="/www/dk_project/fhcode-v843"
REMOTE_DIR="/www/dk_project/fhcode-cloud-pcs"
IMAGE_TAR="${1:-}"

echo "=== 0. 检查本地私钥与源文件 ==="
[ -f "$SSH_KEY" ] || { echo "❌ 未找到私钥 $SSH_KEY"; exit 1; }
for f in cloud-pc-manager.js cloud-agent/cloud-agent.js docker-cloudpc/Dockerfile.cloudpc docker-cloudpc/start-cloudpc.sh; do
  [ -f "$f" ] || { echo "❌ 缺少源文件 $f"; exit 1; }
done
if [ -n "$IMAGE_TAR" ]; then
  [ -f "$IMAGE_TAR" ] || { echo "❌ 镜像 tar 不存在: $IMAGE_TAR"; exit 1; }
  echo "📦 将导入视觉桌面镜像: $IMAGE_TAR"
fi

SSH_OPTS="-i $SSH_KEY -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o ConnectTimeout=15 -o BatchMode=yes"
SCP_OPTS="$SSH_OPTS"

echo "=== 1. 推送文件到云端 $REMOTE_DIR ==="
ssh $SSH_OPTS "$CLOUD_USER@$CLOUD_HOST" "mkdir -p $REMOTE_DIR/cloud-agent $REMOTE_DIR/docker-cloudpc"
scp $SCP_OPTS cloud-pc-manager.js "$CLOUD_USER@$CLOUD_HOST:$REMOTE_DIR/"
scp $SCP_OPTS cloud-agent/cloud-agent.js "$CLOUD_USER@$CLOUD_HOST:$REMOTE_DIR/cloud-agent/cloud-agent.js"
scp $SCP_OPTS docker-cloudpc/Dockerfile.cloudpc "$CLOUD_USER@$CLOUD_HOST:$REMOTE_DIR/docker-cloudpc/"
scp $SCP_OPTS docker-cloudpc/start-cloudpc.sh "$CLOUD_USER@$CLOUD_HOST:$REMOTE_DIR/docker-cloudpc/"
if [ -n "$IMAGE_TAR" ]; then
  echo "--- 传输并加载视觉桌面镜像 ---"
  scp $SCP_OPTS "$IMAGE_TAR" "$CLOUD_USER@$CLOUD_HOST:/tmp/fhcode-cloudpc.tar.gz"
  ssh $SSH_OPTS "$CLOUD_USER@$CLOUD_HOST" "docker load < /tmp/fhcode-cloudpc.tar.gz && rm -f /tmp/fhcode-cloudpc.tar.gz && echo LOADED_OK"
fi

echo "=== 2. 云端：复用 .fh_token 并拉起管理器 ==="
ssh $SSH_OPTS "$CLOUD_USER@$CLOUD_HOST" bash -s <<'REMOTE'
set -e
FHCODE_DIR="/www/dk_project/fhcode-v843"
REMOTE_DIR="/www/dk_project/fhcode-cloud-pcs"
TOKEN="$(cat "$FHCODE_DIR/.fh_token" 2>/dev/null || echo "")"
[ -n "$TOKEN" ] || { echo "❌ 读取 .fh_token 失败"; exit 1; }
echo "token 读取成功（长度 ${#TOKEN}）"

# 若已存在旧管理器，先删除（不删状态文件，保留已创建实例记录）
pm2 delete cloud-pc-manager >/dev/null 2>&1 || true

PM2_HOME="${PM2_HOME:-$HOME/.pm2}"
NODE_BIN="$(command -v node)"
echo "NODE_BIN=$NODE_BIN"
# 用 env 显式注入，避免依赖脚本内默认路径
cat > "$REMOTE_DIR/start-manager.sh" <<EOF
#!/usr/bin/env bash
export FH_BRIDGE_URL="http://127.0.0.1:18080"
export FH_BRIDGE_TOKEN="$TOKEN"
export FH_PC_MANAGER_ID="pc-cloud-manager"
export FH_PC_MANAGER_NAME="☁️ 云电脑管理器"
export FH_PC_AGENT_JS="$REMOTE_DIR/cloud-agent/cloud-agent.js"
export FH_PC_WORKDIR_BASE="$REMOTE_DIR/pcs"
export FH_PC_STATE_FILE="$REMOTE_DIR/state.json"
export FH_PC_NOVNC_PUBLIC_HOST="api.klai.top"
export FH_PC_NOVNC_BASE_PORT="6080"
export FH_PC_MAX="3"
export FH_PC_IDLE_TTL_MIN="120"
export FH_PC_HTTP_PORT="18100"
exec "$NODE_BIN" "$REMOTE_DIR/cloud-pc-manager.js"
EOF
chmod +x "$REMOTE_DIR/start-manager.sh"

pm2 start "$REMOTE_DIR/start-manager.sh" --name cloud-pc-manager
pm2 save
sleep 3
echo "=== PM2 状态 ==="
pm2 ls | grep -E "cloud-pc-manager|fhcode-v843|cloud-agent" || pm2 ls

echo "=== 管理器日志（尾部） ==="
pm2 logs cloud-pc-manager --lines 20 --nostream 2>/dev/null || tail -20 "$REMOTE_DIR/nohup.log" 2>/dev/null || true

echo "=== 镜像检测 ==="
if docker image inspect fhcode-cloudpc:latest >/dev/null 2>&1; then
  echo "✅ 视觉桌面镜像 fhcode-cloudpc:latest 已就绪 → 创建即带真实桌面"
  echo "   提示：请在腾讯云安全组放行 TCP 6081-6083（noVNC 端口）"
else
  echo "⚠️ 未检测到 fhcode-cloudpc:latest → 当前为无头沙箱模式"
  echo "   构建镜像后 docker save | gzip > fhcode-cloudpc.tar.gz，再 bash deploy-cloud-pc.sh 该tar 即可升级为视觉桌面"
fi
REMOTE

echo ""
echo "=== ✅ 部署完成 ==="
echo "手机端操作："
echo "  1) 在设备列表找到「☁️ 云电脑管理器」"
echo "  2) 对它说：创建云电脑 / 列出云电脑 / 连接云电脑 1 / 销毁云电脑 1"
echo "  3) 创建成功后，在设备列表会出现「云电脑 1」等实例，可对其单独下发指令/截图"
echo "  本地 HTTP API（云端 127.0.0.1:18100，Bearer=$TOKEN）："
echo "    curl -H 'Authorization: Bearer $TOKEN' http://111.229.190.132:18100/api/cloudpc/list"
