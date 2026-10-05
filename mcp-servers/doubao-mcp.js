#!/usr/bin/env node
/**
 * 飞虹 Code · 豆包 MCP 服务器
 * 通过豆包开放平台 API 接入：对话、模型、知识库等
 *
 * 环境变量：
 *   DOUBAO_API_KEY     - 豆包 API Key（火山方舟）
 *   DOUBAO_BASE_URL    - 可选，默认 https://ark.cn-beijing.volces.com/api/v3
 *   DOUBAO_MODEL       - 可选，默认 doubao-1-5-pro-32k
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createMcpServer, httpRequest, requireEnv } = require('./lib/mcp-framework');

const BASE_URL = process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const MODEL = process.env.DOUBAO_MODEL || 'doubao-1-5-pro-32k';

const tools = [
  {
    name: 'doubao_chat',
    description: '调用豆包大模型进行对话。参数 messages(必填，数组，每项含role/content)、model(可选)、temperature(可选)。返回模型回复文本。',
    inputSchema: {
      type: 'object',
      properties: {
        messages: { type: 'array', description: '对话消息数组，如 [{"role":"user","content":"你好"}]' },
        model: { type: 'string', description: '模型名称，默认使用配置的默认模型' },
        temperature: { type: 'number', description: '采样温度 0-1' },
      },
      required: ['messages'],
    },
    handler: async (args) => {
      const apiKey = requireEnv('DOUBAO_API_KEY');
      const messages = args.messages;
      if (!Array.isArray(messages) || messages.length === 0) throw new Error('messages 必须是非空数组');
      const res = await httpRequest({
        url: `${BASE_URL}/chat/completions`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: { model: args.model || MODEL, messages, temperature: args.temperature ?? 0.7 },
      });
      if (res.status !== 200) throw new Error(`API 返回 ${res.status}: ${res.body.slice(0, 300)}`);
      const data = JSON.parse(res.body);
      return data.choices?.[0]?.message?.content || '(无回复内容)';
    },
  },
  {
    name: 'doubao_models',
    description: '列出当前 API Key 可用的模型列表。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const apiKey = requireEnv('DOUBAO_API_KEY');
      const res = await httpRequest({ url: `${BASE_URL}/models`, headers: { 'Authorization': `Bearer ${apiKey}` } });
      if (res.status !== 200) throw new Error(`API 返回 ${res.status}`);
      const data = JSON.parse(res.body);
      return (data.data || []).map((m) => `${m.id} (owned_by=${m.owned_by})`).join('\n') || '无可用模型';
    },
  },
  {
    name: 'doubao_config',
    description: '查看当前豆包 MCP 配置（base_url、默认模型，不含密钥）。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => `base_url: ${BASE_URL}\nmodel: ${MODEL}\napi_key: ${process.env.DOUBAO_API_KEY ? '已配置' : '未配置'}\ntts: ${process.env.DOUBAO_TTS_APPID ? '已配置' : '未配置（需 DOUBAO_TTS_APPID / DOUBAO_TTS_TOKEN）'}`,
  },
  {
    name: 'doubao_tts',
    description: '文字转语音（TTS）。参数 text(必填，要合成的文本)、voice_type(可选，音色，默认BV001_streaming)、speed(可选，语速0.2-3.0，默认1.0)、output(可选，输出文件路径，默认当前目录tts_output.mp3)。需要配置 DOUBAO_TTS_APPID 和 DOUBAO_TTS_TOKEN 环境变量。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要合成的文本，最多1000字' },
        voice_type: { type: 'string', description: '音色，如 BV001_streaming(通用女声), BV002_streaming(通用男声), BV005_streaming(亲切女声), BV007_streaming(磁性男声)' },
        speed: { type: 'number', description: '语速 0.2-3.0，默认1.0' },
        output: { type: 'string', description: '输出mp3文件路径' },
      },
      required: ['text'],
    },
    handler: async (args) => {
      const appid = process.env.DOUBAO_TTS_APPID;
      const token = process.env.DOUBAO_TTS_TOKEN;
      if (!appid || !token) {
        throw new Error('未配置语音合成凭证。请在 fhcode.config.json 的 doubao env 中添加 DOUBAO_TTS_APPID 和 DOUBAO_TTS_TOKEN（火山引擎语音合成服务，非大模型API Key）。获取地址：https://console.volcengine.com/speech/service/8');
      }
      const cluster = process.env.DOUBAO_TTS_CLUSTER || 'volcano_tts';
      const voiceType = args.voice_type || 'BV001_streaming';
      const speed = args.speed || 1.0;
      const reqid = `fhcode_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const res = await httpRequest({
        url: 'https://openspeech.bytedance.com/api/v1/tts',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer;${token}`,
        },
        body: JSON.stringify({
          app: { appid, token, cluster },
          user: { uid: 'fhcode' },
          audio: { voice_type: voiceType, encoding: 'mp3', speed_ratio: speed },
          request: { reqid, text: args.text, operation: 'query' },
        }),
      });
      const data = JSON.parse(res.body);
      if (data.code !== 3000) throw new Error(`TTS失败 code=${data.code} msg=${data.message}`);
      const audioBuffer = Buffer.from(data.data, 'base64');
      const outputPath = args.output || path.join(process.cwd(), `tts_${Date.now()}.mp3`);
      fs.writeFileSync(outputPath, audioBuffer);
      return `语音合成成功，文件: ${outputPath} (${(audioBuffer.length / 1024).toFixed(1)} KB)`;
    },
  },
];

createMcpServer({ name: 'doubao-mcp', version: '1.0.0', tools });
