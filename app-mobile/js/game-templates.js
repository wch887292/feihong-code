/* ============================================================
 * 飞虹 Code · 内置小游戏模板引擎
 * Canvas 2D 原生渲染 · 触摸控制 · 自适应手机屏幕
 * 确定性代码，100% 可玩，不依赖 AI 生成代码
 * ============================================================ */

/* 通用 Canvas 游戏基础设施 */
var GameKit = (function () {
  function canvasFor(container) {
    var c = document.createElement('canvas');
    c.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;-webkit-touch-callout:none;user-select:none;';
    container.innerHTML = '';
    container.appendChild(c);
    return c;
  }
  function fit(canvas) {
    var r = canvas.parentElement.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = r.width, h = r.height;
    // 兜底：如果容器尺寸为 0 或异常，用视口尺寸
    if (!w || !h || w <= 0 || h <= 0) {
      var vh = window.innerHeight || document.documentElement.clientHeight || 800;
      var vw = window.innerWidth || document.documentElement.clientWidth || 400;
      h = vh; w = vw;
    }
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }
  /* 自适应尺寸：监听容器/窗口变化自动重算 */
  function autoFit(canvas, onResize) {
    function doFit() {
      var d = fit(canvas);
      if (onResize) onResize(d);
    }
    var rafId = null;
    function schedule() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(doFit);
    }
    var ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      try {
        ro = new ResizeObserver(schedule);
        if (canvas.parentElement) ro.observe(canvas.parentElement);
      } catch (e) { ro = null; }
    }
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    // 首帧后立即校准一次（确保布局完成）
    setTimeout(doFit, 50);
    return {
      destroy: function () {
        if (rafId) cancelAnimationFrame(rafId);
        if (ro) { try { ro.disconnect(); } catch (e) {} }
        window.removeEventListener('resize', schedule);
        window.removeEventListener('orientationchange', schedule);
      }
    };
  }
  /* 触摸/鼠标统一输入 */
  function input(canvas, handlers) {
    var pt = { x: 0, y: 0, down: false };
    function getPos(e) {
      var r = canvas.getBoundingClientRect();
      var c = e.touches ? e.touches[0] : e;
      return { x: c.clientX - r.left, y: c.clientY - r.top };
    }
    function onStart(e) {
      e.preventDefault();
      var p = getPos(e);
      pt.x = p.x; pt.y = p.y; pt.down = true;
      if (handlers.start) handlers.start(p.x, p.y);
    }
    function onMove(e) {
      e.preventDefault();
      var p = getPos(e);
      var dx = p.x - pt.x, dy = p.y - pt.y;
      pt.x = p.x; pt.y = p.y;
      if (handlers.move) handlers.move(p.x, p.y, dx, dy);
    }
    function onEnd(e) {
      e.preventDefault();
      pt.down = false;
      if (handlers.end) handlers.end(pt.x, pt.y);
    }
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd, { passive: false });
    canvas.addEventListener('mousedown', onStart);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onEnd);
    return {
      destroy: function () {
        canvas.removeEventListener('touchstart', onStart);
        canvas.removeEventListener('touchmove', onMove);
        canvas.removeEventListener('touchend', onEnd);
        canvas.removeEventListener('mousedown', onStart);
        canvas.removeEventListener('mousemove', onMove);
        canvas.removeEventListener('mouseup', onEnd);
      }
    };
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function beep(freq, dur, vol) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var actx = new AC();
      var o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = freq;
      o.type = 'square';
      g.gain.value = vol || 0.03;
      o.connect(g); g.connect(actx.destination);
      o.start();
      setTimeout(function () { try { o.stop(); actx.close(); } catch (e) {} }, dur || 60);
    } catch (e) {}
  }
  return { canvasFor: canvasFor, fit: fit, autoFit: autoFit, input: input, roundRect: roundRect, beep: beep };
})();

/* ================= 模板 1：贪吃蛇 ================= */
function GameSnake(container, cfg) {
  var canvas = GameKit.canvasFor(container);
  var dim, ctx, inp, raf, running = false, over = false;
  var grid = 20, snake, dir, nextDir, food, score, speed, timer;

  function reset() {
    var cols = Math.floor(dim.w / grid), rows = Math.floor(dim.h / grid);
    snake = [{ x: Math.floor(cols / 2), y: Math.floor(rows / 2) }];
    dir = { x: 1, y: 0 }; nextDir = { x: 1, y: 0 };
    score = 0; over = false; running = true;
    placeFood();
  }
  function placeFood() {
    var cols = Math.floor(dim.w / grid), rows = Math.floor(dim.h / grid);
    while (true) {
      var f = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
      var hit = snake.some(function (s) { return s.x === f.x && s.y === f.y; });
      if (!hit) { food = f; return; }
    }
  }
  function draw() {
    ctx.fillStyle = cfg.bg || '#0f2027';
    ctx.fillRect(0, 0, dim.w, dim.h);
    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (var x = 0; x < dim.w; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, dim.h); ctx.stroke(); }
    for (var y = 0; y < dim.h; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(dim.w, y); ctx.stroke(); }
    // 食物
    ctx.fillStyle = '#ff4757';
    GameKit.roundRect(ctx, food.x * grid + 2, food.y * grid + 2, grid - 4, grid - 4, 6);
    ctx.fill();
    // 蛇
    for (var i = 0; i < snake.length; i++) {
      var s = snake[i];
      ctx.fillStyle = i === 0 ? '#2ed573' : (cfg.color || '#7bed9f');
      var pad = i === 0 ? 1 : 2;
      GameKit.roundRect(ctx, s.x * grid + pad, s.y * grid + pad, grid - pad * 2, grid - pad * 2, 5);
      ctx.fill();
    }
    drawHUD();
  }
  function drawHUD() {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('🐍 得分 ' + score, 12, 26);
    ctx.textAlign = 'center';
    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, dim.w, dim.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('游戏结束', dim.w / 2, dim.h / 2 - 24);
      ctx.font = '16px sans-serif';
      ctx.fillText('得分：' + score, dim.w / 2, dim.h / 2 + 6);
      ctx.fillStyle = '#2ed573';
      GameKit.roundRect(ctx, dim.w / 2 - 70, dim.h / 2 + 24, 140, 44, 22);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('↺ 重新开始', dim.w / 2, dim.h / 2 + 53);
    }
  }
  function step() {
    if (!running) return;
    if (!(nextDir.x === -dir.x && nextDir.y === -dir.y)) dir = nextDir;
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    var cols = Math.floor(dim.w / grid), rows = Math.floor(dim.h / grid);
    var wallHit = head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows;
    var selfHit = snake.some(function (s) { return s.x === head.x && s.y === head.y; });
    if (wallHit || selfHit) {
      running = false; over = true; GameKit.beep(180, 200, 0.04);
      return;
    }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score++; GameKit.beep(600, 60, 0.03);
      placeFood();
      speed = Math.max(70, speed - 4);
    } else {
      snake.pop();
    }
  }
  function loop() {
    step();
    draw();
    if (!over) timer = setTimeout(loop, speed);
    else { draw(); raf = requestAnimationFrame(loop); }
  }
  function handleInput() {
    if (over && inputReady) {
      reset(); draw();
      if (timer) clearTimeout(timer);
      raf = requestAnimationFrame(loop);
      return;
    }
  }
  var inputReady = true;
  function onSwipe(x, y, dx, dy) {
    if (!running) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      nextDir = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
    } else {
      nextDir = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
    }
  }
  function onTap() { if (over) { reset(); if (timer) clearTimeout(timer); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); } }

  var d = GameKit.fit(canvas);
  dim = { w: d.w, h: d.h }; ctx = d.ctx;
  inp = GameKit.input(canvas, { move: onSwipe, start: function (x, y) { lastTap = Date.now(); }, end: onTap });
  var lastTap = 0;
  speed = (cfg && cfg.speed) ? Math.max(70, 140 - (cfg.speed - 1) * 25) : 110;
  reset();
  draw();
  raf = requestAnimationFrame(loop);

  var autoFitHandle = GameKit.autoFit(canvas, function (d) {

    dim = { w: d.w, h: d.h }; ctx = d.ctx;

    draw();

  });

  return {
    destroy: function () {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      inp.destroy();
      if (autoFitHandle && autoFitHandle.destroy) autoFitHandle.destroy();
    }
  };
}

