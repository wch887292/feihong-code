"""
优化 eval_helpers.py 中的 cmd_prompt 函数。
"""
import re

file_path = 'bench/real/eval_helpers.py'
content = open(file_path, encoding='utf-8').read()

# 找到 prompt = ( 开始的部分，到 ) 结束
# 使用非贪婪匹配
pattern = r'    prompt = \(\n(.*?)\n    \)'
match = re.search(pattern, content, re.DOTALL)
if not match:
    print("未找到 prompt 定义")
    exit(1)

old_prompt = match.group(0)
print(f"找到旧 prompt，长度: {len(old_prompt)}")
print(f"前 100 字: {old_prompt[:100]}")

new_prompt = '''    prompt = (
        f"You are a senior software engineer fixing a bug in the GitHub repository `{repo}`.\\n"
        f"The repository is checked out at the base commit. Your working directory is the repository root.\\n\\n"
        f"## Bug report / issue\\n{ps}\\n"
        f"{src_ctx}"
        f"{test_ctx}\\n"
        f"## Task\\n"
        f"Produce the MINIMAL source-code change that fixes the bug described above.\\n"
        f"You MUST edit the file `{src_rel}` shown above. Do not modify the test file.\\n\\n"
        f"### CRITICAL INSTRUCTIONS (read carefully)\\n"
        f"1. **OUTPUT ONLY SEARCH/REPLACE BLOCKS** — no explanations, no apologies, no markdown fences.\\n"
        f"   Start your response directly with the file path, then the SEARCH/REPLACE block.\\n"
        f"2. **YOU MUST PRODUCE AT LEAST ONE BLOCK** — even if you believe the file is unrelated,\\n"
        f"   make your best-effort fix based on the bug report. Never respond with \\"I can't fix this\\" or\\n"
        f"   \\"this file doesn't contain the relevant code\\". The file IS the correct target — fix it.\\n"
        f"3. **SEARCH LINES MUST MATCH EXACTLY** — copy them VERBATIM from the file content above,\\n"
        f"   including ALL leading whitespace (spaces/tabs), trailing spaces, and exact punctuation.\\n"
        f"4. **INCLUDE SUFFICIENT CONTEXT** — each SEARCH block must contain at least 3-5 lines of\\n"
        f"   surrounding context so the match is UNIQUE in the file. Never use a single-line SEARCH.\\n"
        f"5. **MINIMAL CHANGES** — change only the lines necessary to fix the bug. Keep surrounding\\n"
        f"   context lines identical in both SEARCH and REPLACE sections.\\n\\n"
        f"## Output Format\\n\\n"
        f"Output ONE OR MORE SEARCH/REPLACE blocks in EXACTLY this format:\\n\\n"
        f"{src_rel}\\n"
        f"<<<<<<< SEARCH\\n"
        f"<3-5 lines of exact context including the lines to change>\\n"
        f"=======\\n"
        f"<the same context lines with the minimal fix applied>\\n"
        f">>>>>>> REPLACE\\n\\n"
        f"If the fix needs multiple changes, output multiple blocks back-to-back (no blank lines between them).\\n"
        f"Every block must use the exact file path `{src_rel}` as its first line.\\n\\n"
        f"## Example\\n\\n"
        f"src/utils/helpers.py\\n"
        f"<<<<<<< SEARCH\\n"
        f"def validate_input(value):\\n"
        f"    if value is None:\\n"
        f"        raise ValueError(\\"value cannot be None\\")\\n"
        f"    return value\\n"
        f"=======\\n"
        f"def validate_input(value):\\n"
        f"    if value is None or value == \\"\\":\\n"
        f"        raise ValueError(\\"value cannot be empty\\")\\n"
        f"    return value\\n"
        f">>>>>>> REPLACE\\n"
    )'''

content = content.replace(old_prompt, new_prompt)
open(file_path, 'w', encoding='utf-8').write(content)
print("prompt 优化完成")

# 验证语法
import py_compile
try:
    py_compile.compile(file_path, doraise=True)
    print("Python 语法检查通过")
except Exception as e:
    print(f"语法错误: {e}")
