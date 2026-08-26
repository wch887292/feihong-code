# 飞虹 Code · v7.5.0 升级说明书

> 版本：v7.5.0 · 更新：2026-08-27
> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
> 适用：从 v7.2.0（或更早）升级到 v7.5.0 的所有用户

## 1. 升级方式

### npm 全局安装（CLI / 桌面后端）
```bash
npm install -g feihong-code@7.5.0
# 校验版本
fhcode --version   # 应输出 7.5.0
# 环境自检
fhcode doctor
```

### Docker（服务端/CI 场景）
```bash
docker pull <你的镜像仓库>/feihong-code:7.5.0
```

### Electron 桌面版
从发布渠道下载 v7.5.0 安装包覆盖安装即可，数据（会话、配置、技能）自动保留在 `~/.feihong-code/`。

## 2. v7.2.0 → v7.5.0 变更总览

| 领域 | 变更 | 是否需要操作 |
|---|---|---|
| 补全 | 多候选 / temperature 分层 / 跨文件上下文 / accept 后 lint | 无（默认开启） |
| 编辑器 | Monaco 语义诊断波浪线 + hover、多文件 diff 并排/折叠视图 | 无 |
| 插件市场 | 本地种子源（断网可用 10 个官方 skill）+ install 自动注册 | 无 |
| 沙箱 | container 档位隔离加固（默认断网） | 若使用 container 档位需确认镜像/网络配置 |
| 安全 | `npm run security`（audit+SBOM） | 建议接入 CI |
| SWE-bench | 官方 harness + `--verifier test` 跑分 | 需模型 + Docker 才可真实跑分 |
| 合规 | 安全白皮书 + DPA | 政企售前可引用 |
| 协作 | 团队面板协作总览 | 无 |

## 3. 兼容性与行为变化（重要）

1. **版本号**：7.2.0 → 7.5.0（跨 3 个 minor）
2. **container 沙箱默认断网**：若此前使用 `sandboxMode: container` 且命令需要联网（如 `npm install`），现在默认 `--network none` 会失败。解决：
   ```bash
   # 容器内装依赖需要联网时，显式开启 host 网络（仍受网络 allow/deny 约束）
   FH_SANDBOX_NETWORK=host fhcode run "npm install"
   ```
3. **补全体验变化**：full 模式补全多样性提升（temperature 0.3）、接受补全后可能有 lint 反馈波浪线（若代码确有语法问题）——这是预期行为
4. **技能索引**：`skill-market install` 现在会输出"已自动注册到本地技能索引"，`fhcode skill-market list` 可直接看到新装技能
5. **配置兼容**：v7.2.0 的 `~/.feihong-code/config.json` 完全兼容，无需迁移

## 4. 升级后建议执行的验证

```bash
# 1. 版本与环境
fhcode --version && fhcode doctor

# 2. 综合冒烟（本地回归）
node scripts/_smoke-full.mjs

# 3. 安全 CI（SBOM 生成 + 漏洞扫描）
npm run security

# 4. 补全验证（若配置了模型）
fhcode serve  # 打开 Web 编辑器，输入代码观察 ghost text 与诊断波浪线

# 5. 插件市场（断网回退）
fhcode skill-market list   # 应显示已装技能（含官方种子）
```

## 5. 回滚方案

如需回退到 v7.2.0：
```bash
npm install -g feihong-code@7.2.0
```
配置与数据目录 `~/.feihong-code/` 不做破坏性改动，可直接回退。**注意**：v7.5.0 的 SBOM/白皮书等新增产物不回写旧版本。

## 6. 常见问题（FAQ）

- **Q: accept 补全后总出现红色波浪线？** A: 说明补全代码有括号/引号未配平等语法问题（/api/lint 检测），属真实反馈；可在扩展配置 `fhcode.enableAcceptLint=false` 关闭
- **Q: container 模式下 npm install 失败？** A: 见上文第 3 节，设 `FH_SANDBOX_NETWORK=host`
- **Q: SWE-bench 跑分怎么跑？** A: 见 `docs/SWE_BENCH_REPORT.md`，需模型配置 + Docker
- **Q: 需要政企合规材料？** A: 见 `docs/SECURITY_WHITEPAPER.md` 与 `docs/DPA.md`

---
飞虹 Code v7.5.0 · 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
