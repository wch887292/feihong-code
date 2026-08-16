---
name: grill
description: 红队式代码审查（只读）：对指定路径/文件做安全与质量审查，输出问题清单与严重级别。触发词：审查、review、红队、安全审计、grill。
---

# /grill 技能：红队式代码审查

**只读技能**：只审查，不修改任何文件。

## 工作流
1. 定位目标：默认审查当前目录，也可指定文件/目录。
2. 扫描：递归收集目标下的源文件。
3. 逐文件应用审查规则，重点关注：
   - 命令注入（shell 拼接、exec/eval）
   - 路径穿越（../、未校验的用户路径）
   - 密钥硬编码（apiKey、password、token、sk-）
   - SQL 拼接注入
   - 不安全的 eval / 反序列化
4. 汇总问题清单。

## 输出格式
```
【/grill】<summary>
  [CRITICAL|HIGH|MEDIUM|LOW] <file>:<line> (<rule>) <detail>
  未发现明显问题。
```

## 严重级别
- critical：可被远程利用的安全漏洞
- high：明确的安全/质量缺陷
- medium：潜在风险或坏味道
- low：风格/健壮性建议
