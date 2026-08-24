#!/bin/bash
# fhcode 三重加密版本部署脚本（服务器端执行）
# 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
set -e
cd /www/dk_project/fhcode

echo "=== 1. 解压代码 ==="
tar -xzf /tmp/fhcode-deploy.tar.gz -C /www/dk_project/fhcode/
ls shared/secure-store.js && echo "secure-store 已就位"

echo "=== 2. 依赖确认 ==="
ls node_modules/ | grep -E '^(express|zod)$' >/dev/null && echo "依赖 OK"

echo "=== 3. 设置 FH_SECRET 主密钥（持久化，用于 AES 存储加密）==="
if [ ! -f /www/dk_project/fhcode/.fh_secret_env ]; then
  FH_SECRET=$(openssl rand -hex 24)
  echo "$FH_SECRET" > /www/dk_project/fhcode/.fh_secret_env
  chmod 600 /www/dk_project/fhcode/.fh_secret_env
  echo "已生成 FH_SECRET"
else
  echo "FH_SECRET 已存在，复用"
fi
FH_SECRET=$(cat /www/dk_project/fhcode/.fh_secret_env)

echo "=== 4. 重启服务（注入 FH_SECRET）==="
pm2 delete fhcode 2>/dev/null || true
FH_TOKEN=$(cat /www/dk_project/fhcode/.fh_token)
FH_WEB_PORT=18080 FH_HOME=/www/dk_project/fhcode/data FH_WEB_TOKEN=$FH_TOKEN FH_SECRET=$FH_SECRET \
  pm2 start cli/index.js --name fhcode -- serve --node-args="--max-old-space-size=256" --cwd /www/dk_project/fhcode
pm2 save >/dev/null 2>&1 || true

echo "=== 5. 等待启动并健康检查 ==="
sleep 4
curl -s -m 5 http://127.0.0.1:18080/api/health | head -c 150
echo ""
echo "=== 6. 验证加密基础设施 ==="
echo "--- 会话文件加密状态 ---"
head -c 40 /www/dk_project/fhcode/data/web-sessions.json 2>/dev/null || echo "(无会话文件)"
echo ""
echo "--- 密钥文件 ---"
ls -la /www/dk_project/fhcode/.secret /www/dk_project/fhcode/rsa_public.pem /www/dk_project/fhcode/rsa_private.pem 2>/dev/null | awk '{print $1, $NF}'
echo "=== 部署完成 ==="
