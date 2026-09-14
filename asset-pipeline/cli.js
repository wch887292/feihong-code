#!/usr/bin/env node
/**
 * feihong-asset-pipeline CLI
 * 生成 → 下载 → 归档，一条命令打通。
 *
 * 用法：
 *   node cli.js image  --prompt "..." --name 保温杯 --project 电商素材 [--size 1024x1024]
 *   node cli.js video  --prompt "..." --name 环绕运镜 --project 电商素材 [--image 参考图.png] [--seconds 5] [--ratio 16:9]
 *   node cli.js batch  --config 批量任务.json [--root 素材库根目录]
 *   node cli.js archive --dir 散乱素材目录 [--project 未分类] [--move]
 *   node cli.js list   [--project 电商素材]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./lib/config');
const agnes = require('./lib/agnes');
const local = require('./lib/local');
const anchor = require('./lib/anchor');
const { downloadTo } = require('./lib/download');
const archive = require('./lib/archive');

function arg(name, def = '') {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function flag(name) {
  return process.argv.includes('--' + name);
}

function help() {
  console.log(`飞虹Code 素材管理管线 v1.0.0
用法:
  node cli.js image  --prompt "描述" --name 名称 --project 项目 [--image 参考图.png] [--size 1024x1024] [--model 模型] [--format url|b64_json]
  node cli.js video  --prompt "描述" --name 名称 --project 项目 [--image 参考图.png] [--seconds 5] [--ratio 16:9] [--model 模型]
  node cli.js batch  --config 任务.json [--root 素材库根目录]
  node cli.js archive --dir 目录 [--project 项目] [--move]
  node cli.js fetch  --url URL或dataURI [--name 名称] [--project 项目] [--ext png|mp4|jpg] [--wait 秒数] [--max-attempts 次数]
  node cli.js check  （连通性诊断：上游 API / 海外 CDN / 国内 CDN）
  node cli.js local  status|start   （Agnes 本地服务管理，技能接入）
  node cli.js anchor run|voices|models|upload|status|avatars   （数字人口播模块接入）
  node cli.js list   [--project 项目]

环境变量: AGNES_API_KEY / AGNES_API_BASE / AGNES_IMAGE_MODEL / AGNES_VIDEO_MODEL / FEHONG_ASSET_ROOT
默认素材库: H:\\飞虹素材库`);
}

function imageToB64(file) {
  const buf = fs.readFileSync(file);
  const mime = /\.png$/i.test(file) ? 'image/png' : /\.gif$/i.test(file) ? 'image/gif' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function runImage(cfg, params = {}) {
  const prompt = params.prompt ?? arg('prompt');
  if (!prompt) throw new Error('缺少 --prompt');
  const name = (params.name ?? arg('name')) || '图片';
  const project = (params.project ?? arg('project')) || '未分类';
  const fmt = params.format ?? arg('format', 'b64_json');
  const size = params.size ?? arg('size', '1024x1024');
  const refFile = (params.image ?? arg('image')) || '';
  const isEdit = !!refFile;
  const model = params.model ?? arg('model', '');

  console.log(`[1/3] 生成图片（${model || cfg.imageModel}${isEdit ? '，图生图' : ''}）...`);
  const { url, b64, dataUrl } = await agnes.generateImage(cfg, {
    prompt, size, model: model || undefined, responseFormat: fmt, imageB64: refFile ? imageToB64(refFile) : '',
  });

  console.log(`[2/3] 下载图片...`);
  const dest = path.join(require('os').tmpdir(), `fhpipe_${Date.now()}.png`);
  await downloadSmart(dataUrl, dest, cfg);

  console.log(`[3/3] 归档...`);
  const buf = fs.readFileSync(dest);
  const r = archive.saveRecord(cfg.assetRoot, {
    project, name, type: 'image', ext: 'png', prompt, model: cfg.imageModel,
    url: url || '', bytes: buf.length, buffer: buf, extra: { size },
  });
  fs.unlinkSync(dest);
  console.log(r.saved ? `已入库: ${r.file}` : `已存在（去重跳过）: ${r.existing.file}`);
  return r;
}

async function runVideo(cfg, params = {}) {
  const prompt = params.prompt ?? arg('prompt');
  if (!prompt) throw new Error('缺少 --prompt');
  const name = (params.name ?? arg('name')) || '视频';
  const project = (params.project ?? arg('project')) || '未分类';
  const refFile = (params.image ?? arg('image')) || '';
  const seconds = (params.seconds ?? arg('seconds')) || '5';
  const ratio = (params.ratio ?? arg('ratio')) || '16:9';
  const model = params.model ?? arg('model', '');
  // 图生视频：上游契约 mode=text + first_frame（参考图即首帧动态化）
  const mode = 'text';

  console.log(`[1/3] 创建视频任务（${model || cfg.videoModel}${refFile ? '，图生视频' : ''}）...`);
  const taskId = await agnes.createVideo(cfg, {
    prompt,
    seconds,
    ratio,
    mode,
    model: model || undefined,
    imageB64: refFile ? imageToB64(refFile) : '',
  });
  console.log(`      task_id=${taskId}`);

  console.log(`[2/3] 等待生成（间隔 ${cfg.pollIntervalMs / 1000}s）...`);
  const url = await agnes.waitVideo(cfg, taskId, { onProgress: (s) => console.log(`      ${new Date().toLocaleTimeString()} status=${s}`) });

  console.log(`[3/3] 下载并归档...`);
  const dest = path.join(require('os').tmpdir(), `fhpipe_${Date.now()}.mp4`);
  const dl = await downloadSmart(url, dest, cfg, { proxy: false }); // 视频不回退图片代理
  const buf = fs.readFileSync(dest);
  const r = archive.saveRecord(cfg.assetRoot, {
    project, name, type: 'video', ext: 'mp4', prompt, model: cfg.videoModel,
    url, bytes: buf.length, buffer: buf, extra: { size: `${seconds}s/${ratio}` },
  });
  fs.unlinkSync(dest);
  console.log(r.saved ? `已入库: ${r.file}` : `已存在（去重跳过）: ${r.existing.file}`);
  return r;
}

async function runBatch(cfg) {
  const configFile = arg('config');
  if (!configFile) throw new Error('缺少 --config');
  const cfgObj = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  const project = arg('project') || cfgObj.project || '未分类';
  const items = cfgObj.items || [];
  if (!items.length) throw new Error('配置中没有 items');

  console.log(`批量任务 ${items.length} 条（串行执行，避免限流），项目: ${project}`);
  const results = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const name = it.name || `任务${i + 1}`;
    console.log(`\n=== [${i + 1}/${items.length}] ${name} ===`);
    try {
      const r = it.type === 'video'
        ? await runVideo(cfg, { prompt: it.prompt, name, project, image: it.image || '', seconds: it.seconds || '5', ratio: it.ratio || '16:9', model: it.model || '' })
        : await runImage(cfg, { prompt: it.prompt, name, project, size: it.size || '1024x1024', format: it.format || 'b64_json', image: it.image || '', model: it.model || '' });
      results.push({ name, saved: r.saved, file: r.saved ? r.file : r.existing.file });
    } catch (err) {
      console.error(`  ✗ ${name} 失败: ${err.message}`);
      results.push({ name, saved: false, error: err.message });
    }
    if (i < items.length - 1) await agnes.sleep(3000); // 创建间隔，避免 429
  }

  const ok = results.filter((r) => r.saved).length;
  console.log(`\n完成 ${ok}/${items.length}${results.length === items.length && ok < items.length ? '，失败项见上' : ''}`);
  return results;
}

async function runCheck(cfg) {
  const targets = [
    { name: '上游 API', url: `${cfg.base}/models` },
    { name: '海外 CDN（space）', url: 'https://platform-outputs.agnes-ai.space/' },
    { name: '国内 CDN（cos-cn）', url: 'https://cos-platform-outputs.agnes-ai.cn/' },
  ];
  console.log('飞虹Code 管线连通性诊断\n');
  let okAll = true;
  for (const t of targets) {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(t.url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(timer);
      const ms = Date.now() - t0;
      console.log(`  ✅ ${t.name.padEnd(20)} HTTP ${res.status}  ${ms}ms`);
    } catch (err) {
      const ms = Date.now() - t0;
      console.log(`  ❌ ${t.name.padEnd(20)} ${ms}ms  ${err.name || '网络错误'}${/abort/i.test(String(err)) ? '（超时）' : ''}`);
      okAll = false;
    }
  }
  console.log('\n结论：' + (okAll ? '全链路可达，可正常生成与下载。' : '存在不可达端点：海外 CDN 不可达时，图生图等只回 space 域名的产物需代理后补下载。'));
  return okAll;
}

/** 下载：先直连，图片失败自动回退 weserv.nl 图片代理（解决海外 space 域名不可达） */
async function downloadSmart(url, dest, cfg, { proxy = true } = {}) {
  let lastErr = '';
  try {
    await downloadTo(url, dest, { retries: cfg.downloadRetries, timeoutMs: cfg.downloadTimeoutMs });
    return '直连';
  } catch (err) { lastErr = err.message; }
  if (proxy && /^https?:\/\//i.test(url)) {
    const proxyUrl = 'https://images.weserv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//i, ''));
    console.log('  直连失败，回退 weserv.nl 图片代理...');
    try {
      await downloadTo(proxyUrl, dest, { retries: 2, timeoutMs: 90000 });
      return 'weserv.nl 代理';
    } catch (err2) { lastErr = err2.message; }
  }
  throw new Error(lastErr || '下载失败');
}

