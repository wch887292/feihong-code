# -*- coding: utf-8 -*-
import ssl, json, urllib.request, urllib.error, os
KEY = os.environ["AMD_KEY"]
ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE

def try_url(url, payload):
    headers = {"Authorization":"Bearer "+KEY, "Content-Type":"application/json"}
    data = json.dumps(payload).encode()
    r = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=60, context=ctx) as resp:
            print("OK", url, "->", resp.read().decode()[:400])
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, url)
        print("  body:", e.read().decode()[:500])
    except Exception as e:
        print("ERR", url, "->", e)

body = {
  "model": "DeepSeek-V4-Flash",
  "messages": [{"role":"user","content":"def add(a,b): return"}],
  "temperature": 0.0, "max_tokens": 50,
}
for url in [
  "https://developer.amd.com.cn/radeon/api/v1/chat/completions",
  "https://developer.amd.com.cn/radeon/api/chat/completions",
  "https://developer.amd.com.cn/radeon/api/v1/completions",
]:
    try_url(url, body)
    print()
