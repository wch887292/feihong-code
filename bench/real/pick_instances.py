from datasets import load_dataset
import json

print("Loading SWE-bench_Verified ...", flush=True)
ds = load_dataset("princeton-nlp/SWE-bench_Verified", split="test")
print("total instances:", len(ds), flush=True)

# 轻量候选 repo（依赖少、本地 venv 易装易测）
light_repos = [
    "psf/requests",
    "pallets/flask",
    "pytest-dev/pytest",
    "sphinx-doc/sphinx",
    "marshmallow-code/marshmallow",
    "pydantic/pydantic",
    "sqlalchemy/sqlalchemy",
    "django/django",
    "pydata/xarray",
    "aio-libs/yarl",
    "PGPy/PGPy",
    "WebOb/webob",
]
from collections import Counter
c = Counter(i["repo"] for i in ds)
print("\nTop 25 repos:", flush=True)
for r, n in c.most_common(25):
    print(f"  {n:3d}  {r}", flush=True)

cands = [i for i in ds if i["repo"] in light_repos]
print(f"\nLight candidates: {len(cands)}", flush=True)
# 选前若干，写出便于人工挑选
out = []
for i in cands[:12]:
    out.append({
        "instance_id": i["instance_id"],
        "repo": i["repo"],
        "base_commit": i["base_commit"],
        "FAIL_TO_PASS": i["FAIL_TO_PASS"],
        "PASS_TO_PASS": i["PASS_TO_PASS"],
        "patch_len": len(i.get("patch") or ""),
        "test_patch_len": len(i.get("test_patch") or ""),
    })
    print(f"  {i['instance_id']} | {i['repo']} | {i['base_commit'][:12]} | FTP={len(i['FAIL_TO_PASS'])}", flush=True)

with open("bench/real/light_candidates.json", "w") as f:
    json.dump(out, f, indent=2)
print("\nWrote bench/real/light_candidates.json", flush=True)
