#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""skills-manager 执行器（飞虹Code 的"手脚"）。

飞虹Code（头脑）通过本脚本驱动 skills-manager-cli，真实地管理中央技能库、
git 同步、把技能部署/撤除到各编码 agent（含飞虹Code 自身）。

输入：JSON（--input '...' 或 stdin）
  {"cli": ["skills", "deploy", "xxx", "--agent", "feihong_code"]}   # 透传原生子命令
  {"action": "deploy", "skills": ["xxx"], "agents": ["feihong_code"], "dry_run": true}
  {"action": "list", "query": "获客"}
输出：JSON {"ok": bool, "data": <skills-manager 原样输出>, "error": str|null}
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

CLI_NAME = "skills-manager-cli"
# CLI 探测顺序：环境变量 > PATH > I 盘固定安装位
CLI_CANDIDATES = [
    os.environ.get("SKILLS_MANAGER_CLI", ""),
    shutil.which(CLI_NAME) or "",
    r"I:\skills-manager\bin\skills-manager-cli.exe",
]
FH_AGENT_KEY = "feihong_code"
FH_AGENT_NAME = "飞虹Code"
FH_SKILLS_GLOBAL = os.path.normpath(os.path.expanduser("~/.feihong-code/skills"))
FH_SKILLS_PROJECT = "skills"  # 相对仓库根，与飞虹Code skill-loader.ts 一致
DEFAULT_TIMEOUT = 300


def find_cli():
    """三级探测 skills-manager-cli：env SKILLS_MANAGER_CLI > PATH > I:\\skills-manager\\bin。"""
    for c in CLI_CANDIDATES:
        if c and os.path.isfile(c):
            return c
    return None


def _fail(error, code=2):
    print(json.dumps({"ok": False, "data": None, "error": error}, ensure_ascii=False))
    return code