/* ================= 模板 2：打砖块 ================= */
function GameBreakout(container, cfg) {
  var canvas = GameKit.canvasFor(container);
  var dim, ctx, inp, raf, running = false, over = false, win = false;
  var paddle, ball, bricks, score, bricksLeft, paused = false;

  var cols = 6, rows = 5;
  function reset() {
    var bw = dim.w / cols;
    var bh = 26;
    var top = 70;
    bricks = [];
    bricksLeft = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        bricks.push({ x: c * bw + 2, y: top + r * (bh + 6), w: bw - 4, h: bh, alive: true, color: 'hsl(' + (140 + r * 30) + ',70%,50%)' });
        bricksLeft++;
      }
    }
    paddle = { x: dim.w / 2 - 50, y: dim.h - 46, w: 100, h: 14 };
    var speed = 5 + Math.min(4, (cfg && cfg.speed) || 1);
    ball = { x: dim.w / 2, y: dim.h - 70, vx: speed * (Math.random() > 0.5 ? 1 : -1), vy: -speed, r: 8, stuck: true };
    score = 0; over = false; win = false; running = true;
  }
  function draw() {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, dim.w, dim.h);
    // bricks
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (!b.alive) continue;
      ctx.fillStyle = b.color;
      GameKit.roundRect(ctx, b.x, b.y, b.w, b.h, 4);
      ctx.fill();
    }
    // paddle
    ctx.fillStyle = '#e94560';
    GameKit.roundRect(ctx, paddle.x, paddle.y, paddle.w, paddle.h, 7);
    ctx.fill();
    // ball
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    // HUD
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('🧱 得分 ' + score, 12, 26);
    if (over || win) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, dim.w, dim.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(win ? '🎉 通关！' : '游戏结束', dim.w / 2, dim.h / 2 - 24);
      ctx.font = '16px sans-serif';
      ctx.fillText('得分：' + score, dim.w / 2, dim.h / 2 + 6);
      ctx.fillStyle = '#2ed573';
      GameKit.roundRect(ctx, dim.w / 2 - 70, dim.h / 2 + 24, 140, 44, 22);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('↺ 重新开始', dim.w / 2, dim.h / 2 + 53);
    }
  }
  function update() {
    if (!running || paused || ball.stuck) return;
    ball.x += ball.vx; ball.y += ball.vy;
    if (ball.x < ball.r || ball.x > dim.w - ball.r) { ball.vx = -ball.vx; GameKit.beep(400, 40, 0.02); }
    if (ball.y < ball.r) { ball.vy = -ball.vy; GameKit.beep(400, 40, 0.02); }
    // paddle
    if (ball.vy > 0 && ball.y + ball.r >= paddle.y && ball.y + ball.r <= paddle.y + paddle.h + 6 &&
        ball.x >= paddle.x - ball.r && ball.x <= paddle.x + paddle.w + ball.r) {
      var hit = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
      ball.vy = -Math.abs(ball.vy);
      ball.vx = hit * 7;
      GameKit.beep(500, 40, 0.02);
    }
    // bricks
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (!b.alive) continue;
      if (ball.x + ball.r > b.x && ball.x - ball.r < b.x + b.w &&
          ball.y + ball.r > b.y && ball.y - ball.r < b.y + b.h) {
        b.alive = false; bricksLeft--; score += 10;
        ball.vy = -ball.vy;
        GameKit.beep(600, 40, 0.03);
        if (bricksLeft <= 0) { win = true; running = false; }
      }
    }
    if (ball.y > dim.h + 20) { over = true; running = false; GameKit.beep(180, 200, 0.04); }
  }
  function loop() {
    update();
    draw();
    raf = requestAnimationFrame(loop);
  }
  function onMove(x, y, dx) {
    if (!running) return;
    if (ball.stuck) {
      paddle.x = x - paddle.w / 2;
      ball.x = x;
      ball.y = dim.h - 70;
    } else {
      paddle.x = x - paddle.w / 2;
    }
    paddle.x = Math.max(0, Math.min(dim.w - paddle.w, paddle.x));
  }
  function onStart(x, y) {
    if (over || win) { reset(); return; }
    if (ball.stuck) { ball.stuck = false; }
  }
  var d = GameKit.fit(canvas);
  dim = { w: d.w, h: d.h }; ctx = d.ctx;
  inp = GameKit.input(canvas, { start: onStart, move: onMove });
  reset();
  draw();
  raf = requestAnimationFrame(loop);
  var autoFitHandle = GameKit.autoFit(canvas, function (d) {

    dim = { w: d.w, h: d.h }; ctx = d.ctx;

    draw();

  });
  return {
    destroy: function () { cancelAnimationFrame(raf); inp.destroy(); if (autoFitHandle && autoFitHandle.destroy) autoFitHandle.destroy(); }
  };
}

/* ================= 模板 3：弹跳小鸟（Flappy） ================= */
function GameFlappy(container, cfg) {
  var canvas = GameKit.canvasFor(container);
  var dim, ctx, inp, raf, running = false, over = false;
  var bird, pipes, score, speed, started = false;

  function reset() {
    bird = { x: dim.w * 0.3, y: dim.h / 2, vy: 0, r: 14 };
    pipes = [];
    score = 0; over = false; started = false; running = true;
  }
  function addPipe() {
    var gap = 140;
    var minTop = 60, maxTop = dim.h - gap - 60;
    var topH = minTop + Math.random() * (maxTop - minTop);
    pipes.push({ x: dim.w + 30, top: topH, gap: gap, w: 56, scored: false });
  }
  function draw() {
    var grad = ctx.createLinearGradient(0, 0, 0, dim.h);
    grad.addColorStop(0, '#0f2027');
    grad.addColorStop(1, '#203a43');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, dim.w, dim.h);
    // pipes
    for (var i = 0; i < pipes.length; i++) {
      var p = pipes[i];
      ctx.fillStyle = '#2ed573';
      ctx.fillRect(p.x, 0, p.w, p.top);
      ctx.fillRect(p.x, p.top + p.gap, p.w, dim.h - p.top - p.gap);
      ctx.fillStyle = '#27ae60';
      ctx.fillRect(p.x - 4, p.top - 14, p.w + 8, 14);
      ctx.fillRect(p.x - 4, p.top + p.gap, p.w + 8, 14);
    }
    // bird
    ctx.beginPath();
    ctx.arc(bird.x, bird.y, bird.r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd93d';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bird.x + 6, bird.y - 4, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bird.x + 8, bird.y - 4, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    // HUD
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('🐤 得分 ' + score, 12, 26);
    if (!started && !over) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('点击屏幕，小鸟跳跃', dim.w / 2, dim.h / 2 + 40);
    }
    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, dim.w, dim.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('游戏结束', dim.w / 2, dim.h / 2 - 24);
      ctx.font = '16px sans-serif';
      ctx.fillText('得分：' + score, dim.w / 2, dim.h / 2 + 6);
      ctx.fillStyle = '#2ed573';
      GameKit.roundRect(ctx, dim.w / 2 - 70, dim.h / 2 + 24, 140, 44, 22);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('↺ 重新开始', dim.w / 2, dim.h / 2 + 53);
    }
  }
  function update() {
    if (!running || over || !started) return;
    bird.vy += 0.4;
    bird.y += bird.vy;
    // pipes
    if (pipes.length === 0 || pipes[pipes.length - 1].x < dim.w - 220) addPipe();
    for (var i = pipes.length - 1; i >= 0; i--) {
      var p = pipes[i];
      p.x -= 3;
      if (!p.scored && p.x + p.w < bird.x) { p.scored = true; score++; GameKit.beep(700, 50, 0.03); }
      if (p.x < -60) pipes.splice(i, 1);
    }
    // collision
    if (bird.y < 0 || bird.y > dim.h) { over = true; GameKit.beep(180, 200, 0.04); return; }
    for (var j = 0; j < pipes.length; j++) {
      var q = pipes[j];
      if (bird.x + bird.r > q.x && bird.x - bird.r < q.x + q.w &&
          (bird.y - bird.r < q.top || bird.y + bird.r > q.top + q.gap)) {
        over = true; GameKit.beep(180, 200, 0.04); return;
      }
    }
  }
  function loop() {
    update();
    draw();
    raf = requestAnimationFrame(loop);
  }
  function flap() {
    if (over) { reset(); return; }
    started = true;
    bird.vy = -7;
    GameKit.beep(500, 40, 0.02);
  }
  var d = GameKit.fit(canvas);
  dim = { w: d.w, h: d.h }; ctx = d.ctx;
  inp = GameKit.input(canvas, { start: flap });
  reset();
  draw();
  raf = requestAnimationFrame(loop);
  var autoFitHandle = GameKit.autoFit(canvas, function (d) {

    dim = { w: d.w, h: d.h }; ctx = d.ctx;

    draw();

  });
  return {
    destroy: function () { cancelAnimationFrame(raf); inp.destroy(); if (autoFitHandle && autoFitHandle.destroy) autoFitHandle.destroy(); }
  };
}

