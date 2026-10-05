#!/usr/bin/env node
/**
 * 飞虹 Code · 飞书 MCP 服务器
 * 通过飞书开放平台 API 接入：发消息、文档、多维表格、日历
 *
 * 环境变量：
 *   FEISHU_APP_ID     - 飞书应用 App ID
 *   FEISHU_APP_SECRET - 飞书应用 App Secret
 */
'use strict';
const { createMcpServer, httpRequest, requireEnv } = require('./lib/mcp-framework');

const BASE = 'https://open.feishu.cn/open-apis';
let tokenCache = { token: null, expiresAt: 0 };

async function getTenantToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const appId = requireEnv('FEISHU_APP_ID');
  const appSecret = requireEnv('FEISHU_APP_SECRET');
  const res = await httpRequest({
    url: `${BASE}/auth/v3/tenant_access_token/internal`,
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: { app_id: appId, app_secret: appSecret },
  });
  const data = JSON.parse(res.body);
  if (data.code !== 0) throw new Error(`获取 token 失败: ${data.msg}`);
  tokenCache = { token: data.tenant_access_token, expiresAt: Date.now() + (data.expire - 120) * 1000 };
  return tokenCache.token;
}

async function feishuRequest({ path, method = 'GET', body = null }) {
  const token = await getTenantToken();
  const res = await httpRequest({
    url: `${BASE}${path}`, method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: body ? JSON.stringify(body) : null,
  });
  const data = JSON.parse(res.body);
  if (data.code !== 0) throw new Error(`飞书 API 错误 [${data.code}]: ${data.msg}`);
  return data.data || data;
}

