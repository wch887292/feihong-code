'use strict';
/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P4-1: 补全结果客户端后处理纯函数（独立模块，便于无 VS Code 环境单测）
 * 原位于 extension.js 内部，抽离后可 node --test 验证，杜绝"无验证"。
 */

/** 去掉 ```lang ... ``` 包裹，仅保留内部代码 */
function stripCodeFences(text) {
  const fence = /^```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n```$/;
  const m = text.match(fence);
  return m ? m[1] : text;
}

/** 若结尾是未闭合的短片段（常见于被截断的补全），剔除 */
function trimTrailingPartialLine(text) {
  const lines = text.split('\n');
  const last = lines[lines.length - 1];
  if (lines.length > 1 && last.trim() && !/[;{})\[\]"`']$/.test(last.trim()) && last.length < 40) {
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(last.trim())) {
      lines.pop();
      return lines.join('\n');
    }
  }
  return text;
}

/** 去除与后缀重复的 prefix（补全结果若与光标后内容开头重复则去掉）
 * 修复 P4-1: suffix 可能长于 text，需双向判断——suffix 以 text 开头同样视为重复 */
function dedupeAgainstSuffix(text, suffix) {
  if (!suffix) return text;
  const s = suffix.trimStart();
  if (!s) return text;
  if (text.startsWith(s.slice(0, Math.min(s.length, 200)))) {
    return text.slice(s.length);
  }
  // suffix 以 text 开头：光标后已存在相同文本，补全应清空避免重复
  if (text.length <= 200 && s.startsWith(text)) {
    return '';
  }
  return text;
}

/** 完整后处理流水线 */
function postProcessCompletion(text, fileContent, cursorOffset) {
  if (!text) return '';
  let out = stripCodeFences(text);
  const suffix = typeof fileContent === 'string' && typeof cursorOffset === 'number'
    ? fileContent.slice(cursorOffset)
    : (fileContent && fileContent.suffix) || '';
  out = dedupeAgainstSuffix(out, suffix);
  out = trimTrailingPartialLine(out);
  return out.replace(/\s+$/, '');
}

module.exports = {
  stripCodeFences,
  trimTrailingPartialLine,
  dedupeAgainstSuffix,
  postProcessCompletion,
};