def build_argv(action, p):
    """高层 action -> skills-manager-cli 子命令 argv（字段均对照 CLI 源码核实）。"""
    refs = p.get("skills") or p.get("refs") or p.get("paths") or []
    agents = p.get("agents") or []

    if action == "repo_status":
        return ["repo", "status"]
    if action == "self_register":
        return ["agents", "add-custom", FH_AGENT_KEY,
                "--path", FH_SKILLS_GLOBAL,
                "--name", FH_AGENT_NAME,
                "--project-path", FH_SKILLS_PROJECT]
    if action == "agents_list":
        return ["agents", "list"]
    if action in ("agents_enable", "agents_disable"):
        if not agents:
            raise ValueError("agents_enable/disable 需要 agents 字段（key 列表）")
        return ["agents", "enable" if action == "agents_enable" else "disable", *map(str, agents)]
    if action == "install":
        if not p.get("ref"):
            raise ValueError("install 需要 ref（本地路径 / git URL / owner/repo）")
        cmd = ["skills", "install", str(p["ref"])]
        if p.get("local"):
            cmd.append("--local")
        elif p.get("git"):
            cmd.append("--git")
        elif p.get("skillssh"):
            cmd.append("--skillssh")
        if p.get("name"):
            cmd += ["--name", str(p["name"])]
        if p.get("sync"):
            cmd.append("--sync")
        elif p.get("sync_preset"):
            cmd += ["--sync-preset", str(p["sync_preset"])]
        return cmd
    if action == "list":
        cmd = ["skills", "list"]
        if p.get("query"):
            cmd += ["--query", str(p["query"])]
        for t in (p.get("tags") or []):
            cmd += ["--tag", str(t)]
        if p.get("preset"):
            cmd += ["--preset", str(p["preset"])]
        if p.get("deployed_to"):
            cmd += ["--deployed-to", str(p["deployed_to"])]
        if p.get("untagged"):
            cmd.append("--untagged")
        if p.get("no_preset"):
            cmd.append("--no-preset")
        if p.get("source"):
            cmd += ["--source", str(p["source"])]
        return cmd
    if action == "show":
        if not p.get("ref"):
            raise ValueError("show 需要 ref")
        return ["skills", "show", str(p["ref"])]
    if action == "export":
        if not p.get("ref"):
            raise ValueError("export 需要 ref")
        cmd = ["skills", "export", str(p["ref"])]
        if p.get("output"):
            cmd += ["--output", str(p["output"])]
        if p.get("force"):
            cmd.append("--force")
        return cmd
    if action in ("update", "check"):
        cmd = ["skills", action]
        if p.get("ref"):
            cmd.append(str(p["ref"]))
        elif p.get("all"):
            cmd.append("--all")
        if action == "check" and p.get("force"):
            cmd.append("--force")
        return cmd
    if action == "remove":
        if not refs:
            raise ValueError("remove 需要 skills/refs 列表（危险动作，须先经用户确认）")
        cmd = ["skills", "remove", *map(str, refs), "--yes"]
        if p.get("dry_run"):
            cmd.append("--dry-run")
        return cmd
    if action in ("deploy", "undeploy"):
        if not refs:
            raise ValueError(f"{action} 需要 skills/refs 列表")
        if not agents:
            raise ValueError(f"{action} 需要 agents 列表（目标 agent key）")
        cmd = ["skills", action, *map(str, refs), "--agent", *map(str, agents)]
        if p.get("dry_run"):
            cmd.append("--dry-run")
        return cmd
    if action == "status":
        if not p.get("ref"):
            raise ValueError("status 需要 ref")
        return ["skills", "status", str(p["ref"])]
    if action == "sync":
        cmd = ["skills", "sync"]
        if p.get("preset"):
            cmd += ["--preset", str(p["preset"])]
        if p.get("tool"):
            cmd += ["--tool", str(p["tool"])]
        if p.get("dry_run"):
            cmd.append("--dry-run")
        return cmd
    if action == "search":
        if not p.get("query"):
            raise ValueError("search 需要 query")
        cmd = ["skills", "search", str(p["query"])]
        if p.get("limit"):
            cmd += ["--limit", str(p["limit"])]
        return cmd
    if action == "set_source":
        if not p.get("ref"):
            raise ValueError("set_source 需要 ref")
        if not p.get("git_url"):
            raise ValueError("set_source 需要 git_url（git URL 或 owner/repo）")
        cmd = ["skills", "set-source", str(p["ref"]), "--git-url", str(p["git_url"])]
        if p.get("subpath") is not None:
            cmd += ["--subpath", str(p["subpath"])]
        if p.get("branch"):
            cmd += ["--branch", str(p["branch"])]
        if p.get("force"):
            cmd.append("--force")
        if p.get("dry_run"):
            cmd.append("--dry-run")
        return cmd
    if action == "adopt":
        if not refs:
            raise ValueError("adopt 需要 paths（要接管的技能目录）")
        cmd = ["skills", "adopt", *map(str, refs)]
        if p.get("git_url"):
            cmd += ["--git-url", str(p["git_url"])]
        if p.get("git_subpath") is not None:
            cmd += ["--git-subpath", str(p["git_subpath"])]
        if p.get("dry_run"):
            cmd.append("--dry-run")
        return cmd
    if action == "presets_list":
        return ["presets", "list"]
    if action == "presets_current":
        return ["presets", "current"]
    if action == "git_status":
        return ["git", "status"]
    if action in ("git_pull", "git_push"):
        return ["git", action.split("_", 1)[1]]
    if action == "git_commit":
        msg = p.get("message") or "sync by feihong-code"
        return ["git", "commit", "--message", str(msg)]
    raise ValueError(f"未知 action: {action}（可用 cli 字段透传任意原生子命令）")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input")
    ap.add_argument("--llm", action="store_true", help="兼容 feihongzhi_agents 惯例，本 skill 不用")
    args = ap.parse_args()

    raw = args.input if args.input is not None else sys.stdin.read().strip()
    if not raw:
        return _fail("缺少输入 JSON：用 --input '...' 或 stdin 传入")
    try:
        req = json.loads(raw)
        if not isinstance(req, dict):
            raise ValueError("输入必须是 JSON 对象")
    except Exception as e:
        return _fail(f"输入不是合法 JSON 对象: {e}")

    cli = req.get("cli")
    if cli:
        if not isinstance(cli, list) or not all(isinstance(x, str) for x in cli):
            return _fail("cli 字段必须是字符串数组，如 [\"skills\",\"list\"]")
        argv = cli
    else:
        action = req.get("action")
        if not action:
            return _fail("需要 cli（原生子命令数组）或 action（高层简写）字段")
        try:
            argv = build_argv(str(action), req)
        except ValueError as e:
            return _fail(str(e))

    exe = find_cli()
    if not exe:
        return _fail(
            f"未找到 {CLI_NAME}：按顺序探测了 环境变量 SKILLS_MANAGER_CLI → PATH → "
            r"I:\skills-manager\bin\skills-manager-cli.exe，均不存在。"
            f"请安装 skills-manager（参考 https://github.com/xingkongliang/skills-manager），"
            f"或将 CLI 路径写入环境变量 SKILLS_MANAGER_CLI。",
            code=3,
        )

    timeout = req.get("timeout") or DEFAULT_TIMEOUT
    cmd = [exe, "--json", *argv]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        return _fail(f"执行超时（>{timeout}s）：{cmd}", code=3)
    except Exception as e:
        return _fail(f"执行失败: {e}", code=3)

    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    parsed = None
    if out:
        try:
            parsed = json.loads(out)
        except Exception:
            parsed = out  # 非 JSON 输出原样透传
    if proc.returncode != 0:
        print(json.dumps({"ok": False, "data": parsed,
                          "error": err or f"{CLI_NAME} exit={proc.returncode}"},
                         ensure_ascii=False))
        return proc.returncode or 1
    print(json.dumps({"ok": True, "data": parsed, "error": None}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