const tools = [
  {
    name: 'feishu_send_message',
    description: '向飞书用户/群聊发送消息。参数 receive_id(必填，用户open_id或群chat_id)、receive_id_type(可选，默认 open_id，可选 chat_id)、msg_type(可选，默认 text)、content(必填，消息内容)。',
    inputSchema: {
      type: 'object',
      properties: {
        receive_id: { type: 'string' },
        receive_id_type: { type: 'string', description: 'open_id / union_id / user_id / email / chat_id' },
        msg_type: { type: 'string', description: 'text / post / image / interactive' },
        content: { type: 'string' },
      },
      required: ['receive_id', 'content'],
    },
    handler: async (args) => {
      const receiveIdType = args.receive_id_type || 'open_id';
      const msgType = args.msg_type || 'text';
      const content = msgType === 'text' ? JSON.stringify({ text: args.content }) : args.content;
      const data = await feishuRequest({
        path: `/im/v1/messages?receive_id_type=${receiveIdType}`,
        method: 'POST',
        body: { receive_id: args.receive_id, msg_type: msgType, content },
      });
      return `消息发送成功，message_id=${data.message_id}`;
    },
  },
  {
    name: 'feishu_create_doc',
    description: '创建飞书文档。参数 title(必填，文档标题)、folder_token(可选，目标文件夹)。返回文档链接。',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, folder_token: { type: 'string' } },
      required: ['title'],
    },
    handler: async (args) => {
      const data = await feishuRequest({
        path: '/docx/v1/documents', method: 'POST',
        body: { title: args.title, folder_token: args.folder_token || '' },
      });
      return `文档创建成功: https://feishu.cn/docx/${data.document.document_id}`;
    },
  },
  {
    name: 'feishu_base_list_tables',
    description: '列出多维表格的数据表。参数 app_token(必填，多维表格token)。',
    inputSchema: { type: 'object', properties: { app_token: { type: 'string' } }, required: ['app_token'] },
    handler: async (args) => {
      const data = await feishuRequest({ path: `/bitable/v1/apps/${args.app_token}/tables` });
      return (data.items || []).map((t) => `table_id=${t.table_id} 名称=${t.name}`).join('\n') || '无数据表';
    },
  },
  {
    name: 'feishu_base_add_record',
    description: '向多维表格添加记录。参数 app_token(必填)、table_id(必填)、fields(必填，对象，字段名→值)。',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string' }, table_id: { type: 'string' },
        fields: { type: 'object', description: '字段名到值的映射' },
      },
      required: ['app_token', 'table_id', 'fields'],
    },
    handler: async (args) => {
      const data = await feishuRequest({
        path: `/bitable/v1/apps/${args.app_token}/tables/${args.table_id}/records`,
        method: 'POST', body: { fields: args.fields },
      });
      return `记录添加成功，record_id=${data.record.record_id}`;
    },
  },
  {
    name: 'feishu_base_query_records',
    description: '查询多维表格记录。参数 app_token(必填)、table_id(必填)、page_size(可选，默认20，最大500)、filter(可选，筛选公式如 CurrentValue.[字段名]="值")、sort(可选，排序JSON数组)、page_token(可选，翻页)。',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string' },
        table_id: { type: 'string' },
        page_size: { type: 'number', description: '每页条数，默认20，最大500' },
        filter: { type: 'string', description: '筛选公式，如 CurrentValue.[状态]="进行中"' },
        sort: { type: 'string', description: '排序JSON，如 [{"field_name":"创建时间","desc":true}]' },
        page_token: { type: 'string', description: '翻页标记' },
      },
      required: ['app_token', 'table_id'],
    },
    handler: async (args) => {
      const params = new URLSearchParams();
      params.set('page_size', String(args.page_size || 20));
      if (args.filter) params.set('filter', args.filter);
      if (args.sort) params.set('sort', args.sort);
      if (args.page_token) params.set('page_token', args.page_token);
      const data = await feishuRequest({
        path: `/bitable/v1/apps/${args.app_token}/tables/${args.table_id}/records?${params.toString()}`,
      });
      const records = data.items || [];
      const lines = records.map((r, i) => {
        const fields = Object.entries(r.fields || {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' | ');
        return `${i + 1}. [${r.record_id}] ${fields}`;
      });
      return lines.join('\n') || '无记录';
    },
  },
  {
    name: 'feishu_doc_write',
    description: '向飞书文档追加写入文本内容。参数 document_id(必填，文档ID)、content(必填，文本内容)、block_type(可选，2=正文 3=标题1 4=标题2 5=标题3，默认2)。',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: '文档ID，URL中/docx/后面那串' },
        content: { type: 'string', description: '要写入的文本，支持\\n换行' },
        block_type: { type: 'number', description: '2=正文 3=标题1 4=标题2 5=标题3，默认2' },
      },
      required: ['document_id', 'content'],
    },
    handler: async (args) => {
      const blockType = args.block_type || 2;
      const lines = (args.content || '').split('\n').filter((l) => l.trim().length > 0);
      const children = lines.map((line) => ({
        block_type: blockType,
        text: { elements: [{ text_run: { content: line } }] },
      }));
      const data = await feishuRequest({
        path: `/docx/v1/documents/${args.document_id}/blocks/${args.document_id}/children`,
        method: 'POST',
        body: { index: -1, children },
      });
      return `写入成功，新增 ${children.length} 个文本块`;
    },
  },
  {
    name: 'feishu_calendar_events',
    description: '查询飞书日历事件。参数 calendar_id(必填)、start_time(必填，Unix时间戳)、end_time(必填)。',
    inputSchema: {
      type: 'object',
      properties: {
        calendar_id: { type: 'string' },
        start_time: { type: 'string' }, end_time: { type: 'string' },
      },
      required: ['calendar_id', 'start_time', 'end_time'],
    },
    handler: async (args) => {
      const data = await feishuRequest({
        path: `/calendar/v4/calendars/${args.calendar_id}/events?start_time=${args.start_time}&end_time=${args.end_time}`,
      });
      return (data.items || []).map((e) => `${e.start_time?.date || e.start_time?.timestamp} - ${e.end_time?.date || e.end_time?.timestamp}: ${e.summary}`).join('\n') || '无日程';
    },
  },
  {
    name: 'feishu_config',
    description: '查看飞书 MCP 配置状态（不含密钥）。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => `app_id: ${process.env.FEISHU_APP_ID || '未配置'}\napp_secret: ${process.env.FEISHU_APP_SECRET ? '已配置' : '未配置'}`,
  },
];

createMcpServer({ name: 'feishu-mcp', version: '1.0.0', tools });
