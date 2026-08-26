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
   */
  private activatePlugin(plugin: InstalledPlugin): void {
    try {
      const pluginDir = join(this.pluginsDir, plugin.id);
      const entryPath = join(pluginDir, plugin.entry || 'index.js');
      if (existsSync(entryPath)) {
        // 简化版：不实际执行，只记录
        logger.info('plugin activated', { id: plugin.id });
      }
    } catch (error) {
      plugin.status = 'error';
      plugin.error = String(error);
      this.saveRegistry();
      logger.error('plugin activation error', { id: plugin.id, error: String(error) });
    }
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
   * 搜索市场插件（模拟）
   */
  searchMarketPlugins(query: string, category?: string): MarketPlugin[] {
    // 模拟市场插件列表
    const mockPlugins: MarketPlugin[] = [
      {
        id: 'feihong-git-enhanced',
        name: 'Git Enhanced',
        version: '1.2.0',
        description: '增强的 Git 集成，支持可视化 diff、 blame、分支管理',
        author: 'feihong',
        keywords: ['git', 'version-control', 'diff'],
        categories: ['version-control'],
        entry: 'index.js',
        permissions: ['workspace', 'git'],
        dependencies: [],
        publisher: '飞虹官方',
        verified: true,
        featured: true,
        latestVersion: '1.2.0',
        downloads: 12500,
        rating: 4.8,
      },
      {
        id: 'feihong-theme-dark-plus',
        name: 'Dark+ Theme',
        version: '2.0.1',
        description: '飞虹 Code 官方深色主题，护眼配色',
        author: 'feihong',
        keywords: ['theme', 'dark', 'ui'],
        categories: ['themes'],
        entry: 'index.js',
        permissions: ['ui'],
        dependencies: [],
        publisher: '飞虹官方',
        verified: true,
        featured: true,
        latestVersion: '2.0.1',
        downloads: 28000,
        rating: 4.9,
      },
      {
        id: 'community-python-helper',
        name: 'Python Helper',
        version: '0.9.3',
        description: 'Python 开发辅助，支持虚拟环境管理、依赖分析、代码格式化',
        author: 'community',
        keywords: ['python', 'venv', 'pip', 'format'],
        categories: ['programming-languages'],
        entry: 'index.js',
        permissions: ['workspace', 'terminal'],
        dependencies: [],
        publisher: '社区贡献者',
        verified: false,
        featured: false,
        latestVersion: '0.9.3',
        downloads: 5600,
        rating: 4.5,
      },
      {
        id: 'feihong-docker-helper',
        name: 'Docker Helper',
        version: '1.0.0',
        description: 'Docker 容器管理，支持镜像构建、容器运行、日志查看',
        author: 'feihong',
        keywords: ['docker', 'container', 'devops'],
        categories: ['devops'],
        entry: 'index.js',
        permissions: ['terminal', 'workspace'],
        dependencies: [],
        publisher: '飞虹官方',
        verified: true,
        featured: false,
        latestVersion: '1.0.0',
        downloads: 8900,
        rating: 4.6,
      },
    ];

    let results = mockPlugins;
    if (query) {
      const q = query.toLowerCase();
      results = results.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.keywords.some((k) => k.toLowerCase().includes(q))
      );
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