/* ================= 模板 4：飞机射击 ================= */
function GameShooter(container, cfg) {
  var canvas = GameKit.canvasFor(container);
  var dim, ctx, inp, raf, running = false, over = false;
  var player, bullets, enemies, score, spawnTimer, lives;

  function reset() {
    player = { x: dim.w / 2, y: dim.h - 80, w: 44, h: 44 };
    bullets = [];
    enemies = [];
    score = 0; lives = 3; over = false; running = true;
    spawnTimer = 0;
  }
  function draw() {
    ctx.fillStyle = '#0a0f1e';
    ctx.fillRect(0, 0, dim.w, dim.h);
    // stars
    for (var i = 0; i < 30; i++) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.2 + (i % 5) * 0.12) + ')';
      var sx = ((i * 137) % dim.w);
      var sy = ((i * 71) % dim.h);
      ctx.fillRect(sx, sy, 2, 2);
    }
    // bullets
    ctx.fillStyle = '#ffe66d';
    for (var b = 0; b < bullets.length; b++) {
      ctx.fillRect(bullets[b].x - 2, bullets[b].y - 10, 4, 20);
    }
    // enemies
    for (var e = 0; e < enemies.length; e++) {
      var en = enemies[e];
      ctx.fillStyle = en.hp > 1 ? '#ff6b6b' : '#ff4757';
      ctx.beginPath();
      ctx.moveTo(en.x, en.y - 16);
      ctx.lineTo(en.x - 14, en.y + 12);
      ctx.lineTo(en.x + 14, en.y + 12);
      ctx.closePath();
      ctx.fill();
    }
    // player
    ctx.fillStyle = '#4dabf7';
    ctx.beginPath();
    ctx.moveTo(player.x, player.y - 22);
    ctx.lineTo(player.x - 18, player.y + 20);
    ctx.lineTo(player.x + 18, player.y + 20);
    ctx.closePath();
    ctx.fill();
    // HUD
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('✈️ 得分 ' + score + '  ❤️ ' + lives, 12, 26);
    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, dim.w, dim.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('游戏结束', dim.w / 2, dim.h / 2 - 24);
      ctx.font = '16px sans-serif';
      ctx.fillText('得分：' + score, dim.w / 2, dim.h / 2 + 6);
      ctx.fillStyle = '#2ed573';
      GameKit.roundRect(ctx, dim.w / 2 - 70, dim.h / 2 + 24, 140, 44, 22);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('↺ 重新开始', dim.w / 2, dim.h / 2 + 53);
    }
  }
  function update() {
    if (!running || over) return;
    // auto shoot
    bullets.push({ x: player.x, y: player.y - 22 });
    if (bullets.length > 30) bullets.splice(0, bullets.length - 30);
    for (var b = bullets.length - 1; b >= 0; b--) {
      bullets[b].y -= 8;
      if (bullets[b].y < -20) bullets.splice(b, 1);
    }
    // spawn
    spawnTimer++;
    if (spawnTimer > Math.max(20, 40 - score / 20)) {
      spawnTimer = 0;
      var ex = 20 + Math.random() * (dim.w - 40);
      var speed = 1.5 + Math.random() * 1.5;
      var hp = Math.random() < 0.15 ? 2 : 1;
      enemies.push({ x: ex, y: -20, vy: speed, hp: hp });
    }
    // move enemies
    for (var e = enemies.length - 1; e >= 0; e--) {
      var en = enemies[e];
      en.y += en.vy;
      if (en.y > dim.h + 20) enemies.splice(e, 1);
    }
    // bullets vs enemies
    for (var i = bullets.length - 1; i >= 0; i--) {
      var bl = bullets[i];
      for (var j = enemies.length - 1; j >= 0; j--) {
        var em = enemies[j];
        if (bl.x > em.x - 16 && bl.x < em.x + 16 && bl.y > em.y - 16 && bl.y < em.y + 16) {
          em.hp--;
          bullets.splice(i, 1);
          if (em.hp <= 0) { enemies.splice(j, 1); score += 10; GameKit.beep(600, 40, 0.02); }
          break;
        }
      }
    }
    // player vs enemies
    for (var k = enemies.length - 1; k >= 0; k--) {
      var p = enemies[k];
      if (Math.abs(p.x - player.x) < 30 && Math.abs(p.y - player.y) < 30) {
        enemies.splice(k, 1);
        lives--;
        GameKit.beep(200, 150, 0.04);
        if (lives <= 0) { over = true; }
      }
    }
  }
  function loop() {
    update();
    draw();
    raf = requestAnimationFrame(loop);
  }
  function onMove(x, y) {
    if (!running || over) return;
    player.x = x;
    player.y = Math.max(40, Math.min(dim.h - 40, y));
  }
  function onStart(x, y) {
    if (over) reset();
  }
  var d = GameKit.fit(canvas);
  dim = { w: d.w, h: d.h }; ctx = d.ctx;
  inp = GameKit.input(canvas, { start: onStart, move: onMove });
  reset();
  draw();
  raf = requestAnimationFrame(loop);
  var autoFitHandle = GameKit.autoFit(canvas, function (d) {

    dim = { w: d.w, h: d.h }; ctx = d.ctx;

    draw();

  });
  return {
    destroy: function () { cancelAnimationFrame(raf); inp.destroy(); if (autoFitHandle && autoFitHandle.destroy) autoFitHandle.destroy(); }
  };
}

/* ================= 模板 5：2048 ================= */
function Game2048(container, cfg) {
  var canvas = GameKit.canvasFor(container);
  var dim, ctx, inp, raf, grid, score, over, won, size = 4;

  var TILE_COLORS = {
    2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563',
    32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61',
    512: '#edc850', 1024: '#edc53f', 2048: '#edc22e'
  };
  function reset() {
    grid = [];
    for (var i = 0; i < size; i++) { grid.push(new Array(size).fill(0)); }
    score = 0; over = false; won = false;
    addTile(); addTile();
  }
  function addTile() {
    var empty = [];
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) if (grid[r][c] === 0) empty.push({ r: r, c: c });
    if (!empty.length) return;
    var cell = empty[Math.floor(Math.random() * empty.length)];
    grid[cell.r][cell.c] = Math.random() < 0.9 ? 2 : 4;
  }
  function slide(row) {
    var arr = row.filter(function (v) { return v !== 0; });
    for (var i = 0; i < arr.length - 1; i++) {
      if (arr[i] === arr[i + 1]) {
        arr[i] *= 2;
        score += arr[i];
        if (arr[i] === 2048) won = true;
        arr.splice(i + 1, 1);
      }
    }
    while (arr.length < size) arr.push(0);
    return arr;
  }
  function move(dir) {
    var changed = false;
    var ng = [];
    for (var r = 0; r < size; r++) ng.push(grid[r].slice());
    for (var i = 0; i < size; i++) {
      var row;
      if (dir === 0 || dir === 2) { // left / right
        row = ng[i].slice();
        if (dir === 2) row.reverse();
        var ns = slide(row);
        if (dir === 2) ns.reverse();
        for (var c = 0; c < size; c++) if (ng[i][c] !== ns[c]) changed = true;
        ng[i] = ns;
      } else { // up / down
        var col = [];
        for (var j = 0; j < size; j++) col.push(ng[j][i]);
        if (dir === 3) col.reverse();
        var ns2 = slide(col);
        if (dir === 3) ns2.reverse();
        for (var k = 0; k < size; k++) if (ng[k][i] !== ns2[k]) changed = true;
        for (var m = 0; m < size; m++) ng[m][i] = ns2[m];
      }
    }
    if (changed) { grid = ng; addTile(); checkOver(); }
  }
  function checkOver() {
    var full = true;
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) if (grid[r][c] === 0) full = false;
    if (!full) return;
    for (var i = 0; i < size; i++) for (var j = 0; j < size; j++) {
      if (i + 1 < size && grid[i][j] === grid[i + 1][j]) return;
      if (j + 1 < size && grid[i][j] === grid[i][j + 1]) return;
    }
    over = true;
  }
  function draw() {
    ctx.fillStyle = '#0f2027';
    ctx.fillRect(0, 0, dim.w, dim.h);
    var gap = 8;
    var pad = 12;
    var bw = (dim.w - pad * 2 - gap * (size - 1)) / size;
    var boardH = bw * size + gap * (size - 1);
    var top = Math.max(60, (dim.h - boardH) / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    GameKit.roundRect(ctx, pad - 4, top - 4, dim.w - pad * 2 + 8, boardH + 8, 10);
    ctx.fill();
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var v = grid[r][c];
        var x = pad + c * (bw + gap);
        var y = top + r * (bw + gap);
        ctx.fillStyle = v ? (TILE_COLORS[v] || '#3c3a32') : 'rgba(255,255,255,0.08)';
        GameKit.roundRect(ctx, x, y, bw, bw, 6);
        ctx.fill();
        if (v) {
          ctx.fillStyle = v <= 4 ? '#776e65' : '#f9f6f2';
          ctx.font = 'bold ' + (v >= 1024 ? 20 : v >= 128 ? 26 : 30) + 'px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(v, x + bw / 2, y + bw / 2 + 2);
        }
      }
    }
    ctx.textBaseline = 'alphabetic';
    // HUD
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('🎯 得分 ' + score, 12, 30);
    ctx.font = '13px sans-serif';
    ctx.fillText('滑动屏幕移动方块，合并到 2048', 12, 50);
    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, dim.w, dim.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('游戏结束', dim.w / 2, dim.h / 2 - 24);
      ctx.font = '16px sans-serif';
      ctx.fillText('得分：' + score, dim.w / 2, dim.h / 2 + 6);
      ctx.fillStyle = '#2ed573';
      GameKit.roundRect(ctx, dim.w / 2 - 70, dim.h / 2 + 24, 140, 44, 22);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('↺ 重新开始', dim.w / 2, dim.h / 2 + 53);
    } else if (won) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, dim.w, dim.h);
      ctx.fillStyle = '#ffd93d';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🎉 2048 达成！', dim.w / 2, dim.h / 2 - 10);
      ctx.fillStyle = '#2ed573';
      GameKit.roundRect(ctx, dim.w / 2 - 70, dim.h / 2 + 20, 140, 44, 22);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('继续挑战', dim.w / 2, dim.h / 2 + 49);
    }
  }
  function onSwipe(x, y, dx, dy) {
    if (over) return;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    var dir;
    if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 2 : 0;
    else dir = dy > 0 ? 3 : 1;
    move(dir);
    GameKit.beep(400, 30, 0.02);
  }
  function onStart(x, y) {
    if (over) reset();
  }
  var d = GameKit.fit(canvas);
  dim = { w: d.w, h: d.h }; ctx = d.ctx;
  inp = GameKit.input(canvas, { start: onStart, move: onSwipe });
  reset();
  draw();
  raf = requestAnimationFrame(loop);
  function loop() { draw(); raf = requestAnimationFrame(loop); }
  var autoFitHandle = GameKit.autoFit(canvas, function (d) {

    dim = { w: d.w, h: d.h }; ctx = d.ctx;

    draw();

  });
  return {
    destroy: function () { cancelAnimationFrame(raf); inp.destroy(); if (autoFitHandle && autoFitHandle.destroy) autoFitHandle.destroy(); }
  };
}

