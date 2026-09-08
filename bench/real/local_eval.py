#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
本地 SWE-bench 评测（不依赖 Docker）
对指定实例：在 work 目录中创建 venv、安装依赖、运行 FAIL_TO_PASS 测试
用法: python local_eval.py <instance_id> [instance_id2 ...]
"""
import json
import os
import subprocess
import sys
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
DATASET = os.path.join(HERE, "swebench_lite_official_array.json")
WORK = os.path.join(HERE, "work")
PYTHON = sys.executable  # 使用当前 Python 创建 venv


def load_instance(instance_id):
    with open(DATASET, encoding="utf-8") as f:
        data = json.load(f)
    for ex in data:
        if ex["instance_id"] == instance_id:
            return ex
    return None


def find_work_dir(instance_id):
    """查找实例的 work 目录"""
    # 可能的目录名
    candidates = [
        os.path.join(WORK, instance_id),
        os.path.join(WORK, instance_id.replace("__", "_")),
    ]
    for c in candidates:
        if os.path.isdir(c):
            return c
    # 模糊匹配
    for d in os.listdir(WORK):
        if instance_id.split("__")[-1] in d and os.path.isdir(os.path.join(WORK, d)):
            return os.path.join(WORK, d)
    return None


def run_pytest(work_dir, instance, venv_dir):
    """在 work_dir 中创建 venv，安装依赖，运行 FAIL_TO_PASS 测试"""
    iid = instance["instance_id"]
    repo = instance["repo"]
    fail_to_pass = instance.get("FAIL_TO_PASS", [])

    if isinstance(fail_to_pass, str):
        fail_to_pass = json.loads(fail_to_pass) if fail_to_pass else []

    if not fail_to_pass:
        return {"instance_id": iid, "error": "no FAIL_TO_PASS tests", "resolved": False}

    print(f"  [{iid}] 创建 venv...")
    venv_python = os.path.join(venv_dir, "Scripts", "python.exe")
    if not os.path.exists(venv_python):
        r = subprocess.run([PYTHON, "-m", "venv", venv_dir], capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            return {"instance_id": iid, "error": f"venv create failed: {r.stderr[:200]}", "resolved": False}

    # 升级 pip
    subprocess.run([venv_python, "-m", "pip", "install", "--upgrade", "pip", "-q"],
                   capture_output=True, timeout=120)

    # 安装 repo
    print(f"  [{iid}] 安装 {repo}...")
    setup_file = os.path.join(work_dir, "setup.py")
    pyproject = os.path.join(work_dir, "pyproject.toml")
    if os.path.exists(setup_file) or os.path.exists(pyproject):
        r = subprocess.run([venv_python, "-m", "pip", "install", "-e", ".", "-q"],
                           cwd=work_dir, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            # 尝试只安装测试依赖
            print(f"    pip install -e . 失败，尝试安装测试依赖...")
            r2 = subprocess.run([venv_python, "-m", "pip", "install", "pytest", "-q"],
                                capture_output=True, timeout=60)

    # 安装 pytest
    subprocess.run([venv_python, "-m", "pip", "install", "pytest", "-q"],
                   capture_output=True, timeout=60)

    # 运行 FAIL_TO_PASS 测试
    print(f"  [{iid}] 运行 {len(fail_to_pass)} 个测试...")
    all_passed = True
    test_results = []
    for test in fail_to_pass:
        # 测试路径可能是 module.path 或 file::test
        test_path = test.replace(".", os.sep) + ".py" if "::" not in test and not test.endswith(".py") else test
        # 尝试多种路径格式
        cmd = [venv_python, "-m", "pytest", test, "-v", "--tb=short", "-x", "--timeout=60"]
        try:
            r = subprocess.run(cmd, cwd=work_dir, capture_output=True, text=True, timeout=180)
            passed = r.returncode == 0
            if not passed:
                all_passed = False
            test_results.append({"test": test, "passed": passed, "rc": r.returncode})
            print(f"    {'PASS' if passed else 'FAIL'}: {test}")
        except subprocess.TimeoutExpired:
            all_passed = False
            test_results.append({"test": test, "passed": False, "error": "timeout"})
            print(f"    TIMEOUT: {test}")

    return {
        "instance_id": iid,
        "repo": repo,
        "resolved": all_passed,
        "tests_total": len(fail_to_pass),
        "tests_passed": sum(1 for t in test_results if t.get("passed")),
        "test_results": test_results,
    }


def main():
    if len(sys.argv) < 2:
        print("用法: python local_eval.py <instance_id> [instance_id2 ...]")
        print("或: python local_eval.py --repo django --limit 5")
        return 1

    # 解析参数
    instance_ids = []
    repo_filter = None
    limit = None
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == "--repo":
            repo_filter = sys.argv[i+1]
            i += 2
        elif sys.argv[i] == "--limit":
            limit = int(sys.argv[i+1])
            i += 2
        else:
            instance_ids.append(sys.argv[i])
            i += 1

    # 如果指定了 repo，从数据集中加载
    if repo_filter:
        with open(DATASET, encoding="utf-8") as f:
            data = json.load(f)
        for ex in data:
            if ex["repo"] == repo_filter:
                instance_ids.append(ex["instance_id"])
                if limit and len(instance_ids) >= limit:
                    break

    print(f"=== 本地评测: {len(instance_ids)} 个实例 ===")

    results = []
    for iid in instance_ids:
        instance = load_instance(iid)
        if not instance:
            print(f"  [{iid}] 未找到实例")
            results.append({"instance_id": iid, "error": "not found", "resolved": False})
            continue

        work_dir = find_work_dir(iid)
        if not work_dir:
            print(f"  [{iid}] work 目录不存在")
            results.append({"instance_id": iid, "error": "no work dir", "resolved": False})
            continue

        print(f"  [{iid}] work_dir: {work_dir}")
        venv_dir = os.path.join(WORK, f".venv_{iid.replace('/', '_')}")
        try:
            result = run_pytest(work_dir, instance, venv_dir)
            results.append(result)
        except Exception as e:
            results.append({"instance_id": iid, "error": str(e)[:200], "resolved": False})
            print(f"  [{iid}] 错误: {e}")

    # 汇总
    total = len(results)
    resolved = sum(1 for r in results if r.get("resolved"))
    print(f"\n=== 结果汇总 ===")
    print(f"  总计: {total}")
    print(f"  Resolved: {resolved}")
    print(f"  Resolved Rate: {resolved/total*100:.1f}%" if total > 0 else "  N/A")

    # 保存结果
    out = os.path.join(HERE, "local_eval_results.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"  结果已保存: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
