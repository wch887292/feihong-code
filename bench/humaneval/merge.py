# -*- coding: utf-8 -*-
import json, os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))

def load(p):
    out = {}
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line:
                r = json.loads(line)
                out[r["task_id"]] = r
    return out

first = load(os.path.join(HERE, "results.jsonl"))
retry = load(os.path.join(HERE, "retry_results.jsonl"))

# 第一轮里 api 失败的, 用重跑结果覆盖; 其余保留
merged = dict(first)
for tid, r in retry.items():
    merged[tid] = r  # 重跑的都是原 api 失败题, 直接覆盖

# 加载题目总数
items = [json.loads(l) for l in open(os.path.join(HERE,"HumanEvalPlus.jsonl"), encoding="utf-8") if l.strip()]
total = len(items)

phase = Counter(r["phase"] for r in merged.values())
passed = sum(1 for r in merged.values() if r["passed"])
covered = len(merged)

print("题目总数:", total)
print("有结果记录:", covered)
print("仍缺记录:", [i["task_id"] for i in items if i["task_id"] not in merged])
print("通过 PASS:", passed)
print("pass@1 = %.1f%%" % (passed/total*100))
print("按阶段分布:", dict(phase))

# 列出通过的题
print("\n通过题目:")
for tid in sorted([tid for tid,r in merged.items() if r["passed"]]):
    print("  ", tid)

# 存合并结果
with open(os.path.join(HERE,"merged_results.jsonl"),"w",encoding="utf-8") as f:
    for tid in sorted(merged):
        f.write(json.dumps(merged[tid], ensure_ascii=False)+"\n")

summary = {
    "model": "agnes-3.0-flash",
    "benchmark": "HumanEval+ (evalplus, 164 题)",
    "pass@1": round(passed/total*100, 1),
    "passed": passed,
    "total": total,
    "phase_distribution": dict(phase),
    "temperature": 0,
}
json.dump(summary, open(os.path.join(HERE,"summary.json"),"w",encoding="utf-8"), ensure_ascii=False, indent=2)
print("\nsummary.json 已写")
