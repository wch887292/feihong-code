#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SWE-bench 实例运行环境准备器（Windows 本地通道）

为什么需要
----------
SWE-bench 里大量项目是 Python 3.8 时代的老代码：
  - sympy-12236 用 `from collections import Mapping`（3.10 移除）
  - 依赖 distutils（3.12 移除）
  - astropy 需要编译 C 扩展

在系统默认 Python 3.13 上，这些仓库 **import 必然失败**。模型看不到失败原因，
会把整轮预算耗在「反复重试同一条失败命令」上（实测 sympy 实例 40 轮 edit_file=0）。

本脚本为每个实例建一个 `.verify_venv`（Python 3.8）+ 装最小依赖，
让模型至少能 import 仓库、跑通 issue 复现脚本。

用法：
    python setup_instance_env.py                              # 处理 lite-10 全部
    python setup_instance_env.py --instances bench/xxx.json --limit 3
    python setup_instance_env.py --repo sympy                # 只处理某仓库
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
WORK_DIR = BASE_DIR / "work"

PY38 = os.environ.get(
    "FH_PY38",
    r"C:\Users\Administrator\AppData\Roaming\uv\python\cpython-3.8.20-windows-x86_64-none\python.exe",
)

# 每个仓库的最小依赖（够 import 仓库 + 跑 issue 复现即可，不追求完整）
# 依据：lite-10 跑分中 xarray/seaborn/sympy 等因缺依赖 import 失败导致模型空转，
# 这里按各仓库真实 import 链补齐「让仓库能被 import」的最小集合。
REPO_DEPS = {
    "sympy/sympy": ["mpmath"],
    "astropy/astropy": ["numpy", "pyerfa", "packaging", "setuptools", "pyyaml"],
    "pytest-dev/pytest": ["py", "pluggy", "attrs", "packaging", "iniconfig", "toml"],
    "django/django": ["pytz", "sqlparse"],
    "pallets/flask": ["jinja2", "werkzeug", "click", "itsdangerous", "markupsafe"],
    "sphinx-doc/sphinx": ["docutils", "jinja2", "babel", "alabaster", "imagesize", "snowballstemmer", "requests", "setuptools", "packaging"],
    "matplotlib/matplotlib": ["numpy", "cycler", "dateutil", "kiwisolver", "pyparsing", "cycler", "pillow", "fonttools"],
    "scikit-learn/scikit-learn": ["numpy", "scipy", "joblib", "threadpoolctl"],
    "mwaskom/seaborn": ["numpy", "pandas", "matplotlib", "scipy", "statsmodels"],
    "pydata/xarray": ["numpy", "pandas", "packaging", "setuptools", "pytest"],
}

# 用来判断「环境是否已就绪」的探针：import 仓库顶层包
IMPORT_PROBE = {
    "sympy/sympy": "import sympy",
    "astropy/astropy": "import astropy",
    "pytest-dev/pytest": "import pytest",
    "django/django": "import django",
    "pallets/flask": "import flask",
    "sphinx-doc/sphinx": "import sphinx",
    "matplotlib/matplotlib": "import matplotlib",
    "scikit-learn/scikit-learn": "import sklearn",
    "mwaskom/seaborn": "import seaborn",
    "pydata/xarray": "import xarray",
}


def log(msg):
    print(f"[env] {msg}", flush=True)


def run(cmd, cwd, timeout=1800, env=None):
    e = dict(os.environ)
    # 必须清掉 PYTHONPATH/PYTHONHOME：WorkBuddy 的 shim 目录会污染所有子进程
    e.pop("PYTHONPATH", None)
    e.pop("PYTHONHOME", None)
    # 国内 PyPI 镜像：官方源在本机经常 ReadTimeout
    e["PIP_INDEX_URL"] = os.environ.get(
        "FH_PIP_INDEX", "https://pypi.tuna.tsinghua.edu.cn/simple"
    )
    e["PIP_TIMEOUT"] = "60"
    e["PIP_RETRIES"] = "5"
    if env:
        e.update(env)
    try:
        r = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=timeout, env=e,
        )
        return r.returncode, (r.stdout + r.stderr)
    except subprocess.TimeoutExpired:
        return 124, "TIMEOUT"
    except FileNotFoundError as ex:
        return 127, str(ex)


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


