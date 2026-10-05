#!/usr/bin/env node
/**
 * 飞虹 Code · 企业微信 MCP 服务器
 * 通过企业微信开放 API 接入：发消息、部门/成员管理、应用消息
 *
 * 环境变量：
 *   WECOM_CORP_ID     - 企业 ID
 *   WECOM_AGENT_ID    - 应用 AgentId
 *   WECOM_SECRET      - 应用 Secret
 */
'use strict';
const { createMcpServer, httpRequest, requireEnv } = require('./lib/mcp-framework');

let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  const corpId = requireEnv('WECOM_CORP_ID');
  const secret = requireEnv('WECOM_SECRET');
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const res = await httpRequest({ url: `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}` });
  const data = JSON.parse(res.body);
  if (data.errcode !== 0) throw new Error(`获取 token 失败: ${data.errmsg}`);
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 120) * 1000 };
  return tokenCache.token;
}

const tools = [
  {
    name: 'wecom_send_text',
    description: '向企业微信用户/部门/标签发送文本消息。参数 content(必填)、touser(可选，用户ID，多个用|分隔)、toparty(可选，部门ID)、totag(可选，标签ID)。至少指定一个接收者。',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        touser: { type: 'string', description: '接收用户ID，如 "UserID1|UserID2"，@all 表示全部' },
        toparty: { type: 'string', description: '接收部门ID' },
        totag: { type: 'string', description: '接收标签ID' },
      },
      required: ['content'],
    },
    handler: async (args) => {
      if (!args.touser && !args.toparty && !args.totag) throw new Error('至少指定 touser/toparty/totag 之一');
      const token = await getAccessToken();
      const agentId = requireEnv('WECOM_AGENT_ID');
      const body = {
        touser: args.touser || '', toparty: args.toparty || '', totag: args.totag || '',
        msgtype: 'text', agentid: Number(agentId), text: { content: args.content },
      };
      const res = await httpRequest({
        url: `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      const data = JSON.parse(res.body);
      if (data.errcode !== 0) throw new Error(`发送失败: ${data.errmsg}`);
      return `消息发送成功 (invaliduser=${data.invaliduser || '无'}, invalidparty=${data.invalidparty || '无'})`;
    },
  },
  {
    name: 'wecom_send_markdown',
    description: '向企业微信发送 Markdown 消息。参数 content(必填，Markdown文本)、touser/toparty/totag(接收者)。',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        touser: { type: 'string' }, toparty: { type: 'string' }, totag: { type: 'string' },
      },
      required: ['content'],
    },
    handler: async (args) => {
      if (!args.touser && !args.toparty && !args.totag) throw new Error('至少指定一个接收者');
      const token = await getAccessToken();
      const agentId = requireEnv('WECOM_AGENT_ID');
      const body = {
        touser: args.touser || '', toparty: args.toparty || '', totag: args.totag || '',
        msgtype: 'markdown', agentid: Number(agentId), markdown: { content: args.content },
      };
      const res = await httpRequest({
        url: `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      const data = JSON.parse(res.body);
      if (data.errcode !== 0) throw new Error(`发送失败: ${data.errmsg}`);
      return 'Markdown 消息发送成功';
    },
  },
  {
    name: 'wecom_department_list',
    description: '获取企业微信部门列表。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const token = await getAccessToken();
      const res = await httpRequest({ url: `https://qyapi.weixin.qq.com/cgi-bin/department/list?access_token=${token}` });
      const data = JSON.parse(res.body);
      if (data.errcode !== 0) throw new Error(`获取失败: ${data.errmsg}`);
      return (data.department || []).map((d) => `ID=${d.id} 名称=${d.name} 父部门=${d.parentid}`).join('\n') || '无部门';
    },
  },
  {
    name: 'wecom_user_get',
    description: '获取企业微信成员详情。参数 userid(必填)。',
    inputSchema: { type: 'object', properties: { userid: { type: 'string' } }, required: ['userid'] },
    handler: async (args) => {
      const token = await getAccessToken();
      const res = await httpRequest({ url: `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${token}&userid=${encodeURIComponent(args.userid)}` });
      const data = JSON.parse(res.body);
      if (data.errcode !== 0) throw new Error(`获取失败: ${data.errmsg}`);
      return `姓名=${data.name} 部门=${data.department?.join(',')} 职位=${data.position || '无'} 手机=${data.mobile || '无'} 邮箱=${data.email || '无'} 状态=${data.status}`;
    },
  },
  {
    name: 'wecom_external_contact_list',
    description: '获取企业微信外部联系人（客户）列表。参数 userid(必填，成员UserID，查该成员的客户)、limit(可选，默认20，最大100)。返回客户姓名、公司、备注等。',
    inputSchema: {
      type: 'object',
      properties: {
        userid: { type: 'string', description: '成员UserID，如 "ZhangSan"' },
        limit: { type: 'number', description: '返回数量上限，默认20' },
      },
      required: ['userid'],
    },
    handler: async (args) => {
      const token = await getAccessToken();
      const limit = args.limit || 20;
      // 1. 获取外部联系人ID列表
      const listRes = await httpRequest({
        url: `https://qyapi.weixin.qq.com/cgi-bin/externalcontact/list?access_token=${token}&userid=${encodeURIComponent(args.userid)}`,
      });
      const listData = JSON.parse(listRes.body);
      if (listData.errcode !== 0) throw new Error(`获取客户列表失败: ${listData.errmsg}`);
      const externalUserIds = (listData.external_userid || []).slice(0, limit);
      if (externalUserIds.length === 0) return '该成员暂无外部联系人';
      // 2. 逐个获取详情
      const results = [];
      for (const eid of externalUserIds) {
        const detailRes = await httpRequest({
          url: `https://qyapi.weixin.qq.com/cgi-bin/externalcontact/get?access_token=${token}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ external_userid: eid }),
        });
        const detail = JSON.parse(detailRes.body);
        if (detail.errcode === 0 && detail.external_contact) {
          const c = detail.external_contact;
          const follow = detail.follow_user?.[0] || {};
          results.push(`姓名=${c.name || '未知'} 公司=${c.corp_name || '个人'} 职位=${c.position || '无'} 备注=${follow.remark || '无'} 描述=${follow.description || '无'}`);
        }
      }
      return results.join('\n') || '未获取到客户详情';
    },
  },
];

createMcpServer({ name: 'wecom-mcp', version: '1.0.0', tools });
