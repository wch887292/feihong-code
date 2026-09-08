#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
AMD Radeon API SWE-bench 监督器（直连模式，无需本地代理）。
用法: python supervisor_amd.py <model_name>
模型: DeepSeek-V4-Flash / MiniCPM5-1B / DeepSeek-V4-Flash-Vision-Exp / Qwen3.8-Flash-Next
"""
import subprocess
import os
import time
import sys
import json
import ctypes

def _pid_alive(pid):
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if handle:
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    return False

REAL = r"H:\Muse Code复刻\bench\real"
PY = r"C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
SCRIPT = os.path.join(REAL, "run_swebench.sh")
DETACHED = 0x00000008 | 0x00000200
BASH = r"C:\Program Files\Git\bin\bash.exe"
SHARDS = [0, 150]
MAX_PER = 150
MAX_RELAUNCH = 8

# AMD Radeon API 配置
AMD_API_URL = "https://developer.amd.com.cn/radeon/api/v1/chat/completions"
AMD_API_KEY = os.environ.get("AMD_API_KEY", "")  # 脱敏：原硬编码 key 已移除，改用环境变量


def shard_pidfile(s, model):
    safe = model.replace("/", "_").replace(".", "_")
    return os.path.join(REAL, "shard_%s_%d.pid" % (safe, s))


def shard_logfile(s, model):
    safe = model.replace("/", "_").replace(".", "_")
    return os.path.join(REAL, "shard_%s_%d.log" % (safe, s))


def shard_reportfile(s, model):
    safe = model.replace("/", "_").replace(".", "_")
    return os.path.join(REAL, "rep_%s_%d.jsonl" % (safe, s))


def shard_running(s, model):
    pf = shard_pidfile(s, model)
    if not os.path.exists(pf):
        return False
    try:
        pid = int(open(pf).read().strip())
    except Exception:
        return False
    return _pid_alive(pid)


def shard_done_count(s, model):
    rep = shard_reportfile(s, model)
    if not os.path.exists(rep):
        return 0, 0
    seen = {}
    try:
        with open(rep, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                seen[r.get("instance_id")] = r
    except Exception:
        pass
    uniq = list(seen.values())
    ok = {"patch_applied", "no_patch"}
    evaluated = [r for r in uniq if r.get("stage") in ok]
    return len(uniq), len(evaluated)


def shard_complete(s, relaunch, model):
    done, evaluated = shard_done_count(s, model)
    return evaluated >= MAX_PER or relaunch >= MAX_RELAUNCH


def launch_shard(s, relaunch, model):
    env = os.environ.copy()
    env["SILICON_MODEL"] = model
    env["AGNES_PROXY_URL"] = AMD_API_URL
    env["AGNES_API_KEY"] = AMD_API_KEY
    env["REAL"] = REAL
    env["AUTO_RELAY"] = "0"
    env["CODEBUDDY_SESSION_ID"] = ""
    env["NODE_OPTIONS"] = ""
    # 报告文件路径（Windows 绝对路径，run_swebench.sh 优先使用 REPORT_FILE）
    safe = model.replace("/", "_").replace(".", "_")
    env["REPORT_FILE"] = os.path.join(REAL, "rep_%s_%d.jsonl" % (safe, s))

    log = shard_logfile(s, model)
    p = subprocess.Popen(
        [BASH, SCRIPT, str(s), str(MAX_PER)],
        cwd=REAL, env=env,
        stdout=open(log, "a"), stderr=subprocess.STDOUT,
        creationflags=DETACHED, close_fds=True,
    )
    open(shard_pidfile(s, model), "w").write(str(p.pid))
    return p.pid


def main():
    if len(sys.argv) < 2:
        print("Usage: python supervisor_amd.py <model_name>")
        print("Models: DeepSeek-V4-Flash, MiniCPM5-1B, DeepSeek-V4-Flash-Vision-Exp, Qwen3.8-Flash-Next")
        return 1

    model = sys.argv[1]
    print("=== AMD Radeon API SWE-bench Supervisor ===")
    print("Model: %s" % model)
    print("API: %s" % AMD_API_URL)
    print("Shards: %s" % SHARDS)
    print()

    relaunch = {s: 0 for s in SHARDS}
    for s in SHARDS:
        if not shard_running(s, model):
            pid = launch_shard(s, relaunch[s], model)
            relaunch[s] += 1
            print("launch shard start=%d pid=%d" % (s, pid))

    while True:
        try:
            time.sleep(5)
            all_done = True
            for s in SHARDS:
                if shard_complete(s, relaunch[s], model):
                    continue
                all_done = False
                if not shard_running(s, model):
                    try:
                        pid = launch_shard(s, relaunch[s], model)
                        relaunch[s] += 1
                        print("relaunch shard start=%d pid=%d (#%d)" % (s, pid, relaunch[s]))
                    except Exception as e:
                        print("ERROR relaunch shard %d: %s" % (s, e))
            if all_done:
                print("ALL SHARDS COMPLETE for model=%s" % model)
                # 输出汇总
                total_done = 0
                total_eval = 0
                total_resolved = 0
                for s in SHARDS:
                    done, evaluated = shard_done_count(s, model)
                    total_done += done
                    total_eval += evaluated
                    rep = shard_reportfile(s, model)
                    if os.path.exists(rep):
                        with open(rep, encoding="utf-8") as f:
                            for line in f:
                                try:
                                    r = json.loads(line.strip())
                                    if r.get("resolved"):
                                        total_resolved += 1
                                except Exception:
                                    pass
                print()
                print("=== Final Results: %s ===" % model)
                print("  Total instances: %d" % total_done)
                print("  Evaluated: %d" % total_eval)
                print("  Resolved: %d" % total_resolved)
                if total_eval > 0:
                    print("  Resolve rate: %.1f%%" % (total_resolved / total_eval * 100))
                break
        except Exception as e:
            print("SUPERVISOR LOOP ERROR: %s" % e)
            time.sleep(10)
    return 0


if __name__ == "__main__":
    sys.exit(main())

