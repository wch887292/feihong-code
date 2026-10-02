# -*- coding: utf-8 -*-
import ssl, json, urllib.request, os
ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
req = urllib.request.Request("https://developer.amd.com.cn/radeon/api/v1/models",
    headers={"Authorization":"Bearer "+os.environ["AMD_KEY"]})
with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
    m = json.loads(r.read().decode())
print(json.dumps(m, indent=2, ensure_ascii=False)[:2000])
