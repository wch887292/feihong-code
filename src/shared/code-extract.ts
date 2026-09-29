/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 从 LLM 文本回复中提取代码块：优先解析 ```lang 围栏代码块，
 * 无围栏时回退整段去空白。供语音转代码、/code-write 等「自然语言→代码」场景复用。
 */

/**
 * 从 Markdown/纯文本中提取首个围栏代码块内容。
 * 无围栏或内容为空时返回 null（由调用方决定降级策略）。
 */
export function extractCodeBlock(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```(?:[a-zA-Z0-9_+.-]+)?\s*\n([\s\S]*?)```/);
  if (fenced && fenced[1].trim()) return fenced[1].trim();
  return null;
}

/**
 * 从 LLM 回复取得可用代码：优先代码块，否则整段去首尾空白返回。
 */
export function getCodeFromCompletion(text: string): string {
  const block = extractCodeBlock(text);
  if (block) return block;
  return text.trim();
}
