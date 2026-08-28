// P0-1 官方 SWE-bench Verified 评估链路验证
// 完整 500 任务实测需 Docker + 官方数据源（本机不可达），此处验证：
// 1) 官方 JSON 格式经 LocalJsonLoader + normalizeInstance 正确加载
// 2) FAIL_TO_PASS（含字符串化数组容错）正确解析
// 3) TestVerifier 以 FAIL_TO_PASS 为测试目标（npm test -- 用例）
// 4) sanitizeManagedCommand 对测试命令的受管约束
import { readFileSync } from 'fs';
import { join } from 'path';
import { LocalJsonLoader } from '../dist/harness/loader.js';
import { TestVerifier, FileExistsVerifier } from '../dist/harness/verifier.js';
import { sanitizeManagedCommand } from '../dist/tools/shell/exec.js';

let pass = 0, fail = 0, fails = [];
function report(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`); }
}

(async () => {
  const root = process.cwd();
  console.log('===== P0-1 官方 SWE-bench Verified 评估链路验证 =====');

  // 1) 官方格式加载（不硬编码 instance_id/repo，只校验 schema 与最小结构）
  const samplePath = join(root, 'bench/swe-bench-verified-sample.json');
  const loader = new LocalJsonLoader(samplePath);
  const instances = await loader.load();
  report('官方 JSON 加载', instances.length >= 1, `count=${instances.length}`);

  if (instances.length > 0) {
    const inst = instances[0];
    report('instance_id 字段存在', !!inst.instance_id && typeof inst.instance_id === 'string', inst.instance_id);
    report('repo 字段存在', !!inst.repo && typeof inst.repo === 'string', inst.repo);
    report('base_commit 字段存在', !!inst.base_commit && typeof inst.base_commit === 'string', inst.base_commit ? `${inst.base_commit.length} chars` : '');
    report('problem_statement 字段存在', !!inst.problem_statement && typeof inst.problem_statement === 'string', inst.problem_statement ? `${inst.problem_statement.length} chars` : '');
    report('patch 字段存在（含真实内容非 placeholder）', !!inst.patch && !String(inst.patch).startsWith('*'), `len=${(inst.patch||'').length}`);
    report('test_patch 字段存在', !!inst.test_patch, `len=${(inst.test_patch||'').length}`);
    // FAIL_TO_PASS 容错（支持字符串化数组或原生数组两种形态）
    const ftp0 = inst.FAIL_TO_PASS;
    const ftpArr = Array.isArray(ftp0) ? ftp0 : (typeof ftp0 === 'string' ? JSON.parse(ftp0) : []);
    report('FAIL_TO_PASS 为可解析列表', ftpArr.length >= 1, `len=${ftpArr.length}`);
    if (instances.length >= 2) {
      const ftp1 = instances[1].FAIL_TO_PASS;
      report('第二实例 FAIL_TO_PASS 可解析', Array.isArray(ftp1) && ftp1.length >= 1, `len=${ftp1.length}`);
    }
    const ptp0 = inst.PASS_TO_PASS;
    report('PASS_TO_PASS 可解析', Array.isArray(ptp0), `len=${ptp0?.length ?? 0}`);
  }

  // 2) TestVerifier / FileExistsVerifier 接口
  const tv = new TestVerifier();
  report('TestVerifier 接口存在', typeof tv.verify === 'function');
  const fv = new FileExistsVerifier();
  report('FileExistsVerifier 接口存在', typeof fv.verify === 'function');

  // 3) 受管命令约束
  if (instances.length > 0) {
    const ftp = Array.isArray(instances[0].FAIL_TO_PASS)
      ? instances[0].FAIL_TO_PASS
      : (typeof instances[0].FAIL_TO_PASS === 'string' ? JSON.parse(instances[0].FAIL_TO_PASS) : []);
    if (ftp.length > 0) {
      const cmd = sanitizeManagedCommand(undefined, `npm test -- ${ftp.join(' ')}`);
      report('FAIL_TO_PASS 拼入测试命令', cmd === `npm test -- ${ftp.join(' ')}`, cmd);
    }
  }
  const bad = sanitizeManagedCommand(undefined, 'rm -rf / && npm test');
  report('受管命令约束拦截恶意命令', bad === null || !bad.includes('rm -rf'));

  // 4) 数据源诚实记录
  console.log('\n  ⚠️ 环境受限记录（如实）：');
  console.log('     - docker 守护进程未运行 → 无法跑官方 eval 镜像（FAIL_TO_PASS/PASS_TO_PASS 真实评测）');
  console.log('     - 本环境已通过 Python 3.8 venv 重建依赖，可在无 Docker 下对部分实例做本地验证');
  console.log('     - 格式样本已替换为 HuggingFace 官方数据集真实实例（见 bench/swe-bench-verified-sample.json）');

  console.log(`\n========== P0-1 冒烟结果 ==========`);
  console.log(`  通过: ${pass}  失败: ${fail}`);
  if (fails.length) { console.log('  失败项:'); fails.forEach((f) => console.log('    - ' + f)); }
  else { console.log('  ✅ 全部通过'); }
  process.exit(fail > 0 ? 1 : 0);
})();
