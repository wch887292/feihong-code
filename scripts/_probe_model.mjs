// 用 fhcode 同款 OpenAI-compatible 协议探测真实模型连通性
// ⚠️ 密钥一律从环境变量读取，严禁硬编码（CI 的明文密钥扫描会拦截）
const endpoints = [
  { name: 'opencode/deepseek-v4-flash', base: 'https://opencode.ai/zen/v1', key: process.env.OPENCODE_API_KEY || '', model: 'deepseek-v4-flash' },
  { name: 'agnes/agnes-2.5-flash', base: 'https://api.agnes-ai.cn/v1', key: process.env.AGNES_API_KEY || '', model: 'agnes-2.5-flash' },
];
for (const e of endpoints) {
  if (!e.key) { console.log('[' + e.name + '] SKIP：未设置 ' + (e.name.includes('opencode') ? 'OPENCODE_API_KEY' : 'AGNES_API_KEY')); continue; }
  try {
    const r = await fetch(e.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + e.key },
      body: JSON.stringify({ model: e.model, messages: [{ role: 'user', content: 'reply with exactly: OK' }], max_tokens: 8, temperature: 0 }),
    });
    const t = await r.text();
    console.log('[' + e.name + '] HTTP ' + r.status + ' -> ' + t.slice(0, 140));
  } catch (err) {
    console.log('[' + e.name + '] ERROR ' + err.message);
  }
}
