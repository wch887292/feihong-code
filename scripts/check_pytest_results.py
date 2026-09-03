import json
report = 'bench/real/pytest_verification_report.jsonl'
results = [json.loads(l) for l in open(report, encoding='utf-8') if l.strip()]
passed = [r for r in results if r.get('stage') == 'pytest_passed']
failed = [r for r in results if r.get('stage') == 'pytest_failed']
patch_applied = [r for r in results if r.get('patch_applied', 0) > 0]
patch_applied_passed = [r for r in patch_applied if r.get('stage') == 'pytest_passed']
print(f'总实例数: {len(results)}')
print(f'通过: {len(passed)}')
print(f'失败: {len(failed)}')
print(f'补丁成功应用: {len(patch_applied)}')
print(f'补丁成功应用且通过: {len(patch_applied_passed)}')
print()
print('=== 通过的实例 ===')
for r in passed:
    print(f"  {r['instance_id']}: applied={r.get('patch_applied')}, passed={r.get('passed')}, failed={r.get('failed')}, errors={r.get('errors')}")
print()
print('=== 补丁成功应用的实例 ===')
for r in patch_applied:
    print(f"  {r['instance_id']}: applied={r.get('patch_applied')}, stage={r.get('stage')}, passed={r.get('passed')}, failed={r.get('failed')}, errors={r.get('errors')}")
