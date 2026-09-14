#!/usr/bin/env node
/**
 * Agnes 上游 API 客户端（对齐创作中心契约）
 * - 文生图: POST /images/generations（支持 url / b64_json 双通道）
 * - 文生视频/图生视频: POST /videos → 轮询 GET /agnesapi?video_id=
 * 注：必须使用内置 fetch（undici），https.request 的 TLS 指纹会被 Cloudflare 拦截（403）。
 */
'use strict';

function request(method, base, apiPath, { headers = {}, body, timeout = 180000 } = {}) {
  // 注意：apiPath 去掉前导 / 作为相对路径拼接，保留 base 的路径段（如 /v1）
  const url = new URL(apiPath.replace(/^\//, ''), base.replace(/\/+$/, '') + '/').toString();

  async function once() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const resp = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        redirect: 'follow',
      });
      const text = await resp.text();
      if (!resp.ok) {
        const err = new Error(`Agnes API ${resp.status}: ${text.slice(0, 400)}`);
        err.status = resp.status;
        err.body = text;
        throw err;
      }
      let json = null;
      try { json = JSON.parse(text); } catch (_) { /* 非 JSON */ }
      return json === null ? text : json;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`请求超时（${timeout / 1000}s）`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // Cloudflare 间歇 403：退避重试 3 次（5s / 15s / 30s）
  return (async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await once();
      } catch (err) {
        const retryable = err.status === 403 || err.status === 429 || err.status >= 500;
        if (!retryable || attempt >= 3) throw err;
        const wait = [5000, 15000, 30000][attempt - 1] || 30000;
        await sleep(wait);
      }
    }
  })();
}

function authHeaders(cfg) {
  return { Authorization: `Bearer ${cfg.apiKey}` };
}

/** 文生图 / 图生图 → { dataUrl, mime, b64 }（imageB64 传参考图即为图生图） */
async function generateImage(cfg, { prompt, size = '1024x1024', model, responseFormat = 'b64_json', imageB64 = '' }) {
  const body = { model: model || cfg.imageModel, prompt, n: 1, size };
  if (imageB64) {
    // 图生图（general 模型）不支持 response_format，仅传 image
    body.image = [imageB64];
  } else {
    body.response_format = responseFormat;
  }
  const resp = await request('POST', cfg.base, '/images/generations', {
    headers: authHeaders(cfg),
    body,
  });
  const item = (resp.data || [{}])[0];
  const b64 = item.b64_json || '';
  const url = item.url || '';
  if (!b64 && !url) {
    throw new Error('响应中未找到图片数据: ' + JSON.stringify(resp).slice(0, 300));
  }
  return { url, b64, dataUrl: b64 ? `data:image/png;base64,${b64}` : url };
}

/** 创建视频任务 → taskId（图生视频：mode=keyframe + first_frame） */
async function createVideo(cfg, { prompt, seconds = '5', ratio = '16:9', mode = 'text', imageB64 = '', model }) {
  const body = {
    model: model || cfg.videoModel,
    prompt,
    seconds: String(seconds),
    size: '720P',
  };
  if (imageB64) {
    // 图生视频：keyframe 模式 + 首帧（纯 base64）
    body.mode = 'keyframe';
    body.first_frame = imageB64.includes(',') ? imageB64.split(',')[1] : imageB64;
  } else {
    // 文生视频：text 模式 + 宽高比
    body.mode = 'text';
    body.aspect_ratio = ratio;
  }
  const resp = await request('POST', cfg.base, '/videos', {
    headers: authHeaders(cfg),
    body,
  });
  const taskId = resp.id || (resp.data && resp.data.id);
  if (!taskId) throw new Error('响应中未找到任务ID: ' + JSON.stringify(resp).slice(0, 300));
  return taskId;
}

/** 轮询视频任务 → { status, url } */
async function pollVideo(cfg, taskId) {
  const resp = await request('GET', cfg.base, `/agnesapi?video_id=${encodeURIComponent(taskId)}`, {
    headers: authHeaders(cfg),
    timeout: 30000,
  });
  const status = resp.status || (resp.data && resp.data.status) || '';
  const url =
    resp.video_url || resp.url ||
    (resp.data && (resp.data.video_url || resp.data.url)) ||
    (resp.metadata && (resp.metadata.url || resp.metadata.video_url)) ||
    (resp.output && resp.output.url) ||
    (resp.result && resp.result.url) ||
    '';
  return { status, url };
}

/** 等待任务完成 → 视频 URL */
async function waitVideo(cfg, taskId, { onProgress } = {}) {
  const start = Date.now();
  while (Date.now() - start < cfg.pollTimeoutMs) {
    const { status, url } = await pollVideo(cfg, taskId);
    if (url) return url;
    if (status === 'failed' || status === 'error') {
      throw new Error(`视频任务失败: ${status}`);
    }
    if (status === 'succeeded' || status === 'completed' || status === 'success') {
      throw new Error('任务完成但未返回视频地址');
    }
    if (onProgress) onProgress(status);
    await sleep(cfg.pollIntervalMs);
  }
  throw new Error(`视频任务超时（${cfg.pollTimeoutMs / 1000}s）`);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = { generateImage, createVideo, pollVideo, waitVideo, request, sleep };
