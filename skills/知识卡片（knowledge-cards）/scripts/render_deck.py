#!/usr/bin/env python3
"""
render_deck.py — 把 terms.json 渲染成"每滑动一次出一条"的正式单文件网页

这是 Skill 中唯一真正响应鼠标事件的环节：浏览器内绑定 wheel / touchmove /
方向键，用户每滑动一次翻出下一条名词释义。

布局:
    split（默认）— 左右双栏，一屏看全一条名词的全部释义，无需上下滚动
                   左栏：编号 / 名词 / 英文 / 分类 / 定义
                   右栏：说人话 / 为什么重要 / 常见误用 / 量化口径 / 关联词 / 风险
    stack        — 单栏纵向，适合窄屏或打印

特性:
    - 封面页 + 词条卡片流 + 结尾页
    - 分类筛选、索引面板、一键复制当前卡片文本、自动播放
    - 深蓝 + 金视觉，思源宋体标题 / 思源黑体正文
    - 零依赖单文件，可离线打开、可直接分享

用法:
    python3 render_deck.py --input terms.json --output deck.html
    python3 render_deck.py --input terms.json --output deck.html --layout stack
"""

import argparse
import json
from datetime import date
from pathlib import Path

# 默认映射（知识付费）。输入 JSON 若为对象且带 categories / risks 字段，
# 则以其为准 —— 同一个渲染引擎因此可复用于任意行业词库。
CATEGORY_LABEL = {
    "traffic": "流量获取",
    "conversion": "转化成交",
    "product": "产品形态",
    "business": "商业模式",
    "metrics": "数据指标",
    "delivery": "交付履约",
    "compliance": "合规风控",
}

RISK_LABEL = {
    "advertising": "宣传合规",
    "qualification": "资质要求",
    "dataPrivacy": "数据合规",
}

# riskFlag → 提示语。未命中的 flag 回退到 DEFAULT_RISK_TEXT
RISK_TEXT = {
    "advertising": "涉及广告宣传合规边界，投放前请由法务确认话术。",
    "qualification": "涉及经营资质要求，开展业务前请核验属地主管部门最新规定。",
    "dataPrivacy": "涉及个人信息处理合规，触达用户前请确认授权链路完整。",
    "counterfeit": "涉及版权与假货风险，交易前请核验正版标识与授权链路。",
    "fraud": "涉及交易欺诈高发场景，建议全程走平台担保并保留完整凭证。",
    "minor": "涉及未成年人消费，需监护人知情同意，并留存可追溯的支付记录。",
    # —— 技能 / AI Agent 开发生态专用 ——
    "overPerm": "涉及工具授权范围，请确保 skill 只声明完成任务所必需的最小权限。",
    "dataLeak": "涉及敏感信息处理，避免向外输出密钥、令牌与个人身份信息。",
    "hallucination": "涉及外部事实陈述，发布前请交叉核验来源并标注不确定性。",
    "promptInjection": "涉及不可信输入，执行前请隔离并校验外部指令，避免被诱导越权。",
}
DEFAULT_RISK_TEXT = "涉及资质或宣传合规边界，落地前请由法务确认。"

