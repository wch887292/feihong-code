"""
宿主机完整克隆所有 SWE-bench repo 到 base_images/<repo>/src/
带重试 + 大缓冲区，gitclone.com 镜像
"""
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent
SRC_BASE = BASE_DIR / "base_images"

# gitee 镜像仓库名映射（mirrors/<repo_name>）
GITEE_NAMES = {
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

# GitHub 镜像轮换列表（gitee 国内最快，官方 GitHub 次之，gitclone.com 备用）
# 当前网络状况：github.com 返回 504 不可用，gitee 可用
REPO_MIRRORS = {}
DEFAULT_MIRRORS = [
    "https://gitee.com/mirrors",  # 国内镜像（commit hash 与 GitHub 一致）
    "https://github.com",  # 官方（弱网不稳定但可用）
    "https://gitclone.com/github.com",  # 备用（会虚假成功，需验证）
]


def get_mirrors(repo_name):
    return REPO_MIRRORS.get(repo_name, DEFAULT_MIRRORS)


def repo_url(mirror, repo_name, github_path):
    """根据镜像类型生成仓库 URL"""
    if mirror.startswith("https://gitee.com"):
        return f"{mirror}/{GITEE_NAMES.get(repo_name, github_path.split('/')[-1])}.git"
    return f"{mirror}/{github_path}.git"

# 10 个 repo 配置
REPOS = {
    "psf": "psf/requests",
    "pytest-dev": "pytest-dev/pytest",
    "django": "django/django",
    "sympy": "sympy/sympy",
    "scikit-learn": "scikit-learn/scikit-learn",
    "sphinx-doc": "sphinx-doc/sphinx",
    "matplotlib": "matplotlib/matplotlib",
    "astropy": "astropy/astropy",
    "pydata": "pydata/xarray",
    "pylint-dev": "pylint-dev/pylint",
}


def safe_rmtree(path):
    """删除目录，失败不崩溃（Windows 文件锁场景）"""
    import shutil
    import stat
    import os
    def onerr(func, p, excinfo):
        os.chmod(p, stat.S_IWRITE)
        try:
            func(p)
        except Exception:
            pass
    try:
        if path.exists():
            shutil.rmtree(path, onerror=onerr)
    except Exception:
        pass


def clone_repo(repo_name, github_path):
    """完整克隆单个 repo，多镜像轮换 + 重试（克隆到临时目录，成功后原子替换）"""
    base = SRC_BASE / repo_name
    dest = base / "src"
    tmp = base / "src_tmp"
    old = base / "src_old"

    # 配置 git 大缓冲区
    subprocess.run(["git", "config", "--global", "http.postBuffer", "524288000"],
                   capture_output=True)
    subprocess.run(["git", "config", "--global", "http.lowSpeedLimit", "1000"],
                   capture_output=True)
    subprocess.run(["git", "config", "--global", "http.lowSpeedTime", "60"],
                   capture_output=True)

    base.mkdir(parents=True, exist_ok=True)

    for mirror in get_mirrors(repo_name):
        url = repo_url(mirror, repo_name, github_path)
        for attempt in range(3):
            print(f"[{repo_name}] 克隆尝试: {url} (镜像尝试 {attempt+1}/3)")
            # 清理上次残留：用重命名代替删除（避免 Windows 文件锁崩溃）
            if tmp.exists():
                safe_rmtree(tmp)
            if old.exists():
                safe_rmtree(old)

            try:
                result = subprocess.run(
                    ["git", "clone", url, str(tmp)],
                    capture_output=True, text=True, timeout=1800
                )
            except subprocess.TimeoutExpired:
                print(f"[{repo_name}] 克隆超时(1800s): {url}")
                continue

            if result.returncode == 0:
                # 严格验证：HEAD 必须有提交
                check = subprocess.run(
                    ["git", "-C", str(tmp), "rev-list", "--count", "HEAD"],
                    capture_output=True, text=True
                )
                count = check.stdout.strip() if check.returncode == 0 else "?"
                if check.returncode != 0 or count in ("0", "?"):
                    print(f"[{repo_name}] ⚠️ 克隆后无提交({count})，视为失败")
                    safe_rmtree(tmp)
                    continue
                # 原子替换：src → src_old，src_tmp → src
                if dest.exists():
                    try:
                        dest.rename(old)
                    except Exception:
                        safe_rmtree(dest)
                try:
                    tmp.rename(dest)
                except Exception:
                    safe_rmtree(tmp)
                    continue
                safe_rmtree(old)
                print(f"[{repo_name}] ✅ 克隆成功({url}), 提交数: {count}")
                return True
            print(f"[{repo_name}] 克隆失败: {result.stderr[-200:]}")
            safe_rmtree(tmp)

    print(f"[{repo_name}] ❌ 所有镜像尝试失败")
    return False


def main():
    targets = sys.argv[1:] if len(sys.argv) > 1 else list(REPOS.keys())
    results = {}
    for repo_name in targets:
        if repo_name not in REPOS:
            print(f"跳过未知 repo: {repo_name}")
            continue
        results[repo_name] = clone_repo(repo_name, REPOS[repo_name])

    print("\n=== 克隆汇总 ===")
    for name, ok in results.items():
        print(f"  {name}: {'✅' if ok else '❌'}")


if __name__ == "__main__":
    main()