/* ================= 模板 6：打地鼠 ================= */
function GameWhack(container, cfg) {
  var canvas = GameKit.canvasFor(container);
  var dim, ctx, inp, raf, running = false, over = false;
  var moles, score, timeLeft, speed;

  function reset() {
    moles = [];
    for (var i = 0; i < 9; i++) {
      moles.push({ up: false, timer: 0, x: 0, y: 0, hit: false, w: 0, h: 0 });
    }
    score = 0; timeLeft = 30; over = false; running = true;
    layout();
    speed = (cfg && cfg.speed) ? cfg.speed : 1;
  }
  function layout() {
    var cols = 3;
    var gap = 16;
    var bw = Math.min(120, (dim.w - gap * (cols + 1)) / cols);
    var rows = 3;
    var bh = bw * 0.8;
    var totalW = cols * bw + gap * (cols - 1);
    var totalH = rows * bh + gap * (rows - 1);
    var ox = (dim.w - totalW) / 2;
    var oy = Math.max(70, (dim.h - totalH) / 2);
    for (var i = 0; i < 9; i++) {
      var r = Math.floor(i / cols), c = i % cols;
      moles[i].x = ox + c * (bw + gap);
      moles[i].y = oy + r * (bh + gap);
      moles[i].w = bw;
      moles[i].h = bh;
    }
  }
  function draw() {
    ctx.fillStyle = '#1a2f1a';
    ctx.fillRect(0, 0, dim.w, dim.h);
    // holes
    for (var i = 0; i < 9; i++) {
      var m = moles[i];
      ctx.beginPath();
      ctx.arc(m.x + m.w / 2, m.y + m.h, m.w / 2, Math.PI, 0);
      ctx.fillStyle = '#2d4a2d';
      ctx.fill();
      if (m.up) {
        ctx.beginPath();
        ctx.arc(m.x + m.w / 2, m.y + m.h - 10, m.w * 0.32, 0, Math.PI * 2);
        ctx.fillStyle = m.hit ? '#ff4757' : '#d4a373';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(m.x + m.w / 2 - 6, m.y + m.h - 14, 3, 0, Math.PI * 2);
        ctx.arc(m.x + m.w / 2 + 6, m.y + m.h - 14, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#000';
        ctx.fill();
      }
    }
    // HUD
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('🔨 得分 ' + score, 12, 28);
    ctx.textAlign = 'right';
    ctx.fillText('⏱ ' + Math.ceil(timeLeft) + 's', dim.w - 12, 28);
    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, dim.w, dim.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('时间到！', dim.w / 2, dim.h / 2 - 24);
      ctx.font = '16px sans-serif';
      ctx.fillText('得分：' + score, dim.w / 2, dim.h / 2 + 6);
      ctx.fillStyle = '#2ed573';
      GameKit.roundRect(ctx, dim.w / 2 - 70, dim.h / 2 + 24, 140, 44, 22);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('↺ 再来一局', dim.w / 2, dim.h / 2 + 53);
    }
  }
  function update() {
    if (!running || over) return;
    timeLeft -= 1 / 60;
    if (timeLeft <= 0) { timeLeft = 0; over = true; return; }
    for (var i = 0; i < 9; i++) {
      var m = moles[i];
      if (m.up) {
        m.timer--;
        if (m.timer <= 0) { m.up = false; }
      } else if (Math.random() < 0.008 * speed) {
        m.up = true;
        m.hit = false;
        m.timer = 40 + Math.random() * 30;
      }
    }
  }
  function loop() {
    update();
    draw();
    raf = requestAnimationFrame(loop);
  }
  function onStart(x, y) {
    if (over) { reset(); return; }
    for (var i = 0; i < 9; i++) {
      var m = moles[i];
      if (m.up && x > m.x && x < m.x + m.w && y > m.y && y < m.y + m.h) {
        if (!m.hit) {
          m.hit = true;
          m.up = false;
          score++;
          GameKit.beep(700, 50, 0.03);
        }
      }
    }
  }
  var d = GameKit.fit(canvas);
  dim = { w: d.w, h: d.h }; ctx = d.ctx;
  inp = GameKit.input(canvas, { start: onStart });
  reset();
  draw();
  raf = requestAnimationFrame(loop);
  var autoFitHandle = GameKit.autoFit(canvas, function (d) {
    dim = { w: d.w, h: d.h }; ctx = d.ctx;
    layout();
    draw();
  });
  return {
    destroy: function () {
      cancelAnimationFrame(raf); inp.destroy();
      if (autoFitHandle && autoFitHandle.destroy) autoFitHandle.destroy();
    }
  };
}

