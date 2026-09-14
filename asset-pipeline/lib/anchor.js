/**
 * Agnes AI Studio V16（Flask 5000）数字人模块客户端
 * 「数字人接入」：把 agnes-ai-studio-assistant 技能的数字人口播能力收进 fhcode。
 */
'use strict';

const BASE = process.env.AGNES_V16_BASE || 'http://127.0.0.1:5000';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
  if (!res.ok || data.success === false) {
    throw new Error(`HTTP ${res.status}: ${data.error || data.message || data.raw || '请求失败'}`);
  }
  return data;
}

/** 音色 / 情感风格 / 语速 */
async function voices() {
  return req('/api/anchor/voices');
}

/** 模型选项 */
async function models() {
  return req('/api/anchor/models');
}

/** 上传形象/参考音频（multipart），返回 { filename, url } */
async function upload(filePath, kind = 'image') {
  const fs = require('fs');
  const path = require('path');
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = kind === 'audio'
    ? (/\.(mp3)$/i.test(ext) ? 'audio/mpeg' : /\.(m4a|aac)$/i.test(ext) ? 'audio/mp4' : /\.(ogg)$/i.test(ext) ? 'audio/ogg' : /\.(flac)$/i.test(ext) ? 'audio/flac' : 'audio/wav')
    : /\.(png)$/i.test(ext) ? 'image/png' : /\.(webp)$/i.test(ext) ? 'image/webp' : /\.(bmp)$/i.test(ext) ? 'image/bmp' : /\.(mp4)$/i.test(ext) ? 'video/mp4' : /\.(mov)$/i.test(ext) ? 'video/quicktime' : 'image/jpeg';
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', new Blob([buf], { type: mime }), path.basename(filePath));
  const res = await fetch(BASE + '/api/anchor/upload', { method: 'POST', body: fd });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
  if (!res.ok || data.success === false) throw new Error(`HTTP ${res.status}: ${data.error || data.raw || '上传失败'}`);
  return data;
}

/** 提交数字人口播任务 → task_id */
async function generate({ script, mode = 'A', voice, style, speed, avatarFile = '', videoPrompt = '', minDuration = 5, textModel, imageModel, videoModel, audioSource = 'tts', audioFile = '', motionStyle = '', motionCustom = '' }) {
  const body = {
    script,
    mode,
    min_duration: minDuration,
    audio_source: audioSource,
  };
  if (voice) body.voice = voice;
  if (style) body.style = style;
  if (speed) body.speed = speed;
  if (avatarFile) body.avatar_file = avatarFile;
  if (videoPrompt) body.video_prompt = videoPrompt;
  if (textModel) body.text_model = textModel;
  if (imageModel) body.image_model = imageModel;
  if (videoModel) body.video_model = videoModel;
  if (audioFile) body.audio_file = audioFile;
  if (motionStyle) body.motion_style = motionStyle;
  if (motionCustom) body.motion_custom = motionCustom;
  const d = await req('/api/anchor/generate', { method: 'POST', body: JSON.stringify(body) });
  return d.task_id;
}

/** 查询任务状态 → task */
async function status(taskId) {
  const d = await req('/api/anchor/status?task_id=' + encodeURIComponent(taskId));
  return d.task;
}

module.exports = { BASE, voices, models, upload, generate, status };
