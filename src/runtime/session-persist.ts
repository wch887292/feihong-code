/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 会话检查点持久化（M3 恢复与审计）：
 * - 每次迭代后把完整对话、迭代计数、成本、被改动文件落盘为 <runId>.session.json
 * - resume 读取检查点续跑；sessions 列出历史；diff/rollback 依赖 touchedFiles
 */
import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { RunId } from '../shared/types';
import type { ChatMessage } from '../models/model.interface';

export type SessionStatus = 'running' | 'done' | 'crashed';

export interface SessionCheckpoint {
  runId: RunId;
  goal: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  iterations: number;
  costUsd: number;
  /** 完整对话（含 system/plan/assistant/tool），resume 直接重建 */
  messages: ChatMessage[];
  /** 本会话中被文件类工具创建/修改的相对路径（run_shell 创建的不保证覆盖） */
  touchedFiles: string[];
}

/** 检查点落盘（文件名固定，便于 list/load） */
export async function saveCheckpoint(logDir: string, cp: SessionCheckpoint): Promise<void> {
  await mkdir(logDir, { recursive: true });
  const file = join(logDir, `${cp.runId}.session.json`);
  await writeFile(file, JSON.stringify(cp, null, 2), 'utf8');
}

export async function loadCheckpoint(logDir: string, runId: RunId): Promise<SessionCheckpoint | null> {
  const file = join(logDir, `${runId}.session.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as SessionCheckpoint;
  } catch {
    return null;
  }
}

export async function listCheckpoints(logDir: string): Promise<SessionCheckpoint[]> {
  if (!existsSync(logDir)) return [];
  const files = (await readdir(logDir)).filter((f) => f.endsWith('.session.json'));
  const out: SessionCheckpoint[] = [];
  for (const f of files) {
    try {
      const cp = JSON.parse(await readFile(join(logDir, f), 'utf8')) as SessionCheckpoint;
      if (cp && cp.runId) out.push(cp);
    } catch {
      /* 跳过损坏文件 */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function updateStatus(logDir: string, runId: RunId, status: SessionStatus): Promise<void> {
  const cp = await loadCheckpoint(logDir, runId);
  if (!cp) return;
  cp.status = status;
  cp.updatedAt = new Date().toISOString();
  await saveCheckpoint(logDir, cp);
}
