#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SWE-bench 工作区准备器（Windows 本地通道）

跑分脚本 scripts/swebench-real.mjs 要求每个实例的工作区位于：
    bench/real/work/<repo_name>          （且已 checkout 到 base_commit）

克隆产物位于：
    bench/real/base_images/<repo_name>/src

本脚本把克隆产物装配到 work 目录并 checkout 到指定 base_commit。
克隆优先用 gitee 镜像（国内快，commit hash 与 GitHub 一致）。

用法：
    python prepare_workdirs.py                          # 按默认样本批量准备
    python prepare_workdirs.py --instances bench/swebench-lite-sample-10.json
    python prepare_workdirs.py --limit 3
    python prepare_workdirs.py --instances xxx.json --no-clone   # 只装配已克隆的
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
REAL_DIR = BASE_DIR
WORK_DIR = REAL_DIR / "work"
SRC_BASE = REAL_DIR / "base_images"

# GitHub owner -> 镜像仓库名（gitee mirrors 下的目录名）
MIRROR_NAMES = {
    "psf": "requests",
    "pytest-dev": "pytest",
    "django": "django",
    "sympy": "sympy",
    "scikit-learn": "scikit-learn",
    "sphinx-doc": "sphinx",
    "matplotlib": "matplotlib",
    "astropy": "astropy",
    "pydata": "xarray",
    "pylint-dev": "pylint",
}

MIRRORS = [
    "https://gitee.com/mirrors",
    "https://github.com",
    "https://gitclone.com/github.com",
]


def log(msg):
    print(f"[workdir] {msg}", flush=True)


def run(cmd, cwd=None, timeout=1800, check=False):
    return subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=timeout, check=check,
    )


def load_instances(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        for key in ("instances", "data", "rows"):
            if key in data and isinstance(data[key], list):
                data = data[key]
                break
        else:
            data = list(data.values())
    return data


def repo_name_of(inst):
    """astropy/astropy -> astropy"""
    repo = (inst.get("repo") or "").strip()
    return repo.split("/")[-1] if repo else ""


def clone_repo(owner, name):
    """克隆到 base_images/<name>/src，用镜像轮换"""
    target = SRC_BASE / name / "src"
    if target.exists() and (target / ".git").exists():
        log(f"{name}: 已存在，跳过克隆")
        return True
    target.parent.mkdir(parents=True, exist_ok=True)
    candidates = []
    for base in MIRRORS:
        if base.endswith("github.com"):
            candidates.append(f"https://github.com/{owner}/{name}.git")
        else:
            mirror = MIRROR_NAMES.get(owner, name)
            candidates.append(f"{base.rstrip('/')}/{mirror}.git")
    for i, url in enumerate(candidates, 1):
        log(f"{name}: 克隆尝试 {i}/{len(candidates)} → {url}")
        r = run(["git", "clone", "--filter=blob:none", url, str(target)], timeout=3600)
        if r.returncode == 0 and (target / ".git").exists():
            log(f"{name}: ✅ 克隆成功 ({url})")
            return True
        log(f"{name}: 失败 rc={r.returncode} {r.stderr.strip()[:160]}")
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
    return False


def prepare(inst, do_clone=True):
    owner_repo = (inst.get("repo") or "").strip()
    owner = owner_repo.split("/")[0] if "/" in owner_repo else ""
    name = repo_name_of(inst)
    if not name:
        return False, "缺少 repo 字段"

    src = SRC_BASE / name / "src"
    if not (src / ".git").exists():
        if not do_clone:
            return False, "未克隆且禁用克隆"
        if not clone_repo(owner, name):
            return False, "克隆失败"

    # 装配到 work/<instance_id>
    # 注意：不做递归删除（大批量删除会被安全策略拦截）。
    # 若目标已存在，改为「就地复用 + 强制复位」：checkout 到 base_commit 后 git clean，
    # 既保证状态干净，也避免删除操作。
    #
    # 【重要】目录按 instance_id 而不是 repo 名：同一仓库常有多个实例
    # （如 astropy-12907 与 astropy-7746 的 base_commit 不同），共用目录会互相
    # 切换 HEAD，导致 test_patch 贴不上、验证结论失真。
    iid = (inst.get("instance_id") or name).strip()
    dst = WORK_DIR / iid
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        log(f"{name}: 工作区已存在，就地复用并复位")
    else:
        log(f"{name}: 复制 {src} → {dst}")
        shutil.copytree(src, dst, symlinks=True)

    # checkout base_commit
    base_commit = (inst.get("base_commit") or "").strip()
    if base_commit:
        r = run(["git", "checkout", "--force", base_commit], cwd=dst, timeout=600)
        if r.returncode != 0:
            # 回退到分支
            r2 = run(["git", "checkout", "--force", "HEAD"], cwd=dst, timeout=600)
            log(f"{name}: ⚠️ checkout {base_commit[:10]} 失败 rc={r.returncode}")
        else:
            log(f"{name}: ✅ checkout {base_commit[:10]}")
    # 复位工作区：丢弃已跟踪文件的修改 + 忽略未跟踪文件（不做物理删除，避免触发批量删除保护）
    run(["git", "checkout", "--force", "."], cwd=dst, timeout=600)
    run(["git", "clean", "-fdq", "-e", "!.verify_venv", "-e", "!.verify_venv/*"], cwd=dst, timeout=300)
    # 【公平性】立即隔离「未来提交」：整仓克隆会保留 base_commit 之后的官方修复补丁，
    # 模型执行 git log --all 就能直接抄答案，必须钉死在 base_commit。
    try:
        import isolate_workdir
        head, deleted, future, status = isolate_workdir.isolate(dst)
        if future > 0:
            log(f"{iid}: ⚠️ 隔离后仍有 {future} 个未来提交")
        else:
            log(f"{iid}: ✅ 已隔离未来提交 (删refs={deleted})")
    except Exception as e:
        log(f"{iid}: ⚠️ 隔离失败 {type(e).__name__}: {e}")
    return True, "OK"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instances", default=str(BASE_DIR.parent / "swebench-lite-sample-10.json"))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-clone", action="store_true")
    args = ap.parse_args()

    insts = load_instances(args.instances)
    if args.limit:
        insts = insts[: args.limit]
    log(f"实例数: {len(insts)}  数据集: {args.instances}")

    ok, fail = 0, 0
    for inst in insts:
        iid = inst.get("instance_id", "?")
        try:
            good, msg = prepare(inst, do_clone=not args.no_clone)
        except Exception as e:  # 单实例失败不影响整体
            good, msg = False, f"{type(e).__name__}: {e}"
        if good:
            ok += 1
            log(f"✅ {iid}")
        else:
            fail += 1
            log(f"❌ {iid} → {msg}")
    log(f"完成：成功 {ok}，失败 {fail}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
