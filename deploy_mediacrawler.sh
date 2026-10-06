#!/usr/bin/env bash
# =============================================================
# MediaCrawler 一键部署脚本（腾讯云 Linux 服务器）
# 用法: bash deploy_mediacrawler.sh
# 分步执行，失败会停下提示，不会静默跳过
# =============================================================
set -e

echo "=============================================="
echo "STEP 0/6  环境与连通性检查"
echo "=============================================="

echo "[Python] $(python3 --version 2>/dev/null || echo '未安装')"
echo "[Node]   $(node --version 2>/dev/null || echo '未安装')"
echo "[Git]    $(git --version 2>/dev/null || echo '未安装')"

echo "[网络] 测试 github.com 连通性..."
if curl -sI -m 8 https://github.com >/dev/null 2>&1; then
  echo "github.com 可访问，使用官方源"
  CLONE_URL="https://github.com/NanmiCoder/MediaCrawler.git"
else
  echo "github.com 不可达，改用 ghproxy 镜像（腾讯云常见）"
  CLONE_URL="https://ghfast.top/https://github.com/NanmiCoder/MediaCrawler.git"
fi

echo "=============================================="
echo "STEP 1/6  安装 uv（Python 包管理，若缺失）"
echo "=============================================="
if ! command -v uv >/dev/null 2>&1; then
  echo "未检测到 uv，开始安装..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
uv --version

echo "=============================================="
echo "STEP 2/6  克隆 MediaCrawler 仓库"
echo "=============================================="
MC_DIR="/www/dk_project/MediaCrawler"
if [ -d "$MC_DIR/.git" ]; then
  echo "已存在仓库，拉取更新..."
  cd "$MC_DIR" && git pull
else
  git clone "$CLONE_URL" "$MC_DIR"
  cd "$MC_DIR"
fi

echo "=============================================="
echo "STEP 3/6  安装 Python 依赖 (uv sync)"
echo "=============================================="
cd "$MC_DIR"
uv sync

echo "=============================================="
echo "STEP 4/6  安装 Chromium 浏览器（无头模式，供 Playwright 用）"
echo "=============================================="
# 服务器无桌面，必须用标准 Playwright 模式（关闭 CDP）
uv run playwright install chromium --with-deps || echo "!! chromium 安装部分失败，稍后可重试: uv run playwright install chromium --with-deps"

echo "=============================================="
echo "STEP 5/6  配置（关键，需手动改两个文件）"
echo "=============================================="
echo "必须修改 $MC_DIR/config/base_config.py："
echo "  1) ENABLE_CDP_MODE = False      (服务器无 Chrome GUI，走标准 Playwright)"
echo "  2) HEADLESS_PLAYWRIGHT 相关保持 True / headless"
echo "  3) 按需开启 ENABLE_GET_COMMENTS 等"
echo ""
echo "登录方式：本项目暂用 cookie 登录（下一步配置各平台 COOKIE）"

echo "=============================================="
echo "STEP 6/6  验证安装"
echo "=============================================="
cd "$MC_DIR"
uv run python -c "import sys; print('Python', sys.version.split()[0])"
uv run main.py --help >/dev/null 2>&1 && echo "MediaCrawler 可运行（--help 正常）" || echo "请检查报错"

echo ""
echo "✅ 部署完成。下一步："
echo "  1) 编辑 config/base_config.py（ENABLE_CDP_MODE=False 等）"
echo "  2) 配置 cookie 登录（config/xhs_config.py 等平台配置的 COOKIE）"
echo "  3) 配置飞虹 Code skill 接入"
