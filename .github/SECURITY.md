# 安全政策

## 受支持的版本

| 版本 | 支持状态 |
|------|----------|
| 0.2.x (Latest) | ✅ 活跃维护 |
| 0.1.x | ⚠️ 仅安全补丁 |

## 报告漏洞

**请不要在公共 Issue 中报告安全问题。**

### 私有报告渠道

1. **GitHub Security Advisories**（推荐）
   - 访问: https://github.com/wch887292/feihong-code/security/advisories
   - 或直接创建 Security Advisory

2. **邮件联系**
   - 负责人：吴赐虹
   - 邮箱：wch887292@gmail.com（请在邮件标题注明 `[SECURITY] feihong-code`）

### 报告内容

请包含以下信息：
- 问题描述与复现步骤
- 受影响版本
- 潜在影响评估
- 建议修复方案（如有）
- 联系方式（可选）

### 响应时间

- **确认收到**: 24 小时内
- **初步评估**: 72 小时内
- **补丁发布**: 根据严重程度，通常 1-2 周内

## 安全最佳实践

### 密钥管理
- ✅ 永远不要提交 `.env` 文件
- ✅ 使用环境变量或 `fhcode.config.json` 管理密钥
- ✅ 定期轮换 API Key

### 运行时安全
- 启用 `FH_OFFLINE=true` 进行测试
- 使用 `--max-iterations` 控制成本
- 启用 RBAC 策略：`FH_ENTERPRISE=true`

### 审计追踪
- 定期检查审计日志：`fhcode audit verify`
- 启用多租户隔离
- 配置配额熔断

## 已公开的安全修复

| 日期 | 版本 | 描述 |
|------|------|------|
| 2026-08-12 | 0.2.1 | M8 请求体限流、M14 配额冻结、M5 审计并发锁、M12 脱敏扩充 |
| 2026-08-12 | 0.2.1 | H1 spawn 挂起防护、H2 沙箱逃逸防护、H3 flag 解析修复、H4 system 指令保留 |

## 安全依赖

运行 `npm audit` 检查依赖安全状态。我们采用最小依赖策略，仅引入：
- `express` - HTTP 服务器
- `zod` - 参数校验
