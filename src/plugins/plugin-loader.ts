/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P3-3 插件打包分发（对齐 Claude Code plugins）：
 *  - 插件 = 目录 + plugin.json 清单，打包 skills + hooks + MCP 服务器配置
 *  - 发现位置：用户级 ~/.feihong-code/plugins/<name> + 项目级 .fhcode/plugins/<name>
 *  - fhcode plugin install <source>：从本地目录复制或 git clone 安装
 *  - fhcode plugin list：列出已安装插件
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, cpSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { HookConfig } from '../runtime/hooks';
import type { McpServerConfig } from '../tools/mcp/mcp-client';
import { logger } from '../shared/logger';

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  /** 插件内技能目录（相对插件根，内含 SKILL.md） */
  skills?: string[];
  /** 插件内 hooks（合并进运行时 hooks） */
  hooks?: HookConfig[];
  /** 插件内 MCP 服务器（合并进运行时 MCP） */
  mcp?: McpServerConfig[];
}

export interface LoadedPlugins {
  /** 技能目录绝对路径列表 */
  skillDirs: string[];
  hooks: HookConfig[];
  mcp: McpServerConfig[];
  /** 已加载插件名（诊断/列表用） */
  loaded: string[];
}

/** 插件根目录（用户级） */
export function pluginRoot(): string {
  return join(homedir(), '.feihong-code', 'plugins');
}

/** 项目级插件目录 */
export function projectPluginRoot(cwd: string): string {
  return join(cwd, '.fhcode', 'plugins');
}

/** 读取单个插件清单（损坏/缺失返回 null） */
export function readPluginManifest(pluginDir: string): PluginManifest | null {
  const file = join(pluginDir, 'plugin.json');
  if (!existsSync(file)) return null;
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as PluginManifest;
    if (!manifest || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return null;
    return manifest;
  } catch {
    logger.warn('插件清单解析失败，已忽略', { dir: pluginDir });
    return null;
  }
}

/** 列出某个插件根目录下的全部插件（目录名 → 清单） */
function listPluginsIn(root: string): PluginManifest[] {
  if (!existsSync(root)) return [];
  const out: PluginManifest[] = [];
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    if (!existsSync(join(dir, 'plugin.json'))) continue;
    const manifest = readPluginManifest(dir);
    if (manifest) out.push(manifest);
  }
  return out;
}

/** 发现并加载全部插件（用户级 + 项目级），聚合 skills/hooks/mcp */
export function loadPlugins(cwd: string): LoadedPlugins {
  const roots = [pluginRoot(), projectPluginRoot(cwd)];
  const skillDirs: string[] = [];
  const hooks: HookConfig[] = [];
  const mcp: McpServerConfig[] = [];
  const loaded: string[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    for (const entry of readdirSyncSafe(root)) {
      const dir = join(root, entry);
      const manifest = readPluginManifest(dir);
      if (!manifest || seen.has(manifest.name)) continue;
      seen.add(manifest.name);
      loaded.push(manifest.name);
      for (const s of manifest.skills ?? []) {
        const abs = join(dir, s);
        if (existsSync(abs)) skillDirs.push(abs);
      }
      if (manifest.hooks) hooks.push(...manifest.hooks);
      if (manifest.mcp) mcp.push(...manifest.mcp);
    }
  }
  return { skillDirs, hooks, mcp, loaded };
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * 安装插件：
 *  - 本地目录：复制到 ~/.feihong-code/plugins/<name>
 *  - git URL（.git 结尾或含 git@）：git clone（依赖 git）
 * 安装前校验 plugin.json 存在且合法，避免装进无效目录。
 */
export async function installPlugin(source: string): Promise<{ name: string; dir: string }> {
  const destRoot = pluginRoot();
  mkdirSync(destRoot, { recursive: true });

  // 1) 校验源
  if (!source) throw new Error('缺少插件源路径（本地目录或 git URL）');
  const tmp = join(destRoot, `.tmp-install-${Date.now()}`);
  try {
    if (/\.git(\/|$)|^git@|^https?:\/\//.test(source)) {
      // git 安装
      const { spawn } = await import('child_process');
      await new Promise<void>((resolve, reject) => {
        const child = spawn('git', ['clone', '--depth', '1', source, tmp], { stdio: 'ignore' });
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git clone 失败（exit ${code}）`))));
        child.on('error', (e) => reject(new Error(`git 不可用: ${e.message}`)));
      });
    } else {
      // 本地目录复制
      if (!existsSync(source)) throw new Error(`源目录不存在: ${source}`);
      cpSync(source, tmp, { recursive: true });
    }
    // 2) 校验清单
    const manifest = readPluginManifest(tmp);
    if (!manifest) throw new Error('插件缺少合法 plugin.json（需含 name 与 version）');
    // 3) 覆盖安装（删除旧目录后移动）
    const dest = join(destRoot, manifest.name);
    rmSync(dest, { recursive: true, force: true });
    cpSync(tmp, dest, { recursive: true });
    return { name: manifest.name, dir: dest };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** 列出全部已安装插件（用于 fhcode plugin list） */
export function listPlugins(cwd: string): PluginManifest[] {
  return [...listPluginsIn(pluginRoot()), ...listPluginsIn(projectPluginRoot(cwd))];
}