async function runFetch(cfg, params = {}) {
  const url = params.url ?? arg('url');
  if (!url) throw new Error('缺少 --url');
  const name = (params.name ?? arg('name')) || '素材';
  const project = (params.project ?? arg('project')) || '未分类';
  const wait = parseInt(params.wait ?? arg('wait', '0'), 10);
  const maxAttempts = parseInt(params.maxAttempts ?? arg('max-attempts', wait ? '30' : '1'), 10);
  let ext = params.ext ?? arg('ext', '');
  if (!ext) {
    const m = /\.([a-z0-9]{2,4})($|\?)/i.exec(url.split(',')[0]);
    ext = m ? m[1] : 'bin';
  }
  const type = /^(mp4|webm|mov|avi)$/i.test(ext) ? 'video' : 'image';
  const dest = path.join(require('os').tmpdir(), `fhpipe_${Date.now()}.${ext}`);

  let lastErr = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      console.log(`  第 ${attempt} 次重试（${wait}s 后）...`);
      await agnes.sleep(wait * 1000);
    }
    try {
      console.log(`[${attempt}/${maxAttempts}] 下载 ${url.slice(0, 80)}${url.length > 80 ? '…' : ''} ...`);
      const via = await downloadSmart(url, dest, cfg);
      console.log(`下载成功（${via}），归档...`);
      const buf = fs.readFileSync(dest);
      const r = archive.saveRecord(cfg.assetRoot, {
        project, name, type, ext: ext.toLowerCase(), prompt: '', model: 'external',
        url, bytes: buf.length, buffer: buf, extra: { via: 'fetch' },
      });
      fs.unlinkSync(dest);
      console.log(r.saved ? `已入库: ${r.file}` : `已存在（去重跳过）: ${r.existing.file}`);
      return r;
    } catch (err) {
      lastErr = err.message;
      console.log(`  ✗ 失败: ${err.message.slice(0, 120)}`);
      if (!wait) break;
    }
  }
  throw new Error(`下载失败（尝试 ${maxAttempts} 次）: ${lastErr}`);
}

