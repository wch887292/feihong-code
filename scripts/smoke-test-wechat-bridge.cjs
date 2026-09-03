/**
 * 微信桥接冒烟测试
 * 验证：配置加载、XML解析、加解密、签名校验、消息处理流程
 */
const {
  loadWechatConfig, isWechatEnabled, WechatCrypto, parseXmlTag, parseWechatMessage,
  verifyMpSignature, buildTextReply,
} = require('../dist/integrations/wechat-bridge');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('=== 1. 配置加载 ===');
const cfg = loadWechatConfig();
check('loadWechatConfig 返回配置', !!cfg);
check('默认 mode=none', cfg.mode === 'none', 'mode=' + cfg.mode);
check('默认未启用', isWechatEnabled(cfg) === false);
check('workspace 已设置', !!cfg.workspace, cfg.workspace);

// 模拟企业微信配置
process.env.FH_WECHAT_MODE = 'wecom';
process.env.FH_WECOM_CORPID = 'test-corpid';
process.env.FH_WECOM_CORPSECRET = 'test-secret';
process.env.FH_WECOM_AGENTID = '1000002';
process.env.FH_WECOM_TOKEN = 'test-token';
const cfg2 = loadWechatConfig();
check('企业微信模式识别', cfg2.mode === 'wecom');
check('企业微信配置完整时启用', isWechatEnabled(cfg2) === true, 'corpid=' + cfg2.corpid + ' agentid=' + cfg2.agentid);

console.log('\n=== 2. XML 解析 ===');
const testXml = `<xml>
<ToUserName><![CDATA[toUser]]></ToUserName>
<FromUserName><![CDATA[fromUser]]></FromUserName>
<CreateTime>1348831860</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[你好，帮我写个Python脚本]]></Content>
<MsgId>1234567890123456</MsgId>
</xml>`;
check('parseXmlTag ToUserName', parseXmlTag(testXml, 'ToUserName') === 'toUser');
check('parseXmlTag FromUserName', parseXmlTag(testXml, 'FromUserName') === 'fromUser');
check('parseXmlTag Content', parseXmlTag(testXml, 'Content') === '你好，帮我写个Python脚本');
check('parseXmlTag MsgId', parseXmlTag(testXml, 'MsgId') === '1234567890123456');

const msg = parseWechatMessage(testXml);
check('parseWechatMessage fromUser', msg.fromUser === 'fromUser');
check('parseWechatMessage toUser', msg.toUser === 'toUser');
check('parseWechatMessage msgType=text', msg.msgType === 'text');
check('parseWechatMessage content', msg.content === '你好，帮我写个Python脚本');
check('parseWechatMessage msgId', msg.msgId === '1234567890123456');

console.log('\n=== 3. 消息加解密 ===');
// 生成合法的 43 位 encodingAESKey（base64 编码 32 字节 key，去掉末尾 =）
const crypto = require('crypto');
const rawKey = crypto.randomBytes(32);
const aesKey = rawKey.toString('base64').slice(0, 43);
check('encodingAESKey 长度 43', aesKey.length === 43, 'len=' + aesKey.length);

const wc = new WechatCrypto(aesKey);
const plainText = '测试消息内容123';
const receiveId = 'wx123456';
const encrypted = wc.encrypt(plainText, receiveId);
check('encrypt 返回 base64 字符串', typeof encrypted === 'string' && encrypted.length > 0);

const decrypted = wc.decrypt(encrypted);
check('decrypt 还原明文', decrypted.plainText === plainText, 'got=' + decrypted.plainText);
check('decrypt 还原 receiveId', decrypted.receiveId === receiveId, 'got=' + decrypted.receiveId);

// 长消息加解密
const longText = 'A'.repeat(1000);
const encLong = wc.encrypt(longText, receiveId);
const decLong = wc.decrypt(encLong);
check('长消息加解密一致', decLong.plainText === longText, 'len=' + decLong.plainText.length);

console.log('\n=== 4. 签名校验 ===');
// 公众号签名
const token = 'test-token';
const timestamp = '1409659813';
const nonce = 'nonce';
const sorted = [token, timestamp, nonce].sort().join('');
const expectedSig = crypto.createHash('sha1').update(sorted).digest('hex');
check('verifyMpSignature 正确签名通过', verifyMpSignature(token, timestamp, nonce, expectedSig) === true);
check('verifyMpSignature 错误签名拒绝', verifyMpSignature(token, timestamp, nonce, 'wrong') === false);
check('verifyMpSignature 空 token 拒绝', verifyMpSignature('', timestamp, nonce, expectedSig) === false);

console.log('\n=== 5. 被动回复构建 ===');
const reply = buildTextReply(msg, '这是回复内容');
check('回复包含 ToUserName', reply.includes('fromUser'));
check('回复包含 FromUserName', reply.includes('toUser'));
check('回复包含 MsgType=text', reply.includes('text'));
check('回复包含内容', reply.includes('这是回复内容'));
check('回复是 XML 格式', reply.startsWith('<xml>') && reply.includes('</xml>'));

console.log('\n=== 6. 事件消息解析 ===');
const eventXml = `<xml>
<ToUserName><![CDATA[toUser]]></ToUserName>
<FromUserName><![CDATA[fromUser]]></FromUserName>
<CreateTime>1348831860</CreateTime>
<MsgType><![CDATA[event]]></MsgType>
<Event><![CDATA[subscribe]]></Event>
</xml>`;
const eventMsg = parseWechatMessage(eventXml);
check('事件消息 msgType=event', eventMsg.msgType === 'event');
check('事件消息 event=subscribe', eventMsg.event === 'subscribe');

console.log('\n=== 7. 加密消息解析流程 ===');
// 构建加密的微信回调 XML
const innerXml = `<xml><ToUserName><![CDATA[toUser]]></ToUserName><FromUserName><![CDATA[fromUser]]></FromUserName><CreateTime>1348831860</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[加密测试]]></Content><MsgId>123</MsgId></xml>`;
const encMsg = wc.encrypt(innerXml, 'wx123456');
const encXml = `<xml><ToUserName><![CDATA[toUser]]></ToUserName><Encrypt><![CDATA[${encMsg}]]></Encrypt></xml>`;
const encTag = parseXmlTag(encXml, 'Encrypt');
check('加密 XML 可提取 Encrypt 标签', !!encTag);
const decInner = wc.decrypt(encTag);
check('加密消息可解密为 XML', decInner.plainText.includes('<xml>'));
const decMsg = parseWechatMessage(decInner.plainText);
check('解密后消息内容正确', decMsg.content === '加密测试');

console.log('\n========== 汇总 ==========');
console.log('PASS: ' + pass + '  FAIL: ' + fail);
console.log(fail === 0 ? '✅ 全部冒烟测试通过' : '❌ 存在失败项');

// 清理环境变量
delete process.env.FH_WECHAT_MODE;
delete process.env.FH_WECOM_CORPID;
delete process.env.FH_WECOM_CORPSECRET;
delete process.env.FH_WECOM_AGENTID;
delete process.env.FH_WECOM_TOKEN;

process.exit(fail === 0 ? 0 : 1);
