# -*- coding: utf-8 -*-
import ssl, urllib.request, os
ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
url = "https://hf-mirror.com/datasets/evalplus/humanevalplus/resolve/main/test.jsonl"
out = os.path.join(os.path.dirname(__file__), "HumanEvalPlus.jsonl")
req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=60, context=ctx) as r, open(out,"wb") as f:
    f.write(r.read())
print("saved", out, os.path.getsize(out), "bytes")
# 看第一行结构
import json
with open(out, encoding="utf-8") as f:
    line = f.readline()
d = json.loads(line)
print("字段:", list(d.keys()))
print("task_id:", d.get("task_id"))
print("entry_point:", d.get("entry_point"))
print("prompt 前120字:", repr(d.get("prompt","")[:120]))
print("test 前120字:", repr(d.get("test","")[:120]))
# 统计行数
n = sum(1 for _ in open(out, encoding="utf-8"))
print("总题数:", n)