HTML = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>__TITLE__</title>
<style>
  :root{
    --navy:#08182E; --navy-2:#0E2A4D; --navy-3:#143A66;
    --gold:#C9A227; --gold-2:#E7CE7A; --gold-3:#8A6F1A;
    --ink:#F3EFE4; --ink-2:#C7D3E4; --muted:#8296B0;
    --serif:"Source Han Serif SC","Noto Serif SC","Songti SC","STSong",serif;
    --sans:"Source Han Sans SC","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  html,body{height:100%}
  body{
    font-family:var(--sans); color:var(--ink); overflow:hidden;
    background:
      radial-gradient(1200px 700px at 18% -8%, rgba(20,58,102,.85), transparent 60%),
      radial-gradient(900px 600px at 92% 108%, rgba(201,162,39,.13), transparent 62%),
      linear-gradient(160deg,#0B1F3A 0%,var(--navy) 62%,#050F1E 100%);
    display:flex; align-items:center; justify-content:center;
  }
  body::after{
    content:""; position:fixed; inset:0; pointer-events:none; opacity:.32;
    background-image:linear-gradient(rgba(255,255,255,.02) 1px,transparent 1px),
                     linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px);
    background-size:56px 56px;
  }

  /* ---------- 顶栏 ---------- */
  .topbar{
    position:fixed; top:0; left:0; right:0; z-index:30; display:flex;
    align-items:center; gap:14px; padding:14px 26px;
    background:linear-gradient(180deg,rgba(5,15,30,.92),transparent);
  }
  .brand{font-family:var(--serif); font-size:16px; color:var(--gold-2); letter-spacing:.06em}
  .brand small{font-family:var(--sans); color:var(--muted); font-size:11.5px; margin-left:10px; letter-spacing:.14em}
  .spacer{flex:1}
  .btn{
    font-size:12px; letter-spacing:.1em; color:var(--ink-2); cursor:pointer;
    padding:6px 14px; border-radius:999px; border:1px solid rgba(201,162,39,.32);
    background:rgba(255,255,255,.03); transition:.2s; white-space:nowrap;
  }
  .btn:hover{color:var(--navy); background:var(--gold-2); border-color:var(--gold-2)}
  .btn.on{color:var(--navy); background:var(--gold); border-color:var(--gold)}

  /* ---------- 筛选条 ---------- */
  .filters{
    position:fixed; top:54px; left:0; right:0; z-index:29; display:flex; gap:7px;
    justify-content:center; flex-wrap:wrap; padding:4px 24px;
  }
  .chip{
    font-size:11.5px; letter-spacing:.08em; color:var(--muted); cursor:pointer;
    padding:4px 12px; border-radius:999px; border:1px solid rgba(255,255,255,.1); transition:.18s;
  }
  .chip:hover{color:var(--gold-2); border-color:rgba(201,162,39,.45)}
  .chip.on{color:var(--gold); border-color:var(--gold); background:rgba(201,162,39,.12)}

  /* ---------- 舞台 ---------- */
  .stage{width:min(1240px,94vw); position:relative; z-index:10; margin-top:52px}
  .meta{display:flex; justify-content:space-between; align-items:baseline;
        color:var(--muted); font-size:11.5px; letter-spacing:.16em; margin-bottom:9px}
  .counter{color:var(--gold); font-weight:700; font-size:12.5px; letter-spacing:.1em}

  .card{
    position:relative; border-radius:20px; overflow:hidden;
    background:linear-gradient(158deg,rgba(20,58,102,.55),rgba(8,24,46,.84));
    border:1px solid rgba(201,162,39,.3);
    box-shadow:0 30px 70px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.05);
    backdrop-filter:blur(8px);
    transition:transform .3s cubic-bezier(.22,.9,.28,1), opacity .3s;
  }
  .card.out-next{transform:translateX(-26px) scale(.985); opacity:0}
  .card.out-prev{transform:translateX(26px) scale(.985); opacity:0}

  /* ===== 双栏核心布局 ===== */
  .split{display:grid; grid-template-columns:minmax(300px,37%) 1fr; align-items:stretch}
  .lcol{
    position:relative; padding:34px 34px 30px 40px;
    background:linear-gradient(180deg,rgba(201,162,39,.055),rgba(201,162,39,.012));
    border-right:1px solid rgba(201,162,39,.22);
    display:flex; flex-direction:column;
  }
  .lcol::before{
    content:""; position:absolute; left:0; top:30px; bottom:30px; width:2px;
    background:linear-gradient(180deg,transparent,var(--gold),transparent); opacity:.6;
  }
  .rcol{padding:34px 40px 30px 36px; display:flex; flex-direction:column; gap:2px}

  .idx{font-family:var(--serif); font-size:15px; color:var(--gold-3);
       letter-spacing:.22em; margin-bottom:14px}
  h1{font-family:var(--serif); font-size:clamp(28px,3.1vw,40px); color:var(--gold-2);
     letter-spacing:.02em; line-height:1.2; word-break:break-word}
  .en{color:var(--muted); font-size:12.5px; letter-spacing:.11em; margin-top:8px; line-height:1.5}
  .tags{display:flex; gap:6px; flex-wrap:wrap; margin:14px 0 18px}
  .tag{font-size:11px; letter-spacing:.05em; padding:3px 10px; border-radius:999px;
       border:1px solid rgba(201,162,39,.42); color:var(--gold)}
  .tag.plain{border-color:rgba(255,255,255,.14); color:var(--muted)}

  .def h2{font-size:10.5px; letter-spacing:.3em; color:var(--gold); margin-bottom:8px; font-weight:600}
  .def p{font-size:15px; line-height:1.85; color:var(--ink)}
  .lfoot{margin-top:auto; padding-top:16px; color:var(--muted); font-size:11px; letter-spacing:.08em}

  section{margin-bottom:15px}
  section:last-child{margin-bottom:0}
  section h2{font-size:10.5px; letter-spacing:.3em; color:var(--gold); margin-bottom:6px; font-weight:600}
  section p{font-size:14.6px; line-height:1.8; color:var(--ink)}
  section.analogy{padding:12px 16px; border-radius:10px; background:rgba(201,162,39,.08);
                  border-left:2px solid rgba(201,162,39,.55)}
  section.analogy p{color:var(--gold-2); font-family:var(--serif); font-size:15.5px; line-height:1.7}
  .rel{margin-top:auto; padding-top:14px; border-top:1px solid rgba(255,255,255,.08);
       color:var(--muted); font-size:12.2px; line-height:1.7}
  .rel b{color:var(--gold); font-weight:600; letter-spacing:.18em; font-size:10.5px; margin-right:10px}
  .risk{margin-top:14px; padding:11px 15px; border-radius:10px; font-size:12.4px; line-height:1.65;
        background:rgba(201,162,39,.11); border-left:3px solid var(--gold); color:var(--gold-2)}

  /* ---------- 进度 / 提示 ---------- */
  .bar{height:2.5px; background:rgba(255,255,255,.07); border-radius:3px; margin-top:12px; overflow:hidden}
  .bar i{display:block; height:100%; width:0;
         background:linear-gradient(90deg,var(--gold-3),var(--gold),var(--gold-2));
         transition:width .32s ease}
  .hint{text-align:center; margin-top:12px; color:var(--muted); font-size:11px; letter-spacing:.1em}
  .hint kbd{border:1px solid rgba(255,255,255,.16); border-radius:5px; padding:1px 6px;
            font-family:var(--sans); font-size:10.5px; margin:0 2px; color:var(--ink-2)}

  /* ---------- 封面 / 结尾 ---------- */
  .cover{text-align:center; padding:56px 46px; grid-column:1/-1}
  .cover .kicker{font-size:11.5px; letter-spacing:.42em; color:var(--gold); margin-bottom:20px}
  .cover h1{font-size:clamp(36px,5.4vw,58px); margin-bottom:16px}
  .cover .sub{color:var(--ink-2); font-size:15px; line-height:1.95; margin-bottom:28px}
  .cover .stats{display:flex; justify-content:center; gap:44px; flex-wrap:wrap; margin-bottom:30px}
  .cover .stats b{display:block; font-family:var(--serif); font-size:32px; color:var(--gold-2)}
  .cover .stats span{font-size:11px; letter-spacing:.2em; color:var(--muted)}
  .cover .go{display:inline-block; padding:11px 32px; border-radius:999px;
             border:1px solid var(--gold); color:var(--gold); cursor:pointer;
             font-size:13px; letter-spacing:.2em; transition:.2s}
  .cover .go:hover{background:var(--gold); color:var(--navy)}

  /* ---------- 索引面板 ---------- */
  .panel{position:fixed; inset:0; z-index:40; display:none; padding:80px 40px 40px;
         background:rgba(4,12,24,.94); backdrop-filter:blur(10px); overflow-y:auto}
  .panel.open{display:block}
  .panel h3{font-family:var(--serif); font-size:21px; color:var(--gold-2); margin-bottom:18px;
            text-align:center; letter-spacing:.08em}
  .grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(172px,1fr));
        gap:8px; max-width:1160px; margin:0 auto}
  .gitem{padding:10px 13px; border-radius:10px; cursor:pointer; font-size:13.5px;
         border:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.025); transition:.16s}
  .gitem:hover{border-color:var(--gold); color:var(--gold-2); transform:translateY(-1px)}
  .gitem em{display:block; font-style:normal; font-size:10.5px; color:var(--muted);
            letter-spacing:.08em; margin-top:3px}
  .gitem .dot{display:inline-block; width:5px; height:5px; border-radius:50%;
              background:var(--gold); margin-right:7px; vertical-align:middle}

  .toast{position:fixed; left:50%; bottom:34px; transform:translateX(-50%) translateY(16px);
         background:var(--gold); color:var(--navy); font-size:12.5px; letter-spacing:.08em;
         padding:9px 22px; border-radius:999px; opacity:0; pointer-events:none;
         transition:.25s; z-index:60; font-weight:600}
  .toast.show{opacity:1; transform:translateX(-50%) translateY(0)}

  /* ---------- 高屏放大：填满留白，提升可读性 ---------- */
  @media (min-height:1000px) and (min-width:1300px){
    .stage{width:min(1340px,94vw)}
    .lcol{padding:44px 42px 38px 50px}
    .rcol{padding:44px 50px 38px 44px}
    h1{font-size:clamp(38px,3.6vw,50px)}
    .en{font-size:14px; margin-top:10px}
    .def p{font-size:17px; line-height:1.95}
    section p{font-size:16.5px; line-height:1.92}
    section.analogy p{font-size:17.5px; line-height:1.8}
    section{margin-bottom:20px}
    section.analogy{padding:15px 19px}
    .idx{font-size:16px; margin-bottom:18px}
    .rel{font-size:13.5px; padding-top:18px}
    .risk{font-size:13.5px; padding:13px 17px}
    .tags{margin:17px 0 22px}
    .tag{font-size:12px; padding:4px 12px}
  }

  /* ---------- 矮屏压缩：保证一屏看全 ---------- */
  @media (max-height:820px){
    .lcol,.rcol{padding-top:26px; padding-bottom:24px}
    h1{font-size:clamp(26px,2.7vw,34px)}
    .def p{font-size:14.2px; line-height:1.76}
    section p{font-size:13.8px; line-height:1.72}
    section{margin-bottom:12px}
    section.analogy{padding:10px 14px}
    section.analogy p{font-size:14.6px}
    .tags{margin:11px 0 15px}
  }
  @media (max-height:700px){
    .lcol,.rcol{padding-top:20px; padding-bottom:18px}
    h1{font-size:clamp(23px,2.4vw,29px)}
    .def p{font-size:13.4px; line-height:1.7}
    section p{font-size:13px; line-height:1.66}
    section{margin-bottom:9px}
    .idx{margin-bottom:9px; font-size:13px}
    .en{font-size:11.5px; margin-top:6px}
    .rel{font-size:11.4px; padding-top:11px}
    .risk{font-size:11.6px; padding:9px 13px; margin-top:11px}
    .hint{margin-top:9px}
  }

  /* ---------- 窄屏降级为单栏 ---------- */
  @media (max-width:900px){
    .split{grid-template-columns:1fr}
    .lcol{border-right:none; border-bottom:1px solid rgba(201,162,39,.22); padding:26px 24px 22px}
    .rcol{padding:22px 24px 26px}
    .card{max-height:none}
    .stage{width:94vw}
  }
  @media (max-width:640px){
    .topbar{padding:12px 15px; gap:8px}
    .brand small{display:none}
    .btn{padding:5px 11px; font-size:11px}
    .filters{top:48px}
    .stage{margin-top:66px}
    .wrap{max-height:none}
    h1{font-size:29px}
  }
  /* 窄屏下允许卡片整体滚动兜底 */
  @media (max-width:900px){
    body{overflow:auto; align-items:flex-start; padding:0 0 40px}
    .stage{margin-top:96px}
  }

  @media print{
    body{background:#fff; color:#111; overflow:visible; display:block}
    .topbar,.filters,.hint,.bar,.panel,.toast{display:none!important}
    .card{box-shadow:none; border-color:#ccc; background:#fff; color:#111}
    .lcol{background:#faf7ee}
    h1{color:#8A6F1A}
  }
</style>
</head>
<body>

<div class="topbar">
  <div class="brand">__TITLE__<small>__SUBTITLE__</small></div>
  <div class="spacer"></div>
  <div class="btn" id="btnIndex">目录</div>
  <div class="btn" id="btnCopy">复制本条</div>
  <div class="btn" id="btnAuto">自动播放</div>
</div>

<div class="filters" id="filters"></div>

<div class="stage">
  <div class="meta"><span id="catName">滑动开始</span><span class="counter" id="counter"></span></div>
  <div class="card split" id="card"></div>
  <div class="bar"><i id="bar"></i></div>
  <p class="hint">
    滚轮 / 触控板滑动　·　<kbd>←</kbd><kbd>→</kbd> 方向键　·　<kbd>空格</kbd> 下一条　·　点击卡片继续
  </p>
</div>

<div class="panel" id="panel">
  <h3>全部名词索引</h3>
  <div class="grid" id="grid"></div>
</div>

<div class="toast" id="toast"></div>

<script>
const ALL       = __DATA__;
const CATS      = __CATS__;
const RISKS     = __RISKS__;
const RISK_TEXT = __RISKTEXT__;

let pool = ALL.slice();
let idx  = -1;                  // -1 = 封面，pool.length = 结尾页
let lock = false, auto = null, filter = 'all';

const $ = id => document.getElementById(id);
const card = $('card'), counter = $('counter'), bar = $('bar'), catName = $('catName');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sec = (label, text, cls) => text ? `<section class="${cls||''}"><h2>${label}</h2><p>${esc(text)}</p></section>` : '';

function toast(msg){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1500);
}

/* ---------- 筛选条 ---------- */
function buildFilters(){
  const counts = {};
  ALL.forEach(t => counts[t.category] = (counts[t.category] || 0) + 1);
  const items = [['all', '全部 ' + ALL.length]].concat(
    Object.keys(CATS).filter(c => counts[c]).map(c => [c, CATS[c] + ' ' + counts[c]]));
  $('filters').innerHTML = items.map(([k, label]) =>
    `<span class="chip ${k === filter ? 'on' : ''}" data-cat="${k}">${label}</span>`).join('');
  $('filters').querySelectorAll('.chip').forEach(el => el.onclick = () => applyFilter(el.dataset.cat));
}

function applyFilter(cat){
  filter = cat;
  pool = cat === 'all' ? ALL.slice() : ALL.filter(t => t.category === cat);
  idx = 0; buildFilters(); buildGrid(); render();
  toast(cat === 'all' ? '已显示全部名词' : CATS[cat] + ' · ' + pool.length + ' 条');
}

/* ---------- 索引面板 ---------- */
function buildGrid(){
  $('grid').innerHTML = pool.map((t, i) =>
    `<div class="gitem" data-i="${i}"><span class="dot"></span>${esc(t.termZh)}
       <em>${esc(CATS[t.category] || t.category)}</em></div>`).join('');
  $('grid').querySelectorAll('.gitem').forEach(el => el.onclick = () => {
    idx = +el.dataset.i; $('panel').classList.remove('open'); render();
  });
}

/* ---------- 渲染 ---------- */
function renderCover(){
  const cats  = Object.keys(CATS).filter(c => ALL.some(t => t.category === c)).length;
  const risky = ALL.filter(t => t.riskFlag && t.riskFlag !== 'none').length;
  card.className = 'card';
  card.innerHTML = `<div class="cover">
    <div class="kicker">__KICKER__</div>
    <h1>__TITLE__</h1>
    <p class="sub">每滑动一次，出现一条行业名词释义。<br>
       左栏给定义，右栏给用法 —— 一屏看全，不用上下找。</p>
    <div class="stats">
      <div><b>${ALL.length}</b><span>名词</span></div>
      <div><b>${cats}</b><span>分类</span></div>
      <div><b>${risky}</b><span>合规提示</span></div>
    </div>
    <div class="go" id="goFirst">开始滑动</div>
  </div>`;
  counter.textContent = ''; catName.textContent = '封面'; bar.style.width = '0%';
  $('goFirst').onclick = e => { e.stopPropagation(); idx = 0; render(); };
}

function renderEnd(){
  card.className = 'card';
  card.innerHTML = `<div class="cover">
    <div class="kicker">END OF DECK</div>
    <h1>已滑完 ${pool.length} 条</h1>
    <p class="sub">回看某一条可打开顶部「目录」，或用左方向键往回滑。<br>
       想换个主题，点上方分类标签重新筛一遍。</p>
    <div class="go" id="goRestart">从头再来</div>
  </div>`;
  counter.textContent = pool.length + ' / ' + pool.length;
  catName.textContent = '已完成'; bar.style.width = '100%';
  $('goRestart').onclick = e => { e.stopPropagation(); idx = 0; render(); };
}

function render(){
  if (idx < 0)            return renderCover();
  if (idx >= pool.length) return renderEnd();

  const t = pool[idx];
  const riskName = RISKS[t.riskFlag] || t.riskFlag;
  const riskBody = RISK_TEXT[t.riskFlag] || RISK_TEXT._default;
  const risk = (t.riskFlag && t.riskFlag !== 'none')
    ? `<div class="risk">⚠️ 风险提示（${esc(riskName)}）：${esc(riskBody)}本卡片为名词解释，不构成法律意见。</div>` : '';
  const low = (t.confidence ?? 1) < 0.6
    ? `<div class="risk">⚠️ 行业内无统一口径，以下为常见用法，使用前建议与合作方对齐定义。</div>` : '';

  card.className = 'card split';
  card.innerHTML = `
    <div class="lcol">
      <div class="idx">${String(idx + 1).padStart(2, '0')} / ${String(pool.length).padStart(2, '0')}</div>
      <h1>${esc(t.termZh)}</h1>
      ${t.termEn ? `<div class="en">${esc(t.termEn)}</div>` : ''}
      <div class="tags">
        <span class="tag">${esc(CATS[t.category] || t.category)}</span>
        ${(t.aliases || []).map(a => `<span class="tag plain">${esc(a)}</span>`).join('')}
      </div>
      <div class="def"><h2>定义</h2><p>${esc(t.definition)}</p></div>
      <div class="lfoot">${esc(t.sourceType || '')}　·　confidence ${(t.confidence ?? 0).toFixed(2)}</div>
    </div>
    <div class="rcol">
      ${sec('说人话', t.plainAnalogy, 'analogy')}
      ${sec('为什么重要', t.whyItMatters)}
      ${sec('常见误用', t.misuse)}
      ${t.metricHint ? sec('量化口径', t.metricHint) : ''}
      ${(t.relatedTerms || []).length
          ? `<p class="rel"><b>关联词</b>${t.relatedTerms.map(esc).join('　/　')}</p>` : ''}
      ${low}${risk}
    </div>`;
  counter.textContent = (idx + 1) + ' / ' + pool.length;
  catName.textContent = CATS[t.category] || t.category;
  bar.style.width = ((idx + 1) / pool.length * 100) + '%';
}

/* ---------- 翻页 ---------- */
function go(step){
  if (lock) return;
  const next = idx + step;
  if (next < -1 || next > pool.length) return;
  lock = true;
  card.classList.add(step > 0 ? 'out-next' : 'out-prev');
  setTimeout(() => {
    idx = next; render();
    card.classList.remove('out-next', 'out-prev');
    setTimeout(() => lock = false, 170);
  }, 210);
}

/* 真·鼠标滑动：一次手势翻一条，节流抵消触控板惯性 */
let wheelAt = 0;
window.addEventListener('wheel', e => {
  if ($('panel').classList.contains('open')) return;
  if (window.innerWidth <= 900) return;        // 窄屏交给原生滚动
  const now = Date.now();
  if (now - wheelAt < 430 || Math.abs(e.deltaY) < 6) return;
  wheelAt = now; go(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') return $('panel').classList.remove('open');
  if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(e.key)){ e.preventDefault(); go(1); }
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)){ e.preventDefault(); go(-1); }
});
card.addEventListener('click', e => { if (!e.target.closest('.go')) go(1); });

/* 触屏：左右滑为主，上下滑为辅 */
let tx = null, ty = null;
window.addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
window.addEventListener('touchend', e => {
  if (tx === null) return;
  const dx = tx - e.changedTouches[0].clientX;
  const dy = ty - e.changedTouches[0].clientY;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx > 0 ? 1 : -1);
  else if (window.innerWidth > 900 && Math.abs(dy) > 50) go(dy > 0 ? 1 : -1);
  tx = ty = null;
}, { passive: true });

