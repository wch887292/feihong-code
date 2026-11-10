#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
astropy 真实验证（wheel-overlay 加速方案，免 40 分钟源码编译）

原理
----
1. 4.3 预编译 wheel 已装进 .verify_venv 的 site-packages，提供全部 C 扩展 .pyd/.dll。
2. 源码树保持纯净（不含任何 .pyd），避免「wheel 的 .pyd 覆盖进源码树 → 与 base_commit
   的 .py ABI 不匹配 → Segmentation fault (exit 139)」。
3. 仅把【模型 patch + test_patch 实际改动到的 .py 文件】从工作区 overlay 到 site-packages，
   其余模块仍用 4.3 的 .py（与 .pyd 完全匹配），把 ABI 不匹配面缩到最小。
4. 从「中性目录」跑 pytest（工作区不在 sys.path 上），使 import astropy 解析到
   site-packages（4.3 .pyd + overlay 后的 .py），模型修复与官方测试都生效。

SWE-bench 铁律
-------------
- 模型 patch 不得含测试文件改动：先 stripTestFiles 剥掉测试 hunk，测试改动只来自官方 test_patch。
- resolved = 全部 FAIL_TO_PASS 通过。
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

BASE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(BASE, "work")
PATCHES = os.path.join(BASE, "patches")
REAL = BASE

TEST_FILE_RE = re.compile(r"(?:^|/)(?:tests?|test)(?:/|$)", re.IGNORECASE)


def _ensure_tmp():
    d = os.path.join(BASE, ".tmp")
    os.makedirs(d, exist_ok=True)
    return d


def run(cmd, cwd, timeout=600):
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    env.pop("PYTHONHOME", None)
    tmp = _ensure_tmp()
    env["TMPDIR"] = tmp
    env["TEMP"] = tmp
    env["TMP"] = tmp
    env["PIP_INDEX_URL"] = os.environ.get("FH_PIP_INDEX", "https://pypi.tuna.tsinghua.edu.cn/simple")
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout,
                           shell=isinstance(cmd, str), env=env)
        return r.returncode, (r.stdout + r.stderr)[-4000:]
    except subprocess.TimeoutExpired:
        return 124, "TIMEOUT"
    except FileNotFoundError as e:
        return 127, "命令不存在: " + str(e)


def venv_python(cwd):
    return os.path.join(cwd, ".verify_venv", "Scripts", "python.exe")


def strip_test_hunks(diff_text):
    """整块丢弃针对测试文件的 diff（SWE-bench 铁律：模型 patch 不得含测试改动）"""
    lines = diff_text.splitlines(keepends=True)
    blocks = []
    cur = None
    for line in lines:
        if line.startswith("diff --git"):
            if cur is not None:
                blocks.append(cur)
            cur = {"file": None, "lines": [line]}
        elif cur is not None:
            cur["lines"].append(line)
    if cur is not None:
        blocks.append(cur)
    keep = []
    for b in blocks:
        m = re.search(r" b/(.+)$", b["lines"][0])
        f = m.group(1) if m else ""
        if TEST_FILE_RE.search(f.replace("\\", "/")):
            continue  # 整块丢弃测试文件
        keep.extend(b["lines"])
    return "".join(keep)


def apply_patch(diff_text, cwd):
    # 直接 git apply 字符串（用 - 传 stdin）
    p1 = subprocess.run(["git", "apply", "--check", "-"], cwd=cwd, input=diff_text,
                        capture_output=True, text=True)
    if p1.returncode == 0:
        p2 = subprocess.run(["git", "apply", "-"], cwd=cwd, input=diff_text,
                            capture_output=True, text=True)
        return p2.returncode == 0, p2.stderr[-500:]
    p3 = subprocess.run(["git", "apply", "-p1", "--3way", "-"], cwd=cwd, input=diff_text,
                        capture_output=True, text=True)
    return p3.returncode == 0, p3.stderr[-500:]


def touched_py_files(diff_text):
    files = []
    for m in re.finditer(r"^\+\+\+ b/(.+)$", diff_text, re.M):
        f = m.group(1).strip()
        if f.endswith(".py"):
            files.append(f)
    return files


def site_packages_astropy(cwd):
    py = venv_python(cwd)
    code = "import astropy,os;print(os.path.dirname(astropy.__file__))"
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    env.pop("PYTHONHOME", None)
    r = subprocess.run([py, "-c", code], capture_output=True, text=True, env=env)
    sp = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
    return sp if sp and os.path.isdir(sp) else ""


def overlay_files(cwd, files):
    sp = site_packages_astropy(cwd)
    if not sp:
        return False, "找不到 site-packages/astropy"
    # sp 已是包目录（如 site-packages/astropy）；源文件在 workdir 下为 <包名>/X，
    # 需去掉 leading 包目录再拼，避免二次嵌套 site-packages/astropy/astropy/X
    pkg = os.path.basename(sp.rstrip("/\\"))
    copied = 0
    for rel in files:
        parts = rel.replace("\\", "/").split("/")
        if parts and parts[0] == pkg:
            parts = parts[1:]
        dest_rel = "/".join(parts)
        src = os.path.join(cwd, rel)
        dst = os.path.join(sp, dest_rel)
        if os.path.isfile(src):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
            # 清掉对应 .pyc，强制重新编译，避免用到旧字节码
            pyc = dst + "c"
            if os.path.exists(pyc):
                try:
                    os.remove(pyc)
                except Exception:
                    pass
            copied += 1
    return True, f"overlay {copied} 个文件到 site-packages/{pkg}"


