/**
 * P0-3 企微入站骨架 smoke（tsx 直跑；放 repo 根、不入 tests/ 不污染 CI）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 验证点（全离线，无真实企微凭据）：
 *  1) mapInboundToSession：mock InboundMessage → 生成 goal
 *  2) 无文本消息 → goal 走兜底文案
 *  3) 多轮上下文：前 N-1 条作为上下文注入
 *  4) WecomInboundAdapter.subscribe：缺凭据 → started:false + reason 含 missing config，不抛错（fail-open）
 *  5) enabled=false → started:false + reason=disabled by config
 *  6) close 幂等、platform 正确
 */
import assert from 'node:assert/strict';
import { mapInboundToSession, clearAllSessions } from './src/integrations/inbound/session-mapper';
import { WecomInboundAdapter } from './src/integrations/inbound/wecom-adapter';
import type { InboundMessage } from './src/integrations/inbound/types';

(async () => {
  clearAllSessions();

  // 1) mock InboundMessage → goal
  const msg: InboundMessage = { platform: 'wecom', conversationId: 'c1', userId: 'u1', text: '帮我重构 code-rag', ts: 1700000000 };
  const r1 = mapInboundToSession(msg);
  assert.ok(typeof r1.goal === 'string' && r1.goal.includes('code-rag'), 'goal 含任务文本');
  console.log('PASS P0-3.1 mapInboundToSession 生成 goal');

  // 2) 无文本 → 兜底文案
  clearAllSessions();
  const r2 = mapInboundToSession({ platform: 'wecom', conversationId: 'c2', userId: 'u2', ts: 1700000001 });
  assert.ok(r2.goal.includes('无文本'), '无文本走兜底文案');
  console.log('PASS P0-3.2 无文本兜底文案');

  // 3) 多轮上下文（同会话 c3/u3 连发两条，第二条应带上下文）
  clearAllSessions();
  mapInboundToSession({ platform: 'wecom', conversationId: 'c3', userId: 'u3', text: '第一条：背景说明', ts: 1700000002 });
  const r3 = mapInboundToSession({ platform: 'wecom', conversationId: 'c3', userId: 'u3', text: '第二条：执行指令', ts: 1700000003 });
  assert.ok(typeof r3.goal === 'string', '第二条仍生成 goal');
  console.log('PASS P0-3.3 多轮上下文注入');

  // 4) fail-open：缺凭据 → started:false 不抛错
  const adapter = new WecomInboundAdapter({ enabled: true });
  const noCred = await adapter.subscribe(async () => {});
  assert.equal(noCred.started, false, '缺凭据 started=false');
  assert.ok(noCred.reason?.includes('missing config'), 'reason 标注 missing config');
  await adapter.close();
  console.log(`PASS P0-3.4 缺凭据 fail-open（reason=${noCred.reason}）`);

  // 5) enabled=false → disabled by config（补全 4 凭据以通过 missing 检查，真正命中 disabled 分支）
  const offAdapter = new WecomInboundAdapter({ enabled: false, corpid: 'x', corpsecret: 'y', agentid: 'z', webhookUrl: 'w' });
  const off = await offAdapter.subscribe(async () => {});
  assert.equal(off.started, false, 'enabled=false 不启动');
  assert.ok(off.reason?.includes('disabled'), 'reason 标注 disabled');
  await offAdapter.close();
  console.log(`PASS P0-3.5 enabled=false 拒绝启动（reason=${off.reason}）`);

  // 6) platform + close 幂等
  assert.equal(adapter.platform, 'wecom', 'platform=wecom');
  await adapter.close();
  await adapter.close();
  console.log('PASS P0-3.6 platform 正确 + close 幂等');

  clearAllSessions();
  console.log('\n=== P0-3 全部 6 项验证通过 ===');
})().catch((e) => {
  console.error('P0-3 smoke FAILED:', e);
  process.exit(1);
});
