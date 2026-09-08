#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""方案 B：简化评测（无 Docker）。
在本地 Python 环境中为每个实例应用 model_patch 并运行 FAIL_TO_PASS 测试。
每个 repo 使用独立的虚拟环境，每个实例在独立的工作目录中运行。
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from collections import defaultdict

# 配置
BENCH_DIR = Path(r"H:\Muse Code复刻\bench\real")
DATASET_FILE = BENCH_DIR / "swebench_lite_official_array.json"
PREDICTIONS_FILE = BENCH_DIR / "predictions_DeepSeek-V4-Flash.jsonl"
VENV_DIR = BENCH_DIR / "venvs"
WORK_DIR = BENCH_DIR / "eval_work"
CACHE_DIR = BENCH_DIR / "repo_cache"
RESULTS_FILE = BENCH_DIR / "simplified_eval_results.jsonl"

# GitHub 镜像
GIT_MIRROR = "https://gitclone.com/github.com"

# repo 配置
REPO_CONFIG = {
    "psf": {
        "github": "psf/requests",
        "python": sys.executable,  # 使用当前 Python
        "pip_packages": ["pytest", "charset_normalizer", "idna", "urllib3", "certifi"],
        "test_cmd": "python -m pytest {test_ids} -x --timeout=60 -q",
    },
    "pytest-dev": {
        "github": "pytest-dev/pytest",
        "python": sys.executable,
        "pip_packages": ["pytest"],
        "test_cmd": "python -m pytest {test_ids} -x --timeout=60 -q",
    },
    "django": {
        "github": "django/django",
        "python": sys.executable,
        "pip_packages": ["pytest", "pytest-django", "pytz", "sqlparse", "asgiref"],
        "test_cmd": "python tests/runtests.py {test_ids} --verbosity=0",
    },
    "sympy": {
        "github": "sympy/sympy",
        "python": sys.executable,
        "pip_packages": ["pytest", "mpmath"],
        "test_cmd": "python -m pytest {test_ids} -x --timeout=120 -q",
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


def setup_venv(repo_name, config):
    """为 repo 创建虚拟环境并安装依赖"""
    venv_path = VENV_DIR / repo_name
    venv_python = venv_path / "Scripts" / "python.exe"

    if venv_path.exists():
        print(f"  虚拟环境已存在: {venv_path}")
        return venv_python

    print(f"  创建虚拟环境: {venv_path}")
    subprocess.run([sys.executable, "-m", "venv", str(venv_path)], check=True)

    # 升级 pip
    subprocess.run([str(venv_python), "-m", "pip", "install", "--upgrade", "pip"],
                   capture_output=True, check=True)

    # 安装依赖
    print(f"  安装依赖: {config['pip_packages']}")
    subprocess.run([str(venv_python), "-m", "pip", "install"] + config['pip_packages'],
                   capture_output=True, check=True)

    return venv_python


def remove_readonly(func, path, excinfo):
    """Windows 上删除只读文件的回调：修改文件属性后重试"""
    import stat
    os.chmod(path, stat.S_IWRITE)
    func(path)


def safe_rmtree(path):
    """安全删除目录（处理 Windows 只读文件问题）"""
    if path.exists():
        shutil.rmtree(path, onerror=remove_readonly)


def clone_repo_cached(repo_name, config, cache_dir):
    """克隆 repo 到缓存目录（完整克隆，带重试和大缓冲区）"""
    github_url = f"{GIT_MIRROR}/{config['github']}.git"
    print(f"  缓存克隆 repo: {github_url} -> {cache_dir}")

    if cache_dir.exists():
        print(f"  缓存已存在，跳过克隆")
        return

    # 设置 git 大缓冲区，防止 RPC failed
    subprocess.run(["git", "config", "--global", "http.postBuffer", "524288000"],
                   capture_output=True)
    subprocess.run(["git", "config", "--global", "http.lowSpeedLimit", "1000"],
                   capture_output=True)
    subprocess.run(["git", "config", "--global", "http.lowSpeedTime", "60"],
                   capture_output=True)

    cache_dir.parent.mkdir(parents=True, exist_ok=True)

    max_retries = 5
    for attempt in range(max_retries):
        print(f"  克隆尝试 {attempt+1}/{max_retries}")
        result = subprocess.run(
            ["git", "clone", github_url, str(cache_dir)],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            print(f"  克隆成功")
            return
        print(f"  克隆失败: {result.stderr[-300:]}")
        if cache_dir.exists():
            safe_rmtree(cache_dir)

    raise RuntimeError(f"git clone failed after {max_retries} attempts")


def setup_workdir_from_cache(cache_dir, work_path, base_commit):
    """从缓存目录创建工作副本，并 checkout 到 base_commit（完整克隆可直接 checkout）"""
    if work_path.exists():
        safe_rmtree(work_path)

    print(f"  从缓存创建工作副本")
    shutil.copytree(cache_dir, work_path)

    print(f"  checkout base_commit: {base_commit[:12]}")
    checkout_result = subprocess.run(
        ["git", "checkout", base_commit],
        cwd=str(work_path), capture_output=True, text=True
    )
    if checkout_result.returncode != 0:
        print(f"  checkout 失败，尝试 fetch 后重试")
        subprocess.run(["git", "fetch", "origin", base_commit],
                       cwd=str(work_path), capture_output=True)
        subprocess.run(["git", "checkout", base_commit],
                       cwd=str(work_path), capture_output=True, check=True)


def fix_patch_format(patch_content):
    """修复 unified diff 格式：空行添加空格前缀，确保每行都有正确的前缀"""
    lines = patch_content.split('\n')
    fixed = []
    in_hunk = False
    for line in lines:
        if line.startswith('@@'):
            in_hunk = True
            fixed.append(line)
            continue
        if line.startswith('diff --git') or line.startswith('---') or line.startswith('+++') or line.startswith('index '):
            in_hunk = False
            fixed.append(line)
            continue
        if in_hunk:
            # hunk 内的行必须以 +、-、空格 开头
            if line == '':
                fixed.append(' ')  # 空上下文行添加空格前缀
            elif not line.startswith(('+', '-', ' ')):
                fixed.append(' ' + line)  # 缺少前缀的行添加空格
            else:
                fixed.append(line)
        else:
            fixed.append(line)
    return '\n'.join(fixed)


def apply_patch(repo_path, patch_content):
    """应用 patch 到 repo（使用 --recount 自动重新计算 hunk 行数）"""
    patch_file = repo_path / "model_patch.patch"
    patch_file.write_text(patch_content, encoding="utf-8", newline="")

    # 尝试应用，使用 --recount 自动重新计算 hunk 行数
    # 模型生成的 patch 经常 hunk 行数不匹配，--recount 可以自动修复
    result = subprocess.run(
        ["git", "apply", "--recount", "--whitespace=fix", "--verbose", str(patch_file)],
        cwd=str(repo_path), capture_output=True, text=True
    )
    if result.returncode != 0:
        # 如果失败，尝试不检查空白
        result = subprocess.run(
            ["git", "apply", "--recount", "--reject", str(patch_file)],
            cwd=str(repo_path), capture_output=True, text=True
        )
    return result.returncode == 0, result.stdout + result.stderr


def run_tests(repo_path, venv_python, test_ids, config):
    """运行 FAIL_TO_PASS 测试"""
    test_cmd = config['test_cmd'].format(test_ids=" ".join(test_ids))
    print(f"  运行测试: {test_cmd[:100]}...")

    result = subprocess.run(
        test_cmd, cwd=str(repo_path), capture_output=True, text=True,
        shell=True, timeout=300
    )
    return result.returncode == 0, result.stdout + result.stderr


def evaluate_instance(instance, prediction, venv_python, config, cache_dir):
    """评测单个实例"""
    instance_id = instance['instance_id']
    print(f"\n  评测: {instance_id}")

    work_path = WORK_DIR / instance_id

    try:
        # 从缓存创建工作副本并 checkout 到 base_commit
        setup_workdir_from_cache(cache_dir, work_path, instance['base_commit'])

        # 安装 repo（editable）
        subprocess.run([str(venv_python), "-m", "pip", "install", "-e", "."],
                       cwd=str(work_path), capture_output=True)

        # 应用 model_patch
        patch_content = prediction.get('model_patch', '')
        if not patch_content:
            return {"instance_id": instance_id, "status": "no_patch", "resolved": False}

        applied, apply_log = apply_patch(work_path, patch_content)
        if not applied:
            return {"instance_id": instance_id, "status": "patch_failed",
                    "resolved": False, "log": apply_log[-500:]}

        # 运行 FAIL_TO_PASS 测试
        fail_to_pass = instance.get('FAIL_TO_PASS', [])
        if isinstance(fail_to_pass, str):
            fail_to_pass = json.loads(fail_to_pass)

        if not fail_to_pass:
            return {"instance_id": instance_id, "status": "no_tests", "resolved": False}

        # 提取测试 ID（去掉参数化部分）
        test_ids = []
        for t in fail_to_pass:
            if "::" in t:
                test_ids.append(t.split("::")[0] + "::" + t.split("::")[1].split("[")[0])
            else:
                test_ids.append(t)

        passed, test_log = run_tests(work_path, venv_python, test_ids, config)

        return {
            "instance_id": instance_id,
            "status": "resolved" if passed else "unresolved",
            "resolved": passed,
            "test_count": len(fail_to_pass),
            "log": test_log[-500:] if not passed else "",
        }

    except subprocess.TimeoutExpired:
        return {"instance_id": instance_id, "status": "timeout", "resolved": False}
    except Exception as e:
        return {"instance_id": instance_id, "status": "error", "resolved": False,
                "error": str(e)}
    finally:
        # 清理工作目录
        if work_path.exists():
            safe_rmtree(work_path)


def main():
    # 支持指定 repo
    target_repos = sys.argv[1:] if len(sys.argv) > 1 else ["psf"]

    # 清空旧结果
    if RESULTS_FILE.exists():
        RESULTS_FILE.unlink()

    print("=" * 60)
    print("方案 B：简化评测（无 Docker）")
    print(f"目标 repos: {', '.join(target_repos)}")
    print("=" * 60)

    # 加载数据
    dataset = load_dataset()
    predictions = load_predictions()
    print(f"数据集: {len(dataset)} 实例")
    print(f"Predictions: {len(predictions)} 实例")

    # 按 repo 分组实例
    repo_instances = defaultdict(list)
    for instance in dataset:
        iid = instance['instance_id']
        if iid in predictions:
            repo_name = get_repo_name(iid)
            if repo_name in target_repos:
                repo_instances[repo_name].append(instance)

    # 创建工作目录
    VENV_DIR.mkdir(exist_ok=True)
    WORK_DIR.mkdir(exist_ok=True)
    CACHE_DIR.mkdir(exist_ok=True)

    # 评测结果
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

        # 设置虚拟环境
        venv_python = setup_venv(repo_name, config)

        # 克隆 repo 到缓存（只克隆一次）
        cache_dir = CACHE_DIR / repo_name
        clone_repo_cached(repo_name, config, cache_dir)

        # 评测每个实例
        for instance in instances:
            result = evaluate_instance(instance, predictions[instance['instance_id']],
                                       venv_python, config, cache_dir)
            all_results.append(result)

            # 写入结果
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
    print(f"  Resolved: {resolved} ({resolved/total*100:.1f}%)" if total else "  无实例")
    print(f"  结果文件: {RESULTS_FILE}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
