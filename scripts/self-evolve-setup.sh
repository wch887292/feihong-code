#!/bin/bash
# Self-Evolve Setup Script - 自我迭代系统初始化脚本

set -e

echo "🚀 初始化飞虹 Code 自我迭代系统..."

# 获取用户home目录
HOME_DIR="${HOME}"

# 创建必要目录
echo "📁 创建目录结构..."
mkdir -p "${HOME_DIR}/.feihong-code/self-evolve"
mkdir -p "${HOME_DIR}/.feihong-code/skills"

# 创建初始配置文件
echo "📝 创建初始配置..."
cat > "${HOME_DIR}/.feihong-code/self-evolve/config.json" << 'EOF'
{
  "enabled": true,
  "auto_review": true,
  "review_frequency": "daily",
  "max_failures_to_keep": 1000,
  "skill_auto_create": true,
  "notification_level": "info"
}
EOF

# 创建版本文件
cat > "${HOME_DIR}/.feihong-code/self-evolve/version.txt" << 'EOF'
1.0.0
EOF

# 初始化管理器
echo "🔧 初始化数据..."
node "$(dirname "$0")/../src/self-evolve/manager.js" init

# 添加别名到 shell 配置
echo "🔗 配置快捷方式..."
SHELL_CONFIG=""
case "$SHELL" in
  bash)
    SHELL_CONFIG="${HOME}/.bashrc"
    ;;
  zsh)
    SHELL_CONFIG="${HOME}/.zshrc"
    ;;
  fish)
    SHELL_CONFIG="${HOME}/.config/fish/config.fish"
    ;;
esac

if [ -n "$SHELL_CONFIG" ] && [ -f "$SHELL_CONFIG" ]; then
  # 检查是否已添加别名
  if ! grep -q "alias fe='fhcode self-evolve'" "$SHELL_CONFIG"; then
    echo "" >> "$SHELL_CONFIG"
    echo "# Self-Evolve 快捷方式" >> "$SHELL_CONFIG"
    echo "alias fe='fhcode self-evolve'" >> "$SHELL_CONFIG"
    echo "  - 添加 alias fe='fhcode self-evolve' to $SHELL_CONFIG"
  fi
fi

echo ""
echo "✅ 自我迭代系统初始化完成!"
echo ""
echo "使用方法:"
echo "  fe init              - 初始化系统"
echo "  fe status            - 查看统计"
echo "  fe failures list     - 列出失败记录"
echo "  fe skills list       - 列出技能"
echo "  fe review --daily    - 每日复盘"
echo "  fe analyze           - 分析错误模式"
echo ""
echo "详细文档: ~/.feihong-code/self-evolve/README.md"
