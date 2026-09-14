# -*- coding: utf-8 -*-
"""
Agnes AI Studio 项目健康检查脚本
验证依赖、配置、语法、目录结构、API 可用性
"""

import os
import sys
import json
import subprocess
from pathlib import Path
from typing import List, Dict, Tuple


class ProjectChecker:
    """项目健康检查器"""

    def __init__(self, project_dir: str = None):
        if project_dir is None:
            # 自动检测项目目录（向上查找包含 app.py 的目录）
            current = Path.cwd()
            for parent in [current] + list(current.parents):
                if (parent / "app.py").exists():
                    project_dir = str(parent)
                    break
        self.project_dir = project_dir
        self.results: List[Dict] = []

    def _add_result(self, category: str, name: str, status: str, message: str = ""):
        """添加检查结果"""
        self.results.append({
            "category": category,
            "name": name,
            "status": status,  # pass / warn / fail
            "message": message
        })

    def check_python_version(self):
        """检查 Python 版本"""
        version = sys.version_info
        if version.major >= 3 and version.minor >= 9:
            self._add_result("环境", "Python 版本", "pass", f"{version.major}.{version.minor}.{version.micro}")
        else:
            self._add_result("环境", "Python 版本", "fail", f"需要 3.9+，当前 {version.major}.{version.minor}")

    def check_dependencies(self):
        """检查依赖是否安装"""
        req_file = Path(self.project_dir) / "requirements.txt"
        if not req_file.exists():
            self._add_result("依赖", "requirements.txt", "fail", "文件不存在")
            return

        with open(req_file, "r", encoding="utf-8") as f:
            packages = [line.strip().split("==")[0].split(">=")[0].strip()
                        for line in f if line.strip() and not line.startswith("#")]

        missing = []
        for pkg in packages:
            try:
                __import__(pkg.replace("-", "_").split("[")[0])
            except ImportError:
                missing.append(pkg)

        if missing:
            self._add_result("依赖", "Python 包", "fail", f"缺失: {', '.join(missing[:10])}{'...' if len(missing) > 10 else ''}")
        else:
            self._add_result("依赖", "Python 包", "pass", f"全部 {len(packages)} 个依赖已安装")

    def check_config(self):
        """检查配置文件"""
        config_file = Path(self.project_dir) / "config.json"
        if not config_file.exists():
            self._add_result("配置", "config.json", "warn", "文件不存在，将使用默认配置")
            return

        try:
            with open(config_file, "r", encoding="utf-8") as f:
                config = json.load(f)

            # 检查 API Key
            api_key = config.get("api_key", "")
            doubao_key = config.get("doubao_api_key", "")
            doubao_pool = config.get("doubao_pool", {})

            key_count = 0
            if api_key:
                key_count += 1
            if doubao_key:
                key_count += 1
            if doubao_pool.get("enabled"):
                domestic_keys = doubao_pool.get("domestic", {}).get("keys", [])
                overseas_keys = doubao_pool.get("overseas", {}).get("keys", [])
                key_count += len(domestic_keys) + len(overseas_keys)

            if key_count > 0:
                self._add_result("配置", "API Key", "pass", f"已配置 {key_count} 个 Key")
            else:
                self._add_result("配置", "API Key", "warn", "未配置任何 API Key，部分功能不可用")

            # 检查豆包 Pool
            if doubao_pool.get("enabled"):
                strategy = doubao_pool.get("strategy", "round_robin")
                region = doubao_pool.get("preferred_region", "auto")
                self._add_result("配置", "豆包 Pool", "pass", f"已启用，策略={strategy}, 区域={region}")

        except json.JSONDecodeError as e:
            self._add_result("配置", "config.json", "fail", f"JSON 格式错误: {e}")

    def check_python_syntax(self):
        """检查所有 Python 文件语法"""
        py_files = list(Path(self.project_dir).rglob("*.py"))
        # 排除虚拟环境和构建目录
        py_files = [f for f in py_files
                    if "venv" not in str(f) and ".venv" not in str(f)
                    and "build" not in str(f) and "dist" not in str(f)
                    and "__pycache__" not in str(f)]

        failed = []
        for py_file in py_files:
            try:
                result = subprocess.run(
                    [sys.executable, "-m", "py_compile", str(py_file)],
                    capture_output=True, text=True, timeout=10
                )
                if result.returncode != 0:
                    failed.append((str(py_file.relative_to(self.project_dir)), result.stderr.strip()[:100]))
            except Exception as e:
                failed.append((str(py_file.relative_to(self.project_dir)), str(e)))

        if failed:
            self._add_result("语法", "Python 文件", "fail",
                             f"{len(failed)}/{len(py_files)} 个文件有语法错误: {failed[0][0]}...")
        else:
            self._add_result("语法", "Python 文件", "pass", f"全部 {len(py_files)} 个文件语法正确")

    def check_directory_structure(self):
        """检查目录结构"""
        required_dirs = ["src", "src/routes", "src/services", "static"]
        required_files = ["app.py", "requirements.txt", "static/index.html"]

        missing_dirs = [d for d in required_dirs if not (Path(self.project_dir) / d).exists()]
        missing_files = [f for f in required_files if not (Path(self.project_dir) / f).exists()]

        if missing_dirs or missing_files:
            msg = []
            if missing_dirs:
                msg.append(f"缺失目录: {', '.join(missing_dirs)}")
            if missing_files:
                msg.append(f"缺失文件: {', '.join(missing_files)}")
            self._add_result("结构", "目录结构", "fail", "; ".join(msg))
        else:
            self._add_result("结构", "目录结构", "pass", "所有必需目录和文件存在")

    def check_routes_registration(self):
        """检查蓝图注册"""
        init_file = Path(self.project_dir) / "src" / "__init__.py"
        if not init_file.exists():
            self._add_result("结构", "蓝图注册", "fail", "src/__init__.py 不存在")
            return

        with open(init_file, "r", encoding="utf-8") as f:
            content = f.read()

        expected_blueprints = ["drama_bp", "anchor_bp", "canvas_bp"]
        registered = [bp for bp in expected_blueprints if bp in content]
        missing = [bp for bp in expected_blueprints if bp not in content]

        if missing:
            self._add_result("结构", "蓝图注册", "warn", f"未注册: {', '.join(missing)}")
        else:
            self._add_result("结构", "蓝图注册", "pass", f"全部 {len(registered)} 个蓝图已注册")

    def check_api_availability(self, base_url: str = "http://127.0.0.1:5000"):
        """检查 API 是否可用（应用需已启动）"""
        try:
            import requests
            resp = requests.get(base_url, timeout=3)
            if resp.status_code == 200:
                self._add_result("运行", "API 服务", "pass", f"应用运行正常 ({base_url})")
            else:
                self._add_result("运行", "API 服务", "warn", f"HTTP 状态码 {resp.status_code}")
        except ImportError:
            self._add_result("运行", "API 服务", "warn", "requests 未安装，无法检查")
        except Exception as e:
            self._add_result("运行", "API 服务", "warn", f"无法连接 ({e.__class__.__name__})，应用可能未启动")

    def run_all_checks(self, check_api: bool = True) -> List[Dict]:
        """运行所有检查"""
        self.results = []
        self.check_python_version()
        self.check_dependencies()
        self.check_config()
        self.check_python_syntax()
        self.check_directory_structure()
        self.check_routes_registration()
        if check_api:
            self.check_api_availability()
        return self.results

    def print_report(self):
        """打印检查报告"""
        if not self.results:
            print("未运行任何检查")
            return

        print("\n" + "=" * 60)
        print("Agnes AI Studio 项目健康检查报告")
        print("=" * 60)
        print(f"项目目录: {self.project_dir}")
        print()

        current_category = ""
        pass_count = 0
        warn_count = 0
        fail_count = 0

        for r in self.results:
            if r["category"] != current_category:
                current_category = r["category"]
                print(f"\n【{current_category}】")

            status_icon = {"pass": "✅", "warn": "⚠️", "fail": "❌"}[r["status"]]
            print(f"  {status_icon} {r['name']}: {r['message']}")

            if r["status"] == "pass":
                pass_count += 1
            elif r["status"] == "warn":
                warn_count += 1
            else:
                fail_count += 1

        print("\n" + "-" * 60)
        print(f"总计: {pass_count} 通过, {warn_count} 警告, {fail_count} 失败")
        if fail_count == 0:
            print("结论: 项目状态良好，可以正常运行")
        else:
            print("结论: 存在问题，请根据上述提示修复")
        print("=" * 60 + "\n")

        return fail_count == 0


def main():
    """主函数"""
    import argparse
    parser = argparse.ArgumentParser(description="Agnes AI Studio 项目健康检查")
    parser.add_argument("--project-dir", type=str, default=None, help="项目目录路径")
    parser.add_argument("--no-api", action="store_true", help="跳过 API 可用性检查")
    parser.add_argument("--json", action="store_true", help="以 JSON 格式输出结果")
    args = parser.parse_args()

    checker = ProjectChecker(args.project_dir)
    results = checker.run_all_checks(check_api=not args.no_api)

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        checker.print_report()

    # 返回码：有失败返回1，否则返回0
    has_fail = any(r["status"] == "fail" for r in results)
    sys.exit(1 if has_fail else 0)


if __name__ == "__main__":
    main()
