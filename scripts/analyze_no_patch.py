import json, os
report = 'bench/real/swebench_report.jsonl'
seen = {}
for line in open(report, encoding='utf-8'):
    line = line.strip()
    if not line: continue
    try: r = json.loads(line)
    except: continue
    seen[r.get('instance_id')] = r
no_patch = [iid for iid, r in seen.items() if r.get('stage') == 'no_patch']
patch_applied_fail = []
for iid, r in seen.items():
    if r.get('stage') == 'patch_applied':
        wt = os.path.join('bench/real/work', iid)
        apply_file = os.path.join(wt, '.apply.json')
        if os.path.exists(apply_file):
            apply = json.load(open(apply_file, encoding='utf-8'))
            if apply.get('applied', 0) == 0:
                patch_applied_fail.append(iid)

print(f'no_patch 实例数: {len(no_patch)}')
print(f'patch_applied 但应用失败的实例数: {len(patch_applied_fail)}')
print()

# 检查 no_patch 实例的 apply.json
print('=== no_patch 实例的 apply.json ===')
for iid in no_patch[:5]:
    wt = os.path.join('bench/real/work', iid)
    apply_file = os.path.join(wt, '.apply.json')
    print(f'\n{iid}:')
    if os.path.exists(apply_file):
        apply = json.load(open(apply_file, encoding='utf-8'))
        print(f'  blocks={apply.get("blocks")}, applied={apply.get("applied")}, ok={apply.get("ok")}')
        for d in apply.get('details', []):
            print(f'  {d.get("path")}: ok={d.get("ok")}, reason={d.get("reason")}')
    else:
        print('  无 .apply.json')

# 分析 no_patch 实例的响应内容
print('\n=== no_patch 实例响应分析 ===')
refuse_keywords = ['mismatch', 'not in', 'does not contain', 'not actually', 'however', 'unable', 'cannot', 'not relevant']
for iid in no_patch[:10]:
    wt = os.path.join('bench/real/work', iid)
    resp_file = os.path.join(wt, '.resp.json')
    if os.path.exists(resp_file):
        resp = json.load(open(resp_file, encoding='utf-8'))
        content = resp['choices'][0]['message']['content'].lower()
        has_search = '<<<<<<< SEARCH' in content or '<<< SEARCH' in content
        refuse = any(kw in content for kw in refuse_keywords)
        print(f'{iid}: has_search={has_search}, refuse={refuse}, len={len(content)}')