/* ---------- 顶栏动作 ---------- */
$('btnIndex').onclick = () => $('panel').classList.toggle('open');
$('panel').onclick = e => { if (e.target === $('panel')) $('panel').classList.remove('open'); };

/* 复制到剪贴板：优先用异步 Clipboard API，失败或不可用时回退到 execCommand。
   关键修复：生成的单文件 HTML 常被以 file:// 形式离线打开，此时
   navigator.clipboard 在非安全上下文（Safari / 未聚焦时 Chrome）会被禁用或 reject，
   导致复制按钮"点了没反应"。execCommand 兜底方案可在所有上下文下可靠复制。 */
function copyText(text){
  const fallback = () => new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { ta.setSelectionRange(0, ta.value.length); } catch (e) {}
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    ok ? resolve() : reject(new Error('execCommand copy failed'));
  });

  if (navigator.clipboard && window.isSecureContext){
    return navigator.clipboard.writeText(text).catch(() => fallback());
  }
  return fallback();
}

$('btnCopy').onclick = () => {
  if (idx < 0 || idx >= pool.length) return toast('当前不是名词卡片');
  const t = pool[idx];
  const txt = [
    `【${t.termZh}】${t.termEn || ''}　·　${CATS[t.category] || t.category}`, ``,
    `定义：${t.definition}`,
    `说人话：${t.plainAnalogy}`,
    `为什么重要：${t.whyItMatters}`,
    t.misuse ? `常见误用：${t.misuse}` : '',
    t.metricHint ? `量化口径：${t.metricHint}` : '',
    (t.relatedTerms || []).length ? `关联词：${t.relatedTerms.join(' / ')}` : ''
  ].filter(Boolean).join('\n');
  copyText(txt)
    .then(() => toast('已复制「' + t.termZh + '」'))
    .catch(() => toast('复制失败，请手动选中'));
};