def verify(inst, no_compile=True):
    iid = inst["instance_id"]
    cwd = os.path.join(WORK, iid)
    if not os.path.isdir(os.path.join(cwd, ".git")):
        return {"instance_id": iid, "verified": False, "reason": "工作区不存在"}
    py = venv_python(cwd)
    if not os.path.exists(py):
        return {"instance_id": iid, "verified": False, "reason": "venv 解释器缺失"}

    # 0) 确保 site-packages 有 4.3 wheel（含 .pyd）
    sp = site_packages_astropy(cwd)
    if not sp:
        return {"instance_id": iid, "verified": False, "reason": "site-packages 无 astropy（wheel 未装）"}

    # 1) 复位工作区（务必排除 .verify_venv / .wheel_cache，否则 git clean 会把 venv 删掉）
    run(["git", "checkout", "--", "."], cwd, 60)
    run(["git", "clean", "-fd", "-e", ".verify_venv", "-e", ".wheel_cache"], cwd, 60)
    # 清掉源码树任何残留 .pyd（防止 segfault）
    for root, _, fs in os.walk(os.path.join(cwd, "astropy")):
        for f in fs:
            if f.endswith(".pyd"):
                try:
                    os.remove(os.path.join(root, f))
                except Exception:
                    pass

    # 2) 模型 patch（剥测试 hunk）
    patch_file = os.path.join(PATCHES, iid + ".patch")
    if not os.path.exists(patch_file):
        return {"instance_id": iid, "verified": False, "reason": "无模型 patch"}
    raw = open(patch_file, encoding="utf-8").read()
    model_diff = strip_test_hunks(raw)
    if not model_diff.strip():
        return {"instance_id": iid, "verified": False, "reason": "模型 patch 剥测试 hunk 后为空"}
    ok_m, msg_m = apply_patch(model_diff, cwd)
    if not ok_m:
        return {"instance_id": iid, "verified": False, "reason": "模型 patch 应用失败: " + msg_m}

    # 3) 官方 test_patch
    tp = inst.get("test_patch", "")
    ok_t, msg_t = apply_patch(tp, cwd)
    if not ok_t:
        return {"instance_id": iid, "verified": False, "reason": "test_patch 应用失败: " + msg_t}

    # 4) overlay 被改动的 .py 到 site-packages
    touched = touched_py_files(model_diff) + touched_py_files(tp)
    ok_o, msg_o = overlay_files(cwd, touched)
    if not ok_o:
        return {"instance_id": iid, "verified": False, "reason": msg_o}

    # 5) 跑 FAIL_TO_PASS（从中性目录，使 import 解析到 site-packages）
    ftp = inst.get("FAIL_TO_PASS", [])
    if isinstance(ftp, str):
        ftp = json.loads(ftp)
    results = {}
    sp_pkg = os.path.basename(sp.rstrip("/\\"))
    with tempfile.TemporaryDirectory() as neutral:
        for t in ftp:
            # t: astropy/modeling/tests/test_separable.py::test_separable[...]
            parts = t.split("::", 1)
            fpath = parts[0].replace("\\", "/")
            node = parts[1] if len(parts) > 1 else ""
            # fpath 以 <包名>/ 开头（如 astropy/...），sp 已是 site-packages/astropy，
            # 需去掉 leading 包目录避免二次嵌套
            fp_parts = fpath.split("/")
            if fp_parts and fp_parts[0] == sp_pkg:
                fp_parts = fp_parts[1:]
            absf = os.path.join(sp, *fp_parts)
            cmd = [py, "-m", "pytest", "-q"]
            if node:
                cmd.append(absf + "::" + node)
            else:
                cmd.append(absf)
            rc, out = run(cmd, neutral, 600)
            results[t] = (rc == 0, out[-800:])
    all_pass = all(v[0] for v in results.values())
    return {
        "instance_id": iid,
        "verified": True,
        "resolved": all_pass,
        "fail_to_pass": results,
        "overlay_note": msg_o,
    }


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--instances", required=True)
    ap.add_argument("--iid", default="")
    args = ap.parse_args()
    data = json.load(open(args.instances, encoding="utf-8"))
    arr = data if isinstance(data, list) else data.get("instances", data.get("data", [data]))
    out = []
    for inst in arr:
        if args.iid and args.iid not in inst.get("instance_id", ""):
            continue
        print("\n=== 验证", inst["instance_id"], "===")
        r = verify(inst)
        print(json.dumps(r, ensure_ascii=False, indent=2)[:3000])
        out.append(r)
    resolved = sum(1 for x in out if x.get("resolved"))
    print(f"\n聚合: resolved {resolved}/{len(out)}")
    json.dump(out, open(os.path.join(REAL, "verify_astropy_summary.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
