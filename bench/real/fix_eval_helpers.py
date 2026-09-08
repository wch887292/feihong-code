#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""修复 eval_helpers.py：添加 _parse_list_field 并替换所有 FAIL_TO_PASS/PASS_TO_PASS 解析"""
import ast
import os

HERE = os.path.dirname(os.path.abspath(__file__))
target = os.path.join(HERE, "eval_helpers.py")

with open(target, "r", encoding="utf-8") as f:
    content = f.read()

# 1. 添加 _parse_list_field 函数
helper_func = '''

def _parse_list_field(val):
    """兼容官方数据集(list)和旧数据集(JSON string)两种格式"""
    if val is None:
        return []
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return []
    return []
'''

# 在 def load(): 之前插入
if "_parse_list_field" not in content:
    content = content.replace("\ndef load():", helper_func + "\ndef load():", 1)
    print("Added _parse_list_field")
else:
    print("_parse_list_field already exists")

# 2. 替换所有 json.loads(inst.get("FAIL_TO_PASS", "[]")) 模式
content = content.replace(
    'json.loads(inst.get("FAIL_TO_PASS", "[]"))',
    '_parse_list_field(inst.get("FAIL_TO_PASS"))'
)
content = content.replace(
    'json.loads(inst.get("FAIL_TO_PASS", "[]")) if inst.get("FAIL_TO_PASS") else []',
    '_parse_list_field(inst.get("FAIL_TO_PASS"))'
)

# 3. 替换 PASS_TO_PASS
content = content.replace(
    'json.loads(inst.get("PASS_TO_PASS", "[]"))',
    '_parse_list_field(inst.get("PASS_TO_PASS"))'
)
content = content.replace(
    'json.loads(inst.get("PASS_TO_PASS", "[]")) if inst.get("PASS_TO_PASS") else []',
    '_parse_list_field(inst.get("PASS_TO_PASS"))'
)

with open(target, "w", encoding="utf-8") as f:
    f.write(content)

# 4. 验证语法
try:
    ast.parse(content)
    print("Syntax OK")
except SyntaxError as e:
    print(f"Syntax Error: {e}")

# 5. 验证替换结果
count = content.count("_parse_list_field")
print(f"_parse_list_field occurrences: {count}")
remaining = content.count('json.loads(inst.get("FAIL_TO_PASS"')
print(f"Remaining json.loads FAIL_TO_PASS: {remaining}")
