/**
 * SPEC 意图图谱模块 - 对标 JetBrains ThinkRail 的 SPEC.md 事实源机制
 *
 * 公司：晋江市飞虹智科技企业管理有限公司
 * 中心：飞扬企源研发中心
 * 负责人：吴赐虹
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';

/** SPEC.md frontmatter 类型 */
interface SpecFrontmatter {
  id: string;
  title?: string;
  parent?: string;
  deps?: string[];
  status?: 'draft' | 'active' | 'deprecated' | 'archived';
  [key: string]: unknown;
}

/** SPEC 节点类型 */
interface SpecNode {
  file: string;
  frontmatter: SpecFrontmatter;
  body: string;
  summary: string;
}

/** 发现结果 */
interface DiscoveryResult {
  nodes: Map<string, SpecNode>;
  files: string[];
}

/** specGrep 返回结果 */
interface GrepResult {
  nodeIds: string[];
  hits: Array<{ nodeId: string; field: string; match: string }>;
}

/** specValidate 返回问题 */
interface ValidationIssue {
  fileId: string;
  nodeId: string;
  message: string;
}

/** specUpdate 参数 */
interface UpdateOptions {
  id: string;
  updates: Partial<SpecFrontmatter>;
}

/** 递归发现所有 SPEC.md 文件 */
function discoverSpecFiles(cwd: string, baseDir?: string): string[] {
  const dir = resolve(baseDir || cwd);
  const files: string[] = [];
  
  try {
    if (!existsSync(dir)) {
      return files;
    }
    
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !entry.name.includes('node_modules')) {
          files.push(...discoverSpecFiles(cwd, path));
        }
      } else if (entry.isFile() && entry.name === 'SPEC.md') {
        files.push(path);
      }
    }
  } catch {
    // 目录读取失败跳过
  }
  
  return files;
}

