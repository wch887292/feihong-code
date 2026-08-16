/**
 * P5-5 轻量语义索引单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：符号提取（函数/类/接口/const/type）/ 目录扫描与跳过规则 /
 *       缓存写入与读取（根路径匹配）/ findSymbol / symbolsForFile / 统计
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  extractSymbols,
  scanDirectory,
  buildSymbolIndex,
  cacheSymbolIndex,
  loadCachedSymbolIndex,
  findSymbol,
  symbolsForFile,
  indexStats,
} from '../../src/agent/symbol-index';

test('extractSymbols: 提取函数/类/接口/const/type', () => {
  const content = [
    'export interface User { id: number }',
    'export class UserService { login() {} }',
    'export function formatName(name: string) { return name; }',
    'export const MAX_RETRY = 3;',
    'export type Id = string;',
    'const local = 1;', // 无 export 也应提取（const 模式不要求 export）
  ].join('\n');
  const symbols = extractSymbols(content, 'src/user.ts');
  const names = symbols.map((s) => `${s.kind}:${s.name}`);
  assert.ok(names.includes('interface:User'));
  assert.ok(names.includes('class:UserService'));
  assert.ok(names.includes('function:formatName'));
  assert.ok(names.includes('const:MAX_RETRY'));
  assert.ok(names.includes('type:Id'));
  assert.equal(symbols.length, 6);
  // 行号正确
  assert.equal(symbols[0].line, 1);
});

test('extractSymbols: 跳过注释行', () => {
  const content = '// export function commented() {}\n/* export class AlsoCommented {} */\nexport function real() {}';
  const symbols = extractSymbols(content, 'a.ts');
  assert.deepEqual(symbols.map((s) => s.name), ['real']);
});

test('scanDirectory: 扫描 TS 文件并跳过 node_modules/.git', () => {
  const root = mkdtempSync(join(tmpdir(), 'fhcode-idx-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export function alpha() {}');
    writeFileSync(join(root, 'src', 'b.ts'), 'export class Beta {}');
    writeFileSync(join(root, 'node_modules', 'x', 'junk.ts'), 'export function skipped() {}');
    writeFileSync(join(root, '.git', 'cfg.ts'), 'export function alsoSkipped() {}');
    const symbols = scanDirectory(root, 2000);
    const names = symbols.map((s) => s.name);
    assert.ok(names.includes('alpha'));
    assert.ok(names.includes('Beta'));
    assert.ok(!names.includes('skipped'), 'node_modules 应跳过');
    assert.ok(!names.includes('alsoSkipped'), '.git 应跳过');
    // 路径为相对路径
    assert.ok(symbols.every((s) => s.file.startsWith('src/')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cacheSymbolIndex + loadCachedSymbolIndex: 写读往返且根路径匹配', () => {
  const root = mkdtempSync(join(tmpdir(), 'fhcode-idx-'));
  const oldHome = process.env.HOME ?? '';
  process.env.HOME = join(tmpdir(), 'fhcode-idx-home-');
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export function cachedFn() {}');
    const index = buildSymbolIndex(root);
    cacheSymbolIndex(index);
    const loaded = loadCachedSymbolIndex(root);
    assert.ok(loaded);
    assert.equal(loaded.root, index.root);
    assert.ok(loaded.symbols.some((s) => s.name === 'cachedFn'));
    // 不同根路径不命中缓存
    assert.equal(loadCachedSymbolIndex(join(root, 'other')), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(join(tmpdir(), 'fhcode-idx-home-'), { recursive: true, force: true });
    process.env.HOME = oldHome;
  }
});

test('findSymbol / symbolsForFile / indexStats', () => {
  const index = {
    root: '/repo',
    builtAt: '',
    symbols: [
      { name: 'login', kind: 'function', file: 'src/auth.ts', line: 10 },
      { name: 'login', kind: 'function', file: 'src/legacy.ts', line: 3 },
      { name: 'User', kind: 'interface', file: 'src/auth.ts', line: 1 },
    ],
  };
  assert.equal(findSymbol(index, 'login').length, 2);
  assert.equal(findSymbol(index, 'nope').length, 0);
  assert.deepEqual(symbolsForFile(index, 'src/auth.ts').map((s) => s.name), ['login', 'User']);
  const stats = indexStats(index);
  assert.equal(stats.files, 2);
  assert.equal(stats.symbols, 3);
  assert.equal(stats.byKind.function, 2);
});