/* ================= 模板 7：俄罗斯方块 ================= */
function GameTetris(container, cfg) {
  var canvas = GameKit.canvasFor(container);
  var dim, ctx, inp, raf, over = false;
  var COLS = 10, ROWS = 20, cell, board, cur, nx, ny, score, lines, dropTimer, lastDrop;
  var SHAPES = [
    [[1,1,1,1]],
    [[1,1],[1,1]],
    [[0,1,0],[1,1,1]],
    [[1,0,0],[1,1,1]],
    [[0,0,1],[1,1,1]],
    [[1,1,0],[0,1,1]],
    [[0,1,1],[1,1,0]]
  ];
  var COLORS = ['#00d2ff','#ffd700','#a855f7','#3b82f6','#f97316','#22c55e','#ef4444'];
  function reset() {
    var w = dim.w, h = dim.h;
    cell = Math.floor(Math.min(w / COLS, (h - 60) / ROWS));
    board = [];
    for (var r = 0; r < ROWS; r++) { board.push(new Array(COLS).fill(0)); }
    score = 0; lines = 0; over = false;
    spawn();
    lastDrop = Date.now();
  }
  function spawn() {
    var idx = Math.floor(Math.random() * SHAPES.length);
    cur = { shape: SHAPES[idx].map(function(r){return r.slice();}), color: COLORS[idx] };
    nx = Math.floor((COLS - cur.shape[0].length) / 2);
    ny = 0;
    if (collide(nx, ny, cur.shape)) { over = true; }
  }
  function collide(x, y, shape) {
    for (var r = 0; r < shape.length; r++) {
      for (var c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        var bx = x + c, by = y + r;
        if (bx < 0 || bx >= COLS || by >= ROWS) return true;
        if (by >= 0 && board[by][bx]) return true;
      }
    }
    return false;
  }
  function merge() {
    for (var r = 0; r < cur.shape.length; r++) {
      for (var c = 0; c < cur.shape[r].length; c++) {
        if (cur.shape[r][c] && ny + r >= 0) board[ny + r][nx + c] = cur.color;
      }
    }
  }
  function clearLines() {
    var cleared = 0;
    for (var r = ROWS - 1; r >= 0; r--) {
      if (board[r].every(function(v){return v;})) {
        board.splice(r, 1);
        board.unshift(new Array(COLS).fill(0));
        cleared++; r++;
      }
    }
    if (cleared) {
      score += [0,100,300,500,800][cleared];
      lines += cleared;
      GameKit.beep(600, 80, 0.04);
    }
  }
  function rotate() {
    var s = cur.shape;
    var rotated = [];
    for (var c = 0; c < s[0].length; c++) {
      var row = [];
      for (var r = s.length - 1; r >= 0; r--) row.push(s[r][c]);
      rotated.push(row);
    }
    if (!collide(nx, ny, rotated)) cur.shape = rotated;
    else if (!collide(nx - 1, ny, rotated)) { cur.shape = rotated; nx--; }
    else if (!collide(nx + 1, ny, rotated)) { cur.shape = rotated; nx++; }
  }
  function drop() {
    if (!collide(nx, ny + 1, cur.shape)) { ny++; }
    else { merge(); clearLines(); spawn(); }
  }
  function draw() {
    ctx.fillStyle = '#0f0f23';
    ctx.fillRect(0, 0, dim.w, dim.h);
    var ox = Math.floor((dim.w - COLS * cell) / 2);
    var oy = 50;
    // 棋盘背景
    ctx.fillStyle = '#1a1a3e';
    ctx.fillRect(ox - 2, oy - 2, COLS * cell + 4, ROWS * cell + 4);
    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (var r = 0; r <= ROWS; r++) {
      ctx.beginPath(); ctx.moveTo(ox, oy + r * cell); ctx.lineTo(ox + COLS * cell, oy + r * cell); ctx.stroke();
    }
    for (var c = 0; c <= COLS; c++) {
      ctx.beginPath(); ctx.moveTo(ox + c * cell, oy); ctx.lineTo(ox + c * cell, oy + ROWS * cell); ctx.stroke();
    }
    // 已固定方块
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (board[r][c]) {
          ctx.fillStyle = board[r][c];
          ctx.fillRect(ox + c * cell + 1, oy + r * cell + 1, cell - 2, cell - 2);
        }
      }
    }
    // 当前方块
    if (cur && !over) {
      ctx.fillStyle = cur.color;
      for (var r = 0; r < cur.shape.length; r++) {
        for (var c = 0; c < cur.shape[r].length; c++) {
          if (cur.shape[r][c]) {
            ctx.fillRect(ox + (nx + c) * cell + 1, oy + (ny + r) * cell + 1, cell - 2, cell - 2);
          }
        }
      }
    }
    // HUD
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('分数: ' + score, 10, 25);
    ctx.textAlign = 'right';
    ctx.fillText('消行: ' + lines, dim.w - 10, 25);
    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, dim.w, dim.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('游戏结束', dim.w / 2, dim.h / 2 - 20);
      ctx.font = '16px sans-serif';
      ctx.fillText('得分: ' + score, dim.w / 2, dim.h / 2 + 15);
      ctx.fillText('点击重新开始', dim.w / 2, dim.h / 2 + 45);
    }
  }
  function loop() {
    if (!over) {
      var now = Date.now();
      var speed = Math.max(100, 500 - lines * 30);
      if (now - lastDrop > speed) { drop(); lastDrop = now; }
    }
    draw();
    raf = requestAnimationFrame(loop);
  }
  var startX = 0, startY = 0, startT = 0;
  function onStart(x, y) { startX = x; startY = y; startT = Date.now(); if (over) { reset(); } }
  function onEnd(x, y) {
    if (over) return;
    var dx = x - startX, dy = y - startY, dt = Date.now() - startT;
    if (dt < 250 && Math.abs(dx) < 20 && Math.abs(dy) < 20) { rotate(); GameKit.beep(500, 30, 0.02); }
    else if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 20) { if (!collide(nx + 1, ny, cur.shape)) nx++; }
      else if (dx < -20) { if (!collide(nx - 1, ny, cur.shape)) nx--; }
    } else if (dy > 30) { drop(); lastDrop = Date.now(); }
  }
  var d = GameKit.fit(canvas);
  dim = { w: d.w, h: d.h }; ctx = d.ctx;
  inp = GameKit.input(canvas, { start: onStart, end: onEnd });
  reset();
  var autoFitHandle = GameKit.autoFit(canvas, function (d) {
    dim = { w: d.w, h: d.h }; ctx = d.ctx; reset(); draw();
  });
  raf = requestAnimationFrame(loop);
  return {
    destroy: function () {
      cancelAnimationFrame(raf); inp.destroy();
      if (autoFitHandle && autoFitHandle.destroy) autoFitHandle.destroy();
    }
  };
}

/* ================= 模板 8：记忆翻牌 ================= */
function GameMemory(container, cfg) {
  var canvas = GameKit.canvasFor(container);
  var dim, ctx, inp, raf, over = false;
  var EMOJIS = ['🍎','🍌','🍇','🍓','🍊','🍉','🥝','🍑'];
  var cards = [], flipped = [], matched = [], moves = 0, startTime = 0, elapsed = 0;
  var cols = 4, rows = 4, cw, ch, gx, gy;
  function reset() {
    var pool = EMOJIS.concat(EMOJIS);
    cards = [];
    while (pool.length) {
      var idx = Math.floor(Math.random() * pool.length);
      cards.push({ emoji: pool.splice(idx, 1)[0], flipped: false, matched: false });
    }
    flipped = []; matched = []; moves = 0; over = false;
    startTime = Date.now(); elapsed = 0;
    layout();
  }
  function layout() {
    cw = Math.floor(dim.w / cols) - 8;
    ch = Math.floor((dim.h - 80) / rows) - 8;
    cw = ch = Math.min(cw, ch);
    gx = Math.floor((dim.w - cols * (cw + 8)) / 2);
    gy = 70;
  }
  function draw() {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, dim.w, dim.h);
    // HUD
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('步数: ' + moves, 10, 30);
    ctx.textAlign = 'right';
    elapsed = Math.floor((Date.now() - startTime) / 1000);
    ctx.fillText('时间: ' + elapsed + 's', dim.w - 10, 30);
    ctx.textAlign = 'center';
    ctx.font = '12px sans-serif';
    ctx.fillText('已配对: ' + matched.length / 2 + ' / 8', dim.w / 2, 55);
    // 卡片
    for (var i = 0; i < cards.length; i++) {
      var r = Math.floor(i / cols), c = i % cols;
      var x = gx + c * (cw + 8), y = gy + r * (ch + 8);
      var card = cards[i];
      if (card.matched) {
        ctx.fillStyle = 'rgba(34,197,94,0.3)';
        ctx.fillRect(x, y, cw, ch);
        ctx.font = Math.floor(cw * 0.5) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(card.emoji, x + cw / 2, y + ch / 2);
      } else if (card.flipped || flipped.indexOf(i) >= 0) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, y, cw, ch);
        ctx.font = Math.floor(cw * 0.5) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(card.emoji, x + cw / 2, y + ch / 2);
      } else {
        ctx.fillStyle = '#4f46e5';
        GameKit.roundRect(ctx, x, y, cw, ch, 8);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = 'bold ' + Math.floor(cw * 0.4) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', x + cw / 2, y + ch / 2);
      }
    }
    ctx.textBaseline = 'alphabetic';
    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, 0, dim.w, dim.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🎉 全部配对！', dim.w / 2, dim.h / 2 - 30);
      ctx.font = '16px sans-serif';
      ctx.fillText('步数: ' + moves + ' · 用时: ' + elapsed + 's', dim.w / 2, dim.h / 2 + 5);
      ctx.fillText('点击重新开始', dim.w / 2, dim.h / 2 + 40);
    }
    if (!over) raf = requestAnimationFrame(draw);
  }
  function onStart(x, y) {
    if (over) { reset(); raf = requestAnimationFrame(draw); return; }
    if (flipped.length >= 2) return;
    var r = Math.floor((y - gy) / (ch + 8)), c = Math.floor((x - gx) / (cw + 8));
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    var idx = r * cols + c;
    if (idx < 0 || idx >= cards.length || cards[idx].flipped || cards[idx].matched) return;
    cards[idx].flipped = true;
    flipped.push(idx);
    GameKit.beep(700, 40, 0.03);
    if (flipped.length === 2) {
      moves++;
      var a = cards[flipped[0]], b = cards[flipped[1]];
      if (a.emoji === b.emoji) {
        a.matched = b.matched = true;
        matched.push(flipped[0], flipped[1]);
        flipped = [];
        GameKit.beep(900, 80, 0.04);
        if (matched.length === cards.length) { over = true; }
      } else {
        setTimeout(function () {
          cards[flipped[0]].flipped = false;
          cards[flipped[1]].flipped = false;
          flipped = [];
        }, 800);
      }
    }
  }
  var d = GameKit.fit(canvas);
  dim = { w: d.w, h: d.h }; ctx = d.ctx;
  inp = GameKit.input(canvas, { start: onStart });
  reset();
  var autoFitHandle = GameKit.autoFit(canvas, function (d) {
    dim = { w: d.w, h: d.h }; ctx = d.ctx; layout();
  });
  raf = requestAnimationFrame(draw);
  return {
    destroy: function () {
      cancelAnimationFrame(raf); inp.destroy();
      if (autoFitHandle && autoFitHandle.destroy) autoFitHandle.destroy();
    }
  };
}

