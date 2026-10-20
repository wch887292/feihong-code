---
name: skills-manager
description: 技能集中管理"手脚"执行器（由飞虹Code 头脑驱动）。封装 skills-manager CLI，实现技能的集中入库、多设备 git 同步、一键部署/撤除到各编码工具（含飞虹Code 自身、Claude Code、Cursor、Codex 等 50+ agent）、上游更新检查、adopt 接管已有技能。触发场景：用户要集中管理 skills、把某技能部署到某工具、同步技能到另一台电脑、检查技能更新、接管已有 agent 目录里的技能、提到 skills-manager。
---

# skills-manager（飞虹Code 的"手脚"）

本 skill 把 [skills-manager](https://github.com/xingkongliang/skills-manager) 的 CLI 封装成飞虹Code 可直接调用的执行器。

**分工**：飞虹Code = 头脑（判断用户意图、拼参数、解读结果）；skills-manager = 手脚（真正管理中央技能库 SQLite、执行 git 同步、读写各 agent 的技能目录）。

## 前置条件

1. `skills-manager-cli` 可用（run.py 按顺序探测：环境变量 `SKILLS_MANAGER_CLI` → PATH → `I:\skills-manager\bin\skills-manager-cli.exe`）。
2. **首次使用先执行 `self_register`**：把飞虹Code 自己注册成 skills-manager 的一个 agent（一次性动作）：
   ```bash
   skills-manager-cli agents add-custom feihong_code --path ~/.feihong-code/skills --name "飞虹Code" --project-path skills
   ```
   注册后，`skills deploy <技能> --agent feihong_code` 即可把技能推回飞虹Code 的全局技能目录（`~/.feihong-code/skills`），项目级对应 `<repo>/skills`——与飞虹Code `skill-loader.ts` 的发现路径一致。

## 使用方式

```bash
# 方式一：高层 action（推荐，run.py 负责拼 CLI 参数）
echo '{"action":"self_register"}' | python3 run.py
echo '{"action":"list","query":"获客"}' | python3 run.py
echo '{"action":"deploy","skills":["08_小红书精准获客员工"],"agents":["feihong_code","cursor"],"dry_run":true}' | python3 run.py

# 方式二：透传原生子命令（头脑直接拼 CLI，适合高层 action 没覆盖的场景）
echo '{"cli":["skills","sync","--dry-run"]}' | python3 run.py
echo '{"cli":["git","push"]}' | python3 run.py

# 方式三：命令行参数
python3 run.py --input '{"action":"agents_list"}'
```

所有调用自动附加 `--json` 全局 flag，输出结构化为 JSON。

## 支持的 action

| action | 对应 CLI | 说明 |
|---|---|---|
| repo_status | `repo status` | 中央库位置/技能数/当前预设 |
| self_register | `agents add-custom feihong_code ...` | 首次把飞虹Code 注册为 agent（一次性） |
| agents_list | `agents list` | 已识别的 agent 清单 |
| agents_enable / agents_disable | `agents enable/disable <keys...>` | 启用/停用 agent |
| install | `skills install <ref> [--local\|--git\|--skillssh] [--name] [--sync\|--sync-preset]` | 安装技能（本地路径 / git URL / 技能市场） |
| list | `skills list [--query][--tag][--preset][--deployed-to][--untagged][--no-preset][--source]` | 列出中央库技能 |
| show | `skills show <ref>` | 单技能详情 |
| export | `skills export <ref>` | 导出技能 |
| update | `skills update [<ref>\|--all]` | 拉上游更新 |
| check | `skills check [<ref>\|--all] [--force]` | 检查是否有更新 |
| remove | `skills remove <refs...> --yes [--dry-run]` | 删除技能（危险，头脑须先向用户确认） |
| deploy | `skills deploy <refs...> --agent <keys...> [--dry-run]` | 部署到 agent 全局技能目录 |
| undeploy | `skills undeploy <refs...> --agent <keys...> [--dry-run]` | 从 agent 撤除 |
| status | `skills status <ref>` | 预设归属 + 各 agent 实际部署状态 |
| sync | `skills sync [--preset][--tool][--dry-run]` | 按预设同步到所有启用 agent |
| search | `skills search <query> [--limit N]` | 技能市场搜索 |
| set_source | `skills set-source <ref> <url> [...]` | 原地改挂 git 源 |
| adopt | `skills adopt <paths...> [--git-url][--git-subpath][--dry-run]` | 接管已有 agent 目录里的技能 |
| tag | `skills tag ...` | 打标签 |
| presets_list / presets_current | `presets list / current` | 预设（分组场景）清单/当前项 |
| git_status / git_pull / git_push / git_commit | `git ...` | 多设备同步（私有备份库） |

## 输入字段

- `cli`：字符串数组，完整原生子命令（**优先于 action**，透传执行）
- `action`：上表其一
- 其余字段按 action 传入：`skills`/`refs`（引用列表）、`agents`（agent key 列表）、`ref`（单引用）、`query`、`tags`、`preset`、`tool`、`paths`、`git_url`、`git_subpath`、`dry_run`、`force`、`limit`、`timeout`（秒，默认 300）

## 输出字段

- `ok`：是否成功
- `data`：skills-manager 的 JSON 原样输出（非 JSON 时为原始文本）
- `error`：失败原因。`skills-manager-cli` 未安装时会返回带安装指引的明确错误。

## 安全约定（头脑必读）

- `remove`、`undeploy`、`git push`、`git restore` 属破坏性/外发动作：头脑必须先向用户复述将影响的技能与目标 agent，确认后再执行（可先 `--dry-run` 预演）。
- `deploy` 建议先 `dry_run: true` 看清单，再真实执行。

## 安装为 Skill

本目录已位于 `~/.feihong-code/skills/skills-manager/`，飞虹Code 全局可发现。复制到其他机器同路径即可复用。
