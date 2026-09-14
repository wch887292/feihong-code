#!/usr/bin/env node
/**
 * 归档器：按规范目录存储 + manifest.json + 清单.csv + 去重
 *
 * 目录规范：
 *   素材库/{项目}/{YYYY-MM-DD}/{序号}_{名称}.{ext}
 * 元数据：
 *   素材库/{项目}/manifest.json   （全量 JSON）
 *   素材库/{项目}/清单.csv         （Excel 可打开，UTF-8 BOM）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MEDIA_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4']);

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
  };
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function manifestPath(root, project) {
  return path.join(root, project, 'manifest.json');
}

function loadManifest(root, project) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(root, project), 'utf-8'));
  } catch (_) {
    return [];
  }
}

function nextSeq(records, date) {
  const max = records
    .filter((r) => r.date === date)
    .reduce((m, r) => Math.max(m, parseInt(r.seq, 10) || 0), 0);
  return String(max + 1).padStart(2, '0');
}

/** 保存一条记录；返回 { saved: bool, file, record } */
function saveRecord(root, { project, name, type, ext, prompt, model, url, bytes, buffer, extra = {} }) {
  if (!project || !name || !ext) throw new Error('归档缺少 project/name/ext');
  const now = today();
  const projectDir = path.join(root, project);
  const dateDir = path.join(projectDir, now.date);
  fs.mkdirSync(dateDir, { recursive: true });

  const records = loadManifest(root, project);
  const hash = sha256(buffer);

  // 去重：URL 相同或 sha256 相同
  const dup = records.find((r) => (url && r.url === url) || r.sha256 === hash);
  if (dup) {
    return { saved: false, existing: dup, file: path.join(projectDir, dup.file), record: dup };
  }

  const seq = nextSeq(records, now.date);
  const safeName = String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const filename = `${seq}_${safeName}.${ext}`;
  const relFile = path.join(now.date, filename);
  fs.writeFileSync(path.join(dateDir, filename), buffer);

  const record = {
    date: now.date,
    time: now.time,
    project,
    file: relFile,
    name: safeName,
    type,
    model,
    size: extra.size || '',
    prompt,
    url: url || '',
    bytes,
    sha256: hash,
    seq,
    ...extra,
  };
  records.push(record);
  fs.writeFileSync(manifestPath(root, project), JSON.stringify(records, null, 2), 'utf-8');
  writeCsv(root, project, records);
  return { saved: true, file: path.join(dateDir, filename), record };
}

function writeCsv(root, project, records) {
  const cols = ['日期', '时间', '项目', '文件', '名称', '类型', '模型', '大小', '字节数', 'URL', 'SHA256', 'Prompt'];
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.join(',')];
  for (const r of records) {
    lines.push([r.date, r.time, r.project, r.file, r.name, r.type, r.model, r.size, r.bytes, r.url, r.sha256, r.prompt]
      .map(esc).join(','));
  }
  // UTF-8 BOM 便于 Excel 识别中文
  fs.writeFileSync(path.join(root, project, '清单.csv'), '\uFEFF' + lines.join('\r\n'), 'utf-8');
}

/** 列出素材 */
function listAssets(root, { project } = {}) {
  const dirs = project ? [project] : fs.readdirSync(root).filter((d) => {
    try { return fs.statSync(path.join(root, d)).isDirectory(); } catch (_) { return false; }
  });
  const out = [];
  for (const p of dirs) {
    const records = loadManifest(root, p);
    out.push({ project: p, count: records.length, records });
  }
  return out;
}

/** 扫描目录中媒体文件，复制（默认）或移动入库 */
function archiveDir(root, srcDir, { project = '未分类', move = false } = {}) {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (MEDIA_EXT.has(path.extname(e.name).slice(1).toLowerCase())) files.push(full);
    }
  };
  walk(srcDir);
  const results = [];
  for (const f of files.sort()) {
    const buf = fs.readFileSync(f);
    const ext = path.extname(f).slice(1).toLowerCase().replace('jpeg', 'jpg');
    const name = path.basename(f, path.extname(f));
    const type = ext === 'mp4' ? 'video' : 'image';
    const r = saveRecord(root, { project, name, type, ext, prompt: '', model: '（归档）', url: '', bytes: buf.length, buffer: buf });
    if (r.saved && move) {
      // 用户偏好：移动前先验证（文件已在库中成功写入），确认无误后再删除源文件
      const dest = r.file;
      if (fs.existsSync(dest) && fs.statSync(dest).size === buf.length) {
        fs.unlinkSync(f);
      } else {
        throw new Error(`归档验证失败，未删除源文件: ${f}`);
      }
    }
    results.push({ source: f, dest: r.file, saved: r.saved });
  }
  return results;
}

module.exports = { saveRecord, listAssets, archiveDir, today, sha256, manifestPath, loadManifest };
