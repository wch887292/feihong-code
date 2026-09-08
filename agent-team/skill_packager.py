"""Skill 打包分发器：将 17 个 AI 员工模块导出为可独立安装/调用的 Skill 包。

每个 Skill 包结构（对齐本环境 Skill 规范）：
    skills/<module_id>_<模块名>/
        SKILL.md   供智能体发现与调用（frontmatter name/description + 使用说明）
        run.py     自包含运行器：内嵌该模块核心逻辑，仅依赖标准库

命令：
    python3 main.py export-skills            # 导出全部模块到 skills/
    python3 main.py install-skills           # 安装到默认 Skill 根目录（.user_skills）
    python3 main.py install-skills --target /path/to/skill_root
"""
import ast
import inspect
import json
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Optional

from agents.registry import get_agent_classes
from config import BASE_DIR

RUN_PY_TEMPLATE = '''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""{name}（{module_id}）独立运行器。

由 feihongzhi_agents 导出：自包含、仅标准库，可被其他智能体直接调用或安装为 Skill。
用法：
    python3 run.py --input '{{"field": "value"}}'
    echo '{{"field": "value"}}' | python3 run.py
可选接入真实大模型（设置环境变量后加 --llm）：
    LLM_API_KEY=xxx LLM_MODEL=xxx LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
    python3 run.py --llm --input '...'
"""
import argparse
import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime

# ------------------------- 内嵌核心逻辑（自动生成） -------------------------
{body}
# ------------------------- 极简 LLM 客户端（可选） -------------------------
class _MiniLLM:
    provider = "doubao"
    def __init__(self):
        import os
        self.key = os.environ.get("LLM_API_KEY", "")
        self.model = os.environ.get("LLM_MODEL", "")
        self.base = os.environ.get("LLM_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")
        if not self.key or not self.model:
            raise RuntimeError("缺少 LLM_API_KEY / LLM_MODEL 环境变量")
    def complete(self, prompt, system=""):
        msgs = []
        if system:
            msgs.append({{"role": "system", "content": system}})
        msgs.append({{"role": "user", "content": prompt}})
        payload = {{"model": self.model, "messages": msgs, "temperature": 0.7, "max_tokens": 1024}}
        req = urllib.request.Request(
            self.base + "/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={{"Content-Type": "application/json", "Authorization": "Bearer " + self.key}},
            method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise RuntimeError("LLM 调用失败 HTTP %s: %s" % (e.code, e.read().decode("utf-8", errors="ignore")[:200]))
        return body["choices"][0]["message"]["content"].strip()

def _load_input(args):
    if args.input:
        return json.loads(args.input)
    if not sys.stdin.isatty():
        raw = sys.stdin.read()
        if raw.strip():
            return json.loads(raw)
    return {{}}

def main():
    ap = argparse.ArgumentParser(description="{name}（{module_id}）")
    ap.add_argument("--input", help="JSON 输入，如 '{{\\"topic\\": \\"AI获客\\"}}'；或经 stdin 传入")
    ap.add_argument("--llm", action="store_true", help="启用真实大模型（需 LLM_API_KEY/LLM_MODEL 环境变量）")
    args = ap.parse_args()
    data = _load_input(args)
    llm = None
    if args.llm:
        try:
            llm = _MiniLLM()
        except Exception as e:
            print(json.dumps({{"ok": False, "error": "LLM 初始化失败: " + str(e)}}, ensure_ascii=False))
            sys.exit(1)
    try:
        out = {entry_func}(data, llm)
    except Exception as e:
        print(json.dumps({{"ok": False, "error": str(e)}}, ensure_ascii=False))
        sys.exit(1)
    print(json.dumps({{"ok": True, "output": out}}, ensure_ascii=False))

if __name__ == "__main__":
    main()
'''

SKILL_MD_TEMPLATE = """---
name: {name}
description: {description}。属于{layer}层，优先级{priority}。触发场景：用户需要{trigger}、或涉及{inputs}相关任务时调用。输出：{outputs}。
---

# {name}（{module_id}）

{description}

- **所属层级**：{layer}（优先级 {priority}）

## 使用方式

```bash
# 方式一：命令行参数
python3 run.py --input '{{"{ex_field}": "{ex_value}"}}'

# 方式二：标准输入
echo '{{"{ex_field}": "{ex_value}"}}' | python3 run.py

# 接入真实大模型（可选）
LLM_API_KEY=xxx LLM_MODEL=xxx python3 run.py --llm --input '{{"{ex_field}": "{ex_value}"}}'
```

## 输入字段

| 字段 | 说明 |
|---|---|
{table_rows}

## 输出字段

{output_rows}

## 安装为 Skill

将本目录（含 SKILL.md 与 run.py）复制到目标 Skill 根目录即可被智能体发现调用。
"""


