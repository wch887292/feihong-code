---
name: wsl2-kernel
description: 管理本机 WSL2 上的自定义编译 Linux 7.3 内核环境（发行版 Ubuntu-22.04，源码 /root/linux-7.3，内核镜像 H:/wsl/kernel/bzImage）。当用户要求查看内核版本、查看 WSL 运行状态、启动或关机 WSL、重新编译内核、回滚到微软默认内核、启用自定义内核、查看内核源码或编译日志时使用本技能。
metadata:
  author: 飞虹智研发中心 · 吴赐虹
---

# WSL2 自定义内核管理

面向本机 WSL2 + 自编译 Linux 7.3 内核环境的命令行/自动化管理。所有操作通过调用 `wsl` 完成。

## 环境常量（照此执行，勿改）
- 发行版名：Ubuntu-22.04
- 源码树：/root/linux-7.3（在 WSL 内）
- 部署内核镜像：/mnt/h/wsl/kernel/bzImage（WSL 内视角，即 Windows 的 H:/wsl/kernel/bzImage）
- 全局配置：C:\Users\Administrator\.wslconfig
- 编译日志：/root/build.log

## 命令规范（必须遵守）
1. run_shell 底层是 cmd.exe，用 cmd 语法；含空格路径加英文双引号。
2. WSL 命令一律形如：wsl -d Ubuntu-22.04 -- <命令>
3. 需要 bash 特性时用：wsl -d Ubuntu-22.04 -- bash -c "命令串"（双引号内按 bash 解析）
4. .wslconfig 的 kernel= 路径必须用正斜杠 H:/wsl/kernel/bzImage；反斜杠会被 INI 当转义符，导致内核设置失效。
5. 不要使用 wmic（被本机安全中心黑名单拦截）。
6. 重编译是长任务（约 20+ 分钟），run_shell 必须显式传 timeout=900000（毫秒，为上限），否则默认 30 秒会被杀，判为失败。

## 操作步骤

### 1. 查当前内核版本
```
wsl -d Ubuntu-22.04 -- uname -r
```
预期返回：7.3.0-microsoft-standard-WSL2

### 2. 查 WSL 运行状态
```
wsl --list --verbose
```
Ubuntu-22.04 行显示 Running 为运行中，Stopped 为已停止。

### 3. 启动 WSL 实例
```
wsl -d Ubuntu-22.04 -- true
```

### 4. 关机 WSL（关闭所有实例）
```
wsl --shutdown
```
修改内核或 .wslconfig 后，必须执行本命令再启动，改动才生效。

### 5. 重新编译内核（长任务）
第一步必须给 run_shell 传 timeout=900000：
```
wsl -d Ubuntu-22.04 -- bash -c "cd /root/linux-7.3 && make -j12 > /root/build.log 2>&1"
```
- 返回码 0 视为编译成功；失败则执行第 8 步看日志定位。
- 成功后拷贝新镜像：
```
wsl -d Ubuntu-22.04 -- bash -c "cp /root/linux-7.3/arch/x86/boot/bzImage /mnt/h/wsl/kernel/bzImage"
```
- 最后提示用户：需执行 wsl --shutdown 后重新启动，uname -r 才会变成新版本号。

### 6. 回滚到微软默认内核
编辑 C:\Users\Administrator\.wslconfig，把 kernel= 这一行行首加 # 注释掉（改成 #kernel= ...），保存后执行 wsl --shutdown。重启后 uname -r 会回到 6.18.40.1-microsoft-standard-WSL2。

### 7. 启用自定义内核（回滚的逆操作）
把 .wslconfig 里的 #kernel= 行改回 kernel= ，保存后执行 wsl --shutdown。

### 8. 查看编译日志（定位编译错误）
```
wsl -d Ubuntu-22.04 -- bash -c "tail -n 60 /root/build.log"
```

## 排错
- uname -r 仍是 6.18：检查 .wslconfig 的 kernel= 是否用了正斜杠、是否被注释；改后务必 wsl --shutdown 再启动。
- 编译报 pahole not found：先执行 wsl -d Ubuntu-22.04 -- bash -c "apt-get install -y dwarves" 再重编。
- 编译中途被杀/超时：run_shell 漏传 timeout=900000。
- 磁盘不足：wsl -d Ubuntu-22.04 -- bash -c "df -h /root" 查看；必要时在源码树 make clean 清中间产物。

## 备注
- 另有一个图形化控制台 WSL2KernelConsole.exe 供人工点按，功能与本技能一致；本技能面向 AI / 命令行自动化调度。
