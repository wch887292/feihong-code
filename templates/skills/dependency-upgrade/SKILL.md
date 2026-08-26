---
name: "依赖升级检查"
description: "检查依赖版本、升级风险与兼容性，生成安全升级方案。"
---

# 依赖升级检查

<!-- 模板占位：使用 `fhcode skill-new <name> --template dependency-upgrade` 复制并定制 -->

## 触发
当用户说"升级依赖/检查过时包/依赖有漏洞"时使用。

## 执行步骤
1. 现状盘点：package.json 依赖清单 + 版本范围
2. 检查：npm outdated / npm audit / osv-scanner 结果
3. 升级分级：
   - patch：直接升（低风险）
   - minor：读 changelog，关注破坏性变更
   - major：大版本，检查 breaking changes + 迁移指南
4. 每项升级：当前 → 目标版本、风险、影响面、验证方式
5. 输出分阶段升级顺序（先安全补丁，后大版本）

## 输出格式
依赖升级清单（含风险与验证）+ 建议顺序。

## 自检与边界
- 只给出建议命令，不代替用户实际执行升级
- 版本号必须来自 package.json / 官方 changelog，禁止编造版本
- 大版本升级必须附迁移要点；未实际验证前标注"待验证"
