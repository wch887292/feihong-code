---
name: skill-vetter
description: Audits a SKILL.md and its scripts for security risks before installation. Triggers when user wants to install or trust a skill from an external or unknown source.
---

# 技能安全审查（Skill Vetter）

## 核心定位

在安装任何来自外部来源的技能前，对 SKILL.md 和 scripts/ 目录执行系统性安全审查。输出结构化风险报告和明确的安装决策（安装 / 谨慎安装 / 拒绝）。

不审查用户自己创建的技能，除非明确请求。

---

## 触发场景

- 用户说"帮我审查这个技能是否安全"
- 用户想安装来自 GitHub、聊天分享、第三方网站的技能
- 用户粘贴了一个 SKILL.md，请求安全检查
- 用户提供了技能文件目录路径

---

## 工作流

### Step 1：定位并读取技能文件

接受输入方式：
- 文件路径 → 直接读取
- 粘贴的文本内容 → 作为临时内容分析
- GitHub URL → 通过 browser-automation 获取原始内容

读取 SKILL.md 后，检查同级目录是否存在以下文件并全部读取：
```
scripts/       高风险，执行脚本目录
hooks/         高风险，Hook 脚本
*.sh           高风险，Shell 脚本
*.py           中风险，Python 脚本
*.js / *.ts    中风险，JavaScript 脚本
config/        中风险，配置文件
```

### Step 2：SKILL.md 内容扫描

**检查 A：外部 URL 声明完整性**

扫描所有 URL 模式：
```regex
https?://[^\s'")\]]+
curl\s+[^\s]+
wget\s+[^\s]+
fetch\(['"](https?://)[^'"]+
requests\.(get|post|put|delete)\(['"](https?://)
axios\.(get|post)\(['"](https?://)
```

判断标准：
- URL 在工作流中明确说明用途且目标是知名服务 → Low
- URL 存在于脚本但 SKILL.md 未提及 → High
- URL 使用 IP 地址而非域名 → High
- URL 指向非知名域名 → Medium，需用户确认

**检查 B：敏感文件路径访问**
```regex
~/\.ssh/
~/\.aws/credentials
~/\.config/
~\/\.netrc
\/etc\/passwd
\/etc\/shadow
\.env$
\.env\.local$
credentials\.json
secrets\.json
Library/Keychains
Library/Application Support/Google/Chrome
```

**检查 C：凭证访问与传输**
```regex
# 读取凭证（可接受，看去向）
os\.environ\[['"](?:PASSWORD|SECRET|TOKEN|KEY|API_KEY)['"]\]
process\.env\.(?:PASSWORD|SECRET|TOKEN|KEY|API_KEY)
\$(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)\b

# 访问 macOS Keychain（高风险）
security\s+find-internet-password
security\s+find-generic-password

# 读取浏览器数据（极高风险）
Login Data
Cookies
Local Storage
```

