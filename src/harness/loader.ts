/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * harness 数据集加载器（可插拔）：
 *  - DatasetLoader 接口：任何数据集（SWE-bench / 本地 JSON / 镜像）实现该接口即可接入
 *  - SwebenchLoader：从 HuggingFace datasets-server 分页拉取（默认）或镜像/离线 JSON 加载，
 *    缓存到 ~/.feihong-code/bench/swebench-<split>.json（复刻自 scripts/eval-swebench.mjs）
 *  - LocalJsonLoader：加载任意本地/远程 JSON（数组或 { instances: [] }）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { HarnessInstance } from './types';

/** 数据集加载器契约：返回归一化后的评测实例列表 */
export interface DatasetLoader {
  readonly id: string;
  load(options?: Record<string, unknown>): Promise<HarnessInstance[]>;
}

const HF_BASE = 'https://datasets-server.huggingface.co';
const DATASETS: Record<string, { id: string; split: string }> = {
  lite: { id: 'SWE-bench/SWE-bench_Lite', split: 'test' },
  verified: { id: 'SWE-bench/SWE-bench_Verified', split: 'test' },
};

/** 归一化实例字段（容忍 HF 字符串化数组 / 缺失字段） */
export function normalizeInstance(row: Record<string, unknown>): HarnessInstance {
  const parseList = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === 'string' && v.trim()) {
      try {
        const parsed = JSON.parse(v) as unknown;
        return Array.isArray(parsed) ? parsed.map(String) : [v];
      } catch {
        return [v];
      }
    }
    return [];
  };
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    instance_id: str(row.instance_id) || 'unknown',
    repo: str(row.repo),
    base_commit: str(row.base_commit),
    problem_statement: str(row.problem_statement),
    patch: str(row.patch),
    test_patch: str(row.test_patch),
    FAIL_TO_PASS: parseList(row.FAIL_TO_PASS),
    PASS_TO_PASS: parseList(row.PASS_TO_PASS),
    created_at: str(row.created_at),
    version: str(row.version),
  };
}

function cachePath(split: string): { dir: string; file: string } {
  const dir = join(homedir(), '.feihong-code', 'bench');
  return { dir, file: join(dir, `swebench-${split}.json`) };
}

/** 从 HF datasets-server 分页拉取 rows */
async function fetchHfRows(dataset: string, split: string, offset: number, length: number): Promise<Record<string, unknown>[]> {
  const url = `${HF_BASE}/rows?dataset=${encodeURIComponent(dataset)}&config=default&split=${split}&offset=${offset}&length=${length}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'fhcode/0.5' } });
  if (!res.ok) throw new Error(`HF API HTTP ${res.status}（${url}）`);
  const data = (await res.json()) as { rows?: { row: Record<string, unknown> }[] };
  if (!Array.isArray(data.rows)) throw new Error('HF API 响应缺少 rows 字段');
  return data.rows.map((r) => r.row);
}

/** 从镜像/离线 JSON 文件加载全部实例（数组或 {instances: []} 均可） */
async function loadMirror(fileOrUrl: string): Promise<Record<string, unknown>[]> {
  const text = /^https?:\/\//i.test(fileOrUrl)
    ? await (await fetch(fileOrUrl, { headers: { 'User-Agent': 'fhcode/0.5' } })).text()
    : readFileSync(fileOrUrl, 'utf8');
  const parsed = JSON.parse(text) as unknown;
  return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : ((parsed as { instances?: Record<string, unknown>[] }).instances ?? []);
}

/** SWE-bench 数据集加载器（HF / 镜像 / 缓存） */
export class SwebenchLoader implements DatasetLoader {
  readonly id = 'swebench';

  constructor(private readonly opts: { split?: string; force?: boolean } = {}) {}

  async load(): Promise<HarnessInstance[]> {
    const split = this.opts.split ?? 'lite';
    const { dir, file } = cachePath(split);
    if (!this.opts.force && existsSync(file)) {
      try {
        const rows = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[];
        if (Array.isArray(rows)) return rows.map(normalizeInstance);
      } catch {
        /* 缓存损坏则重新拉取 */
      }
    }
    const mirror = process.env.FH_SWEBENCH_DATA_URL;
    let rows: Record<string, unknown>[];
    if (mirror) {
      rows = await loadMirror(mirror);
    } else {
      const ds = DATASETS[split];
      if (!ds) throw new Error(`未知 split: ${split}（可选 lite|verified）`);
      rows = [];
      for (let offset = 0; offset < 300; offset += 100) {
        const page = await fetchHfRows(ds.id, ds.split, offset, 100);
        rows.push(...page);
        if (page.length < 100) break;
      }
    }
    const normalized = rows.map(normalizeInstance);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(normalized), 'utf8');
    } catch {
      /* 缓存失败不影响使用 */
    }
    return normalized;
  }
}

/** 本地/远程 JSON 数据集加载器（数组或 {instances: []}），便于离线与自定义评测集 */
export class LocalJsonLoader implements DatasetLoader {
  readonly id = 'local-json';

  constructor(private readonly source: string) {}

  async load(): Promise<HarnessInstance[]> {
    const rows = await loadMirror(this.source);
    return rows.map(normalizeInstance);
  }
}
