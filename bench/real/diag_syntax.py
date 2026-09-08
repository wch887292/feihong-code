"""验证 django 3.8 镜像中旧版 django 源码可编译"""
import ast
import sys

paths = sys.argv[1:]
for p in paths:
    try:
        src = open(p, encoding="utf-8").read()
        ast.parse(src)
        print(f"OK  {p}")
    except SyntaxError as e:
        print(f"FAIL {p}: line {e.lineno}: {e.msg}")
    except Exception as e:
        print(f"ERR {p}: {type(e).__name__}: {e}")
