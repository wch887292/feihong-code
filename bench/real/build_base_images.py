"""
方案 A：基于宿主机完整克隆的 Docker 基础镜像构建
Dockerfile 用 COPY 复制宿主机克隆的 repo（base_images/<repo>/src/）进镜像
构建完全不依赖 Docker 网络
"""
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent

# repo 配置：Python 版本 + pip 依赖（只装测试框架，repo 本身在评测时安装）
REPO_CONFIG = {
    "psf": {
        "python": "3.9-slim",
        "pip_packages": "pytest charset_normalizer idna urllib3 certifi",
    },
    "pytest-dev": {
        "python": "3.10-slim",
        "pip_packages": "pytest \"setuptools<81\"",
    },
    "django": {
        # SWE-bench Lite django 实例全部是 2017-2019 年旧版（1.11-2.2），
        # 在 Python 3.11 上源码编译失败（SyntaxError），需用 Python 3.8
        "python": "3.8-slim",
        "pip_packages": "pytest pytest-django pytz sqlparse asgiref beautifulsoup4 selenium",
    },
    "sympy": {
        "python": "3.11-slim",
        "pip_packages": "pytest mpmath",
    },
    "scikit-learn": {
        "python": "3.11-slim",
        "pip_packages": "pytest numpy scipy joblib threadpoolctl cython",
    },
    "sphinx-doc": {
        "python": "3.11-slim",
        "pip_packages": "pytest docutils jinja2 pygments sphinxcontrib-applehelp sphinxcontrib-devhelp sphinxcontrib-htmlhelp sphinxcontrib-jsmath sphinxcontrib-qthelp sphinxcontrib-serializinghtml",
    },
    "matplotlib": {
        "python": "3.11-slim",
        "pip_packages": "pytest numpy cycler kiwisolver pyparsing python-dateutil pillow",
    },
    "astropy": {
        "python": "3.11-slim",
        "pip_packages": "pytest numpy scipy pyerfa packaging",
    },
    "pydata": {
        "python": "3.11-slim",
        "pip_packages": "pytest numpy pandas packaging",
    },
    "pylint-dev": {
        "python": "3.11-slim",
        "pip_packages": "pytest astroid isort mccabe toml",
    },
}


def write_dockerfile(repo_name, config):
    """生成使用 COPY 的 Dockerfile（repo 本身在评测时安装）"""
    return f"""FROM python:{config['python']}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /testbed
COPY src/ /testbed/
RUN git config --global --add safe.directory /testbed
RUN pip install --no-cache-dir --upgrade pip setuptools wheel setuptools-scm
RUN pip install --no-cache-dir {config['pip_packages']}
ENV PYTHONUNBUFFERED=1
"""


def build_image(repo_name, config):
    """构建单个基础镜像"""
    repo_dir = BASE_DIR / "base_images" / repo_name
    src_dir = repo_dir / "src"

    print(f"\n{'='*60}")
    print(f"构建镜像: sweb.base.{repo_name}:latest")
    print(f"Repo: {repo_dir.name}")
    print(f"{'='*60}")

    # 检查宿主机克隆是否完整
    if not src_dir.exists():
        print(f"✗ 宿主机克隆不存在: {src_dir}，跳过")
        return False

    check = subprocess.run(
        ["git", "-C", str(src_dir), "rev-list", "--count", "HEAD"],
        capture_output=True, text=True
    )
    count = check.stdout.strip() if check.returncode == 0 else "?"
    print(f"  宿主机克隆提交数: {count}")
    if check.returncode != 0 or count in ("0", "?"):
        print(f"✗ 宿主机克隆不完整，跳过")
        return False

    # 写 Dockerfile
    dockerfile = write_dockerfile(repo_name, config)
    (repo_dir / "Dockerfile").write_text(dockerfile, encoding="utf-8")

    # 构建
    cmd = [
        "docker", "build", "-t", f"sweb.base.{repo_name}:latest",
        "-f", str(repo_dir / "Dockerfile"),
        str(repo_dir)
    ]
    print(f"命令: {' '.join(cmd[:6])} ...")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=1200)

    if result.returncode == 0:
        print(f"✓ 构建成功: sweb.base.{repo_name}:latest")
        return True

    # 提取错误摘要
    lines = [l for l in (result.stdout + result.stderr).split("\n") if l.strip()]
    error_lines = [l for l in lines if "ERROR" in l or "error:" in l.lower()][-5:]
    print(f"✗ 构建失败")
    for el in error_lines:
        print(f"  {el}")
    return False


def main():
    targets = sys.argv[1:] if len(sys.argv) > 1 else list(REPO_CONFIG.keys())
    results = {}
    for repo_name in targets:
        if repo_name not in REPO_CONFIG:
            print(f"跳过未知 repo: {repo_name}")
            continue
        results[repo_name] = build_image(repo_name, REPO_CONFIG[repo_name])

    print(f"\n{'='*60}")
    print("构建结果汇总:")
    for name, ok in results.items():
        print(f"  {name}: {'✓ 成功' if ok else '✗ 失败'}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
