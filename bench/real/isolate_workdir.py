#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SWE-bench 工作区「未来提交隔离器」（Windows 本地通道）

问题
----
prepare_workdirs.py 用 `git clone --filter=blob:none` 克隆整仓，然后把工作区
checkout 到 base_commit。checkout 之后，仓库里**仍然保留着 base_commit 之后的
全部上游提交**（astropy 9037 个、sympy 36150 个、pytest 3760 个），其中就包含
官方修复补丁本身。模型只要执行 `git log --all` / `git log -S <关键字>`，
就能直接翻到答案 —— 这会让跑分完全失去意义。

处理
----
把仓库「钉死」在 base_commit 这一个点上：
  1. 删除所有 refs（远端跟踪分支、其他本地分支、tags）
  2. 清理 reflog
  3. gc --prune=now 清除不可达对象（含未来的 commit/blob）
  4. 重置 index 与工作区

结果
----
`git log --all` 只能看到 base_commit **及其之前**的历史 —— 与 SWE-bench 官方
docker 镜像对 agent 暴露的视野保持一致（官方镜像同样 checkout 到 base_commit），
且额外堵住了「翻未来提交抄答案」的捷径。

用法：
    python isolate_workdir.py                  # 隔离 work 下所有仓库
    python isolate_workdir.py --repo astropy   # 只隔离指定仓库
    python isolate_workdir.py --check          # 只体检，不改动
"""
import argparse
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
WORK_DIR = BASE_DIR / "work"


def run(cmd, cwd, timeout=1800):
    return subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=timeout,
    )


def repo_head_info(repo_dir):
    """返回 (当前HEAD短hash, base之后可见的提交数, 是否存在未来提交)"""
    head = run(["git", "rev-parse", "--short", "HEAD"], repo_dir, 60)
    head_sha = head.stdout.strip() if head.returncode == 0 else "?"
    refs = run(["git", "for-each-ref", "--format=%(refname)"], repo_dir, 60)
    n_refs = len([x for x in refs.stdout.splitlines() if x.strip()]) if refs.returncode == 0 else 0
    # 未来提交数 = 所有 ref 可达提交 - HEAD 可达提交
    cnt = run(["git", "rev-list", "--count", "--all"], repo_dir, 300)
    cnt_head = run(["git", "rev-list", "--count", "HEAD"], repo_dir, 300)
    future_n = -1
    if cnt.returncode == 0 and cnt_head.returncode == 0:
        future_n = int(cnt.stdout.strip()) - int(cnt_head.stdout.strip())
    return head_sha, n_refs, future_n


def isolate(repo_dir, check_only=False):
    head_sha, n_refs, future_n = repo_head_info(repo_dir)
    if check_only:
        return head_sha, n_refs, future_n, "CHECK"

    # 1) 删掉除 HEAD 之外的所有 refs
    refs = run(["git", "for-each-ref", "--format=%(refname)"], repo_dir, 60)
    deleted = 0
    if refs.returncode == 0:
        for ref in [x.strip() for x in refs.stdout.splitlines() if x.strip()]:
            d = run(["git", "update-ref", "-d", ref], repo_dir, 60)
            if d.returncode == 0:
                deleted += 1

    # 2) 清理 reflog（否则 --all 之外的路径仍可能触达未来对象）
    run(["git", "reflog", "expire", "--expire=now", "--expire-unreachable=now", "--all"], repo_dir, 120)

    # 3) 清除不可达对象
    gc = run(["git", "gc", "--prune=now", "--quiet"], repo_dir, 1800)

    # 4) 复位工作区
    run(["git", "checkout", "--force", "."], repo_dir, 600)
    run(["git", "clean", "-fdq", "-e", "!.verify_venv", "-e", "!.verify_venv/*"], repo_dir, 300)

    head2, n_refs2, future2 = repo_head_info(repo_dir)
    status = "OK" if future2 <= 0 else "WARN"
    return head2, deleted, future2, status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="", help="只处理指定仓库目录名（空=全部）")
    ap.add_argument("--check", action="store_true", help="只体检不改动")
    args = ap.parse_args()

    if not WORK_DIR.exists():
        print(f"[isolate] 工作区目录不存在: {WORK_DIR}")
        return 1

    repos = sorted([d for d in WORK_DIR.iterdir() if (d / ".git").exists()])
    if args.repo:
        repos = [d for d in repos if d.name == args.repo]

    if not repos:
        print("[isolate] 没有找到任何 git 工作区")
        return 1

    print(f"[isolate] 待处理 {len(repos)} 个工作区")
    for repo_dir in repos:
        try:
            if args.check:
                head, n_refs, future = repo_head_info(repo_dir)
                flag = "❌ 有泄漏" if future > 0 else "✅ 干净"
                print(f"  {repo_dir.name}: HEAD={head} refs={n_refs} 未来提交={future}  {flag}")
            else:
                head, deleted, future, status = isolate(repo_dir)
                flag = "✅" if future <= 0 else "⚠️"
                print(f"  {flag} {repo_dir.name}: 删除refs={deleted} 剩余未来提交={future} ({status})")
        except Exception as e:
            print(f"  ❌ {repo_dir.name}: {type(e).__name__}: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
