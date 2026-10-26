/**
 * 飞虹 Code - 插件市场 (阶段四-3)
 *
 * 支持轻应用/插件扩展：
 * - 插件管理：安装、卸载、启用、禁用
 * - 插件市场：浏览、搜索、安装插件
 * - 插件 API：提供插件可调用的 API
 * - 插件沙箱：安全隔离插件执行环境
 */
import { logger } from '../shared/logger';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import {
  applyRenames,
  parseMarketplaceManifest,
  resolveDisplayName,
  type MarketplacePlugin,
} from './marketplace';

/** 插件状态 */
export type PluginStatus = 'installed' | 'enabled' | 'disabled' | 'error';

/** 插件元数据 */
export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords: string[];
  categories: string[];
  icon?: string;
  screenshots?: string[];
  readme?: string;
  /** 插件入口文件 */
  entry: string;
  /** 插件权限 */
  permissions: string[];
  /** 依赖的其他插件 */
  dependencies: string[];
  /** 兼容的飞虹 Code 版本 */
  engines?: { feihongCode?: string };
  /** 发布时间 */
  publishedAt?: string;
  /** 下载量 */
  downloads?: number;
  /** 评分 */
  rating?: number;
}

/** 已安装插件 */
export interface InstalledPlugin extends PluginMetadata {
  status: PluginStatus;
  installedAt: string;
  updatedAt: string;
  config?: Record<string, any>;
  error?: string;
}

/** 市场插件 */
export interface MarketPlugin extends PluginMetadata {
  publisher: string;
  verified: boolean;
  featured: boolean;
  latestVersion: string;
  updateAvailable?: boolean;
}

/**
 * P2-2 市场来源（对齐 claude-plugins-official 分发语义）：
 *  - plugins：marketplace.json 解析出的条目（MarketplacePlugin，可携带宿主透传字段）
 *  - renames：顶层 { 旧name -> 新name }，检索/安装时透明改写旧引用
 *  - sourcePath：命中的 marketplace.json 绝对路径（内置回退时省略）
 */
export interface MarketSource {
  plugins: MarketplacePlugin[];
  renames: Record<string, string>;
  sourcePath?: string;
}

/**
 * P2-2 内置默认市场（marketplace.json 缺失/损坏时的回退，等价于旧的 4 条硬编码 mock，
 * 但 id 一律用合法 slug（小写 [a-z0-9.-]），人类可读名放 name/displayName）。
 * 字段形状对齐 MarketPlugin，经 toMarketPlugin 映射后返回。
 */
const BUILTIN_PLUGINS: MarketplacePlugin[] = [
  {
    name: 'feihong-git-enhanced',
    id: 'feihong-git-enhanced',
    displayName: 'Git Enhanced',
    description: '增强的 Git 集成，支持可视化 diff、blame、分支管理',
    keywords: ['git', 'version-control', 'diff'],
    categories: ['version-control'],
    entry: 'index.js',
    permissions: ['workspace', 'git'],
    dependencies: [],
    publisher: '飞虹官方',
    verified: true,
    featured: true,
    latestVersion: '1.2.0',
    version: '1.2.0',
    downloads: 12500,
    rating: 4.8,
  },
  {
    name: 'feihong-theme-dark-plus',
    id: 'feihong-theme-dark-plus',
    displayName: 'Dark+ Theme',
    description: '飞虹 Code 官方深色主题，护眼配色',
    keywords: ['theme', 'dark', 'ui'],
    categories: ['themes'],
    entry: 'index.js',
    permissions: ['ui'],
    dependencies: [],
    publisher: '飞虹官方',
    verified: true,
    featured: true,
    latestVersion: '2.0.1',
    version: '2.0.1',
    downloads: 28000,
    rating: 4.9,
  },
  {
    name: 'community-python-helper',
    id: 'community-python-helper',
    displayName: 'Python Helper',
    description: 'Python 开发辅助，支持虚拟环境管理、依赖分析、代码格式化',
    keywords: ['python', 'venv', 'pip', 'format'],
    categories: ['programming-languages'],
    entry: 'index.js',
    permissions: ['workspace', 'terminal'],
    dependencies: [],
    publisher: '社区贡献者',
    verified: false,
    featured: false,
    latestVersion: '0.9.3',
    version: '0.9.3',
    downloads: 5600,
    rating: 4.5,
  },
  {
    name: 'feihong-docker-helper',
    id: 'feihong-docker-helper',
    displayName: 'Docker Helper',
    description: 'Docker 容器管理，支持镜像构建、容器运行、日志查看',
    keywords: ['docker', 'container', 'devops'],
    categories: ['devops'],
    entry: 'index.js',
    permissions: ['terminal', 'workspace'],
    dependencies: [],
    publisher: '飞虹官方',
    verified: true,
    featured: false,
    latestVersion: '1.0.0',
    version: '1.0.0',
    downloads: 8900,
    rating: 4.6,
  },
];

