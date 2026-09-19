/* ============================================================
   НЕОН·АРКАНОИД — игровой движок
   Физика шара, криты, платформа, этапы, очки, рекорд —
   и усиления: защитный слой, шальной шар, шар-разделитель,
   пухлая платформа, атака аллигаторов, босс шаров, шаровая
   бомба, супер слон, удар ударов, glob.dtr, buff.gv.
   ============================================================ */
(function (root) {
  'use strict';
  const { CFG, STAGES, BLOCK_COLORS, LAYOUT_INFO,
          randFloat, clamp, lerp, loadRecord, saveRecord } = root;
  const Powers = root.Powers;

  const W = CFG.CANVAS_W, H = CFG.CANVAS_H, R = CFG.BALL_R;
  const TAU = Math.PI * 2;
  const CELL_W = CFG.BLOCK_W + CFG.GAP_X;   // шаг сетки по горизонтали («блок»)
  const CELL_H = CFG.BLOCK_H + CFG.GAP_Y;   // шаг сетки по вертикали

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
    autoLaunch: false, autoT: 0,   // авто-запуск через 3 с после восстановления усилением
    centerA: 0, gradP: 1           // карта отскока платформы (обновляется на попытку)
  };
  const trail = [], particles = [], floaters = [];

  /* --- активные эффекты усилений --- */
  const fx = {
    shield: null,                 // { stages } — защитный слой снизу
    shieldY: H - 24,
    wide: 0,                      // оставшиеся этапы «пухлой платформы»
    superT: 0,                    // секунды супер-слона (100% крит)
    erase: null,                  // { t, next, tick } — glob.dtr
    ballScene: null,              // сценка с шаром: rogue | split | boss | bomb
    restore: null,                // { t, delay } — шар уничтожен, ждёт восстановления
    smalls: [],                   // мелкие шары разделителя
    gators: null,                 // крокодилы
    fist: null,                   // кулак
    bossBall: null,               // жирный шар босса
    rings: [],                    // ударные волны взрывов
    cine: false                   // идёт непаузируемая сценка
  };

  /* тряска экрана: амплитуда + длительность */
  let shakeT = 0, shakeDur = 0.22, shakeAmp = 5;
  function shake(amp, dur) { shakeAmp = amp; shakeDur = dur; shakeT = dur; }

  let autopilot = false;
  let controlMode = 'mouse';      // 'mouse' | 'keys' — переключается ЛКМ
  let mouseX = null;
  const keys = { left: false, right: false };
  let lastFrame = 0;
  let lastChipT = 0, lastChipTxt = '\u0000';

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

  function applyPaddleWidth() {
    const nw = fx.wide > 0 ? CFG.PADDLE_W * 2 : CFG.PADDLE_W;
    const c = paddle.x + paddle.w / 2;
    paddle.w = nw;
    paddle.x = clamp(c - nw / 2, 6, W - 6 - nw);
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

    /* новый уровень: сценки и разлёты сбрасываются,
       щит / пухлая платформа / супер слон живут дальше */
    fx.ballScene = null; fx.restore = null;
    fx.gators = null; fx.fist = null; fx.bossBall = null;
    fx.smalls.length = 0;
    fx.cine = false;
    fx.erase = null;

    paddle.w = CFG.PADDLE_W; paddle.h = CFG.PADDLE_H; paddle.y = CFG.PADDLE_Y;
    paddle.x = (W - paddle.w) / 2;
    applyPaddleWidth();
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
    ball.autoLaunch = false;
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

  function dockBall(auto) {
    ball.docked = true;
    ball.vx = 0; ball.vy = 0;
    ball.autoLaunch = !!auto; ball.autoT = 0;
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
    const sup = fx.superT > 0;                       // супер слон: 100% крит
    const crit = Math.random() < (sup ? 1 : CFG.CRIT_CHANCE);
    const colStr = BLOCK_COLORS[clamp(b.hp, 1, 10)] || BLOCK_COLORS[1];
    if (crit) {
      /* крит уничтожает любой блок с одного раза и даёт все его очки */
      const pts = b.hp;
      b.hp = 0;
      kill(b, colStr, true);
      addScore(pts);
      floaters.push({ x: b.x + b.w / 2, y: b.y + 4, text: 'КРИТ! +' + pts, t: 0, life: 1.0, color: sup ? '#ff5c7a' : '#ffd24d' });
      shake(sup ? 9 : 5, sup ? 0.4 : 0.22);          // слон трясёт сильнее
    } else {
      b.hp -= 1;
      addScore(1);
      if (b.hp <= 0) kill(b, colStr, false);
      else b.flash = 1;
    }
    checkLevelDone();
  }

  /* урон от усилений (без критов): очки = снятая прочность */
  function damageBlock(b, n) {
    if (!b.alive || n <= 0) return;
    const colStr = BLOCK_COLORS[clamp(b.hp, 1, 10)] || BLOCK_COLORS[1];
    const actual = Math.min(n, b.hp);
    b.hp -= n;
    b.flash = 1;
    addScore(actual);
    if (b.hp <= 0) kill(b, colStr, false);
  }

  function checkLevelDone() {
    if (state === 'playing' && !blocks.some(q => q.alive)) levelComplete();
  }

  /* расстояние между точками в «блоках» (эллиптическая метрика сетки) */
  function cellDist(x1, y1, x2, y2) {
    const dx = (x1 - x2) / CELL_W, dy = (y1 - y2) / CELL_H;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* площадный урон: dmgFn(дистанция в блоках) → урон */
  function areaDamage(cx, cy, dmgFn) {
    for (const b of blocks) {
      if (!b.alive) continue;
      const d = cellDist(cx, cy, b.x + b.w / 2, b.y + b.h / 2);
      const dmg = dmgFn(d);
      if (dmg > 0) damageBlock(b, dmg);
    }
    checkLevelDone();
  }

  function kill(b, colStr, crit) {
    b.alive = false;
    const n = crit ? 16 : 10;
    const room = Math.max(0, 380 - particles.length);
    const cnt = Math.min(n, room);
    for (let i = 0; i < cnt; i++) {
      particles.push({
        x: b.x + b.w / 2, y: b.y + b.h / 2,
        vx: randFloat(-170, 170), vy: randFloat(-230, 80),
        t: 0, life: randFloat(0.35, 0.75),
        size: randFloat(1.8, 4.2), color: colStr
      });
    }
  }

  function levelComplete() {
    if (state !== 'playing') return;
    /* усиления, живущие «этапами», тикают здесь */
    if (fx.shield) { fx.shield.stages--; if (fx.shield.stages <= 0) fx.shield = null; }
    if (fx.wide > 0) { fx.wide--; if (fx.wide <= 0) applyPaddleWidth(); }
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
      if (fx.cine) {
        /* сценки (босс шаров, бомба, кулак) паузу не дают */
        floaters.push({ x: W / 2, y: H * 0.42, text: 'СЦЕНКА: ПАУЗА НЕДОСТУПНА', t: 0, life: 1.2, color: '#ff8496' });
        return;
      }
      state = 'paused';
      root.UI && root.UI.showOverlay('pause');
    } else if (state === 'paused') {
      if (root.UI && root.UI.handleEsc && root.UI.handleEsc()) { syncUI(); return; }
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

  /* отражение от платформы (центр 5–10°, край до 50°) */
  function paddleBounce() {
    if (ball.vy <= 0) return;
    const cx = paddle.x + paddle.w / 2;
    if (ball.y + R >= paddle.y && ball.y - R <= paddle.y + paddle.h &&
        ball.x >= paddle.x - R && ball.x <= paddle.x + paddle.w + R) {
      const off = clamp((ball.x - cx) / (paddle.w / 2), -1, 1);
      const ao = Math.pow(Math.abs(off), ball.gradP);
      const a = ball.centerA * (1 - ao) + Math.sign(off || 1) * ao * CFG.PADDLE_MAX_ANGLE;
      ball.vx = ball.speed * Math.sin(a);
      ball.vy = -ball.speed * Math.cos(a);
      ball.y = paddle.y - R - 0.5;
      paddle.glowT = 1;
    }
  }

  /* защитный слой: отбивает шар как платформа и гаснет (одноразовый) */
  function shieldCheck() {
    if (!fx.shield || ball.vy <= 0) return;
    const sy = fx.shieldY;
    if (ball.y + R >= sy && ball.y - R <= sy + 12) {
      const off = clamp((ball.x - W / 2) / (W / 2 - 24), -1, 1);
      const ao = Math.pow(Math.abs(off), ball.gradP);
      const a = ball.centerA * (1 - ao) + Math.sign(off || 1) * ao * CFG.PADDLE_MAX_ANGLE;
      ball.vx = ball.speed * Math.sin(a);
      ball.vy = -ball.speed * Math.cos(a);
      ball.y = sy - R - 0.5;
      fx.shield = null;
      fx.rings.push({ x: ball.x, y: sy, r0: 4, r1: 60, t: 0, life: 0.4, color: '125,255,90' });
      for (let i = 0; i < 14 && particles.length < 380; i++) {
        particles.push({
          x: ball.x, y: sy, vx: randFloat(-160, 160), vy: randFloat(-260, -40),
          t: 0, life: randFloat(0.3, 0.6), size: randFloat(1.5, 3.5), color: '125,255,90'
        });
      }
      floaters.push({ x: W / 2, y: H * 0.62, text: 'ЩИТ ПОГЛОТИЛ УДАР', t: 0, life: 1.2, color: '#7dff5a' });
    }
  }

  /* свободный полёт шара (стены + платформа + слой + блоки) */
  function moveFreeBall(edt) {
    ball.x += ball.vx * edt;
    ball.y += ball.vy * edt;
    if (ball.x < R) { ball.x = R; ball.vx = Math.abs(ball.vx); }
    if (ball.x > W - R) { ball.x = W - R; ball.vx = -Math.abs(ball.vx); }
    if (ball.y < R) { ball.y = R; ball.vy = Math.abs(ball.vy); }
    paddleBounce();
    shieldCheck();
    collideBlocks(ball);
  }

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

    /* эффекты усилений, не зависящие от шара */
    updateWorldFx(dt);

    /* мяч на платформе — ждём Enter (или авто-запуск после усиления) */
    if (ball.docked) {
      ball.x = paddle.x + paddle.w / 2;
      ball.y = paddle.y - R - 2;
      if (ball.autoLaunch) {
        ball.autoT += dt;
        if (ball.autoT >= 3) launch();
      }
      return;
    }

    /* сценка с шаром (шальной / разделитель / босс / бомба) */
    if (fx.ballScene) { updateBallScene(dt); return; }

    /* шар уничтожен усилением и ещё не восстановился */
    if (fx.restore) return;

    /* шар заморожен (крокодилы, кулак) */
    if (fx.gators || fx.fist) return;

    /* обычный полёт */
    moveFreeBall(dt);

    /* потеря шара */
    if (ball.y - R > H + 40) loseBall();
  }

  /* коллизии круг-против-AABB для любого шара (главный или мелкий) */
  function collideBlocks(obj) {
    const r = obj.r || R;
    let best = null, bestPen = -1, bdx = 0, bdy = 0;
    for (const b of blocks) {
      if (!b.alive) continue;
      const cx = clamp(obj.x, b.x, b.x + b.w);
      const cy = clamp(obj.y, b.y, b.y + b.h);
      const dx = obj.x - cx, dy = obj.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r) {
        const pen = r - Math.sqrt(d2);
        if (pen > bestPen) { bestPen = pen; best = b; bdx = dx; bdy = dy; }
      }
    }
    if (!best) return false;

    if (bdx === 0 && bdy === 0) {
      obj.vy = -obj.vy;
      obj.y = best.y - r - 0.5;
    } else if (Math.abs(bdx) >= Math.abs(bdy)) {
      const s = Math.sign(bdx);
      obj.vx = s * Math.max(Math.abs(obj.vx), 1);
      obj.x += s * (r - Math.abs(bdx) + 0.5);
    } else {
      const s = Math.sign(bdy);
      obj.vy = s * Math.max(Math.abs(obj.vy), 1);
      obj.y += s * (r - Math.abs(bdy) + 0.5);
    }
    hitBlock(best);
    return true;
  }

  /* ======================= Усиления ======================= */

  /* Идёт «действие» усиления, требующее ожидания: сценка с шаром,
     разлёт мелких шаров/крокодилов/кулака, стирание glob.dtr или
     восстановление шара. Пока активно — таблица усилений закрыта ЦЕЛИКОМ,
     а открывается сразу же, как действие закончилось. */
  function powerActionActive() {
    return !!(fx.cine || fx.ballScene || fx.restore || fx.gators ||
              fx.fist || fx.bossBall || fx.erase);
  }

  function canActivatePower(id) {
    if (state !== 'playing' && state !== 'paused') return false;
    /* после активации усиления нужно ждать конца его действия —
       в это время недоступна вся таблица, а не только «шаровые» усиления */
    if (powerActionActive()) return false;
    if (id === 'life' && fx.shield) return false;       // пока слой жив — снова нельзя
    return true;
  }

  function activatePower(id) {
    if (!canActivatePower(id)) return false;
    if (!Powers || !Powers.consume(id)) return false;
    applyPower(id);
    syncUI();
    return true;
  }

  function applyPower(id) {
    switch (id) {
      case 'life':
        fx.shield = { stages: 2 };
        floaterCenter('ЗАЩИТНЫЙ СЛОЙ: 2 ЭТАПА', '#7dff5a');
        break;
      case 'rogue': startBallScene('rogue'); break;
      case 'split': startBallScene('split'); break;
      case 'paddle':
        fx.wide = 3; applyPaddleWidth();
        floaterCenter('ПЛАТФОРМА ×2: 3 ЭТАПА', '#7ec8ff');
        break;
      case 'gators': startGators(); break;
      case 'boss': startBallScene('boss'); break;
      case 'bomb': startBallScene('bomb'); break;
      case 'elephant':
        fx.superT = 30;
        floaterCenter('СУПЕР СЛОН: 30 СЕКУНД КРИТОВ!', '#ff5c7a');
        break;
      case 'fist': startFist(); break;
      case 'globdtr':
        fx.erase = { t: 0, next: 0.5, tick: 0 };
        floaterCenter('glob.dtr', '#9dffb0');
        break;
      case 'buffgv': {
        /* сперва 10%: джекпот — по одному ВСЕГО, кроме неизвестных;
           остальные 90% — обычная система: каждое усиление бросает
           свою кость (90% обычное / 50% эпическое / 20% легендарное,
           плюс отдельные 5% на glob.dtr) */
        const got = [];
        if (Math.random() < 0.10) {
          for (const pid of Powers.order) {
            if (Powers.defs[pid].rarity === 'unknown') continue;
            Powers.grant(pid);
            got.push(Powers.defs[pid].name);
          }
          floaterCenter('buff.gv: ДЖЕКПОТ! ВСЕ УСИЛЕНИЯ', '#9dffb0');
        } else {
          for (const pid of Powers.order) {
            const d = Powers.defs[pid];
            const ch = (pid === 'globdtr') ? 0.05
              : (d.rarity === 'common') ? 0.90
              : (d.rarity === 'epic') ? 0.50
              : (d.rarity === 'legendary') ? 0.20 : null;
            if (ch != null && Math.random() < ch) {
              Powers.grant(pid);
              got.push(d.name);
            }
          }
          floaterCenter(got.length
            ? 'buff.gv: +' + got.length + ' ' + ruPlural(got.length, 'усиление', 'усиления', 'усилений')
            : 'buff.gv: ...пусто',
            got.length ? '#9dffb0' : '#8fb3c7');
        }
        console.log('%cbuff.gv%c выдал: ' + (got.join(' · ') || 'ничего'),
          'color:#9dffb0;font-weight:700', 'color:inherit');
        break;
      }
    }
  }

  function floaterCenter(text, color) {
    floaters.push({ x: W / 2, y: H * 0.42, text, t: 0, life: 1.6, color: color || '#bfeaff' });
  }

  /* русская плюрализация для сообщений buff.gv */
  function ruPlural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  /* --- сценки с шаром --- */

  function undockForScene() {
    ball.docked = false;
    ball.autoLaunch = false;
    ball.vx = 0; ball.vy = 0;
    ball.x = paddle.x + paddle.w / 2;
    ball.y = paddle.y - R - 2;
  }

  function startBallScene(kind) {
    const sc = { kind, phase: '', t: 0, starGone: false, star: null };
    const wasDocked = ball.docked;
    if (wasDocked) undockForScene();

    if (kind === 'rogue') {
      sc.phase = 'charge';                       // трясётся и ярче, урона нет
    } else if (kind === 'split') {
      sc.phase = 'wait';
      spawnSmalls();
    } else {                                      // boss | bomb — непаузируемые сценки
      fx.cine = true;
      if (wasDocked) {
        sc.phase = (kind === 'boss') ? 'star' : 'fuse';
        if (kind === 'boss') { sc.star = { x: ball.x, y: ball.y }; spawnBossBall(); }
      } else {
        sc.phase = 'slow';                        // секунда торможения, блоки ещё получают удары
      }
    }
    fx.ballScene = sc;
  }

  function spawnSmalls() {
    const sp = Math.max(320, ball.speed || CFG.BASE_SPEED);
    /* настоящий крест (X): четыре диагонали, скорость нормирована */
    const q = Math.SQRT1_2;
    const dirs = [[q, -q], [-q, -q], [q, q], [-q, q]];
    fx.smalls = dirs.map(([dx, dy]) => ({
      x: ball.x, y: ball.y, r: 4.5,
      vx: dx * sp, vy: dy * sp
    }));
  }

  function spawnBossBall() {
    const sx = randFloat(W * 0.2, W * 0.8), sy = -70;   // 20–80% верхнего края
    const speed = randFloat(340, 460);
    const d = Math.hypot(ball.x - sx, ball.y - sy) || 1;
    fx.bossBall = {
      x: sx, y: sy, r: 61,                              // диаметр 2 блока
      vx: (ball.x - sx) / d * speed,
      vy: (ball.y - sy) / d * speed,
      bounces: 0, ang: randFloat(0, TAU), life: 0,
      hit: new Set()          // блоки, уже повреждённые на этом пролёте
    };
  }

  function updateBallScene(dt) {
    const S = fx.ballScene;
    S.t += dt;

    if (S.kind === 'rogue') {
      if (S.t >= 0.9) {                                 // самоуничтожение
        boomAt(ball.x, ball.y, 26);
        areaDamage(ball.x, ball.y, d => d <= 1.5 ? 3 : 0);
        fx.ballScene = null;
        fx.restore = { t: 0, delay: 0.8 };
      }
      return;
    }

    if (S.kind === 'boss' || S.kind === 'bomb') {
      if (S.phase === 'slow') {
        const k = Math.max(0, 1 - S.t);
        moveFreeBall(dt * k * k);                       // плавно останавливается
        if (S.t >= 1) {
          S.t = 0;
          if (S.kind === 'boss') {
            S.phase = 'star';
            S.star = { x: ball.x, y: ball.y };
            spawnBossBall();
          } else {
            S.phase = 'fuse';
          }
        }
        return;
      }
      if (S.kind === 'bomb' && S.phase === 'fuse') {
        if (S.t >= 1.25) {                              // фитиль прогорел — взрыв
          const cx = ball.x, cy = ball.y;
          bigBoomAt(cx, cy);
          areaDamage(cx, cy, d =>
            d <= 2 ? 10 : clamp(Math.round(10 - (d - 2) * 1.75), 3, 10));
          fx.ballScene = null; fx.cine = false;
          fx.restore = { t: 0, delay: 0.7 };
        }
        return;
      }
      /* boss 'star' — шар стоит звездой, жирный шар живёт в updateWorldFx */
      return;
    }
  }

  /* --- эффекты, не зависящие от шара --- */

  function updateWorldFx(dt) {
    /* супер слон: время идёт только в игре (в паузе стоит) */
    if (fx.superT > 0) fx.superT = Math.max(0, fx.superT - dt);

    /* восстановление шара после усилений */
    if (fx.restore) {
      fx.restore.t += dt;
      if (fx.restore.t >= fx.restore.delay) {
        fx.restore = null;
        dockBall(true);        // над платформой + авто-запуск через 3 с
      }
    }

    /* glob.dtr: каждые 0.5 с у каждого блока снимается 1 прочность */
    if (fx.erase) {
      fx.erase.t += dt;
      if (fx.erase.t >= fx.erase.next) {
        fx.erase.next += 0.5; fx.erase.tick++;
        for (const b of blocks) {
          if (!b.alive) continue;
          damageBlock(b, 1);
          if (particles.length < 360) {
            particles.push({
              x: b.x + b.w / 2, y: b.y + b.h / 2,
              vx: randFloat(-40, 40), vy: randFloat(-70, -10),
              t: 0, life: randFloat(0.25, 0.5),
              size: randFloat(1, 2.4), color: BLOCK_COLORS[clamp(b.hp, 1, 10)] || BLOCK_COLORS[1]
            });
          }
        }
        checkLevelDone();
      }
    }

    /* мелкие шары разделителя: летят, бьются о стены и блоки,
       платформой не останавливаются и вылетают снизу */
    for (let i = fx.smalls.length - 1; i >= 0; i--) {
      const s = fx.smalls[i];
      s.vy += 220 * dt;                          // лёгкая гравитация — все выходят снизу
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.x < s.r) { s.x = s.r; s.vx = Math.abs(s.vx); }
      if (s.x > W - s.r) { s.x = W - s.r; s.vx = -Math.abs(s.vx); }
      if (s.y < s.r) { s.y = s.r; s.vy = Math.abs(s.vy); }
      collideBlocks(s);
      if (s.y - s.r > H + 30) fx.smalls.splice(i, 1);
    }
    if (fx.ballScene && fx.ballScene.kind === 'split' &&
        fx.smalls.length === 0 && !fx.restore) {
      fx.ballScene = null;
      fx.restore = { t: 0, delay: 0.25 };
    }

    if (fx.gators) updateGators(dt);
    if (fx.fist) updateFist(dt);
    if (fx.bossBall) updateBossBall(dt);

    /* сценка босса заканчивается, когда жирный шар ушёл с экрана */
    if (fx.ballScene && fx.ballScene.kind === 'boss' &&
        fx.ballScene.phase === 'star' && !fx.bossBall) {
      fx.ballScene = null;
      fx.cine = false;
      if (!fx.restore) fx.restore = { t: 0, delay: 0.3 };
    }
  }

  /* --- атака аллигаторов --- */

  /* с активной Пухлой Платформой крокодилы в полтора раза шире — задевают
     больше блоков; центры остаются на прежних местах (25% / 75% / центр),
     то есть на том же расстоянии друг от друга */
  function crocW(big) { return (big ? 105 : 49) * (fx.wide > 0 ? 1.5 : 1); }

  function makeCroc(x, big) {
    const w = crocW(big), h = big ? 115 : 78;   // ~80% блока / до 3 столбцов
    return {
      x, y: paddle.y - h - 4, w, h,
      speed: big ? 400 : 540,
      dmg: big ? 5 : 3,
      hit: new Set(), dead: false, big
    };
  }

  function startGators() {
    const froze = !ball.docked;
    /* центры крокодилов на 1/4 и 3/4 платформы — с учётом их собственной
       ширины, чтобы при Пухлой Платформе не слипались в один */
    const c1 = paddle.x + paddle.w * 0.25, c2 = paddle.x + paddle.w * 0.75;
    fx.gators = {
      phase: 'small', eaten: false, frozeBall: froze,
      v0: froze ? { x: ball.vx, y: ball.vy } : null,
      crocs: [
        makeCroc(c1 - crocW(false) / 2, false),
        makeCroc(c2 - crocW(false) / 2, false)
      ]
    };
  }

  function updateGators(dt) {
    const G = fx.gators;
    for (const c of G.crocs) {
      if (c.dead) continue;
      c.y -= c.speed * dt;
      for (const b of blocks) {
        if (!b.alive || c.hit.has(b)) continue;
        if (c.x < b.x + b.w && c.x + c.w > b.x &&
            c.y < b.y + b.h && c.y + c.h > b.y) {
          c.hit.add(b);
          damageBlock(b, c.dmg);
        }
      }
      /* крокодил может сожрать замороженный шар */
      if (!G.eaten && !ball.docked && !fx.restore && !fx.ballScene) {
        const nx = clamp(ball.x, c.x, c.x + c.w), ny = clamp(ball.y, c.y, c.y + c.h);
        if ((ball.x - nx) * (ball.x - nx) + (ball.y - ny) * (ball.y - ny) <= (R + 2) * (R + 2)) {
          G.eaten = true;
          boomAt(ball.x, ball.y, 12);
          floaters.push({ x: ball.x, y: ball.y, text: 'ШАР СЪЕДЕН!', t: 0, life: 1.1, color: '#3ddc68' });
        }
      }
      if (c.y + c.h < -30) c.dead = true;
    }
    if (G.crocs.every(c => c.dead)) {
      if (G.phase === 'small') {
        G.phase = 'big';
        G.crocs = [makeCroc(paddle.x + paddle.w / 2 - crocW(true) / 2, true)];
      } else {
        if (G.eaten) fx.restore = { t: 0, delay: 0.3 };
        else if (G.frozeBall) { ball.vx = G.v0.x; ball.vy = G.v0.y; }
        fx.gators = null;
      }
    }
    checkLevelDone();
  }

  /* --- удар ударов --- */

  function startFist() {
    const froze = !ball.docked;
    fx.fist = {
      x: W + 60, w: 92, y: 28, h: 218,            // высотой со все блоки
      hit: new Set(), frozeBall: froze,
      v0: froze ? { x: ball.vx, y: ball.vy } : null
    };
    fx.cine = true;
  }

  function updateFist(dt) {
    const F = fx.fist;
    F.x -= 980 * dt;                               // проносится справа налево
    for (const b of blocks) {
      if (!b.alive || F.hit.has(b)) continue;
      if (b.x + b.w > F.x && b.x < F.x + F.w) {
        F.hit.add(b);
        damageBlock(b, 7);
      }
    }
    if (F.x + F.w < -80) {
      fx.fist = null;
      fx.cine = false;
      if (F.frozeBall) { ball.vx = F.v0.x; ball.vy = F.v0.y; }
    }
    checkLevelDone();
  }

  /* --- босс шаров: жирный шар --- */

  function updateBossBall(dt) {
    const B = fx.bossBall;
    B.life += dt;
    B.ang += dt * 1.7;                             // слегка крутится в полёте
    B.x += B.vx * dt;
    B.y += B.vy * dt;

    if (B.bounces < 3) {
      if (B.life > 6) {                            // не засиживаться на экране
        const sp = Math.hypot(B.vx, B.vy) || 380;
        B.vx = (Math.random() < 0.5 ? -1 : 1) * sp * 0.4;
        B.vy = -sp;
        B.bounces = 3;
      } else {
        let hitWall = false;
        if (B.x < B.r && B.vx < 0) { B.x = B.r; B.vx = Math.abs(B.vx); hitWall = true; }
        else if (B.x > W - B.r && B.vx > 0) { B.x = W - B.r; B.vx = -Math.abs(B.vx); hitWall = true; }
        if (B.y < B.r && B.vy < 0) { B.y = B.r; B.vy = Math.abs(B.vy); hitWall = true; }
        else if (B.y > H - B.r && B.vy > 0) { B.y = H - B.r; B.vy = -Math.abs(B.vy); hitWall = true; }
        if (hitWall) {
          B.bounces++;
          shake(7, 0.35);                          // солидно трясёт экран
          /* отскок: память очищается — шар снова может крушить любые блоки */
          B.hit.clear();
          if (B.bounces >= 3) {                    // третий отскок — уходит с экрана
            const sp = Math.hypot(B.vx, B.vy) || 380;
            B.vx = (Math.random() < 0.5 ? -1 : 1) * sp * 0.45;
            B.vy = -Math.abs(sp);
          }
        }
      }
    }

    /* полёт по полю: крушит все блоки на пути, каждый — один раз
       между отскоками (набор обнуляется на отскоке выше) */
    let smashed = false;
    for (const b of blocks) {
      if (!b.alive || B.hit.has(b)) continue;
      const cx = clamp(B.x, b.x, b.x + b.w), cy = clamp(B.y, b.y, b.y + b.h);
      const dx = B.x - cx, dy = B.y - cy;
      if (dx * dx + dy * dy <= B.r * B.r) {
        B.hit.add(b);
        damageBlock(b, 3);
        smashed = true;
      }
    }
    if (smashed) checkLevelDone();

    /* жирный шар налетает на звезду — шар уничтожается */
    const S = fx.ballScene;
    if (S && S.kind === 'boss' && S.phase === 'star' && !S.starGone) {
      if (Math.hypot(B.x - S.star.x, B.y - S.star.y) < B.r + 12) {
        S.starGone = true;
        boomAt(S.star.x, S.star.y, 22);
        fx.restore = { t: 0, delay: 0.5 };
      }
    }

    if (B.y < -B.r - 90 || B.x < -B.r - 90 || B.x > W + B.r + 90) fx.bossBall = null;
  }

  /* --- взрывы --- */

  function boomAt(x, y, n) {
    shake(6, 0.3);
    fx.rings.push({ x, y, r0: 6, r1: 80, t: 0, life: 0.45, color: '180,240,255' });
    for (let i = 0; i < n && particles.length < 380; i++) {
      particles.push({
        x, y,
        vx: randFloat(-240, 240), vy: randFloat(-240, 200),
        t: 0, life: randFloat(0.3, 0.7),
        size: randFloat(1.6, 4), color: '223,255,255'
      });
    }
  }

  function bigBoomAt(x, y) {
    shake(11, 0.5);
    fx.rings.push({ x, y, r0: 8, r1: 150, t: 0, life: 0.5, color: '255,210,120' });
    fx.rings.push({ x, y, r0: 8, r1: 300, t: -0.12, life: 0.62, color: '255,150,90' });
    fx.rings.push({ x, y, r0: 8, r1: 460, t: -0.24, life: 0.78, color: '255,240,200' });
    for (let i = 0; i < 46 && particles.length < 380; i++) {
      const a = randFloat(0, TAU), sp = randFloat(60, 520);
      particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        t: 0, life: randFloat(0.35, 0.9),
        size: randFloat(1.8, 5), color: Math.random() < 0.5 ? '255,210,120' : '255,240,200'
      });
    }
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
    for (let i = fx.rings.length - 1; i >= 0; i--) {
      fx.rings[i].t += dt;
      if (fx.rings[i].t >= fx.rings[i].life) fx.rings.splice(i, 1);
    }
    if (!ball.docked && state === 'playing' &&
        !fx.ballScene && !fx.restore && !fx.gators && !fx.fist) {
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

  /* --- защитный слой (дополнительная жизнь) --- */
  function drawShieldFx(t) {
    if (!fx.shield) return;
    const y = fx.shieldY;
    ctx.save();
    ctx.shadowColor = rgba(neon(t, 2.4), 0.9);
    ctx.shadowBlur = 16;
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, rgba(neon(t), 0.9));
    g.addColorStop(0.5, 'rgba(235,255,250,.95)');
    g.addColorStop(1, rgba(neon(t, 1.9), 0.9));
    ctx.strokeStyle = g;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(14, y); ctx.lineTo(W - 14, y);
    ctx.stroke();
    ctx.fillStyle = rgba(neon(t, 2.4), 0.5);
    ctx.beginPath(); ctx.arc(14, y, 4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(W - 14, y, 4, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* --- крокодилы --- */
  function drawGatorsFx() {
    if (!fx.gators) return;
    ctx.save();
    for (const c of fx.gators.crocs) {
      if (c.dead) continue;
      ctx.shadowColor = 'rgba(61,220,104,.7)';
      ctx.shadowBlur = 14;
      rr(c.x, c.y, c.w, c.h, 9);
      ctx.fillStyle = c.big ? '#2fbf4f' : '#3ddc68';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#1c7a35';
      ctx.lineWidth = 2.5;
      rr(c.x, c.y, c.w, c.h, 9);
      ctx.stroke();
      ctx.fillStyle = '#eafff0';
      ctx.beginPath();
      ctx.arc(c.x + c.w * 0.7, c.y + c.h * 0.14, c.big ? 5 : 3.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#0a2412';
      ctx.beginPath();
      ctx.arc(c.x + c.w * 0.7 + 1, c.y + c.h * 0.14, c.big ? 2.2 : 1.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /* --- кулак --- */
  function drawFistFx() {
    const F = fx.fist;
    if (!F) return;
    ctx.save();
    ctx.shadowColor = 'rgba(255,60,80,.8)';
    ctx.shadowBlur = 24;
    rr(F.x, F.y, F.w, F.h, 10);
    ctx.fillStyle = '#e6303f';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#7a0f1c';
    ctx.lineWidth = 3;
    rr(F.x, F.y, F.w, F.h, 10);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(F.x + 16 + i * 26, F.y + 24, 12, F.h - 48);
    }
    ctx.strokeStyle = 'rgba(255,120,130,.28)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const yy = F.y + 26 + i * (F.h - 52) / 3;
      ctx.beginPath();
      ctx.moveTo(F.x + F.w + 10, yy);
      ctx.lineTo(F.x + F.w + 46 + (i % 2) * 18, yy);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* --- мелкие шары разделителя --- */
  function drawSmallsFx() {
    if (!fx.smalls.length) return;
    const cols = ['0,229,255', '125,255,90', '235,255,250', '255,120,170'];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    fx.smalls.forEach((s, i) => {
      const c = cols[i % cols.length];
      ctx.shadowColor = `rgba(${c},.9)`;
      ctx.shadowBlur = 10;
      ctx.fillStyle = `rgba(${c},.95)`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    });
    ctx.restore();
  }

  /* --- жирный шар босса --- */
  function drawBossBallFx() {
    const B = fx.bossBall;
    if (!B) return;
    ctx.save();
    ctx.translate(B.x, B.y);
    ctx.rotate(B.ang);
    ctx.shadowColor = 'rgba(255,255,255,.75)';
    ctx.shadowBlur = 26;
    const g = ctx.createRadialGradient(-B.r * 0.35, -B.r * 0.35, B.r * 0.08, 0, 0, B.r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, '#c9ccd4');
    g.addColorStop(0.75, '#33363e');
    g.addColorStop(1, '#07080c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, B.r, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(0, 0, B.r * 0.72, B.r * 0.34, 0.5, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(0, 0, B.r * 0.55, B.r * 0.5, -0.9, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, B.r - 1, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  /* --- ударные волны --- */
  function drawRingsFx() {
    if (!fx.rings.length) return;
    ctx.save();
    for (const r of fx.rings) {
      if (r.t < 0) continue;
      const k = r.t / r.life;
      const rad = lerp(r.r0, r.r1, 1 - (1 - k) * (1 - k));
      ctx.strokeStyle = `rgba(${r.color},${(0.85 * (1 - k)).toFixed(3)})`;
      ctx.lineWidth = 2 + 5 * (1 - k);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* --- шар (обычный / сценки / супер слон) --- */

  function drawBall(t) {
    if (fx.restore) return;                       // шар уничтожен, ждёт восстановления
    if (fx.gators && fx.gators.eaten) return;     // сожран крокодилом
    const S = fx.ballScene;
    if (S) {
      if (S.kind === 'rogue') { drawRogueBall(); return; }
      if (S.kind === 'split') return;             // летят только мелкие
      if (S.kind === 'boss') {
        if (S.phase === 'star') { if (!S.starGone) drawStar(S.star.x, S.star.y, t); return; }
        drawNormalBall(t); return;
      }
      if (S.kind === 'bomb') {
        if (S.phase === 'fuse') { drawBomb(S.t); return; }
        drawNormalBall(t); return;
      }
    }
    drawNormalBall(t);
  }

  function drawNormalBall(t) {
    const sup = fx.superT > 0;
    const c = sup ? [255, 77, 94] : neon(t, 0.7);
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
    ctx.shadowBlur = sup ? 24 + 6 * Math.sin(t * 9) : 18;   // слон светится сильнее
    const rg = ctx.createRadialGradient(ball.x, ball.y, 1, ball.x, ball.y, R);
    rg.addColorStop(0, '#ffffff');
    rg.addColorStop(0.5, sup ? 'rgba(255,150,160,.95)' : 'rgba(223,255,255,.95)');
    rg.addColorStop(1, rgba(c, 0.55));
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, R, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawRogueBall() {
    const S = fx.ballScene;
    const k = Math.min(1, S.t / 0.9);
    const jx = randFloat(-3, 3) * k, jy = randFloat(-2.5, 2.5) * k;   // слегка трясётся
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,.95)';
    ctx.shadowBlur = 20 + 16 * k;                 // становится ярче
    const rg = ctx.createRadialGradient(ball.x + jx, ball.y + jy, 1, ball.x + jx, ball.y + jy, R + 2 * k);
    rg.addColorStop(0, '#ffffff');
    rg.addColorStop(0.55, 'rgba(235,255,255,.95)');
    rg.addColorStop(1, 'rgba(160,235,255,.7)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(ball.x + jx, ball.y + jy, R + 2 * k, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawStar(x, y, t) {
    const c = neon(t, 0.7);
    const r1 = 17 * (1 + 0.07 * Math.sin(t * 6));
    ctx.save();
    ctx.shadowColor = rgba(c, 1);
    ctx.shadowBlur = 24;
    ctx.fillStyle = rgba(c, 0.85);
    starPath(x, y, r1, r1 * 0.45, t * 0.8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function starPath(x, y, r1, r2, rot) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + i * Math.PI / 5 - Math.PI / 2;
      const r = (i % 2 === 0) ? r1 : r2;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawBomb(ft) {
    const x = ball.x, y = ball.y;
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,.5)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#15181f';
    ctx.beginPath(); ctx.arc(x, y, 12, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 12, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.beginPath(); ctx.arc(x - 4, y - 4, 3.5, 0, TAU); ctx.fill();
    /* фитиль вылезает... */
    const L = Math.min(1, ft / 0.5) * 13;
    const fx0 = x + 3, fy0 = y - 11;
    const fx1 = fx0 + 5, fy1 = fy0 - L;
    ctx.strokeStyle = '#c9a15f';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(fx0, fy0);
    ctx.quadraticCurveTo(fx0 + 6, fy0 - L * 0.4, fx1, fy1);
    ctx.stroke();
    /* ...и поджигается */
    if (ft > 0.5) {
      const fl = 0.6 + 0.4 * Math.sin(ft * 40) + Math.random() * 0.3;
      ctx.shadowColor = '#ffd24d';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffd24d';
      ctx.beginPath(); ctx.arc(fx1, fy1, 2.2 + fl * 1.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath(); ctx.arc(fx1, fy1, 1.1, 0, TAU); ctx.fill();
    }
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
    const txt = ball.autoLaunch
      ? 'Enter — запуск · авто-запуск через ' + Math.max(0, 3 - ball.autoT).toFixed(1) + ' с'
      : 'Enter — запуск шара · Esc — пауза';
    ctx.fillText(txt, W / 2, paddle.y - 30);
    ctx.restore();
  }

  function render(t) {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    let rx = 0, ry = 0;
    if (shakeT > 0) {
      const k = (shakeT / shakeDur) * shakeAmp;
      rx = randFloat(-k, k); ry = randFloat(-k, k);
    }
    /* фоновая тряска: кулак — сильная, glob.dtr — растущая со временем */
    const rum = fx.fist ? 9 : (fx.erase ? Math.min(8, 0.6 + fx.erase.t * 1.2) : 0);
    if (rum > 0) { rx += randFloat(-rum, rum); ry += randFloat(-rum, rum); }
    ctx.translate(rx, ry);

    drawField(t);
    drawBlocks();
    drawShieldFx(t);
    drawGatorsFx();
    drawFistFx();
    drawParticles();
    drawPaddle(t);
    drawSmallsFx();
    drawBall(t);
    drawBossBallFx();
    drawRingsFx();
    drawFloaters();
    drawHint(t);
    ctx.restore();
  }

  /* ======================= Цикл ======================= */

  /* таблица усилений открывается/закрывается по факту конца действия —
     без этого панель справа висела бы «наполовину недоступной», пока шар
     не стукнет по блоку (обновление шло только через очки) */
  let lastLockKey = null;
  function syncPowerLock() {
    const key = (powerActionActive() ? '1' : '0') + (fx.shield ? '1' : '0') +
                (state === 'playing' ? '1' : '0');
    if (key !== lastLockKey) {
      lastLockKey = key;
      root.UI && root.UI.updateSidePanel && root.UI.updateSidePanel();
    }
  }

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
    syncPowerLock();
    if (now - lastChipT > 200) {
      lastChipT = now;
      const parts = [];
      if (fx.shield) parts.push('ЩИТ ' + fx.shield.stages + ' эт');
      if (fx.wide > 0) parts.push('×2 ПЛАТФОРМА ' + fx.wide + ' эт');
      if (fx.superT > 0) parts.push('СЛОН ' + Math.ceil(fx.superT) + ' с');
      if (fx.erase) parts.push('glob.dtr');
      const txt = parts.join(' · ');
      if (txt !== lastChipTxt) {
        lastChipTxt = txt;
        root.UI && root.UI.fxChip && root.UI.fxChip(txt);
      }
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
      e.preventDefault();                          // не активировать сфокусированные кнопки
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
    toggleControlMode, debugStart, activatePower, canActivatePower,
    get state() { return state; },
    get score() { return score; },
    get record() { return record; },
    get lives() { return lives; },
    get stageNum() { return stageNum; },
    get layoutName() { return LAYOUT_INFO[layoutId] ? LAYOUT_INFO[layoutId].name : '—'; },
    get autopilot() { return autopilot; },
    get controlMode() { return controlMode; },
    get paddleX() { return paddle.x; },
    get paddleW() { return paddle.w; },
    get ballDocked() { return ball.docked; },
    get cine() { return fx.cine; },
    get powerBusy() { return powerActionActive(); },
    get superT() { return fx.superT; },
    get fxSnapshot() {
      return {
        shield: fx.shield ? fx.shield.stages : 0,
        wide: fx.wide,
        superT: +fx.superT.toFixed(1),
        erase: !!fx.erase,
        ballScene: fx.ballScene ? fx.ballScene.kind + ':' + fx.ballScene.phase : null,
        restore: !!fx.restore,
        smalls: fx.smalls.length,
        smallsXY: fx.smalls.map(s => [Math.round(s.x), Math.round(s.y)]),
        gators: fx.gators ? fx.gators.crocs.map(c => c.w).join(',') : null,
        fist: !!fx.fist,
        bossBall: !!fx.bossBall,
        cine: fx.cine,
        powerBusy: powerActionActive(),
        ballAuto: ball.autoLaunch
      };
    },
    get levelPoints() { return score - levelStartScore; },
    get runStartRecord() { return runStartRecord; },
    get levelTargetText() {
      const st = STAGES[stageNum];
      return layoutId === 0 ? '450 (rigged)' : `${st.target} ± ${st.tol}`;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
