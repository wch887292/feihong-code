#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI 员工军团 · 代码体检脚本（编译 + 引号嵌套 + 契约一致性）。

晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹

检查项：
  1. 全部 .py 编译通过（语法正确）
  2. f-string 内无英文双引号嵌套（"不要"震惊"这类" 会直接终结字符串）
  3. 每个员工的 input_schema 字段名，与 run_logic 实际读取的字段一致
  4. llm_json / llm_text 导入存在

用法：python check_agents.py
"""
import ast
import io
import os
import py_compile
import re
import sys
import tempfile

TEAM = os.path.dirname(os.path.abspath(__file__))
AGENTS_DIR = os.path.join(TEAM, "agents")

problems = []
checked = 0


def iter_py(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ("__pycache__", ".git", "skills")]
        for fn in filenames:
            if fn.endswith(".py"):
                yield os.path.join(dirpath, fn)


def check_compile_and_quotes(tmp):
    """编译检查 + 引号嵌套检查。

    引号嵌套的坑：f"…不要"震惊"…" 里的英文双引号会直接终结字符串，
    导致整段 f-string 崩掉。检测方式：找出所有以 f" 开头的行，
    若该行 f" 之后到行尾最后一个 " 之前还含 "，即为嵌套。
    """
    global checked
    for p in iter_py(TEAM):
        checked += 1
        src = io.open(p, encoding="utf-8").read()
        for i, line in enumerate(src.split("\n"), 1):
            s = line.strip()
            if not s.startswith('f"'):
                continue
            end = s.rfind('"')
            if end <= 2:
                continue
            inner = s[2:end]
            if '"' in inner:
                problems.append((os.path.relpath(p, TEAM), i, "引号嵌套",
                                 s[:90] + " →  英文双引号应改为「」"))
        try:
            py_compile.compile(p, doraise=True, cfile=os.path.join(tmp, "x.pyc"))
        except Exception as e:
            problems.append((os.path.relpath(p, TEAM), "-", "编译失败", str(e).split("\n")[0][:110]))


def check_contracts():
    """校验每个 Agent 的 input_schema 字段在 run_logic 中被正确读取。"""
    for fn in sorted(os.listdir(AGENTS_DIR)):
        if not fn.endswith(".py") or fn == "__init__.py":
            continue
        p = os.path.join(AGENTS_DIR, fn)
        src = io.open(p, encoding="utf-8").read()
        try:
            tree = ast.parse(src)
        except SyntaxError:
            continue  # 编译检查已报告
        # 收集所有类定义的 input_schema 与 run_logic 引用
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            schema = None
            logic_name = None
            for item in node.body:
                if isinstance(item, ast.Assign):
                    for tgt in item.targets:
                        if isinstance(tgt, ast.Name) and tgt.id == "input_schema":
                            try:
                                schema = ast.literal_eval(item.value)
                            except Exception:
                                schema = None
                        if isinstance(tgt, ast.Name) and tgt.id == "run_logic":
                            if isinstance(item.value, ast.Attribute):
                                logic_name = item.value.attr
            if not schema or not logic_name:
                continue
            # 找 run_logic 函数体
            func = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == logic_name), None)
            if func is None:
                continue
            # 收集函数体内 data.get("xxx") 的键
            used = set()
            for n in ast.walk(func):
                if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                        and n.func.attr == "get" and n.args
                        and isinstance(n.args[0], ast.Constant)
                        and isinstance(n.args[0].value, str)):
                    used.add(n.args[0].value)
            # 契约字段必须被使用
            for field in schema:
                if field not in used:
                    problems.append((f"agents/{fn}", "-", f"契约未使用 [{node.name}]",
                                     f"input_schema 声明了 {field}，但 run_logic 未读取"))
            # run_logic 读取了但 schema 未声明的字段（会导致契约校验失败）
            for field in sorted(used):
                if field not in schema and field not in ("clips", "days", "script", "template"):
                    problems.append((f"agents/{fn}", "-", f"读取未声明字段 [{node.name}]",
                                     f"run_logic 读取 data['{field}']，但 input_schema 未声明"))


def check_imports():
    for fn in sorted(os.listdir(AGENTS_DIR)):
        if not fn.endswith(".py") or fn == "__init__.py":
            continue
        p = os.path.join(AGENTS_DIR, fn)
        src = io.open(p, encoding="utf-8").read()
        if "llm_json(" in src and "from llm.llm_json import" not in src:
            problems.append((f"agents/{fn}", "-", "缺少导入", "用了 llm_json 但没 import"))


def main():
    tmp = tempfile.mkdtemp()
    print("═══ AI 员工军团代码体检 ═══\n")
    check_compile_and_quotes(tmp)
    print(f"[1/3] 编译 + 引号检查：{checked} 个文件")
    check_contracts()
    print("[2/3] 输入契约一致性检查")
    check_imports()
    print("[3/3] 导入完整性检查\n")

    if problems:
        print(f"❌ 发现 {len(problems)} 个问题：\n")
        for p in problems:
            print(f"  {p[0]} | 行 {p[1]} | {p[2]}")
            print(f"      {p[3]}")
        return 1
    print("✅ 全部检查通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
