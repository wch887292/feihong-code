#!/bin/bash
# fhcode 三重加密版本部署脚本（服务器端执行）
# 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
# D1 修复(2026-09-27)：变量驱动；serve 子命令必须加 -- 分隔符；对齐 fhcode-v843 / dist/cli/index.js
set -e

# ── 部署参数（必须与线上实例保持一致）──
DEP_DIR=/www/dk_project/fhcode-v843
APP_NAME=fhcode-v843
PORT=18080
ENTRY=dist/cli/index.js
NODE_OPTS="--max-old-space-size=256"

cd "$DEP_DIR"

echo "=== 1. 解压代码 ==="
tar -xzf /tmp/fhcode-deploy.tar.gz -C "$DEP_DIR/"
ls shared/secure-store.js && echo "secure-store 已就位"

echo "=== 2. 依赖确认 ==="
ls node_modules/ | grep -E '^(express|zod)$' >/dev/null && echo "依赖 OK"

echo "=== 3. 设置 FH_SECRET 主密钥（持久化，用于 AES 存储加密）==="
if [ ! -f "$DEP_DIR/.fh_secret_env" ]; then
  FH_SECRET=$(openssl rand -hex 24)
  echo "$FH_SECRET" > "$DEP_DIR/.fh_secret_env"
  chmod 600 "$DEP_DIR/.fh_secret_env"
  echo "已生成 FH_SECRET"
else
  echo "FH_SECRET 已存在，复用"
fi
FH_SECRET=$(cat "$DEP_DIR/.fh_secret_env")

echo "=== 4. 重启服务（注入 FH_SECRET）==="
pm2 delete "$APP_NAME" 2>/dev/null || true
FH_TOKEN=$(cat "$DEP_DIR/.fh_token")
FH_WEB_PORT=$PORT FH_HOME="$DEP_DIR/data" FH_WEB_TOKEN=$FH_TOKEN FH_SECRET=$FH_SECRET \
  pm2 start "$ENTRY" --name "$APP_NAME" --node-args="$NODE_OPTS" --cwd "$DEP_DIR" -- serve --port "$PORT"
pm2 save >/dev/null 2>&1 || true

echo "=== 5. 等待启动并健康检查 ==="
sleep 4
curl -s -m 5 "http://127.0.0.1:$PORT/api/health" | head -c 150
echo ""

echo "=== 6. 验证加密基础设施 ==="
echo "--- 会话文件加密状态 ---"
head -c 40 "$DEP_DIR/data/web-sessions.json" 2>/dev/null || echo "(无会话文件)"
echo ""
echo "--- 密钥文件 ---"
ls -la "$DEP_DIR/.secret" "$DEP_DIR/rsa_public.pem" "$DEP_DIR/rsa_private.pem" 2>/dev/null | awk '{print $1, $NF}'
echo "=== 部署完成 ==="
