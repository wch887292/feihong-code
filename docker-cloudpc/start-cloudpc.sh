#!/usr/bin/env bash
# 云电脑视觉桌面实例启动脚本
# 启动顺序：Xtigervnc(X+VNC) → fluxbox(窗口管理器) → xterm → websockify(noVNC) → cloud-agent(bridge 执行体)
set -e

DISPLAY="${DISPLAY:-:1}"
VNC_PORT="${VNC_PORT:-5901}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
GEOM="1280x720"

echo "[start-cloudpc] 启动 VNC X 服务 (${DISPLAY}, ${GEOM}) ..."
Xtigervnc "${DISPLAY}" -geometry "${GEOM}" -depth 24 -rfbport "${VNC_PORT}" \
  -SecurityTypes None -AlwaysShared -AcceptKeyEvents -AcceptPointerEvents >/tmp/vnc.log 2>&1 &
VNC_PID=$!

sleep 1.5
echo "[start-cloudpc] 启动窗口管理器 fluxbox ..."
DISPLAY="${DISPLAY}" fluxbox >/tmp/fluxbox.log 2>&1 &
DISPLAY="${DISPLAY}" xterm -geometry 90x30+10+10 -title "云电脑终端" >/tmp/xterm.log 2>&1 &

echo "[start-cloudpc] 启动 noVNC (websockify ${NOVNC_PORT} -> ${VNC_PORT}) ..."
websockify --web /usr/share/novnc "${NOVNC_PORT}" "localhost:${VNC_PORT}" >/tmp/websockify.log 2>&1 &
WS_PID=$!

echo "[start-cloudpc] 启动 fhcode cloud-agent（设备 ${FH_CLOUD_DEVICE_ID:-unknown}）..."
cd /app
node /app/cloud-agent.js &
AGENT_PID=$!

# 优雅退出：杀掉所有子进程
cleanup() {
  echo "[start-cloudpc] 收到退出信号，清理..."
  kill -TERM "$AGENT_PID" "$WS_PID" "$VNC_PID" 2>/dev/null || true
  sleep 1
  kill -9 "$AGENT_PID" "$WS_PID" "$VNC_PID" 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "[start-cloudpc] 云电脑实例已就绪 ✅"
echo "  VNC:  localhost:${VNC_PORT} (SecurityTypes=None)"
echo "  noVNC:http://0.0.0.0:${NOVNC_PORT}/vnc.html?autoconnect=true"
echo "  Agent:${FH_CLOUD_DEVICE_ID:-unknown} -> bridge ${FH_BRIDGE_URL:-unset}"

wait
