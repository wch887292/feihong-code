// 用 fhcode 同款 OpenAI-compatible 协议探测真实模型连通性
const endpoints = [
  { name: 'opencode/deepseek-v4-flash', base: 'https://opencode.ai/zen/v1', key: 'sk-VcQifdtS8ipKQDLFE9S09a1Fdc7F0Vlk1LmJBfzMhaUERMcj4pkmcPx6o1dJGXVN', model: 'deepseek-v4-flash' },
  { name: 'agnes/agnes-2.5-flash', base: 'https://api.agnes-ai.cn/v1', key: 'sk-SGmo9yhSYV7Pn6BwOdgzuhFTrnTlALZXpnNYsK1FsDGDLNRj', model: 'agnes-2.5-flash' },
];
for (const e of endpoints) {
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