**检查 D：动态代码执行**
```regex
# Python 执行
\beval\s*\(
\bexec\s*\(
__import__\s*\(
subprocess\.(run|call|Popen|check_output)\s*\(
os\.system\s*\(
os\.popen\s*\(

# JavaScript 执行
\beval\s*\(
new\s+Function\s*\(
vm\.runInNewContext
child_process\.(exec|spawn|execSync)

# Shell 注入风险（变量直接拼入命令）
shell\s*=\s*True
f['"](.*)\{.*\}(.*)[|;&`]
```

**检查 E：混淆与隐藏代码**
```regex
# Base64 解码后执行
base64\s+-d\s*\|
base64\.b64decode.*exec
atob\(.*eval
Buffer\.from\(.*base64.*\).*exec

# 十六进制 shellcode 特征
(?:\\x[0-9a-fA-F]{2}){15,}

# URL 编码执行
decodeURIComponent.*eval
```

**检查 F：数据外传模式**
```regex
# 将本地数据发送到外部
curl.*--data.*\$(?:HOME|USER|SHELL|PATH)
curl.*--data.*\$\(cat\s
requests\.post.*os\.environ
requests\.post.*open\(
fetch.*JSON\.stringify.*(?:localStorage|document\.cookie|fs\.)
```

### Step 3：脚本文件深度扫描

对每个脚本文件：

1. 读取全部内容
2. 应用 Step 2 的所有正则模式
3. 额外检查：
   ```regex
   # 写入系统目录
   open\(.*\/etc\/
   open\(.*~\/\.ssh\/
   fs\.writeFile.*\/etc\/

   # 进程信号操作
   os\.kill\s*\(
   signal\.(SIGKILL|SIGTERM)

   # 定时任务安装
   crontab\s+-[el]
   launchctl\s+load
   ```
4. 检查 shebang：
   - `#!/bin/bash` 或 `#!/bin/sh` → 记录，需逐行检查 shell 命令
   - 无 shebang 但文件有可执行权限（`ls -la` 显示 `x` 位） → Medium 风险

### Step 4：综合风险评级

**风险级别标准**

| 级别 | 判定条件 |
|------|----------|
| Low | 无外部网络调用；仅读取用户指定文件；仅使用标准工具 |
| Medium | 外部网络调用但目标已知且必要；读取凭证但不传输；有 eval 但对象是用户提供的数据 |
| High | 访问未在文档说明的外部服务；读取系统敏感文件；存在混淆代码 |
| Critical | 外传本地文件或环境变量；访问 ~/.ssh 或浏览器数据；base64 解码后执行 |

**安装决策矩阵**

```
存在任何 Critical 风险项  →  拒绝安装（无条件）
存在任何 High 风险项      →  拒绝安装（除非作者提供书面解释且风险可独立验证）
存在 ≥3 个 Medium 风险项  →  拒绝安装，要求修复后重审
存在 1-2 个 Medium 风险项 →  谨慎安装，向用户明确告知具体风险点
仅 Low 风险项             →  安装
```

---

## 输出格式

```
## 技能安全审查报告

技能名称：{name}
审查时间：{datetime}
来源：{file_path 或 "用户粘贴"}
扫描文件：SKILL.md{, scripts/xxx.py, hooks/xxx.sh（如有）}

### 总体评级：{Low / Medium / High / Critical}
### 安装建议：{安装 / 谨慎安装 / 拒绝安装}

---

### 发现的风险项

#### Critical（{n} 项）
- [文件:行号] {风险类型}
  匹配内容：`{代码片段}`
  风险说明：{具体危险原因}

#### High（{n} 项）
（同上格式）

#### Medium（{n} 项）
（同上格式）

#### Low（{n} 项，供参考）
（同上格式）

---

### 通过检查项
- [通过] 无外部网络调用 / 外部调用已声明且目标合理
- [通过] 无系统敏感文件访问
- [通过] 无代码混淆
- [通过] 无凭证外传迹象

---

### 结论

{1-3 句总结：主要风险和建议}

{若谨慎安装：列出用户使用前应手动确认的具体事项}

{若拒绝安装：列出作者需要修改的具体位置}
```

---

## Gotchas

**Base64 假阳性识别**
- 文档字符串中的 base64 示例（未被执行）不是风险
- 处理用户上传图片时合法使用 base64 编解码
- 判断标准：base64 内容是否会被 decode 后传入 eval/exec？

**凭证读取 ≠ 凭证泄露**
- 技能读取 `GITHUB_TOKEN` 来调用 GitHub API → 正常行为
- 技能读取 `GITHUB_TOKEN` 后 POST 到第三方服务器 → Critical
- 关注凭证的流向（destination），不是读取行为本身

**subprocess 的合法与非法**
- `subprocess.run(["git", "status"])` → 静态命令，通常安全
- `subprocess.run(user_input, shell=True)` → High 风险（shell injection）
- `subprocess.run(f"cmd {var}", shell=True)` → 即使 var 来自配置也是 High

**压缩代码不等于混淆**
- minified JS 单行长代码未必是恶意的
- 判断标准：能否理解其功能？功能与声明是否一致？
- 无法理解功能的代码 → 按 Medium 处理，要求作者提供可读版本

**审查范围的边界**
- 本审查：检查代码行为的安全性
- 不在审查范围：技能业务逻辑是否正确、性能问题、作者身份可信度
- 通过审查不等于绝对安全，运行时行为无法通过静态分析完全预测
