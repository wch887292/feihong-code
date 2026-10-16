# Windows 接入：先定位阶段，再决定是否获取

2026-09-22后续：Windows原生CI的Python 3.11/3.12均已通过真实ACL、中文路径、UTF-16材料与虚构SQLCipher数据库导入测试；[执行记录](https://github.com/Rion-Wu-tech/wechat-intelligence-hub/actions/runs/35638032153)。连接目录已去掉残留的POSIX权限判断，验证临时目录先设置ACL。此结果只验证相关读取/导入基础能力，不验证真实微信首次获取或完整日报。

2026-09-22补充：`sqlcipher3 0.6.2`官方PyPI已提供Windows wheels，可先匹配当前解释器的位数和ABI，再做加密往返自检。Reader已兼容Windows常见BOM/UTF-16 JSON；不要把格式错误当成必须重取key。`diagnose --source`可用独立临时配置检验本人已有材料。

另有[社区Windows安装分支](https://github.com/iversonzhang50-gif/wechat-intelligence-hub-windows)，其`docs/WINDOWS-ACCESS.md`明确不捆绑获取工具。安装、自检、材料验证及首次获取是不同验收项；主仓库尚未宣称Windows一键接入。

截至 2026-09-17：社区报告 Windows x64、微信 DLL 文件版本 **4.1.13.12** 上接入成功，但其本地获取适配尚未合入本仓库。便携手册只报告虚构数据库测试，未在第二台机器完成真实获取。不要宣称 Windows 一键接入或任意版本可用。

本仓库已加入 Reader 的真实 Windows ACL 检查和新私有输出权限初始化；开发验证使用模拟 Windows 行为，**还没有 Windows 真机 ACL / 获取 / 完整日报验收**。现有 Bash 安装入口也不能当作原生 Windows 安装器。

## Codex 的准备与停止条件

1. 核对实际安装路径、Python 位数、微信实际加载 DLL 的文件版本、用户明确选择的账号及 `db_storage`。不以安装目录内任意 DLL 或最近修改的账号替代用户选择。
2. 使用实际入口运行 `doctor`。`live_database_read_ok=true` 就复用，少量文本抽检后进入个人 Profile；安装成功、找到材料、通知预览都不等于数据库接通。
3. 已有材料打不开，先查依赖、账号、目录、格式和权限。不要重装整套、覆盖旧配置、扫描其他账号，也不自动重取 key。
4. 缺访问材料时，先审核固定来源、许可和完整调用链，离线测试完成后才解释本次范围、时限和风险并征求具体同意。本指南和“继续优化”都不是进程内存读取授权。
5. 不自动提权、注入、写进程、重启微信或关闭安全软件。不得删除平台/版本判断以试运行。失败后保留阶段证据，停止自动重试。

## 社区案例真正解决的问题

固定案例引用 WeChatDataAnalysis 提交 `62c5419d0c4370bc20705f2d9f60162e2ecd2a70`。此引用来自社区复盘，维护者仍需独立核验源码、许可和哈希，不默认信任附件声明。

案例不是单独运行 `key_v4.py` 就成功，而是审阅 `key_service.py`、`dll_key_scan.py` 等完整调用关系，结合活动进程实际 DLL 的辅助值，转换原候选后验证数据库。

对这个**特定分支**，材料阶段是：原候选 → XOR 一次后的口令 → 按各数据库 salt 派生的 Reader raw key。不能跳过或重复 XOR，不能把一个库派生的 raw key 当作所有库的通用材料。不要将此分支强套到其他微信版本或已经返回最终口令的 provider。

不同阶段只输出状态、计数、耗时，不展示候选、辅助值、口令、密钥、内存块或聊天。获取材料保存在用户本机，不发送给维护者、Issue、群或模型对话。

## 按失败阶段处理

| 阶段 | 核对事项 | 禁止的捷径 |
|---|---|---|
| 平台入口不支持 | 区分未实现 Windows 获取和已有材料读取 | 删除平台判断，反复让用户授权 Mac 命令 |
| SQLCipher / DLL 导入失败 | 当前项目解释器、Python 位数、平台 wheel；社区案例用 x64 Python 3.12 | 换成普通 sqlite3，安装失败后立即扫描微信 |
| ctypes 类型不兼容 | 审核 LPVOID 和 Win32 参数/返回类型 | 删除类型签名、扩大进程权限 |
| prepare 不符 | 活动 PID、实际加载 DLL、文件版本和审核哈希 | 使用旧 DLL、移除版本或哈希门禁 |
| 扫描超时 / 拒绝访问 | 用户身份、阶段计数、有界时限 | 无限延长、隐藏重试、自动管理员运行 |
| 候选全部校验失败 | 候选/口令/raw key 区别、DLL辅助值、XOR次数、目标库布局 | 输出候选求助，默认认为微信升级就不能用 |
| 口令通过但部分库失败 | 各库 salt、布局与覆盖；保留成功材料 | 重取口令，把一个库通过写成全量成功 |
| ACL 不安全 / 无法检查 | 用 PowerShell Get-Acl 读取真实 ACL；现有文件只检查，不自动改权限 | chmod冒充Windows验收，权限函数返回恒真 |
| doctor可读但文本乱码 | WCDB结构、Zstandard和消息解析 | 重取key |
| 文本可读但日报失败 | Profile、Hub运行时、时间范围及HTML依赖 | 将报告层失败归因于key |

ACL 检查默认优先 PowerShell 7，存在可用 Windows PowerShell 时也会尝试；检查异常、超时或不存在解释器均拒绝通过。Windows 私有文件策略要求当前用户为所有者、仅当前用户和 SYSTEM 有 Allow 规则。新输出先保护目录和空临时文件，再写敏感内容；已有不安全目录停止写入，不悄悄调整用户原目录。

## 获取候选合入前还需完成

- 审核第三方许可和固定源码，取得分享者允许复用代码的授权；不把私聊附件原样加入公共仓库。
- 内部 worker 不得作为公开入口绕过外层超时；需要统一有界控制和失败恢复记录。
- 覆盖 provider/活动 DLL 变化、过期 PID、中文路径、ACL失败、超时、候选转换、逐库验证和旧配置保留的反例测试。
- 在用户授权的 Windows 真机至少完成：所需库验证 → doctor → 已知聊天文本抽检 → Profile → Markdown/HTML。社区作者一次成功不代表成功率，也不代表媒体解密或完整手机历史覆盖。

可发给 Codex：

> 我用 Windows，请先按 windows-access 指引定位接入阶段，保留已有配置和 Profile。已有材料先验证复用；不要打印材料或盲目重试。若需要新增获取适配，先核验固定源码、许可、DLL版本和完整转换/校验链，做离线测试，再说明具体影响和时限让我确认。最后以 doctor 和真实文本抽检验收，不以“找到key”结束。

参考：[Microsoft Get-Acl 文档](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-acl)。
