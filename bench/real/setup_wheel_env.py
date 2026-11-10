#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SWE-bench 验证加速器：预编译 wheel 提供 C 扩展，源码覆盖二进制

问题
----
astropy 这类项目带 C/Cython 扩展（`extension_helpers.get_extensions()`，约 40 个）。
在 Windows 上从源码编译要 **30~60 分钟**，且常常编译失败（缺 MSVC/版本不匹配）。
实测 astropy-12907 一次验证跑了 40 分钟仍未产出 .pyd。

方案
----
1. 从 PyPI 装与该实例版本匹配的 **预编译 cp38 wheel**（几 MB，秒级），
   拿到全部 .pyd/.dll 二进制。
2. 用 `--no-build-isolation` 把仓库以 editable 方式装进去，Python 侧仍指向
   工作区源码（这样模型改的源码才生效），但**跳过编译**：
   `pip install -e . --no-build-isolation --no-deps`
   若 setup.py 仍要编译，则退化为「wheel 里解压 .pyd 覆盖到源码树」。

实测结论（astropy-12907）：
   - 纯源码编译：>40 分钟仍未完成
   - wheel 方案：数分钟可 import，且改源码立即生效

用法：
    python setup_wheel_env.py --instances bench/xxx.json [--limit N] [--repo astropy]
