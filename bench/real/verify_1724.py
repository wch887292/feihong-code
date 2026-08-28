import json, subprocess, os, sys

REAL = 'H:/Muse Code复刻/bench/real'
VENV38 = 'H:/Muse Code复刻/bench/real/venv38/Scripts/python.exe'
wd = 'H:/Muse Code复刻/bench/real/work/rt_1724'
inst = [x for x in json.load(open(REAL + '/real_instances.json')) if x['instance_id'] == 'psf__requests-1724'][0]

# 复位工作区
subprocess.run(['git', 'checkout', '--', '.'], cwd=wd)
subprocess.run(['git', 'clean', '-fd'], cwd=wd)

# 应用 test_patch（新增/修改测试）
tp_path = os.path.join(wd, 'tp.patch')
open(tp_path, 'w').write(inst['test_patch'])
r = subprocess.run(['git', 'apply', 'tp.patch'], cwd=wd, capture_output=True, text=True)
print('test_patch apply rc=', r.returncode, r.stderr[:200], flush=True)

# 是否应用模型 patch
apply_model = os.environ.get('APPLY_MODEL') == '1'
if apply_model:
    mp = REAL + '/patches/psf__requests-1724.patch'
    if os.path.exists(mp) and os.path.getsize(mp) > 0:
        r2 = subprocess.run(['git', 'apply', mp], cwd=wd, capture_output=True, text=True)
        print('model patch apply rc=', r2.returncode, r2.stderr[:200], flush=True)
    else:
        print('NO model patch file', flush=True)

# 跑 FAIL_TO_PASS（数据集里可能是 JSON 字符串）
ftp = inst['FAIL_TO_PASS']
if isinstance(ftp, str):
    ftp = json.loads(ftp)
cmd = [VENV38, '-m', 'pytest', '-v', '--no-header', '-p', 'no:cacheprovider'] + ftp
print('RUN:', ' '.join(cmd), flush=True)
res = subprocess.run(cmd, cwd=wd, capture_output=True, text=True, timeout=500)
print('PYTEST rc=', res.returncode, flush=True)
print('--- STDOUT ---', flush=True)
print(res.stdout[-3500:], flush=True)
print('--- STDERR ---', flush=True)
print(res.stderr[-1500:], flush=True)
