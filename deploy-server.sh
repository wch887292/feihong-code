#!/bin/bash
# fhcode Web 控制台 腾讯云部署脚本（服务器端执行）
# 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
set -e
cd /www/dk_project/fhcode

echo "=== 1. 验证依赖 ==="
ls node_modules/ | grep -E '^(express|zod)$' && echo "依赖 OK" || { echo "依赖缺失，重新安装"; npm install --omit=dev --no-audit --no-fund; }

echo "=== 2. 生成 Basic Auth 凭据 ==="
BA_PASS=$(openssl rand -base64 12 | tr -d '/+=' | head -c 12)
echo "BasicAuth用户: fhcode"
echo "BasicAuth密码: $BA_PASS"
if command -v htpasswd >/dev/null 2>&1; then
  htpasswd -cb .htpasswd fhcode "$BA_PASS"
else
  openssl passwd -apr1 "$BA_PASS" | awk '{print "fhcode:" $0}' > .htpasswd
fi
echo ".htpasswd 已生成"
# 保存凭据到安全位置
echo "fhcode:$BA_PASS" > /www/dk_project/fhcode/.ba_cred
chmod 600 .ba_cred .htpasswd

echo "=== 3. 生成 FH_WEB_TOKEN ==="
FH_TOKEN=$(openssl rand -hex 32)
echo "$FH_TOKEN" > /www/dk_project/fhcode/.fh_token
chmod 600 .fh_token
echo "FH_WEB_TOKEN 已生成"

echo "=== 4. 测试服务启动 ==="
mkdir -p /www/dk_project/fhcode/data
FH_WEB_PORT=18080 FH_HOME=/www/dk_project/fhcode/data FH_WEB_TOKEN=$FH_TOKEN \
  timeout 6 node --max-old-space-size=256 cli/index.js serve > /tmp/fhcode-test.log 2>&1
echo "启动测试退出码: $?（124=正常超时，服务已能起）"
head -5 /tmp/fhcode-test.log

echo "=== 5. PM2 启动 ==="
pm2 delete fhcode 2>/dev/null || true
FH_WEB_PORT=18080 FH_HOME=/www/dk_project/fhcode/data FH_WEB_TOKEN=$FH_TOKEN \
  pm2 start cli/index.js --name fhcode --node-args="--max-old-space-size=256" --cwd /www/dk_project/fhcode
pm2 save
pm2 status fhcode

echo "=== 6. 健康检查 ==="
sleep 2
curl -s -m 5 http://127.0.0.1:18080/api/health | head -c 200
echo ""
echo "=== 部署脚本完成 ==="
