---
name: "Git Flow 流程助手"
description: "Git 提交规范、分支管理、rebase/合并、冲突解决的操作指引。"
---

# Git Flow 流程助手

<!-- 模板占位：使用 `fhcode skill-new <name> --template git-flow` 复制并定制 -->

## 触发
当用户涉及 commit / branch / rebase / merge / 冲突解决 / 回滚时使用。

## 执行步骤
1. 先查看当前状态：git status / git log --oneline -5 / git branch
2. 提交规范：conventional commits（feat/fix/docs/style/refactor/perf/test/chore），正文说明为什么
3. 分支操作：新功能用 feat/<name>，修复用 fix/<name>，完成后合并回主分支
4. rebase 冲突：git rebase --continue 前先解决冲突文件，git add 后继续
5. 回滚：区分 revert（保留历史）与 reset（丢弃历史），谨慎操作

## 输出格式
给出可直接执行的命令序列 + 每步说明 + 风险提示。
