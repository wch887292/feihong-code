---
name: "REA 逆向工程助手"
description: "逆向分析原生二进制、JavaScript/Electron 应用、.NET 程序集与网站，不依赖源码即可解释功能原理并输出带证据的结论。适配自 morluto/rea（Reverse Engineer Anything）。"
---

# REA 逆向工程助手

> 上游项目：https://github.com/morluto/rea ｜ 协议：MIT ｜ 需要 Node.js 22.x / 24.x / 26+

## 触发
当用户想"弄懂某个应用/功能是怎么实现的"，目标包括：原生二进制、JavaScript/Electron 应用（含 ASAR）、.NET 程序集、APK、固件、网站；或"把某个功能逆向后复刻进自己的项目"时使用。

## 前置（一次性初始化）
```bash
npx rea-agents setup        # 注册 MCP + 安装匹配版本的工作流，自动备份旧配置
npx -y rea-agents@latest doctor   # 诊断：检查宿主、依赖、分析引擎、Agent 配置
```
- 静态 JS/Electron 分析无需任何引擎，装完即可用。
- 原生二进制深度分析需已装 Hopper / Ghidra 12.1.x / IDA Pro（自带，REA 不代装）。
- 引擎多选冲突时，用 `--provider` 或环境变量 `REA_ANALYSIS_PROVIDER` 指定一个。

## 执行步骤
1. 明确目标类型与路径：原生程序 / JS-Electron(ASAR) / .NET / APK / 网站 / 固件。
2. 静态 JS/Electron 直接分析：
   ```bash
   npx -y rea-agents@latest analyze-javascript-application <绝对路径> --json
   ```
3. 原生目标先 `rea doctor --provider ghidra|hopper|ida --json` 确认引擎健康，再打开目标做函数/内存/镜像级检查。
4. 每步要求返回 Evidence（证据）、recovered graph（恢复图）、limitations（局限）、unknowns（未知项）。
5. 结合证据向用户解释"功能如何工作"，并可据此构造复刻方案。

## 输出格式
```
分析对象：<路径/目标>
功能原理：<带证据的解释>
证据：<文件:行 / 调用链 / 内存快照>
局限：<本次无法确认的项>
未知项：<待进一步逆向的项>
复刻建议：<可选，若用户想复刻>
```

## 边界
- 只做逆向分析与解释，产出证据导向结论；不复刻受版权/协议限制的闭源组件。
- 不改写用户已有代码结构，仅在用户要求复刻时给出方案。