"""
import argparse
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
WORK_DIR = BASE_DIR / "work"

PY38 = os.environ.get(
    "FH_PY38",
    r"C:\Users\Administrator\AppData\Roaming\uv\python\cpython-3.8.20-windows-x86_64-none\python.exe",
)

# 需要二进制扩展、适合走 wheel 方案的项目
WHEEL_TARGETS = {"astropy/astropy", "numpy/numpy", "scikit-learn/scikit-learn"}

# 每个实例的发行版本（用于挑对应 wheel）
EXTRA_DEPS = {
    "astropy/astropy": ["numpy", "pyerfa"],
    "scikit-learn/scikit-learn": ["numpy", "scipy", "joblib", "threadpoolctl"],
}


def log(msg):
    print(f"[wheel] {msg}", flush=True)


def run(cmd, cwd=None, timeout=2400):
    e = dict(os.environ)
    e.pop("PYTHONPATH", None)
    e.pop("PYTHONHOME", None)
    # 国内 PyPI 镜像：官方 files.pythonhosted.org 在本机经常 ReadTimeout（实测 wheel 下载失败），
    # 清华/阿里镜像 0.5s 可达且 wheel 齐全（astropy 4.3 cp38-win_amd64 两边都有 82 个版本）。
    e["PIP_INDEX_URL"] = os.environ.get(
        "FH_PIP_INDEX", "https://pypi.tuna.tsinghua.edu.cn/simple"
    )
    e["PIP_TIMEOUT"] = "60"
    e["PIP_RETRIES"] = "5"
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


def pip_download_wheel(pkg, version, dest):
    """用 pip download 拿 wheel（pip 会自动挑匹配 cp38 win_amd64 的）"""
    cmd = [
        PY38, "-m", "pip", "download", "--only-binary", ":all:",
        "--no-deps", "--no-cache-dir", "-d", str(dest),
    ]
    if version:
        cmd.append(f"{pkg}=={version}")
    else:
        cmd.append(pkg)
    return run(cmd, timeout=1200)


def extract_wheel_binaries(wheel_path, repo_src_dir):
    """把 wheel 里的 .pyd/.dll 覆盖到源码树（源码 .py 优先，二进制用 wheel 的）"""
    count = 0
    with zipfile.ZipFile(wheel_path) as zf:
        for name in zf.namelist():
            if not name.endswith((".pyd", ".dll", ".so")):
                continue
            # wheel 内路径形如 astropy/__init__.cp38-win_amd64.pyd
            rel = re.sub(r"\.cp3\d-[^/]*\.(pyd|so)$", r".\1", name)
            target = Path(repo_src_dir) / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(name) as src, open(target, "wb") as dst:
                dst.write(src.read())
            count += 1
    return count


def clean_wheel_binaries(repo_src_dir, pkg):
    """清理源码树里被 wheel 覆盖进来的 .pyd/.dll（恢复纯净源码树）

    判据：源码树里存在同名 .pyx（或该目录下没有对应的 wheel 专有扩展），
    则该 .pyd 属于「误覆盖」——因为若源码本身需要该扩展，源码树里应能编译出它。
    简化策略：把源码树下**所有** .pyd 都清掉，让 pip editable 安装重新按源码编译；
    若编译不成功，至少源码树是纯净的（缺扩展报 ImportError，而非 segfault）。
    """
    src = Path(repo_src_dir)
    count = 0
    for p in src.rglob("*.pyd"):
        # site-packages 在工作区之外，不会被误伤
        try:
            p.unlink()
            count += 1
        except Exception:
            pass
    return count


def setup_one(inst):
    iid = (inst.get("instance_id") or "").strip()
    repo = (inst.get("repo") or "").strip()
    if repo not in WHEEL_TARGETS:
        return "SKIP", "非 wheel 目标项目"

    cwd = WORK_DIR / iid
    if not (cwd / ".git").exists():
        return "SKIP", "工作区不存在"

    venv = cwd / ".verify_venv"
    py = venv_python(venv)
    if not py:
        rc, out = run([PY38, "-m", "venv", str(venv)], cwd, timeout=300)
        if rc != 0:
            return "FAIL", f"venv 创建失败: {out[-200:]}"
        py = venv_python(venv)
        if not py:
            return "FAIL", "venv 无解释器"

    version = str(inst.get("version") or "").strip()
    pkg = repo.split("/")[1]

    # 1) 装额外纯 Python 依赖
    deps = EXTRA_DEPS.get(repo, [])
    if deps:
        rc, out = run([py, "-m", "pip", "install", "--no-cache-dir"] + deps, cwd, timeout=2400)
        if rc != 0:
            rc, out = run([py, "-m", "pip", "install", "--no-cache-dir"] + deps, cwd, timeout=2400)
            if rc != 0:
                return "FAIL", f"依赖安装失败: {out[-200:]}"

    # 2) 装预编译 wheel（先普通安装，再把二进制覆盖回源码树）
    dest = cwd / ".wheel_cache"
    dest.mkdir(exist_ok=True)
    rc, out = pip_download_wheel(pkg, version, dest)
    if rc != 0:
        return "FAIL", f"wheel 下载失败: {out[-200:]}"
    wheels = list(dest.glob(f"{pkg}-{version or '*'}*.whl"))
    if not wheels:
        return "FAIL", "未找到匹配 wheel"
    wheel = wheels[0]
    log(f"{iid}: wheel = {wheel.name}")

    # 3) 安装 wheel（拿到 .pyd 到 site-packages）
    rc, out = run([py, "-m", "pip", "install", "--no-cache-dir", "--force-reinstall",
                   "--no-deps", str(wheel)], cwd, timeout=1800)
    if rc != 0:
        return "FAIL", f"wheel 安装失败: {out[-200:]}"

    # 4) 【不要把 wheel 的 .pyd 覆盖到源码树】
    #    反例（astropy-12907 实测）：4.3 正式版 wheel 的 astropy/time/_parse_times.pyd
    #    覆盖到源码树后，该 commit 的 astropy/time/formats.py 根本不需要这个扩展，
    #    却被 wheel 版的 __init__ 逻辑拉进来 → ABI 不匹配 → **Segmentation fault (exit 139)**，
    #    比缺扩展严重得多（静默崩溃、无 traceback）。
    #    正确做法：源码树保持干净（只用该 commit 自己的 .pyx 编译产物），
    #    wheel 的二进制只留在 site-packages 供「源码未覆盖到的部分」使用。
    #
    #    这里仅清理此前误覆盖进源码树的 wheel 二进制，恢复纯净源码树。
    removed = clean_wheel_binaries(cwd, pkg)
    if removed:
        log(f"{iid}: 清理源码树中误覆盖的 wheel 二进制 {removed} 个")

    # 5) 验证：源码树优先，缺失的扩展由 site-packages 兜底
    probe = f"import {pkg}"
    rc, out = run([py, "-c", probe], cwd, timeout=300)
    if rc != 0:
        tail = out.strip().splitlines()[-1][:200] if out.strip() else ""
        return "PARTIAL", f"import 失败: {tail}"

    rc, out = run([py, "-c", f"import {pkg}; print({pkg}.__file__)"], cwd, timeout=180)
    src = out.strip().splitlines()[-1] if out.strip() else ""
    return "READY", f"import 来自: {src}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instances", default=str(BASE_DIR.parent / "swebench-lite-sample-10.json"))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--repo", default="", help="只处理指定仓库名")
    args = ap.parse_args()

    insts = load_instances(args.instances)
    if args.limit:
        insts = insts[: args.limit]

    log(f"实例数: {len(insts)}")
    stats = {"READY": 0, "PARTIAL": 0, "FAIL": 0, "SKIP": 0}
    for inst in insts:
        iid = (inst.get("instance_id") or "").strip()
        repo = (inst.get("repo") or "").strip()
        if args.repo and args.repo not in repo:
            continue
        try:
            status, msg = setup_one(inst)
        except Exception as e:
            status, msg = "FAIL", f"{type(e).__name__}: {e}"
        stats[status] = stats.get(status, 0) + 1
        icon = {"READY": "✅", "PARTIAL": "🟠", "FAIL": "❌", "SKIP": "⏭️"}.get(status, "?")
        log(f"{icon} {iid}: {status} - {msg}")

    log(f"完成：就绪 {stats['READY']} / 部分 {stats['PARTIAL']} / 失败 {stats['FAIL']} / 跳过 {stats['SKIP']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
