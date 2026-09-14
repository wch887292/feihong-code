#!/bin/bash
# fhcode 云端执行体：验证配置 → PM2 启动 → 查看日志
set -e
cd /www/dk_project/fhcode-deploy/cloud-agent
echo "== 验证令牌 =="
node -e 'var c=require("./ecosystem.config.js");console.log("token:"+c.apps[0].env.FH_BRIDGE_TOKEN.slice(0,8))'
echo "== 启动 =="
pm2 start ecosystem.config.js
pm2 save
sleep 5
echo "== 日志 =="
pm2 logs cloud-agent --lines 8 --nostream
