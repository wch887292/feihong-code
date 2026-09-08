#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""修复 run_swebench.sh 的 curl Authorization header 问题"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
target = os.path.join(HERE, "run_swebench.sh")

with open(target, "r", encoding="utf-8") as f:
    content = f.read()

old = '''    # 调 API（直连时需 Authorization header；走本地代理时代理自动注入）
    auth_header=""
    [ -n "$KEY" ] && auth_header="-H \\"Authorization: Bearer $KEY\\""
    http_code=$(curl -s --connect-timeout 10 --max-time 160 -X POST "$API" \\
      -H "Content-Type: application/json" \\
      $auth_header \\
      --data-binary "@$pl" \\
      -o "$resp" -w "%{http_code}")'''

new = '''    # 调 API（直连时需 Authorization header；走本地代理时代理自动注入）
    curl_args=(-s --connect-timeout 10 --max-time 160 -X POST "$API"
      -H "Content-Type: application/json"
      --data-binary "@$pl"
      -o "$resp" -w "%{http_code}")
    [ -n "$KEY" ] && curl_args=(-H "Authorization: Bearer $KEY" "${curl_args[@]}")
    http_code=$(curl "${curl_args[@]}")'''

if old in content:
    content = content.replace(old, new, 1)
    print("Replaced curl call with array-based approach")
else:
    print("Pattern not found! Trying to find the curl section...")
    # Find the curl section
    idx = content.find("auth_header=")
    if idx >= 0:
        print(f"Found auth_header at position {idx}")
        print("Context:", repr(content[idx:idx+200]))
    else:
        print("auth_header not found")
        # Maybe it was already modified? Check for curl_args
        if "curl_args=" in content:
            print("curl_args already present - already fixed?")
        else:
            print("Neither auth_header nor curl_args found")

with open(target, "w", encoding="utf-8") as f:
    f.write(content)

print("Done")
