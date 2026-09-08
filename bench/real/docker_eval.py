"""
方案 A+：基于 Docker 基础镜像的评测脚本
基础镜像内已包含完整 repo 克隆，无需再 clone
每个实例：启动容器 -> checkout base_commit -> 应用 patch -> 运行测试 -> 停止容器
"""
import json
import subprocess
import sys
import os
from pathlib import Path
from collections import defaultdict

BASE_DIR = Path(__file__).parent
DATASET_FILE = BASE_DIR / "swebench_lite_official_array.json"
PREDICTIONS_FILE = BASE_DIR / "predictions_DeepSeek-V4-Flash.jsonl"
RESULTS_FILE = BASE_DIR / "docker_eval_results.jsonl"

# repo 配置：基础镜像名 + 测试命令
REPO_CONFIG = {
    "psf": {
        "image": "sweb.base.psf:latest",
        "test_cmd": "cd /testbed && python -m pytest {test_ids} -x -q",
        "use_prefix": True,
    },
    "pytest-dev": {
        "image": "sweb.base.pytest-dev:latest",
        "test_cmd": "cd /testbed && python -m pytest {test_ids} -x -q",
        "use_prefix": True,
    },
    "django": {
        "image": "sweb.base.django:latest",
        "test_cmd": "cd /testbed && python tests/runtests.py {test_ids} --parallel 1",
        "use_prefix": False,  # django 标签是模块路径，不能加文件路径前缀
        "django_format": True,  # FAIL_TO_PASS 是 'test_x (a.b.C)' 格式
    },
}


def load_dataset():
    with open(DATASET_FILE, encoding="utf-8") as f:
        return json.load(f)


def load_predictions():
    preds = {}
    with open(PREDICTIONS_FILE, encoding="utf-8") as f:
        for line in f:
            obj = json.loads(line)
            preds[obj['instance_id']] = obj
    return preds


def get_repo_name(instance_id):
    return instance_id.rsplit('__', 1)[0]


