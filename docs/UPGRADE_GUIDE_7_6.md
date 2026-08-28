# 飞虹 Code · v7.6.0 版本升级说明书

> 版本：v7.6.0 · 更新：2026-08-28
> 适用：从 v7.5.0（或更早）升级到 v7.6.0 的所有用户
> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

---

## 1. 升级前须知

1. **数据安全**：升级不会破坏 `~/.feihong-code/` 下的会话、配置、技能与经验数据。建议升级前备份数据目录：
   ```bash
   # Windows PowerShell
   Copy-Item -Recurse "$env:USERPROFILE\.feihong-code" "$env:USERPROFILE\.feihong-code-backup-7.5.0"
   ```
2. **版本检查**：升级前确认当前版本
   ```bash
   fhcode --version   # 若为 7.5.0 或更早，均可直接升级
   ```
3. **git 仓库状态**：若从源码升级，先提交或暂存本地改动，避免构建产物冲突。

---

## 2. 升级路径

| 当前版本 | 升级路径 |
|---------|---------|
| v7.5.0 | **直接升级到 v7.6.0**（本次主路径） |
| v7.2.0 及更早 | 先按 `docs/UPGRADE_7.2.0.md` / `docs/UPGRADE_GUIDE_7_5.md` 升级到 v7.5.0，再升级到 v7.6.0 |

---

## 3. v7.6.0 变更总览

### 3.1 重大更新

| 变更 | 说明 | 影响 |
|------|------|------|
| **SWE harness 差分语义** | `TestVerifier` 三段式校验：修复前 FAIL_TO_PASS 原本失败 → 修复后 FTP 全过 → PASS_TO_PASS 回归不破坏既有功能 | 跑分更严格、更可信；杜绝假阳性与回归破坏 |
| **双系统收敛为单一经验库** | 旧式 `self-evolve` 的失败/解决/技能沉淀统一回流 `experiences.jsonl`，与 `self-improve` 同库同 upsert 语义 | 学习闭环统一；`self-evolve status` 新增共享经验库计数 |
| **voice-programming 加固** | 补齐 5 个死类型命令规则、修复「创建一个叫 X 的文件」识别与面板命令抢占、新增 7 项单元测试 | 语音指令识别更准确 |

### 3.2 工程与运维

- **仓库卫生**：清理 163 个 android 构建产物 + 29 个根目录调试截图 + `.idsig` 的 git 跟踪；`.gitignore` 补全
- **BOM 兼容**：`self-evolve` 读取 JSON 自动去 BOM（PowerShell 写入的配置可正常读取）
- **版本号**：`7.5.0 → 7.6.0`；Android `versionCode 7 → 8`

### 3.3 文档

- 新增/重写：技术设计说明书、使用说明书（v7.6.0 权威版）
- 新增：本升级说明书
- 全库现行态文档版本头统一对齐 v7.6.0

### 3.4 行为变化（需关注）

1. `fhcode harness` 现在默认执行三段式校验：若测试集缺少 PASS_TO_PASS 或修复前未确认失败，判定会变严格。历史 mock 报告口径不变（诚实标注）。
2. `fhcode self-evolve status` 输出新增一行「共享经验库」。
3. 统一经验库启用后，首次运行会创建 `~/.feihong-code/experiences/` 目录并回流历史失败/技能记录。

---

## 4. 升级步骤

### 4.1 npm 全局安装升级

```bash
npm install -g feihong-code@7.6.0
fhcode --version   # 应输出 7.6.0
fhcode doctor      # 环境自检
```

### 4.2 源码升级

```bash
git pull                 # 拉取 v7.6.0 代码
npm install              # 更新依赖（如有变更）
npm run build            # 重新构建 dist/
node dist/cli/index.js --version   # 7.6.0
npm test                 # 全量测试应 243/243 通过
```

### 4.3 Docker / 私有化升级

```bash
docker pull <你的镜像仓库>/feihong-code:7.6.0
docker stop <旧容器>
docker run -d -v ~/.feihong-code:/data/feihong-code \
  <你的镜像仓库>/feihong-code:7.6.0
```

### 4.4 Android APK 升级

从发布渠道下载 v7.6.0（versionCode 8）覆盖安装即可。数据（会话、配置、技能、经验）自动保留在 `~/.feihong-code/`（需与桌面端同步）。

---

## 5. 数据兼容性

| 数据 | 兼容性 | 说明 |
|------|--------|------|
| `~/.feihong-code/sessions/` | ✅ 完全兼容 | 会话可 resume / diff / rollback |
| `~/.feihong-code/config/` | ✅ 完全兼容 | 配置结构未变 |
| `~/.feihong-code/self-evolve/` | ✅ 完全兼容 | 新增回流写入共享经验库，原有文件保留作审计 |
| `~/.feihong-code/experiences/` | ✅ 新增 | 首次运行时自动创建；与 self-improve 共用 |
| `~/.feihong-code/skills/` | ✅ 完全兼容 | 技能索引自动去 BOM 读取 |
| 环境变量 `.env` | ✅ 完全兼容 | 所有 `FH_*` 变量含义不变 |

---

## 6. 升级后验证清单

```bash
fhcode --version                    # ✅ 7.6.0
fhcode doctor                       # ✅ 环境自检通过
fhcode self-improve                 # ✅ 经验库正常加载（含历史回流）
fhcode self-evolve status           # ✅ 显示「共享经验库」行
fhcode experiences                  # ✅ 可浏览经验
fhcode harness --split lite --limit 1 --mode mock --verifier file   # ✅ 管道可复现
fhcode swe "写一个 hello world"     # ✅ 端到端任务可用
```

---

## 7. 回滚方案

配置与数据目录 `~/.feihong-code/` 不做破坏性改动，可直接回退。

```bash
# npm 回退
npm install -g feihong-code@7.5.0

# 源码回退
git checkout <v7.5.0 提交> && npm run build

# 数据回退（如需）
# 还原第 1 节备份的数据目录即可
```

**注意**：v7.6.0 新增的共享经验库条目（回流记录）不回写旧版本；回退后 `self-evolve status` 不再显示「共享经验库」行，原 `self-evolve/` 数据文件不受影响。

---

## 8. 已知限制

1. **官方 SWE-bench（Python/pytest）跑分**：受 HF 网络可达性与 Docker 环境限制，v7.6.0 仍未产出官方分数；当前以「自建任务集真实模型跑分 5/5 + mock 管道复现」对外，口径诚实标注。详见 `docs/SWE_BENCH_REPORT.md`。
2. **受管命令白名单**：`fhcode harness` 的测试命令仅放行 `npm/pnpm/yarn/bun`；`node -e` 直跑会被拦截，测试须封装为 npm script。
3. **语音识别依赖**：语音编程的本地识别依赖 faster-whisper 部署，未部署时仅支持文本指令回退。

---

*飞虹 Code v7.6.0 · 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹*
*2026-08-28 · 版本升级说明书*
