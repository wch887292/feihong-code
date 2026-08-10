#!/usr/bin/env bash
# 飞虹 Code (fhcode) — 安装脚本
# 用途：从 npm 安装稳定版 fhcode 全局命令。
# 前提：已安装 Node.js >= 18 与 npm。
set -euo pipefail

echo "== 飞虹 Code (fhcode) 安装 =="

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未检测到 node，请先安装 Node.js >= 18（https://nodejs.org）。" >&2
  exit 1
fi

echo "检测到 node $(node -v)"
echo "正在从 npm 安装 feihong-code（稳定版）..."
npm install -g feihong-code

echo ""
echo "安装完成。可执行："
echo "  fhcode --help                  # 查看全部命令"
echo "  fhcode serve --port 8080       # 启动 Web 管理控制台（企业版）"
echo "  fhcode \"你的第一条目标\"        # 以离线/社区模式运行"
echo ""
echo "晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹"