$('btnAuto').onclick = () => {
  const b = $('btnAuto');
  if (auto){ clearInterval(auto); auto = null; b.classList.remove('on'); b.textContent = '自动播放'; return; }
  b.classList.add('on'); b.textContent = '停止播放';
  auto = setInterval(() => {
    if (idx >= pool.length){ clearInterval(auto); auto = null; b.classList.remove('on'); b.textContent = '自动播放'; return; }
    go(1);
  }, 5200);
};

buildFilters(); buildGrid(); render();
</script>
</body>
</html>
"""


def main():
    p = argparse.ArgumentParser(description="渲染可滑动的名词卡片网页")
    p.add_argument("--input", required=True, help="terms.json 路径")
    p.add_argument("--output", default="deck.html")
    p.add_argument("--title", default="XX 主题卡片释义")
    p.add_argument("--subtitle", default=f"CARD DECK · {date.today()}")
    p.add_argument("--kicker", default=None,
                   help="封面顶部全英文小标；未传则按 title 智能默认（知识付费→KNOWLEDGE COMMERCE GLOSSARY；吧唧/谷子→BADGE & GUZI GLOSSARY；技能/Skill/Agent→SKILL & AGENT GLOSSARY；雷军/生平/人物→PERSON PROFILE · TIMELINE；WorkBuddy→WORKBUDDY GLOSSARY；其它→INDUSTRY GLOSSARY）")
    p.add_argument("--layout", default="split", choices=["split", "stack"],
                   help="split=左右双栏一屏看全（默认），stack=单栏纵向")
    p.add_argument("--theme", default="navy-gold", choices=["navy-gold"])
    args = p.parse_args()

    payload = json.loads(Path(args.input).expanduser().read_text(encoding="utf-8"))
    if isinstance(payload, list):
        terms, cats, risks = payload, CATEGORY_LABEL, RISK_LABEL
    else:
        terms = payload.get("terms", [])
        cats  = payload.get("categories") or CATEGORY_LABEL
        risks = payload.get("risks") or RISK_LABEL
    if not terms:
        raise SystemExit("[glossary] 输入文件中没有词条，无法渲染")

    # 校验分类映射完整性，避免卡片上出现裸英文 key
    missing = sorted({t.get("category") for t in terms} - set(cats))
    if missing:
        raise SystemExit(f"[glossary] 以下 category 缺少中文标签: {missing}")

    risk_text = dict(RISK_TEXT, _default=DEFAULT_RISK_TEXT)

    # 封面 kicker：显式 > 标题关键字 > 通用默认
    if args.kicker:
        kicker = args.kicker
    elif "知识付费" in args.title:
        kicker = "KNOWLEDGE COMMERCE GLOSSARY"
    elif any(k in args.title for k in ("吧唧", "谷子", "周边")):
        kicker = "BADGE & GUZI GLOSSARY"
    elif any(k in args.title for k in ("技能", "Skill", "skill", "Agent", "智能体")):
        kicker = "SKILL & AGENT GLOSSARY"
    elif any(k in args.title for k in ("雷军", "生平", "人物", "传记", "时间线", "timeline")):
        kicker = "PERSON PROFILE · TIMELINE"
    elif "WorkBuddy" in args.title or "workbuddy" in args.title:
        kicker = "WORKBUDDY GLOSSARY"
    else:
        kicker = "INDUSTRY GLOSSARY"

    html = (HTML
            .replace("__TITLE__", args.title)
            .replace("__SUBTITLE__", args.subtitle)
            .replace("__KICKER__", kicker)
            .replace("__DATA__", json.dumps(terms, ensure_ascii=False))
            .replace("__CATS__", json.dumps(cats, ensure_ascii=False))
            .replace("__RISKS__", json.dumps(risks, ensure_ascii=False))
            .replace("__RISKTEXT__", json.dumps(risk_text, ensure_ascii=False)))

    # stack 模式：把双栏断点提到极宽，等效于永远单栏
    if args.layout == "stack":
        html = html.replace("@media (max-width:900px){", "@media (max-width:99999px){", 1)

    out = Path(args.output).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(json.dumps({"output": str(out), "cards": len(terms), "layout": args.layout,
                      "categories": len(cats), "sizeKb": round(len(html) / 1024, 1)},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
