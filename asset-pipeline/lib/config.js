#!/usr/bin/env node
/**
 * feihong-asset-pipeline 配置
 * 优先级：环境变量 > 创作中心 app.js 内嵌配置 > Agnes config.json > 默认值
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_BASE = 'https://api.agnes-ai.cn/v1';
const DEFAULT_IMAGE_MODEL = 'agnes-image-2.5-flash';
const DEFAULT_VIDEO_MODEL = 'agnes-video-2.5-flash';
const DEFAULT_ROOT = path.join('H:\\', '飞虹素材库');

// 创作中心前端路径（飞虹Code 仓库内）
const APP_JS_CANDIDATES = [
  path.join('H:\\', 'Muse Code复刻', 'app-mobile', 'js', 'app.js'),
  path.join(__dirname, '..', '..', 'app-mobile', 'js', 'app.js'),
];

// Agnes 桌面端配置
const AGNES_CONFIG = path.join('H:\\', 'AgnesAI-3.1.1', 'config', 'config.json');

function extractKeyFromAppJs() {
  for (const p of APP_JS_CANDIDATES) {
    try {
      const text = fs.readFileSync(p, 'utf-8');
      // 创作中心「一键填充 Agnes」里的 key
      const m = text.match(/var key = '([^']+)'/);
      if (m && m[1]) return m[1];
    } catch (_) { /* 忽略 */ }
  }
  return '';
}

function extractKeyFromAgnesConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(AGNES_CONFIG, 'utf-8'));
    return cfg.api_key || '';
  } catch (_) { return ''; }
}

function loadConfig(overrides = {}) {
  const cfg = {
    base: process.env.AGNES_API_BASE || DEFAULT_BASE,
    apiKey: process.env.AGNES_API_KEY || extractKeyFromAppJs() || extractKeyFromAgnesConfig(),
    imageModel: process.env.AGNES_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    videoModel: process.env.AGNES_VIDEO_MODEL || DEFAULT_VIDEO_MODEL,
    assetRoot: process.env.FEHONG_ASSET_ROOT || DEFAULT_ROOT,
    pollIntervalMs: 8000,
    pollTimeoutMs: 900000,
    downloadRetries: 4,
    downloadTimeoutMs: 300000,
  };
  // 仅覆盖非 undefined 的覆盖项，保留默认值
  const merged = Object.assign({}, cfg);
  for (const k of Object.keys(overrides)) {
    if (overrides[k] !== undefined) merged[k] = overrides[k];
  }
  return merged;
}

module.exports = { loadConfig, DEFAULT_BASE, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL };
