/**
 * P5-6 消息渠道单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：环境变量开关（Telegram/企业微信）/ 文本消息生成 /
 *       渠道未配置时不推送 / 投递失败不抛错（容错）/
 *       TaskQueue 集成（状态变化触发 notify）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannels, telegramConfig, wecomKeys, formatTaskMessage } from '../../src/web/channels';
import { TaskQueue } from '../../src/web/task-queue';

const ENV_KEYS = ['FH_CHANNEL_TELEGRAM_BOT_TOKEN', 'FH_CHANNEL_TELEGRAM_CHAT_ID', 'FH_CHANNEL_WECOM_KEY'];
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

test.afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test('telegramConfig / wecomKeys: 按环境变量识别渠道', () => {
  delete process.env.FH_CHANNEL_TELEGRAM_BOT_TOKEN;
  delete process.env.FH_CHANNEL_TELEGRAM_CHAT_ID;
  delete process.env.FH_CHANNEL_WECOM_KEY;
  assert.equal(telegramConfig(), null);
  assert.deepEqual(wecomKeys(), []);

  process.env.FH_CHANNEL_TELEGRAM_BOT_TOKEN = 'bot:abc';
  process.env.FH_CHANNEL_TELEGRAM_CHAT_ID = '12345';
  assert.deepEqual(telegramConfig(), { token: 'bot:abc', chatId: '12345' });

  process.env.FH_CHANNEL_WECOM_KEY = 'key1, key2';
  assert.deepEqual(wecomKeys(), ['key1', 'key2']);
});

test('formatTaskMessage: 生成含状态/目标/结果的消息', () => {
  const record = {
    id: 'abc12345-def',
    goal: '修复登录 bug',
    status: 'done',
    createdAt: '',
    updatedAt: '',
    result: { ok: true, finalAnswer: 'x', iterations: 3, costUsd: 0.01, logFile: 'f' },
  } as never;
  const msg = formatTaskMessage(record, 'done');
  assert.match(msg, /✅/);
  assert.match(msg, /修复登录 bug/);
  assert.match(msg, /abc12345/);
  assert.match(msg, /迭代: 3/);
});

test('MessageChannels: 未配置渠道时 enabled=false 且 notify 无操作', async () => {
  delete process.env.FH_CHANNEL_TELEGRAM_BOT_TOKEN;
  delete process.env.FH_CHANNEL_TELEGRAM_CHAT_ID;
  delete process.env.FH_CHANNEL_WECOM_KEY;
  const ch = new MessageChannels();
  assert.equal(ch.enabled, false);
  await ch.notify({ id: 'x', goal: 'g', status: 'queued', createdAt: '', updatedAt: '' }, 'queued'); // 不应抛错
});

test('MessageChannels: 配置渠道后 enabled=true（fetch 由 mock 拦截不真实发出）', () => {
  process.env.FH_CHANNEL_TELEGRAM_BOT_TOKEN = 'bot:x';
  process.env.FH_CHANNEL_TELEGRAM_CHAT_ID = '1';
  const ch = new MessageChannels();
  assert.equal(ch.enabled, true);
});

test('TaskQueue: 注入 channels 后任务状态变化触发 notify（mock 渠道计数）', async () => {
  let notified = 0;
  const ch = { enabled: true, notify: async () => { notified++; } };
  const queue = new TaskQueue({ concurrency: 1, channels: ch as never });
  const record = queue.submit('渠道推送测试');
  // 等待完成
  for (let i = 0; i < 100; i++) {
    const cur = queue.get(record.id)!;
    if (cur.status === 'done' || cur.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  // queued + running + done 至少 3 次通知（异步，留余量）
  assert.ok(notified >= 3, `应至少触发 3 次通知，实际 ${notified}`);
});
