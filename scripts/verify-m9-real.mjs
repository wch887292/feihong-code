/**
 * verify-m9-real.mjs —— M9 真实模型接入实测
 *
 * 目标：在不依赖慢速/密钥模型的前提下，验证「真实模型」全链路确实可用：
 *   1) OpenAICompatibleProvider / OllamaProvider 能正确对真实 HTTP 接口发请求并解析 tool_calls
 *   2) loadConfig 支持「配置文件 fhcode.config.json」与「单环境变量 FH_MODEL_*」两种快速接入
 *   3) fhcode swe 在真实 HTTP provider 下能完成「模型调用 → 工具改写文件 → 验证」闭环
 *
 * 做法：起两个本地 mock HTTP 服务（分别模拟 OpenAI / Ollama 协议），让真实 provider 打到它们。
 * 署名：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 */
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { OpenAICompatibleProvider } = require('../dist/models/providers/openai-compatible.provider.js');
const { OllamaProvider } = require('../dist/models/providers/ollama.provider.js');
const config = require('../dist/shared/config.js');

let pass = 0;
let fail = 0;
const fails = [];
function assert(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    fails.push(name + (extra ? ` — ${extra}` : ''));
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

const WROTE = { path: 'generated/agent-output.txt', content: 'real-model-integration-ok' };

/** 起一个 mock OpenAI 兼容服务：奇数调用返回 write_file 工具调用，偶数返回终态文本 */
function startOpenAIMock(port) {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls++;
      const odd = calls % 2 === 1;
      const payload = odd
        ? {
            model: 'mock',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_' + calls,
                      type: 'function',
                      function: { name: 'write_file', arguments: JSON.stringify(WROTE) },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }
        : {
            model: 'mock',
            choices: [
              {
                message: { role: 'assistant', content: '任务完成：已创建文件并通过验证。' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

/** 起一个 mock Ollama 服务：奇数调用返回 tool_calls，偶数返回终态文本 */
function startOllamaMock(port) {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls++;
      const odd = calls % 2 === 1;
      const payload = odd
        ? {
            model: 'mock',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_' + calls,
                  type: 'function',
                  function: { name: 'write_file', arguments: JSON.stringify(WROTE) },
                },
              ],
            },
            done: true,
            prompt_eval_count: 10,
            eval_count: 5,
          }
        : {
            model: 'mock',
            message: { role: 'assistant', content: '任务完成：已创建文件并通过验证。' },
            done: true,
            prompt_eval_count: 10,
            eval_count: 5,
          };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

const TOOLS = [
  {
    name: 'write_file',
    description: '写入文件',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
];
const REQ = {
  messages: [{ role: 'user', content: '创建一个输出文件' }],
  tools: TOOLS,
  temperature: 0,
};

async function main() {
  console.log('== M9 真实模型接入实测 ==');
  const openaiPort = 8799;
  const ollamaPort = 8798;
  const openaiSrv = await startOpenAIMock(openaiPort);
  const ollamaSrv = await startOllamaMock(ollamaPort);
  const baseOpenAI = `http://localhost:${openaiPort}/v1`;
  const baseOllama = `http://localhost:${ollamaPort}`;

  try {
    // ---- T1: OpenAICompatibleProvider 真实 HTTP 调用 + tool_calls 解析 ----
    console.log('\n[T1] OpenAICompatibleProvider 真实 HTTP 通信');
    const p1 = new OpenAICompatibleProvider({
      id: 'mock',
      type: 'openai-compatible',
      baseURL: baseOpenAI,
      model: 'mock',
      apiKey: 'x',
      tags: ['code-gen', 'reasoning'],
    });
    const r1 = await p1.chat(REQ);
    assert('返回 tool_calls 且名为 write_file', r1.message.toolCalls?.[0]?.name === 'write_file', JSON.stringify(r1.message.toolCalls));
    assert('返回参数含 path/content', r1.message.toolCalls?.[0]?.arguments?.path === WROTE.path);
    const r1b = await p1.chat(REQ);
    assert('偶数调用返回终态文本（无 tool_calls）', !r1b.message.toolCalls && !!r1b.message.content, r1b.message.content);

    // ---- T2: OllamaProvider 真实 HTTP 调用 + tool_calls 解析 ----
    console.log('\n[T2] OllamaProvider 真实 HTTP 通信');
    const p2 = new OllamaProvider({
      id: 'mock',
      type: 'ollama',
      baseURL: baseOllama,
      model: 'mock',
      tags: ['code-gen', 'reasoning', 'local'],
    });
    const r2 = await p2.chat(REQ);
    assert('Ollama 返回 tool_calls', r2.message.toolCalls?.[0]?.name === 'write_file', JSON.stringify(r2.message.toolCalls));
    const r2b = await p2.chat(REQ);
    assert('Ollama 偶数调用返回终态文本', !r2b.message.toolCalls && !!r2b.message.content);

    // ---- T3: 单环境变量快速接入 ----
    console.log('\n[T3] 单环境变量 FH_MODEL_* 快速接入');
    process.env.FH_PROVIDERS = '';
    process.env.FH_MODEL_NAME = 'my-model';
    process.env.FH_MODEL_TYPE = 'openai-compatible';
    process.env.FH_MODEL_BASE_URL = baseOpenAI;
    process.env.FH_MODEL_API_KEY = 'x';
    process.env.FH_MODEL_TAGS = 'code-gen,reasoning';
    config.__resetConfigForTest();
    const c3 = config.loadConfig();
    assert('解析出 1 个 provider', c3.models.providers.length === 1, `len=${c3.models.providers.length}`);
    assert('类型 openai-compatible', c3.models.providers[0].type === 'openai-compatible');
    assert('标签含 code-gen（可被编排器选中）', c3.models.providers[0].tags.includes('code-gen'));

    // ---- T4: 配置文件 fhcode.config.json 接入 ----
    console.log('\n[T4] 配置文件 fhcode.config.json 接入');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fhcode-cfg-'));
    fs.writeFileSync(
      path.join(tmp, 'fhcode.config.json'),
      JSON.stringify({ models: { providers: [{ id: 'cfg', type: 'ollama', baseURL: baseOllama, model: 'm', tags: ['code-gen', 'local'] }] } }),
    );
    const prevCwd = process.cwd();
    process.chdir(tmp);
    delete process.env.FH_MODEL_NAME;
    delete process.env.FH_MODEL_TYPE;
    delete process.env.FH_MODEL_BASE_URL;
    delete process.env.FH_MODEL_API_KEY;
    delete process.env.FH_MODEL_TAGS;
    config.__resetConfigForTest();
    const c4 = config.loadConfig();
    assert('从配置文件解析出 provider', c4.models.providers.length === 1 && c4.models.providers[0].id === 'cfg', JSON.stringify(c4.models.providers));
    process.chdir(prevCwd);

    // ---- T5: 端到端 swe（真实 HTTP provider）----
    console.log('\n[T5] fhcode swe 端到端（真实 HTTP provider → 写文件 → 验证）');
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fhcode-swe-real-'));
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const x = 1;\n');
    // 指向 mock OpenAI 服务的 provider
    process.env.FH_PROVIDERS = JSON.stringify([
      { id: 'mock', type: 'openai-compatible', baseURL: baseOpenAI, model: 'mock', apiKey: 'x', tags: ['code-gen', 'reasoning'] },
    ]);
    process.env.FH_REQUIRE_APPROVAL = 'false';
    delete process.env.FH_OFFLINE;
    config.__resetConfigForTest();
    const { runSwe } = require('../dist/cli/run.js');
    let crashed = null;
    try {
      await Promise.race([
        runSwe('实现一个示例输出文件', { repo, maxTasks: 2, maxRetries: 0, maxIterations: 2, offline: false }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('swe 超时(90s)')), 90000)),
      ]);
    } catch (e) {
      crashed = e;
    }
    assert('swe 运行未崩溃', !crashed, crashed ? String(crashed && crashed.message) : '');
    const outFile = path.join(repo, WROTE.path);
    assert('模型经真实 HTTP provider 实际调用 write_file 创建了文件', fs.existsSync(outFile), `exists=${fs.existsSync(outFile)}`);

    // ---- 汇总 ----
    console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`);
    if (fail > 0) {
      console.log('失败项:');
      for (const f of fails) console.log('  - ' + f);
    }
  } finally {
    openaiSrv.close();
    ollamaSrv.close();
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('verify-m9-real 异常:', e);
  process.exit(1);
});
