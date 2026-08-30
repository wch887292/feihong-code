#!/usr/bin/env python3
"""Debug script to reproduce the worktree add issue"""
import subprocess
import os
from pathlib import Path

ROOT = Path('H:\\Muse Code复刻').resolve()
WORK_DIR = ROOT / "bench" / "real" / "work"
REPO_PATH = WORK_DIR / "astropy_repo"
BASE_COMMIT = "d16bfe05a744909de4b27f5875fe0d4ed41ce607"
WT_NAME = "test_wt_12907"
WT_PATH = WORK_DIR / WT_NAME

print(f"ROOT: {ROOT}")
print(f"REPO_PATH: {REPO_PATH}")
print(f"WT_PATH: {WT_PATH}")
print(f"WT_PATH exists: {WT_PATH.exists()}")
print()

# Test 1: git -C with list args (no shell)
print("=== Test 1: git -C with list args ===")
r = subprocess.run(
    ["git", "-C", str(REPO_PATH), "worktree", "add", "-q", str(WT_PATH), BASE_COMMIT],
    capture_output=True, text=True
)
print(f"returncode: {r.returncode}")
print(f"stderr: {r.stderr[:300]}")
print(f"stdout: {r.stdout[:200]}")
if WT_PATH.exists():
    print(f"worktree created at {WT_PATH}")
    # cleanup
    subprocess.run(["git", "-C", str(REPO_PATH), "worktree", "remove", "--force", str(WT_PATH)], capture_output=True)
print()

# Test 2: shell=True with cwd
print("=== Test 2: shell=True + cwd=root ===")
cmd = f'git -C "{REPO_PATH}" worktree add -q "{WT_PATH}" "{BASE_COMMIT}"'
print(f"cmd: {cmd[:100]}...")
r = subprocess.run(cmd, shell=True, cwd=str(ROOT), capture_output=True, text=True)
print(f"returncode: {r.returncode}")
print(f"stderr: {r.stderr[:300]}")
print(f"stdout: {r.stdout[:200]}")
if WT_PATH.exists():
    subprocess.run(["git", "-C", str(REPO_PATH), "worktree", "remove", "--force", str(WT_PATH)], capture_output=True)
print()

# Test 3: shell=True with cwd=None (like the script)
print("=== Test 3: shell=True + cwd=None ===")
r = subprocess.run(cmd, shell=True, cwd=None, capture_output=True, text=True)
print(f"returncode: {r.returncode}")
print(f"stderr: {r.stderr[:300]}")
print(f"stdout: {r.stdout[:200]}")
if WT_PATH.exists():
    subprocess.run(["git", "-C", str(REPO_PATH), "worktree", "remove", "--force", str(WT_PATH)], capture_output=True)
print()

# Test 4: Check if the existing stale worktrees cause issues
print("=== Test 4: Check for stale worktrees ===")
r = subprocess.run(["git", "-C", str(REPO_PATH), "worktree", "list", "--porcelain"],
                   capture_output=True, text=True)
print(r.stdout[:500])
