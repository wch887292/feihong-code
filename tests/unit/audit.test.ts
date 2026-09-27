/**
 * 审计哈希链单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：record 链式写入（seq 连续 / prevHash 衔接）/ verifyAudit 完整校验 /
 *       篡改检测（删记录 / 改内容）/ 脱敏写入 / 跨实例续链
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AuditLog, verifyAudit, readAudit, redact } from '../../src/enterprise/audit';

function sampleInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 't1',
    userId: 'u1',
    role: 'developer',
    runId: 'r1',
    action: 'tool:write_file',
    resource: 'src/a.ts',
    decision: 'allow',
    reason: '策略放行',
    ...overrides,
  };
}

test('record: 连续写入形成 seq 递增 + prevHash 衔接的哈希链', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-audit-'));
  try {
    const log = new AuditLog(dir);
    log.record(sampleInput());
    log.record(sampleInput({ action: 'tool:run_shell' }));
    log.record(sampleInput({ action: 'session:start' }));

    assert.equal(log.count, 3);
    const records = readAudit(dir);
    assert.equal(records.length, 3);
    assert.deepEqual(records.map((r) => r.seq), [1, 2, 3]);
    assert.equal(records[0].prevHash, '0'.repeat(64), '首条 prevHash 应为创世哈希');
    assert.equal(records[1].prevHash, records[0].hash, '后一条 prevHash 必须衔接前一条 hash');
    assert.equal(records[2].prevHash, records[1].hash);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyAudit: 未被篡改时完整通过', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-audit-'));
  try {
    const log = new AuditLog(dir);
    for (let i = 0; i < 5; i++) log.record(sampleInput({ action: `action-${i}` }));
    const result = verifyAudit(dir);
    assert.equal(result.ok, true);
    assert.equal(result.total, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyAudit: 删除中间记录（seq 不连续）被检出', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-audit-'));
  try {
    const log = new AuditLog(dir);
    for (let i = 0; i < 3; i++) log.record(sampleInput({ action: `action-${i}` }));

    // 删除第 2 条（伪造删除记录）
    const file = readdirSync(dir).find((f) => f.endsWith('.jsonl'));
    assert.ok(file);
    const lines = readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean);
    writeFileSync(join(dir, file), lines[0] + '\n' + lines[2], 'utf8');

    const result = verifyAudit(dir);
    assert.equal(result.ok, false, 'seq 不连续必须被检出');
    assert.match(result.detail ?? '', /序号不连续/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyAudit: 篡改记录内容（hash 不自洽）被检出', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-audit-'));
  try {
    const log = new AuditLog(dir);
    log.record(sampleInput());
    log.record(sampleInput({ action: 'tool:run_shell' }));

    const file = readdirSync(dir).find((f) => f.endsWith('.jsonl'));
    assert.ok(file);
    const lines = readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean);
    const rec = JSON.parse(lines[1]);
    rec.resource = 'src/evil.ts'; // 篡改内容但不重算 hash
    writeFileSync(join(dir, file), lines[0] + '\n' + JSON.stringify(rec) + '\n', 'utf8');

    const result = verifyAudit(dir);
    assert.equal(result.ok, false, '内容被篡改必须被检出');
    assert.match(result.detail ?? '', /hash 不自洽|被篡改/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('record: 新实例从磁盘续链（跨进程恢复 seq/prevHash）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-audit-'));
  try {
    const log1 = new AuditLog(dir);
    log1.record(sampleInput());
    log1.record(sampleInput());

    // 模拟另一个进程：基于同一目录新建实例，应续接 seq=3
    const log2 = new AuditLog(dir);
    log2.record(sampleInput({ action: 'session:end' }));
    assert.equal(log2.count, 3);

    const records = readAudit(dir);
    assert.equal(records.length, 3);
    assert.equal(records[2].seq, 3);
    assert.equal(records[2].prevHash, records[1].hash, '续链必须衔接原链尾');
    assert.equal(verifyAudit(dir).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('redact: 敏感信息在写入前被脱敏', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-audit-'));
  try {
    const log = new AuditLog(dir);
    log.record(sampleInput({ resource: 'apiKey=sk-abc123secret' }));
    const records = readAudit(dir);
    assert.ok(!records[0].resource.includes('sk-abc123secret'), '审计不得泄漏密钥原文');
    assert.ok(records[0].resource.includes('***'), '应保留脱敏标记');
    assert.equal(redact('Bearer tok12345 rest'), 'Bearer *** rest');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('withAuditLock: 残留 stale 锁（挂死进程遗留）应被自动清理，写入自愈', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-audit-lock-'));
  try {
    // 模拟挂死进程遗留的锁：写入一个无效 PID，并把 mtime 回拨 30s（远超 10s stale 阈值）
    const lockPath = join(dir, '.audit.lock');
    writeFileSync(lockPath, '999999999');
    const past = new Date(Date.now() - 30_000);
    utimesSync(lockPath, past, past);

    // 写入应清理 stale 锁并成功落盘，而不是抛"审计写入锁等待超时"
    const log = new AuditLog(dir);
    const rec = log.record(sampleInput());
    assert.equal(rec.seq, 1, 'stale 锁被清理后应成功写入 seq=1');

    // 锁文件不应残留（被 unlink 或 rename 挪开）
    const leftover = readdirSync(dir).filter((f) => f === '.audit.lock');
    assert.equal(leftover.length, 0, 'stale 锁应已被清理');

    // 后续写入不受影响
    log.record(sampleInput({ action: 'tool:run_shell' }));
    assert.equal(readAudit(dir).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
