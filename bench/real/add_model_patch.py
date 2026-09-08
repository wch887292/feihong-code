#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""修改 eval_helpers.py cmd_apply：生成 unified diff 并保存"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
target = os.path.join(HERE, "eval_helpers.py")

with open(target, "r", encoding="utf-8") as f:
    content = f.read()

# 1. 在文件顶部添加 difflib import（如果还没有）
if "import difflib" not in content:
    content = content.replace("import json\n", "import json\nimport difflib\n", 1)
    print("Added difflib import")

# 2. 修改 cmd_apply 函数，在应用修改前保存原始内容，应用后生成 diff
old_apply_start = '''def cmd_apply(args):
    """apply <wt> <response.json> <out.json> -> 解析 SEARCH/REPLACE 块并精确替换，
    写 {blocks, applied, ok} 到 out.json，exit 0。"""
    wt = args[0]
    resp_file = args[1]
    out = args[2]'''

new_apply_start = '''def cmd_apply(args):
    """apply <wt> <response.json> <out.json> -> 解析 SEARCH/REPLACE 块并精确替换，
    写 {blocks, applied, ok, model_patch} 到 out.json，exit 0。"""
    wt = args[0]
    resp_file = args[1]
    out = args[2]
    original_files = {}  # 保存修改前的文件内容'''

if old_apply_start in content:
    content = content.replace(old_apply_start, new_apply_start, 1)
    print("Modified cmd_apply signature")
else:
    print("WARNING: cmd_apply signature not found")

# 3. 在读取文件内容后保存原始版本
old_read = '''        text = open(fpath, encoding="utf-8", errors="replace").read()
        if old in text:'''

new_read = '''        text = open(fpath, encoding="utf-8", errors="replace").read()
        if path not in original_files:
            original_files[path] = text
        if old in text:'''

if old_read in content:
    content = content.replace(old_read, new_read, 1)
    print("Added original file backup (exact match)")
else:
    # 尝试模糊匹配
    print("WARNING: exact read pattern not found, trying fuzzy")

# 4. 在 fuzzy 匹配中也保存原始版本
old_fuzzy_read = '''            norm_text = _normalize(text)
            norm_old = _normalize(old)
            if norm_old in norm_text:'''

new_fuzzy_read = '''            if path not in original_files:
                original_files[path] = text
            norm_text = _normalize(text)
            norm_old = _normalize(old)
            if norm_old in norm_text:'''

if old_fuzzy_read in content:
    content = content.replace(old_fuzzy_read, new_fuzzy_read, 1)
    print("Added original file backup (fuzzy match)")

# 5. 修改最终输出，添加 model_patch
old_output = '''    ok = applied > 0
    json.dump({"blocks": len(blocks), "applied": applied, "ok": ok, "details": details},
              open(out, "w"), ensure_ascii=False)
    return 0'''

new_output = '''    ok = applied > 0
    # 生成 unified diff（model_patch）
    model_patch = ""
    if applied > 0:
        patch_parts = []
        for path, orig_text in original_files.items():
            fpath = os.path.join(wt, path)
            if not os.path.isfile(fpath):
                continue
            new_text = open(fpath, encoding="utf-8", errors="replace").read()
            if new_text != orig_text:
                diff = difflib.unified_diff(
                    orig_text.splitlines(keepends=True),
                    new_text.splitlines(keepends=True),
                    fromfile="a/" + path,
                    tofile="b/" + path,
                    lineterm=""
                )
                patch_parts.append("\\n".join(diff))
        model_patch = "\\n".join(patch_parts)
    json.dump({"blocks": len(blocks), "applied": applied, "ok": ok,
               "details": details, "model_patch": model_patch},
              open(out, "w"), ensure_ascii=False)
    return 0'''

if old_output in content:
    content = content.replace(old_output, new_output, 1)
    print("Modified output to include model_patch")
else:
    print("WARNING: output pattern not found")

with open(target, "w", encoding="utf-8") as f:
    f.write(content)

# 验证语法
import ast
try:
    ast.parse(content)
    print("Syntax OK")
except SyntaxError as e:
    print(f"Syntax Error: {e}")
