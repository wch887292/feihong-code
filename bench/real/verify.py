#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
飞虹 Code · SWE-bench 真实验证脚本（env-reconstructed，非 mock）

对每个实例：
  1. 在 base_commit 工作区应用【模型 patch】(predictions) + 【test_patch】(SWE-bench 测试补丁)
  2. 重建 Python 环境（venv）并安装仓库运行/测试依赖
  3. 运行 FAIL_TO_PASS 测试；可选运行部分 PASS_TO_PASS 做回归检查
  4. 判定 resolved = 全部 FAIL_TO_PASS 通过

注意：这是“环境重建式”验证（与官方 Docker eval 镜像等价思路，但用本地 venv 重建），
      在报告中会如实标注方法差异。若环境安装失败则诚实标注“未验证”。
"""
import json, os, sys, subprocess, shutil, tempfile, argparse, re, ast

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORK = os.path.join(ROOT, "bench", "real", "work")
PATCHES = os.path.join(ROOT, "bench", "real", "patches")
REAL = os.path.join(ROOT, "bench", "real")

REPO_INSTALL = {
    "django/django": {
        "pip": ["-e", ".", "pytz", "tblib", "docutils", "jinja2"],
        "test_cmd": lambda ftp: ["tests/runtests.py", ftp[0].split("::")[0].replace("tests/", "expressions" ) ] if False else None,
    },
}

def run(cmd, cwd, timeout=600):
    print("  $", " ".join(cmd) if isinstance(cmd, list) else cmd)
    # 国内 PyPI 镜像：官方 files.pythonhosted.org 在本机常 ReadTimeout，
    # 清华/阿里镜像 0.5s 可达，直接影响依赖安装能否成功。
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    env.pop("PYTHONHOME", None)
    env["PIP_INDEX_URL"] = os.environ.get("FH_PIP_INDEX", "https://pypi.tuna.tsinghua.edu.cn/simple")
    env["PIP_TIMEOUT"] = "60"
    env["PIP_RETRIES"] = "5"
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout,
                           shell=(isinstance(cmd, str)), env=env)
        out = (r.stdout + r.stderr)[-4000:]
        return r.returncode, out
    except subprocess.TimeoutExpired:
        return 124, "TIMEOUT"
    except FileNotFoundError as e:
        return 127, "命令不存在: " + str(e)

def apply_patch(path_diff, cwd):
    # 用 git apply；失败回退 patch -p1
    rc, out = run(["git", "apply", "--check", path_diff], cwd, timeout=60)
    if rc == 0:
        rc2, out2 = run(["git", "apply", path_diff], cwd, timeout=60)
        return rc2 == 0, out2
    rc3, out3 = run(["git", "apply", "-p1", "--3way", path_diff], cwd, timeout=60)
    return rc3 == 0, out3


TEST_FILE_RE = re.compile(r"(?:^|/)(?:tests?|test)(?:/|$)", re.IGNORECASE)


def strip_test_hunks(diff_text):
    """整块丢弃针对测试文件的 diff（SWE-bench 铁律：模型 patch 不得含测试改动）"""
    lines = diff_text.splitlines(keepends=True)
    blocks, cur = [], None
    for line in lines:
        if line.startswith("diff --git"):
            if cur is not None:
                blocks.append(cur)
            cur = {"lines": [line]}
        elif cur is not None:
            cur["lines"].append(line)
    if cur is not None:
        blocks.append(cur)
    keep = []
    for b in blocks:
        m = re.search(r" b/(.+)$", b["lines"][0])
        f = m.group(1) if m else ""
        if TEST_FILE_RE.search(f.replace("\\", "/")):
            continue
        keep.extend(b["lines"])
    return "".join(keep)

def django_label_from_docstring(ftp_docstring, test_patch, cwd):
    """django 的 FAIL_TO_PASS 是测试 docstring（如 '@method_decorator preserves wrapper assignments.'），
    映射成 tests/runtests.py 的 dotted label（如 'decorators.tests.Test.test_wrapper_assignments'）。
    做法：从 test_patch 找到被改的测试文件，读【已打补丁】的磁盘文件，用 AST 精确定位
    首行 docstring 匹配的那个测试方法及其所属类 —— 比正则扫 hunk 头可靠（同名 class 歧义）。
    """
    ds = ftp_docstring.strip()
    if ds.startswith("@"):
        ds = ds[1:]
    if ds.endswith("."):
        ds = ds[:-1]
    ds = ds.strip().lower()
    if not ds:
        return None
    # 1) 定位 test_patch 修改的测试文件
    test_file = None
    for line in test_patch.splitlines():
        if line.startswith("diff --git"):
            parts = line.split()
            a = parts[2][2:] if len(parts) > 2 and parts[2].startswith("a/") else None
            if a and a.startswith("tests/") and a.endswith(".py"):
                test_file = a
                break
    if not test_file:
        return None
    fp = os.path.join(cwd, test_file)
    if not os.path.exists(fp):
        return None
    try:
        src = open(fp, encoding="utf-8").read()
        tree = ast.parse(src)
    except Exception:
        return None
    mod = test_file[len("tests/"):].replace("/", ".").replace(".py", "")

    def visit(node, classname=None):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.ClassDef):
                r = visit(child, child.name)
                if r:
                    return r
            elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                doc = ast.get_docstring(child)
                if doc:
                    first = doc.strip().splitlines()[0].strip().lower()
                    if first.startswith("@"):
                        first = first[1:]
                    if first.endswith("."):
                        first = first[:-1]
                    first = first.strip()
                    if first == ds:
                        return mod + "." + (classname + "." if classname else "") + child.name
                r = visit(child, classname)
                if r:
                    return r
        return None

    return visit(tree)


def setup_venv(cwd, instance_id, repo, no_venv=False):
    # CI runner 每次全新（job 隔离），无需 venv 隔离；直接系统 python 装依赖更快更稳
    # （setup-python 的 venv 在部分 Linux 上缺 pip 且 ensurepip 不可用）
    if no_venv:
        pkgs = {"django/django": ["-e", ".", "pytz", "tblib", "docutils", "jinja2", "pytest"],
                "astropy/astropy": ["-e", ".", "pytest", "pytest-astropy", "numpy", "pyerfa"]}.get(repo, ["-e", ".", "pytest"])
        rc, out = run([sys.executable, "-m", "pip", "install"] + pkgs, cwd, timeout=2400)
        if rc != 0:
            return sys.executable, "依赖安装失败(部分): " + out[-2000:]
        chk = run([sys.executable, "-c", "import pytest; print(pytest.__version__)"], cwd, timeout=120)
        if chk[0] != 0:
            return sys.executable, "pytest 自检失败(依赖未就绪): " + chk[1][-800:]
        return sys.executable, None
    venv = os.path.join(cwd, ".verify_venv")
    # 【关键】不能只看目录存在：曾因批量删除被安全策略拦截，残留空壳 venv（只有 Lib/
    # 没有 Scripts/python.exe），os.path.exists 判真 → 跳过重建 → ensurepip 也找不到
    # 解释器 → 报 "命令不存在"。必须校验解释器真的存在，否则删掉重建。
    py = os.path.join(venv, "Scripts", "python.exe") if os.name == "nt" else os.path.join(venv, "bin", "python")
    if os.path.isdir(venv) and not os.path.exists(py):
        log_ = "残留空壳 venv（无解释器），删除重建"
        shutil.rmtree(venv, ignore_errors=True)
        if os.path.exists(venv):
            # 仍删不掉（文件占用等），换名后再删
            try:
                os.rename(venv, venv + "__stale")
                shutil.rmtree(venv + "__stale", ignore_errors=True)
            except Exception as e:
                return None, f"{log_} 且无法清理: {e}"
    if not os.path.exists(venv):
        rc, out = run([sys.executable, "-m", "venv", venv], cwd, timeout=180)
        if rc != 0:
            return None, "venv 创建失败: " + out
    py = os.path.join(venv, "Scripts", "python.exe") if os.name == "nt" else os.path.join(venv, "bin", "python")
    # pip 路径探测：不同平台/基础解释器布局不同（Scripts/pip.exe、bin/pip、bin/pip3…），
    # 找不到时用 venv python -m pip 兜底（Python 3.11+ 均可用）
    if os.name == "nt":
        pip_candidates = [os.path.join(venv, "Scripts", "pip.exe"), os.path.join(venv, "Scripts", "pip3.exe")]
    else:
        pip_candidates = [os.path.join(venv, "bin", "pip"), os.path.join(venv, "bin", "pip3"), os.path.join(venv, "bin", "pip3.11")]
    pip = next((p for p in pip_candidates if os.path.exists(p)), None)
    if pip is None:
        # ensurepip 兜底：venv 无 pip 时先启用
        rc, out = run([py, "-m", "ensurepip", "--upgrade"], cwd, timeout=120)
        if rc != 0:
            return None, "venv 无 pip 且 ensurepip 失败: " + out
        pip = next((p for p in pip_candidates if os.path.exists(p)), None)
    if pip is None:
        pip = None  # 用 py -m pip 形式

    def pip_install(args, timeout):
        # 关键：一律用 `python -m pip`，不能调 Scripts/pip.exe —— 在 Windows 上
        # pip.exe 启动器拒绝自我升级（"To modify pip, please run..."），会导致 bootstrap
        # 整条失败、pytest 装不上、测试被误判 No module named pytest。python -m pip 无此限制。
        return run([py, "-m", "pip", "install", "--no-cache-dir"] + args, cwd, timeout=timeout)

    # 【预检·省时】环境若已就绪（pytest 可用 + 仓库可 import），直接复用，
    # 避免每次验证都重跑一遍分钟级的依赖安装。
    probe = repo.split("/")[1]
    chk = run([py, "-c", "import pytest"], cwd, timeout=120)
    if chk[0] == 0:
        imp = run([py, "-c", f"import {probe}"], cwd, timeout=300)
        if imp[0] == 0:
            # 环境已就绪：仍补钉历史依赖（修复“新版依赖不兼容旧代码”的误判 ——
            # 早返回路径也必须钉，否则上次已装的过新 jinja2/werkzeug 会遗留导致误判）
            apply_repo_pins(pip_install, repo)
            return py, None
    # 【关键·命令编排】依赖必须分两步装，不能写成一条 `pip install -e . pytest ...`：
    #   -e . 会触发 C 扩展编译（astropy 约 40 个扩展，Windows 上 30~60 分钟），
    #   一旦编译超时，**同一条命令里的 pytest 也一起没装上**，
    #   于是测试报 "No module named pytest" → 被误判成「补丁无效」，
    #   实测 astropy-12907 因此白跑 40 分钟、真实结论被掩盖。
    # 现在：① 先装纯 wheel 依赖（pytest/numpy 等，秒级）② 再单独装仓库本体。
    pure_deps = {
        "django/django": ["pytz", "tblib", "docutils", "jinja2", "asgiref", "sqlparse", "pytest"],
        # astropy 4.3 必须用 numpy<1.22（1.22+ 删了 np.asscalar）与 pyerfa 2.0.0.3
        "astropy/astropy": ["pytest==7.4.4", "pytest-astropy", "numpy==1.21.6", "pyerfa==2.0.0.3"],
    }.get(repo, ["pytest"])
    # 仓库本体编译所需的构建依赖（提前装好，避免 build-isolation 在线下载卡死）
    build_deps = {
        # sklearn 0.21.dev0（2019）重度依赖 numpy.distutils，需要：
        #  - setuptools<60 让 `import distutils` 回到 3.8 标准库（标准库有 msvccompiler），
        #    否则被 setuptools 75 的 _distutils 接管后缺 msvccompiler → C 扩展编不出
        #  - numpy<1.22（0.21 时代兼容区间；numpy 1.22+ 改动多）
        "scikit-learn/scikit-learn": ["setuptools<60", "numpy<1.22", "scipy", "Cython<3", "joblib", "threadpoolctl"],
        # astropy 4.3 精确钉死：numpy<1.22 保留 np.asscalar；Cython<3（3.x 与 4.3 不兼容）
        "astropy/astropy": ["numpy==1.21.6", "pyerfa==2.0.0.3", "Cython<3", "extension_helpers"],
    }.get(repo, [])

    # 【bootstrap】venv 可能是裸的（连 setuptools/wheel 都没有），先补 build 后端，
    # 否则 `pip install -e .` 走 build-isolation 在线下载会卡死几十分钟。
    rc, out = pip_install(["-U", "pip", "setuptools", "wheel"], 600)
    if rc != 0:
        return py, "venv bootstrap 失败(pip/setuptools/wheel): " + out[-1500:]
    if build_deps:
        rc, out = pip_install(build_deps, 1800)
        if rc != 0:
            rc, out = pip_install(build_deps, 1800)
            if rc != 0:
                return py, "构建依赖安装失败: " + out[-1500:]

    # ① 纯 wheel 依赖
    rc, out = pip_install(pure_deps, 1800)
    if rc != 0:
        rc, out = pip_install(pure_deps, 1800)  # 网络抖动重试一次
        if rc != 0:
            return py, "测试依赖安装失败: " + out[-1500:]
    # 自检 pytest 真的可用
    chk = run([py, "-c", "import pytest; print(pytest.__version__)"], cwd, timeout=120)
    if chk[0] != 0:
        return py, "pytest 自检失败(依赖未就绪): " + chk[1][-800:]

    # ② 仓库本体（可能编译很慢，独立超时；用 --no-build-isolation 复用已装的构建后端）
    rc, out = pip_install(["-e", ".", "--no-build-isolation"], 1800)
    if rc != 0:
        # 编译失败不致命：只要能 import 仓库并跑测试即可（部分项目可用 PYTHONPATH 直接跑）
        probe = repo.split("/")[1]
        imp = run([py, "-c", f"import {probe}"], cwd, timeout=300)
        if imp[0] != 0:
            return py, "仓库本体安装失败且无法 import: " + out[-1500:]
        return py, None
    # ③ 仓库特定的历史依赖钉死（修复“新版依赖不兼容旧代码”导致的误判 —— 这是环境复现问题，不是模型 patch 问题）
    apply_repo_pins(pip_install, repo)
    return py, None


def apply_repo_pins(pip_install, repo):
    """仓库特定的历史依赖钉死；早返回路径与正常路径都调用，确保过新依赖被纠正。"""
    if repo == "pallets/flask":
        # flask 2.3.0.dev 仍 `from werkzeug.urls import url_quote`，werkzeug>=2.1 已删除该符号
        pip_install(["Werkzeug<2.1"], 300)
    if repo == "sphinx-doc/sphinx":
        # sphinx 3.5 用 jinja2.environmentfilter（3.1 删除）、docutils<0.17（3.5 的上界）
        pip_install(["Jinja2<3.1", "docutils<0.17"], 300)

def _classify(rc, out):
    """把 pytest/django 的单测执行结果归类为 pass/fail/skip。
    FAIL_TO_PASS 必须真通过；skip 不算通过（如 flask 测试用 importorskip('tomllib') 在 3.8 下 skip，
    若误判为 pass 会虚高 resolved 数）。"""
    low = out.lower()
    if re.search(r"\b\d+\s+skipped\b", low) or (rc == 0 and re.search(r"\bskip", low)):
        return "skip"
    if re.search(r"\b\d+\s+(failed|error)\b", low) or rc != 0:
        return "fail"
    if re.search(r"\b\d+\s+passed\b", low) or rc == 0:
        return "pass"
    return "fail"

def run_tests(py, cwd, repo, ftp, ptp):
    # 数据集导出时 FAIL_TO_PASS 可能是 JSON 字符串（如 '["a", "b"]'），需解析成数组
    if isinstance(ftp, str):
        import json as _j
        try:
            ftp = _j.loads(ftp)
        except Exception:
            ftp = []
    results = {}
    if repo == "django/django":
        # django 用 tests/runtests.py；FAIL_TO_PASS 已在上游映射成 dotted label
        # （如 'decorators.tests.Test.test_wrapper_assignments'），直接作为 label 传入
        for t in ftp:
            if "::" in t:
                mod = t.split("::")[0].replace("tests/", "").replace("/", ".").replace(".py", "")
                cls_meth = "::".join(t.split("::")[1:])
                label = mod + "." + cls_meth
            else:
                label = t
            rc, out = run([py, "tests/runtests.py", label], cwd, timeout=600)
            results[t] = (_classify(rc, out), out[-800:])
    else:
        # astropy 等通用：直接 pytest
        for t in ftp:
            rc, out = run([py, "-m", "pytest", "-q", t], cwd, timeout=600)
            results[t] = (_classify(rc, out), out[-800:])
    return results

def verify_instance(inst, no_venv=False):
    repo_dir = inst["repo"].split("/")[1]
    # 工作区按 instance_id 隔离：同一仓库常有多个实例（如 astropy-12907 与 astropy-7746），
    # 共用 work/<repo> 会互相切换 base_commit，导致 test_patch 贴不上、结论失真。
    cwd = os.path.join(WORK, inst["instance_id"])
    if not os.path.isdir(os.path.join(cwd, ".git")):
        # 兼容旧的按仓库名布局
        legacy = os.path.join(WORK, repo_dir)
        if os.path.isdir(os.path.join(legacy, ".git")):
            cwd = legacy
    patch_file = os.path.join(PATCHES, inst["instance_id"] + ".patch")
    if not os.path.exists(patch_file):
        return {"instance_id": inst["instance_id"], "verified": False, "reason": "无模型 patch（未生成）"}
    model_patch = open(patch_file, encoding="utf-8").read()
    if not model_patch.strip():
        return {"instance_id": inst["instance_id"], "verified": False, "reason": "模型 patch 为空"}
    # SWE-bench 铁律：模型 patch 不得含测试改动，先剥掉测试 hunk（防与官方 test_patch 冲突）
    model_patch = strip_test_hunks(model_patch)
    if not model_patch.strip():
        return {"instance_id": inst["instance_id"], "verified": False, "reason": "模型 patch 剥测试 hunk 后为空"}
    model_patch_file = os.path.join(REAL, "tmp_model_patch_" + inst["instance_id"] + ".diff")
    open(model_patch_file, "w", encoding="utf-8").write(model_patch)
    # 重置工作区（务必排除 .verify_venv / .wheel_cache，否则 git clean 会把 venv 删掉）
    run(["git", "checkout", "--", "."], cwd, timeout=60)
    run(["git", "clean", "-fd", "-e", ".verify_venv", "-e", ".wheel_cache"], cwd, timeout=60)
    # 应用模型 patch
    ok_m, msg_m = apply_patch(model_patch_file, cwd)
    try:
        os.remove(model_patch_file)
    except Exception:
        pass
    if not ok_m:
        return {"instance_id": inst["instance_id"], "verified": False, "reason": "模型 patch 应用失败: " + msg_m[:500]}
    # 应用 test_patch（写入临时文件再 apply）
    tp = inst.get("test_patch", "")
    tp_file = os.path.join(REAL, "tmp_test_patch_" + inst["instance_id"] + ".diff")
    open(tp_file, "w", encoding="utf-8").write(tp)
    ok_t, msg_t = apply_patch(tp_file, cwd)
    os.remove(tp_file)
    if not ok_t:
        return {"instance_id": inst["instance_id"], "verified": False, "reason": "test_patch 应用失败: " + msg_t[:500]}
    # 重建环境
    py, err = setup_venv(cwd, inst["instance_id"], inst["repo"], no_venv=no_venv)
    if py is None:
        return {"instance_id": inst["instance_id"], "verified": False, "reason": "环境重建失败: " + (err or "")}
    # 跑 FAIL_TO_PASS
    ftp = inst.get("FAIL_TO_PASS", [])
    if isinstance(ftp, str):
        try:
            ftp = json.loads(ftp)
        except Exception:
            ftp = []
    # django 的 FAIL_TO_PASS 是 docstring，映射成 runtests.py 原生 dotted label（读补丁后文件 AST 定位）
    if inst.get("repo") == "django/django":
        ftp = [django_label_from_docstring(t, tp, cwd) or t for t in ftp]
    res = run_tests(py, cwd, inst["repo"], ftp, inst.get("PASS_TO_PASS", []))
    statuses = [v[0] for v in res.values()]
    all_pass = all(s == "pass" for s in statuses)
    any_skip = any(s == "skip" for s in statuses)
    return {
        "instance_id": inst["instance_id"],
        "verified": True,
        "model_patch_applied": True,
        "test_patch_applied": True,
        "fail_to_pass": {k: {"status": v[0], "out": v[1]} for k, v in res.items()},
        "resolved": all_pass,
        "skipped": any_skip,
        "env_note": err,  # 若非 None 表示依赖安装有警告但继续
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instances", default=os.path.join(ROOT, "bench", "swe-bench-verified-sample.json"))
    ap.add_argument("--limit", type=int, default=999)
    ap.add_argument("--no-venv", action="store_true", help="CI 用：直接系统 python 装依赖（runner 每 job 全新，无需 venv 隔离）")
    args = ap.parse_args()
    insts = json.load(open(args.instances, encoding="utf-8"))[:args.limit]
    out = []
    for inst in insts:
        print("\n=== 验证", inst["instance_id"], "===")
        r = verify_instance(inst, no_venv=args.no_venv)
        print(json.dumps(r, ensure_ascii=False, indent=2)[:2500])
        out.append(r)
    summary = {
        "total": len(out),
        "resolved": sum(1 for x in out if x.get("resolved")),
        "verified": sum(1 for x in out if x.get("verified")),
        "details": out,
    }
    json.dump(summary, open(os.path.join(REAL, "verify_summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("\n聚合: resolved", summary["resolved"], "/", summary["total"])

if __name__ == "__main__":
    main()
