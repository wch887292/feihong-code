/**
 * Provider 全链路集成测试：配置(apiKeyEnv) → 凭据存储 → provider → 真实 HTTP 请求
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖单测未覆盖的"集成缝"：
 *  - fhcode.config.json 用 apiKeyEnv 引用（非明文）
 *  - loadConfig → resolveProviderApiKey 从 $FH_HOME/.credentials.json 取回真实密钥
 *  - provider 构造后发出的 HTTP 请求头携带取回的密钥（x-api-key / anthropic-version）
 *  - 响应 content block → ChatResponse 归一
 * 说明：FH_HOME 已隔离为临时目录；配置文件与凭据均写入临时 FH_HOME，全程本机回环。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'http';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { loadConfig } from '../../src/shared/config';
import { setCredential, resolveProviderApiKey } from '../../src/security/credentials';
import { AnthropicMessagesProvider } from '../../src/models/providers/anthropic-messages.provider';

function startCaptureServer(): Promise<{
  server: Server;
  baseURL: string;
  captured: { headers: Record<string, string | undefined>; body: Record<string, unknown> };
}> {
  return new Promise((resolve) => {
    const captured = { headers: {}, body: {} };
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        captured.headers = {
          'x-api-key': (req.headers['x-api-key'] as string) ?? undefined,
          'anthropic-version': (req.headers['anthropic-version'] as string) ?? undefined,
          'content-type': (req.headers['content-type'] as string) ?? undefined,
        };
        captured.body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'msg_it_1',
            model: 'it-chain',
            content: [{ type: 'text', text: '集成链路 OK' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 7, output_tokens: 3 },
          }),
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseURL: `http://127.0.0.1:${port}`, captured });
    });
  });
}

test('provider-chain: 配置 apiKeyEnv 引用 → 凭据解析 → HTTP 请求携带密钥', async () => {
  const fhHome = process.env.FH_HOME;
  assert.ok(fhHome, 'force-offline 必须已设置 FH_HOME 隔离');
  const { server, baseURL, captured } = await startCaptureServer();

  // 1) 写临时配置文件（apiKeyEnv 引用，无明文）与凭据
  const cfgFile = join(fhHome, 'fhcode.config.json');
  const cfg = {
    models: {
      providers: [
        {
          id: 'it-chain',
          type: 'anthropic-messages',
          baseURL,
          apiKeyEnv: 'FHC_IT_CHAIN_API_KEY',
          model: 'it-chain',
          tags: ['code-gen'],
          costPer1k: 0,
        },
      ],
    },
  };
  mkdirSync(fhHome, { recursive: true });
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), 'utf8');
  setCredential('FHC_IT_CHAIN_API_KEY', 'sk-it-chain-secret');

  try {
    // 2) 配置加载 + 引用解析
    const appCfg = loadConfig();
    const providerCfg = appCfg.models.providers.find((p) => p.id === 'it-chain');
    assert.ok(providerCfg, 'loadConfig 应加载临时配置中的 provider');
    const key = resolveProviderApiKey(providerCfg);
    assert.equal(key, 'sk-it-chain-secret', 'apiKeyEnv 应从凭据存储取回真实密钥');

    // 3) 全链路对话：构造 provider（携带解析出的密钥）→ 真实 HTTP 请求
    const provider = new AnthropicMessagesProvider({ ...providerCfg, apiKey: key });
    const res = await provider.chat({ messages: [{ role: 'user', content: '你好' }] });

    assert.equal(captured.headers['x-api-key'], 'sk-it-chain-secret', 'HTTP 头应携带取回的密钥');
    assert.equal(captured.headers['anthropic-version'], '2023-06-01');
    assert.ok((captured.headers['content-type'] ?? '').includes('application/json'));
    assert.equal(captured.body.model, 'it-chain');
    assert.equal((captured.body.messages as Array<{ role: string }>)[0].role, 'user');
    assert.equal(res.message.content, '集成链路 OK');
    assert.equal(res.usage.promptTokens, 7);
    assert.equal(res.usage.completionTokens, 3);
  } finally {
    server.close();
    // 清理临时配置与凭据，避免污染 FH_HOME（供同进程其它测试复用）
    rmSync(cfgFile, { force: true });
    rmSync(join(fhHome, '.credentials.json'), { force: true });
  }
});

/** 类型占位：避免未使用 import 告警 */
void (null as unknown as Server);