async function runLocal(cfg, action) {
  switch (action) {
    case 'status': {
      try {
        const h = await local.health();
        console.log(`Agnes 本地服务（${local.BASE}）: 运行中 v${h.version}，API Key ${h.configured ? '已配置' : '未配置'}`);
        return h;
      } catch (err) {
        console.log(`Agnes 本地服务（${local.BASE}）: 未运行（${err.message.slice(0, 60)}）`);
        return null;
      }
    }
    case 'start': {
      console.log('启动 Agnes 本地服务...');
      const r = await local.start();
      console.log(`已启动（PID ${r.pid}），v${r.health.version}，API Key ${r.health.configured ? '已配置' : '未配置'}`);
      return r;
    }
    default:
      throw new Error('local 子命令: status | start');
  }
}

async function runLocalImage(cfg, params = {}) {
  const prompt = params.prompt ?? arg('prompt');
  if (!prompt) throw new Error('缺少 --prompt');
  const name = (params.name ?? arg('name')) || '图片';
  const project = (params.project ?? arg('project')) || '未分类';
  const size = params.size ?? arg('size', '1024x1024');
  const refFile = (params.image ?? arg('image')) || '';
  const model = params.model ?? arg('model', 'agnes-image-2.1-flash');

  console.log(`[1/3] 本地生成图片（${model}${refFile ? '，图生图' : ''}）...`);
  const r = await local.generateImage({
    prompt, model, size,
    inputImages: refFile ? [imageToB64(refFile)] : [],
  });

  console.log(`[2/3] 取产物...`);
  let buf;
  let source = '';
  if (r.localPath && fs.existsSync(r.localPath)) {
    buf = fs.readFileSync(r.localPath);
    source = `本地已下载: ${r.localPath}`;
  } else {
    const dest = path.join(require('os').tmpdir(), `fhpipe_${Date.now()}.png`);
    const via = await downloadSmart(r.url, dest, cfg);
    buf = fs.readFileSync(dest);
    fs.unlinkSync(dest);
    source = `代理回退下载（${via}）`;
  }
  console.log(`      ${source}`);

  console.log(`[3/3] 归档...`);
  const rec = archive.saveRecord(cfg.assetRoot, {
    project, name, type: 'image', ext: 'png', prompt, model,
    url: r.url, bytes: buf.length, buffer: buf, extra: { via: 'agnes 本地服务' },
  });
  console.log(rec.saved ? `已入库: ${rec.file}` : `已存在（去重跳过）: ${rec.existing.file}`);
  return rec;
}

