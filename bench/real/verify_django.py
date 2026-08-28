"""Django 实例通用真实验证脚本（py3.8 + django 3.0 @ base_commit）
用法:
  python verify_django.py <instance_id> [--model-patch <p> | --gold]
流程: reset worktree -> 应用 test_patch -> (可选) 应用源码patch -> 跑官方 FAIL_TO_PASS
判定: 全部 FAIL_TO_PASS 通过 => RESOLVED
"""
import json, subprocess, sys, os

BASE = r"H:\Muse Code复刻\bench\real"
WORK_DIR = os.path.join(BASE, "work")
VENV38 = r"H:\Muse Code复刻\bench\real\venv38\Scripts\python"
INST = os.path.join(BASE, "django_inst.json")
WT = os.path.join(BASE, "wt_map.json")


def run(cmd, cwd, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", env=env)


def to_labels(ftp_raw):
    if isinstance(ftp_raw, str):
        ftp = json.loads(ftp_raw)
    else:
        ftp = list(ftp_raw)
    labels = []
    for t in ftp:
        if "(" in t:
            name, mod = t.split("(", 1)
            labels.append(f"{mod.rstrip(')').strip()}.{name.strip()}")
        else:
            labels.append(t)
    return labels


def main():
    if len(sys.argv) < 2:
        sys.exit("用法: verify_django.py <instance_id> [--model-patch <p> | --gold]")
    iid = sys.argv[1]
    inst = [x for x in json.load(open(INST, encoding="utf-8"))
            if x["instance_id"] == iid]
    if not inst:
        sys.exit("未找到实例: " + iid)
    inst = inst[0]

    wt = json.load(open(WT, encoding="utf-8")).get(iid) or inst.get("workdir")
    wd = os.path.join(WORK_DIR, wt)
    if not os.path.isdir(wd):
        sys.exit("工作区不存在: " + wd)

    labels = to_labels(inst["FAIL_TO_PASS"])

    # 让 import django 指向本实例 worktree
    env = dict(os.environ)
    env["PYTHONPATH"] = wd

    run(["git", "checkout", "--", "."], wd)
    run(["git", "clean", "-fd"], wd)

    tp = os.path.join(wd, "_tp.patch")
    open(tp, "w", encoding="utf-8").write(inst["test_patch"])
    r = run(["git", "apply", "_tp.patch"], wd)
    tp_ok = r.returncode == 0

    applied = "none"
    if "--gold" in sys.argv:
        gp = os.path.join(wd, "_gold.patch")
        open(gp, "w", encoding="utf-8").write(inst["patch"])
        if run(["git", "apply", "_gold.patch"], wd).returncode == 0:
            applied = "gold"
    elif "--model-patch" in sys.argv:
        p = sys.argv[sys.argv.index("--model-patch") + 1]
        if run(["git", "apply", p], wd).returncode == 0:
            applied = "model"
        elif run(["git", "apply", "--3way", p], wd).returncode == 0:
            applied = "model(3way)"
        else:
            applied = "model(FAILED)"

    cmd = [VENV38, "tests/runtests.py", "--noinput"] + labels
    r = run(cmd, wd, env)
    out = (r.stdout or "") + (r.stderr or "")

    resolved = r.returncode == 0
    print(json.dumps({
        "instance_id": iid,
        "workdir": wt,
        "test_patch_applied": tp_ok,
        "source_patch": applied,
        "fail_to_pass": labels,
        "exit_code": r.returncode,
        "resolved": resolved,
        "tail": out.strip().splitlines()[-3:] if out.strip() else [],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