/** 解析 YAML frontmatter */
function parseFrontmatter(content: string): { frontmatter: Partial<SpecFrontmatter>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  
  const fmLines = match[1].trim().split('\n');
  const frontmatter: Partial<SpecFrontmatter> = {};
  
  for (const line of fmLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();
      
      // 处理数组
      if (value.startsWith('[') && value.endsWith(']')) {
        const arrStr = value.slice(1, -1);
        frontmatter[key as keyof SpecFrontmatter] = arrStr
          .split(',')
          .map((s: string) => s.trim().replace(/['"]/g, ''))
          .filter((s: string) => s.length > 0);
      } else {
        frontmatter[key as keyof SpecFrontmatter] = value.replace(/^['"]|['"]$/g, '') || undefined;
      }
    }
  }
  
  return { frontmatter, body: match[2] };
}

/** 生成摘要（取标题 + 前 200 字符正文） */
function generateSummary(node: SpecNode): string {
  const title = node.frontmatter.title || 'Untitled';
  const bodyPreview = node.body.slice(0, 200).replace(/\n/g, ' ').trim();
  return `${title}: ${bodyPreview}`;
}

/** 导出：discoverSpecs */
export function discoverSpecs(cwd: string): DiscoveryResult {
  const files = discoverSpecFiles(cwd);
  const nodes = new Map<string, SpecNode>();
  
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(content);
      
      if (frontmatter.id) {
        const node: SpecNode = {
          file,
          frontmatter: frontmatter as SpecFrontmatter,
          body,
          summary: generateSummary({ file, frontmatter: frontmatter as SpecFrontmatter, body, summary: '' })
        };
        nodes.set(frontmatter.id, node);
      }
    } catch {
      // 读取失败跳过
    }
  }
  
  return { nodes, files };
}

/** 导出：specGrep */
export function specGrep(nodes: Map<string, SpecNode>, keyword: string): GrepResult {
  const result: GrepResult = { nodeIds: [], hits: [] };
  const kw = keyword.toLowerCase();
  
  for (const [id, node] of nodes.entries()) {
    const fieldsToCheck = [
      { field: 'title', text: node.frontmatter.title || '' },
      { field: 'status', text: node.frontmatter.status || '' },
      { field: 'body', text: node.body },
    ];
    
    for (const { field, text } of fieldsToCheck) {
      if (text.toLowerCase().includes(kw)) {
        result.nodeIds.push(id);
        result.hits.push({ nodeId: id, field, match: text.slice(0, 100) });
        break;
      }
    }
  }
  
  return result;
}

/** 导出：specGraph */
export function specGraph(nodes: Map<string, SpecNode>): string {
  const lines: string[] = ['SPEC 意图图谱'];
  lines.push('='.repeat(40));
  
  // 构建父子关系
  const children = new Map<string, string[]>();
  for (const [id, node] of nodes.entries()) {
    const parent = node.frontmatter.parent;
    if (parent) {
      if (!children.has(parent)) {
        children.set(parent, []);
      }
      children.get(parent)!.push(id);
    }
  }
  
  // 找根节点并遍历：parent 为空 或 parent 在图谱中不存在（孤儿节点）的，一律当根打印，避免意图丢失
  const rootIds = Array.from(nodes.keys()).filter((id) => {
    const p = nodes.get(id)!.frontmatter.parent;
    return !p || !nodes.has(p);
  });
  
  function printTree(rootId: string, indent: number = 0) {
    const node = nodes.get(rootId)!;
    const prefix = '  '.repeat(indent);
    const status = node.frontmatter.status || 'draft';
    lines.push(`${prefix}📄 ${rootId} [${status}]`);
    lines.push(`${prefix}   📝 ${node.frontmatter.title || '无标题'}`);
    
    const deps = node.frontmatter.deps || [];
    if (deps.length > 0) {
      lines.push(`${prefix}   🔗 依赖：${deps.join(', ')}`);
    }
    
    const kids = children.get(rootId) || [];
    for (const childId of kids) {
      printTree(childId, indent + 1);
    }
  }
  
  for (const rootId of rootIds) {
    printTree(rootId);
  }
  
  return lines.join('\n');
}

/** 导出：specValidate */
export function specValidate(nodes: Map<string, SpecNode>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  
  for (const [id, node] of nodes.entries()) {
    // id 必填检查
    if (!node.frontmatter.id) {
      issues.push({
        fileId: node.file,
        nodeId: id,
        message: '缺少必填字段 id'
      });
    }
    
    // parent 引用检查
    const parent = node.frontmatter.parent;
    if (parent && !nodes.has(parent)) {
      issues.push({
        fileId: node.file,
        nodeId: id,
        message: `parent 引用的 id "${parent}" 不存在`
      });
    }
    
    // deps 引用检查
    const deps = node.frontmatter.deps || [];
    for (const depId of deps) {
      if (!nodes.has(depId)) {
        issues.push({
          fileId: node.file,
          nodeId: id,
          message: `deps 引用的 id "${depId}" 不存在`
        });
      }
    }
  }
  
  return issues;
}

/** 导出：specUpdate */
export function specUpdate(cwd: string, options: UpdateOptions): { ok: boolean; message: string } {
  const { id, updates } = options;
  const { nodes } = discoverSpecs(cwd);
  
  const node = nodes.get(id);
  if (!node) {
    // 节点不存在，创建空骨架（写到 specs/<id>/SPEC.md，保证 discoverSpecs 可发现）
    const dir = join(cwd, 'specs', id);
    const newFile = join(dir, 'SPEC.md');
    const newContent = `---\nid: ${id}\ntitle: ${updates.title || 'New Spec'}\nstatus: draft\n---\n\n# ${updates.title || id}\n\n`;
    
    try {
      const fs = require('fs');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(newFile, newContent, 'utf-8');
      return { ok: true, message: `已创建新 SPEC: ${newFile}` };
    } catch (e: unknown) {
      return { ok: false, message: `创建失败：${String(e)}` };
    }
  }
  
  // 更新 frontmatter
  const newFm: SpecFrontmatter = { ...node.frontmatter, ...updates };
  const fmLines: string[] = [`id: ${newFm.id}`];
  
  if (newFm.title) fmLines.push(`title: ${newFm.title}`);
  if (newFm.parent) fmLines.push(`parent: ${newFm.parent}`);
  if (newFm.status) fmLines.push(`status: ${newFm.status}`);
  if (newFm.deps && newFm.deps.length > 0) {
    fmLines.push(`deps: [${newFm.deps.join(', ')}]`);
  }
  
  const newContent = `---\n${fmLines.join('\n')}\n---\n${node.body}`;
  
  try {
    const fs = require('fs');
    fs.writeFileSync(node.file, newContent, 'utf-8');
    return { ok: true, message: `已更新 SPEC: ${node.file}` };
  } catch (e: unknown) {
    return { ok: false, message: `更新失败：${String(e)}` };
  }
}