/* ================= 模板 9：消消乐 ================= */
function GameMatch3(container, cfg) {
  var canvas = GameKit.canvasFor(container);
  var dim, ctx, inp, raf, over = false;
  var COLS = 8, ROWS = 8, cell, gx, gy;
  var COLORS = ['#ef4444','#f59e0b','#22c55e','#3b82f6','#a855f7','#ec4899'];
  var board = [], score = 0, moves = 0, selected = null, swapping = false, removing = false;
  function reset() {
    cell = Math.floor(Math.min(dim.w / COLS, (dim.h - 70) / ROWS));
    gx = Math.floor((dim.w - COLS * cell) / 2);
    gy = 65;
    board = [];
    for (var r = 0; r < ROWS; r++) {
      board.push([]);
      for (var c = 0; c < COLS; c++) {
        var col;
        do { col = Math.floor(Math.random() * COLORS.length); }
        while ((c >= 2 && board[r][c-1] === col && board[r][c-2] === col) ||
               (r >= 2 && board[r-1][c] === col && board[r-2][c] === col));
        board[r].push(col);
      }
    }
    score = 0; moves = 30; selected = null; over = false;
  }
  function findMatches() {
    var matched = [];
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS - 2; c++) {
        if (board[r][c] >= 0 && board[r][c] === board[r][c+1] && board[r][c] === board[r][c+2]) {
          matched.push([r,c],[r,c+1],[r,c+2]);
        }
      }
    }
    for (var c = 0; c < COLS; c++) {
      for (var r = 0; r < ROWS - 2; r++) {
        if (board[r][c] >= 0 && board[r][c] === board[r+1][c] && board[r][c] === board[r+2][c]) {
          matched.push([r,c],[r+1,c],[r+2,c]);
        }
      }
    }
    return matched;
  }
  function processMatches() {
    var matched = findMatches();
    if (!matched.length) { removing = false; return; }
    removing = true;
    var pts = matched.length * 10;
    score += pts;
    matched.forEach(function(p) { board[p[0]][p[1]] = -1; });
    GameKit.beep(600 + Math.random() * 200, 50, 0.03);
    setTimeout(function () {
      for (var c = 0; c < COLS; c++) {
        var stack = [];
        for (var r = ROWS - 1; r >= 0; r--) {
          if (board[r][c] >= 0) stack.push(board[r][c]);
        }
        for (var r = ROWS - 1; r >= 0; r--) {
          board[r][c] = stack.length ? stack.shift() : Math.floor(Math.random() * COLORS.length);
        }
      }
      setTimeout(processMatches, 200);
    }, 250);
  }
  function draw() {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, dim.w, dim.h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('分数: ' + score, 10, 30);
    ctx.textAlign = 'right';
    ctx.fillText('步数: ' + moves, dim.w - 10, 30);
    ctx.textAlign = 'center';
    ctx.font = '11px sans-serif';
    ctx.fillText('滑动交换相邻方块，三个同色消除', dim.w / 2, 52);
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var x = gx + c * cell, y = gy + r * cell;
        if (board[r][c] >= 0) {
          ctx.fillStyle = COLORS[board[r][c]];
          GameKit.roundRect(ctx, x + 2, y + 2, cell - 4, cell - 4, 6);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.beginPath();
          ctx.arc(x + cell * 0.35, y + cell * 0.35, cell * 0.15, 0, Math.PI * 2);
          ctx.fill();
        }
        if (selected && selected[0] === r && selected[1] === c) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 3;
          GameKit.roundRect(ctx, x + 1, y + 1, cell - 2, cell - 2, 6);
          ctx.stroke();
        }
      }
    }
    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, 0, dim.w, dim.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('游戏结束', dim.w / 2, dim.h / 2 - 20);
      ctx.font = '16px sans-serif';
      ctx.fillText('最终得分: ' + score, dim.w / 2, dim.h / 2 + 15);
      ctx.fillText('点击重新开始', dim.w / 2, dim.h / 2 + 45);
    }
    raf = requestAnimationFrame(draw);
  }
  var sx = 0, sy = 0;
  function onStart(x, y) {
    if (over) { reset(); return; }
    if (removing || swapping) return;
    sx = x; sy = y;
    var r = Math.floor((y - gy) / cell), c = Math.floor((x - gx) / cell);
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) selected = [r, c];
  }
  function onEnd(x, y) {
    if (over || removing || swapping || !selected) return;
    var dx = x - sx, dy = y - sy;
    var r = selected[0], c = selected[1];
    var tr = r, tc = c;
    if (Math.abs(dx) > Math.abs(dy)) { tc += dx > 0 ? 1 : -1; }
    else { tr += dy > 0 ? 1 : -1; }
    if (tr >= 0 && tr < ROWS && tc >= 0 && tc < COLS && (Math.abs(dx) > 15 || Math.abs(dy) > 15)) {
      swapping = true; moves--;
      var tmp = board[r][c]; board[r][c] = board[tr][tc]; board[tr][tc] = tmp;
      if (findMatches().length) {
        GameKit.beep(500, 40, 0.03);
        setTimeout(processMatches, 150);
        setTimeout(function () { swapping = false; if (moves <= 0) over = true; }, 600);
      } else {
        setTimeout(function () {
          var t = board[r][c]; board[r][c] = board[tr][tc]; board[tr][tc] = t;
          swapping = false;
        }, 200);
      }
      if (moves <= 0 && !findMatches().length) over = true;
    }
    selected = null;
  }
  var d = GameKit.fit(canvas);
  dim = { w: d.w, h: d.h }; ctx = d.ctx;
  inp = GameKit.input(canvas, { start: onStart, end: onEnd });
  reset();
  var autoFitHandle = GameKit.autoFit(canvas, function (d) {
    dim = { w: d.w, h: d.h }; ctx = d.ctx;
    cell = Math.floor(Math.min(dim.w / COLS, (dim.h - 70) / ROWS));
    gx = Math.floor((dim.w - COLS * cell) / 2); gy = 65;
  });
  raf = requestAnimationFrame(draw);
  return {
    destroy: function () {
      cancelAnimationFrame(raf); inp.destroy();
      if (autoFitHandle && autoFitHandle.destroy) autoFitHandle.destroy();
    }
  };
}

