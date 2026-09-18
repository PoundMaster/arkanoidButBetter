/* ============================================================
   НЕОН·АРКАНОИД — игровой движок
   Физика шара, криты, платформа, этапы, очки и рекорд.
   ============================================================ */
(function (root) {
  'use strict';
  const { CFG, STAGES, BLOCK_COLORS, LAYOUT_INFO,
          randInt, randFloat, clamp, lerp, loadRecord, saveRecord } = root;

  const W = CFG.CANVAS_W, H = CFG.CANVAS_H, R = CFG.BALL_R;
  const TAU = Math.PI * 2;

  let canvas = null, ctx = null;

  /* --- состояние --- */
  let state = 'menu';            // menu | playing | paused | levelComplete | gameOver | victory
  let stageNum = 1, layoutId = 1, lastLayoutId = null;
  let score = 0, record = 0, lives = 0;
  let runStartRecord = 0, newRecordShown = false;
  let levelStartScore = 0, levelTotal = 0;

  let blocks = [];
  const paddle = { x: 0, y: 0, w: 0, h: 0, glowT: 0 };
  const ball = {
    x: 0, y: 0, vx: 0, vy: 0, speed: 0, docked: true,
    // параметры отскока платформы, обновляются на каждую попытку:
    centerA: 0,   // угол отскока от центра (±5–10°)
    gradP: 1      // форма градиента «смещение → угол»
  };
  const trail = [], particles = [], floaters = [];

  let shakeT = 0;
  let autopilot = false;
  let controlMode = 'mouse';      // 'mouse' | 'keys' — переключается ЛКМ
  let mouseX = null;
  const keys = { left: false, right: false };
  let lastFrame = 0;

  /* ======================= Уровни ======================= */

  function buildBlocks(grid) {
    const arr = [];
    for (let y = 0; y < CFG.ROWS; y++) {
      for (let x = 0; x < CFG.COLS; x++) {
        const hp = grid[y][x];
        if (hp > 0) {
          arr.push({
            hp, alive: true, flash: 0,
            x: CFG.FIELD_PAD_X + x * (CFG.BLOCK_W + CFG.GAP_X),
            y: CFG.FIELD_TOP + y * (CFG.BLOCK_H + CFG.GAP_Y),
            w: CFG.BLOCK_W, h: CFG.BLOCK_H
          });
        }
      }
    }
    return arr;
  }

  function loadLevel(forcedLayout) {
    root.UI && root.UI.hideOverlay();
    layoutId = (forcedLayout == null)
      ? root.Layouts.pick(stageNum, lastLayoutId)
      : forcedLayout;
    lastLayoutId = layoutId;

    const res = root.Layouts.generate(stageNum, layoutId);
    blocks = buildBlocks(res.grid);
    levelTotal = res.total;
    levelStartScore = score;

    paddle.w = CFG.PADDLE_W; paddle.h = CFG.PADDLE_H; paddle.y = CFG.PADDLE_Y;
    paddle.x = (W - paddle.w) / 2;
    dockBall();
    state = 'playing';

    const st = STAGES[stageNum];
    root.UI && root.UI.banner(
      `ЭТАП ${stageNum}/5 — ${LAYOUT_INFO[layoutId].name.toUpperCase()}`,
      layoutId === 0 ? 'все блоки ×10 · 450 очков' : `цель: ${st.target} ± ${st.tol} очков`,
      layoutId === 0
    );
    syncUI();
  }

  function startRun(stage, forcedLayout) {
    score = 0; lives = CFG.LIVES;
    stageNum = stage || 1;
    lastLayoutId = null;
    runStartRecord = record; newRecordShown = false;
    particles.length = 0; floaters.length = 0;
    root.UI && root.UI.hideOverlay();
    loadLevel(forcedLayout);
  }

  function nextLevel() {
    stageNum++;
    loadLevel();
  }

  /* ======================= Механика ======================= */

  function launch() {
    if (!ball.docked) return;
    /* каждый запуск: новая случайная скорость и направление */
    const s = CFG.BASE_SPEED * Math.pow(1 + CFG.SPEED_PER_STAGE, stageNum - 1) * randFloat(0.88, 1.15);
    const a = randFloat(-1, 1) * CFG.LAUNCH_MAX_ANGLE;
    ball.speed = s;
    ball.vx = s * Math.sin(a);
    ball.vy = -s * Math.cos(a);
    ball.docked = false;
    /* и новая карта отскока платформы: угол в самом центре 5–10°
       (случайный знак) плюс меняющаяся форма градиента к краям */
    ball.centerA = randFloat(CFG.CENTER_BOUNCE_MIN, CFG.CENTER_BOUNCE_MAX) *
                   (Math.random() < 0.5 ? -1 : 1);
    ball.gradP = randFloat(CFG.GRADIENT_P_MIN, CFG.GRADIENT_P_MAX);
    trail.length = 0;
  }

  function tryLaunch() {
    if (state === 'playing' && ball.docked) launch();
  }

  function dockBall() {
    ball.docked = true;
    ball.vx = 0; ball.vy = 0;
    ball.centerA = randFloat(CFG.CENTER_BOUNCE_MIN, CFG.CENTER_BOUNCE_MAX) *
                   (Math.random() < 0.5 ? -1 : 1);
    ball.gradP = randFloat(CFG.GRADIENT_P_MIN, CFG.GRADIENT_P_MAX);
    trail.length = 0;
    ball.x = paddle.x + paddle.w / 2;
    ball.y = paddle.y - R - 2;
  }

  function loseBall() {
    lives--;
    syncUI();
    if (lives <= 0) {
      state = 'gameOver';
      root.UI && root.UI.showOverlay('gameOver');
    } else {
      dockBall();
    }
  }

  function addScore(n) {
    score += n;
    if (score > record) {
      record = score;
      saveRecord(record);
      if (!newRecordShown && runStartRecord > 0 && score > runStartRecord) {
        newRecordShown = true;
        floaters.push({ x: W / 2, y: H * 0.42, text: 'НОВЫЙ РЕКОРД!', t: 0, life: 1.5, color: '#7dff5a' });
      }
    }
    syncUI();
  }

  function hitBlock(b) {
    const crit = Math.random() < CFG.CRIT_CHANCE;
    const colStr = BLOCK_COLORS[Math.max(1, Math.min(10, b.hp))] || BLOCK_COLORS[1];
    if (crit) {
      /* крит уничтожает любой блок с одного раза и даёт все его очки */
      const pts = b.hp;
      b.hp = 0;
      kill(b, colStr, true);
      addScore(pts);
      floaters.push({ x: b.x + b.w / 2, y: b.y + 4, text: 'КРИТ! +' + pts, t: 0, life: 1.0, color: '#ffd24d' });
      shakeT = 0.22;
    } else {
      b.hp -= 1;
      addScore(1);
      if (b.hp <= 0) kill(b, colStr, false);
      else b.flash = 1;
    }
    if (!blocks.some(q => q.alive)) levelComplete();
  }

  function kill(b, colStr, crit) {
    b.alive = false;
    const n = crit ? 16 : 10;
    for (let i = 0; i < n; i++) {
      particles.push({
        x: b.x + b.w / 2, y: b.y + b.h / 2,
        vx: randFloat(-170, 170), vy: randFloat(-230, 80),
        t: 0, life: randFloat(0.35, 0.75),
        size: randFloat(1.8, 4.2), color: colStr
      });
    }
  }

  function levelComplete() {
    if (stageNum >= 5) {
      state = 'victory';
      root.UI && root.UI.showOverlay('victory');
    } else {
      state = 'levelComplete';
      root.UI && root.UI.showOverlay('levelComplete');
    }
  }

  /* ======================= Пауза и управление ======================= */

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      root.UI && root.UI.showOverlay('pause');
    } else if (state === 'paused') {
      state = 'playing';
      root.UI && root.UI.hideOverlay();
    }
    syncUI();
  }

  function toggleControlMode() {
    controlMode = (controlMode === 'mouse') ? 'keys' : 'mouse';
    if (canvas) canvas.classList.toggle('keys-mode', controlMode === 'keys');
    syncUI();
  }

  /* ======================= Физика ======================= */

  function step(dt) {
    /* платформа */
    const pcx = paddle.x + paddle.w / 2;
    if (autopilot) {
      const target = ball.docked ? pcx : ball.x;
      const dx = target - pcx;
      const maxStep = CFG.AUTO_SPEED * dt;
      paddle.x += clamp(dx, -maxStep, maxStep);
    } else if (controlMode === 'keys') {
      if (keys.left !== keys.right) {
        const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        paddle.x += dir * CFG.KEY_SPEED * dt;
      }
    } else if (mouseX != null) {
      paddle.x += (mouseX - pcx) * Math.min(1, dt * 26);
    }
    paddle.x = clamp(paddle.x, 6, W - 6 - paddle.w);

    /* мяч на платформе — ждём Enter */
    if (ball.docked) {
      ball.x = paddle.x + paddle.w / 2;
      ball.y = paddle.y - R - 2;
      return;
    }

    /* движение */
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    /* стены */
    if (ball.x < R) { ball.x = R; ball.vx = Math.abs(ball.vx); }
    if (ball.x > W - R) { ball.x = W - R; ball.vx = -Math.abs(ball.vx); }
    if (ball.y < R) { ball.y = R; ball.vy = Math.abs(ball.vy); }

    /* платформа: центр — 5–10° (свой на попытку), край — до 50° */
    if (ball.vy > 0) {
      const cx = paddle.x + paddle.w / 2;
      if (ball.y + R >= paddle.y && ball.y - R <= paddle.y + paddle.h &&
          ball.x >= paddle.x - R && ball.x <= paddle.x + paddle.w + R) {
        const off = clamp((ball.x - cx) / (paddle.w / 2), -1, 1);
        const ao = Math.pow(Math.abs(off), ball.gradP);
        const a = ball.centerA * (1 - ao) + Math.sign(off) * ao * CFG.PADDLE_MAX_ANGLE;
        ball.vx = ball.speed * Math.sin(a);
        ball.vy = -ball.speed * Math.cos(a);
        ball.y = paddle.y - R - 0.5;
        paddle.glowT = 1;
      }
    }

    collideBlocks();

    /* потеря шара */
    if (ball.y - R > H + 40) loseBall();
  }

  function collideBlocks() {
    let best = null, bestPen = -1, bdx = 0, bdy = 0;
    for (const b of blocks) {
      if (!b.alive) continue;
      const cx = clamp(ball.x, b.x, b.x + b.w);
      const cy = clamp(ball.y, b.y, b.y + b.h);
      const dx = ball.x - cx, dy = ball.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= R * R) {
        const pen = R - Math.sqrt(d2);
        if (pen > bestPen) { bestPen = pen; best = b; bdx = dx; bdy = dy; }
      }
    }
    if (!best) return;

    if (bdx === 0 && bdy === 0) {
      ball.vy = -ball.vy;
      ball.y = best.y - R - 0.5;
    } else if (Math.abs(bdx) >= Math.abs(bdy)) {
      const s = Math.sign(bdx);
      ball.vx = s * Math.max(Math.abs(ball.vx), 1);
      ball.x += s * (R - Math.abs(bdx) + 0.5);
    } else {
      const s = Math.sign(bdy);
      ball.vy = s * Math.max(Math.abs(ball.vy), 1);
      ball.y += s * (R - Math.abs(bdy) + 0.5);
    }
    hitBlock(best);
  }

  /* ======================= Эффекты ======================= */

  function updateFx(dt) {
    for (const b of blocks) if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 5);
    if (paddle.glowT > 0) paddle.glowT = Math.max(0, paddle.glowT - dt * 3);
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t >= p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * dt;
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t += dt;
      if (f.t >= f.life) floaters.splice(i, 1);
    }
    if (!ball.docked && state === 'playing') {
      trail.push({ x: ball.x, y: ball.y });
      if (trail.length > 14) trail.shift();
    }
  }

  /* ======================= Отрисовка ======================= */

  function neon(t, ph) {
    ph = ph || 0;
    const k = 0.5 + 0.5 * Math.sin(t * 2.2 + ph);
    return [Math.round(lerp(0, 125, k)), Math.round(lerp(229, 255, k)), Math.round(lerp(255, 90, k))];
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawField(t) {
    const c = neon(t, 3.5);
    ctx.save();
    ctx.strokeStyle = rgba(c, 0.14);
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 3, W - 6, H - 6);
    ctx.strokeStyle = rgba(c, 0.5);
    ctx.lineWidth = 3;
    const corner = (x, y, hx, hy) => {
      ctx.beginPath();
      ctx.moveTo(x + hx * 26, y); ctx.lineTo(x, y); ctx.lineTo(x, y + hy * 26);
      ctx.stroke();
    };
    corner(5, 5, 1, 1); corner(W - 5, 5, -1, 1);
    corner(5, H - 5, 1, -1); corner(W - 5, H - 5, -1, -1);
    ctx.restore();
  }

  function drawBlocks() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 13px Arial, sans-serif';
    for (const b of blocks) {
      if (!b.alive) continue;
      const col = BLOCK_COLORS[b.hp] || BLOCK_COLORS[1];
      const light = b.hp <= 5; // 1–5: чёрная обводка/цифра; 6–10: белая
      rr(b.x, b.y, b.w, b.h, 5);
      ctx.fillStyle = `rgb(${col})`;
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(b.x + 3, b.y + 2.5, b.w - 6, 3.5);
      ctx.lineWidth = 2;
      ctx.strokeStyle = light ? 'rgba(0,0,0,.92)' : 'rgba(255,255,255,.95)';
      rr(b.x, b.y, b.w, b.h, 5);
      ctx.stroke();
      ctx.fillStyle = light ? '#000' : '#fff';
      ctx.fillText(String(b.hp), b.x + b.w / 2, b.y + b.h / 2 + 1);
      if (b.flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${(b.flash * 0.65).toFixed(3)})`;
        rr(b.x, b.y, b.w, b.h, 5);
        ctx.fill();
      }
    }
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      const a = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = `rgba(${p.color},${(a * 0.85).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * a), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPaddle(t) {
    const p = paddle;
    const c1 = neon(t), c2 = neon(t, 1.9);
    ctx.save();
    ctx.shadowColor = rgba(c1, 0.85);
    ctx.shadowBlur = 16 + p.glowT * 14;
    rr(p.x, p.y, p.w, p.h, 8);
    ctx.fillStyle = '#0a1421';
    ctx.fill();
    const g = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
    g.addColorStop(0, rgba(c1, 0.95));
    g.addColorStop(0.5, 'rgba(235,255,250,.95)');
    g.addColorStop(1, rgba(c2, 0.95));
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = g;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.save();
    rr(p.x, p.y, p.w, p.h, 8);
    ctx.clip();
    const sx = p.x + ((t * 110) % (p.w + 80)) - 40;
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(sx, p.y + 2, 16, p.h - 4);
    ctx.restore();
    ctx.restore();
  }

  function drawBall(t) {
    const c = neon(t, 0.7);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i], f = (i + 1) / trail.length;
      ctx.fillStyle = rgba(c, f * 0.16);
      ctx.beginPath();
      ctx.arc(p.x, p.y, R * f * 0.85, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.shadowColor = rgba(c, 1);
    ctx.shadowBlur = 18;
    const rg = ctx.createRadialGradient(ball.x, ball.y, 1, ball.x, ball.y, R);
    rg.addColorStop(0, '#ffffff');
    rg.addColorStop(0.5, 'rgba(223,255,255,.95)');
    rg.addColorStop(1, rgba(c, 0.55));
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, R, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawFloaters() {
    if (!floaters.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 15px Orbitron, Arial, sans-serif';
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, 1 - f.t / f.life);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - f.t * 46);
    }
    ctx.restore();
  }

  function drawHint(t) {
    if (state !== 'playing' || !ball.docked) return;
    const a = 0.5 + 0.5 * Math.sin(t * 4.5);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.35 + 0.5 * a;
    ctx.fillStyle = '#bfeaff';
    ctx.font = '600 13px Rubik, Arial, sans-serif';
    ctx.fillText('Enter — запуск шара · Esc — пауза', W / 2, paddle.y - 30);
    ctx.restore();
  }

  function render(t) {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shakeT > 0) {
      const k = (shakeT / 0.22) * 5;
      ctx.translate(randFloat(-k, k), randFloat(-k, k));
    }
    drawField(t);
    drawBlocks();
    drawParticles();
    drawPaddle(t);
    drawBall(t);
    drawFloaters();
    drawHint(t);
    ctx.restore();
  }

  /* ======================= Цикл ======================= */

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (state === 'playing') {
      const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
      const sdt = dt / sub;
      for (let i = 0; i < sub; i++) {
        step(sdt);
        if (state !== 'playing') break;
      }
      updateFx(dt);
    }
    render(now / 1000);
    requestAnimationFrame(frame);
  }

  /* ======================= Ввод ======================= */

  function onKey(e) {
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) toggleAutopilot();
      return;
    }
    if (e.code === 'Escape') {
      if (!e.repeat) togglePause();
      return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keys.left = true; e.preventDefault(); }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { keys.right = true; e.preventDefault(); }
    if (e.code === 'Enter' && !e.repeat) {
      if (state === 'playing') tryLaunch();
      else root.UI && root.UI.clickPrimary();
    }
  }

  function onKeyUp(e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
  }

  function onPointer(e) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (r.width > 0) mouseX = ((e.clientX - r.left) / r.width) * W;
  }

  function toggleAutopilot() {
    autopilot = !autopilot;
    syncUI();
  }

  /* ======================= Инициализация ======================= */

  function init(cv) {
    canvas = cv;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    record = loadRecord();

    paddle.w = CFG.PADDLE_W; paddle.h = CFG.PADDLE_H; paddle.y = CFG.PADDLE_Y;
    paddle.x = (W - paddle.w) / 2;
    dockBall();

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointermove', onPointer);
    /* ЛКМ по полю — переключение управления: мышь ↔ стрелки */
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) toggleControlMode();
    });

    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  /* Отладочный запуск: fresh-забег сразу с нужного этапа и расстановки */
  function debugStart(s, l) {
    startRun(s, l);
    const st = STAGES[s];
    const dev = l === 0 ? '—' :
      (levelTotal >= st.target ? '+' : '') +
      (((levelTotal - st.target) / st.target) * 100).toFixed(1) + '%';
    return {
      'этап': s,
      'расстановка': `${LAYOUT_INFO[l].name} (id ${l})`,
      'блоков': blocks.length,
      'очки уровня': levelTotal,
      'цель этапа': l === 0 ? '450 (rigged)' : `${st.target} ± ${st.tol}`,
      'отклонение': dev
    };
  }

  function syncUI() { root.UI && root.UI.sync(); }

  /* ======================= Экспорт ======================= */

  root.Game = {
    init, startRun, nextLevel, tryLaunch, toggleAutopilot, togglePause,
    toggleControlMode, debugStart,
    get state() { return state; },
    get score() { return score; },
    get record() { return record; },
    get lives() { return lives; },
    get stageNum() { return stageNum; },
    get layoutName() { return LAYOUT_INFO[layoutId] ? LAYOUT_INFO[layoutId].name : '—'; },
    get autopilot() { return autopilot; },
    get controlMode() { return controlMode; },
    get paddleX() { return paddle.x; },          // отладка: позиция платформы
    get ballDocked() { return ball.docked; },    // отладка: шар на платформе?
    get levelPoints() { return score - levelStartScore; },
    get runStartRecord() { return runStartRecord; },
    get levelTargetText() {
      const st = STAGES[stageNum];
      return layoutId === 0 ? '450 (rigged)' : `${st.target} ± ${st.tol}`;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
