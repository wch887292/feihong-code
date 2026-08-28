import json, sys
from datasets import load_dataset

ds = load_dataset("princeton-nlp/SWE-bench_Verified", split="test")
target = "django__django-11099"
recs = [r for r in ds if r["instance_id"] == target]
print("found:", len(recs))
if not recs:
    sys.exit("instance not found")

# 导出该实例 + 另取几个 2019-2021 django 实例作候选
django_ids = [r["instance_id"] for r in ds if r["instance_id"].startswith("django__django-")]
candidates = [r for r in ds if r["instance_id"] in django_ids[50:60]]  # 取中段，偏新

out = recs + candidates
clean = []
for r in out:
    clean.append({
        "instance_id": r["instance_id"],
        "repo": r["repo"],
        "base_commit": r["base_commit"],
        "patch": r["patch"],
        "test_patch": r["test_patch"],
        "FAIL_TO_PASS": r["FAIL_TO_PASS"],
        "PASS_TO_PASS": r["PASS_TO_PASS"][:5],
        "problem_statement": r["problem_statement"][:1500],
        "version": r.get("version", ""),
    })
json.dump(clean, open("bench/real/django_inst.json", "w"), indent=2)
for r in clean:
    print(r["instance_id"], "| base:", r["base_commit"][:12], "| FTP:", r["FAIL_TO_PASS"][:2])
