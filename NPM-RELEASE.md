# npm 上线预检清单（feihong-code v0.3.0）

> 本文档为 `npm publish` 前的完整检查清单与操作流程。执行 `npm publish` 需先获得发布授权（当前状态：待授权）。

## 一、发布前自动校验（Pre-flight）

```bash
# 1. 版本号全链路一致
node dist/cli/index.js --version        # 期望: fhcode v0.3.0
npm pkg get version                     # 期望: "0.3.0"
grep "VERSION = " src/cli/version.ts     # 期望: '0.3.0'
grep "APP_VERSION = " src/shared/config.ts  # 期望: '0.3.0'

# 2. 全量类型检查 + 构建
npm run typecheck && npm run build

# 3. 全量测试（单元 + 集成验证）
npm test            # 45/45
npm run verify:m4   # 41/41
npm run verify:m6   # 29/29
npm run verify:m7   # 12/12
npm run verify:m8   # 27/27
npm run verify:m9   # 25/25
npm run verify:m9-real  # 11/11

# 4. 发布包白名单校验（禁止 .env / src / policy.json / node_modules 入包）
npm pack --dry-run | grep -iE "\.env|policy\.json|/src/|node_modules" && echo "FAIL" || echo "OK"

# 5. 明文密钥扫描（仓库级，发布前再扫一次）
grep -rniE "sk-[a-z0-9]{20,}|ghp_[a-z0-9]{20,}|api[_-]?key\s*=\s*['\"][a-z0-9]{20,}" . --include="*.ts" --include="*.md" --include="*.json" -l 2>/dev/null | grep -v node_modules || echo "OK"
```

## 二、发布包字段核对（package.json）

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `name` | `feihong-code` | npm 包名（唯一） |
| `version` | `0.3.0` | 语义化版本 |
| `bin` | `{ "fhcode": "dist/cli/index.js" }` | 全局安装后命令 `fhcode` |
| `main` | `dist/cli/index.js` | 入口 |
| `files` | `dist` + 文档 + `.github` | 白名单，密钥安全 |
| `engines.node` | `>=18.0.0` | Node 版本下限 |
| `keywords` | 48 个 | 检索可见度 |
| `license` | `MIT` | 开源协议 |
| `repository` | `github:wch887292/feihong-code` | 源码地址 |
| `bugs` | GitHub issues | 问题反馈 |
| `publishConfig.registry` | `https://registry.npmjs.org/` | 发布目标 |
| `prepublishOnly` | `npm run build` | 发布前强制构建 |

## 三、发布流程

```bash
# 0. 登录 npm（需账号 + 发布权限）
npm login          # 或 npm cli set //registry.npmjs.org/:_authToken=<token>

# 1. 最终构建
npm run build

# 2. 发布（公开）
npm publish --access public

# 3. 验证
npm view feihong-code version          # 期望 0.3.0
npm install -g feihong-code
fhcode --version                        # fhcode v0.3.0
```

## 四、发布后动作

- [ ] GitHub Release：基于 `v0.3.0` 标签，正文贴 CHANGELOG 0.3.0 段
- [ ] 推送 tag：`git tag v0.3.0 && git push origin v0.3.0`
- [ ] 更新 README 顶部徽章版本（如硬编码）
- [ ] 官网 klai.top/opensource.html 同步版本号
- [ ] 通知社群（企微小助手）

## 五、别名包 feihong-cli（可选，同源）

`feihong-cli` 与 `feihong-code` 同源，`bin` 同为 `fhcode`，便于用户记忆。独立仓库维护，发布时同步版本号。

## 六、回滚预案

若发布后发现严重问题：
```bash
npm deprecate feihong-code@0.3.0 "存在已知问题，请升级到 0.3.1"
# 或紧急发布补丁
npm version patch && npm publish --access public
```

---

*晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹*
