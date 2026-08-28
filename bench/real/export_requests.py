from datasets import load_dataset
import json

ds = load_dataset("princeton-nlp/SWE-bench_Verified", split="test")
req = [i for i in ds if i["repo"] == "psf/requests"]
print("requests 实例总数:", len(req))
# 取前 3 个，导出完整字段（patch 为金标准，仅作参考不用于验证）
out = []
for i in req[:3]:
    out.append({
        "instance_id": i["instance_id"],
        "repo": i["repo"],
        "base_commit": i["base_commit"],
        "problem_statement": i["problem_statement"],
        "test_patch": i["test_patch"],
        "patch": i["patch"],
        "FAIL_TO_PASS": i["FAIL_TO_PASS"],
        "PASS_TO_PASS": i["PASS_TO_PASS"],
    })
with open("bench/real/real_instances.json", "w") as f:
    json.dump(out, f, indent=2)
print("导出 real_instances.json，共", len(out), "个实例")
for o in out:
    print(" -", o["instance_id"], "| base", o["base_commit"][:12], "| FTP", len(o["FAIL_TO_PASS"]), "| PTP", len(o["PASS_TO_PASS"]))
    print("   问题摘要:", o["problem_statement"][:120].replace("\n", " "))
