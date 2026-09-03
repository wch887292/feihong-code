/**
 * 飞书 + 元宝桥接冒烟测试
 */
const crypto = require('crypto');

// 飞书桥接
const {
  loadFeishuConfig, isFeishuEnabled, decryptFeishuEvent, parseFeishuEvent,
} = require('../dist/integrations/feishu-bridge');

// 元宝桥接
const {
  loadYuanbaoConfig, isYuanbaoEnabled, verifyYuanbaoSignature, parseYuanbaoMessage,
} = require('../dist/integrations/yuanbao-bridge');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('=== 1. 飞书配置加载 ===');
const fcfg = loadFeishuConfig();
check('loadFeishuConfig 返回配置', !!fcfg);
check('默认未启用', isFeishuEnabled(fcfg) === false);
check('workspace 已设置', !!fcfg.workspace, fcfg.workspace);

process.env.FH_FEISHU_ENABLED = 'true';
process.env.FH_FEISHU_APP_ID = 'cli_test123';
process.env.FH_FEISHU_APP_SECRET = 'secret_test';
process.env.FH_FEISHU_VERIFICATION_TOKEN = 'token_test';
const fcfg2 = loadFeishuConfig();
check('启用后识别', isFeishuEnabled(fcfg2) === true);
check('appId 正确', fcfg2.appId === 'cli_test123');
check('verificationToken 正确', fcfg2.verificationToken === 'token_test');

console.log('\n=== 2. 飞书事件解析 ===');
// URL 验证事件
const urlVerifyEvent = { type: 'url_verification', challenge: 'test_challenge', token: 'token_test' };
check('URL验证事件返回null', parseFeishuEvent(urlVerifyEvent) === null);

// 消息事件 v2.0
const messageEvent = {
  schema: '2.0',
  header: {
    event_id: 'evt_123',
    event_type: 'im.message.receive_v1',
    token: 'token_test',
    app_id: 'cli_test123',
  },
  event: {
    sender: { sender_id: { open_id: 'ou_test123', user_id: 'uid_123' }, sender_type: 'user' },
    message: {
      message_id: 'om_123',
      chat_type: 'p2p',
      chat_id: 'oc_123',
      message_type: 'text',
      content: JSON.stringify({ text: '帮我写个Python脚本' }),
    },
  },
};
const fmsg = parseFeishuEvent(messageEvent);
check('消息事件解析成功', !!fmsg);
check('eventId 正确', fmsg.eventId === 'evt_123');
check('openId 正确', fmsg.openId === 'ou_test123');
check('messageId 正确', fmsg.messageId === 'om_123');
check('messageType=text', fmsg.messageType === 'text');
check('text 内容正确', fmsg.text === '帮我写个Python脚本');
check('chatType=p2p', fmsg.chatType === 'p2p');
check('userId 正确', fmsg.userId === 'uid_123');

// 非消息事件
const nonMsgEvent = {
  schema: '2.0',
  header: { event_id: 'evt_456', event_type: 'im.chat.member.bot.added_v1', token: 'token_test' },
  event: {},
};
check('非消息事件返回null', parseFeishuEvent(nonMsgEvent) === null);

console.log('\n=== 3. 飞书事件解密 ===');
// 生成测试用的 encrypt_key 和加密数据
const encryptKey = 'test_encrypt_key_1234567890';
const key = crypto.createHash('sha256').update(encryptKey).digest();
const iv = crypto.randomBytes(16);
const plainText = JSON.stringify({ challenge: 'decrypted_challenge', type: 'url_verification', token: 'token_test' });
// createCipheriv 默认自动 PKCS7 填充，不需要手动填充
const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
const encrypted = Buffer.concat([iv, cipher.update(plainText, 'utf8'), cipher.final()]);
const encryptedBase64 = encrypted.toString('base64');

const decrypted = decryptFeishuEvent(encryptKey, encryptedBase64);
check('事件解密成功', !!decrypted);
const decryptedObj = JSON.parse(decrypted);
check('解密后 challenge 正确', decryptedObj.challenge === 'decrypted_challenge');
check('解密后 type 正确', decryptedObj.type === 'url_verification');

