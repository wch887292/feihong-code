/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 仓库理解器（M7）：
 * - 目录结构分析
 * - 模块依赖关系
 * - 架构文档自动生成
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface RepoStructure {
  root: string;
  directories: DirectoryNode[];
  files: FileNode[];
  packageJson?: { name: string; version: string; dependencies: Record<string, string> };
}

export interface DirectoryNode {
  name: string;
  path: string;
  children: DirectoryNode[];
  fileCount: number;
}

export interface FileNode {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

/** 分析仓库结构 */
export function analyzeRepo(rootDir: string, maxDepth: number = 3): RepoStructure {
  const structure: RepoStructure = {
    root: rootDir,
    directories: [],
    files: [],
  };

  const collect = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          const child: DirectoryNode = {
            name: entry,
            path: fullPath,
            children: [],
            fileCount: 0,
          };
          collect(fullPath, depth + 1);
          structure.directories.push(child);
        } else if (entry.endsWith('.ts') || entry.endsWith('.json')) {
          const fileNode: FileNode = {
            name: entry,
            path: fullPath,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          };
          structure.files.push(fileNode);
        }
      }
    } catch {
      // 跳过无法访问的目录
    }
  };

  collect(rootDir, 0);

  // 加载 package.json
  const pkgPath = join(rootDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      structure.packageJson = {
        name: pkg.name || 'unknown',
        version: pkg.version || '0.0.0',
        dependencies: pkg.dependencies || {},
      };
    } catch { /* ignore */ }
  }

  return structure;
}

/** 生成架构文档摘要 */
export function generateArchitectureSummary(structure: RepoStructure): string {
  const lines: string[] = [
    `# 仓库架构摘要`,
    ``,
    `**根目录**: ${structure.root}`,
    `**目录数**: ${structure.directories.length}`,
    `**文件数**: ${structure.files.length}`,
    ``,
  ];

  if (structure.packageJson) {
    lines.push(`## 项目信息`);
    lines.push(`- 名称: ${structure.packageJson.name}`);
    lines.push(`- 版本: ${structure.packageJson.version}`);
    lines.push(`- 依赖数: ${Object.keys(structure.packageJson.dependencies).length}`);
    lines.push('');
  }

  lines.push(`## 目录结构`);
  lines.push('```');
  for (const dir of structure.directories.slice(0, 20)) {
    lines.push(`📁 ${dir.name}/ (${dir.fileCount} 文件)`);
  }
  lines.push('```');
  lines.push('');

  lines.push(`## 文件统计`);
  const tsFiles = structure.files.filter(f => f.name.endsWith('.ts')).length;
  const jsonFiles = structure.files.filter(f => f.name.endsWith('.json')).length;
  lines.push(`- TypeScript: ${tsFiles} 文件`);
  lines.push(`- JSON: ${jsonFiles} 文件`);
  lines.push('');

  return lines.join('\n');
}

/** 分析模块依赖（基于 import 语句） */
export function analyzeModuleDependencies(dirPath: string): Record<string, string[]> {
  const deps: Record<string, string[]> = {};
  const { readdirSync, statSync, readFileSync } = require('fs');
  const { join } = require('path');

  const scan = (dir: string) => {
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          scan(fullPath);
        } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
          const content = readFileSync(fullPath, 'utf8');
          const imports = content.match(/from\s+['"][^'"]+['"]/g) || [];
          const modulePath = fullPath.replace(dirPath + '/', '');
          deps[modulePath] = imports.map((i: string) => i.replace(/from\s+['"]/g, '').replace(/['"]/g, ''));
        }
      }
    } catch { /* skip */ }
  };

  scan(dirPath);
  return deps;
}
