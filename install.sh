#!/usr/bin/env bash
# 飞虹 Code 一键安装（从源码构建并全局安装）
# 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> 安装依赖并构建 feihong-code ..."
npm install
npm run build

echo "==> 全局安装 (npm install -g .) ..."
npm install -g .

echo "✅ 安装完成。验证："
fhcode --version
echo ""
echo "下一步：cp .env.example .env 并填入 FH_PROVIDERS 后，运行 fhcode \"<需求>\""
