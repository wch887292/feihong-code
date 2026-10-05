#!/usr/bin/env node
/**
 * 飞虹 Code · 钉钉 MCP 服务器
 * 通过钉钉开放平台 API 接入：发消息、用户、审批、日程
 *
 * 环境变量：
 *   DINGTALK_APP_KEY    - 钉钉应用 AppKey
 *   DINGTALK_APP_SECRET - 钉钉应用 AppSecret
 */
'use strict';
const { createMcpServer, httpRequest, requireEnv } = require('./lib/mcp-framework');

let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const appKey = requireEnv('DINGTALK_APP_KEY');
  const appSecret = requireEnv('DINGTALK_APP_SECRET');
  const res = await httpRequest({
    url: 'https://oapi.dingtalk.com/gettoken',
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: { appKey, appSecret },
  });
  const data = JSON.parse(res.body);
  if (data.errcode !== 0) throw new Error(`获取 token 失败: ${data.errmsg}`);
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 120) * 1000 };
  return tokenCache.token;
}

const tools = [
  {
    name: 'dingtalk_send_text',
    description: '向钉钉用户发送工作通知文本消息。参数 user_id(必填，接收者userid，多个用逗号分隔)、content(必填，消息内容)。',
    inputSchema: {
      type: 'object',
      properties: { user_id: { type: 'string' }, content: { type: 'string' } },
      required: ['user_id', 'content'],
    },
    handler: async (args) => {
      const token = await getAccessToken();
      const res = await httpRequest({
        url: `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${token}`,
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: {
          agent_id: Number(process.env.DINGTALK_AGENT_ID || 0),
          userid_list: args.user_id,
          msg: { msgtype: 'text', text: { content: args.content } },
        },
      });
      const data = JSON.parse(res.body);
      if (data.errcode !== 0) throw new Error(`发送失败: ${data.errmsg}`);
      return `消息发送任务已创建，task_id=${data.task_id}`;
    },
  },
  {
    name: 'dingtalk_send_markdown',
    description: '向钉钉发送 Markdown 工作通知。参数 user_id(必填)、title(必填)、text(必填，Markdown内容)。',
    inputSchema: {
      type: 'object',
      properties: { user_id: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' } },
      required: ['user_id', 'title', 'text'],
    },
    handler: async (args) => {
      const token = await getAccessToken();
      const res = await httpRequest({
        url: `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${token}`,
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: {
          agent_id: Number(process.env.DINGTALK_AGENT_ID || 0),
          userid_list: args.user_id,
          msg: { msgtype: 'markdown', markdown: { title: args.title, text: args.text } },
        },
      });
      const data = JSON.parse(res.body);
      if (data.errcode !== 0) throw new Error(`发送失败: ${data.errmsg}`);
      return `Markdown 消息任务已创建，task_id=${data.task_id}`;
    },
  },
  {
    name: 'dingtalk_user_get',
    description: '获取钉钉用户详情。参数 userid(必填)。',
    inputSchema: { type: 'object', properties: { userid: { type: 'string' } }, required: ['userid'] },
    handler: async (args) => {
      const token = await getAccessToken();
      const res = await httpRequest({
        url: `https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${token}`,
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: { userid: args.userid },
      });
      const data = JSON.parse(res.body);
      if (data.errcode !== 0) throw new Error(`获取失败: ${data.errmsg}`);
      const r = data.result || {};
      return `姓名=${r.name} 手机=${r.mobile || '无'} 邮箱=${r.email || '无'} 部门=${r.dept_id_list?.join(',') || '无'} 职位=${r.title || '无'}`;
    },
  },
  {
    name: 'dingtalk_department_list',
    description: '获取钉钉部门列表。参数 dept_id(可选，默认1，根部门)。',
    inputSchema: { type: 'object', properties: { dept_id: { type: 'number' } } },
    handler: async (args) => {
      const token = await getAccessToken();
      const res = await httpRequest({
        url: `https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token=${token}`,
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: { dept_id: args.dept_id || 1 },
      });
      const data = JSON.parse(res.body);
      if (data.errcode !== 0) throw new Error(`获取失败: ${data.errmsg}`);
      return (data.result || []).map((d) => `dept_id=${d.dept_id} 名称=${d.name} 父部门=${d.parent_id}`).join('\n') || '无部门';
    },
  },
  {
    name: 'dingtalk_config',
    description: '查看钉钉 MCP 配置状态（不含密钥）。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => `app_key: ${process.env.DINGTALK_APP_KEY || '未配置'}\napp_secret: ${process.env.DINGTALK_APP_SECRET ? '已配置' : '未配置'}\nagent_id: ${process.env.DINGTALK_AGENT_ID || '未配置'}`,
  },
  {
    name: 'dingtalk_approval_create',
    description: '发起钉钉审批。参数 process_code(必填，审批模板编码)、originator_user_id(必填，发起人userid)、form_values(必填，对象，字段名→值)、dept_id(可选，部门ID)。返回审批实例ID。',
    inputSchema: {
      type: 'object',
      properties: {
        process_code: { type: 'string', description: '审批模板编码，如 PROC-XXXXXX，在钉钉管理后台审批模板详情中获取' },
        originator_user_id: { type: 'string', description: '发起人 userid' },
        form_values: { type: 'object', description: '审批表单字段，如 {"请假类型":"年假","开始时间":"2026-10-01","结束时间":"2026-10-03","事由":"国庆休假"}' },
        dept_id: { type: 'number', description: '发起人所在部门ID，可选' },
      },
      required: ['process_code', 'originator_user_id', 'form_values'],
    },
    handler: async (args) => {
      const token = await getAccessToken();
      const agentId = Number(process.env.DINGTALK_AGENT_ID || 0);
      const formComponentValues = Object.entries(args.form_values).map(([name, value]) => ({ name, value: String(value) }));
      const body = {
        agent_id: agentId,
        process_code: args.process_code,
        originator_user_id: args.originator_user_id,
        form_component_values: formComponentValues,
      };
      if (args.dept_id) body.dept_id = args.dept_id;
      const res = await httpRequest({
        url: `https://oapi.dingtalk.com/topapi/processinstance/create?access_token=${token}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const data = JSON.parse(res.body);
      if (data.errcode !== 0) throw new Error(`发起审批失败: ${data.errmsg}`);
      return `审批发起成功，process_instance_id=${data.process_instance_id}`;
    },
  },
];

createMcpServer({ name: 'dingtalk-mcp', version: '1.0.0', tools });
