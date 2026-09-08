#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""修改 run_swebench.sh：将 model_patch 从 .apply.json 传递到 .status.json"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
target = os.path.join(HERE, "run_swebench.sh")

with open(target, "r", encoding="utf-8") as f:
    content = f.read()

old = '''  "$PY" -c "import json; json.dump({'resolved':$resolved,'stage':'$stage','blocks':$blocks,'applied':$patch_applied,'pytest_rc':$rc}, open('$wt/.status.json','w'), ensure_ascii=False)"'''

new = '''  "$PY" -c "import json; ap=json.load(open('$wt/.apply.json')); json.dump({'resolved':$resolved,'stage':'$stage,'blocks':$blocks,'applied':$patch_applied,'pytest_rc':$rc,'model_patch':ap.get('model_patch','')}, open('$wt/.status.json','w'), ensure_ascii=False)"'''

# 修正引号问题
new = '''  "$PY" -c "import json; ap=json.load(open('$wt/.apply.json')); json.dump({'resolved':$resolved,'stage':'$stage','blocks':$blocks,'applied':$patch_applied,'pytest_rc':$rc,'model_patch':ap.get('model_patch','')}, open('$wt/.status.json','w'), ensure_ascii=False)"'''

if old in content:
    content = content.replace(old, new, 1)
    print("Modified status.json to include model_patch")
else:
    print("WARNING: pattern not found")
    # 查找附近内容
    idx = content.find(".status.json")
    if idx >= 0:
        print("Context:", repr(content[idx-100:idx+100]))

with open(target, "w", encoding="utf-8") as f:
    f.write(content)

print("Done")
