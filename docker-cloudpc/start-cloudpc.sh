#!/usr/bin/env bash
# 云电脑视觉桌面实例启动脚本
# 启动顺序：Xtigervnc(X+VNC) → openbox(窗口管理器) → xterm → websockify(noVNC) → cloud-agent(bridge 执行体)
set -e

DISPLAY="${DISPLAY:-:1}"
VNC_PORT="${VNC_PORT:-5901}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
GEOM="1280x720"
WORK="${FH_CLOUD_WORKDIR:-/opt/cloudpc/work}"

mkdir -p "$WORK"
cd "$WORK"

echo "[start-cloudpc] 启动 VNC X 服务 (${DISPLAY}, ${GEOM}) ..."
Xtigervnc "${DISPLAY}" -geometry "${GEOM}" -depth 24 -rfbport "${VNC_PORT}" \
  -localhost -SecurityTypes None -AlwaysShared >/tmp/vnc.log 2>&1 &
sleep 1.5

echo "[start-cloudpc] 启动窗口管理器 openbox + 终端 ..."
DISPLAY="${DISPLAY}" openbox >/tmp/openbox.log 2>&1 &
DISPLAY="${DISPLAY}" xterm -geometry 100x30+10+10 -title "fhcode 云电脑终端" \
  -e bash -c 'echo "fhcode 云电脑已就绪（输入命令或等待手机指令）"; exec bash' >/tmp/xterm.log 2>&1 &

echo "[start-cloudpc] 启动 noVNC (websockify ${NOVNC_PORT} -> ${VNC_PORT}) ..."
websockify --web=/usr/share/novnc "${NOVNC_PORT}" "localhost:${VNC_PORT}" >/tmp/websockify.log 2>&1 &

echo "[start-cloudpc] 启动 fhcode cloud-agent（设备 ${FH_CLOUD_DEVICE_ID:-unknown} -> ${FH_BRIDGE_URL:-unset}）..."
cd /opt/cloudpc
# agent 作为 PID1，容器销毁即退出；其余后台进程随之回收
exec node /opt/cloudpc/cloud-agent.js
