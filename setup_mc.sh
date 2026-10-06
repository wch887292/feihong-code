#!/usr/bin/env bash
# MediaCrawler 服务器无头模式配置脚本
# 修改 base_config.py: 关 CDP、开无头、cookie 登录
set -e
cd /www/dk_project/MediaCrawler

# 1. 备份原始配置（用户习惯：改前先留底）
cp config/base_config.py config/base_config.py.bak
echo "✅ 已备份到 config/base_config.py.bak"

# 2. 服务器无 GUI：关掉 CDP 模式（不用本机 Chrome）
sed -i 's/^ENABLE_CDP_MODE = True/ENABLE_CDP_MODE = False/' config/base_config.py

# 3. 无头模式（不弹浏览器）
sed -i 's/^HEADLESS = False/HEADLESS = True/' config/base_config.py

# 4. 登录方式改为 cookie（服务器看不到二维码）
sed -i 's/^LOGIN_TYPE = "qrcode"/LOGIN_TYPE = "cookie"/' config/base_config.py

# 5. 验证修改结果
echo "===修改后关键配置==="
grep -nE '^ENABLE_CDP_MODE|^HEADLESS|^LOGIN_TYPE|^COOKIES' config/base_config.py

echo "✅ 无头模式配置完成"
echo "注意：COOKIES 仍为空，需要填入各平台 cookie 后才能跑（下一步）"
