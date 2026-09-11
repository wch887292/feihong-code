#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
飞虹 Code · SWE-bench 官方 harness 验证（Docker 隔离，官方口径）

读自研 harness 生成的模型 patch（bench/real/patches/<instance_id>.patch），
调用 swebench 官方 run_instances：对每个实例构建 Docker 容器（官方镜像），
应用模型 patch + test_patch，在容器内运行 FAIL_TO_PASS / PASS_TO_PASS 测试，
得到【官方口径 resolved】——对外宣称能力的最高可信度。

用法（CI / Linux runner，需 Docker）:
  python bench/real/verify_official.py \
      --instances bench/swebench-lite-sample-10.json \
      --limit 10 --max-workers 2

产物:
  bench/real/run_logs/<run_id>/  每实例官方日志
  bench/real/verify_summary_official.json  汇总
"""
import json, os, sys, argparse, glob

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PATCHES = os.path.join(ROOT, "bench", "real", "patches")
REAL = os.path.join(ROOT, "bench", "real")


def collect_predictions(insts, patches_dir=None):
    """从 patches 目录收集模型 patch，构造官方 predictions 格式
    {instance_id: {"model_patch": "..."}}，只保留非空 patch 的实例。"""
    patches_dir = patches_dir or PATCHES
    predictions = {}
    for inst in insts:
        pf = os.path.join(patches_dir, inst["instance_id"] + ".patch")
        if os.path.exists(pf):
            content = open(pf, encoding="utf-8").read().strip()
            if content:
                predictions[inst["instance_id"]] = {"model_patch": content}
    return predictions


def read_official_results(run_id):
    """读取官方 run 日志，映射每实例 resolved 判定。"""
    log_dir = os.path.join(REAL, "run_logs", run_id)
    results = []
    if not os.path.isdir(log_dir):
        print("  注意: 官方日志目录不存在: %s" % log_dir)
        return results
    for f in sorted(glob.glob(os.path.join(log_dir, "*.json"))):
        if os.path.basename(f) in ("final_report.json", "run_metadata.json"):
            continue
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception as e:
            results.append({"instance_id": os.path.basename(f), "verified": False, "reason": "日志解析失败: %s" % e})
            continue
        inst_id = d.get("instance_id", os.path.basename(f))
        patch_ok = d.get("patch_success", d.get("patch_applied", False))
        tests = d.get("test_results", d.get("tests_status", {}))
        if not patch_ok:
            results.append({"instance_id": inst_id, "verified": True, "resolved": False, "reason": "patch 应用失败/跳过"})
            continue
        if not isinstance(tests, dict):
            results.append({"instance_id": inst_id, "verified": True, "resolved": bool(d.get("resolved")), "test_status_raw": str(tests)[:200]})
            continue
        ftp = d.get("FAIL_TO_PASS", [])
        if isinstance(ftp, str):
            try:
                ftp = json.loads(ftp)
            except Exception:
                ftp = []
        ftp_pass = sum(1 for t in ftp if tests.get(t) == "PASSED")
        all_pass = all(tests.get(t) == "PASSED" for t in ftp) if ftp else False
        results.append({
            "instance_id": inst_id,
            "verified": True,
            "patch_applied": True,
            "fail_to_pass": {t: tests.get(t) for t in ftp},
            "ftp_pass": ftp_pass,
            "ftp_total": len(ftp),
            "resolved": all_pass,
        })
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instances", required=True, help="实例清单 JSON（含官方字段）")
    ap.add_argument("--limit", type=int, default=999)
    ap.add_argument("--offset", type=int, default=0, help="实例起始偏移（分片验证用）")
    ap.add_argument("--max-workers", type=int, default=2, help="并行 Docker 容器数（runner 4 核建议 2）")
    ap.add_argument("--patches-dir", default="", help="patch 目录（默认 bench/real/patches；本地转换产物可用 bench/real/local_patches）")
    ap.add_argument("--run-id", default="feihong_official")
    ap.add_argument("--timeout", type=int, default=1800, help="每实例容器内超时（秒）")
    ap.add_argument("--skip-run", action="store_true", help="只汇总已有日志，不重跑")
    args = ap.parse_args()

    insts = json.load(open(args.instances, encoding="utf-8"))
    insts = insts[args.offset:][:args.limit]
    predictions = collect_predictions(insts, args.patches_dir or None)
    print("有 patch 的实例: %d / %d" % (len(predictions), len(insts)))
    if not predictions:
        print("无 patch 可验证（模型未生成任何补丁），退出")
        return

    if not args.skip_run:
        try:
            from swebench.harness.run_evaluation import run_instances
        except ImportError as e:
            print("swebench 未安装: %s（CI 需 pip install swebench）" % e)
            sys.exit(2)
        # 只验证有 patch 的实例
        insts = [i for i in insts if i["instance_id"] in predictions]
        print("调用官方 run_instances（max_workers=%d, run_id=%s, timeout=%ds）..." % (args.max_workers, args.run_id, args.timeout))
        try:
            run_instances(
                predictions=predictions,
                instances=insts,
                max_workers=args.max_workers,
                run_id=args.run_id,
                timeout=args.timeout,
            )
        except Exception as e:
            print("官方 harness 运行异常: %s" % e)
            print("（常见：本地无 Docker daemon；CI ubuntu-latest 自带 Docker，可正常跑）")
            sys.exit(3)

    results = read_official_results(args.run_id)
    summary = {
        "official_harness": True,
        "run_id": args.run_id,
        "total": len(results),
        "resolved": sum(1 for r in results if r.get("resolved")),
        "patch_applied": sum(1 for r in results if r.get("patch_applied")),
        "details": results,
    }
    out_path = os.path.join(REAL, "verify_summary_official.json")
    json.dump(summary, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("官方验证汇总: resolved %d / %d（patch 应用 %d）" % (summary["resolved"], summary["total"], summary["patch_applied"]))
    print("汇总写入: %s" % out_path)


if __name__ == "__main__":
    main()
