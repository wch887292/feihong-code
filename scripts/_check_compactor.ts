import { compactContextByTokens } from '../src/agent/context-compactor';
const msgs: any[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: '目标：重构 auth 模块' },
  { role: 'assistant', content: '读取 auth.ts' },
  { role: 'user', content: '无关闲聊内容填充' },
  { role: 'assistant', content: '继续实现 refresh token 轮换' },
];
const r = compactContextByTokens(msgs, 'auth 重构', { maxTokens: 50, reservedForOutput: 10 });
console.log('compactor token-aware ok, messages:', r.messages.length, 'routed:', r.routed, 'compacted:', r.compacted);
