#!/usr/bin/env node
/**
 * 下载器：URL / data-URI → 本地文件
 * - 重试退避、超时控制、文件头校验、最小大小校验
 * 注：使用内置 fetch（undici），与 Agnes API 通道一致。
 */
'use strict';

const fs = require('fs');

const MAGIC = {
  png: [[0x89, 0x50, 0x4e, 0x47]],
  jpg: [[0xff, 0xd8, 0xff]],
  gif: [[0x47, 0x49, 0x46, 0x38]],
  webp: [[0x52, 0x49, 0x46, 0x46]],
  mp4: [[0x00, 0x00, 0x00], [0x66, 0x74, 0x79, 0x70]],
};

function extForUrl(url) {
  const m = url.match(/\.(png|jpe?g|gif|webp|mp4)(\?|$)/i);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  return '';
}

function checkMagic(buffer, ext) {
  const signatures = MAGIC[ext];
  if (!signatures) return true; // 未知类型不校验
  for (const sig of signatures) {
    if (buffer.length >= sig.length && sig.every((b, i) => buffer[i] === b)) return true;
  }
  // mp4 兼容：前 12 字节含 ftyp
  if (ext === 'mp4' && buffer.length >= 12) {
    const head = buffer.slice(0, 12);
    if (head.indexOf(Buffer.from('ftyp')) !== -1) return true;
  }
  return false;
}

/**
 * 下载到 dest。返回 { bytes, ext }
 */
async function downloadTo(urlStr, dest, { retries = 3, timeoutMs = 300000, minBytes = 10000 } = {}) {
  const ext = extForUrl(urlStr);
  let lastErr = null;

  // data URI 直写
  if (urlStr.startsWith('data:')) {
    const m = urlStr.match(/^data:([^;]+);base64,(.+)$/s);
    if (!m) throw new Error('不支持的 data URI');
    const buf = Buffer.from(m[2], 'base64');
    fs.writeFileSync(dest, buf);
    return { bytes: buf.length, ext: m[1].split('/')[1] || ext };
  }

  for (let i = 1; i <= retries; i++) {
    let ctrl = null;
    let timer = null;
    try {
      ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(urlStr, {
        redirect: 'follow',
        signal: ctrl.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const chunks = [];
      for await (const c of resp.body) chunks.push(c);
      const buf = Buffer.concat(chunks);
      if (buf.length < minBytes) throw new Error(`文件过小（${buf.length}B < ${minBytes}B）`);
      if (!checkMagic(buf, ext)) throw new Error(`文件头校验失败（${ext || '未知'}）`);
      fs.writeFileSync(dest, buf);
      return { bytes: buf.length, ext };
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise((r) => setTimeout(r, 2000 * i));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('下载失败');
}

module.exports = { downloadTo, extForUrl, checkMagic };
