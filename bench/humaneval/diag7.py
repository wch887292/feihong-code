# -*- coding: utf-8 -*-
import ssl, json, urllib.request, os
BASE = os.environ["EVAL_BASE"]; KEY = os.environ["AGNES_API_KEY"]
ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE

items = [json.loads(l) for l in open("HumanEvalPlus.jsonl", encoding="utf-8") if l.strip()]
it = [x for x in items if x["task_id"]=="HumanEval/7"][0]

body = {
  "model": os.environ["EVAL_MODEL"],
  "messages": [
    {"role":"system","content":"You are an expert Python code completion engine. Output ONLY the indented function body, no signature, no explanation, no markdown."},
    {"role":"user","content": it["prompt"]},
  ],
  "temperature":0.0, "max_tokens":400,
}
req = urllib.request.Request(BASE, data=json.dumps(body).encode(),
    headers={"Authorization":"Bearer "+KEY,"Content-Type":"application/json"})
try:
    with urllib.request.urlopen(req, timeout=90, context=ctx) as r:
        resp = json.loads(r.read().decode())
except urllib.error.HTTPError as e:
    print("HTTP", e.code)
    print("body:", e.read().decode()[:800])
    raise SystemExit
print("===== 原始补全 =====")
print(repr(resp["choices"][0]["message"]["content"]))
print("===== prompt 末尾 =====")
print(repr(it["prompt"][-150:]))
print("entry_point:", it["entry_point"])
