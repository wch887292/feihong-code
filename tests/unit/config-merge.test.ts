/**
 * 配置分层合并回归测试（loadConfigFile 字段级合并 + mergeConfigFiles 纯函数）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { mergeConfigFiles, loadConfigFile, __resetConfigForTest } from '../../src/shared/config';
import type { AppConfig, ProviderConfig } from '../../src/shared/config';

/* ---------- mergeConfigFiles 纯函数测试 ---------- */

test('mergeConfigFiles: 低优先级仅 mcp.servers + 高优先级仅 models.providers → 两者都取到', () => {
  const low: Partial<AppConfig> = {
    mcp: { servers: [{ name: 'local', command: 'npx' }] as unknown as AppConfig['mcp']['servers'] },
  };
  const high: Partial<AppConfig> = {
    models: { providers: [{ id: 'p1', type: 'ollama', baseURL: 'http://localhost:11434', tags: ['code-gen'] } as ProviderConfig] },
  };
  const merged = mergeConfigFiles([high, low]);
  assert.strictEqual(merged.mcp?.servers?.length, 1, 'mcp.servers 应取低优先级文件的值');
  assert.strictEqual(merged.mcp?.servers?.[0]?.name, 'local');
  assert.strictEqual(merged.models?.providers?.length, 1, 'models.providers 应取高优先级文件的值');
  assert.strictEqual(merged.models?.providers?.[0]?.id, 'p1');
});

test('mergeConfigFiles: 高优先级也有 models.providers → 优先取高优先级的', () => {
  const low: Partial<AppConfig> = {
    models: { providers: [{ id: 'low-p', type: 'ollama', baseURL: 'http://localhost:11434', tags: [] } as ProviderConfig] },
  };
  const high: Partial<AppConfig> = {
    models: { providers: [{ id: 'high-p', type: 'openai-compatible', baseURL: 'http://api.example.com', tags: ['code-gen'] } as ProviderConfig] },
  };
  const merged = mergeConfigFiles([high, low]);
  assert.strictEqual(merged.models?.providers?.[0]?.id, 'high-p');
});

test('mergeConfigFiles: 仅低优先级有内容 → 用低优先级的', () => {
  const high: Partial<AppConfig> = {};
  const low: Partial<AppConfig> = {
    models: {
      providers: [{ id: 'only-low', type: 'ollama', baseURL: 'http://localhost:11434', tags: ['code-gen'] } as ProviderConfig],
      defaultStrategy: 'cost',
    },
  };
  const merged = mergeConfigFiles([high, low]);
  assert.strictEqual(merged.models?.providers?.[0]?.id, 'only-low');
  assert.strictEqual(merged.models?.defaultStrategy, 'cost');
});

test('mergeConfigFiles: 单文件损坏（null）→ 跳过，用下一个有效文件', () => {
  const valid: Partial<AppConfig> = {
    models: { providers: [{ id: 'valid', type: 'ollama', baseURL: 'http://localhost:11434', tags: [] } as ProviderConfig] },
  };
  const corrupted: Partial<AppConfig> | null = null;
  const merged = mergeConfigFiles([corrupted, valid]);
  assert.strictEqual(merged.models?.providers?.[0]?.id, 'valid');
});

test('mergeConfigFiles: 全部为 null → 返回空对象', () => {
  const merged = mergeConfigFiles([null, null, null]);
  assert.deepStrictEqual(merged, {});
});

test('mergeConfigFiles: 单文件直接返回（语义等价）', () => {
  const single: Partial<AppConfig> = {
    models: { providers: [{ id: 's', type: 'ollama', baseURL: 'http://localhost:11434', tags: [] } as ProviderConfig] },
  };
  const merged = mergeConfigFiles([single]);
  assert.strictEqual(merged.models?.providers?.[0]?.id, 's');
});