async function runLocalVideo(cfg, params = {}) {
  const prompt = params.prompt ?? arg('prompt');
  if (!prompt) throw new Error('缺少 --prompt');
  const name = (params.name ?? arg('name')) || '视频';
  const project = (params.project ?? arg('project')) || '未分类';
  const refFile = (params.image ?? arg('image')) || '';
  const seconds = (params.seconds ?? arg('seconds')) || '5';
  const model = params.model ?? arg('model', 'agnes-video-v2.0');

  console.log(`[1/3] 本地创建视频任务（${model}${refFile ? '，图生视频' : ''}）...`);
  const rec = await local.createVideo({
    prompt, model,
    mode: refFile ? 'image' : 'text',
    durationSeconds: parseInt(seconds, 10) || 5,
    imageB64: refFile ? imageToB64(refFile) : '',
  });
  const taskId = rec.task_id;
  console.log(`      task_id=${taskId}`);

  console.log(`[2/3] 等待生成...`);
  let url = '';
  for (;;) {
    await agnes.sleep(8000);
    const st = await local.pollVideo(taskId);
    console.log(`      ${new Date().toLocaleTimeString()} status=${st.status} progress=${st.progress}%`);
    if (st.status === 'completed') { url = st.video_url || ''; break; }
    if (st.status === 'failed') throw new Error(`生成失败: ${st.error}`);
  }

  console.log(`[3/3] 下载并归档...`);
  const dest = path.join(require('os').tmpdir(), `fhpipe_${Date.now()}.mp4`);
  await downloadSmart(url, dest, cfg, { proxy: false });
  const buf = fs.readFileSync(dest);
  const r2 = archive.saveRecord(cfg.assetRoot, {
    project, name, type: 'video', ext: 'mp4', prompt, model,
    url, bytes: buf.length, buffer: buf, extra: { via: 'agnes 本地服务', size: `${seconds}s` },
  });
  fs.unlinkSync(dest);
  console.log(r2.saved ? `已入库: ${r2.file}` : `已存在（去重跳过）: ${r2.existing.file}`);
  return r2;
}

