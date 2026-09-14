/**
 * Agnes AI Studio 本地服务（v3.1.1, 127.0.0.1:8765）客户端
 * 「技能接入」：把 agnes-ai-studio-assistant 的本地生成能力收进 fhcode。
 */
'use strict';

const BASE = process.env.AGNES_LOCAL_BASE || 'http://127.0.0.1:8765';
const START_CMD = process.env.AGNES_LOCAL_PY || 'C:\\Python314\\python.exe';
const APP_DIR = process.env.AGNES_LOCAL_DIR || 'H:\\AgnesAI-3.1.1';
const STARTUP_WAIT_MS = 90000;

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.detail || data.message || data.raw || '请求失败'}`);
  return data;
}

/** 健康检查 */
async function health() {
  return req('/api/health');
}

/** 启动本地服务（detached 后台进程），轮询等待就绪 */
async function start() {
  const { spawn } = require('child_process');
  const cp = spawn(START_CMD, ['web_app.py'], {
    cwd: APP_DIR,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  cp.unref();
  const t0 = Date.now();
  while (Date.now() - t0 < STARTUP_WAIT_MS) {
    try {
      const h = await health();
      return { started: true, pid: cp.pid, health: h };
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error(`本地服务启动超时（${STARTUP_WAIT_MS / 1000}s 内未就绪）`);
}

/** 文生图 / 图生图（inputImages 传纯 base64 数组），返回 { url, localPath } */
async function generateImage({ prompt, model = 'agnes-image-2.1-flash', size = '1024x1024', inputImages = [] }) {
  const d = await req('/api/image/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt, model, size, count: 1, input_images: inputImages }),
  });
  const img = (d.images || [])[0] || {};
  return { url: img.url || '', localPath: img.local_path || '' };
}

/** 创建视频任务 → task record（mode: text 文生 / image 图生） */
async function createVideo({ prompt, model = 'agnes-video-v2.0', mode = 'text', resolution = '1152x768', durationSeconds = 5, imageB64 = '' }) {
  const body = {
    prompt,
    model,
    mode,
    resolution,
    duration_seconds: durationSeconds,
    fps: 24,
  };
  if (mode === 'image' && imageB64) {
    body.image_base64 = imageB64.includes(',') ? imageB64.split(',')[1] : imageB64;
  }
  return req('/api/video/create', { method: 'POST', body: JSON.stringify(body) });
}

/** 轮询视频任务 → { status, progress, video_url, error } */
async function pollVideo(taskId) {
  return req('/api/video/poll/' + encodeURIComponent(taskId));
}

module.exports = { BASE, health, start, generateImage, createVideo, pollVideo };
