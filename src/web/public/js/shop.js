/**
 * 飞虹 Code 官方商城前端逻辑
 * 接口同源（/api/shop/*），无需额外跨域配置。
 */
(function () {
  'use strict';

  var tiers = [];
  var payMode = 'mock';

  function $(sel) { return document.querySelector(sel); }
  function fmtPrice(cents) { return '¥' + (cents / 100).toLocaleString('zh-CN'); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function statusPill(status) {
    var label = { paid: '已支付', pending: '待支付', cancelled: '已取消', refunded: '已退款' }[status] || status;
    return '<span class="pill ' + status + '">' + label + '</span>';
  }

  function renderTiers() {
    var box = $('#tiers');
    box.innerHTML = '';
    tiers.forEach(function (t) {
      var card = el('div', 'card' + (t.tier === 'pro' ? ' recommended' : ''));
      if (t.tier === 'pro') card.appendChild(el('div', 'badge', '推荐'));
      var feats = t.features.map(function (f) { return '<li>' + escapeHtml(f) + '</li>'; }).join('');
      card.innerHTML =
        '<h3>' + escapeHtml(t.name) + '</h3>' +
        '<div class="tagline">' + escapeHtml(t.tagline) + '</div>' +
        '<div class="price">' + fmtPrice(t.priceCents) + '<small> / 年</small></div>' +
        '<ul class="features">' + feats + '</ul>' +
        '<button class="btn buy" data-tier="' + t.tier + '">立即购买</button>';
      box.appendChild(card);
    });
    Array.prototype.forEach.call(box.querySelectorAll('.buy'), function (b) {
      b.addEventListener('click', function () { openModal(b.getAttribute('data-tier')); });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- 下单弹层 ----------
  var currentTier = null;
  function openModal(tier) {
    currentTier = tier;
    var t = tiers.filter(function (x) { return x.tier === tier; })[0];
    $('#mTitle').textContent = '确认购买 · ' + t.name;
    $('#mSub').textContent = fmtPrice(t.priceCents) + ' / 年 · ' + t.tagline;
    $('#mContact').value = '';
    $('#mErr').textContent = '';
    $('#modal').classList.add('show');
    $('#mContact').focus();
  }
  function closeModal() { $('#modal').classList.remove('show'); }

  $('#mCancel').addEventListener('click', closeModal);
  $('#mSubmit').addEventListener('click', submitOrder);
  $('#mContact').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitOrder(); });

  function submitOrder() {
    var contact = $('#mContact').value.trim();
    var errBox = $('#mErr');
    errBox.textContent = '';
    if (!contact) { errBox.textContent = '请填写联系方式'; return; }
    var btn = $('#mSubmit');
    btn.disabled = true; btn.textContent = '提交中…';
    postJson('/api/shop/orders', { tier: currentTier, contact: contact })
      .then(function (data) {
        btn.disabled = false; btn.textContent = '提交订单';
        if (!data.ok) { errBox.textContent = data.error || '下单失败'; return; }
        closeModal();
        showOrder(data.order, data.payUrl);
      })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = '提交订单';
        errBox.textContent = '网络错误：' + e.message;
      });
  }

  // ---------- 订单展示 + 模拟支付 ----------
  function showOrder(order, payUrl) {
    var wrap = $('#queryResult');
    wrap.innerHTML = '';
    var box = el('div', 'status-box');
    box.appendChild(orderHeader(order));

    if (order.status === 'pending' && payUrl) {
      var payBtn = el('button', 'btn', payMode === 'mock' ? '模拟支付（沙箱）' : '前往支付');
      payBtn.style.marginTop = '14px';
      payBtn.addEventListener('click', function () {
        payBtn.disabled = true; payBtn.textContent = '支付处理中…';
        postJson(payUrl, {})
          .then(function (d) {
            payBtn.disabled = false; payBtn.textContent = '支付';
            if (!d.ok) { alert(d.error || '支付失败'); return; }
            showOrder(d.order, null);
          })
          .catch(function (e) { payBtn.disabled = false; payBtn.textContent = '支付'; alert('网络错误：' + e.message); });
      });
      box.appendChild(payBtn);
      box.appendChild(el('div', 'hint', '当前为沙箱模式：点击即模拟支付成功并自动签发激活码。正式上线后将切换为微信支付。'));
    }

    if (order.status === 'paid' && order.licenseKey) {
      box.appendChild(licenseBlock(order.licenseKey));
    }
    wrap.appendChild(box);
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function orderHeader(o) {
    var box = el('div', 'status-box');
    box.style.marginTop = '0';
    var contact = o.contact ? escapeHtml(o.contact) : '—';
    var expire = o.expireAt ? new Date(o.expireAt * 1000).toLocaleDateString('zh-CN') : '—';
    box.innerHTML =
      '<div class="row"><span>订单号</span><b>' + escapeHtml(o.orderNo) + '</b></div>' +
      '<div class="row"><span>档位</span><b>' + escapeHtml(o.tier) + '</b></div>' +
      '<div class="row"><span>金额</span><b>' + fmtPrice(o.amountCents) + '</b></div>' +
      '<div class="row"><span>状态</span>' + statusPill(o.status) + '</div>' +
      '<div class="row"><span>联系方式</span><span>' + contact + '</span></div>' +
      '<div class="row"><span>授权到期</span><span>' + expire + '</span></div>';
    return box;
  }

  function licenseBlock(key) {
    var wrap = el('div');
    wrap.appendChild(el('div', 'hint', '✅ 支付成功，激活码已生成。在已安装飞虹 Code 的机器上执行：'));
    var code = el('div', 'key-box');
    code.appendChild(el('span', null, key));
    var copy = el('button', null, '复制');
    copy.addEventListener('click', function () {
      navigator.clipboard.writeText(key).then(function () { copy.textContent = '已复制'; setTimeout(function () { copy.textContent = '复制'; }, 1500); });
    });
    code.appendChild(copy);
    wrap.appendChild(code);
    wrap.appendChild(el('div', 'hint', '终端命令：<b>fhcode license activate ' + escapeHtml(key) + '</b>（或 App 内「授权」页粘贴）。激活后即在当前设备生效。'));
    return wrap;
  }

  // ---------- 查单 ----------
  $('#queryBtn').addEventListener('click', function () {
    var no = $('#orderInput').value.trim();
    var box = $('#queryResult');
    if (!no) { box.innerHTML = '<div class="err">请输入订单号</div>'; return; }
    box.innerHTML = '<div class="hint">查询中…</div>';
    fetch('/api/shop/orders/' + encodeURIComponent(no), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) { box.innerHTML = '<div class="err">' + escapeHtml(data.error || '未找到') + '</div>'; return; }
        showOrder(data.order, data.order.status === 'pending' ? '/api/shop/pay/mock/' + data.order.orderNo : null);
      })
      .catch(function (e) { box.innerHTML = '<div class="err">网络错误：' + escapeHtml(e.message) + '</div>'; });
  });

  // ---------- 工具 ----------
  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }

  // ---------- 初始化 ----------
  fetch('/api/shop/tiers', { headers: { 'Accept': 'application/json' } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok) { tiers = data.tiers; payMode = data.payMode || 'mock'; renderTiers(); }
      else { $('#tiers').innerHTML = '<div class="err">档位加载失败</div>'; }
    })
    .catch(function () { $('#tiers').innerHTML = '<div class="err">无法连接商城服务</div>'; });
})();