/** 数字人：生成 + 轮询 + 下载 + 归档（一步到位） */
async function runAnchorRun(cfg) {
  const script = arg('script');
  if (!script) throw new Error('缺少 --script（口播文稿）');
  const mode = arg('mode', 'A');
  const avatarFile = arg('avatar-file', '');
  const videoPrompt = arg('video-prompt', '');
  if (mode !== 'C' && !avatarFile) throw new Error(`模式 ${mode} 需要 --avatar-file（先 fhcode anchor upload）`);
  if (mode === 'C' && !videoPrompt) throw new Error('模式 C 需要 --video-prompt');

  const taskId = await anchor.generate({
    script,
    mode,
    voice: arg('voice', '') || undefined,
    style: arg('style', '') || undefined,
    speed: arg('speed', '') || undefined,
    avatarFile,
    videoPrompt,
    minDuration: parseInt(arg('min-duration', '5'), 10),
    textModel: arg('text-model', '') || undefined,
    imageModel: arg('image-model', '') || undefined,
    videoModel: arg('video-model', '') || undefined,
    audioSource: arg('audio-source', 'tts'),
    audioFile: arg('audio-file', '') || undefined,
    motionStyle: arg('motion-style', '') || undefined,
    motionCustom: arg('motion-custom', '') || undefined,
  });
  console.log(`已提交数字人任务: ${taskId}`);

  console.log(`轮询状态（间隔 8s）...`);
  for (;;) {
    await agnes.sleep(8000);
    const t = await anchor.status(taskId);
    const segs = (t && t.segments) ? t.segments.length : 0;
    console.log(`  ${new Date().toLocaleTimeString()} status=${t && t.status} step=${t && t.step}（${segs} 段）`);
    if (!t) continue;
    if (t.status === 'completed') {
      if (!t.output_file) throw new Error('任务完成但无成品文件');
      const name = arg('name', '数字人口播');
      const project = arg('project', '数字人');
      const dlUrl = `${anchor.BASE}/anchor/${taskId}/${t.output_file}`;
      console.log(`成品: ${dlUrl}`);
      const dest = path.join(require('os').tmpdir(), `fhpipe_${Date.now()}.mp4`);
      await downloadSmart(dlUrl, dest, cfg, { proxy: false });
      const buf = fs.readFileSync(dest);
      const r = archive.saveRecord(cfg.assetRoot, {
        project, name, type: 'video', ext: 'mp4', prompt: script.slice(0, 200), model: '数字人',
        url: dlUrl, bytes: buf.length, buffer: buf, extra: { via: 'agnes 数字人', taskId, mode, voice: arg('voice', '') },
      });
      fs.unlinkSync(dest);
      console.log(r.saved ? `已入库: ${r.file}` : `已存在（去重跳过）: ${r.existing.file}`);
      return r;
    }
    if (t.status === 'failed') throw new Error(`生成失败: ${t.message || t.error || ''}`);
  }
}