def run_docker_eval(instance, prediction, config):
    """在 Docker 容器中评测单个实例"""
    instance_id = instance['instance_id']
    base_commit = instance['base_commit']
    image = config['image']
    container_name = f"eval-{instance_id.replace('__', '-').replace('_', '-')}"

    print(f"\n  评测: {instance_id}")
    print(f"  镜像: {image}, commit: {base_commit[:12]}")

    # 停止并删除已存在的同名容器
    subprocess.run(["docker", "rm", "-f", container_name],
                   capture_output=True, timeout=30)

    try:
        # 1. 启动容器（后台运行）
        print(f"  启动容器...")
        result = subprocess.run(
            ["docker", "run", "-d", "--name", container_name, image, "sleep", "3600"],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            return {"instance_id": instance_id, "status": "container_failed",
                    "resolved": False, "error": result.stderr[-500:]}

        # 2. checkout 到 base_commit（-f 强制覆盖，带 fetch 重试）
        print(f"  checkout base_commit...")
        checkout_ok = False
        last_error = ""
        for attempt in range(3):
            result = subprocess.run(
                ["docker", "exec", container_name, "git", "checkout", "-f", base_commit],
                capture_output=True, text=True, timeout=60
            )
            if result.returncode == 0:
                checkout_ok = True
                break
            last_error = result.stderr[-500:]
            # checkout 失败，只 fetch 需要的特定 commit（不是 --all）
            print(f"    checkout 失败，尝试 fetch commit (attempt {attempt+1}/3)...")
            fetch_result = subprocess.run(
                ["docker", "exec", container_name, "git", "fetch", "origin", base_commit],
                capture_output=True, text=True, timeout=300
            )
            if fetch_result.returncode != 0:
                # 如果 fetch 特定 commit 失败，尝试 unshallow
                print(f"    fetch commit 失败，尝试 fetch --unshallow...")
                subprocess.run(
                    ["docker", "exec", container_name, "git", "fetch", "--unshallow", "origin"],
                    capture_output=True, timeout=300
                )

        if not checkout_ok:
            return {"instance_id": instance_id, "status": "checkout_failed",
                    "resolved": False, "error": last_error}

        # 3. 安装 repo（editable）
        print(f"  安装 repo...")
        subprocess.run(
            ["docker", "exec", container_name, "pip", "install", "-e", "/testbed"],
            capture_output=True, timeout=120
        )

        # 4. 应用 test_patch（先添加 SWE-bench 新增的测试）
        #    先将 patch_applier.py 复制到容器（test_patch 和 model_patch 都要用）
        patch_applier_local = BASE_DIR / "patch_applier.py"
        subprocess.run(
            ["docker", "cp", str(patch_applier_local), f"{container_name}:/tmp/patch_applier.py"],
            capture_output=True, timeout=30
        )

        test_patch = instance.get('test_patch', '')
        if test_patch:
            print(f"  应用 test_patch...")
            # test_patch 是官方 SWE-bench 格式（干净 unified diff），用 git apply 应用
            patch_json = BASE_DIR / f"temp_testpatch_{instance_id}.patch"
            with open(patch_json, "w", encoding="utf-8") as f:
                f.write(test_patch)
            subprocess.run(
                ["docker", "cp", str(patch_json), f"{container_name}:/tmp/testpatch.patch"],
                capture_output=True, timeout=30
            )
            patch_json.unlink(missing_ok=True)

            result = subprocess.run(
                ["docker", "exec", container_name, "bash", "-c",
                 "cd /testbed && git apply --whitespace=nowarn /tmp/testpatch.patch 2>&1; echo EXIT:$?"],
                capture_output=True, text=True, timeout=60
            )
            if "EXIT:0" not in result.stdout:
                # git apply 失败时回退到 Python 手动应用器
                print(f"  git apply 失败，回退手动应用器: {result.stdout[-200:]}")
                apply_script = '''
import json
import sys
sys.path.insert(0, "/tmp")
from patch_applier import apply_patch

with open("/tmp/testpatch.patch", encoding="utf-8") as f:
    patch_text = f.read()

success, msg = apply_patch(patch_text, "/testbed")
print(f"RESULT:{'SUCCESS' if success else 'FAILED'}")
print(f"MESSAGE:{msg}")
'''
                result2 = subprocess.run(
                    ["docker", "exec", container_name, "python", "-c", apply_script],
                    capture_output=True, text=True, timeout=60
                )
                if "RESULT:SUCCESS" not in result2.stdout:
                    print(f"  test_patch 应用失败（继续）: {result2.stdout[-200:]}")

        # 5. 应用 model_patch（使用 Python 手动 patch 应用器）
        patch_content = prediction.get('model_patch', '')
        if not patch_content:
            return {"instance_id": instance_id, "status": "no_patch", "resolved": False}

        # 将 patch 内容写入容器中的 JSON 文件
        patch_json = BASE_DIR / f"temp_patch_{instance_id}.json"
        with open(patch_json, "w", encoding="utf-8") as f:
            json.dump({"patch": patch_content}, f, ensure_ascii=False)
        subprocess.run(
            ["docker", "cp", str(patch_json), f"{container_name}:/tmp/patch_content.json"],
            capture_output=True, timeout=30
        )
        patch_json.unlink(missing_ok=True)

        # 在容器中运行 Python 脚本应用 patch
        print(f"  应用 patch（Python 手动应用器）...")
        apply_script = '''
import json
import sys
sys.path.insert(0, "/tmp")
from patch_applier import apply_patch

with open("/tmp/patch_content.json", encoding="utf-8") as f:
    data = json.load(f)

success, msg = apply_patch(data["patch"], "/testbed")
print(f"RESULT:{'SUCCESS' if success else 'FAILED'}")
print(f"MESSAGE:{msg}")
'''
        result = subprocess.run(
            ["docker", "exec", container_name, "python", "-c", apply_script],
            capture_output=True, text=True, timeout=60
        )

        if "RESULT:SUCCESS" not in result.stdout:
            return {"instance_id": instance_id, "status": "patch_failed",
                    "resolved": False, "log": result.stdout[-500:] + result.stderr[-500:]}

        # 5. 运行 FAIL_TO_PASS 测试（带自动路径修复）
        fail_to_pass = instance.get('FAIL_TO_PASS', [])
        if isinstance(fail_to_pass, str):
            fail_to_pass = json.loads(fail_to_pass)

        if not fail_to_pass:
            return {"instance_id": instance_id, "status": "no_tests", "resolved": False}

        # 提取测试 ID（去掉参数化部分；django 用 'test_x (a.b.C)' 格式需转换）
        test_ids = []
        for t in fail_to_pass:
            if config.get('django_format', False):
                # 'test_x (a.b.C)' -> 'a.b.C.test_x'（runtests.py 标签格式）
                import re
                m = re.match(r'^(\w+) \(([\w.]+)\)', t)
                if m:
                    t = f"{m.group(2)}.{m.group(1)}"
            if "::" in t:
                test_ids.append(t.split("[")[0])
            else:
                test_ids.append(t)

        # 尝试多种测试路径前缀（仅文件路径格式的 repo；django 等模块标签格式禁用）
        use_prefix = config.get('use_prefix', True)
        path_prefixes = ["", "tests/", "test/", "testing/"] if use_prefix else [""]
        resolved = False
        test_output = ""
        used_prefix = ""

        for prefix in path_prefixes:
            if prefix:
                fixed_test_ids = []
                for tid in test_ids:
                    if "::" in tid:
                        parts = tid.split("::", 1)
                        fixed_test_ids.append(f"{prefix}{parts[0]}::{parts[1]}")
                    else:
                        fixed_test_ids.append(f"{prefix}{tid}")
            else:
                fixed_test_ids = test_ids

            test_cmd = config['test_cmd'].format(test_ids=" ".join(fixed_test_ids))
            print(f"  运行测试 (prefix='{prefix}'): {test_cmd[:80]}...")

            result = subprocess.run(
                ["docker", "exec", container_name, "bash", "-c", test_cmd],
                capture_output=True, text=True, timeout=300
            )

            test_output = result.stdout + result.stderr

            # 如果测试通过，标记 resolved
            if result.returncode == 0:
                resolved = True
                used_prefix = prefix
                break

            # 如果错误是 "not found" 或 "no collectors"，尝试下一个前缀
            if "not found" in test_output or "no collectors" in test_output or "ERROR: not found" in test_output:
                print(f"    测试路径不存在，尝试下一个前缀...")
                continue
            else:
                # 其他错误（测试断言失败等），不再重试
                break

        status = "resolved" if resolved else "test_failed"

        return {
            "instance_id": instance_id,
            "status": status,
            "resolved": resolved,
            "test_output": result.stdout[-1000:] + result.stderr[-500:],
        }

    finally:
        # 停止并删除容器
        subprocess.run(["docker", "rm", "-f", container_name],
                       capture_output=True, timeout=30)


def main():
    target_repos = sys.argv[1:] if len(sys.argv) > 1 else ["psf"]

    # 清空旧结果
    if RESULTS_FILE.exists():
        RESULTS_FILE.unlink()

    print("=" * 60)
    print("方案 A+：Docker 基础镜像评测")
    print(f"目标 repos: {', '.join(target_repos)}")
    print("=" * 60)

    dataset = load_dataset()
    predictions = load_predictions()
    print(f"数据集: {len(dataset)} 实例")
    print(f"Predictions: {len(predictions)} 实例")

    # 按 repo 分组
    repo_instances = defaultdict(list)
    for instance in dataset:
        iid = instance['instance_id']
        if iid in predictions:
            repo_name = get_repo_name(iid)
            if repo_name in target_repos:
                repo_instances[repo_name].append(instance)

    all_results = []

    for repo_name in target_repos:
        if repo_name not in REPO_CONFIG:
            print(f"\n跳过未配置的 repo: {repo_name}")
            continue

        config = REPO_CONFIG[repo_name]
        instances = repo_instances.get(repo_name, [])

        print(f"\n{'='*60}")
        print(f"Repo: {repo_name} ({len(instances)} 实例)")
        print(f"{'='*60}")

        for instance in instances:
            result = run_docker_eval(instance, predictions[instance['instance_id']], config)
            all_results.append(result)

            with open(RESULTS_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(result, ensure_ascii=False) + "\n")

            status = result['status']
            resolved = "✓" if result.get('resolved') else "✗"
            print(f"    {resolved} {instance['instance_id']}: {status}")

    # 汇总
    print(f"\n{'='*60}")
    print("评测汇总:")
    total = len(all_results)
    resolved = sum(1 for r in all_results if r.get('resolved'))
    print(f"  总实例: {total}")
    if total:
        print(f"  Resolved: {resolved} ({resolved/total*100:.1f}%)")
    print(f"  结果文件: {RESULTS_FILE}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
