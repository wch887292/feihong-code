/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P5-6 消息渠道（对齐 OpenClaw 的"多渠道消息接入"，此处作为调度通知出口）：
 *  - Telegram 机器人：FH_CHANNEL_TELEGRAM_BOT_TOKEN + FH_CHANNEL_TELEGRAM_CHAT_ID
 *  - 企业微信群机器人：FH_CHANNEL_WECOM_KEY（逗号分隔可多个）
 *  - 任务状态变化时把紧凑消息推送到已启用渠道
 *
 * 设计：
 *  - 零依赖（全局 fetch + AbortController 超时），fire-and-forget 容错
 *  - 未配置渠道 = 无操作（保持离线/内网无感）
 *  - 文本消息统一由 formatTaskMessage 生成，渠道只负责投递
 */
import { logger } from '../shared/logger';
import type { TaskRecord } from './task-queue';

/** 环境变量开关 */
export function telegramConfig(): { token: string; chatId: string } | null {
  const token = process.env.FH_CHANNEL_TELEGRAM_BOT_TOKEN?.trim() || '';
  const chatId = process.env.FH_CHANNEL_TELEGRAM_CHAT_ID?.trim() || '';
  return token && chatId ? { token, chatId } : null;
}

export function wecomKeys(): string[] {
  return (process.env.FH_CHANNEL_WECOM_KEY || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 生成任务状态通知文本（渠道无关） */
export function formatTaskMessage(record: TaskRecord, status: string): string {
  const emoji: Record<string, string> = { queued: '🕐', running: '⚙️', done: '✅', failed: '❌' };
  const r = record.result;
  const lines = [
    `${emoji[status] ?? 'ℹ️'} [fhcode] 任务状态: ${status}`,
    `📋 目标: ${record.goal.slice(0, 120)}`,
    `🆔 任务: ${record.id.slice(0, 8)}`,
  ];
  if (r) {
    lines.push(`⚙️ 迭代: ${r.iterations} · 成本: $${r.costUsd.toFixed(6)}`);
  }
  if (record.error) lines.push(`⚠️ 错误: ${record.error.slice(0, 200)}`);
  return lines.join('\n');
}

async function postJson(url: string, body: unknown, timeoutMs = 10000): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 消息渠道聚合器：按环境变量启用 Telegram / 企业微信，投递失败仅告警 */
export class MessageChannels {
  /** 是否配置了任何渠道 */
  get enabled(): boolean {
    return !!telegramConfig() || wecomKeys().length > 0;
  }

  /** 向所有已启用渠道推送任务状态 */
  async notify(record: TaskRecord, status: string): Promise<void> {
    if (!this.enabled) return;
    const text = formatTaskMessage(record, status);

    const tg = telegramConfig();
    if (tg) {
      await this.safe('telegram', async () => {
        await postJson(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
          chat_id: tg.chatId,
          text,
        });
      });
    }

    const keys = wecomKeys();
    for (const key of keys) {
      await this.safe('wecom', async () => {
        await postJson(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${key}`, {
          msgtype: 'text',
          text: { content: text },
        });
      });
    }
  }

  /** 单渠道投递容错 */
  private async safe(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      logger.warn('message channel delivery failed', {
        channel: name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
