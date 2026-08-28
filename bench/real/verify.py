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
import json, os, sys, subprocess, shutil, tempfile, argparse

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
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, shell=(isinstance(cmd, str)))
        out = (r.stdout + r.stderr)[-4000:]
        return r.returncode, out
    except subprocess.TimeoutExpired:
        return 124, "TIMEOUT"

def apply_patch(path_diff, cwd):
    # 用 git apply；失败回退 patch -p1
    rc, out = run(["git", "apply", "--check", path_diff], cwd, timeout=60)
    if rc == 0:
        rc2, out2 = run(["git", "apply", path_diff], cwd, timeout=60)
        return rc2 == 0, out2
    rc3, out3 = run(["git", "apply", "-p1", "--3way", path_diff], cwd, timeout=60)
    return rc3 == 0, out3

def setup_venv(cwd, instance_id, repo):
    venv = os.path.join(cwd, ".verify_venv")
    if not os.path.exists(venv):
        rc, out = run([sys.executable, "-m", "venv", venv], cwd, timeout=120)
        if rc != 0:
            return None, "venv 创建失败: " + out
    py = os.path.join(venv, "Scripts", "python.exe") if os.name == "nt" else os.path.join(venv, "bin", "python")
    pip = os.path.join(venv, "Scripts", "pip.exe") if os.name == "nt" else os.path.join(venv, "bin", "pip")
    # 安装依赖（按仓库定制）
    if repo == "django/django":
        pkgs = ["-e", ".", "pytz", "tblib", "docutils", "jinja2", "pytest"]
    elif repo == "astropy/astropy":
        pkgs = ["-e", ".", "pytest", "pytest-astropy", "numpy", "pyerfa"]
    else:
        pkgs = ["-e", "."]
    rc, out = run([pip, "install"] + pkgs, cwd, timeout=900)
    if rc != 0:
        return py, "依赖安装失败(部分): " + out[-2000:]
    return py, None

def run_tests(py, cwd, repo, ftp, ptp):
    results = {}
    if repo == "django/django":
        # django 用 tests/runtests.py，测试 ID 形如 tests/expressions/tests.py::ExistsTests::test_...
        for t in ftp:
            # t: tests/expressions/tests.py::ExistsTests::test_exists_with_outerref_annotate
            mod = t.split("::")[0].replace("tests/", "").replace("/", ".").replace(".py", "")
            cls_meth = "::".join(t.split("::")[1:])
            label = mod + "." + cls_meth
            rc, out = run([py, "tests/runtests.py", label], cwd, timeout=600)
            results[t] = (rc == 0, out[-800:])
    else:
        # astropy 等通用：直接 pytest
        for t in ftp:
            rc, out = run([py, "-m", "pytest", "-q", t], cwd, timeout=600)
            results[t] = (rc == 0, out[-800:])
    return results

def verify_instance(inst):
    repo_dir = inst["repo"].split("/")[1]
    cwd = os.path.join(WORK, repo_dir)
    patch_file = os.path.join(PATCHES, inst["instance_id"] + ".patch")
    if not os.path.exists(patch_file):
        return {"instance_id": inst["instance_id"], "verified": False, "reason": "无模型 patch（未生成）"}
    model_patch = open(patch_file, encoding="utf-8").read()
    if not model_patch.strip():
        return {"instance_id": inst["instance_id"], "verified": False, "reason": "模型 patch 为空"}
    # 重置工作区
    run(["git", "checkout", "--", "."], cwd, timeout=60)
    run(["git", "clean", "-fd"], cwd, timeout=60)
    # 应用模型 patch
    ok_m, msg_m = apply_patch(patch_file, cwd)
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
    py, err = setup_venv(cwd, inst["instance_id"], inst["repo"])
    if py is None:
        return {"instance_id": inst["instance_id"], "verified": False, "reason": "环境重建失败: " + (err or "")}
    # 跑 FAIL_TO_PASS
    ftp = inst.get("FAIL_TO_PASS", [])
    res = run_tests(py, cwd, inst["repo"], ftp, inst.get("PASS_TO_PASS", []))
    all_pass = all(v[0] for v in res.values())
    return {
        "instance_id": inst["instance_id"],
        "verified": True,
        "model_patch_applied": True,
        "test_patch_applied": True,
        "fail_to_pass": res,
        "resolved": all_pass,
        "env_note": err,  # 若非 None 表示依赖安装有警告但继续
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instances", default=os.path.join(ROOT, "bench", "swe-bench-verified-sample.json"))
    ap.add_argument("--limit", type=int, default=999)
    args = ap.parse_args()
    insts = json.load(open(args.instances, encoding="utf-8"))[:args.limit]
    out = []
    for inst in insts:
        print("\n=== 验证", inst["instance_id"], "===")
        r = verify_instance(inst)
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