def venv_python(venv):
    p = Path(venv) / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    return str(p) if p.exists() else ""


def setup_one(iid, repo, cwd, force=False):
    venv = cwd / ".verify_venv"
    py = venv_python(venv)

    # venv 已就绪且能 import 仓库 → 跳过
    if py and not force:
        probe = IMPORT_PROBE.get(repo, "")
        if probe:
            rc, out = run([py, "-c", probe], cwd, timeout=180)
            if rc == 0:
                return "READY", "环境已就绪"
        else:
            return "READY", "环境已就绪"

    # 建 venv
    if not py:
        if not os.path.exists(PY38):
            return "SKIP", f"找不到 Python 3.8: {PY38}"
        # 若存在空壳 venv，先删掉重建
        if venv.exists():
            import shutil
            tmp = cwd / ".verify_venv__stale"
            try:
                os.rename(venv, tmp)
                shutil.rmtree(tmp, ignore_errors=True)
            except Exception:
                shutil.rmtree(venv, ignore_errors=True)
        rc, out = run([PY38, "-m", "venv", str(venv)], cwd, timeout=300)
        if rc != 0:
            return "FAIL", f"venv 创建失败: {out[-300:]}"
        py = venv_python(venv)
        if not py:
            return "FAIL", "venv 创建后无解释器"

    # 装最小依赖（PEP 668 externally-managed 环境下必须在 venv 内装）
    deps = REPO_DEPS.get(repo, [])
    if deps:
        pip = str(Path(venv) / ("Scripts/pip.exe" if os.name == "nt" else "bin/pip"))
        target = [pip] if os.path.exists(pip) else [py, "-m", "pip"]
        rc, out = run(target + ["install", "--no-cache-dir"] + deps, cwd, timeout=2400)
        if rc != 0:
            # 网络抖动常见，重试一次
            rc, out = run(target + ["install", "--no-cache-dir"] + deps, cwd, timeout=2400)
            if rc != 0:
                return "FAIL", f"依赖安装失败: {out[-300:]}"

    # 自检：能否 import 仓库
    probe = IMPORT_PROBE.get(repo, "")
    if probe:
        rc, out = run([py, "-c", probe], cwd, timeout=300)
        if rc != 0:
            return "PARTIAL", f"依赖装上但 import 失败: {out.strip().splitlines()[-1][:200] if out.strip() else ''}"

    return "READY", "环境就绪"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instances", default=str(BASE_DIR.parent / "swebench-lite-sample-10.json"))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--repo", default="", help="只处理指定仓库名（如 sympy）")
    ap.add_argument("--force", action="store_true", help="强制重建环境")
    args = ap.parse_args()

    if not os.path.exists(PY38):
        log(f"⚠️ 找不到 Python 3.8 解释器: {PY38}")
        log("   请设置环境变量 FH_PY38 指向一个 python3.8 可执行文件")

    insts = load_instances(args.instances)
    if args.limit:
        insts = insts[: args.limit]

    log(f"实例数: {len(insts)}  数据集: {args.instances}")
    stats = {"READY": 0, "PARTIAL": 0, "FAIL": 0, "SKIP": 0}

    for inst in insts:
        iid = (inst.get("instance_id") or "").strip()
        repo = (inst.get("repo") or "").strip()
        if args.repo and args.repo not in repo:
            continue
        cwd = WORK_DIR / iid
        if not (cwd / ".git").exists():
            log(f"⏭️ {iid}: 工作区不存在，跳过")
            continue
        try:
            status, msg = setup_one(iid, repo, cwd, force=args.force)
        except Exception as e:
            status, msg = "FAIL", f"{type(e).__name__}: {e}"
        stats[status] = stats.get(status, 0) + 1
        icon = {"READY": "✅", "PARTIAL": "🟠", "FAIL": "❌", "SKIP": "⏭️"}.get(status, "?")
        log(f"{icon} {iid}: {status} - {msg}")

    log(f"完成：就绪 {stats['READY']} / 部分 {stats['PARTIAL']} / 失败 {stats['FAIL']} / 跳过 {stats['SKIP']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
