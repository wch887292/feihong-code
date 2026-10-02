# -*- coding: utf-8 -*-
"""探测 hf-mirror 上 openai_humaneval 数据集的真实文件路径"""
import json, ssl, urllib.request

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read()

# 1) 列出数据集文件树
for repo in ["openai_humaneval", "evalplus/humanevalplus"]:
    try:
        tree = get(f"https://hf-mirror.com/api/datasets/{repo}/tree/main").decode("utf-8")
        print(f"===== {repo} tree =====")
        for f in json.loads(tree):
            print(f.get("type"), f.get("size"), f.get("path"))
    except Exception as e:
        print(f"[{repo}] tree 失败: {e}")
    print()