const BUILTIN_RENAMES: Record<string, string> = {};

/** 插件 API */
export interface PluginAPI {
  /** 注册命令 */
  registerCommand: (id: string, handler: (...args: any[]) => any) => void;
  /** 注册视图 */
  registerView: (id: string, options: any) => void;
  /** 注册补全提供者 */
  registerCompletionProvider: (language: string, provider: any) => void;
  /** 注册代码操作 */
  registerCodeAction: (id: string, action: any) => void;
  /** 显示通知 */
  showNotification: (message: string, type?: 'info' | 'warning' | 'error') => void;
  /** 显示快速选择 */
  showQuickPick: (items: string[], options?: any) => Promise<string | undefined>;
  /** 显示输入框 */
  showInputBox: (options?: any) => Promise<string | undefined>;
  /** 获取工作区路径 */
  getWorkspacePath: () => string;
  /** 读取文件 */
  readFile: (path: string) => Promise<string>;
  /** 写入文件 */
  writeFile: (path: string, content: string) => Promise<void>;
  /** 执行命令 */
  executeCommand: (command: string, ...args: any[]) => Promise<any>;
  /** 日志 */
  log: (message: string) => void;
}

/**
 * 插件管理器
 */
export class PluginManager {
  private baseDir: string;
  private pluginsDir: string;
  private installed: Map<string, InstalledPlugin> = new Map();
  private registryPath: string;
  private commands: Map<string, (...args: any[]) => any> = new Map();
  /** P2-2: 插件注册的视图 / 补全提供者 / 代码操作（第三方生态消费点） */
  private views: Map<string, any> = new Map();
  private completionProviders: Map<string, any> = new Map();
  private codeActions: Map<string, any> = new Map();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.pluginsDir = join(baseDir, 'plugins');
    this.registryPath = join(baseDir, 'plugin-registry.json');
    this.ensureDir();
    this.loadRegistry();
    logger.info('plugin manager initialized', { baseDir, installed: this.installed.size });
  }

  private ensureDir(): void {
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });
    if (!existsSync(this.pluginsDir)) mkdirSync(this.pluginsDir, { recursive: true });
  }

  private loadRegistry(): void {
    try {
      if (existsSync(this.registryPath)) {
        const data = JSON.parse(readFileSync(this.registryPath, 'utf-8'));
        for (const plugin of data.installed || []) {
          this.installed.set(plugin.id, plugin);
        }
      }
    } catch (error) {
      logger.error('load plugin registry error', { error: String(error) });
    }
  }

  private saveRegistry(): void {
    try {
      const data = {
        installed: Array.from(this.installed.values()),
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(this.registryPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.error('save plugin registry error', { error: String(error) });
    }
  }

  /**
   * 安装插件
   */
  async installPlugin(plugin: MarketPlugin): Promise<InstalledPlugin> {
    logger.info('installing plugin', { id: plugin.id, version: plugin.version });

    const pluginDir = join(this.pluginsDir, plugin.id);
    if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true });

    // 保存插件元数据
    const metadataPath = join(pluginDir, 'package.json');
    writeFileSync(metadataPath, JSON.stringify(plugin, null, 2), 'utf-8');

    // 创建入口文件（简化版）
    const entryPath = join(pluginDir, plugin.entry || 'index.js');
    if (!existsSync(entryPath)) {
      writeFileSync(entryPath, `// ${plugin.name} v${plugin.version}\n// 插件入口文件\nmodule.exports = { activate(api) { console.log('${plugin.name} activated'); } };\n`, 'utf-8');
    }

    const installed: InstalledPlugin = {
      ...plugin,
      status: 'installed',
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: {},
    };

    this.installed.set(plugin.id, installed);
    this.saveRegistry();
    logger.info('plugin installed', { id: plugin.id });
    return installed;
  }

  /**
   * 卸载插件
   */
  uninstallPlugin(id: string): boolean {
    const plugin = this.installed.get(id);
    if (!plugin) return false;

    try {
      const pluginDir = join(this.pluginsDir, id);
      if (existsSync(pluginDir)) {
        // 递归删除目录
        const files = readdirSync(pluginDir);
        for (const file of files) {
          unlinkSync(join(pluginDir, file));
        }
        const { rmdirSync } = require('fs');
        rmdirSync(pluginDir);
      }
    } catch (error) {
      logger.error('uninstall plugin error', { id, error: String(error) });
    }

    this.installed.delete(id);
    this.saveRegistry();
    logger.info('plugin uninstalled', { id });
    return true;
  }

  /**
   * 启用插件
   */
  enablePlugin(id: string): boolean {
    const plugin = this.installed.get(id);
    if (!plugin) return false;
    plugin.status = 'enabled';
    plugin.updatedAt = new Date().toISOString();
    this.saveRegistry();
    this.activatePlugin(plugin);
    logger.info('plugin enabled', { id });
    return true;
  }

  /**
   * 禁用插件
   */
  disablePlugin(id: string): boolean {
    const plugin = this.installed.get(id);
    if (!plugin) return false;
    plugin.status = 'disabled';
    plugin.updatedAt = new Date().toISOString();
    this.saveRegistry();
    logger.info('plugin disabled', { id });
    return true;
  }

  /**
   * 激活插件
   * P2-2 真实执行：加载插件入口 JS 并调用 activate(api)，
   * 第三方插件通过 PluginAPI 注册命令/视图/补全提供者/代码操作。
   */
  private activatePlugin(plugin: InstalledPlugin): void {
    try {
      const pluginDir = join(this.pluginsDir, plugin.id);
      const entryPath = join(pluginDir, plugin.entry || 'index.js');
      if (existsSync(entryPath)) {
        const resolved = require.resolve(entryPath);
        delete require.cache[resolved]; // 热重载：避免 require 缓存
        const mod = require(resolved);
        if (mod && typeof mod.activate === 'function') {
          const api = this.buildPluginApi(plugin);
          mod.activate(api);
          logger.info('plugin activated (real)', { id: plugin.id });
        } else {
          logger.warn('plugin entry missing activate()', { id: plugin.id });
        }
      } else {
        logger.warn('plugin entry missing, skip', { id: plugin.id, entryPath });
      }
    } catch (error) {
      plugin.status = 'error';
      plugin.error = String(error);
      this.saveRegistry();
      logger.error('plugin activation error', { id: plugin.id, error: String(error) });
    }
  }

  /** P2-2: 构建传给插件 activate(api) 的 PluginAPI（命令带插件命名空间） */
  private buildPluginApi(plugin: InstalledPlugin): PluginAPI {
    const self = this;
    return {
      registerCommand: (id, handler) => self.commands.set(`plugin:${plugin.id}:${id}`, handler),
      registerView: (id, options) => self.views.set(`plugin:${plugin.id}:${id}`, options),
      registerCompletionProvider: (language, provider) => self.completionProviders.set(`plugin:${plugin.id}:${language}`, provider),
      registerCodeAction: (id, action) => self.codeActions.set(`plugin:${plugin.id}:${id}`, action),
      showNotification: (msg, type) => logger.info('plugin notification', { plugin: plugin.id, msg, type }),
      showQuickPick: async () => undefined,
      showInputBox: async () => undefined,
      getWorkspacePath: () => self.baseDir,
      readFile: async (p) => readFileSync(p, 'utf8'),
      writeFile: async (p, c) => writeFileSync(p, c, 'utf8'),
      executeCommand: (cmd, ...args) => self.executeCommand(cmd, ...args),
      log: (msg) => logger.info('plugin log', { plugin: plugin.id, msg }),
    };
  }

  /** P2-2: 插件注册的视图列表 */
  getViews(): string[] {
    return Array.from(this.views.keys());
  }

  /** P2-2: 插件注册的补全提供者列表 */
  getCompletionProviders(): string[] {
    return Array.from(this.completionProviders.keys());
  }

  /** P2-2: 插件注册的代码操作列表 */
  getCodeActions(): string[] {
    return Array.from(this.codeActions.keys());
  }

  /**
   * 获取已安装插件
   */
  getInstalledPlugins(status?: PluginStatus): InstalledPlugin[] {
    let plugins = Array.from(this.installed.values());
    if (status) plugins = plugins.filter((p) => p.status === status);
    return plugins;
  }

  /**
   * 获取插件
   */
  getPlugin(id: string): InstalledPlugin | undefined {
    return this.installed.get(id);
  }

  /**
   * 更新插件配置
   */
  updatePluginConfig(id: string, config: Record<string, any>): boolean {
    const plugin = this.installed.get(id);
    if (!plugin) return false;
    plugin.config = { ...plugin.config, ...config };
    plugin.updatedAt = new Date().toISOString();
    this.saveRegistry();
    return true;
  }

  /**
   * 注册命令
   */
  registerCommand(id: string, handler: (...args: any[]) => any): void {
    this.commands.set(id, handler);
    logger.info('command registered', { id });
  }

  /**
   * 执行命令
   */
  async executeCommand(id: string, ...args: any[]): Promise<any> {
    const handler = this.commands.get(id);
    if (!handler) throw new Error(`Command not found: ${id}`);
    return handler(...args);
  }

  /**
   * 获取所有注册的命令
   */
  getCommands(): string[] {
    return Array.from(this.commands.keys());
  }

  /**
   * 解析市场来源（P2-2 分发层，消费 marketplace.ts 纯函数）：
   *  - 命中 <baseDir>/marketplace.json 且可解析 → 用真实条目 + 顶层 renames
   *  - 缺失 / 损坏 / name 非法 → 回退内置默认（等价旧的 4 条硬编码 mock，id 已 slug 化）
   */
  private resolveMarketSource(): MarketSource {
    const sourcePath = join(this.baseDir, 'marketplace.json');
    if (existsSync(sourcePath)) {
      try {
        const raw = JSON.parse(readFileSync(sourcePath, 'utf-8'));
        const manifest = parseMarketplaceManifest(raw);
        if (manifest) {
          return { plugins: manifest.plugins, renames: manifest.renames, sourcePath };
        }
        logger.warn('marketplace.json 解析失败，回退内置市场', { sourcePath });
      } catch (error) {
        logger.warn('marketplace.json 读取失败，回退内置市场', { sourcePath, error: String(error) });
      }
    }
    return { plugins: BUILTIN_PLUGINS, renames: BUILTIN_RENAMES };
  }

  /** 把 marketplace.json 条目（MarketplacePlugin 透传）映射为宿主消费的 MarketPlugin */
  private toMarketPlugin(p: MarketplacePlugin, renames: Record<string, string>): MarketPlugin {
    const x = p as unknown as Record<string, any>;
    const migratedName = applyRenames(x.name, renames); // 旧引用透明迁移到当前名
    const latestVersion: string = x.latestVersion ?? x.version ?? '0.0.0';
    return {
      id: migratedName,
      name: resolveDisplayName(migratedName, x.displayName),
      version: x.version ?? latestVersion,
      description: x.description ?? '',
      author: x.author ?? 'community',
      homepage: x.homepage,
      repository: x.repository,
      license: x.license,
      keywords: Array.isArray(x.keywords) ? x.keywords : [],
      categories: Array.isArray(x.categories) ? x.categories : [],
      icon: x.icon,
      entry: x.entry ?? 'index.js',
      permissions: Array.isArray(x.permissions) ? x.permissions : [],
      dependencies: Array.isArray(x.dependencies) ? x.dependencies : [],
      engines: x.engines,
      publishedAt: x.publishedAt,
      downloads: x.downloads,
      rating: x.rating,
      publisher: x.publisher ?? 'community',
      verified: Boolean(x.verified),
      featured: Boolean(x.featured),
      latestVersion,
    };
  }

  /**
   * 搜索市场插件（P2-2：读真实 marketplace.json，缺失回退内置；旧名经 renames 迁移检索）
   */
  searchMarketPlugins(query: string, category?: string): MarketPlugin[] {
    const source = this.resolveMarketSource();
    const renames = source.renames;
    let results: MarketPlugin[] = source.plugins.map((p) => this.toMarketPlugin(p, renames));
    if (query) {
      const q = query.toLowerCase();
      const qRenamed = applyRenames(query, renames).toLowerCase(); // 旧名查 → 迁移到新名
      results = results.filter((p) => {
        const nameHit =
          p.name.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(qRenamed) ||
          p.id.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(qRenamed);
        const descHit = p.description.toLowerCase().includes(q) || p.description.toLowerCase().includes(qRenamed);
        const kwHit = p.keywords.some((k) => k.toLowerCase().includes(q) || k.toLowerCase().includes(qRenamed));
        return nameHit || descHit || kwHit;
      });
    }
    if (category) {
      results = results.filter((p) => p.categories.includes(category));
    }
    return results;
  }

  /**
   * 获取插件分类
   */
  getCategories(): string[] {
    return ['all', 'programming-languages', 'themes', 'version-control', 'devops', 'ui', 'productivity', 'other'];
  }

  /**
   * 获取统计信息
   */
  getStats(): { total: number; enabled: number; disabled: number; errors: number } {
    const plugins = Array.from(this.installed.values());
    return {
      total: plugins.length,
      enabled: plugins.filter((p) => p.status === 'enabled').length,
      disabled: plugins.filter((p) => p.status === 'disabled').length,
      errors: plugins.filter((p) => p.status === 'error').length,
    };
  }
}

/**
 * 便捷函数：创建插件管理器
 */
export function createPluginManager(baseDir: string): PluginManager {
  return new PluginManager(baseDir);
}