async function runAnchor(cfg, action) {
  switch (action) {
    case 'voices': {
      const d = await anchor.voices();
      console.log('可用音色:');
      for (const v of d.voices) console.log(`  ${v.id}  ${v.name}（${v.gender}）`);
      console.log('情感风格:', d.styles.map((s) => s.id).join(' / '));
      console.log('语速:', d.speeds.map((s) => s.id).join(' / '));
      return d;
    }
    case 'models': {
      const d = await anchor.models();
      console.log('默认: 文本=' + d.defaults.text_model + ' 图片=' + d.defaults.image_model + ' 视频=' + d.defaults.video_model);
      console.log('文本模型:', Object.keys(d.text_models).join(' | '));
      console.log('视频模型:', Object.keys(d.video_models).join(' | '));
      return d;
    }
    case 'upload': {
      const file = arg('file');
      if (!file) throw new Error('缺少 --file');
      const kind = arg('kind', 'image');
      const d = await anchor.upload(file, kind);
      console.log(`上传成功: ${d.filename}（${d.size || 0} B${d.duration ? `，${d.duration}s` : ''}）`);
      console.log(`下一步: fhcode anchor run --script "..." --avatar-file ${d.filename}`);
      return d;
    }
    case 'status': {
      const taskId = arg('task-id');
      if (!taskId) throw new Error('缺少 --task-id');
      const t = await anchor.status(taskId);
      if (!t) { console.log('任务不存在（服务重启后内存任务会丢失）'); return null; }
      console.log(`状态: ${t.status} / ${t.step} — ${t.message || ''}`);
      console.log(`模式: ${t.mode}  声音: ${t.audio_source}  视频模型: ${t.video_model}`);
      if (t.segments) console.log(`分段: ${t.segments.length}（${t.segments.map((s) => s.status || s.name || '?').join(' / ')}）`);
      if (t.output_file) console.log(`成品: ${anchor.BASE}/anchor/${taskId}/${t.output_file}`);
      return t;
    }
    case 'avatars': {
      const regFile = path.join(__dirname, 'avatars.json');
      if (!fs.existsSync(regFile)) throw new Error('形象注册表不存在（avatars.json）');
      const reg = JSON.parse(fs.readFileSync(regFile, 'utf-8'));
      console.log(`数字人形象库（${reg.avatars.length} 个）— 用法: fhcode anchor run --avatar-file <server_file>`);
      for (const a of reg.avatars) {
        console.log(`  [${a.name}] ${a.server_file}`);
        console.log(`      ${a.desc}（${a.from}）`);
        console.log(`      归档: ${a.archived}`);
      }
      return reg;
    }
    case 'run': return runAnchorRun(cfg);
    default:
      throw new Error('anchor 子命令: run | voices | models | upload | status | avatars');
  }
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') return help();

  const cfg = loadConfig({ assetRoot: arg('root') || undefined });
  if (!cfg.apiKey) throw new Error('未找到 Agnes API Key（设置 AGNES_API_KEY 或检查创作中心配置）');

  switch (cmd) {
    case 'image': return flag('local') ? runLocalImage(cfg) : runImage(cfg);
    case 'video': return flag('local') ? runLocalVideo(cfg) : runVideo(cfg);
    case 'batch': return runBatch(cfg);
    case 'local': {
      const action = process.argv[3] || 'status';
      return runLocal(cfg, action);
    }
    case 'anchor': {
      const action = process.argv[3] || 'status';
      return runAnchor(cfg, action);
    }
    case 'archive': {
      const dir = arg('dir');
      if (!dir) throw new Error('缺少 --dir');
      const results = archive.archiveDir(cfg.assetRoot, dir, { project: arg('project', '未分类'), move: flag('move') });
      const ok = results.filter((r) => r.saved).length;
      console.log(`归档完成：入库 ${ok}/${results.length} 条 → ${cfg.assetRoot}`);
      return results;
    }
    case 'fetch': return runFetch(cfg);
    case 'check': return runCheck(cfg);
    case 'list': {
      const rows = archive.listAssets(cfg.assetRoot, { project: arg('project', '') });
      for (const p of rows) {
        console.log(`\n项目「${p.project}」共 ${p.count} 条:`);
        for (const r of p.records.slice(-15)) {
          console.log(`  ${r.date} ${r.seq} ${r.name} [${r.type}] ${r.bytes} B`);
        }
      }
      return rows;
    }
    default:
      throw new Error(`未知命令: ${cmd}\n\n` + help.toString());
  }
}

main().catch((err) => {
  console.error('✗ ' + err.message);
  if (process.env.FHASSET_DEBUG) console.error(err.stack);
  process.exit(1);
});
