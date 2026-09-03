/**
 * 飞虹 Code — 日志文件轮转工具（独立模块，不影响原有 logger）
 * 版本：v7.9.1
 *
 * 功能：
 * - 按大小轮转（默认 10MB）
 * - 按时间轮转（默认每天）
 * - 自动清理旧日志（保留最近 N 个文件或 N 天）
 * - 可与原有结构化 JSON logger 配合使用
 *
 * 用法：
 *   import { LogRotator } from './log-rotator';
 *   const rotator = new LogRotator({ dir: './logs', maxSize: '10m', maxFiles: 10 });
 *   rotator.write('日志内容');
 *
 * 或作为 stream 使用：
 *   const stream = rotator.createWriteStream();
 *   stream.write('日志内容\n');
 */

import * as fs from 'fs';
import * as path from 'path';

export interface LogRotatorOptions {
  /** 日志目录（默认 ./logs） */
  dir?: string;
  /** 日志文件名前缀（默认 fhcode） */
  filename?: string;
  /** 最大文件大小，支持 '10m'/'100k'/'1g'（默认 '10m'） */
  maxSize?: string;
  /** 保留的最大文件数（默认 10） */
  maxFiles?: number;
  /** 保留天数（默认 7 天） */
  maxDays?: number;
  /** 文件扩展名（默认 .log） */
  extension?: string;
}

export class LogRotator {
  private options: Required<LogRotatorOptions>;
  private currentFile: string;
  private currentSize: number = 0;
  private currentDate: string;
  private stream: fs.WriteStream | null = null;

  constructor(options: LogRotatorOptions = {}) {
    this.options = {
      dir: options.dir || './logs',
      filename: options.filename || 'fhcode',
      maxSize: options.maxSize || '10m',
      maxFiles: options.maxFiles || 10,
      maxDays: options.maxDays || 7,
      extension: options.extension || '.log'
    };

    if (!fs.existsSync(this.options.dir)) {
      fs.mkdirSync(this.options.dir, { recursive: true });
    }

    this.currentDate = this.getDateString();
    this.currentFile = this.getLogFilename();
    this.openStream();
    this.cleanup();
  }

  private getDateString(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  private getLogFilename(): string {
    return path.join(this.options.dir, `${this.options.filename}-${this.currentDate}${this.options.extension}`);
  }

  private parseSize(size: string): number {
    const match = size.match(/^(\d+(?:\.\d+)?)\s*([kmg])$/i);
    if (!match) return 10 * 1024 * 1024;
    const num = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    switch (unit) {
      case 'k': return num * 1024;
      case 'm': return num * 1024 * 1024;
      case 'g': return num * 1024 * 1024 * 1024;
      default: return 10 * 1024 * 1024;
    }
  }

  private openStream(): void {
    try {
      if (fs.existsSync(this.currentFile)) {
        this.currentSize = fs.statSync(this.currentFile).size;
      } else {
        this.currentSize = 0;
      }
      this.stream = fs.createWriteStream(this.currentFile, { flags: 'a' });
    } catch (e) {
      console.error('[LogRotator] 无法打开日志文件:', e);
      this.stream = null;
    }
  }

  private closeStream(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }

  private rotate(): void {
    this.closeStream();

    const maxSize = this.parseSize(this.options.maxSize);
    if (this.currentSize >= maxSize) {
      const rotatedFile = `${this.currentFile}.${Date.now()}`;
      try {
        if (fs.existsSync(this.currentFile)) {
          fs.renameSync(this.currentFile, rotatedFile);
        }
      } catch (e) {
        console.error('[LogRotator] 轮转失败:', e);
      }
    }

    const today = this.getDateString();
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.currentFile = this.getLogFilename();
    }

    this.currentSize = 0;
    this.openStream();
    this.cleanup();
  }

  private cleanup(): void {
    try {
      const files = fs.readdirSync(this.options.dir)
        .filter(f => f.startsWith(this.options.filename) && f.endsWith(this.options.extension))
        .map(f => ({
          name: f,
          path: path.join(this.options.dir, f),
          stat: fs.statSync(path.join(this.options.dir, f))
        }))
        .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

      if (files.length > this.options.maxFiles) {
        files.slice(this.options.maxFiles).forEach(f => {
          try { fs.unlinkSync(f.path); } catch (e) { /* ignore */ }
        });
      }

      const maxAge = this.options.maxDays * 24 * 60 * 60 * 1000;
      const now = Date.now();
      files.forEach(f => {
        if (now - f.stat.mtime.getTime() > maxAge) {
          try { fs.unlinkSync(f.path); } catch (e) { /* ignore */ }
        }
      });
    } catch (e) {
      // 清理失败不影响日志记录
    }
  }

  /** 写入日志内容 */
  write(content: string): void {
    if (!this.stream) return;

    const line = content.endsWith('\n') ? content : content + '\n';

    const today = this.getDateString();
    const maxSize = this.parseSize(this.options.maxSize);
    if (today !== this.currentDate || this.currentSize + line.length > maxSize) {
      this.rotate();
    }

    try {
      this.stream.write(line);
      this.currentSize += line.length;
    } catch (e) {
      // 写入失败不抛出
    }
  }

  /** 创建可写流（用于 pipe） */
  createWriteStream(): fs.WriteStream | null {
    return this.stream;
  }

  /** 手动触发清理 */
  forceCleanup(): void {
    this.cleanup();
  }

  /** 获取当前日志文件路径 */
  getCurrentFile(): string {
    return this.currentFile;
  }

  /** 获取当前日志文件大小 */
  getCurrentSize(): number {
    return this.currentSize;
  }

  /** 列出所有日志文件 */
  listFiles(): Array<{ name: string; size: number; mtime: Date }> {
    try {
      return fs.readdirSync(this.options.dir)
        .filter(f => f.startsWith(this.options.filename))
        .map(f => {
          const stat = fs.statSync(path.join(this.options.dir, f));
          return { name: f, size: stat.size, mtime: stat.mtime };
        })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    } catch (e) {
      return [];
    }
  }

  /** 关闭轮转器 */
  close(): void {
    this.closeStream();
  }
}

/** 便捷函数：创建默认轮转器 */
export function createLogRotator(options?: LogRotatorOptions): LogRotator {
  return new LogRotator(options);
}