/* ================= 模板 10：井字棋 ================= */
function GameTicTacToe(container, cfg) {
  var canvas = GameKit.canvasFor(container);
  var dim, ctx, inp, raf;
  var board = [], turn = 'X', winner = null, winLine = null, scores = { X: 0, O: 0, draw: 0 };
  var cell, gx, gy;
  function reset() {
    board = [null,null,null,null,null,null,null,null,null];
    turn = 'X'; winner = null; winLine = null;
    layout();
  }
  function layout() {
    cell = Math.floor(Math.min(dim.w, dim.h - 100) / 3) - 10;
    gx = Math.floor((dim.w - cell * 3) / 2);
    gy = 80;
  }
  function checkWin() {
    var lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (var i = 0; i < lines.length; i++) {
      var a = lines[i][0], b = lines[i][1], c = lines[i][2];
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        winner = board[a]; winLine = lines[i];
        scores[winner]++;
        return;
      }
    }
    if (board.every(function(v){return v;})) { winner = 'draw'; scores.draw++; }
  }
  function aiMove() {
    if (winner) return;
    var empty = [];
    for (var i = 0; i < 9; i++) if (!board[i]) empty.push(i);
    // 简单AI：优先赢，其次堵，否则随机
    for (var i = 0; i < empty.length; i++) {
      board[empty[i]] = 'O';
      if (checkWinTemp()) { board[empty[i]] = null; return empty[i]; }
      board[empty[i]] = null;
    }
    for (var i = 0; i < empty.length; i++) {
      board[empty[i]] = 'X';
      if (checkWinTemp()) { board[empty[i]] = null; return empty[i]; }
      board[empty[i]] = null;
    }
    if (board[4] === null) return 4;
    return empty[Math.floor(Math.random() * empty.length)];
  }
  function checkWinTemp() {
    var lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (var i = 0; i < lines.length; i++) {
      var a = lines[i][0], b = lines[i][1], c = lines[i][2];
      if (board[a] && board[a] === board[b] && board[a] === board[c]) return true;
    }
    return false;
  }
  function draw() {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, dim.w, dim.h);
    // 标题和比分
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('井字棋', dim.w / 2, 35);
    ctx.font = '13px sans-serif';
    ctx.fillText('你(X) ' + scores.X + ' : ' + scores.O + ' 电脑(O)  平:' + scores.draw, dim.w / 2, 58);
    // 棋盘
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 3;
    for (var i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(gx + i * cell, gy); ctx.lineTo(gx + i * cell, gy + 3 * cell); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx, gy + i * cell); ctx.lineTo(gx + 3 * cell, gy + i * cell); ctx.stroke();
    }
    // 棋子
    for (var i = 0; i < 9; i++) {
      var r = Math.floor(i / 3), c = i % 3;
      var x = gx + c * cell + cell / 2, y = gy + r * cell + cell / 2;
      if (board[i] === 'X') {
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 5;
        var s = cell * 0.3;
        ctx.beginPath(); ctx.moveTo(x-s,y-s); ctx.lineTo(x+s,y+s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x+s,y-s); ctx.lineTo(x-s,y+s); ctx.stroke();
      } else if (board[i] === 'O') {
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(x, y, cell * 0.3, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // 获胜线
    if (winLine) {
      var r1 = Math.floor(winLine[0]/3), c1 = winLine[0]%3;
      var r2 = Math.floor(winLine[2]/3), c2 = winLine[2]%3;
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(gx + c1*cell + cell/2, gy + r1*cell + cell/2);
      ctx.lineTo(gx + c2*cell + cell/2, gy + r2*cell + cell/2);
      ctx.stroke();
    }
    // 状态
    ctx.font = '14px sans-serif';
    if (winner === 'draw') ctx.fillText('平局！点击重新开始', dim.w / 2, dim.h - 25);
    else if (winner) ctx.fillText((winner === 'X' ? '你赢了！🎉' : '电脑赢了') + ' 点击重新开始', dim.w / 2, dim.h - 25);
    else ctx.fillText(turn === 'X' ? '你的回合（点击落子）' : '电脑思考中…', dim.w / 2, dim.h - 25);
    raf = requestAnimationFrame(draw);
  }
  function onStart(x, y) {
    if (winner) { reset(); return; }
    if (turn !== 'X') return;
    var c = Math.floor((x - gx) / cell), r = Math.floor((y - gy) / cell);
    if (r < 0 || r >= 3 || c < 0 || c >= 3) return;
    var idx = r * 3 + c;
    if (board[idx]) return;
    board[idx] = 'X';
    GameKit.beep(600, 50, 0.03);
    checkWin();
    if (!winner) {
      turn = 'O';
      setTimeout(function () {
        var move = aiMove();
        if (move !== undefined && !winner) {
          board[move] = 'O';
          GameKit.beep(400, 50, 0.03);
          checkWin();
        }
        turn = 'X';
      }, 400);
    }
  }
  var d = GameKit.fit(canvas);
  dim = { w: d.w, h: d.h }; ctx = d.ctx;
  inp = GameKit.input(canvas, { start: onStart });
  reset();
  var autoFitHandle = GameKit.autoFit(canvas, function (d) {
    dim = { w: d.w, h: d.h }; ctx = d.ctx; layout();
  });
  raf = requestAnimationFrame(draw);
  return {
    destroy: function () {
      cancelAnimationFrame(raf); inp.destroy();
      if (autoFitHandle && autoFitHandle.destroy) autoFitHandle.destroy();
    }
  };
}

/* ================= 模板 11：跳一跳 ================= */
function GameJump(container, cfg) {
  var canvas = GameKit.canvasFor(container);
  var dim, ctx, inp, raf, over = false;
  var player = { x: 0, y: 0, vy: 0, onGround: true, charging: false, power: 0 };
  var platforms = [], score = 0, best = 0, cameraY = 0, particles = [];
  var PLAT_W = 80, PLAT_H = 20, GRAVITY = 0.5, JUMP_POWER = 12;
  function reset() {
    score = 0; over = false; cameraY = 0; particles = [];
    platforms = [];
    var startY = dim.h - 100;
    for (var i = 0; i < 8; i++) {
      platforms.push({ x: Math.random() * (dim.w - PLAT_W), y: startY - i * 120, w: PLAT_W });
    }
    player = { x: platforms[0].x + PLAT_W / 2, y: platforms[0].y - 20, vy: 0, onGround: true, charging: false, power: 0 };
  }
  function spawnPlatform() {
    var top = Math.min.apply(null, platforms.map(function(p){return p.y;}));
    if (top > cameraY - 200) {
      platforms.push({ x: Math.random() * (dim.w - PLAT_W), y: top - 100 - Math.random() * 60, w: PLAT_W });
    }
  }
  function draw() {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, dim.w, dim.h);
    // 平台
    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      var py = p.y - cameraY;
      if (py < -50 || py > dim.h + 50) continue;
      ctx.fillStyle = '#22c55e';
      GameKit.roundRect(ctx, p.x, py, p.w, PLAT_H, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(p.x + 4, py + 3, p.w - 8, 4);
    }
    // 粒子
    for (var i = particles.length - 1; i >= 0; i--) {
      var pt = particles[i];
      pt.x += pt.vx; pt.y += pt.vy - cameraY + (cameraY - (pt.camY || 0));
      pt.life--;
      ctx.fillStyle = pt.color;
      ctx.globalAlpha = pt.life / 20;
      ctx.fillRect(pt.x, pt.y, 4, 4);
      ctx.globalAlpha = 1;
      if (pt.life <= 0) particles.splice(i, 1);
    }
    // 玩家
    var px = player.x, py2 = player.y - cameraY;
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(px, py2, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(px - 4, py2 - 3, 2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 4, py2 - 3, 2, 0, Math.PI*2); ctx.fill();
    // 蓄力条
    if (player.charging) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(px - 30, py2 - 35, 60, 6);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(px - 30, py2 - 35, 60 * (player.power / 60), 6);
    }
    // HUD
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('分数: ' + score, 10, 30);
    ctx.textAlign = 'right';
    ctx.fillText('最高: ' + best, dim.w - 10, 30);
    ctx.textAlign = 'center';
    ctx.font = '11px sans-serif';
    ctx.fillText('按住蓄力，松开跳跃', dim.w / 2, 52);
    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, 0, dim.w, dim.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('游戏结束', dim.w / 2, dim.h / 2 - 30);
      ctx.font = '16px sans-serif';
      ctx.fillText('得分: ' + score, dim.w / 2, dim.h / 2);
      ctx.fillText('点击重新开始', dim.w / 2, dim.h / 2 + 35);
    }
    raf = requestAnimationFrame(draw);
  }
  function update() {
    if (over) return;
    if (player.charging && player.power < 60) player.power++;
    if (!player.onGround) {
      player.vy += GRAVITY;
      player.y += player.vy;
      // 平台碰撞
      for (var i = 0; i < platforms.length; i++) {
        var p = platforms[i];
        if (player.vy > 0 && player.x > p.x && player.x < p.x + p.w &&
            player.y > p.y - 14 && player.y < p.y + 10) {
          player.y = p.y - 14;
          player.vy = 0;
          player.onGround = true;
          var newScore = Math.floor((dim.h - 100 - p.y + cameraY) / 120);
          if (newScore > score) {
            score = newScore;
            if (score > best) best = score;
            for (var j = 0; j < 8; j++) {
              particles.push({ x: player.x, y: player.y, vx: (Math.random()-0.5)*4, vy: Math.random()*-3, life: 20, color: '#fbbf24', camY: cameraY });
            }
            GameKit.beep(700, 50, 0.03);
          }
        }
      }
      // 掉落
      if (player.y - cameraY > dim.h + 50) { over = true; GameKit.beep(200, 200, 0.05); }
    }
    // 相机跟随
    var targetCam = player.y - dim.h * 0.6;
    if (targetCam < cameraY) cameraY += (targetCam - cameraY) * 0.1;
    spawnPlatform();
    // 清理远离的平台
    platforms = platforms.filter(function(p){ return p.y - cameraY < dim.h + 100; });
  }
  function loop() { update(); draw(); raf = requestAnimationFrame(loop); }
  function onStart(x, y) {
    if (over) { reset(); return; }
    if (player.onGround) { player.charging = true; player.power = 0; }
  }
  function onEnd(x, y) {
    if (over || !player.charging) return;
    player.charging = false;
    if (player.onGround) {
      var dir = x > player.x ? 1 : -1;
      player.vy = -(JUMP_POWER + player.power * 0.15);
      player.x += dir * player.power * 0.8;
      player.onGround = false;
      GameKit.beep(500 + player.power * 5, 60, 0.03);
    }
    player.power = 0;
  }
  var d = GameKit.fit(canvas);
  dim = { w: d.w, h: d.h }; ctx = d.ctx;
  inp = GameKit.input(canvas, { start: onStart, end: onEnd });
  reset();
  var autoFitHandle = GameKit.autoFit(canvas, function (d) {
    dim = { w: d.w, h: d.h }; ctx = d.ctx;
  });
  raf = requestAnimationFrame(loop);
  return {
    destroy: function () {
      cancelAnimationFrame(raf); inp.destroy();
      if (autoFitHandle && autoFitHandle.destroy) autoFitHandle.destroy();
    }
  };
}

