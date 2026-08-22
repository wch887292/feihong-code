# 飞虹 Code - 自我迭代升级系统

> 让 AI 编程助手能够自我学习、持续进化

## 🎯 系统概述

Self-Evolve 是飞虹 Code 的**元技能系统**，让它能够：

1. **自动记录失败** - 每次任务失败都会被记录并分析
2. **提取错误模式** - 识别重复出现的错误类型
3. **创建解决技能** - 当遇到无解问题时，自动生成新技能
4. **定期复盘优化** - 每日/每周回顾，持续改进

## 📦 包含内容

### 核心系统
- `skills/self-evolve/SKILL.md` - Self-Evolve 技能定义
- `src/self-evolve/manager.js` - 核心管理器
- `src/self-evolve/hook.ts` - 集成钩子
- `src/cli/self-evolve-cli.js` - 命令行接口

### 文档
- `docs/self-evolve.md` - 用户文档
- `docs/self-evolve-implementation.md` - 实现指南

### 测试
- `tests/unit/self-evolve.test.js` - 单元测试
- `tests/demo/self-evolve-demo.js` - 演示脚本

### 脚本
- `scripts/self-evolve-setup.sh` - 初始化脚本
- `scripts/quick-start.js` - 快速开始脚本

## 🚀 快速开始

### 1. 初始化系统

```bash
# 运行安装脚本
bash scripts/self-evolve-setup.sh

# 或使用 Node.js 快速开始
node scripts/quick-start.js
```

### 2. 查看系统状态

```bash
# 设置别名（可选）
alias fe='fhcode self-evolve'

# 查看统计
fe status
```

### 3. 开始使用

```bash
# 列出失败记录
fe failures list

# 查看技能库
fe skills list

# 每日复盘
fe review --daily

# 分析错误模式
fe analyze
```

## 📊 核心功能

### 失败记录
自动记录所有失败的执行，包括：
- 错误类型（编译、运行时、路径、权限、API等）
- 完整的错误信息
- 尝试的解决方案
- 根本原因分析

### 错误模式识别
- 按类型统计失败频率
- 识别重复出现的错误
- 建议创建针对性技能

### 技能自动生成
当遇到无法解决的新问题时：
```bash
# 系统会提示创建技能
fe create-skill \
  --name my-error-handler \
  --description "处理我的特定错误" \
  --pattern error-type \
  --solution "具体解决步骤" \
  --triggers "触发关键词"
```

### 定期复盘
```bash
# 每日复盘
fe review --daily

# 查看周统计
fe status --week
```

## 🔄 工作流程

```
任务执行
    ↓
成功？ → 记录成功
    ↓ 失败
自动记录失败
    ↓
搜索已知解决方案
    ↓ 找到 → 应用方案
    ↓ 未找到
分析根因
    ↓
创建新技能？ → 是 → 保存到 ~/.feihong-code/skills/
    ↓ 否
标记待人工处理
    ↓
每日复盘 → 优化系统
```

## 📁 数据结构

所有数据存储在 `~/.feihong-code/self-evolve/`：

```
~/.feihong-code/
├── self-evolve/
│   ├── config.json          # 配置
│   ├── failures.json        # 失败记录
│   ├── skills-index.json    # 技能索引
│   ├── history.json         # 操作历史
│   └── report-YYYY-MM-DD.json  # 每日报告
├── skills/
│   └── <skill-name>/
│       └── SKILL.md
└── ...
```

## 🔧 集成开发

### 在工具中记录失败

```typescript
import { selfEvolveHook } from './self-evolve/hook.ts';

try {
  await someToolCall(input);
} catch (error) {
  selfEvolveHook.onToolFailure({
    tool: 'tool-name',
    input: input,
    error: error.message,
    attemptedSolutions: []
  });
  throw error;
}
```

### 定期复盘

```javascript
// 每天运行
const report = await selfEvolveHook.dailyReview();
console.log(`今日失败: ${report.total_failures}`);
```

## 📚 与现有系统集成

Self-Evolve 可以与以下技能配合：

| 技能 | 集成点 | 作用 |
|------|--------|------|
| `/self-heal` | 自动创建修复技能 | 解决技术错误 |
| `/plan` | 计划时参考历史 | 避免重复失败 |
| `/goal` | 目标设定参考 | 追踪迭代进度 |

## 🎯 使用示例

### 示例1：处理编译错误

```bash
# 分析最近7天的编译错误
fe analyze --days 7 --type compile-error

# 创建通用编译错误处理技能
fe create-skill \
  --name compile-error-handler \
  --description "处理TypeScript编译错误" \
  --pattern compile-error \
  --solution "1. 检查导入路径\n2. 验证类型定义\n3. 安装缺失依赖" \
  --triggers "error TS, syntax error, cannot find module"
```

### 示例2：处理路径穿越

```bash
# 创建路径安全技能
fe create-skill \
  --name path-security-handler \
  --description "处理路径穿越安全问题" \
  --pattern path-error \
  --solution "1. 验证路径在workspace内\n2. 使用相对路径\n3. 规范化路径" \
  --triggers "path traversal, outside workspace, EACCES"
```

### 示例3：查看每日复盘

```bash
fe review --daily
```

输出：
```
📅 每日复盘报告
========================================
日期: 2026-08-16
失败任务: 5
已解决: 3
待处理: 2
新技能: 1

今日失败详情:
  ✅ [a1b2c3d4] compile-error: error TS2307...
  ⏳ [e5f6g7h8] path-error: Path traversal...
```

## 🛡️ 纪律与原则

1. **诚实记录** - 失败就是失败，不伪造成功
2. **及时复盘** - 每日至少一次复盘分析
3. **渐进改进** - 每次迭代只优化一个方面
4. **验证优先** - 新技能必须经过测试验证
5. **可追溯** - 所有变更记录保存历史版本

## 📈 版本历史

- **v1.0.0** (2026-08-16) - 初始版本
  - 基础失败记录功能
  - 技能自动生成
  - 每日复盘
  - CLI 接口

## 🔮 未来规划

- [ ] 自动检测技能冲突
- [ ] 技能效果追踪
- [ ] 团队共享技能库
- [ ] AI 辅助技能创建
- [ ] 失败预测模型

## 🤝 贡献指南

欢迎贡献！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 📄 许可证

MIT License

---

**让飞虹 Code 越来越聪明！** 🚀
