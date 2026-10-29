/**
 * 经验学习配置面（mem-exp-config）单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖纯函数契约：
 *  - defaultMemExpConfig：全关 + 默认窗口 00:00~06:00
 *  - loadMemExpConfig：文件缺失 / JSON 损坏 / 部分字段 / 合法字段
 *  - isNowWithinWindow：正常窗口 / 跨天窗口 / 边界语义（==start 入、==end 出）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  defaultMemExpConfig,
  loadMemExpConfig,
  isNowWithinWindow,
  type MemExpConfig,
} from '../../src/memory/mem-exp-config';

function tmpBaseDir(): string {
  return mkdtempSync(join(tmpdir(), 'fhcode-memexp-'));
}

/** 在 baseDir 下写入 .fhcode/mem-exp.json（content 原样写入，可为非法 JSON 以测损坏回退） */
function writeConfig(baseDir: string, content: string): void {
  const fhDir = join(baseDir, '.fhcode');
  mkdirSync(fhDir, { recursive: true });
  writeFileSync(join(fhDir, 'mem-exp.json'), content, 'utf-8');
}

function at(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function baseOverrides(o: Partial<MemExpConfig>): MemExpConfig {
  return { ...defaultMemExpConfig(), ...o };
}

test('defaultMemExpConfig 全关 + 默认窗口 00:00~06:00', () => {
  const c = defaultMemExpConfig();
  assert.equal(c.autoExperienceRetrieve, false);
  assert.equal(c.enableExperienceCollect, false);
  assert.equal(c.enableExperienceReflect, false);
  assert.equal(c.scheduledTimeStart, '00:00');
  assert.equal(c.scheduledTimeEnd, '06:00');
});

test('loadMemExpConfig：文件不存在 → 回退全关默认（向后兼容）', () => {
  const dir = tmpBaseDir();
  try {
    const c = loadMemExpConfig(dir);
    assert.deepEqual(c, defaultMemExpConfig());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadMemExpConfig：只开 retrieve（snake_case，对齐 CodeArts / example.json）', () => {
  const dir = tmpBaseDir();
  try {
    writeConfig(dir, JSON.stringify({ auto_experience_retrieve: true }));
    const c = loadMemExpConfig(dir);
    assert.equal(c.autoExperienceRetrieve, true, 'snake_case 键应生效（用户拷 example.json 即开）');
    assert.equal(c.enableExperienceCollect, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadMemExpConfig：只开 collect（camelCase 合法字段）', () => {
  const dir = tmpBaseDir();
  try {
    writeConfig(dir, JSON.stringify({ enableExperienceCollect: true }));
    const c = loadMemExpConfig(dir);
    assert.equal(c.enableExperienceCollect, true);
    assert.equal(c.autoExperienceRetrieve, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadMemExpConfig：合法 JSON 全部字段 + 部分字段合并默认', () => {
  const dir = tmpBaseDir();
  try {
    writeConfig(dir, JSON.stringify({ enableExperienceReflect: true, scheduledTimeStart: '22:00', scheduledTimeEnd: '06:00' }));
    const c = loadMemExpConfig(dir);
    assert.equal(c.enableExperienceReflect, true);
    assert.equal(c.scheduledTimeStart, '22:00');
    assert.equal(c.scheduledTimeEnd, '06:00');
    assert.equal(c.autoExperienceRetrieve, false); // 缺省补默认
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadMemExpConfig：JSON 损坏 → 回退默认，不抛错', () => {
  const dir = tmpBaseDir();
  try {
    writeConfig(dir, '{ 这不是合法 JSON ]');
    const c = loadMemExpConfig(dir);
    assert.deepEqual(c, defaultMemExpConfig());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isNowWithinWindow：正常不跨天窗口（09:00~18:00）', () => {
  const cfg = baseOverrides({ scheduledTimeStart: '09:00', scheduledTimeEnd: '18:00' });
  assert.equal(isNowWithinWindow(cfg, at('09:00')), true, '等于 start 入窗口');
  assert.equal(isNowWithinWindow(cfg, at('12:30')), true);
  assert.equal(isNowWithinWindow(cfg, at('17:59')), true);
  assert.equal(isNowWithinWindow(cfg, at('18:00')), false, '等于 end 出窗口');
  assert.equal(isNowWithinWindow(cfg, at('08:59')), false);
});

test('isNowWithinWindow：跨天窗口（22:00~06:00）', () => {
  const cfg = baseOverrides({ scheduledTimeStart: '22:00', scheduledTimeEnd: '06:00' });
  assert.equal(isNowWithinWindow(cfg, at('22:00')), true, '等于 start 入窗口');
  assert.equal(isNowWithinWindow(cfg, at('23:30')), true);
  assert.equal(isNowWithinWindow(cfg, at('00:30')), true, '跨午夜后仍在窗口内');
  assert.equal(isNowWithinWindow(cfg, at('05:59')), true);
  assert.equal(isNowWithinWindow(cfg, at('06:00')), false, '等于 end 出窗口');
  assert.equal(isNowWithinWindow(cfg, at('12:00')), false, '白天不在窗口内');
});

test('isNowWithinWindow：非法时间格式 → 返回 false（不抛错）', () => {
  const cfg = baseOverrides({ scheduledTimeStart: 'xx', scheduledTimeEnd: 'yy' });
  assert.equal(isNowWithinWindow(cfg, at('12:00')), false);
});