test('mergeConfigFiles: 高优先级有 mcp.servers + 低优先级也有 → 取高优先级', () => {
  const low: Partial<AppConfig> = {
    mcp: { servers: [{ name: 'low-mcp', command: 'npx' }] as unknown as AppConfig['mcp']['servers'] },
  };
  const high: Partial<AppConfig> = {
    mcp: { servers: [{ name: 'high-mcp', command: 'npx' }] as unknown as AppConfig['mcp']['servers'] },
  };
  const merged = mergeConfigFiles([high, low]);
  assert.strictEqual(merged.mcp?.servers?.[0]?.name, 'high-mcp');
});

test('mergeConfigFiles: 高优先级无 models.defaultTier → 回退取低优先级的', () => {
  const low: Partial<AppConfig> = {
    models: { defaultTier: 'lite' as AppConfig['models']['defaultTier'] },
  };
  const high: Partial<AppConfig> = {
    models: { providers: [{ id: 'hp', type: 'ollama', baseURL: 'http://localhost:11434', tags: [] } as ProviderConfig] },
  };
  const merged = mergeConfigFiles([high, low]);
  assert.strictEqual(merged.models?.providers?.[0]?.id, 'hp');
  assert.strictEqual(merged.models?.defaultTier, 'lite');
});

/* ---------- loadConfigFile 集成测试（临时目录模拟多层配置） ---------- */

function setupTempConfig() {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-cfg-'));
  const homeDir = join(dir, 'home');
  const cwd = join(dir, 'cwd');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { dir, homeDir, cwd };
}

