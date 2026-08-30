#!/usr/bin/env python3
"""
SWE-bench evaluator helpers (NO NETWORK).
所有网络调用都在 bash 驱动脚本里用 curl 完成；本文件只做本地工作：
 - instance : 抽取某条实例字段
 - prompt   : 生成发送给模型的 prompt（要求输出 unified diff）
 - diff     : 从模型响应里抽取 unified diff 写到 .patch 文件
 - pytest   : 在仓库目录跑 FAIL_TO_PASS 测试（best-effort）
 - report   : 追加单条结果到总报告 JSON
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# Windows 管道下 print() 默认输出 CRLF(\r\n)。bash 的 $( ) 会剥离 CR，
# 但 `read -r` / `mapfile -t` 不会 —— 候选路径末尾残留的 \r 拼进 URL 后
# curl 报 exit 3（URL 非法），导致所有源文件拉取失败（大面积 notarget）。
# 这里强制 stdout 使用 LF，从源头修复。
try:
    sys.stdout.reconfigure(newline="\n")
except Exception:
    pass

ROOT = Path(os.getcwd())
DATA = ROOT / "bench" / "real" / "swebench_300.json"
PYTEST = ROOT / "bench" / "real" / "venv38" / "Scripts" / "python.exe"


def load():
    return json.load(open(DATA, encoding="utf-8"))


def cmd_instance(args):
    """instance <idx> <field> -> 打印字段值"""
    idx = int(args[0])
    field = args[1]
    inst = load()[idx]
    val = inst.get(field, "")
    print(val)


def _derive_source_path(inst):
    """由 FAIL_TO_PASS 测试路径推导最相关源文件相对路径；推导不到返回 ''。"""
    try:
        ftps = json.loads(inst.get("FAIL_TO_PASS", "[]"))
        if ftps:
            test_path = ftps[0].split("::")[0]   # e.g. astropy/modeling/tests/test_separable.py
            parts = test_path.split("/")
            if "tests" in parts:
                ti = parts.index("tests")
                # tests/test_X.py -> X.py 在同级的父目录
                name = parts[-1]
                if name.startswith("test_"):
                    name = name[len("test_"):]
                return "/".join(parts[:ti] + [name])
    except Exception:
        pass
    return ""


# ===================== 源文件定位率提升（多策略融合） =====================

def _extract_keywords(inst):
    """从 problem_statement + FAIL_TO_PASS 提取定位关键词。
    返回 dict：functions, classes, modules, files, errors, raw_terms。"""
    ps = inst.get("problem_statement", "") or ""
    ftps = json.loads(inst.get("FAIL_TO_PASS", "[]")) if inst.get("FAIL_TO_PASS") else []
    keywords = {
        "functions": set(),
        "classes": set(),
        "modules": set(),
        "files": set(),
        "errors": set(),
        "raw_terms": set(),
    }
    # 1) 从 problem_statement 提取
    # 函数调用：xxx( 或 def xxx
    for m in re.finditer(r"\b([a-z_][a-z0-9_]{2,})\s*\(", ps):
        name = m.group(1)
        if name not in ("the", "and", "for", "not", "but", "has", "have", "was", "are", "this", "that", "with", "from", "into", "then", "than"):
            keywords["functions"].add(name)
    # 类名：Xxx 或 XxxError / XxxException
    for m in re.finditer(r"\b([A-Z][a-zA-Z0-9_]+(?:Error|Exception|Warning|Mixin|Base|Meta|Config|View|Form|Model|Serializer|Manager|QuerySet|Test))\b", ps):
        keywords["classes"].add(m.group(1))
    for m in re.finditer(r"\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b", ps):
        keywords["classes"].add(m.group(1))
    # 模块/包名：import xxx 或 from xxx
    for m in re.finditer(r"\b(?:import|from)\s+([a-z_][a-z0-9_.]+)", ps):
        keywords["modules"].add(m.group(1))
    # 文件名：xxx.py
    for m in re.finditer(r"\b([a-z_][a-z0-9_./]*\.py)\b", ps):
        keywords["files"].add(m.group(1))
    # 错误信息：AttributeError: xxx / ValueError: xxx
    for m in re.finditer(r"\b([A-Z][a-zA-Z]+Error|AttributeError|ValueError|TypeError|KeyError|IndexError|ImportError|RuntimeError|NotImplementedError)\b", ps):
        keywords["errors"].add(m.group(1))
    # 原始术语：大写缩写（API、URL、HTTP 等）和带连字符的术语
    for m in re.finditer(r"\b([A-Z]{2,})\b", ps):
        keywords["raw_terms"].add(m.group(1))

    # 2) 从 FAIL_TO_PASS 提取
    for ftp in ftps:
        # 测试函数名：test_xxx 中的 xxx 往往是被测函数
        if "::" in ftp:
            test_fn = ftp.split("::")[-1]
            if test_fn.startswith("test_"):
                core = test_fn[len("test_"):]
                # test_foo_bar -> foo / foo_bar 都可能是被测函数
                keywords["functions"].add(core)
                if "_" in core:
                    keywords["functions"].add(core.split("_")[0])
        # Django 式：test_y (pkg.mod.test_x.ClassName)
        elif " (" in ftp:
            inner = ftp.split("(", 1)[1].rsplit(")", 1)[0]
            parts = inner.split(".")
            for p in parts:
                if p and p[0].islower() and len(p) > 2:
                    keywords["modules"].add(p)
                elif p and p[0].isupper():
                    keywords["classes"].add(p)

    return keywords


def _load_repo_tree(tree_file):
    """加载仓库目录树（JSON 格式，来自 GitHub API git/trees?recursive=1）。
    返回文件路径列表（相对仓库根目录）。"""
    if not tree_file or not os.path.isfile(tree_file):
        return []
    try:
        data = json.load(open(tree_file, encoding="utf-8"))
        tree = data.get("tree", [])
        return [item["path"] for item in tree if item.get("type") == "blob" and item["path"].endswith(".py")]
    except Exception:
        return []


def _score_path(path, keywords):
    """对一个源文件路径做多策略匹配打分，分值越高越可能是目标。"""
    score = 0
    path_lower = path.lower()
    basename = os.path.basename(path_lower)
    name_no_ext = basename.replace(".py", "")
    parts = path_lower.replace("/", " ").replace("_", " ").split()

    # 1) 文件名精确匹配函数名（最强信号）
    for fn in keywords["functions"]:
        if name_no_ext == fn.lower():
            score += 100
        elif fn.lower() in name_no_ext:
            score += 30
        # 函数名出现在路径中（如 models/validators.py 中的 validators）
        elif fn.lower() in path_lower:
            score += 10

    # 2) 类名匹配
    for cls in keywords["classes"]:
        cls_lower = cls.lower()
        if name_no_ext == cls_lower:
            score += 80
        elif cls_lower in name_no_ext:
            score += 25
        elif cls_lower in path_lower:
            score += 8

    # 3) 模块名匹配
    for mod in keywords["modules"]:
        mod_parts = mod.split(".")
        # 模块路径的最后一部分通常是文件名
        if mod_parts and name_no_ext == mod_parts[-1].lower():
            score += 60
        # 模块路径前缀匹配目录结构
        mod_path = mod.replace(".", "/").lower()
        if path_lower.startswith(mod_path):
            score += 40
        elif mod_path in path_lower:
            score += 15

    # 4) 文件名匹配
    for f in keywords["files"]:
        if path_lower == f.lower():
            score += 90
        elif path_lower.endswith(f.lower()):
            score += 50

    # 5) 错误类型匹配（如 ValidationError -> validators.py）
    for err in keywords["errors"]:
        err_core = err.lower().replace("error", "").replace("exception", "").replace("warning", "")
        if err_core and len(err_core) > 2 and err_core in name_no_ext:
            score += 20

    # 6) 排除测试文件和 __init__.py（除非是唯一匹配）
    if "test" in path_lower or "/tests/" in path_lower:
        score -= 50
    if basename == "__init__.py":
        score -= 10

    return score


def _fuzzy_match_in_tree(keywords, tree_files, top_n=15):
    """在仓库目录树中做模糊匹配，返回 top_n 个最可能的源文件路径。"""
    if not tree_files:
        return []
    scored = []
    for path in tree_files:
        s = _score_path(path, keywords)
        if s > 0:
            scored.append((s, path))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [path for _, path in scored[:top_n]]


# 仓库专项人工映射表（针对 import 分散、难以自动定位的仓库）
REPO_HINT_MAP = {
    "matplotlib/matplotlib": {
        # 常见测试目录 -> 源文件目录映射
        "test_": "",  # test_axes.py -> axes/_axes.py 等，需模糊匹配
        "lib/matplotlib/": "lib/matplotlib/",
    },
    "psf/requests": {
        "tests/": "src/requests/",
        "test_": "",
    },
    "mwaskom/seaborn": {
        "tests/": "seaborn/",
    },
    "pydata/xarray": {
        "xarray/tests/": "xarray/",
    },
    "pallets/flask": {
        "tests/": "src/flask/",
    },
}


def _repo_specific_hints(inst, keywords):
    """针对特定仓库的专项定位提示，返回额外的候选源文件路径。"""
    repo = inst.get("repo", "")
    hints = REPO_HINT_MAP.get(repo, {})
    cands = []
    # 从测试路径推导源文件路径（仓库特定规则）
    try:
        ftps = json.loads(inst.get("FAIL_TO_PASS", "[]"))
        if ftps:
            test_path = ftps[0].split("::")[0] if "::" in ftps[0] else ftps[0]
            # Django 式：test_y (pkg.mod.test_x.ClassName)
            if " (" in ftps[0]:
                inner = ftps[0].split("(", 1)[1].rsplit(")", 1)[0]
                parts = inner.split(".")
                modparts = parts[:-1] if len(parts) > 1 else parts
                # Django 测试模块名到源目录的映射
                django_test_to_src = {
                    "auth_tests": "django/contrib/auth",
                    "admin_tests": "django/contrib/admin",
                    "contenttypes_tests": "django/contrib/contenttypes",
                    "sessions_tests": "django/contrib/sessions",
                    "messages_tests": "django/contrib/messages",
                    "staticfiles_tests": "django/contrib/staticfiles",
                    "redirects_tests": "django/contrib/redirects",
                    "flatpages_tests": "django/contrib/flatpages",
                    "humanize_tests": "django/contrib/humanize",
                    "postgres_tests": "django/contrib/postgres",
                    "gis_tests": "django/contrib/gis",
                    "sites_tests": "django/contrib/sites",
                    "webdesign_tests": "django/contrib/webdesign",
                }
                if modparts and modparts[0] in django_test_to_src:
                    src_dir = django_test_to_src[modparts[0]]
                    # test_validators -> validators
                    if len(modparts) >= 2:
                        name = modparts[-1]
                        if name.startswith("test_"):
                            name = name[len("test_"):]
                        cands.append(src_dir + "/" + name + ".py")
                        # 常见子模块
                        for sub in ["models", "views", "forms", "validators", "utils", "helpers", "backends", "mixins"]:
                            cands.append(src_dir + "/" + sub + ".py")
                    else:
                        cands.append(src_dir + "/__init__.py")
                # Django 核心模块（非 contrib）
                elif modparts and modparts[0].endswith("_tests"):
                    # model_tests -> django/db/models, view_tests -> django/views, etc.
                    core_name = modparts[0].replace("_tests", "")
                    core_map = {
                        "model": "django/db/models",
                        "view": "django/views",
                        "template": "django/template",
                        "url": "django/urls",
                        "form": "django/forms",
                        "file": "django/core/files",
                        "mail": "django/core/mail",
                        "cache": "django/core/cache",
                        "logging": "django/utils/log",
                        "translation": "django/utils/translation",
                        "utils": "django/utils",
                        "core": "django/core",
                        "db": "django/db",
                        "http": "django/http",
                        "middleware": "django/middleware",
                        "test": "django/test",
                    }
                    if core_name in core_map:
                        src_dir = core_map[core_name]
                        if len(modparts) >= 2:
                            name = modparts[-1]
                            if name.startswith("test_"):
                                name = name[len("test_"):]
                            cands.append(src_dir + "/" + name + ".py")
                        cands.append(src_dir + "/__init__.py")
            # requests: tests/test_foo.py -> src/requests/foo.py
            if repo == "psf/requests" and test_path.startswith("tests/"):
                name = os.path.basename(test_path)
                if name.startswith("test_"):
                    name = name[len("test_"):]
                cands.append("src/requests/" + name)
            # flask: tests/test_foo.py -> src/flask/foo.py
            elif repo == "pallets/flask" and test_path.startswith("tests/"):
                name = os.path.basename(test_path)
                if name.startswith("test_"):
                    name = name[len("test_"):]
                cands.append("src/flask/" + name)
            # matplotlib: lib/matplotlib/tests/test_foo.py -> lib/matplotlib/foo.py
            elif repo == "matplotlib/matplotlib" and "/tests/" in test_path:
                parts = test_path.split("/tests/")
                if len(parts) == 2:
                    name = os.path.basename(parts[1])
                    if name.startswith("test_"):
                        name = name[len("test_"):]
                    base_dir = parts[0]
                    cands.append(base_dir + "/" + name)
                    # matplotlib 源文件常放在子目录
                    for sub in ["axes", "axis", "figure", "artist", "lines", "patches", "text", "cm", "colors", "backend_bases", "spines", "ticker", "transforms", "projections"]:
                        cands.append(base_dir + "/" + sub + "/" + name)
            # seaborn: seaborn/tests/test_foo.py -> seaborn/foo.py
            elif repo == "mwaskom/seaborn" and "/tests/" in test_path:
                parts = test_path.split("/tests/")
                if len(parts) == 2:
                    name = os.path.basename(parts[1])
                    if name.startswith("test_"):
                        name = name[len("test_"):]
                    cands.append(parts[0] + "/" + name)
            # xarray: xarray/tests/test_foo.py -> xarray/foo.py
            elif repo == "pydata/xarray" and "/tests/" in test_path:
                parts = test_path.split("/tests/")
                if len(parts) == 2:
                    name = os.path.basename(parts[1])
                    if name.startswith("test_"):
                        name = name[len("test_"):]
                    cands.append(parts[0] + "/" + name)
    except Exception:
        pass
    return cands


def cmd_target(args):
    """target <idx> -> 打印两行：源文件相对路径、测试文件相对路径（供脚本单文件拉取）"""
    idx = int(args[0])
    inst = load()[idx]
    src = _derive_source_path(inst)
    test_path = ""
    try:
        ftps = json.loads(inst.get("FAIL_TO_PASS", "[]"))
        if ftps:
            test_path = ftps[0].split("::")[0]
    except Exception:
        pass
    print(src)
    print(test_path)


def cmd_prompt(args):
    """prompt <idx> <wt> <out.txt> <src_rel> [test_rel]
    写 prompt：把【要改的源文件】与【失败测试（仅作上下文）】内容注入。"""
    idx = int(args[0])
    wt = args[1]
    out = args[2]
    src_rel = args[3] if len(args) > 3 else ""
    test_rel = args[4] if len(args) > 4 else ""
    inst = load()[idx]
    repo = inst["repo"]
    ps = inst["problem_statement"]
    src_ctx = ""
    if src_rel:
        full = os.path.join(wt, src_rel)
        if os.path.isfile(full):
            with open(full, encoding="utf-8", errors="replace") as fh:
                content = fh.read()
            if len(content) > 60000:
                content = content[:60000] + "\n... (truncated)\n"
            src_ctx = (
                f"\n## File you MUST edit: `{src_rel}`\n"
                f"(Read it carefully. Your SEARCH/REPLACE block MUST reference exactly this path, "
                f"and the SEARCH lines MUST match these exact lines.)\n"
                f"```python\n{content}\n```\n"
            )
    test_ctx = ""
    if test_rel:
        tf = os.path.join(wt, test_rel)
        if os.path.isfile(tf):
            with open(tf, encoding="utf-8", errors="replace") as fh:
                t = fh.read()
            if len(t) > 20000:
                t = t[:20000] + "\n... (truncated)\n"
            test_ctx = (
                f"\n## Failing test (CONTEXT ONLY — do NOT modify this file): `{test_rel}`\n"
                f"```python\n{t}\n```\n"
            )
    prompt = (
        f"You are a software engineer fixing a bug in the GitHub repository `{repo}`.\n"
        f"The repository is checked out at the base commit. Your working directory is the repository root.\n\n"
        f"## Bug report / issue\n{ps}\n"
        f"{src_ctx}"
        f"{test_ctx}\n"
        f"## Task\n"
        f"Produce the MINIMAL source-code change that fixes the bug. "
        f"You MUST edit the file `{src_rel}` shown above. Do not modify the test file.\n\n"
        f"Output ONE OR MORE SEARCH/REPLACE blocks in EXACTLY this format (no other text, no markdown fences):\n\n"
        f"path/to/file.py\n"
        f"<<<<<<< SEARCH\n"
        f"<exact lines to replace — copy them VERBATIM from the file above>\n"
        f"=======\n"
        f"<the corrected lines>\n"
        f">>>>>>> REPLACE\n\n"
        f"Rules:\n"
        f"- The first line of each block is the file path (use exactly `{src_rel}`).\n"
        f"- Copy the SEARCH lines EXACTLY as they appear in the file (same indentation and whitespace).\n"
        f"- Include a few surrounding context lines so the block is unique in the file.\n"
        f"- If the fix needs more than one change in `{src_rel}`, output multiple SEARCH/REPLACE blocks back-to-back."
    )
    with open(out, "w", encoding="utf-8") as f:
        f.write(prompt)


def cmd_testrel(args):
    """testrel <idx> -> 打印候选【测试文件】相对路径（每行一个，最优在前）。
    兼容两种 FAIL_TO_PASS 格式：
      A) 文件路径式  astropy/modeling/tests/test_x.py::test_y
      B) Django 式   test_y (pkg.mod.test_x.ClassName)  -> tests/pkg/mod/test_x.py
    bash 逐个尝试拉取第一个 200 即作为测试文件。"""
    idx = int(args[0])
    inst = load()[idx]
    ftps = json.loads(inst.get("FAIL_TO_PASS", "[]")) if inst.get("FAIL_TO_PASS") else []
    cands = []
    if ftps:
        s = ftps[0]
        if "::" in s:
            cands.append(s.split("::")[0])
        elif " (" in s:
            inner = s.split("(", 1)[1].rsplit(")", 1)[0]
            parts = inner.split(".")
            modparts = parts[:-1] if len(parts) > 1 else parts
            module = ".".join(modparts)
            mp = module.replace(".", "/")
            cands.append("tests/" + mp + ".py")
            cands.append(mp + ".py")
            if len(modparts) >= 2:
                cands.append("tests/" + "/".join(modparts[:-1]) + "/tests.py")
                cands.append("/".join(modparts[:-1]) + "/tests.py")
        else:
            cands.append(s.replace(".", "/") + ".py")
    seen = set()
    out = []
    for c in cands:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    print("\n".join(out))


def cmd_resolve(args):
    """resolve <idx> <testfile_path> -> 打印候选【源文件】相对路径（每行一个，最优在前）。
    策略（repo 无关，不再猜包根）：
      1) 收集测试文件里所有 import 的模块，按“深度优先 + 文件名线索”排序转为文件路径候选；
      2) 测试文件名线索（test_X -> X 的模块）优先；
      3) 旧 test_path 启发式兜底。
    bash 逐个尝试拉取第一个 200 即作为目标源文件。"""
    idx = int(args[0])
    testfile = args[1] if len(args) > 1 else ""
    inst = load()[idx]
    ftps = json.loads(inst.get("FAIL_TO_PASS", "[]")) if inst.get("FAIL_TO_PASS") else []
    test_rel = ""
    test_leaf = ""
    if ftps and ftps[0]:
        s = ftps[0]
        if "::" in s:
            test_rel = s.split("::")[0]
        elif " (" in s:
            inner = s.split("(", 1)[1].rsplit(")", 1)[0]
            mp = inner.split(".")
            modparts = mp[:-1] if len(mp) > 1 else mp
            test_rel = "/".join(modparts) + ".py"
        if test_rel:
            b = os.path.basename(test_rel)
            b = re.sub(r"^test_", "", b)
            b = re.sub(r"\.py$", "", b)
            test_leaf = b
    # 收集测试文件 import 的模块（不过滤第三方，交由“拉取 404”自然淘汰）。
    # 关键：from PKG import name 里的小写 name 往往是 PKG 的子模块（如
    #   from django.contrib.auth import validators -> django.contrib.auth.validators），
    # 因此要把 name 拼到 PKG 后作为候选源文件模块。
    mods = []
    if testfile and os.path.isfile(testfile):
        try:
            txt = open(testfile, encoding="utf-8", errors="replace").read()
        except Exception:
            txt = ""
        lines = txt.split("\n")
        i = 0
        n = len(lines)
        while i < n:
            line = lines[i]
            m = re.match(r"^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+(.*)$", line)
            if m:
                mod = m.group(1)
                rest = m.group(2)
                # 收集续行（缩进且无 import 关键字）以处理括号多行 import
                j = i + 1
                while j < n and re.match(r"^\s+", lines[j]) and "import" not in lines[j]:
                    rest += " " + lines[j].strip()
                    j += 1
                names = re.findall(r"([A-Za-z_][\w]*)", rest.split("#")[0])
                # 仅当 import 了【恰好一个】名字时，才把该名字当子模块（pkg.name）。
                # 形如 `from pkg import (A, B, C)` 的多个名字通常是类/函数，不是子模块，
                # 避免产生大量错误候选（如 get_password_validators 等）。
                if len(names) == 1:
                    nm = names[0]
                    if nm == nm.lower() and nm not in ("import",):
                        sub = mod + "." + nm
                        if sub not in mods:
                            mods.append(sub)
                if mod not in mods:
                    mods.append(mod)
                i = j
                continue
            m2 = re.match(r"^\s*import\s+([A-Za-z_][\w.]*)", line)
            if m2:
                if m2.group(1) not in mods:
                    mods.append(m2.group(1))
            i += 1
    # 排序：文件名线索优先，其余按模块深度（点更多=更具体=更可能是被测模块）降序
    def depth(m):
        return len(m.split(".")) - 1
    def rank(m):
        leaf = m.split(".")[-1]
        primary = 1 if (test_leaf and leaf == test_leaf) else 0
        return (primary, depth(m))
    mods_sorted = sorted(set(mods), key=rank, reverse=True)
    primaries, others = [], []
    for mod in mods_sorted:
        parts = mod.split(".")
        path = "/".join(parts)
        cands = [path + ".py", path + "/__init__.py"]
        if test_leaf and parts[-1] == test_leaf:
            primaries.extend(cands)
        else:
            others.extend(cands)
    heur = []
    h = _derive_source_path(inst)
    if h:
        heur.append(h)
    ordered = primaries + others + heur
    seen = set()
    out = []
    for c in ordered:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    print("\n".join(out))


def cmd_resolve2(args):
    """resolve2 <idx> <testfile_path> [tree_file] -> 多策略融合定位候选源文件。
    策略（按置信度排序）：
      1) 仓库目录树模糊匹配（problem_statement 关键词 + 目录树，最强信号）
      2) 测试文件 import 推导（复用 cmd_resolve 逻辑）
      3) 仓库专项人工映射（matplotlib/requests/flask/seaborn/xarray）
      4) 测试路径启发式兜底
    bash 逐个尝试拉取第一个 200 即作为目标源文件。"""
    idx = int(args[0])
    testfile = args[1] if len(args) > 1 else ""
    tree_file = args[2] if len(args) > 2 else ""
    inst = load()[idx]

    # 策略 1：problem_statement 关键词 + 仓库目录树模糊匹配
    keywords = _extract_keywords(inst)
    tree_files = _load_repo_tree(tree_file)
    tree_matches = _fuzzy_match_in_tree(keywords, tree_files, top_n=15)

    # 策略 2：测试文件 import 推导（复用 cmd_resolve 逻辑，但作为子函数调用）
    import_cands = _resolve_from_imports(inst, testfile)

    # 策略 3：仓库专项人工映射
    repo_hints = _repo_specific_hints(inst, keywords)

    # 策略 4：旧启发式兜底
    heur = []
    h = _derive_source_path(inst)
    if h:
        heur.append(h)

    # 融合排序：目录树匹配优先（有真实仓库结构支撑），然后 import 推导，然后仓库提示，最后兜底
    ordered = tree_matches + import_cands + repo_hints + heur

    # 去重并限制总数（bash 侧最多拉 25 个，这里多给一些供选择）
    seen = set()
    out = []
    for c in ordered:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
            if len(out) >= 30:
                break
    print("\n".join(out))


def _resolve_from_imports(inst, testfile):
    """从测试文件 import 推导候选源文件（复用 cmd_resolve 核心逻辑，返回列表而非打印）。"""
    ftps = json.loads(inst.get("FAIL_TO_PASS", "[]")) if inst.get("FAIL_TO_PASS") else []
    test_rel = ""
    test_leaf = ""
    if ftps and ftps[0]:
        s = ftps[0]
        if "::" in s:
            test_rel = s.split("::")[0]
        elif " (" in s:
            # Django 式：test_y (pkg.mod.test_x.ClassName)
            inner = s.split("(", 1)[1].rsplit(")", 1)[0]
            mp = inner.split(".")
            modparts = mp[:-1] if len(mp) > 1 else mp
            # Django 测试文件通常在 tests/ 目录下
            # auth_tests.test_validators -> tests/auth_tests/test_validators.py
            if len(modparts) >= 2:
                test_rel = "tests/" + "/".join(modparts) + ".py"
            else:
                test_rel = "/".join(modparts) + ".py"
        if test_rel:
            b = os.path.basename(test_rel)
            b = re.sub(r"^test_", "", b)
            b = re.sub(r"\.py$", "", b)
            test_leaf = b
    mods = []
    if testfile and os.path.isfile(testfile):
        try:
            txt = open(testfile, encoding="utf-8", errors="replace").read()
        except Exception:
            txt = ""
        lines = txt.split("\n")
        i = 0
        n = len(lines)
        while i < n:
            line = lines[i]
            m = re.match(r"^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+(.*)$", line)
            if m:
                mod = m.group(1)
                rest = m.group(2)
                j = i + 1
                while j < n and re.match(r"^\s+", lines[j]) and "import" not in lines[j]:
                    rest += " " + lines[j].strip()
                    j += 1
                names = re.findall(r"([A-Za-z_][\w]*)", rest.split("#")[0])
                if len(names) == 1:
                    nm = names[0]
                    if nm == nm.lower() and nm not in ("import",):
                        sub = mod + "." + nm
                        if sub not in mods:
                            mods.append(sub)
                if mod not in mods:
                    mods.append(mod)
                i = j
                continue
            m2 = re.match(r"^\s*import\s+([A-Za-z_][\w.]*)", line)
            if m2:
                if m2.group(1) not in mods:
                    mods.append(m2.group(1))
            i += 1
    def depth(m):
        return len(m.split(".")) - 1
    def rank(m):
        leaf = m.split(".")[-1]
        primary = 1 if (test_leaf and leaf == test_leaf) else 0
        return (primary, depth(m))
    mods_sorted = sorted(set(mods), key=rank, reverse=True)
    primaries, others = [], []
    for mod in mods_sorted:
        parts = mod.split(".")
        path = "/".join(parts)
        cands = [path + ".py", path + "/__init__.py"]
        if test_leaf and parts[-1] == test_leaf:
            primaries.extend(cands)
        else:
            others.extend(cands)
    return primaries + others


def _extract_diff(content):
    """从模型响应文本里抽取 unified diff。返回 diff 字符串或 None。"""
    if not content:
        return None
    # 优先找 ```diff ... ``` 代码块
    import re
    m = re.search(r"```diff\s*(.*?)```", content, re.DOTALL)
    if m:
        return m.group(1).strip()
    # 退而求其次：以 diff --git 开头到结尾
    idx = content.find("diff --git")
    if idx >= 0:
        return content[idx:].strip()
    # 再退：以 --- a/ 开头
    idx = content.find("--- a/")
    if idx >= 0:
        return content[idx:].strip()
    return None


def cmd_diff(args):
    """diff <response.json> <out.patch> -> 抽取 diff，成功 exit 0 否则 1"""
    resp_file = args[0]
    out = args[1]
    try:
        data = json.load(open(resp_file, encoding="utf-8"))
        content = data["choices"][0]["message"]["content"]
    except Exception:
        return 1
    d = _extract_diff(content)
    if not d:
        return 1
    with open(out, "w", encoding="utf-8") as f:
        f.write(d + "\n")
    return 0


def _normalize(s):
    return "\n".join(line.rstrip() for line in s.split("\n"))


def cmd_apply(args):
    """apply <wt> <response.json> <out.json> -> 解析 SEARCH/REPLACE 块并精确替换，
    写 {blocks, applied, ok} 到 out.json，exit 0。"""
    wt = args[0]
    resp_file = args[1]
    out = args[2]
    try:
        data = json.load(open(resp_file, encoding="utf-8"))
        content = data["choices"][0]["message"]["content"]
    except Exception:
        json.dump({"blocks": 0, "applied": 0, "ok": False, "error": "no content"}, open(out, "w"))
        return 0
    # 解析 SEARCH/REPLACE 块（允许 ``` 包裹或裸格式）
    blocks = re.findall(
        r"([^\n]+?)\n<<<<<<< SEARCH\n(.*?)\n=======\n(.*?)\n>>>>>>> REPLACE",
        content, re.DOTALL)
    # 兜底：去掉可能包裹的 ``` 围栏
    if not blocks:
        stripped = re.sub(r"```\w*\n?", "", content)
        blocks = re.findall(
            r"([^\n]+?)\n<<<<<<< SEARCH\n(.*?)\n=======\n(.*?)\n>>>>>>> REPLACE",
            stripped, re.DOTALL)
    applied = 0
    details = []
    for path, old, new in blocks:
        path = path.strip().lstrip("/")
        fpath = os.path.join(wt, path)
        if not os.path.isfile(fpath):
            details.append({"path": path, "ok": False, "reason": "no file"})
            continue
        text = open(fpath, encoding="utf-8", errors="replace").read()
        if old in text:
            text = text.replace(old, new, 1)
            open(fpath, "w", encoding="utf-8").write(text)
            applied += 1
            details.append({"path": path, "ok": True})
        else:
            # 空白归一化再试
            norm_text = _normalize(text)
            norm_old = _normalize(old)
            if norm_old in norm_text:
                # 在归一化文本里定位，再回写原始文本（用同样归一化替换后还原不可靠，改为行级替换）
                # 简单策略：按行找到 old 首行，做就地替换
                try:
                    old_lines = [l.rstrip() for l in old.split("\n")]
                    text_lines = [l.rstrip() for l in text.split("\n")]
                    start = None
                    for i in range(len(text_lines) - len(old_lines) + 1):
                        if text_lines[i:i + len(old_lines)] == old_lines:
                            start = i
                            break
                    if start is not None:
                        new_lines = new.split("\n")
                        text_lines[start:start + len(old_lines)] = new_lines
                        open(fpath, "w", encoding="utf-8").write("\n".join(text_lines))
                        applied += 1
                        details.append({"path": path, "ok": True, "fuzzy": True})
                    else:
                        details.append({"path": path, "ok": False, "reason": "old not found (fuzzy)"})
                except Exception as e:
                    details.append({"path": path, "ok": False, "reason": str(e)[:80]})
            else:
                details.append({"path": path, "ok": False, "reason": "old not found"})
    ok = applied > 0
    json.dump({"blocks": len(blocks), "applied": applied, "ok": ok, "details": details},
              open(out, "w"), ensure_ascii=False)
    return 0


def cmd_pytest(args):
    """pytest <repo_dir> <tests_json> <out.log> -> 跑测试，exit rc"""
    repo_dir = args[0]
    tests_json = args[1]
    out_log = args[2]
    try:
        tests = json.loads(open(tests_json, encoding="utf-8").read())
    except Exception:
        tests = []
    if not tests:
        with open(out_log, "w", encoding="utf-8") as f:
            f.write("NO_TESTS\n")
        return 2
    cmd = [str(PYTEST), "-m", "pytest", "--no-header", "-q", "-p", "no:cacheprovider"] + tests
    env = dict(os.environ)
    env["PYTHONPATH"] = repo_dir + os.pathsep + env.get("PYTHONPATH", "")
    try:
        with open(out_log, "w", encoding="utf-8", errors="ignore") as fh:
            r = subprocess.run(cmd, cwd=repo_dir, stdout=fh,
                               stderr=subprocess.STDOUT, env=env, timeout=240)
        return r.returncode
    except Exception as e:
        with open(out_log, "a", encoding="utf-8", errors="ignore") as fh:
            fh.write(f"\nEXC {e}\n")
        return 3


def cmd_payload(args):
    """payload <prompt.txt> <payload.json> -> 生成 API 请求体（本地，无网络）
    模型取自环境变量 SILICON_MODEL，默认 deepseek-ai/DeepSeek-V4-Flash。
    """
    prompt_file = args[0]
    out = args[1]
    model = os.environ.get("SILICON_MODEL", "deepseek-ai/DeepSeek-V4-Flash")
    prompt = open(prompt_file, encoding="utf-8").read()
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 4096,
        "temperature": 0.2,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)


def cmd_report(args):
    """report <report.json> <iid> <status_json> -> 追加结果（status_json 为字符串）"""
    report_file = args[0]
    iid = args[1]
    status = json.loads(args[2])
    status["instance_id"] = iid
    _write_report(report_file, status)


def cmd_reportf(args):
    """reportf <report.json> <iid> <status_file> -> 追加结果（status 从文件读取，避免 shell 转义问题）"""
    report_file = args[0]
    iid = args[1]
    status = json.load(open(args[2], encoding="utf-8"))
    status["instance_id"] = iid
    _write_report(report_file, status)


def _write_report(report_file, status):
    """追加式 JSONL：每行一条结果。避免 os.replace 在文件被预览/杀软锁定时报 WinError 5。
    带短暂重试以容忍瞬时锁。"""
    import time
    line = json.dumps(status, ensure_ascii=False)
    last_err = None
    for attempt in range(8):
        try:
            with open(report_file, "a", encoding="utf-8") as f:
                f.write(line + "\n")
                f.flush()
            return
        except Exception as e:  # 瞬时锁等
            last_err = e
            time.sleep(0.3 * (attempt + 1))
    # 兜底再试一次（不抛出，避免中断主循环）
    try:
        with open(report_file, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception as e:
        sys.stderr.write(f"[report-write-fail] {e}\n")


def main():
    sub = sys.argv[1]
    rest = sys.argv[2:]
    if sub == "instance":
        cmd_instance(rest)
    elif sub == "prompt":
        cmd_prompt(rest)
    elif sub == "target":
        cmd_target(rest)
    elif sub == "resolve":
        cmd_resolve(rest)
    elif sub == "resolve2":
        cmd_resolve2(rest)
    elif sub == "testrel":
        cmd_testrel(rest)
    elif sub == "payload":
        cmd_payload(rest)
    elif sub == "diff":
        sys.exit(cmd_diff(rest))
    elif sub == "apply":
        cmd_apply(rest)
    elif sub == "pytest":
        print(cmd_pytest(rest))
    elif sub == "report":
        cmd_report(rest)
    elif sub == "reportf":
        cmd_reportf(rest)
    else:
        print("unknown subcommand", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
