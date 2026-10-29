/**
 * 飞虹 Code - 经验学习配置面（对标 CodeArts mem-exp-config）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 设计原则：
 *  - 默认全关，向后兼容：不配置 = 老行为（不检索/不收集/不反思）
 *  - 纯函数模块，不读写网络、不发请求
 *  - 配置文件缺失或 JSON 损坏时回退默认值，绝不抛错
 *
 * 三个开关（与 CodeArts mem-exp-config 对齐）：
 *  - auto_experience_retrieve: 任务开始前是否自动检索历史经验注入 system prompt
 *  - enable_experience_collect: 任务完成后是否自动提取并保存经验
 *  - enable_experience_reflect: 定时自我修复时是否执行记忆反思总结
 *
 * 调度窗口：
 *  - scheduled_time_start / scheduled_time_end: 反思执行的 HH:mm 窗口，支持跨天（如 22:00-06:00）
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** 经验学习配置 */
export interface MemExpConfig {
  /** 任务开始前自动检索历史经验注入 system prompt */
  autoExperienceRetrieve: boolean;
  /** 任务完成后自动提取并保存经验 */
  enableExperienceCollect: boolean;
  /** 定时自我修复时执行记忆反思总结 */
  enableExperienceReflect: boolean;
  /** 调度窗口开始（HH:mm） */
  scheduledTimeStart: string;
  /** 调度窗口结束（HH:mm） */
  scheduledTimeEnd: string;
}

/** 默认配置：全部关闭，调度窗口 00:00-06:00 */
export function defaultMemExpConfig(): MemExpConfig {
  return {
    autoExperienceRetrieve: false,
    enableExperienceCollect: false,
    enableExperienceReflect: false,
    scheduledTimeStart: '00:00',
    scheduledTimeEnd: '06:00',
  };
}

/** 配置文件名（相对 baseDir 的 .fhcode 目录） */
const CONFIG_FILENAME = 'mem-exp.json';

/**
 * 加载经验学习配置。
 * 读取 <baseDir>/.fhcode/mem-exp.json；文件缺失或 JSON 损坏一律回退默认值，绝不抛错。
 * 字段名同时兼容 snake_case（与 CodeArts mem-exp-config 对齐，如 auto_experience_retrieve）
 * 与 camelCase（如 autoExperienceRetrieve），snake_case 优先。用户直接拷 example.json
 * 即可生效，不会静默全关。
 * @param baseDir 工作区根目录，缺省用 process.cwd()
 */
export function loadMemExpConfig(baseDir?: string): MemExpConfig {
  const root = baseDir || process.cwd();
  const filePath = join(root, '.fhcode', CONFIG_FILENAME);
  if (!existsSync(filePath)) return defaultMemExpConfig();
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    const defaults = defaultMemExpConfig();
    // 取值：snake_case 优先，回退 camelCase；仅当显式为 boolean/string 才覆盖默认
    const bool = (snake: string, camel: string, fallback: boolean): boolean => {
      const v = raw[snake] ?? raw[camel];
      return typeof v === 'boolean' ? v : fallback;
    };
    const str = (snake: string, camel: string, fallback: string): string => {
      const v = raw[snake] ?? raw[camel];
      return typeof v === 'string' ? v : fallback;
    };
    return {
      autoExperienceRetrieve: bool('auto_experience_retrieve', 'autoExperienceRetrieve', defaults.autoExperienceRetrieve),
      enableExperienceCollect: bool('enable_experience_collect', 'enableExperienceCollect', defaults.enableExperienceCollect),
      enableExperienceReflect: bool('enable_experience_reflect', 'enableExperienceReflect', defaults.enableExperienceReflect),
      scheduledTimeStart: str('scheduled_time_start', 'scheduledTimeStart', defaults.scheduledTimeStart),
      scheduledTimeEnd: str('scheduled_time_end', 'scheduledTimeEnd', defaults.scheduledTimeEnd),
    };
  } catch {
    return defaultMemExpConfig();
  }
}

/**
 * 解析 "HH:mm" 为当天分钟数。
 * 非法格式返回 null（调用方应回退默认值）。
 */
function parseHhMm(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * 判定 now 是否落在 [start, end) 调度窗口内。
 * 正确处理跨天窗口（start > end 时，窗口跨越午夜）。
 * 边界语义：等于 start 算入窗口，等于 end 算出窗口。
 * @param cfg 经验学习配置
 * @param now 当前时间，缺省 new Date()
 */
export function isNowWithinWindow(cfg: MemExpConfig, now?: Date): boolean {
  const target = now || new Date();
  const startMin = parseHhMm(cfg.scheduledTimeStart);
  const endMin = parseHhMm(cfg.scheduledTimeEnd);
  if (startMin === null || endMin === null) return false;

  // 当前时间转当天分钟数
  const curMin = target.getHours() * 60 + target.getMinutes();

  if (startMin < endMin) {
    // 正常窗口：不跨天
    return curMin >= startMin && curMin < endMin;
  }
  // 跨天窗口：如 22:00-06:00，窗口 = [startMin, 24:00) ∪ [0, endMin)
  return curMin >= startMin || curMin < endMin;
}