def _collect_dependencies(func) -> Dict[str, object]:
    """收集函数引用的同模块顶层函数（如 _ts），供内嵌。"""
    try:
        tree = ast.parse(inspect.getsource(func))
    except (OSError, TypeError):
        return {}
    used: set = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            used.add(node.func.id)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            used.add(node.id)
    mod = inspect.getmodule(func)
    deps: Dict[str, object] = {}
    for name in used:
        obj = getattr(mod, name, None)
        if obj is not None and inspect.isfunction(obj) and getattr(obj, "__module__", None) == mod.__name__:
            if name != func.__name__:
                deps[name] = obj
    return deps


def _body_source(cls) -> tuple:
    """收集 run_logic 及其依赖函数源码，保证独立 run.py 自包含。返回 (源码, 入口函数名)。"""
    func = cls.run_logic.__func__ if isinstance(cls.run_logic, staticmethod) else cls.run_logic
    chunks: List[str] = []
    seen: set = set()

    def add(f):
        if id(f) in seen:
            return
        seen.add(id(f))
        for dep in _collect_dependencies(f).values():
            add(dep)
        chunks.append(inspect.getsource(f))

    add(func)
    return "\n\n".join(chunks), func.__name__


def _first_key(schema: Dict[str, str]) -> tuple:
    if not schema:
        return ("data", "{}")
    k = next(iter(schema))
    if k == "customers":
        return (k, '[{"customer_id":"C1","company_name":"客户A","contact_name":"李总"}]')
    if k in ("channels", "target_accounts", "competitor_accounts", "hot_topics", "selling_points", "clips", "tasks"):
        return (k, '["示例A","示例B"]')
    if k == "transcript":
        return (k, "客户：价格有点高；销售：可以谈。")
    return (k, "示例输入")


def export_skills(outdir: Path) -> List[Dict[str, str]]:
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    exported: List[Dict[str, str]] = []
    for cls in get_agent_classes():
        agent = cls(llm=None)
        meta = agent.meta()
        slug = f"{meta['module_id']}_{meta['name']}"
        pkg = outdir / slug
        pkg.mkdir(parents=True, exist_ok=True)

        body, entry_func = _body_source(cls)
        run_py = RUN_PY_TEMPLATE.format(name=meta["name"], module_id=meta["module_id"],
                                        body=body, entry_func=entry_func)
        (pkg / "run.py").write_text(run_py, encoding="utf-8")

        ex_field, ex_value = _first_key(meta["input_schema"])
        table_rows = "\n".join(f"| {k} | {v} |" for k, v in meta["input_schema"].items()) or "| （无必填） | 可传任意 JSON |"
        output_rows = "\n".join(f"- **{k}**：{v}" for k, v in meta["output_keys"].items()) or "- **result**：处理结果"
        trigger = meta["name"]
        md = SKILL_MD_TEMPLATE.format(
            name=slug, module_id=meta["module_id"], description=meta["description"],
            layer=meta["layer"], priority=meta["priority"], trigger=trigger,
            inputs="、".join(meta["input_schema"].keys()) or "任意 JSON",
            outputs="、".join(meta["output_keys"].keys()) or "result",
            ex_field=ex_field, ex_value=ex_value,
            table_rows=table_rows, output_rows=output_rows,
        )
        (pkg / "SKILL.md").write_text(md, encoding="utf-8")
        exported.append({"module_id": meta["module_id"], "name": meta["name"], "path": str(pkg)})
    return exported


def install_skills(source: Path, target: Path) -> List[Dict[str, str]]:
    source = Path(source)
    target = Path(target)
    target.mkdir(parents=True, exist_ok=True)
    installed: List[Dict[str, str]] = []
    for pkg in sorted(source.iterdir()):
        if not pkg.is_dir():
            continue
        if not (pkg / "SKILL.md").exists():
            continue
        dest = target / pkg.name
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(pkg, dest)
        installed.append({"name": pkg.name, "path": str(dest)})
    return installed