/* ================= 模板 12：五子棋 ================= */
function GameGomoku(container, cfg) {
  var canvas = GameKit.canvasFor(container);
  var dim, ctx, inp, raf;
  var SIZE = 15, board = [], turn = 'black', winner = null, lastMove = null, cell, gx, gy;
  function reset() {
    board = [];
    for (var r = 0; r < SIZE; r++) board.push(new Array(SIZE).fill(null));
    turn = 'black'; winner = null; lastMove = null;
    layout();
  }
  function layout() {
    cell = Math.floor(Math.min(dim.w, dim.h - 80) / (SIZE - 1)) - 4;
    gx = Math.floor((dim.w - cell * (SIZE - 1)) / 2);
    gy = 70;
  }
  function checkWin(r, c, color) {
    var dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (var d = 0; d < 4; d++) {
      var count = 1;
      for (var s = 1; s < 5; s++) {
        var nr = r + dirs[d][0]*s, nc = c + dirs[d][1]*s;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== color) break;
        count++;
      }
      for (var s = 1; s < 5; s++) {
        var nr = r - dirs[d][0]*s, nc = c - dirs[d][1]*s;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== color) break;
        count++;
      }
      if (count >= 5) return true;
    }
    return false;
  }
  function aiMove() {
    if (winner) return;
    // 简单AI：评分每个空位
    var bestScore = -1, bestMove = null;
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (board[r][c]) continue;
        var sc = scorePos(r, c, 'white') + scorePos(r, c, 'black') * 0.8;
        if (sc > bestScore) { bestScore = sc; bestMove = [r, c]; }
      }
    }
    if (bestMove) {
      board[bestMove[0]][bestMove[1]] = 'white';
      lastMove = bestMove;
      GameKit.beep(400, 50, 0.03);
      if (checkWin(bestMove[0], bestMove[1], 'white')) winner = 'white';
      turn = 'black';
    }
  }
  function scorePos(r, c, color) {
    var dirs = [[0,1],[1,0],[1,1],[1,-1]];
    var total = 0;
    for (var d = 0; d < 4; d++) {
      var count = 1, blocked = 0;
      for (var s = 1; s < 5; s++) {
        var nr = r + dirs[d][0]*s, nc = c + dirs[d][1]*s;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) { blocked++; break; }
        if (board[nr][nc] === color) count++;
        else if (board[nr][nc]) { blocked++; break; }
        else break;
      }
      for (var s = 1; s < 5; s++) {
        var nr = r - dirs[d][0]*s, nc = c - dirs[d][1]*s;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) { blocked++; break; }
        if (board[nr][nc] === color) count++;
        else if (board[nr][nc]) { blocked++; break; }
        else break;
      }
      if (count >= 5) total += 100000;
      else if (count === 4 && blocked === 0) total += 10000;
      else if (count === 4) total += 1000;
      else if (count === 3 && blocked === 0) total += 500;
      else if (count === 3) total += 100;
      else total += count * 10;
    }
    return total;
  }
  function draw() {
    ctx.fillStyle = '#d4a574';
    ctx.fillRect(0, 0, dim.w, dim.h);
    // 棋盘线
    ctx.strokeStyle = '#5c3d2e';
    ctx.lineWidth = 1;
    for (var i = 0; i < SIZE; i++) {
      ctx.beginPath(); ctx.moveTo(gx, gy + i * cell); ctx.lineTo(gx + (SIZE-1) * cell, gy + i * cell); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx + i * cell, gy); ctx.lineTo(gx + i * cell, gy + (SIZE-1) * cell); ctx.stroke();
    }
    // 星位
    ctx.fillStyle = '#5c3d2e';
    [[3,3],[3,11],[11,3],[11,11],[7,7]].forEach(function(p) {
      ctx.beginPath(); ctx.arc(gx + p[1]*cell, gy + p[0]*cell, 4, 0, Math.PI*2); ctx.fill();
    });
    // 棋子
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (!board[r][c]) continue;
        var x = gx + c * cell, y = gy + r * cell;
        ctx.fillStyle = board[r][c] === 'black' ? '#1a1a1a' : '#f5f5f5';
        ctx.beginPath(); ctx.arc(x, y, cell * 0.42, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = board[r][c] === 'black' ? '#000' : '#ccc';
        ctx.lineWidth = 1; ctx.stroke();
        if (lastMove && lastMove[0] === r && lastMove[1] === c) {
          ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, cell * 0.2, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
    // HUD
    ctx.fillStyle = '#5c3d2e';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    if (winner) ctx.fillText((winner === 'black' ? '你赢了！🎉' : '电脑赢了') + ' 点击重新开始', dim.w / 2, dim.h - 20);
    else ctx.fillText(turn === 'black' ? '你的回合（黑子）' : '电脑思考中…', dim.w / 2, dim.h - 20);
    ctx.font = '12px sans-serif';
    ctx.fillText('五子棋', dim.w / 2, 30);
    raf = requestAnimationFrame(draw);
  }
  function onStart(x, y) {
    if (winner) { reset(); return; }
    if (turn !== 'black') return;
    var c = Math.round((x - gx) / cell), r = Math.round((y - gy) / cell);
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return;
    if (board[r][c]) return;
    board[r][c] = 'black';
    lastMove = [r, c];
    GameKit.beep(600, 50, 0.03);
    if (checkWin(r, c, 'black')) { winner = 'black'; return; }
    turn = 'white';
    setTimeout(aiMove, 300);
  }
  var d = GameKit.fit(canvas);
  dim = { w: d.w, h: d.h }; ctx = d.ctx;
  inp = GameKit.input(canvas, { start: onStart });
  reset();
  var autoFitHandle = GameKit.autoFit(canvas, function (d) {
    dim = { w: d.w, h: d.h }; ctx = d.ctx; layout();
  });
  raf = requestAnimationFrame(draw);
  return {
    destroy: function () {
      cancelAnimationFrame(raf); inp.destroy();
      if (autoFitHandle && autoFitHandle.destroy) autoFitHandle.destroy();
    }
  };
}

/* ================= 模板注册表 ================= */
var GAME_TEMPLATES = {
  snake: { name: '贪吃蛇', ico: '🐍', desc: '滑动屏幕控制方向，吃到食物变长，撞墙或撞自己结束', create: GameSnake },
  breakout: { name: '打砖块', ico: '🧱', desc: '手指拖动挡板接住小球，打掉所有砖块通关', create: GameBreakout },
  flappy: { name: '弹跳小鸟', ico: '🐤', desc: '点击屏幕让小鸟跳跃，穿过管道缝隙', create: GameFlappy },
  shooter: { name: '飞机射击', ico: '✈️', desc: '手指移动飞机自动射击，击落敌机得分', create: GameShooter },
  '2048': { name: '2048', ico: '🎯', desc: '滑动屏幕合并相同数字，合成 2048', create: Game2048 },
  whack: { name: '打地鼠', ico: '🔨', desc: '点击冒出来的地鼠，30 秒内得高分', create: GameWhack },
  tetris: { name: '俄罗斯方块', ico: '🧩', desc: '点击旋转，左右滑动移动，下滑加速，消行得分', create: GameTetris },
  memory: { name: '记忆翻牌', ico: '🃏', desc: '点击翻牌配对，用最少步数找出所有相同图案', create: GameMemory },
  match3: { name: '消消乐', ico: '💎', desc: '滑动交换相邻方块，三个同色消除，30步内得高分', create: GameMatch3 },
  tictactoe: { name: '井字棋', ico: '⭕', desc: '与电脑对战，三子连线获胜', create: GameTicTacToe },
  jump: { name: '跳一跳', ico: '🦘', desc: '按住蓄力，松开跳跃，跳上更高的平台', create: GameJump },
  gomoku: { name: '五子棋', ico: '⚫', desc: '与电脑对战，五子连珠获胜', create: GameGomoku }
};
