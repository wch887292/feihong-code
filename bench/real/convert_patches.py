#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从本地接力产物重建 git diff patch v2（raw 方案，不依赖 git clone）

数据源：
  bench/real/rep_0.jsonl            —— patch_applied 实例清单
  bench/real/work/<iid>/.apply.json —— 修改的文件路径（details[].path）
  bench/real/work/<iid>/<path>      —— 应用了 SEARCH/REPLACE 后的源文件（注意可能 CRLF）
  bench/real/swebench_300.json      —— repo / base_commit

流程（每实例）：
  raw.githubusercontent.com 下载 base 版目标文件（LF）→ 读取修改后文件（归一化 LF）
  → difflib.unified_diff 生成标准 patch（--no-index 风格头）→ local_patches/<iid>.patch

patch 头格式（git apply 可吃）：
  diff --git a/<path> b/<path>
  --- a/<path>
  +++ b/<path>
  @@ ... @@
"""
import json, os, sys, argparse, urllib.request, difflib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REAL = os.path.join(ROOT, "bench", "real")
REPORT = os.path.join(REAL, "rep_0.jsonl")
WORK = os.path.join(REAL, "work")
BASE_CACHE = os.path.join(REAL, "base_files")
OUT = os.path.join(REAL, "local_patches")
INSTANCES = os.path.join(REAL, "swebench_300.json")


def raw_get(repo, commit, rel, retries=3):
    """下载 raw 文件（LF 文本），缓存到 BASE_CACHE。返回内容 bytes。"""
    cache = os.path.join(BASE_CACHE, repo.replace("/", "_"), commit, rel)
    if os.path.exists(cache):
        return open(cache, "rb").read()
    url = "https://raw.githubusercontent.com/%s/%s/%s" % (repo, commit, rel)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "feihong-bench/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            if r.status == 200 and data and b"404: Not Found" not in data:
                os.makedirs(os.path.dirname(cache), exist_ok=True)
                open(cache, "wb").write(data)
                return data
        except Exception as e:
            last = e
    raise RuntimeError("raw 下载失败 %s@%s/%s: %s" % (repo, commit[:12], rel, last))


def norm_lf(data):
    """bytes -> str，统一 LF"""
    if isinstance(data, bytes):
        data = data.decode("utf-8", errors="replace")
    return data.replace("\r\n", "\n").replace("\r", "\n")


def make_patch(rel, base_text, new_text):
    """生成 git 风格 patch"""
    diff = difflib.unified_diff(
        base_text.splitlines(keepends=True),
        new_text.splitlines(keepends=True),
        fromfile="a/%s" % rel,
        tofile="b/%s" % rel,
        lineterm="\n",
    )
    out = ["diff --git a/%s b/%s" % (rel, rel)]
    # unified_diff 已输出 --- a/... +++ b/... @@；前面补 index 行可省
    out.append("index 0000000..0000000")
    out.extend(diff)
    return "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=999999)
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(BASE_CACHE, exist_ok=True)

    meta = {}
    for inst in json.load(open(INSTANCES, encoding="utf-8")):
        meta[inst["instance_id"]] = inst

    rows = []
    for line in open(REPORT, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    seen = {}
    for r in rows:
        seen[r.get("instance_id")] = r
    applied = [r for r in seen.values() if r.get("stage") == "patch_applied"][: args.limit]
    print("patch_applied 实例: %d" % len(applied))

    ok_n, fail_n, noop_n = 0, 0, 0
    for r in applied:
        iid = r["instance_id"]
        wt = os.path.join(WORK, iid)
        applyf = os.path.join(wt, ".apply.json")
        out_patch = os.path.join(OUT, iid + ".patch")
        if os.path.exists(out_patch):
            ok_n += 1
            continue
        if not os.path.exists(applyf):
            print("  MISS apply.json: %s" % iid)
            fail_n += 1
            continue
        info = json.load(open(applyf, encoding="utf-8"))
        paths = [d["path"] for d in info.get("details", []) if d.get("ok")]
        if not paths:
            print("  NO applied path: %s" % iid)
            fail_n += 1
            continue
        inst = meta.get(iid)
        if not inst or not inst.get("base_commit"):
            print("  NO meta: %s" % iid)
            fail_n += 1
            continue
        repo = inst["repo"]
        commit = inst["base_commit"]
        try:
            hunks = []
            real_change = False
            for p in paths:
                newf = os.path.join(wt, p)
                if not os.path.exists(newf):
                    print("  MISS modified %s: %s" % (p, iid))
                    fail_n += 1
                    break
                base = norm_lf(raw_get(repo, commit, p))
                new = norm_lf(open(newf, encoding="utf-8", errors="replace").read())
                if base != new:
                    real_change = True
                hunks.append(make_patch(p, base, new))
            else:
                if not real_change:
                    print("  [NOOP 假应用] %s" % iid)
                    noop_n += 1
                    continue
                text = "\n".join(hunks)
                if not any(h.startswith("@@") for h in text.splitlines()):
                    print("  EMPTY diff: %s" % iid)
                    fail_n += 1
                    continue
                open(out_patch, "w", encoding="utf-8", newline="\n").write(text)
                ok_n += 1
                print("  [OK] %s (%d files, %d bytes)" % (iid, len(paths), len(text)))
        except Exception as e:
            print("  [FAIL] %s: %s" % (iid, str(e)[:160]))
            fail_n += 1

    print("\n完成: OK=%d FAIL=%d NOOP假应用=%d" % (ok_n, fail_n, noop_n))


if __name__ == "__main__":
    main()
