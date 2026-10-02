/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 最小 cron 引擎（v8.6.0 P3 · T3.1）：
 * - 五字段：分 时 日 月 周（支持 * / 数字 / 列表 / 范围 a-b / 步进 a-b/n 与 *​/n）
 * - 宏：@hourly @daily（按需扩展）
 * - nextCronRun：从 from 严格向后逐分钟扫描（上限一年），本地时区语义
 * - dom 与 dow 同时显式指定时采用标准 cron 的 OR 语义
 */
export interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  doms: Set<number>;
  months: Set<number>;
  dows: Set<number>;
  domWildcard: boolean;
  dowWildcard: boolean;
}

const MACROS: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
};

function expandField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`cron 步进非法: "${part}"`);
    }
    let lo: number;
    let hi: number;
    if (rangePart === '*') {
      lo = min;
      hi = max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-').map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < min || b > max || a > b) {
        throw new Error(`cron 范围非法: "${part}"（允许 ${min}-${max}）`);
      }
      lo = a;
      hi = b;
    } else {
      const v = Number(rangePart);
      if (!Number.isInteger(v) || v < min || v > max) {
        throw new Error(`cron 数值非法: "${part}"（允许 ${min}-${max}）`);
      }
      lo = v;
      hi = stepPart ? max : v;
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  if (out.size === 0) throw new Error('cron 字段为空');
  return out;
}

/** 解析五字段 cron（周字段 0 与 7 均视为周日） */
export function parseCron(expr: string): CronFields {
  const normalized = (MACROS[expr.trim().toLowerCase()] ?? expr).trim();
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron 应为 5 个字段（分 时 日 月 周）: "${expr}"`);
  }
  const dowRaw = expandField(parts[4], 0, 7);
  const dows = new Set<number>([...dowRaw].map((d) => (d === 7 ? 0 : d)));
  return {
    minutes: expandField(parts[0], 0, 59),
    hours: expandField(parts[1], 0, 23),
    doms: expandField(parts[2], 1, 31),
    months: expandField(parts[3], 1, 12),
    dows,
    domWildcard: parts[2] === '*',
    dowWildcard: parts[4] === '*',
  };
}

/** 某一时刻（分钟精度）是否命中 */
export function cronMatches(f: CronFields, d: Date): boolean {
  if (!f.months.has(d.getMonth() + 1)) return false;
  if (!f.hours.has(d.getHours())) return false;
  if (!f.minutes.has(d.getMinutes())) return false;
  const domHit = f.doms.has(d.getDate());
  const dowHit = f.dows.has(d.getDay());
  if (f.domWildcard && f.dowWildcard) return true;
  if (f.domWildcard) return dowHit;
  if (f.dowWildcard) return domHit;
  return domHit || dowHit;
}

/**
 * 计算 from 之后（严格大于，分钟精度）的下一次触发时间。
 * 逐分钟扫描，上限四年（覆盖「下一个 2 月 29」的最长间隔），超出返回 null。
 */
export function nextCronRun(expr: string, from: Date, maxScanMinutes = 4 * 366 * 24 * 60): Date | null {
  const f = parseCron(expr);
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < maxScanMinutes; i++) {
    if (cronMatches(f, d)) return new Date(d.getTime());
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}
