#!/usr/bin/env python3
"""
SWE-bench resolved-rate pytest 验证脚本
对已 resolved（patch_applied）且有完整仓库的实例：
1. 重新应用 SEARCH/REPLACE 补丁到完整仓库
2. 运行 FAIL_TO_PASS 测试
3. 记录真正的测试通过率（resolved-rate）
"""
import json
import os
import subprocess
import sys
import time
from collections import Counter, defaultdict

BASE = os.path.join(os.path.dirname(__file__), "..")
REAL = os.path.join(BASE, "bench", "real")
HELP = os.path.join(REAL, "eval_helpers.py")
DATA = os.path.join(REAL, "swebench_300.json")
REPORT = os.path.join(REAL, "swebench_report.jsonl")
WORK = os.path.join(REAL, "work")
PYTEST_REPORT = os.path.join(REAL, "pytest_verification_report.jsonl")

PY = sys.executable


def load_resolved_instances():
    """加载已 resolved（patch_applied）的实例，返回 {instance_id: report_row}。"""
    seen = {}
    for line in open(REPORT, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        seen[r.get("instance_id")] = r
    resolved = {
        iid: r for iid, r in seen.items()
        if r.get("stage") == "patch_applied" and r.get("resolved")
    }
    return resolved


def has_full_repo(instance_id):
    """检查实例是否有完整仓库（文件数 > 100 且有主包目录）。"""
    wt = os.path.join(WORK, instance_id)
    if not os.path.isdir(wt):
        return False
    try:
        file_count = sum(len(files) for _, _, files in os.walk(wt))
    except Exception:
        return False
    if file_count < 100:
        return False
    # 检查是否有主包目录
    for pkg in ["django", "astropy", "matplotlib", "requests", "xarray", "seaborn", "flask"]:
        if os.path.isdir(os.path.join(wt, pkg)):
            return True
    # requests 的源码在 src/requests
    if os.path.isdir(os.path.join(wt, "src", "requests")):
        return True
    return False


def get_instance_data(instance_id):
    """从数据文件获取实例信息。"""
    data = json.load(open(DATA, encoding="utf-8"))
    for inst in data:
        if inst["instance_id"] == instance_id:
            return inst
    return None


def apply_patch(wt, resp_file):
    """应用 SEARCH/REPLACE 补丁到完整仓库。返回 (blocks, applied, ok)。"""
    out_file = os.path.join(wt, ".pytest_apply.json")
    r = subprocess.run(
        [PY, HELP, "apply", wt, resp_file, out_file],
        capture_output=True, text=True, cwd=BASE,
    )
    if r.returncode != 0 or not os.path.exists(out_file):
        return 0, 0, False
    try:
        result = json.load(open(out_file, encoding="utf-8"))
        return result.get("blocks", 0), result.get("applied", 0), result.get("ok", False)
    except Exception:
        return 0, 0, False


def convert_django_test_name(test_name, wt):
    """将 django 式测试名称转换为 runtests.py 可以识别的格式。
    输入: test_ascii_validator (auth_tests.test_validators.UsernameValidatorsTests)
    输出: auth_tests.test_validators.UsernameValidatorsTests.test_ascii_validator
    """
    import re
    # django 式: test_name (module.path.ClassName)
    m = re.match(r"^(\w+)\s+\(([\w.]+)\)$", test_name.strip())
    if not m:
        # 可能是标准 pytest 格式，直接返回
        return test_name
    test_fn = m.group(1)
    module_path = m.group(2)
    return f"{module_path}.{test_fn}"


def run_django_tests(wt, tests, out_log):
    """使用 django 官方 runtests.py 运行测试。返回 returncode。"""
    # 转换测试名称
    converted_tests = []
    for t in tests:
        converted = convert_django_test_name(t, wt)
        converted_tests.append(converted)

    runtests = os.path.join(wt, "tests", "runtests.py")
    if not os.path.exists(runtests):
        # 尝试在根目录
        runtests = os.path.join(wt, "runtests.py")

    if not os.path.exists(runtests):
        with open(out_log, "w", encoding="utf-8") as f:
            f.write("ERROR: runtests.py not found\n")
        return -1

    cmd = [PY, runtests, "--settings=test_sqlite", "-v", "1"] + converted_tests
    env = dict(os.environ)
    # 确保工作目录和 tests 目录在 PYTHONPATH 最前面
    env["PYTHONPATH"] = wt + os.pathsep + os.path.join(wt, "tests") + os.pathsep + env.get("PYTHONPATH", "")
    env["DJANGO_SETTINGS_MODULE"] = "test_sqlite"
    # 避免使用系统安装的 django
    env["NOSE_INCLUDE_EXE"] = "1"

    try:
        with open(out_log, "w", encoding="utf-8", errors="ignore") as fh:
            r = subprocess.run(cmd, cwd=wt, stdout=fh,
                               stderr=subprocess.STDOUT, env=env, timeout=300)
        return r.returncode
    except subprocess.TimeoutExpired:
        with open(out_log, "a", encoding="utf-8") as f:
            f.write("\nTIMEOUT: 300s\n")
        return -1
    except Exception as e:
        with open(out_log, "a", encoding="utf-8") as f:
            f.write(f"\nEXC: {e}\n")
        return -2


def run_pytest(wt, tests, out_log, repo=""):
    """运行 pytest 测试。返回 returncode。"""
    # django 仓库使用官方 runtests.py
    if "django" in repo.lower():
        return run_django_tests(wt, tests, out_log)

    # 其他仓库使用 pytest
    converted_tests = []
    for t in tests:
        converted = convert_django_test_name(t, wt)
        converted_tests.append(converted)

    tests_json = os.path.join(wt, ".pytest_tests.json")
    json.dump(converted_tests, open(tests_json, "w", encoding="utf-8"))
    try:
        r = subprocess.run(
            [PY, HELP, "pytest", wt, tests_json, out_log],
            capture_output=True, text=True, cwd=BASE,
            timeout=300,  # 5 分钟超时
        )
        return r.returncode
    except subprocess.TimeoutExpired:
        with open(out_log, "a", encoding="utf-8") as f:
            f.write("\nTIMEOUT: 300s\n")
        return -1
    except Exception as e:
        with open(out_log, "a", encoding="utf-8") as f:
            f.write(f"\nEXC: {e}\n")
        return -2


def parse_test_result(log_file):
    """解析 pytest/django 测试日志，返回 (passed, failed, errors)。"""
    if not os.path.exists(log_file):
        return 0, 0, 0
    try:
        content = open(log_file, encoding="utf-8", errors="ignore").read()
    except Exception:
        return 0, 0, 0
    passed = failed = errors = 0
    import re

    # Django runtests.py 格式: "Ran 438 tests in 2.912s" + "OK" / "FAILED (failures=1, errors=2)"
    m = re.search(r"Ran\s+(\d+)\s+tests?", content)
    if m:
        total = int(m.group(1))
        # 解析 failures 和 errors
        fm = re.search(r"failures=(\d+)", content)
        em = re.search(r"errors=(\d+)", content)
        failed = int(fm.group(1)) if fm else 0
        errors = int(em.group(1)) if em else 0
        passed = total - failed - errors
        # 如果是 OK，没有 failures 和 errors
        if re.search(r"\nOK\s*$", content) or content.strip().endswith("OK"):
            passed = total
            failed = 0
            errors = 0
        return passed, failed, errors

    # pytest 格式
    for line in content.split("\n"):
        line = line.strip()
        if "passed" in line and "failed" not in line and "error" not in line:
            m = re.search(r"(\d+)\s+passed", line)
            if m:
                passed = int(m.group(1))
        if "failed" in line:
            m = re.search(r"(\d+)\s+failed", line)
            if m:
                failed = int(m.group(1))
        if "error" in line and "errors" not in line:
            m = re.search(r"(\d+)\s+error", line)
            if m:
                errors = int(m.group(1))
        if "errors" in line:
            m = re.search(r"(\d+)\s+errors", line)
            if m:
                errors = int(m.group(1))
    # 如果没有解析到摘要，检查是否有 FAILED 行
    if failed == 0 and "FAILED" in content:
        failed = content.count("FAILED")
    if passed == 0 and "PASSED" in content:
        passed = content.count("PASSED")
    return passed, failed, errors


def main():
    print("=" * 70)
    print("SWE-bench resolved-rate pytest 验证")
    print("=" * 70)

    # 1. 加载已 resolved 实例
    resolved = load_resolved_instances()
    print(f"\n已 resolved 实例总数: {len(resolved)}")

    # 2. 筛选有完整仓库的实例
    full_repo_instances = []
    for iid in resolved:
        if has_full_repo(iid):
            full_repo_instances.append(iid)
    print(f"有完整仓库的实例数: {len(full_repo_instances)}")

    if not full_repo_instances:
        print("没有可验证的实例，退出")
        return

    # 3. 按仓库分类
    repo_counter = Counter()
    for iid in full_repo_instances:
        repo = iid.split("__")[0] if "__" in iid else "unknown"
        repo_counter[repo] += 1
    print("按仓库分布:")
    for repo, cnt in repo_counter.most_common():
        print(f"  {repo}: {cnt}")

    # 4. 逐个验证
    results = []
    env_unsupported = []  # 环境不支持（依赖未安装）

    print(f"\n{'='*70}")
    print("开始逐个验证...")
    print(f"{'='*70}")

    for idx, iid in enumerate(full_repo_instances):
        inst = get_instance_data(iid)
        if not inst:
            continue
        repo = inst.get("repo", "unknown")
        wt = os.path.join(WORK, iid)
        resp_file = os.path.join(wt, ".resp.json")

        print(f"\n[{idx+1}/{len(full_repo_instances)}] {iid} ({repo})")

        # 检查环境依赖
        repo_short = repo.split("/")[-1] if "/" in repo else repo
        env_ok = True
        try:
            if repo_short == "django":
                import django  # noqa
            elif repo_short == "requests":
                import requests  # noqa
            elif repo_short == "astropy":
                import astropy  # noqa
            elif repo_short == "matplotlib":
                import matplotlib  # noqa
            elif repo_short == "xarray":
                import xarray  # noqa
            elif repo_short == "seaborn":
                import seaborn  # noqa
            elif repo_short == "flask":
                import flask  # noqa
            else:
                env_ok = False  # 未知仓库，默认不支持
        except ImportError:
            env_ok = False

        if not env_ok:
            print(f"  环境不支持（依赖未安装），跳过")
            env_unsupported.append(iid)
            result = {
                "instance_id": iid,
                "repo": repo,
                "stage": "env_unsupported",
                "resolved": False,
                "reason": "dependency not installed",
            }
            results.append(result)
            with open(PYTEST_REPORT, "a", encoding="utf-8") as f:
                f.write(json.dumps(result, ensure_ascii=False) + "\n")
            continue

        # 应用补丁
        if os.path.exists(resp_file):
            blocks, applied, ok = apply_patch(wt, resp_file)
            print(f"  补丁应用: blocks={blocks}, applied={applied}, ok={ok}")
        else:
            print(f"  无 .resp.json，跳过补丁应用")
            blocks, applied, ok = 0, 0, False

        # 运行 pytest
        ftps = json.loads(inst.get("FAIL_TO_PASS", "[]")) if inst.get("FAIL_TO_PASS") else []
        if not ftps:
            print(f"  无 FAIL_TO_PASS 测试，跳过")
            result = {
                "instance_id": iid,
                "repo": repo,
                "stage": "no_tests",
                "resolved": False,
                "reason": "no FAIL_TO_PASS",
            }
            results.append(result)
            with open(PYTEST_REPORT, "a", encoding="utf-8") as f:
                f.write(json.dumps(result, ensure_ascii=False) + "\n")
            continue

        out_log = os.path.join(wt, ".pytest_output.log")
        print(f"  运行 pytest ({len(ftps)} 个测试)...")
        t0 = time.time()
        rc = run_pytest(wt, ftps, out_log, repo=repo)
        elapsed = time.time() - t0
        print(f"  pytest returncode: {rc}, 耗时: {elapsed:.1f}s")

        # 解析测试结果
        passed, failed, errors = parse_test_result(out_log)
        print(f"  测试结果: passed={passed}, failed={failed}, errors={errors}")

        # resolved 判定：rc == 0 且 failed == 0 且 errors == 0
        is_resolved = (rc == 0) and (failed == 0) and (errors == 0)
        stage = "pytest_passed" if is_resolved else "pytest_failed"

        result = {
            "instance_id": iid,
            "repo": repo,
            "stage": stage,
            "resolved": is_resolved,
            "pytest_rc": rc,
            "passed": passed,
            "failed": failed,
            "errors": errors,
            "elapsed": round(elapsed, 1),
            "patch_applied": applied,
            "patch_blocks": blocks,
        }
        results.append(result)
        with open(PYTEST_REPORT, "a", encoding="utf-8") as f:
            f.write(json.dumps(result, ensure_ascii=False) + "\n")

        print(f"  结果: {'PASS' if is_resolved else 'FAIL'}")

    # 5. 汇总报告
    print(f"\n{'='*70}")
    print("验证汇总")
    print(f"{'='*70}")

    total = len(results)
    pytest_passed = sum(1 for r in results if r.get("stage") == "pytest_passed")
    pytest_failed = sum(1 for r in results if r.get("stage") == "pytest_failed")
    env_unsupported_count = sum(1 for r in results if r.get("stage") == "env_unsupported")
    no_tests_count = sum(1 for r in results if r.get("stage") == "no_tests")

    # 真正的 resolved-rate（基于能运行 pytest 的实例）
    evaluable = pytest_passed + pytest_failed
    true_resolved_rate = (100.0 * pytest_passed / evaluable) if evaluable > 0 else 0.0

    # 基于所有已 resolved 实例的 resolved-rate（保守估计）
    overall_resolved_rate = (100.0 * pytest_passed / len(resolved)) if resolved else 0.0

    print(f"验证总数: {total}")
    print(f"  pytest 通过: {pytest_passed}")
    print(f"  pytest 失败: {pytest_failed}")
    print(f"  环境不支持: {env_unsupported_count}")
    print(f"  无测试: {no_tests_count}")
    print(f"")
    print(f"真正的 resolved-rate（基于可评估实例 {evaluable}）: {true_resolved_rate:.1f}%")
    print(f"整体 resolved-rate（基于所有已 resolved {len(resolved)}）: {overall_resolved_rate:.1f}%")

    # 按仓库统计
    print(f"\n按仓库统计:")
    repo_results = defaultdict(lambda: {"total": 0, "passed": 0, "failed": 0, "env": 0})
    for r in results:
        repo = r.get("repo", "unknown").split("/")[-1]
        repo_results[repo]["total"] += 1
        if r.get("stage") == "pytest_passed":
            repo_results[repo]["passed"] += 1
        elif r.get("stage") == "pytest_failed":
            repo_results[repo]["failed"] += 1
        elif r.get("stage") == "env_unsupported":
            repo_results[repo]["env"] += 1

    for repo, stats in sorted(repo_results.items()):
        evaluable_repo = stats["passed"] + stats["failed"]
        rate = (100.0 * stats["passed"] / evaluable_repo) if evaluable_repo > 0 else 0.0
        print(f"  {repo}: total={stats['total']}, passed={stats['passed']}, failed={stats['failed']}, env={stats['env']}, rate={rate:.1f}%")

    print(f"\n详细报告已保存到: {PYTEST_REPORT}")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
