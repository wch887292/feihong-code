# -*- coding: utf-8 -*-
import ssl, json, urllib.request, os
BASE = "https://developer.amd.com.cn/radeon/api/v1"
KEY = os.environ["AMD_KEY"]
ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE

def req(path, payload=None):
    url = BASE + path
    headers = {"Authorization":"Bearer "+KEY, "Content-Type":"application/json"}
    data = json.dumps(payload).encode() if payload else None
    r = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(r, timeout=60, context=ctx) as resp:
        return json.loads(resp.read().decode())

print("===== /models =====")
try:
    m = req("/models")
    for x in m.get("data", []):
        print("  ", x.get("id"))
except Exception as e:
    print("models 失败:", e)

print("\n===== 冒烟补全 (DeepSeek-V4-Flash) =====")
body = {
  "model": "DeepSeek-V4-Flash",
  "messages": [
    {"role":"system","content":"You are a Python code completion engine. Output ONLY the indented function body, no signature, no explanation, no markdown."},
    {"role":"user","content":"from typing import List\n\ndef mean_absolute_deviation(numbers: List[float]) -> float:\n    \"\"\" Mean Absolute Deviation around mean. \"\"\"\n"}
  ],
  "temperature": 0.0,
  "max_tokens": 200,
}
try:
    r = req("/chat/completions", body)
    print("finish:", r["choices"][0].get("finish_reason"))
    print("content:", repr(r["choices"][0]["message"].get("content")))
    print("usage:", r.get("usage"))
except Exception as e:
    print("chat 失败:", e)