test('loadConfigFile: cwd 仅 mcp.servers + FH_HOME 仅 models.providers → 合并后两者都有', () => {
  const { dir, homeDir, cwd } = setupTempConfig();
  try {
    writeFileSync(join(cwd, 'fhcode.config.json'), JSON.stringify({
      mcp: { servers: [{ name: 'project-mcp', command: 'npx', args: ['-y', '@pkg'] }] },
    }));
    writeFileSync(join(homeDir, 'fhcode.config.json'), JSON.stringify({
      models: { providers: [{ id: 'global-p', type: 'ollama', baseURL: 'http://localhost:11434', tags: ['code-gen'] }] },
    }));

    const oldCwd = process.cwd();
    const oldFH_HOME = process.env.FH_HOME;
    const oldFH_CONFIG = process.env.FH_CONFIG;
    process.env.FH_HOME = homeDir;
    delete process.env.FH_CONFIG;
    process.chdir(cwd);

    try {
      const cfg = loadConfigFile();
      assert.ok(cfg, '应返回合并后的配置');
      assert.strictEqual(cfg!.mcp?.servers?.length, 1, 'mcp.servers 应有 1 条');
      assert.strictEqual(cfg!.mcp?.servers?.[0]?.name, 'project-mcp');
      assert.strictEqual(cfg!.models?.providers?.length, 1, 'models.providers 应有 1 条');
      assert.strictEqual(cfg!.models?.providers?.[0]?.id, 'global-p');
    } finally {
      process.chdir(oldCwd);
      if (oldFH_HOME) process.env.FH_HOME = oldFH_HOME; else delete process.env.FH_HOME;
      if (oldFH_CONFIG) process.env.FH_CONFIG = oldFH_CONFIG; else delete process.env.FH_CONFIG;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfigFile: cwd 也有 models.providers → 优先取 cwd 的', () => {
  const { dir, homeDir, cwd } = setupTempConfig();
  try {
    writeFileSync(join(cwd, 'fhcode.config.json'), JSON.stringify({
      mcp: { servers: [{ name: 'proj-mcp', command: 'npx' }] },
      models: { providers: [{ id: 'cwd-p', type: 'ollama', baseURL: 'http://localhost:11434', tags: ['code-gen'] }] },
    }));
    writeFileSync(join(homeDir, 'fhcode.config.json'), JSON.stringify({
      models: { providers: [{ id: 'home-p', type: 'openai-compatible', baseURL: 'http://api.example.com', tags: ['reasoning'] }] },
    }));

    const oldCwd = process.cwd();
    const oldFH_HOME = process.env.FH_HOME;
    process.env.FH_HOME = homeDir;
    delete process.env.FH_CONFIG;
    process.chdir(cwd);

    try {
      const cfg = loadConfigFile();
      assert.strictEqual(cfg!.models?.providers?.[0]?.id, 'cwd-p', 'providers 应取 cwd 高优先级');
      assert.strictEqual(cfg!.mcp?.servers?.[0]?.name, 'proj-mcp');
    } finally {
      process.chdir(oldCwd);
      if (oldFH_HOME) process.env.FH_HOME = oldFH_HOME; else delete process.env.FH_HOME;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfigFile: 仅 FH_HOME 文件有内容 → 用全局的', () => {
  const { dir, homeDir, cwd } = setupTempConfig();
  try {
    writeFileSync(join(homeDir, 'fhcode.config.json'), JSON.stringify({
      models: { providers: [{ id: 'home-only', type: 'ollama', baseURL: 'http://localhost:11434', tags: [] }] },
    }));

    const oldCwd = process.cwd();
    const oldFH_HOME = process.env.FH_HOME;
    process.env.FH_HOME = homeDir;
    delete process.env.FH_CONFIG;
    process.chdir(cwd);

    try {
      const cfg = loadConfigFile();
      assert.strictEqual(cfg!.models?.providers?.[0]?.id, 'home-only');
    } finally {
      process.chdir(oldCwd);
      if (oldFH_HOME) process.env.FH_HOME = oldFH_HOME; else delete process.env.FH_HOME;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfigFile: cwd 文件 JSON 损坏 → 跳过，用 FH_HOME 的', () => {
  const { dir, homeDir, cwd } = setupTempConfig();
  try {
    writeFileSync(join(cwd, 'fhcode.config.json'), '{ 损坏的 JSON !!!');
    writeFileSync(join(homeDir, 'fhcode.config.json'), JSON.stringify({
      models: { providers: [{ id: 'home-valid', type: 'ollama', baseURL: 'http://localhost:11434', tags: [] }] },
    }));

    const oldCwd = process.cwd();
    const oldFH_HOME = process.env.FH_HOME;
    process.env.FH_HOME = homeDir;
    delete process.env.FH_CONFIG;
    process.chdir(cwd);

    try {
      const cfg = loadConfigFile();
      assert.strictEqual(cfg!.models?.providers?.[0]?.id, 'home-valid');
    } finally {
      process.chdir(oldCwd);
      if (oldFH_HOME) process.env.FH_HOME = oldFH_HOME; else delete process.env.FH_HOME;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfigFile: 全部缺失/损坏 → 返回 null', () => {
  const { dir, homeDir, cwd } = setupTempConfig();
  try {
    const oldCwd = process.cwd();
    const oldFH_HOME = process.env.FH_HOME;
    process.env.FH_HOME = homeDir;
    delete process.env.FH_CONFIG;
    process.chdir(cwd);

    try {
      const cfg = loadConfigFile();
      assert.strictEqual(cfg, null, '无配置时应返回 null');
    } finally {
      process.chdir(oldCwd);
      if (oldFH_HOME) process.env.FH_HOME = oldFH_HOME; else delete process.env.FH_HOME;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfigFile: 显式 path 保持单文件语义（不合并）', () => {
  const { dir } = setupTempConfig();
  try {
    const singleFile = join(dir, 'single.json');
    writeFileSync(singleFile, JSON.stringify({
      models: { providers: [{ id: 'single', type: 'ollama', baseURL: 'http://localhost:11434', tags: [] }] },
    }));

    const oldFH_HOME = process.env.FH_HOME;
    process.env.FH_HOME = join(dir, 'nonexistent-home');
    delete process.env.FH_CONFIG;

    try {
      const cfg = loadConfigFile(singleFile);
      assert.strictEqual(cfg!.models?.providers?.[0]?.id, 'single');
    } finally {
      if (oldFH_HOME) process.env.FH_HOME = oldFH_HOME; else delete process.env.FH_HOME;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
