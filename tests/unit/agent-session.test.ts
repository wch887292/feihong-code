/**
 * P1.1 createAgentSession 工厂 + P3 steer 注入集成测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createAgentSession } from '../../src/agent/agent-session';
import type { ChatMessage } from '../../src/models/model.interface';
import type { ModelRouter } from '../../src/models/model-router';
import type { ToolRegistry } from '../../src/tools/tool.registry';

interface ChatReq {
  messages: ChatMessage[];
  tools: unknown[];
  temperature: number;
  timeoutMs: number;
}

function mockRouter(opts: { onChat?: (req: ChatReq, call: number) => void } = {}): ModelRouter {
  let call = 0;
  return {
    chat: async (req: ChatReq) => {
      call++;
      opts.onChat?.(req, call);
      // 第一轮返回工具调用（让循环继续），后续轮次完成
      if (call === 1) {
        return {
          providerId: 'mock',
          model: 'mock-model',
          costUsd: 0,
          message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'read_file', arguments: { path: 'x.ts' } }] },
        };
      }
      return { providerId: 'mock', model: 'mock-model', costUsd: 0, message: { role: 'assistant', content: '任务完成', toolCalls: [] } };
    },
    getStats: () => [],
  } as unknown as ModelRouter;
}

function mockTools(onExecute?: () => void): ToolRegistry {
  return {
    definitions: () => [{ name: 'read_file', description: '', inputSchema: {} }],
    execute: async () => {
      onExecute?.();
      return { ok: true, output: 'file content' };
    },
  } as unknown as ToolRegistry;
}

test('agent-session: 工厂创建会话，runId 自动生成', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'fhcode-as-'));
  try {
    const session = createAgentSession({
      cwd,
      router: mockRouter(),
      security: { requireApproval: false },
      maxIterations: 3,
    });
    assert.ok(session.runId, 'runId 应存在');
    assert.ok(session.runId.length > 0);
    assert.ok(session.steer, 'steer 队列应存在');
    assert.equal(session.steer.size(), 0);
    assert.ok(session.getSession());
    assert.ok(session.getEventLog());
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('agent-session: injectSteer 推入消息到 steer 队列', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'fhcode-as-'));
  try {
    const session = createAgentSession({
      cwd,
      router: mockRouter(),
      security: { requireApproval: false },
      maxIterations: 3,
    });
    const msg = session.injectSteer('改成用 TypeScript', '只改类型定义');
    assert.ok(msg.id);
    assert.equal(msg.message, '改成用 TypeScript');
    assert.equal(msg.focus, '只改类型定义');
    assert.equal(session.steer.size(), 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('agent-session: P3 steer 消息在循环下一轮被注入为 user 消息', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'fhcode-steer-'));
  try {
    let steerInjected = false;
    let sawSteerInMessages = false;
    let steerCallNumber = 0;

    const router = mockRouter({
      onChat: (req: ChatReq, call: number) => {
        // 检查本轮请求的 messages 中是否包含 steer 标记
        const hasSteer = req.messages.some(
          (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[用户中途指令]'),
        );
        if (hasSteer) {
          sawSteerInMessages = true;
          steerCallNumber = call;
        }
      },
    });

    const session = createAgentSession({
      cwd,
      router,
      tools: mockTools(() => {
        // 在工具执行期间注入 steer——下一轮循环顶部会被 drain 并注入
        if (!steerInjected) {
          session.injectSteer('改成用 TypeScript 重写', '只改 src/ 下的类型定义');
          steerInjected = true;
        }
      }),
      security: { requireApproval: false },
      maxIterations: 5,
    });

    const result = await session.run('读取文件并总结');
    assert.ok(result.ok, '任务应完成');
    assert.ok(steerInjected, 'steer 应已被注入');
    assert.ok(sawSteerInMessages, '模型请求的 messages 中应包含 steer 消息');
    assert.ok(steerCallNumber >= 2, `steer 应在第 2 轮及以后被看到，实际第 ${steerCallNumber} 轮`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('agent-session: abort 中断任务', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'fhcode-abort-'));
  try {
    // 路由器始终返回工具调用，让循环不会自然结束
    const endlessRouter = {
      chat: async () => ({
        providerId: 'mock',
        model: 'mock',
        costUsd: 0,
        message: { role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'read_file', arguments: { path: 'x.ts' } }] },
      }),
      getStats: () => [],
    } as unknown as ModelRouter;

    const session = createAgentSession({
      cwd,
      router: endlessRouter,
      tools: mockTools(() => {
        // 第一次工具执行后立即中断
        session.abort();
      }),
      security: { requireApproval: false },
      maxIterations: 10,
    });

    const result = await session.run('无限循环任务');
    assert.ok(!result.ok, '中断后任务应标记为失败');
    assert.match(result.finalAnswer, /中断/, '最终答案应包含中断提示');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('agent-session: onEvent 回调收到 steer 事件', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'fhcode-ev-'));
  try {
    const events: Array<{ type: string }> = [];
    let steerInjected = false;

    const session = createAgentSession({
      cwd,
      router: mockRouter(),
      tools: mockTools(() => {
        if (!steerInjected) {
          session.injectSteer('测试纠偏');
          steerInjected = true;
        }
      }),
      security: { requireApproval: false },
      maxIterations: 5,
      onEvent: (ev) => events.push({ type: ev.type }),
    });

    await session.run('测试事件');
    const steerEvents = events.filter((e) => e.type === 'steer');
    assert.ok(steerEvents.length >= 1, `应收到至少 1 个 steer 事件，实际 ${steerEvents.length}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