console.log('\n=== 4. 元宝配置加载 ===');
const ycfg = loadYuanbaoConfig();
check('loadYuanbaoConfig 返回配置', !!ycfg);
check('默认未启用', isYuanbaoEnabled(ycfg) === false);
check('默认 endpoint', ycfg.endpoint.includes('volces.com'), ycfg.endpoint);

process.env.FH_YUANBAO_ENABLED = 'true';
process.env.FH_YUANBAO_API_KEY = 'yb_api_key_test';
process.env.FH_YUANBAO_WEBHOOK_SECRET = 'yb_secret_test';
process.env.FH_YUANBAO_AGENT_ID = 'agent_123';
const ycfg2 = loadYuanbaoConfig();
check('启用后识别', isYuanbaoEnabled(ycfg2) === true);
check('apiKey 正确', ycfg2.apiKey === 'yb_api_key_test');
check('agentId 正确', ycfg2.agentId === 'agent_123');
check('webhookSecret 正确', ycfg2.webhookSecret === 'yb_secret_test');

console.log('\n=== 5. 元宝签名校验 ===');
const secret = 'yb_secret_test';
const rawBody = JSON.stringify({ message_id: 'msg_1', user_id: 'user_1', content: '你好' });
const timestamp = '1234567890';
const expectedSig = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

check('正确签名通过', verifyYuanbaoSignature(secret, rawBody, timestamp, expectedSig) === true);
check('错误签名拒绝', verifyYuanbaoSignature(secret, rawBody, timestamp, 'sha256=wrong') === false);
check('空secret拒绝', verifyYuanbaoSignature('', rawBody, timestamp, expectedSig) === false);
check('空签名拒绝', verifyYuanbaoSignature(secret, rawBody, timestamp, '') === false);
check('错误时间戳拒绝', verifyYuanbaoSignature(secret, rawBody, 'wrong', expectedSig) === false);

console.log('\n=== 6. 元宝消息解析 ===');
const ybody = {
  message_id: 'msg_123',
  user_id: 'user_456',
  content: '帮我分析代码',
  type: 'text',
  timestamp: 1234567890,
  metadata: { source: 'yuanbao' },
};
const ymsg = parseYuanbaoMessage(ybody);
check('messageId 正确', ymsg.messageId === 'msg_123');
check('userId 正确', ymsg.userId === 'user_456');
check('type=text', ymsg.type === 'text');
check('content 正确', ymsg.content === '帮我分析代码');
check('timestamp 正确', ymsg.timestamp === 1234567890);
check('metadata 正确', ymsg.metadata.source === 'yuanbao');

// 兼容字段命名
const ybody2 = { msgId: 'msg_789', userId: 'user_789', text: '备用字段', msg_type: 'text' };
const ymsg2 = parseYuanbaoMessage(ybody2);
check('兼容 msgId 字段', ymsg2.messageId === 'msg_789');
check('兼容 userId 字段', ymsg2.userId === 'user_789');
check('兼容 text 字段', ymsg2.content === '备用字段');
check('兼容 msg_type 字段', ymsg2.type === 'text');

console.log('\n========== 汇总 ==========');
console.log('PASS: ' + pass + '  FAIL: ' + fail);
console.log(fail === 0 ? '✅ 全部冒烟测试通过' : '❌ 存在失败项');

// 清理环境变量
delete process.env.FH_FEISHU_ENABLED;
delete process.env.FH_FEISHU_APP_ID;
delete process.env.FH_FEISHU_APP_SECRET;
delete process.env.FH_FEISHU_VERIFICATION_TOKEN;
delete process.env.FH_YUANBAO_ENABLED;
delete process.env.FH_YUANBAO_API_KEY;
delete process.env.FH_YUANBAO_WEBHOOK_SECRET;
delete process.env.FH_YUANBAO_AGENT_ID;

process.exit(fail === 0 ? 0 : 1);
