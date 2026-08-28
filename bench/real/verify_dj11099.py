"""django-11099 真实验证脚本（py3.8 + django 3.0 @ base_commit）
用法: python verify_dj11099.py [--model-patch <path>] [--gold]
1) reset worktree 到 base_commit
2) 应用 test_patch（新增 FAIL_TO_PASS 断言）
3) 可选应用 模型patch / gold patch
4) 用 venv38 跑官方 FAIL_TO_PASS 测试，判定 resolved
"""
import json, subprocess, sys, os

WORKDIR = r"H:\Muse Code复刻\bench\real\work\dj_11099"
VENV38 = r"H:\Muse Code复刻\bench\real\venv38\Scripts\python"
INST = r"H:\Muse Code复刻\bench\real\django_inst.json"
IID = "django__django-11099"

def run(cmd, cwd=WORKDIR):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")

def main():
    inst = [x for x in json.load(open(INST, encoding="utf-8"))
            if x["instance_id"] == IID][0]

    ftp_raw = inst["FAIL_TO_PASS"]
    if isinstance(ftp_raw, str):
        ftp = json.loads(ftp_raw)
    else:
        ftp = list(ftp_raw)

    # 转成 django runtests 的 test label
    labels = []
    for t in ftp:
        # "test_ascii_validator (auth_tests.test_validators.UsernameValidatorsTests)"
        if "(" in t:
            name, mod = t.split("(", 1)
            mod = mod.rstrip(")").strip()
            labels.append(f"{mod}.{name.strip()}")
        else:
            labels.append(t)
    print("FAIL_TO_PASS labels:", labels)

    # 1) reset
    run(["git", "checkout", "--", "."])
    run(["git", "clean", "-fd"])
    print("[1] worktree reset to base")

    # 2) 应用 test_patch
    tp = os.path.join(WORKDIR, "_tp.patch")
    open(tp, "w", encoding="utf-8").write(inst["test_patch"])
    r = run(["git", "apply", "-v", "_tp.patch"])
    print("[2] test_patch applied:", r.returncode, r.stderr.strip()[:200])

    # 3) 可选应用 patch
    if "--gold" in sys.argv:
        gp = os.path.join(WORKDIR, "_gold.patch")
        open(gp, "w", encoding="utf-8").write(inst["patch"])
        r = run(["git", "apply", "-v", "_gold.patch"])
        print("[3] GOLD patch applied:", r.returncode, r.stderr.strip()[:200])
    elif "--model-patch" in sys.argv:
        p = sys.argv[sys.argv.index("--model-patch") + 1]
        r = run(["git", "apply", "-v", p])
        print("[3] MODEL patch applied:", r.returncode, r.stderr.strip()[:200])
        if r.returncode != 0:
            print("    patch 应用失败，尝试 -p1 --3way")
            r = run(["git", "apply", "--3way", "-v", p])
            print("    3way:", r.returncode, r.stderr.strip()[:200])
    else:
        print("[3] 无源码 patch（base 基线）")

    # 4) 跑测试
    cmd = [VENV38, "tests/runtests.py", "--noinput"] + labels
    print("[4] 运行:", " ".join(cmd[-3:]))
    r = run(cmd)
    out = r.stdout + r.stderr
    print("EXIT:", r.returncode)
    print("--- 关键行 ---")
    for line in out.splitlines():
        if any(k in line for k in ("OK", "FAILED", "Ran ", "Error", "error",
                                   "Traceback", "AssertionError", "Testing against")):
            print("  ", line.strip()[:160])
    print("=== RESULT:", "PASS" if r.returncode == 0 else "FAIL", "===")

if __name__ == "__main__":
    main()
