#!/bin/bash
# 撤销 fhcode 腾讯云部署（可逆：数据保留备份）
# 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
set -e
BK=/www/dk_project/fhcode-backup-20260823

echo "=== 1. 备份数据 ==="
mkdir -p "$BK"
if [ -d /www/dk_project/fhcode/data ]; then
  mv /www/dk_project/fhcode/data "$BK/data" && echo "数据已备份到 $BK/data"
fi
for f in .htpasswd .fh_token .fh_secret_env .ba_cred; do
  [ -f "/www/dk_project/fhcode/$f" ] && mv "/www/dk_project/fhcode/$f" "$BK/" && echo "备份 $f"
done
ls "$BK" | head -10

echo "=== 2. 停止并删除 PM2 进程 ==="
pm2 delete fhcode 2>/dev/null || echo "进程不存在或已删除"
pm2 save >/dev/null 2>&1 || true
sleep 1
ss -tlnp 2>/dev/null | grep 18080 && echo "⚠️ 18080 仍在监听" || echo "18080 已释放 ✅"

echo "=== 3. 恢复 Nginx 原配置 ==="
if [ -f /www/server/panel/vhost/nginx/www.jb.klai.top.conf.bak.fhcode ]; then
  cp /www/server/panel/vhost/nginx/www.jb.klai.top.conf.bak.fhcode \
     /www/server/panel/vhost/nginx/www.jb.klai.top.conf
  echo "原配置已恢复"
  nginx -t 2>&1 | grep -E 'successful|failed' || true
  nginx -s reload && echo "Nginx 已重载"
else
  echo "⚠️ 未找到原配置备份，跳过 Nginx 恢复"
fi

echo "=== 4. 删除部署目录 ==="
rm -rf /www/dk_project/fhcode /www/dk_project/fhcode-mobile
echo "fhcode 与 fhcode-mobile 目录已删除"

echo "=== 5. 清理临时文件 ==="
rm -f /tmp/fhcode-deploy.tar.gz /tmp/deploy-server.sh /tmp/deploy-secure.sh /tmp/fhcode-test.log 2>/dev/null || true
echo "临时文件已清理"

echo "=== 撤销完成 ==="
