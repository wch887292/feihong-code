/**
 * 飞虹 Code - 自我修复调度器
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 设计目标（来自产品需求）：
 * - 自我修复（环境自检 + 自进化复盘 + 记忆总结）不再在「任务运行时」触发，
 *   改为后台统一调度，避免打断正在执行的任务。
 * - 两种触发时机：
 *   1) 每晚 00:00 自动执行（scheduleSelfHeal，供常驻进程 Web 控制台 / 桌面版使用）；
 *   2) 进程启动（开机）时若当天尚未执行过，则立即补做一次（runSelfHealIfDue，即
 *      "第二天第一次开机进行修复"）。
 * - 状态持久化到 ~/.feihong-code/self-heal-state.json，保证「每天仅执行一次」。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { selfEvolveHook } from './hook';
import { summarizeMemory } from '../memory/auto-summarize';
import { logger } from '../shared/logger';

const SELF_HEAL_STATE_FILE = 'self-heal-state.json';

interface SelfHealState {
  lastDate: string; // YYYY-MM-DD
  lastRunAt: string; // ISO
  ok: boolean;
  summary: string;
}

function getStatePath(): string {
  return join(homedir(), '.feihong-code', SELF_HEAL_STATE_FILE);
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function readState(): SelfHealState | null {
  const p = getStatePath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as SelfHealState;
  } catch {
    return null;
  }
}

function writeState(s: SelfHealState): void {
  try {
    const dir = join(homedir(), '.feihong-code');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(getStatePath(), JSON.stringify(s, null, 2), 'utf-8');
  } catch (e: any) {
    logger.warn('self-heal: 无法写入状态文件', { error: e?.message });
  }
}

/** 环境自检（doctor）：复用 CLI 子命令。检测失败（非 0 退出）也视为已检测，不阻断主流程。 */
function runDoctorCheck(): string {
  try {
    const result = execSync('node dist/cli/index.js doctor', {
      encoding: 'utf-8',
      timeout: 30000,
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return (result || '').toString().trim() || '（无输出）';
  } catch (e: any) {
    return ((e?.stdout || e?.message || '').toString() || '').trim() || '（环境自检跳过/失败）';
  }
}

/** 统一自我修复流程：自进化复盘 + 环境自检 + 记忆总结，并记录当天状态。 */
export async function runSelfHeal(): Promise<SelfHealState> {
  const date = todayStr();
  console.log(`[自我修复] 开始统一自我修复 (${date})...`);
  const parts: string[] = [];

  // 1) 自进化每日复盘（整理失败库 / 经验库）
  try {
    const report = await selfEvolveHook.dailyReview();
    parts.push(`自进化复盘: 待解决 ${report?.pending ?? '?'} 项`);
  } catch (e: any) {
    parts.push(`自进化复盘: 跳过 (${e?.message})`);
  }

  // 2) 环境自检 doctor
  try {
    runDoctorCheck();
    parts.push('环境自检: 已完成');
  } catch (e: any) {
    parts.push(`环境自检: 跳过 (${e?.message})`);
  }

  // 3) 记忆总结（整理当日短期记忆）
  try {
    const r = await summarizeMemory();
    parts.push(`记忆总结: ${r.summary || (r.success ? 'ok' : r.error)}`);
  } catch (e: any) {
    parts.push(`记忆总结: 跳过 (${e?.message})`);
  }

  const state: SelfHealState = {
    lastDate: date,
    lastRunAt: new Date().toISOString(),
    ok: true,
    summary: parts.join(' | '),
  };
  writeState(state);
  console.log(`[自我修复] 完成: ${state.summary}`);
  return state;
}

/**
 * 进程启动（开机）补做：若今天尚未执行过自我修复，则立即执行一次。
 * 即「第二天第一次开机进行修复」——常驻进程（Web 控制台 / 桌面版）启动时调用。
 */
export async function runSelfHealIfDue(): Promise<SelfHealState | null> {
  const state = readState();
  if (state && state.lastDate === todayStr()) {
    console.log('[自我修复] 今日已执行，跳过开机补做');
    return null;
  }
  console.log('[自我修复] 检测到今日尚未修复，开机补做...');
  return runSelfHeal();
}

/**
 * 注册定时任务：每天 00:00 自动触发自我修复。
 * 供常驻进程（Web 控制台 / 桌面版）在启动时调用一次即可。
 */
export function scheduleSelfHeal(): void {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(async () => {
    console.log('[自我修复] 定时触发（00:00）...');
    try {
      await runSelfHeal();
    } catch (e: any) {
      logger.warn('self-heal: 定时执行异常', { error: e?.message });
    }
    // 进程跨天存活时，每分钟检查，确保每天执行一次
    setInterval(async () => {
      const n = new Date();
      if (n.getUTCHours() === 0 && n.getUTCMinutes() === 0) {
        try {
          await runSelfHeal();
        } catch (e: any) {
          logger.warn('self-heal: 定时执行异常', { error: e?.message });
        }
      }
    }, 60000);
  }, msUntilMidnight);

  console.log(`[自我修复] 将在 ${Math.round(msUntilMidnight / 1000 / 60)} 分钟后执行首次定时修复`);
}

/** 立即执行一次（手动 / 测试） */
export async function runImmediateSelfHeal(): Promise<SelfHealState> {
  return runSelfHeal();
}
