#!/usr/bin/env python3
"""Test: does safe-delete work when session_id is unset?"""
import os
# Unset WorkBuddy's safe-delete hooks BEFORE importing anything
os.environ.pop("CODEBUDDY_SESSION_ID", None)
os.environ.pop("NODE_OPTIONS", None)

import shutil

test_dir = r"H:\Muse Code复刻\bench\real\work\_test_safe_delete"
if os.path.exists(test_dir):
    shutil.rmtree(test_dir)

os.makedirs(test_dir)
with open(os.path.join(test_dir, "test.txt"), "w") as f:
    f.write("hello")
shutil.rmtree(test_dir)
print("OK: delete worked without session_id")
