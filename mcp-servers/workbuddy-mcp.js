#!/usr/bin/env node
/**
 * 飞虹 Code · WorkBuddy MCP 服务器
 * 腾讯 WorkBuddy（腾讯云 AI 编程助手）接入
 *
 * 环境变量：
 *   WORKBUDDY_API_KEY   - WorkBuddy API Key
 *   WORKBUDDY_BASE_URL  - 可选，默认 https://api.workbuddy.tencent.com/v1
 *   WORKBUDDY_MODEL     - 可选，默认 workbuddy-pro
 */
'use strict';
const { createMcpServer, httpRequest, requireEnv } = require('./lib/mcp-framework');

const BASE_URL = process.env.WORKBUDDY_BASE_URL || 'https://api.workbuddy.tencent.com/v1';
const MODEL = process.env.WORKBUDDY_MODEL || 'workbuddy-pro';

const tools = [
  {
    name: 'workbuddy_chat',
    description: '调用 WorkBuddy 大模型对话。参数 messages(必填，数组)、model(可选)、temperature(可选)。',
    inputSchema: {
      type: 'object',
      properties: {
        messages: { type: 'array', description: '对话消息数组' },
        model: { type: 'string' }, temperature: { type: 'number' },
      },
      required: ['messages'],
    },
    handler: async (args) => {
      const apiKey = requireEnv('WORKBUDDY_API_KEY');
      const res = await httpRequest({
        url: `${BASE_URL}/chat/completions`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: { model: args.model || MODEL, messages: args.messages, temperature: args.temperature ?? 0.7 },
      });
      if (res.status !== 200) throw new Error(`API 返回 ${res.status}: ${res.body.slice(0, 300)}`);
      const data = JSON.parse(res.body);
      return data.choices?.[0]?.message?.content || '(无回复内容)';
    },
  },
  {
    name: 'workbuddy_code_review',
    description: '使用 WorkBuddy 进行代码审查。参数 code(必填，代码内容)、language(可选，编程语言)、focus(可选，审查重点)。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string' }, language: { type: 'string' }, focus: { type: 'string' },
      },
      required: ['code'],
    },
    handler: async (args) => {
      const apiKey = requireEnv('WORKBUDDY_API_KEY');
      const prompt = `请对以下${args.language || ''}代码进行专业审查${args.focus ? `，重点关注：${args.focus}` : ''}，包括：1)潜在bug 2)性能问题 3)安全漏洞 4)代码规范 5)优化建议。\n\n代码：\n\`\`\`\n${args.code}\n\`\`\``;
      const res = await httpRequest({
        url: `${BASE_URL}/chat/completions`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: { model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.3 },
      });
      if (res.status !== 200) throw new Error(`API 返回 ${res.status}`);
      const data = JSON.parse(res.body);
      return data.choices?.[0]?.message?.content || '(无审查结果)';
    },
  },
  {
    name: 'workbuddy_code_generate',
    description: '使用 WorkBuddy 生成代码。参数 requirement(必填，需求描述)、language(可选，默认Python)、context(可选，上下文)。',
    inputSchema: {
      type: 'object',
      properties: {
        requirement: { type: 'string' }, language: { type: 'string' }, context: { type: 'string' },
      },
      required: ['requirement'],
    },
    handler: async (args) => {
      const apiKey = requireEnv('WORKBUDDY_API_KEY');
      const prompt = `${args.context ? `上下文：\n${args.context}\n\n` : ''}请用${args.language || 'Python'}实现以下需求，只输出代码和必要注释：\n\n${args.requirement}`;
      const res = await httpRequest({
        url: `${BASE_URL}/chat/completions`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: { model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.5 },
      });
      if (res.status !== 200) throw new Error(`API 返回 ${res.status}`);
      const data = JSON.parse(res.body);
      return data.choices?.[0]?.message?.content || '(无生成结果)';
    },
  },
  {
    name: 'workbuddy_models',
    description: '列出 WorkBuddy 可用模型。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const apiKey = requireEnv('WORKBUDDY_API_KEY');
      const res = await httpRequest({ url: `${BASE_URL}/models`, headers: { 'Authorization': `Bearer ${apiKey}` } });
      if (res.status !== 200) throw new Error(`API 返回 ${res.status}`);
      const data = JSON.parse(res.body);
      return (data.data || []).map((m) => m.id).join('\n') || '无可用模型';
    },
  },
  {
    name: 'workbuddy_config',
    description: '查看 WorkBuddy MCP 配置（不含密钥）。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => `base_url: ${BASE_URL}\nmodel: ${MODEL}\napi_key: ${process.env.WORKBUDDY_API_KEY ? '已配置' : '未配置'}`,
  },
];

createMcpServer({ name: 'workbuddy-mcp', version: '1.0.0', tools });
