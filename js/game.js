/* ============================================================
   НЕОН·АРКАНОИД — игровой движок
   Физика шара, криты, платформа, этапы, очки, рекорд,
   мутированные блоки (телепорт, вверх-вниз, вправо-влево,
   блоко-змей, шароблок) и усиления: защитный слой, шальной
   шар, шар-разделитель, пухлая платформа, атака аллигаторов,
   босс шаров, шаровая бомба, супер слон, удар ударов,
   glob.dtr, buff.gv.
   ============================================================ */
(function (root) {
  'use strict';
  const { CFG, MODES, BLOCK_COLORS, LAYOUT_INFO, stageDef, fieldWFor,
          randInt, randFloat, clamp, lerp, loadRecord, saveRecord,
          isBadassUnlocked, setBadassUnlocked } = root;
  const Powers = root.Powers;

  const H = CFG.CANVAS_H, R = CFG.BALL_R;
  let W = CFG.CANVAS_W;             // ширина поля: 720 (9 колонн) или 1032 (13 — финал Badass)
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

  /* --- режимы: обычный и badass --- */
  let mode = 'normal';            // 'normal' | 'badass'
  let runRegen = false;           // настройка забега: регенерация жизней
  let stagesDone = 0;            // пройдено этапов в забеге (для регенерации)
  let lastRegenGain = false;      // только что сработала регенерация (для окна этапа)
  let finalePending = false;      // окно 5-го этапа Badass ждёт перехода к финалу
  let badassJustUnlocked = false; // победа в обычном только что открыла Badass
  let expanding = null;           // { t, dur, from, to, done } — твин расширения поля
  let glowK = 1;                  // множитель свечения (Badass / финал)
  let PAL = { a: [0, 229, 255], b: [125, 255, 90] };  // палитра перелива неона

  let blocks = [];
  let gridCols = 9;                 // колонок сетки текущего уровня (9 / 13 / 19)
  let gridRows = 5;                 // строк сетки текущего уровня (5 / 8 — финал ада)
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
    wall: null,                   // стена ада на 10-м этапе (3 слоя + сдвиг щита)
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

  /* --- стена ада (10-й этап) ---
     Во время падения Сатаны снизу разворачиваются 3 наложенных щита
     (сверху вниз, каждый — от центра поля к краям за 1 с на безье,
     задержка до следующего 0,33 с) с огненной подсветкой, как у поля.
     Каждый слой раз поглощает падение шара. Щит дополнительной жизни
     (если действовал на 9-м этапе) заранее плавно сдвигается вниз —
     в самый низ стека, под новые слои, а после победы над Сатаной,
     когда временная защита ушла, поднимается на обычное место — и при
     победе не списывается. Оставшиеся слои уходят глюк-эффектом:
     тряска/поворот 3 р/с, сжатие к центру, прозрачность — сверху вниз,
     пауза между началами 0,33 с при 3 слоях и 0,5 с при 2. */
  const SHIELD_Y = H - 24;                 // обычное место щита доп. жизни
  let extraShieldY = SHIELD_Y;             // текущее (анимируется сдвигом)
  const WALL_GAP = 13;                     // расстояние между слоями стены
  const WALL_GROW = 1.0;                   // разворачивание слоя, с
  const WALL_STAGGER = 0.33;               // задержка до следующего слоя, с
  const WALL_DIE = 0.85;                   // глюк-исчезновение слоя, с
  const WALL_SHIFT = 0.45;                 // сдвиг щита вниз/вверх, с

  /* кубическая безье для анимаций стены: разворачивание — как
     транзишен расширения поля, сжатие — как «падение Сатаны» */
  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (u) => ((ax * u + bx) * u + cx) * u;
    const sy = (u) => ((ay * u + by) * u + cy) * u;
    const dX = (u) => (3 * ax * u + 2 * bx) * u + cx;
    return function (x) {
      let u = x;
      for (let i = 0; i < 8; i++) {              // Ньютон
        const e = sx(u) - x;
        if (Math.abs(e) < 1e-6) return sy(u);
        const d = dX(u);
        if (Math.abs(d) < 1e-6) break;
        u -= e / d;
      }
      let lo = 0, hi = 1;                        // запасной вариант
      u = x;
      for (let i = 0; i < 24; i++) {
        const v = sx(u);
        if (Math.abs(v - x) < 1e-6) break;
        if (v < x) lo = u; else hi = u;
        u = (lo + hi) / 2;
      }
      return sy(u);
    };
  }
  const wallEase = cubicBezier(.3, .7, .25, 1);
  const wallDieEase = cubicBezier(.55, 0, .85, .45);

  /* тряска экрана: амплитуда + длительность */
  let shakeT = 0, shakeDur = 0.22, shakeAmp = 5;
  function shake(amp, dur) { shakeAmp = amp; shakeDur = dur; shakeT = dur; }

  let autopilot = false;
  let controlMode = 'mouse';      // 'mouse' | 'keys' — переключается ЛКМ
  let mouseX = null;
  const keys = { left: false, right: false };
  let lastFrame = 0;
  let lastChipT = 0, lastChipTxt = '\u0000';

  /* --- ад: босс-Сатана, выход из режима, глюк неизвестных усилений ---
     boss/bossSeq — 10-й этап: поле заполняется, ложится тень на большую
     часть поля, Сатана (5×3, 100 прочности, криты дают лишь 5) падает
     на место и ломает жертвенные блоки под собой; только после этого
     можно запускать шар, а таблица усилений и поле окончательно
     вспыхивают. Пока Сатана жив — обводки остальных блоков ярко-красные.
     hellExitLocked — из ада нельзя выйти, пока не сделана 1 попытка
     пройти уровень (окончание этапа или поражение).
     hellPw — после первого переключения на стрелки (с задержкой)
     неизвестные усиления накрывает глюк: появляется гигантским,
     прозрачным и повёрнутым на ±30° и встаёт на усилениях (сиквенс
     «падения Сатаны», перенесённый на сам элемент); пока глюк
     появляется — запуск шара заблокирован, на мышь уйти нельзя —
     подпись «СМОТРИ.»; полностью накрыл — тряска экрана, глюки
     с трясоткой и подёргиваниями остаются до конца этапа.
     satanCalm* — победа над Сатаной не завершает уровень: 10 секунд
     после его смерти шар замедляется до 1,5× обычной скорости и
     теряет огненный след, свечение поля стихает до силы этапов 1–3 */
  let boss = null, bossSeq = null, bossCells = null;
  let bossLanded = false, satanDying = 0;
  let hellExitLocked = false;
  const hellPw = { fired: false, t: 0, done: false };
  /* появление глюка — как падение мини-Сатаны: босс падает 0.85 с,
     сиквенс на элементе глюка в 1,5 раза быстрее */
  const HELL_PW_FALL = 0.85 / 1.5;
  /* спокойствие после Сатаны: 10 с, цель — 1,5× обычной скорости шара */
  const CALM_DUR = 10, CALM_TARGET = 1.5 * CFG.BASE_SPEED;
  let satanCalm = false, satanCalmT = 0, satanCalmV0 = 0;

  function hellPwLive() {
    return mode === 'hell' && hellPw.fired && hellPw.t >= 0 && hellPw.t < HELL_PW_FALL;
  }

  /* сила огня шара: после смерти Сатаны за 10 с плавно гаснет до 0 */
  function fireFadeK() {
    if (!(mode === 'hell' && satanCalm)) return 1;
    return Math.max(0, 1 - satanCalmT / CALM_DUR);
  }

  /* шар «не в движении»: стоит на платформе до запуска, замер для
     сценки (крокодилы/кулак/звезда/бомба), уничтожен или ещё не
     восстановился — в это время эффекты с временем действия
     (супер слон, щиты шароблоков, самотелепорты) ставятся на паузу */
  function ballIdle() {
    return ball.docked || !!fx.ballScene || !!fx.restore ||
           !!fx.gators || !!fx.fist || !!fx.bossBall;
  }

  /* ======================= Уровни ======================= */

  function stagesTotal() { return MODES[mode].stages.length - 1; }

  /* Темы режимов: Badass — фиолетовая, ад — красно-белая с огнём
     (сильнее с 4-го этапа и окончательно — когда Сатана приземлился
     на 10-м). Пока Сатана жив — обводки блоков красные, поле пылает;
     когда повержен — огонь вокруг поля стихает до силы этапов 1–3,
     но горящая таблица усилений (hell-burn) остаётся до конца этапа.
     Класс вешается и на <html>, чтобы перекрасился и скроллбар. */
  function applyModeTheme() {
    const badass = mode === 'badass';
    const hell = mode === 'hell';
    const last = stagesTotal();
    const fin = (badass || hell) && stageNum === last;
    const calm = hell && boss && !boss.alive;     // Сатана повержен
    const hellFin = hell && fin && bossLanded && !calm;
    [document.body, document.documentElement].forEach(el => {
      el.classList.toggle('mode-badass', badass);
      el.classList.toggle('mode-hell', hell);
    });
    document.body.classList.toggle('stage-final', fin);
    document.body.classList.toggle('hell-fire2', hell && stageNum >= 4 && !calm);
    document.body.classList.toggle('hell-fire3', hellFin);
    /* 10-й этап: таблица усилений пылает — при живом Сатане и после */
    document.body.classList.toggle('hell-burn', hell && fin);
    PAL = hell ? { a: [255, 64, 44], b: [255, 205, 195] }
             : badass ? { a: [168, 102, 255], b: [255, 122, 205] }
                     : { a: [0, 229, 255], b: [125, 255, 90] };
    glowK = hellFin ? 1.7 : calm ? 1.25 : hell ? (stageNum >= 4 ? 1.45 : 1.25)
               : fin ? 1.6 : badass ? 1.25 : 1;
  }

  /* Размер поля: логическая ширина, канвас, CSS-пропорции и каркас страницы */
  function setField(w) {
    W = Math.round(w);
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.style.aspectRatio = W + ' / ' + H;
    const frame = canvas.parentElement;
    if (frame) {
      frame.style.flexBasis = W + 'px';
      frame.style.setProperty('--field-ar', (W / H).toFixed(4));
    }
    document.body.classList.toggle('field-wide', W > CFG.CANVAS_W + 40);
    document.body.classList.toggle('field-huge', W > 1200);   // 19 колонн ада
    paddle.x = clamp(paddle.x, 6, Math.max(6, W - 6 - paddle.w));
    if (ball.docked) { ball.x = paddle.x + paddle.w / 2; ball.y = paddle.y - R - 2; }
  }

  /* Плавное расширение поля (финал Badass — 13 колонн, этапы 4–9 ада — 13,
     финал ада — 19) */
  function expandField(dur, cols, done) {
    expanding = { t: 0, dur, from: W, to: fieldWFor(cols), done };
  }

  /* Направление каскадного заполнения поля блоками: сверху вниз или
     с двух сторон к центру — одинаковый шанс. Исключение — финальный
     (шестой) этап Badass: он всегда заполняется сверху. */
  function pickFillDir(st) {
    if (st.wide) return 'top';
    return Math.random() < 0.5 ? 'top' : 'sides';
  }

  function buildBlocks(grid, fillDir, mutants) {
    const arr = [];
    const t0 = performance.now();
    const mutMap = new Map();
    if (mutants) for (const m of mutants) mutMap.set(m.x + ',' + m.y, m);
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        const hp = grid[y][x];
        if (hp > 0) {
          const cols = grid[y].length;
          /* задержка появления: откуда идёт заполнение */
          let delay;
          if (fillDir === 'sides') {
            const depth = Math.min(x, cols - 1 - x);   // глубина от ближайшего края
            delay = depth * 140 + y * 14;
          } else {
            delay = (y * cols + x) * 16;               // сверху вниз, слева направо
          }
          const blk = {
            hp, alive: true, flash: 0,
            x: CFG.FIELD_PAD_X + x * (CFG.BLOCK_W + CFG.GAP_X),
            y: CFG.FIELD_TOP + y * (CFG.BLOCK_H + CFG.GAP_Y),
            w: CFG.BLOCK_W, h: CFG.BLOCK_H,
            born: t0 + delay,
            fill: fillDir,
            fromLeft: fillDir === 'sides' && x <= (cols - 1) / 2,
            gx: x, gy: y                      // координаты в сетке (нужны мутантам)
          };
          const m = mutMap.get(x + ',' + y);
          if (m) initMutant(blk, m);
          arr.push(blk);
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

  /* ======================= Мутированные блоки =======================
     Пять особых видов на поздних этапах (конфиг в MODES[*].stages[*].mut):
       teleport  — 4 скрытые жизни, телепортируется от шара и сама по себе
                   раз в 10–25 с; цвет меняется, яркость = прочность,
                   обводка ярко-фиолетовая и толще, слегка дрожит (5 Гц);
       updown    — 6 жизней, ходит по столбцу вверх-вниз;
       rightleft — 6 жизней, ходит по строке вправо-влево;
                   градиент цветов блока hp-1 -> hp (у 1 — тёмно-серый),
                   обводка/цифра: 1–5 чёрные, максимум — белые;
       snake     — 5 жизней, ползёт по свободным клеткам, чешуя и градиент
                   поворачиваются по часовой вслед за направлением;
       ball      — щит на первые 20 + этап × 3 × (id режима) секунд:
                    только отскок, белые искры и тряска; таймер вместо
                    прочности; после — обычный блок (прочность 1–10
                    выбрана при создании расстановки); glob.dtr ломает
                    щит мгновенно.
     Интервал хода: 2 − (этап−1)/9 − 0.75 × (id режима − 1) секунд,
     у змея — ×0.8; стартовый сдвиг 1–3 с (у змея тоже ×0.8). */

  const MUT_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];   // право, низ, лево, верх (по часовой)

  function modeIndex() { return mode === 'hell' ? 2 : (mode === 'badass' ? 1 : 0); }

  function moverInterval(kind) {
    const t = 2 - (stageNum - 1) / 9 - 0.75 * (modeIndex() - 1);
    return Math.max(0.5, kind === 'snake' ? t * 0.8 : t);
  }

  function ballShieldTime() {
    return 20 + stageNum * modeIndex() * 3;
  }

  function initMutant(blk, m) {
    blk.kind = m.kind;
    if (m.kind === 'teleport') {
      blk.hue = randFloat(0, 360);
      blk.nextJump = randFloat(10, 25);
      blk.jt = 0; blk.jx = 0; blk.jy = 0;
    } else if (m.kind === 'snake') {
      blk.heading = randInt(0, 3);
      blk.angle = blk.heading * Math.PI / 2;      // текстура сразу смотрит по ходу
      blk.nextMove = randFloat(1, 3) * 0.8;
    } else if (m.kind === 'ball') {
      blk.shield = ballShieldTime();
      blk.shakeT = 0;
      return;                                     // шароблок не двигается
    } else {                                      // updown | rightleft
      blk.dir = Math.random() < 0.5 ? 1 : -1;
      blk.nextMove = randFloat(1, 3);
    }
  }

  /* свободна ли клетка сетки (без живых блоков; живой босс занимает
     всю свою зону 5×3) */
  function cellFree(gx, gy) {
    if (bossCells && bossCells.has(gx + ',' + gy)) return false;
    for (const b of blocks) {
      if (b.alive && b.gx === gx && b.gy === gy) return false;
    }
    return true;
  }

  /* пересесть на клетку с коротким скольжением */
  function setCell(b, gx, gy) {
    b.anim = { t: 0, dur: 0.18, fx: b.x, fy: b.y };
    b.gx = gx; b.gy = gy;
    b.x = CFG.FIELD_PAD_X + gx * (CFG.BLOCK_W + CFG.GAP_X);
    b.y = CFG.FIELD_TOP + gy * (CFG.BLOCK_H + CFG.GAP_Y);
  }

  function moveMutant(b) {
    if (b.kind === 'updown' || b.kind === 'rightleft') {
      const horiz = b.kind === 'rightleft';
      const lim = horiz ? gridCols : gridRows;
      const cur = horiz ? b.gx : b.gy;
      const ok = n => n >= 0 && n < lim &&
        (horiz ? cellFree(n, b.gy) : cellFree(b.gx, n));
      let n = cur + b.dir;
      if (!ok(n)) { b.dir = -b.dir; n = cur + b.dir; }   // ограничение — разворот
      if (ok(n)) setCell(b, horiz ? n : b.gx, horiz ? b.gy : n);
      return;
    }
    if (b.kind === 'snake') {
      const cands = [];
      for (let i = 0; i < 4; i++) {
        const nx = b.gx + MUT_DIRS[i][0], ny = b.gy + MUT_DIRS[i][1];
        if (nx < 0 || nx >= gridCols || ny < 0 || ny >= gridRows) continue;
        if (!cellFree(nx, ny)) continue;
        cands.push({ i, w: i === b.heading ? 2.2 : 1 });  // прямому ходу — приоритет
      }
      if (!cands.length) return;
      let sum = 0; for (const c of cands) sum += c.w;
      let r = Math.random() * sum, pick = cands[0];
      for (const c of cands) { r -= c.w; if (r <= 0) { pick = c; break; } }
      b.angle += ((pick.i - b.heading + 4) % 4) * Math.PI / 2;  // поворот по часовой
      b.heading = pick.i;
      setCell(b, b.gx + MUT_DIRS[pick.i][0], b.gy + MUT_DIRS[pick.i][1]);
    }
  }

  /* телепорт: любое свободное место в пределах сетки блоков */
  function teleportMutant(b) {
    const free = [];
    for (let gy = 0; gy < gridRows; gy++) {
      for (let gx = 0; gx < gridCols; gx++) {
        if ((gx !== b.gx || gy !== b.gy) && cellFree(gx, gy)) free.push([gx, gy]);
      }
    }
    if (!free.length) return false;
    const rgb = teleportRGB(b);
    spawnBurst(b.x + b.w / 2, b.y + b.h / 2, 8, rgb);
    const [gx, gy] = free[randInt(0, free.length - 1)];
    b.gx = gx; b.gy = gy;
    b.x = CFG.FIELD_PAD_X + gx * (CFG.BLOCK_W + CFG.GAP_X);
    b.y = CFG.FIELD_TOP + gy * (CFG.BLOCK_H + CFG.GAP_Y);
    b.hue = (b.hue + randFloat(40, 320)) % 360;    // оттенок всегда другой
    b.anim = { t: 0, dur: 0.16, pop: true };       // без слайда — вжух на новом месте
    spawnBurst(b.x + b.w / 2, b.y + b.h / 2, 6, teleportRGB(b));
    return true;
  }

  /* щит шароблока спал: (или его сломал glob.dtr) — становится обычным блоком */
  function unshieldBall(b) {
    b.shield = 0;
    b.kind = null;
    b.flash = 1;
    spawnBurst(b.x + b.w / 2, b.y + b.h / 2, 10, '235,244,255');
  }

  function spawnBurst(x, y, n, color) {
    for (let i = 0; i < n && particles.length < 380; i++) {
      particles.push({
        x, y, vx: randFloat(-140, 140), vy: randFloat(-190, 60),
        t: 0, life: randFloat(0.3, 0.6),
        size: randFloat(1.5, 3.5), color
      });
    }
  }

  function hslToRgbStr(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, bl = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; bl = x; }
    else if (h < 240) { g = x; bl = c; }
    else if (h < 300) { r = x; bl = c; }
    else { r = c; bl = x; }
    return `${Math.round((r + m) * 255)},${Math.round((g + m) * 255)},${Math.round((bl + m) * 255)}`;
  }

  /* цвет телепорта: яркость 1/0.7/0.5/0.3 для 4/3/2/1 жизней */
  function teleportRGB(b) {
    const L = [0.16, 0.26, 0.37, 0.52][clamp(b.hp, 1, 4) - 1];
    return hslToRgbStr(b.hue, 0.68, L);
  }

  /* цвет блока для частиц/всплывашек с учётом вида мутанта */
  function blockColorStr(b) {
    if (b.kind === 'teleport') return teleportRGB(b);
    if (b.kind === 'snake') return '120,255,110';
    if (b.kind === 'ball' && b.shield > 0) return '240,248,255';
    return BLOCK_COLORS[clamp(b.hp, 1, 10)] || BLOCK_COLORS[1];
  }

  /* тик всех мутантов — только в игровом времени (пауза замораживает).
     Пока шар не в движении (на платформе / в сценке) — временные
     эффекты стоят: щиты шароблоков не тикают, самотелепорты ждут. */
  function updateMutants(dt) {
    const now = performance.now();
    const idle = ballIdle();
    for (const b of blocks) {
      if (!b.alive || !b.kind || b.kind === 'boss') continue;
      if (b.born && now < b.born + 300) continue;        // ещё влетает каскадом
      if (b.anim) { b.anim.t += dt; if (b.anim.t >= b.anim.dur) b.anim = null; }

      if (b.kind === 'ball') {
        if (b.shakeT > 0) b.shakeT = Math.max(0, b.shakeT - dt);
        if (!idle && b.shield > 0) {
          b.shield -= dt;
          if (b.shield <= 0) unshieldBall(b);
        }
        continue;
      }
      if (b.kind === 'teleport') {
        b.jt += dt;                                       // лёгкая дрожь — 5 раз в секунду
        if (b.jt >= 0.2) {
          b.jt = 0;
          b.jx = randFloat(-1.2, 1.2);
          b.jy = randFloat(-1.2, 1.2);
        }
        if (!idle) {
          b.nextJump -= dt;
          if (b.nextJump <= 0) {
            teleportMutant(b);
            b.nextJump = randFloat(10, 25);
          }
        }
        continue;
      }
      b.nextMove -= dt;
      if (b.nextMove > 0) continue;
      b.nextMove = moverInterval(b.kind);
      moveMutant(b);
    }
  }


  function loadLevel(forcedLayout) {
    root.UI && root.UI.hideOverlay();
    layoutId = (forcedLayout == null)
      ? root.Layouts.pick(stageNum, lastLayoutId, mode)
      : forcedLayout;
    lastLayoutId = layoutId;

    const st = stageDef(stageNum, mode);
    if (!expanding) setField(fieldWFor(st.cols));  // финал расширяется твином раньше
    const res = root.Layouts.generate(stageNum, layoutId, mode);
    gridCols = res.cols;
    gridRows = res.rows || CFG.ROWS;
    blocks = buildBlocks(res.grid, pickFillDir(st), res.mutants);
    levelTotal = res.total;
    levelStartScore = score;

    /* новый уровень: сценки и разлёты сбрасываются,
       щит / пухлая платформа / супер слон живут дальше */
    fx.ballScene = null; fx.restore = null;
    fx.gators = null; fx.fist = null; fx.bossBall = null;
    fx.smalls.length = 0;
    fx.cine = false;
    fx.erase = null;
    /* стена ада начинает заново на каждом 10-м этапе (во время
       падения Сатаны); щит доп. жизни — на обычном месте */
    fx.wall = null;
    extraShieldY = SHIELD_Y;

    /* ад: глюк неизвестных усилений срабатывает заново на каждом этапе —
       после первого переключения на стрелки */
    hellPw.fired = false; hellPw.t = 0; hellPw.done = false;

    /* адский финал: босс-Сатана ждёт над полем — падает после заполнения */
    boss = null; bossSeq = null; bossCells = null;
    bossLanded = false; satanDying = 0;
    satanCalm = false; satanCalmT = 0; satanCalmV0 = 0;
    if (st.boss && res.boss) {
      const a = res.boss;
      const bw = 5 * CFG.BLOCK_W + 4 * CFG.GAP_X;
      const bh = 3 * CFG.BLOCK_H + 2 * CFG.GAP_Y;
      boss = {
        x: CFG.FIELD_PAD_X + a.x * (CFG.BLOCK_W + CFG.GAP_X),
        y: CFG.FIELD_TOP + a.y * (CFG.BLOCK_H + CFG.GAP_Y),
        w: bw, h: bh, hp: 100, alive: false, kind: null,
        born: 0, flash: 0, gx: -1, gy: -1
      };
      let maxBorn = 0;
      for (const b of blocks) if (b.born) maxBorn = Math.max(maxBorn, b.born);
      bossSeq = { phase: 'fill', until: maxBorn + 480, t: 0 };
    }

    paddle.w = CFG.PADDLE_W; paddle.h = CFG.PADDLE_H; paddle.y = CFG.PADDLE_Y;
    paddle.x = (W - paddle.w) / 2;
    applyPaddleWidth();
    dockBall();
    state = 'playing';
    applyModeTheme();

    const last = stagesTotal();
    root.UI && root.UI.banner(
      `ЭТАП ${stageNum}/${last} — ${LAYOUT_INFO[layoutId].name.toUpperCase()}`,
      st.hell
        ? (st.boss ? `цель: ${st.target} очков · САТАНА ЖДЁТ`
            : `цель: ${st.target} очков` +
              (res.mutants.length ? ` · мутантов: ${res.mutants.length}` : ''))
        : (layoutId === 0
            ? `все блоки ×10 · ${st.cells * 10} очков`
            : `цель: ${st.target} ± ${st.tol} очков` +
              (st.wide ? ' · ФИНАЛ' : '') +
              (res.mutants.length ? ` · мутантов: ${res.mutants.length}` : '')),
      layoutId === 0
    );
    syncUI();
  }

  /* Сброс всех эффектов усилений — чистый лист для нового забега/меню */
  function resetFx() {
    fx.shield = null; fx.wall = null; extraShieldY = SHIELD_Y;
    fx.wide = 0; fx.superT = 0; fx.erase = null;
    fx.ballScene = null; fx.restore = null;
    fx.gators = null; fx.fist = null; fx.bossBall = null;
    fx.smalls.length = 0; fx.rings.length = 0;
    fx.cine = false;
    lastLockKey = null;
  }

  /* Полная очистка визуального состояния: канвас сразу перерисовывается
     пустым полем — между забегами не мелькают кадры прошлой попытки
     (замороженные частицы, щит, старые позиции платформы и шара). */
  function wipeCanvas() {
    resetFx();
    blocks = [];
    trail.length = 0; particles.length = 0; floaters.length = 0;
    paddle.w = CFG.PADDLE_W;
    paddle.x = (W - paddle.w) / 2;
    dockBall();
    if (ctx) {
      ctx.clearRect(0, 0, W, H);
      render(performance.now() / 1000);   // один чистый кадр: поле + платформа + шар
    }
  }

  function startRun(stage, forcedLayout, opts) {
    opts = opts || {};
    if (opts.mode === 'badass' || opts.mode === 'normal' || opts.mode === 'hell') {
      mode = opts.mode;
    }
    if (opts.regen != null) runRegen = !!opts.regen;
    stagesDone = 0; lastRegenGain = false;
    finalePending = false; expanding = null;
    boss = null; bossSeq = null; bossCells = null;
    bossLanded = false; satanDying = 0;
    satanCalm = false; satanCalmT = 0; satanCalmV0 = 0;
    score = 0; lives = CFG.LIVES;
    stageNum = stage || 1;
    lastLayoutId = null;
    record = loadRecord(mode);          // рекорд — свой для каждого режима
    runStartRecord = record; newRecordShown = false;
    applyModeTheme();
    resetFx();                          // эффекты прошлого забега не переносятся
    trail.length = 0; particles.length = 0; floaters.length = 0;
    root.UI && root.UI.hideOverlay();
    /* любой старт забега показывает игровые элементы (в обычном потоке
       класс снимает сиквенс «Играть», здесь — для отладочных запусков) */
    document.body.classList.remove('in-menu');
    loadLevel(forcedLayout);
  }

  function nextLevel() {
    if (expanding) return;            // поле ещё расширяется — новых переходов не делаем
    /* ад, переход 3 → 4: поле расширяется с 9 до 13 колонн
       (таким и останется до 9-го этапа включительно) */
    if (mode === 'hell' && !finalePending && stageNum === 3) {
      stageNum = 4;
      root.UI && root.UI.closeFinaleWindow();
      /* чистим холст ДО расширения — как в финальных переходах */
      blocks = [];
      trail.length = 0; particles.length = 0; floaters.length = 0;
      fx.ballScene = null; fx.restore = null;
      fx.gators = null; fx.fist = null; fx.bossBall = null;
      fx.smalls.length = 0; fx.rings.length = 0;
      fx.cine = false; fx.erase = null;
      dockBall();
      expandField(1.25, 13, () => loadLevel());
      return;
    }
    if (finalePending) {
      /* финал режима: окно уходит фейдом (0,5 с), поле плавно
         расширяется и заполняется блоками — Badass: 13 колонок и цель 600,
         ад: 19 колонн × 8 строк и Сатана с целью 1000 */
      finalePending = false;
      const isHell = mode === 'hell';
      stageNum = isHell ? 10 : 6;
      root.UI && root.UI.closeFinaleWindow();
      /* чистим холст ДО расширения: остатки прошлого этапа (недобитые блоки,
         зависшие частицы, трейл, сценки) не должны висеть на поле,
         пока оно растёт. Щит/пухлая платформа/слон живут дальше. */
      blocks = [];
      trail.length = 0; particles.length = 0; floaters.length = 0;
      fx.ballScene = null; fx.restore = null;
      fx.gators = null; fx.fist = null; fx.bossBall = null;
      fx.smalls.length = 0; fx.rings.length = 0;
      fx.cine = false; fx.erase = null;
      dockBall();
      expandField(1.25, isHell ? 19 : 13, () => loadLevel());
      return;
    }
    stageNum++;
    loadLevel();
  }

  /* Возврат в главное меню (из паузы, после поражения или победы).
     Заодно полностью очищаем канвас — под меню не должно остаться
     ничего от прошлой попытки. Выход из ада завершает его сессию. */
  function backToMenu() {
    state = 'menu';
    finalePending = false; expanding = null;
    const wasHell = mode === 'hell';
    mode = 'normal';
    boss = null; bossSeq = null; bossCells = null;
    bossLanded = false; satanDying = 0;
    satanCalm = false; satanCalmT = 0; satanCalmV0 = 0;
    hellPw.fired = false; hellPw.t = 0; hellPw.done = false;
    applyModeTheme();
    setField(CFG.CANVAS_W);
    wipeCanvas();
    if (wasHell && root.Hell) root.Hell.exitSession();
    root.UI && root.UI.showOverlay('menu');
    syncUI();
  }

  /* ======================= Механика ======================= */

  /* уровень огня шара в аду: 0 — нет, 1 — с 4-го этапа, 2 — на 10-м */
  function fireLevel() {
    if (mode !== 'hell') return 0;
    return stageNum >= 10 ? 2 : (stageNum >= 4 ? 1 : 0);
  }

  function launch() {
    if (!ball.docked) return;
    /* глюк ещё появляется на неизвестных усилениях — шар ждать обязан */
    if (hellPwLive()) return;
    /* каждый запуск: новая случайная скорость и направление;
       в аду шар быстрее, на 4-м и 10-м этапах — ещё быстрее.
       Сатана уже повержен — шар летит спокойно: 1,5× обычной */
    let s = CFG.BASE_SPEED * Math.pow(1 + CFG.SPEED_PER_STAGE, stageNum - 1);
    if (mode === 'hell') {
      if (satanCalm) {
        s = CALM_TARGET * randFloat(0.97, 1.06);
        satanCalmV0 = s;              // новая точка отсчёта замедления
      } else {
        s *= stageNum >= 10 ? 1.42 : (stageNum >= 4 ? 1.27 : 1.14);
        s *= randFloat(0.88, 1.15);
      }
    } else {
      s *= randFloat(0.88, 1.15);
    }
    const a = randFloat(-1, 1) * CFG.LAUNCH_MAX_ANGLE;
    ball.speed = s;
    ball.vx = s * Math.sin(a);
    ball.vy = -s * Math.cos(a);
    ball.docked = false;
    ball.autoLaunch = false;
    autoDir = 0;                      // автопилот заново выберет знак
    /* и новая карта отскока платформы: угол в самом центре 5–10°
       (случайный знак) плюс меняющаяся форма градиента к краям */
    ball.centerA = randFloat(CFG.CENTER_BOUNCE_MIN, CFG.CENTER_BOUNCE_MAX) *
                   (Math.random() < 0.5 ? -1 : 1);
    ball.gradP = randFloat(CFG.GRADIENT_P_MIN, CFG.GRADIENT_P_MAX);
    trail.length = 0;
  }

  function tryLaunch() {
    if (bossSeq) return;                 // Сатана ещё не приземлился
    if (hellPwLive()) return;            // глюк ещё появляется
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
      if (mode === 'hell') hellExitLocked = false;   // попытка состоялась — выход открыт
      root.UI && root.UI.showOverlay('gameOver');
    } else {
      dockBall();
    }
  }

  function addScore(n) {
    score += n;
    if (score > record) {
      record = score;
      saveRecord(record, mode);
      if (!newRecordShown && runStartRecord > 0 && score > runStartRecord) {
        newRecordShown = true;
        floaters.push({ x: W / 2, y: H * 0.42, text: 'НОВЫЙ РЕКОРД!', t: 0, life: 1.5, color: '#7dff5a' });
      }
    }
    syncUI();
  }

  function hitBlock(b, obj) {
    /* шароблок под щитом: урона нет — только отскок, белые искры и тряска */
    if (b.kind === 'ball' && b.shield > 0) {
      b.shakeT = 0.25;
      const px = obj ? obj.x : ball.x, py = obj ? obj.y : ball.y;
      spawnBurst(px, py, 6, '255,255,255');
      return;
    }
    /* босс-Сатана: крит пробивает лишь 5, обычный удар — 1 */
    if (b.kind === 'boss') {
      const sup = fx.superT > 0;
      const crit = Math.random() < (sup ? 1 : (MODES[mode].crit != null ? MODES[mode].crit : CFG.CRIT_CHANCE));
      const dmg = crit ? 5 : 1;
      b.hp -= dmg;
      addScore(dmg);
      b.flash = 1;
      if (crit) {
        floaters.push({ x: b.x + b.w / 2, y: b.y + b.h * 0.28, text: 'КРИТ! +5', t: 0, life: 1.0, color: sup ? '#ff5c7a' : '#ffd24d' });
        shake(7, 0.3);
      } else {
        shake(2.5, 0.12);
      }
      if (b.hp <= 0) satanDefeated();
      checkLevelDone();
      return;
    }
    const sup = fx.superT > 0;                       // супер слон: 100% крит
    const critChance = sup ? 1 : (MODES[mode].crit != null ? MODES[mode].crit : CFG.CRIT_CHANCE);
    const crit = Math.random() < critChance;
    const colStr = blockColorStr(b);
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
      else {
        b.flash = 1;
        /* телепорт уходит от шара на любое свободное место */
        if (b.kind === 'teleport') teleportMutant(b);
      }
    }
    checkLevelDone();
  }

  /* урон от усилений (без критов): очки = снятая прочность.
     Щит шароблока держит любой урон — ломается только glob.dtr.
     Босса усиления не задевают — его ломает только шар. */
  function damageBlock(b, n) {
    if (!b.alive || n <= 0 || b.kind === 'boss') return;
    if (b.kind === 'ball' && b.shield > 0) return;
    const colStr = blockColorStr(b);
    const actual = Math.min(n, b.hp);
    b.hp -= n;
    b.flash = 1;
    addScore(actual);
    if (b.hp <= 0) kill(b, colStr, false);
  }

  function checkLevelDone() {
    if (state !== 'playing') return;
    /* финал ада: Сатана должен быть повержен, а поле — зачищено
       полностью (остальные блоки после его смерти — уже не отвлечение,
         а сама победа) */
    if (mode === 'hell' && stageNum === stagesTotal()) {
      if (boss && !boss.alive && !blocks.some(q => q.alive)) levelComplete();
      return;
    }
    if (!blocks.some(q => q.alive)) levelComplete();
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

  /* ======================= Босс-Сатана (финал ада) =======================

     Последовательность: поле заполняется каскадом → тень накрывает
     большую часть поля (1,3 с, нарастает) → Сатана падает (0,85 с,
     с ускорением) → удар: каша тряски, все жертвенные блоки под ним
     ломаются с зачислением очков, таблица усилений и поле
     окончательно вспыхивают — и только теперь можно запускать шар.
     Пока Сатана жив — обводки остальных блоков ярко-красные; после
     его смерти блоки трусятся и теряют половину текущей прочности,
     очки зачисляются. */

  function updateBossSeq(dt) {
    if (!bossSeq || !boss) return;
    bossSeq.t += dt;
    if (bossSeq.phase === 'fill') {
      if (performance.now() >= bossSeq.until) {
        bossSeq.phase = 'shadow';
        bossSeq.t = 0;
      }
    } else if (bossSeq.phase === 'shadow') {
      if (bossSeq.t >= 1.3) {
        bossSeq.phase = 'fall'; bossSeq.t = 0;
        startHellWall();                  // стена разворачивается во время падения
      }
    } else if (bossSeq.phase === 'fall') {
      if (bossSeq.t >= 0.85) bossImpact();
    }
  }

  function bossImpact() {
    bossSeq = null;
    boss.alive = true;
    boss.kind = 'boss';
    blocks.push(boss);
    /* живой босс занимает всю зону 5×3 — мутанты не заходят */
    const a = { x: Math.floor((gridCols - 5) / 2), y: 0, w: 5, h: 3 };
    bossCells = new Set();
    for (let y = a.y; y < a.y + a.h; y++)
      for (let x = a.x; x < a.x + a.w; x++) bossCells.add(x + ',' + y);
    /* сразу ломает всё под собой (жертвенные блоки, ровно 100 прочности) */
    for (const b of blocks) {
      if (!b.alive || b === boss) continue;
      if (b.gy < a.y + a.h && b.gx >= a.x && b.gx < a.x + a.w) {
        const pts = b.hp;
        b.hp = 0;
        kill(b, blockColorStr(b), false);
        addScore(pts);
      }
    }
    shake(16, 1.0);                          // куча тряски
    bigBoomAt(boss.x + boss.w / 2, boss.y + boss.h / 2);
    for (let i = 0; i < 3; i++) {
      fx.rings.push({
        x: boss.x + randFloat(40, boss.w - 40), y: boss.y + boss.h / 2,
        r0: 6, r1: 120 + i * 40, t: -i * 0.1, life: 0.6,
        color: i % 2 ? '255,120,60' : '255,220,200'
      });
    }
    bossLanded = true;
    applyModeTheme();                        // поле и таблица вспыхивают
    floaters.push({ x: W / 2, y: H * 0.4, text: 'САТАНА ПРОБУДИЛСЯ', t: 0, life: 1.6, color: '#ff4a3a', strong: true });
    syncUI();
  }

  /* --- стена ада: разворачивание и жизнь 3 слоёв + сдвиг щита --- */

  function startHellWall() {
    if (fx.wall || mode !== 'hell') return;
    const layers = [];
    for (let i = 0; i < 3; i++) {
      /* сверху вниз: верхний слой первым, до следующего — 0,33 с */
      layers.push({
        y: SHIELD_Y - (2 - i) * WALL_GAP,
        state: 'grow', t: -i * WALL_STAGGER, dieT: 0, dead: false
      });
    }
    fx.wall = { layers, shift: null, rise: null, risen: false };
    /* действующий щит доп. жизни заранее уходит вниз — под новые слои;
     * только после его сдвига слои начинают разворачиваться */
    if (fx.shield) {
      fx.wall.shift = { t: 0, dur: WALL_SHIFT, from: extraShieldY, to: SHIELD_Y + WALL_GAP };
      for (const L of layers) L.t -= WALL_SHIFT;
    }
  }

  function updateHellWall(dt) {
    const wl = fx.wall;
    if (!wl) return;
    if (wl.shift) {
      wl.shift.t += dt;
      const k = Math.min(1, wl.shift.t / wl.shift.dur);
      extraShieldY = lerp(wl.shift.from, wl.shift.to, wallEase(k));
      if (k >= 1) wl.shift = null;
    }
    for (const L of wl.layers) {
      if (L.dead) continue;
      if (L.state === 'grow') {
        L.t += dt;
        if (L.t >= WALL_GROW) { L.t = WALL_GROW; L.state = 'idle'; }
      } else if (L.state === 'die') {
        L.dieT += dt;
        if (L.dieT >= WALL_DIE) L.dead = true;
      }
    }
    /* слоёв не осталось — щит доп. жизни возвращается на обычное место
       (при победе это происходит после глюк-ухода стены) */
    if (!wl.risen && wl.layers.every(L => L.dead)) {
      wl.risen = true;
      if (fx.shield && Math.abs(extraShieldY - SHIELD_Y) > 0.5) {
        wl.rise = { t: 0, dur: WALL_SHIFT, from: extraShieldY, to: SHIELD_Y };
      }
    }
    if (wl.rise) {
      wl.rise.t += dt;
      const k = Math.min(1, wl.rise.t / wl.rise.dur);
      extraShieldY = lerp(wl.rise.from, wl.rise.to, wallEase(k));
      if (k >= 1) fx.wall = null;
    } else if (wl.risen && !fx.shield) {
      fx.wall = null;                    // слоёв нет и щита нет — стена ушла совсем
    }
  }

  /* Сатана повержен: взрыв, остальные блоки трусятся и теряют
     половину текущей прочности (очки зачисляются) — но уровень
     этим НЕ заканчивается: победа придёт только с полной зачисткой
     оставшихся блоков (короткая пауза satanDying — только тряска).
     Дальше 10 секунд «спокойствия»: шар замедляется до 1,5×
     обычной скорости и постепенно теряет огненный след, свечение
     вокруг поля стихает до силы этапов 1–3 */
  function satanDefeated() {
    if (!boss.alive) return;
    boss.alive = false;
    boss.hp = 0;
    bossCells = null;
    satanDying = 1.15;
    satanCalm = true; satanCalmT = 0;
    satanCalmV0 = ball.docked ? CALM_TARGET : ball.speed;
    bigBoomAt(boss.x + boss.w / 2, boss.y + boss.h / 2);
    for (let i = 0; i < 4; i++) {
      boomAt(boss.x + randFloat(30, boss.w - 30), boss.y + randFloat(20, boss.h - 20), 14);
    }
    shake(18, 1.2);
    for (const b of blocks) {
      if (!b.alive || b === boss) continue;
      const nh = Math.max(1, Math.ceil(b.hp / 2));
      if (nh < b.hp) {
        addScore(b.hp - nh);
        b.hp = nh;
        b.flash = 1;
      }
    }
    floaters.push({ x: W / 2, y: H * 0.34, text: 'САТАНА ПОВЕРЖЕН', t: 0, life: 1.6, color: '#ffe9e5', strong: true });
    /* победа теперь — только полная зачистка оставшихся блоков */
    floaters.push({ x: W / 2, y: H * 0.47, text: 'ТЕПЕРЬ — ДОБЕЙ ОСТАВШИЕСЯ БЛОКИ', t: 0, life: 2.4, color: '#ff8f7a', strong: true });
    applyModeTheme();                        // обводки возвращаются к обычным
    /* стена ада: оставшиеся слои уходят глюк-эффектом — сверху вниз;
       пауза между началами: 0,33 с если все 3, 0,5 с если 2 */
    if (fx.wall) {
      const left = fx.wall.layers.filter(L => !L.dead);
      const delay = left.length >= 3 ? 0.33 : (left.length === 2 ? 0.5 : 0);
      left.forEach((L, i) => { L.state = 'die'; L.dieT = -delay * i; });
    }
  }

  function levelComplete() {
    if (state !== 'playing') return;
    /* усиления, живущие «этапами», тикают здесь; щит дополнительной
       жизни в адском финале не списывается — он переживает окно
       победы и виден за ним (уходит только при выходе в меню) */
    if (fx.shield && !(mode === 'hell' && stageNum >= stagesTotal())) {
      fx.shield.stages--;
      if (fx.shield.stages <= 0) fx.shield = null;
    }
    if (fx.wide > 0) { fx.wide--; if (fx.wide <= 0) applyPaddleWidth(); }

    /* попытка пройти уровень состоялась — из ада теперь можно выйти */
    if (mode === 'hell') hellExitLocked = false;

    /* регенерация: каждые два пройденных этапа +1 жизнь (до максимума).
       В аду это нигде не показывается — значение регенерации осталось
       тем, что было выставлено до перехода, но остаётся загадкой */
    stagesDone++;
    lastRegenGain = false;
    if (runRegen && stagesDone % 2 === 0 && lives < CFG.LIVES) {
      lives++;
      if (mode !== 'hell') {
        lastRegenGain = true;
        floaters.push({ x: W / 2, y: H * 0.5, text: 'РЕГЕНЕРАЦИЯ: +1 ЖИЗНЬ', t: 0, life: 1.6, color: '#7dff5a' });
        syncUI();
      }
    }

    const last = stagesTotal();
    if (stageNum >= last) {
      state = 'victory';
      /* полное прохождение обычного режима открывает Badass */
      badassJustUnlocked = false;
      if (mode === 'normal' && !isBadassUnlocked()) {
        setBadassUnlocked();
        badassJustUnlocked = true;
      }
      /* финальный текст ада — над окном победы */
      if (mode === 'hell') root.UI && root.UI.hellVictory && root.UI.hellVictory();
      else root.UI && root.UI.showOverlay('victory');
    } else if (mode === 'badass' && stageNum === 5) {
      /* пройден 5-й из 6: «Приготовься к финалу», окно этапа появится
         вместе с сообщением — см. UI.beginFinale */
      state = 'levelComplete';
      finalePending = true;
      root.UI && root.UI.beginFinale(false);
    } else if (mode === 'hell' && stageNum === 9) {
      /* пройден 9-й из 10: подсказка про фокус на Сатане */
      state = 'levelComplete';
      finalePending = true;
      root.UI && root.UI.beginFinale(true);
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
    } else if (state === 'menu') {
      /* Esc в меню новой игры — назад, к главному меню */
      if (root.UI && root.UI.handleEsc && root.UI.handleEsc()) { syncUI(); }
    }
    syncUI();
  }

  function toggleControlMode() {
    if (mode === 'hell') {
      /* идёт глюк неизвестных усилений — на мышь switching запрещён */
      if (hellPwLive() && controlMode === 'keys') {
        floaters.push({ x: W / 2, y: H * 0.46, text: 'СМОТРИ.', t: 0, life: 0.9, color: '#ff4a3a', strong: true });
        shake(4, 0.2);
        return;
      }
      /* первое переключение на стрелки на этапе — с задержкой глюк
         накрывает неизвестные усиления */
      if (controlMode === 'mouse' && !hellPw.fired) {
        hellPw.fired = true;
        hellPw.t = -0.55;                     // небольшая задержка
        hellPw.done = false;
      }
    }
    controlMode = (controlMode === 'mouse') ? 'keys' : 'mouse';
    if (canvas) canvas.classList.toggle('keys-mode', controlMode === 'keys');
    syncUI();
  }

  /* ======================= Физика ======================= */

  /* отражение от платформы (центр 5–10°, край до 50°);
     автопилот ловит шар центром и на КАЖДОМ отскоке даёт новый
     случайный угол 5–30° со сменой направления — шар прочёсывает
     поле заметно разными зигзагами */
  let autoDir = 0;                     // текущее направление автопилота
  const autoBounces = [];              // отладка: знаки последних отскоков
  const autoAngles = [];               // отладка: углы последних отскоков (°)
  const AUTO_A_MIN = 5 * Math.PI / 180;
  const AUTO_A_MAX = 30 * Math.PI / 180;
  function paddleBounce() {
    if (ball.vy <= 0) return;
    const cx = paddle.x + paddle.w / 2;
    if (ball.y + R >= paddle.y && ball.y - R <= paddle.y + paddle.h &&
        ball.x >= paddle.x - R && ball.x <= paddle.x + paddle.w + R) {
      if (autopilot) {
        /* первый отскок — случайный знак, дальше чередуется;
           угол — новый случайный из 5–30° на каждом отскоке */
        autoDir = autoDir ? -autoDir : (Math.random() < 0.5 ? -1 : 1);
        autoBounces.push(autoDir);               // отладка
        if (autoBounces.length > 12) autoBounces.shift();
        const ang = randFloat(AUTO_A_MIN, AUTO_A_MAX);
        autoAngles.push(Math.round(ang * 180 / Math.PI));
        if (autoAngles.length > 12) autoAngles.shift();
        const a = autoDir * ang;
        ball.vx = ball.speed * Math.sin(a);
        ball.vy = -ball.speed * Math.cos(a);
      } else {
        const off = clamp((ball.x - cx) / (paddle.w / 2), -1, 1);
        const ao = Math.pow(Math.abs(off), ball.gradP);
        const a = ball.centerA * (1 - ao) + Math.sign(off || 1) * ao * CFG.PADDLE_MAX_ANGLE;
        ball.vx = ball.speed * Math.sin(a);
        ball.vy = -ball.speed * Math.cos(a);
      }
      ball.y = paddle.y - R - 0.5;
      paddle.glowT = 1;
    }
  }

  /* защитные линии снизу: шар отбивается, как от платформы.
     Стена ада ловит верхним живым слоем (каждый слой одноразовый),
     щит дополнительной жизни стоит под ней — в самом низу стека.
     Проверка идёт по пересечению Y без верхнего предела: на скорости
     10-го этапа шар за кадр пролетает больше собственной высоты */
  function shieldBounce(sy) {
    const off = clamp((ball.x - W / 2) / (W / 2 - 24), -1, 1);
    const ao = Math.pow(Math.abs(off), ball.gradP);
    const a = ball.centerA * (1 - ao) + Math.sign(off || 1) * ao * CFG.PADDLE_MAX_ANGLE;
    ball.vx = ball.speed * Math.sin(a);
    ball.vy = -ball.speed * Math.cos(a);
    ball.y = sy - R - 0.5;
  }

  function shieldCheck() {
    if (ball.vy <= 0) return;
    /* стена ада: слои стоят друг под другом, удар принимает самый
       верхний живой — ниже шар просто не долетает */
    if (fx.wall) {
      for (const L of fx.wall.layers) {
        if (L.dead || L.state === 'die' || L.t < 0.3) continue;
        if (ball.y + R >= L.y) {
          shieldBounce(L.y);
          L.dead = true;
          const left = fx.wall.layers.filter(q => !q.dead).length;
          fx.rings.push({ x: ball.x, y: L.y, r0: 4, r1: 70, t: 0, life: 0.45, color: '255,110,60' });
          for (let i = 0; i < 16 && particles.length < 380; i++) {
            particles.push({
              x: ball.x, y: L.y, vx: randFloat(-180, 180), vy: randFloat(-280, -40),
              t: 0, life: randFloat(0.3, 0.6), size: randFloat(1.5, 3.5),
              color: Math.random() < 0.5 ? '255,110,60' : '255,220,180',
              noGrav: Math.random() < 0.4        // часть искр всплывает, как огонь
            });
          }
          floaters.push({
            x: W / 2, y: H * 0.62,
            text: left > 0 ? 'СТЕНА АДА: СЛОЁВ — ' + left : 'СТЕНА АДА ПАЛА',
            t: 0, life: 1.2, color: '#ff8f7a'
          });
          return;
        }
      }
    }
    /* щит дополнительной жизни — одноразовый */
    if (!fx.shield) return;
    const sy = extraShieldY;
    if (ball.y + R >= sy) {
      shieldBounce(sy);
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
    /* ад: 10 секунд после победы над Сатаной шар плавно замедляется
       до 1,5× обычной скорости (направление сохраняется) */
    if (satanCalm && satanCalmT < CALM_DUR) {
      satanCalmT += dt;
      if (!ball.docked && !fx.ballScene && !fx.restore && !fx.gators && !fx.fist) {
        const k = Math.min(1, satanCalmT / CALM_DUR);
        const s = lerp(satanCalmV0, CALM_TARGET, k);
        const cur = Math.hypot(ball.vx, ball.vy) || 1;
        ball.speed = s;
        ball.vx *= s / cur;
        ball.vy *= s / cur;
      }
    }

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

    /* мутанты: ходы, телепорты, щиты шароблоков */
    updateMutants(dt);

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
    hitBlock(best, obj);
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
    if (mode === 'hell') {
      /* неизвестные усиления в аду перекрыты глюком */
      if (Powers && Powers.defs[id] && Powers.defs[id].rarity === 'unknown') return false;
      /* на 10-м этапе таблица усилений и её место пылает — больше
         использовать нельзя */
      if (stageNum === stagesTotal()) return false;
    }
    if (id === 'life' && fx.shield) return false;       // пока слой жив — снова нельзя
    if (id === 'paddle' && fx.wide > 0) return false;   // пухлая платформа: 3 этапа действия — снова нельзя
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

  /* --- босс шаров: жирный шар (диаметр 4 блока, 5 отскоков,
     летит в полтора раза быстрее — эпический урон по площади) --- */
  const BOSS_WALL_BOUNCES = 5;          // отскоков от стен, потом уходит с экрана

  function spawnBossBall() {
    const sx = randFloat(W * 0.2, W * 0.8), sy = -142;   // старт за экраном
    const speed = randFloat(510, 690);                   // ×1,5 к прежней
    const d = Math.hypot(ball.x - sx, ball.y - sy) || 1;
    fx.bossBall = {
      x: sx, y: sy, r: 122,                              // диаметр 4 блока
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
    /* супер слон: время идёт только в игре (в паузе стоит) и пока
       шар в движении — на платформе/в сценке таймер замирает */
    if (fx.superT > 0 && !ballIdle()) fx.superT = Math.max(0, fx.superT - dt);

    /* восстановление шара после усилений */
    if (fx.restore) {
      fx.restore.t += dt;
      if (fx.restore.t >= fx.restore.delay) {
        fx.restore = null;
        dockBall(true);        // над платформой + авто-запуск через 3 с
      }
    }

    /* glob.dtr: каждые 0.5 с у каждого блока снимается 1 прочность;
       щиты шароблоков ломаются мгновенно — блок сразу становится обычным */
    if (fx.erase) {
      fx.erase.t += dt;
      if (fx.erase.t >= fx.erase.next) {
        fx.erase.next += 0.5; fx.erase.tick++;
        for (const b of blocks) {
          if (!b.alive) continue;
          if (b.kind === 'ball' && b.shield > 0) { unshieldBall(b); continue; }
          damageBlock(b, 1);
          if (particles.length < 360) {
            particles.push({
              x: b.x + b.w / 2, y: b.y + b.h / 2,
              vx: randFloat(-40, 40), vy: randFloat(-70, -10),
              t: 0, life: randFloat(0.25, 0.5),
              size: randFloat(1, 2.4), color: blockColorStr(b)
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

    if (B.bounces < BOSS_WALL_BOUNCES) {
      if (B.life > 7) {                            // не засиживаться на экране
        const sp = Math.hypot(B.vx, B.vy) || 570;
        B.vx = (Math.random() < 0.5 ? -1 : 1) * sp * 0.4;
        B.vy = -sp;
        B.bounces = BOSS_WALL_BOUNCES;
      } else {
        let hitWall = false;
        if (B.x < B.r && B.vx < 0) { B.x = B.r; B.vx = Math.abs(B.vx); hitWall = true; }
        else if (B.x > W - B.r && B.vx > 0) { B.x = W - B.r; B.vx = -Math.abs(B.vx); hitWall = true; }
        if (B.y < B.r && B.vy < 0) { B.y = B.r; B.vy = Math.abs(B.vy); hitWall = true; }
        else if (B.y > H - B.r && B.vy > 0) { B.y = H - B.r; B.vy = -Math.abs(B.vy); hitWall = true; }
        if (hitWall) {
          B.bounces++;
          shake(9, 0.4);                           // солидно трясёт экран
          /* отскок: память очищается — шар снова может крушить любые блоки */
          B.hit.clear();
          if (B.bounces >= BOSS_WALL_BOUNCES) {    // последний отскок — уходит с экрана
            const sp = Math.hypot(B.vx, B.vy) || 570;
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
    if (boss && boss.flash > 0) boss.flash = Math.max(0, boss.flash - dt * 5);
    if (paddle.glowT > 0) paddle.glowT = Math.max(0, paddle.glowT - dt * 3);
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t >= p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.noGrav) { p.vy -= 90 * dt; }              // язычки пламени всплывают
      else p.vy += 520 * dt;
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t += dt;
      if (f.t >= f.life) { floaters.splice(i, 1); continue; }
      /* в аду подписи не плывут наверх — трусятся 5 раз в секунду */
      if (mode === 'hell') {
        f.tick = (f.tick || 0) + dt;
        if (f.tick >= 0.2) {
          f.tick = 0;
          const amp = f.strong ? 7 : 2;
          f.jx = randFloat(-amp, amp);
          f.jy = randFloat(-amp * 0.6, amp * 0.6);
        }
      }
    }
    for (let i = fx.rings.length - 1; i >= 0; i--) {
      fx.rings[i].t += dt;
      if (fx.rings[i].t >= fx.rings[i].life) fx.rings.splice(i, 1);
    }
    const moving = !ball.docked && state === 'playing' &&
        !fx.ballScene && !fx.restore && !fx.gators && !fx.fist;
    if (moving) {
      trail.push({ x: ball.x, y: ball.y });
      const fl = fireLevel();
      const fk = fireFadeK();                  // после Сатаны огонь гаснет
      const cap = Math.round(14 + (fl >= 2 ? 12 : 6) * fk);
      while (trail.length > cap) trail.shift();
      /* огненный шар роняет искры (реже — пока след гаснет) */
      if (fl > 0 && particles.length < 360 &&
          Math.random() < (fl === 2 ? 0.55 : 0.35) * fk) {
        particles.push({
          x: ball.x + randFloat(-3, 3), y: ball.y + randFloat(-2, 4),
          vx: randFloat(-26, 26), vy: randFloat(-30, 20),
          t: 0, life: randFloat(0.25, 0.5), size: randFloat(1.6, 3.2),
          color: Math.random() < 0.5 ? '255,170,60' : '255,80,30',
          noGrav: true
        });
      }
    }
  }

  /* ======================= Отрисовка ======================= */

  function neon(t, ph) {
    ph = ph || 0;
    const k = 0.5 + 0.5 * Math.sin(t * 2.2 + ph);
    return [
      Math.round(lerp(PAL.a[0], PAL.b[0], k)),
      Math.round(lerp(PAL.a[1], PAL.b[1], k)),
      Math.round(lerp(PAL.a[2], PAL.b[2], k))
    ];
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

  /* тело обычного блока (без вспышки — она рисуется поверх в drawBlocks) */
  function drawBlockBody(b, x, y, w, h) {
    switch (b.kind) {
      case 'teleport':  drawTeleportBody(b, x, y, w, h); return;
      case 'updown':    drawMoverBody(b, x, y, w, h, true);  return;
      case 'rightleft': drawMoverBody(b, x, y, w, h, false); return;
      case 'snake':     drawSnakeBody(b, x, y, w, h); return;
      case 'ball':      drawBallBody(b, x, y, w, h); return;
      case 'boss':      drawBossBody(x, y, w, h, b.hp, performance.now() / 1000, b.flash); return;
    }
    const col = BLOCK_COLORS[b.hp] || BLOCK_COLORS[1];
    const light = b.hp <= 5; // 1–5: чёрная обводка/цифра; 6–10: белая
    rr(x, y, w, h, 5);
    ctx.fillStyle = `rgb(${col})`;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(x + 3, y + 2.5, w - 6, 3.5);
    ctx.lineWidth = 2;
    ctx.strokeStyle = light ? 'rgba(0,0,0,.92)' : 'rgba(255,255,255,.95)';
    rr(x, y, w, h, 5);
    ctx.stroke();
    ctx.fillStyle = light ? '#000' : '#fff';
    if (w > 26) ctx.fillText(String(b.hp), x + w / 2, y + h / 2 + 1);
  }

  /* телепорт: цвет = оттенок + яркость по прочности, обводка
     ярко-фиолетовая и толще обычной, цифры нет — жизни скрыты */
  function drawTeleportBody(b, x, y, w, h) {
    const L = [16, 26, 37, 52][clamp(b.hp, 1, 4) - 1];
    ctx.save();
    ctx.shadowColor = 'rgba(176,98,255,.75)';
    ctx.shadowBlur = 9 * glowK;
    rr(x, y, w, h, 5);
    ctx.fillStyle = `hsl(${Math.round(((b.hue % 360) + 360) % 360)},68%,${L}%)`;
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    ctx.fillRect(x + 3, y + 2.5, w - 6, 3.5);
    ctx.lineWidth = 3;                              // толще обычной (2)
    ctx.strokeStyle = 'rgba(190,110,255,.95)';
    rr(x, y, w, h, 5);
    ctx.stroke();
  }

  /* вверх-вниз / вправо-влево: градиент цветов блока hp-1 -> hp
     (у прочности 1 край — тёмно-серый), обводка/цифра: 1–5 чёрные,
     на максимуме (6) — белые */
  function drawMoverBody(b, x, y, w, h, vertical) {
    const cHi = BLOCK_COLORS[clamp(b.hp, 1, 10)] || BLOCK_COLORS[1];
    const cLo = b.hp > 1 ? (BLOCK_COLORS[b.hp - 1] || BLOCK_COLORS[1]) : '42,42,50';
    const g = vertical
      ? ctx.createLinearGradient(x, y + h, x, y)     // снизу вверх: низ hp-1, верх hp
      : ctx.createLinearGradient(x, y, x + w, y);    // слева направо: лево hp-1, право hp
    g.addColorStop(0, `rgb(${cLo})`);
    g.addColorStop(1, `rgb(${cHi})`);
    rr(x, y, w, h, 5);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(x + 3, y + 2.5, w - 6, 3.5);
    const light = b.hp < 6;
    ctx.lineWidth = 2;
    ctx.strokeStyle = light ? 'rgba(0,0,0,.92)' : 'rgba(255,255,255,.95)';
    rr(x, y, w, h, 5);
    ctx.stroke();
    ctx.fillStyle = light ? '#000' : '#fff';
    if (w > 26) ctx.fillText(String(b.hp), x + w / 2, y + h / 2 + 1);
  }

  /* блоко-змей: зелёный градиент «хвост -> голова» и ромбовые чешуйки,
     вся текстура повёрнута по направлению последнего хода (по часовой);
     цифра белая поверх, обводка лайм. Тело всегда во всю клетку —
     повёрнутая на 90° текстура выступает за швы рядов (как и было
     задумано изначально), а красная обводка Сатаны повторяет форму
     тела через traceBlockShape() */
  function drawSnakeBody(b, x, y, w, h) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(b.angle);
    const hw = w / 2, hh = h / 2;
    const g = ctx.createLinearGradient(-hw, 0, hw, 0);
    g.addColorStop(0, 'rgb(24,102,44)');
    g.addColorStop(1, 'rgb(148,255,118)');
    rr(-hw, -hh, w, h, 5);
    ctx.fillStyle = g;
    ctx.fill();
    for (let i = 0; i < 4; i++) {                   // чешуйки-ромбы
      const cx = -hw + 10 + i * (w - 20) / 3;
      const cy = (i % 2 ? 5 : -5);
      ctx.beginPath();
      ctx.moveTo(cx, cy - 4.4);
      ctx.lineTo(cx + 3.4, cy);
      ctx.lineTo(cx, cy + 4.4);
      ctx.lineTo(cx - 3.4, cy);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.22)' : 'rgba(6,40,16,.3)';
      ctx.fill();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(150,255,60,.95)';
    rr(-hw, -hh, w, h, 5);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fff';
    if (w > 26) ctx.fillText(String(b.hp), x + w / 2, y + h / 2 + 1);
  }

  /* контур блока по его фактической форме: змей — повёрнутое тело,
     остальные — скруглённый прямоугольник клетки. Путь строится в
     момент вызова (координаты фиксируются с текущим поворотом),
     поэтому обводка Сатаны и вспышка попадают точно по телу блока */
  function traceBlockShape(b, x, y, w, h) {
    if (b.kind === 'snake') {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(b.angle);
      rr(-w / 2, -h / 2, w, h, 5);
      ctx.restore();
    } else {
      rr(x, y, w, h, 5);
    }
  }

  /* шароблок: серебристый корпус с пульсирующим щитом,
     вместо прочности — таймер до его спадения */
  function drawBallBody(b, x, y, w, h) {
    const t = performance.now() / 1000;
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#f6f9ff');
    g.addColorStop(0.55, '#c9d6e8');
    g.addColorStop(1, '#93a5bf');
    rr(x, y, w, h, 5);
    ctx.fillStyle = g;
    ctx.fill();
    const pulse = b.shield > 0 ? 0.5 + 0.5 * Math.sin(t * 5) : 0;
    ctx.save();
    ctx.shadowColor = 'rgba(205,232,255,.9)';
    ctx.shadowBlur = (7 + 6 * pulse) * glowK;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = `rgba(255,255,255,${(0.7 + 0.3 * pulse).toFixed(3)})`;
    rr(x, y, w, h, 5);
    ctx.stroke();
    ctx.restore();
    if (b.shield > 0 && w > 26) {
      ctx.fillStyle = '#12203a';
      ctx.fillText(String(Math.ceil(b.shield)), x + w / 2, y + h / 2 + 1);
    }
  }

  function drawBlocks() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 13px Arial, sans-serif';
    const now = performance.now();
    const satanLive = !!(boss && boss.alive);
    for (const b of blocks) {
      if (!b.alive) continue;
      if (b.born && now < b.born) continue;
      /* каскадное заполнение: блок влетает со стороны заполнения
         (сверху или с левого/правого края) и встаёт на место */
      const k = b.born ? Math.min(1, (now - b.born) / 260) : 1;
      const e = 1 - Math.pow(1 - k, 3);            // easeOutCubic
      let ox = 0, oy = 0;
      if (k < 1) {
        const off = 38 * (1 - e);                  // вылет из стороны заполнения
        if (b.fill === 'top') oy = -off;
        else ox = b.fromLeft ? -off : off;
      }
      /* позиция с учётом скольжения мутантов и их дрожи */
      let px = b.x, py = b.y, scale = 1;
      if (b.anim) {
        const kk = Math.min(1, b.anim.t / b.anim.dur);
        const ke = 1 - Math.pow(1 - kk, 3);
        if (b.anim.pop) scale = 0.45 + 0.55 * ke;   // телепорт: вжух на новом месте
        else { px = lerp(b.anim.fx, b.x, ke); py = lerp(b.anim.fy, b.y, ke); }
      }
      if (b.kind === 'teleport') { px += b.jx || 0; py += b.jy || 0; }
      if (b.kind === 'ball' && b.shakeT > 0) {
        px += randFloat(-1.4, 1.4);
        py += randFloat(-1.1, 1.1);
      }
      /* смерть Сатаны: остальные блоки трусятся */
      if (satanDying > 0 && b !== boss) {
        px += randFloat(-3, 3);
        py += randFloat(-2.5, 2.5);
      }
      const w = b.w * (0.55 + 0.45 * e) * scale;
      const h = b.h * (0.55 + 0.45 * e) * scale;
      const bx = px + ox + (b.w - w) / 2, by = py + oy + (b.h - h) / 2;
      if (k < 1 || (b.anim && b.anim.pop)) ctx.globalAlpha = 0.25 + 0.75 * e;
      drawBlockBody(b, bx, by, w, h);
      if (b.flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${(b.flash * 0.65).toFixed(3)})`;
        traceBlockShape(b, bx, by, w, h);
        ctx.fill();
      }
      /* пока Сатана жив — обводки других блоков ярко-красные и идут
         строго по форме блока (змей — по повёрнутому телу) */
      if (satanLive && b !== boss) {
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = 'rgba(255,40,30,.95)';
        traceBlockShape(b, bx, by, w, h);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* --- босс-Сатана: тело с рогами, глазами и ухмылкой --- */
  function drawBossBody(x, y, w, h, hp, t, flash) {
    ctx.save();
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#ff6a4a');
    g.addColorStop(0.42, '#a3121c');
    g.addColorStop(1, '#30060a');
    ctx.shadowColor = 'rgba(255,60,30,.85)';
    ctx.shadowBlur = 26 * glowK;
    rr(x, y, w, h, 12);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
    /* блик */
    ctx.fillStyle = 'rgba(255,240,235,.13)';
    ctx.fillRect(x + 18, y + 9, w - 36, 7);
    /* рога */
    bossHorn(x + 40, y + 4, -1, 52);
    bossHorn(x + w - 40, y + 4, 1, 52);
    /* глаза — злые белые щели со зрачками */
    bossEye(x + w * 0.33, y + h * 0.36, 1);
    bossEye(x + w * 0.67, y + h * 0.36, -1);
    /* ухмылка с зубами */
    bossMouth(x + w / 2, y + h * 0.62, w * 0.46);
    /* прочность */
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 30px Orbitron, Arial, sans-serif';
    ctx.shadowColor = 'rgba(255,40,20,.9)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#fff';
    ctx.fillText(String(Math.max(0, Math.ceil(hp))), x + w / 2, y + h * 0.82);
    ctx.shadowBlur = 0;
    /* обводка */
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,242,238,.92)';
    rr(x, y, w, h, 12);
    ctx.stroke();
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(flash * 0.5).toFixed(3)})`;
      rr(x, y, w, h, 12);
      ctx.fill();
    }
    ctx.restore();
  }

  function bossHorn(hx, hy, dir, len) {
    ctx.save();
    ctx.fillStyle = '#f0ded2';
    ctx.strokeStyle = '#6e4238';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hx - 11 * dir, hy + 8);
    ctx.quadraticCurveTo(hx + 2 * dir, hy - len * 0.72, hx + 15 * dir, hy - len);
    ctx.quadraticCurveTo(hx + 4 * dir, hy - len * 0.42, hx + 10 * dir, hy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function bossEye(ex, ey, dir) {
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(0.30 * dir);                 // злой наклон
    ctx.shadowColor = 'rgba(255,235,225,.9)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#fff5ef';
    ctx.beginPath();
    ctx.moveTo(-17, 1); ctx.lineTo(17, -8); ctx.lineTo(17, 2); ctx.lineTo(-17, 10);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#8f0f16';              // зрачок
    ctx.beginPath();
    ctx.arc(3, 0, 4.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function bossMouth(mx, my, mw) {
    ctx.save();
    ctx.fillStyle = '#1c0306';
    ctx.beginPath();
    ctx.moveTo(mx - mw / 2, my - 2);
    ctx.quadraticCurveTo(mx, my + 18, mx + mw / 2, my - 2);
    ctx.quadraticCurveTo(mx, my + 7, mx - mw / 2, my - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffe9dc';              // зубы
    for (let i = 0; i < 6; i++) {
      const tx = mx - mw / 2 + 7 + i * (mw - 14) / 5;
      ctx.beginPath();
      ctx.moveTo(tx - 4, my + 0.5);
      ctx.lineTo(tx + 4, my + 0.5);
      ctx.lineTo(tx, my + 9);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /* вступление босса: тень на большую часть поля + падение сверху */
  function drawBossIntro(t) {
    if (!bossSeq || !boss) return;
    if (bossSeq.phase === 'fill') return;   // идёт каскад заполнения — босс ещё не объявился
    const k = bossSeq.phase === 'shadow' ? Math.min(1, bossSeq.t / 1.3) : 1;
    /* тень: быстро накрывает большую часть поля и густеет */
    const kk = Math.pow(k, 0.45);
    ctx.save();
    ctx.fillStyle = `rgba(10,0,0,${(0.2 + 0.42 * k).toFixed(3)})`;
    const scx = boss.x + boss.w / 2;
    ctx.fillRect(scx - W * 0.42 * kk, 0, W * 0.84 * kk, H * 0.72 * kk);
    ctx.restore();
    /* сам Сатана: нависает над своей зоной, трясётся — и обрушивается */
    let by, tilt = 0;
    if (bossSeq.phase === 'shadow') {
      by = -boss.h * 0.42 + Math.sin(bossSeq.t * 26) * 3;
    } else {
      const p = Math.min(1, bossSeq.t / 0.85);
      by = lerp(-boss.h * 0.42, boss.y, p * p);
      tilt = (1 - p) * 0.06;
    }
    ctx.save();
    if (tilt) {
      ctx.translate(boss.x + boss.w / 2, by + boss.h / 2);
      ctx.rotate(tilt);
      ctx.translate(-(boss.x + boss.w / 2), -(by + boss.h / 2));
    }
    drawBossBody(boss.x, by, boss.w, boss.h, boss.hp, t, 0);
    ctx.restore();
    /* линии скорости при падении */
    if (bossSeq.phase === 'fall') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,180,150,.4)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 5; i++) {
        const lx = boss.x + 24 + i * (boss.w - 48) / 4 + randFloat(-6, 6);
        ctx.beginPath();
        ctx.moveTo(lx, by - 16 - randFloat(0, 26));
        ctx.lineTo(lx, by - 62 - randFloat(0, 30));
        ctx.stroke();
      }
      ctx.restore();
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
    ctx.shadowBlur = (16 + p.glowT * 14) * glowK;
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
    const y = extraShieldY;                 // на 10-м этапе — внизу стека стены
    ctx.save();
    ctx.shadowColor = rgba(neon(t, 2.4), 0.9);
    ctx.shadowBlur = 16 * glowK;
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

  /* --- стена ада: огненные слои с эксклюзивной подсветкой, как у поля ---
     Слой разворачивается от центра к краям на безье (1 с) и живёт с
     пульсирующим огненным свечением; при глюк-уходе трусится,
     поворачивается 3 р/с и сжимается к центру, теряя прозрачность */
  function drawWallFx(t) {
    if (!fx.wall) return;
    const cx = W / 2, maxHalf = W / 2 - 14;
    for (let i = 0; i < fx.wall.layers.length; i++) {
      const L = fx.wall.layers[i];
      if (L.dead) continue;
      let half = maxHalf, alpha = 1, rot = 0, jx = 0;
      if (L.state === 'grow') {
        if (L.t <= 0) continue;                 // ещё не начался
        const e = wallEase(Math.min(1, L.t / WALL_GROW));
        half = maxHalf * e;
        alpha = Math.min(1, e * 1.8);
      } else if (L.state === 'die' && L.dieT >= 0) {
        const e = wallDieEase(Math.min(1, L.dieT / WALL_DIE));
        half = maxHalf * (1 - e);
        alpha = 1 - e;
        rot = Math.sin(L.dieT * Math.PI * 6) * 0.15;    // поворот 3 р/с
        jx = Math.sin(L.dieT * Math.PI * 48) * 3;       // быстрая тряска
      }
      if (half < 1 || alpha <= 0.02) continue;
      const flick = 0.8 + 0.2 * Math.sin(t * 9 + i * 2.1) * Math.sin(t * 13.7 + i);
      ctx.save();
      ctx.translate(cx + jx, L.y);
      ctx.rotate(rot);
      ctx.globalAlpha = alpha;
      ctx.shadowColor = 'rgba(255,74,58,.9)';
      ctx.shadowBlur = (14 + 9 * flick) * glowK;
      const g = ctx.createLinearGradient(-half, 0, half, 0);
      g.addColorStop(0, 'rgba(255,74,58,.95)');
      g.addColorStop(0.5, 'rgba(255,224,196,.98)');
      g.addColorStop(1, 'rgba(255,122,60,.95)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-half, 0); ctx.lineTo(half, 0);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,160,100,.95)';
      ctx.beginPath(); ctx.arc(-half, 0, 3.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(half, 0, 3.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
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
    const fl = fireLevel();
    const fk = fireFadeK();                  // после Сатаны огонь гаснет
    const fiery = fl > 0 && fk > 0.12;
    const c = fiery ? [255, 130, 50] : (sup ? [255, 77, 94] : neon(t, 0.7));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (fiery) {
      /* огненный след вместо простого: язычки пламени позади шара;
         пока огонь гаснет — след короче, тусклее и меньше */
      for (let i = 0; i < trail.length; i++) {
        const p = trail[i], f = (i + 1) / trail.length;
        const flick = 0.75 + 0.25 * Math.sin(t * 31 + i * 2.7);
        const r = R * (0.6 + 1.9 * f) * flick * (fl === 2 ? 1.3 : 1) * (0.55 + 0.45 * fk);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, `rgba(255,246,220,${(0.5 * f * fk).toFixed(3)})`);
        g.addColorStop(0.35, `rgba(255,190,80,${(0.42 * f * fk).toFixed(3)})`);
        g.addColorStop(0.7, `rgba(255,80,30,${(0.3 * f * fk).toFixed(3)})`);
        g.addColorStop(1, 'rgba(120,10,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fill();
      }
    } else {
      for (let i = 0; i < trail.length; i++) {
        const p = trail[i], f = (i + 1) / trail.length;
        ctx.fillStyle = rgba(c, f * 0.16);
        ctx.beginPath();
        ctx.arc(p.x, p.y, R * f * 0.85, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.save();
    ctx.shadowColor = rgba(c, 1);
    ctx.shadowBlur = (sup ? 24 + 6 * Math.sin(t * 9) : fiery ? 22 + 5 * Math.sin(t * 17) : 18) * glowK;
    const rg = ctx.createRadialGradient(ball.x, ball.y, 1, ball.x, ball.y, R);
    rg.addColorStop(0, '#ffffff');
    rg.addColorStop(0.5, fiery ? 'rgba(255,214,150,.97)' : (sup ? 'rgba(255,150,160,.95)' : 'rgba(223,255,255,.95)'));
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
    ctx.shadowBlur = 24 * glowK;
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
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, 1 - f.t / f.life);
      ctx.fillStyle = f.color;
      ctx.font = f.strong
        ? '900 21px Orbitron, Arial, sans-serif'
        : '700 15px Orbitron, Arial, sans-serif';
      if (mode === 'hell') {
        /* вместо движения наверх — тряска 5 раз в секунду */
        ctx.fillText(f.text, f.x + (f.jx || 0), f.y + (f.jy || 0));
      } else {
        ctx.fillText(f.text, f.x, f.y - f.t * 46);
      }
    }
    ctx.restore();
  }

  function drawHint(t) {
    if (state !== 'playing' || !ball.docked) return;
    if (bossSeq) return;                 // Сатана ещё не приземлился — подсказки нет
    if (hellPwLive()) return;            // глюк ещё появляется — запуск закрыт
    const a = 0.5 + 0.5 * Math.sin(t * 4.5);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.35 + 0.5 * a;
    ctx.fillStyle = mode === 'hell' ? '#ffb9a8' : '#bfeaff';
    ctx.font = '600 13px Rubik, Arial, sans-serif';
    const txt = ball.autoLaunch
      ? 'Enter — запуск · авто-запуск через ' + Math.max(0, 3 - ball.autoT).toFixed(1) + ' с'
      : 'Enter — запуск шара · Esc — пауза';
    /* в аду подписи на холсте трусятся — 5 раз в секунду */
    const jx = mode === 'hell' ? Math.round(Math.sin(Math.floor(t * 5) * 12.9898) * 1.5) : 0;
    ctx.fillText(txt, W / 2 + jx, paddle.y - 30);
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
    /* фоновая тряска: кулак — сильная, glob.dtr — растущая со временем,
       падение Сатаны — гул, вступление — нарастающий гул */
    const rum = fx.fist ? 9 : (fx.erase ? Math.min(8, 0.6 + fx.erase.t * 1.2)
      : (satanDying > 0 ? 10 : (bossSeq
          ? (bossSeq.phase === 'shadow' ? 1.5 + bossSeq.t * 2.5 : 6) : 0)));
    if (rum > 0) { rx += randFloat(-rum, rum); ry += randFloat(-rum, rum); }
    ctx.translate(rx, ry);

    drawField(t);
    drawBlocks();
    drawBossIntro(t);
    drawShieldFx(t);
    drawWallFx(t);
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
                (state === 'playing' ? '1' : '0') +
                (hellPw.fired ? '1' : '0') + (hellPwLive() ? '1' : '0') +
                (hellPw.done ? '1' : '0');
    if (key !== lastLockKey) {
      lastLockKey = key;
      root.UI && root.UI.updateSidePanel && root.UI.updateSidePanel();
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    /* плавное расширение поля (финал режима Badass) */
    if (expanding) {
      expanding.t += dt;
      const k = Math.min(1, expanding.t / expanding.dur);
      const e = 1 - Math.pow(1 - k, 3);                  // easeOutCubic
      setField(lerp(expanding.from, expanding.to, e));
      /* платформа плавно уходит к центру растущего поля */
      const target = (W - paddle.w) / 2;
      paddle.x += (target - paddle.x) * Math.min(1, dt * 6);
      paddle.x = clamp(paddle.x, 6, Math.max(6, W - 6 - paddle.w));
      if (ball.docked) { ball.x = paddle.x + paddle.w / 2; ball.y = paddle.y - R - 2; }
      if (k >= 1) {
        const done = expanding.done, to = expanding.to;
        expanding = null;
        setField(to);
        if (done) done();
      }
    }

    if (state === 'playing') {
      const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
      const sdt = dt / sub;
      for (let i = 0; i < sub; i++) {
        step(sdt);
        if (state !== 'playing') break;
      }
      updateFx(dt);
      /* вступление босса: ожидание заполнения → тень → падение */
      updateBossSeq(dt);
      /* смерть Сатаны: короткая тряска — уровень продолжается,
         победа придёт с полной зачисткой оставшихся блоков */
      if (satanDying > 0) {
        satanDying -= dt;
        if (satanDying <= 0) satanDying = 0;
      }
      /* глюк неизвестных усилений: задержка → глюк появляется
         (гигантский, повёрнутый — и встаёт на усилениях);
         полностью накрыл — тряска экрана, глюки остаются */
      if (mode === 'hell' && hellPw.fired && !hellPw.done) {
        hellPw.t += dt;
        if (hellPw.t >= HELL_PW_FALL) {
          hellPw.done = true;
          shake(10, 0.6);                // накрыли усиления — экран вздрогнул
        }
      }
    }

    /* стена ада живёт и в окнах (победа/поражение) — глюк-уход слоёв
       и возврат щита видны за окном; на паузе заморожена, как игра */
    if (fx.wall && state !== 'paused') updateHellWall(dt);

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
    ctx = canvas.getContext('2d');
    setField(CFG.CANVAS_W);

    record = loadRecord(mode);

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
  function debugStart(s, l, m) {
    startRun(s, l, { mode: (m === 'badass') ? 'badass' : (m === 'hell' ? 'hell' : 'normal') });
    const st = stageDef(s, mode);
    let mut = 0;
    for (const b of blocks) if (b.kind && b.kind !== 'boss') mut++;
    const dev = l === 0 ? '—' :
      (levelTotal >= st.target ? '+' : '') +
      (((levelTotal - st.target) / st.target) * 100).toFixed(1) + '%';
    return {
      'режим': MODES[mode].name,
      'этап': s + '/' + stagesTotal(),
      'расстановка': `${LAYOUT_INFO[layoutId].name} (id ${layoutId})`,
      'блоков': blocks.length - (boss ? 1 : 0),
      'мутантов': mut,
      'колонн': st.cols,
      'строк': st.rows,
      'очки уровня': levelTotal,
      'цель этапа': l === 0 ? `${st.cells * 10} (rigged)` : (st.hell ? `${st.target}` : `${st.target} ± ${st.tol}`),
      'отклонение': dev,
      'босс': boss ? 'ждёт' : '—'
    };
  }

  /* Отладка: мгновенно пройти текущий уровень (для тестов переходов) */
  function debugWinLevel() {
    if (state !== 'playing') return false;
    for (const b of blocks) b.alive = false;
    levelComplete();
    return true;
  }

  /* Отладка: ударить шаром по первому мутанту заданного вида —
     проверка телепортов, щитов и урона без ловли реального шара */
  function debugHitMutant(kind) {
    const b = blocks.find(q => q.alive && q.kind === kind);
    if (!b) return null;
    const before = { gx: b.gx, gy: b.gy, hp: b.hp, kind: b.kind };
    hitBlock(b, ball);
    return { before, after: { gx: b.gx, gy: b.gy, hp: b.hp, kind: b.kind, alive: b.alive } };
  }

  /* Отладка: выставить остаток щита у всех шароблоков (тесты таймера) */
  function debugShieldTime(sec) {
    for (const b of blocks) if (b.kind === 'ball') b.shield = sec;
    return true;
  }

  /* Отладка: убрать все обычные блоки, оставив только мутантов —
     проверка движения на свободном поле */
  function debugSpareMutants() {
    let n = 0;
    for (const b of blocks) {
      if (b.alive && !b.kind) { b.alive = false; n++; }
    }
    return n;
  }

  /* Отладка: потерять одну жизнь (для тестов регенерации и поражения) */
  function debugLoseLife() {
    if (state !== 'playing') return false;
    loseBall();
    return true;
  }

  /* Отладка: пропустить вступление босса — сразу к удару
     (стена ада тоже запускается, как при естественном падении) */
  function debugSkipBossIntro() {
    if (!bossSeq || !boss) return false;
    bossSeq.phase = 'fall';
    bossSeq.t = 0.85;
    startHellWall();
    return true;
  }

  /* Отладка: уронить шар отвесно вниз на скорости 10-го этапа —
     проверка стены ада и щита дополнительной жизни.
     Роняем не над платформой — иначе она поймает шар раньше стены */
  function debugBallFall() {
    if (state !== 'playing') return false;
    ball.docked = false;
    ball.autoLaunch = false;
    if (!ball.speed) ball.speed = CFG.BASE_SPEED;
    ball.speed = Math.max(ball.speed, 1150);
    const pcx = paddle.x + paddle.w / 2;
    let x = ball.x || W / 2;
    if (Math.abs(x - pcx) < paddle.w / 2 + 24) {
      x = pcx + paddle.w / 2 + 90;
      if (x > W - 40) x = pcx - paddle.w / 2 - 90;
      if (x < 40) x = W / 2;
    }
    ball.x = clamp(x, 40, W - 40);
    ball.y = H - 170;
    ball.vx = 0;
    ball.vy = ball.speed;
    trail.length = 0;
    return true;
  }

  /* Отладка: добить Сатану до 1 hp — следующий удар решит */
  function debugNearKillBoss() {
    if (!boss || !boss.alive) return false;
    boss.hp = 1;
    return true;
  }

  /* Отладка: промотать «спокойствие» после Сатаны до нужной секунды
     (проверка замедления шара и угасания огня без реальных 10 с) */
  function debugSetCalm(sec) {
    if (!satanCalm) return false;
    satanCalmT = Math.max(0, sec);
    return true;
  }

  /* Отладка: разрушить все обычные блоки честным путём (очки + kill +
     checkLevelDone) — проверка победы финала ада через зачистку поля */
  function debugClearBlocks() {
    if (state !== 'playing') return false;
    for (const b of blocks) {
      if (!b.alive || b === boss || b.kind === 'boss') continue;
      addScore(b.hp);
      b.hp = 0;
      kill(b, blockColorStr(b), false);
    }
    checkLevelDone();
    return true;
  }

  function syncUI() { root.UI && root.UI.sync(); }

  /* ======================= Экспорт ======================= */

  root.Game = {
    init, startRun, nextLevel, tryLaunch, toggleAutopilot, togglePause,
    toggleControlMode, debugStart, debugWinLevel, debugLoseLife, backToMenu,
    activatePower, canActivatePower, wipeCanvas, debugBallFall,
    debugHitMutant, debugShieldTime, debugSpareMutants,
    debugSkipBossIntro, debugNearKillBoss, debugClearBlocks, debugSetCalm,
    get state() { return state; },
    get score() { return score; },
    get record() { return record; },
    get lives() { return lives; },
    get stageNum() { return stageNum; },
    get stagesTotal() { return stagesTotal(); },
    get mode() { return mode; },
    get regen() { return runRegen; },
    get badassJustUnlocked() { return badassJustUnlocked; },
    get lastRegenGain() { return lastRegenGain; },
    get fieldW() { return W; },
    get layoutName() { return LAYOUT_INFO[layoutId] ? LAYOUT_INFO[layoutId].name : '—'; },
    get autopilot() { return autopilot; },
    get controlMode() { return controlMode; },
    get paddleX() { return paddle.x; },
    get paddleW() { return paddle.w; },
    get ballDocked() { return ball.docked; },
    /* отладка: полёт шара — скорость, спокойствие после Сатаны, огонь */
    get ballSnapshot() {
      return {
        docked: ball.docked,
        x: Math.round(ball.x), y: Math.round(ball.y),
        vx: Math.round(ball.vx), vy: Math.round(ball.vy),
        speed: Math.round(ball.speed),
        calmT: satanCalm ? +satanCalmT.toFixed(2) : null,
        fireK: +fireFadeK().toFixed(2),
        autoBounces: autoBounces.slice(),
        autoAngles: autoAngles.slice()
      };
    },
    /* отладка: стена ада — слои, их состояние и место щита доп. жизни */
    get hellWallSnapshot() {
      return fx.wall ? {
        layers: fx.wall.layers.map(L => ({
          y: L.y, state: L.state, t: +L.t.toFixed(2),
          dieT: +L.dieT.toFixed(2), dead: L.dead
        })),
        extraShieldY: Math.round(extraShieldY),
        shift: !!fx.wall.shift, rise: !!fx.wall.rise
      } : null;
    },
    get cine() { return fx.cine; },
    get powerBusy() { return powerActionActive(); },
    get superT() { return fx.superT; },
    /* ад: состояние сессии — для интерфейса */
    get hellExitLocked() { return hellExitLocked; },
    set hellExitLocked(v) { hellExitLocked = !!v; },
    get hellStage10() { return mode === 'hell' && stageNum === stagesTotal(); },
    get hellPwGlitch() {
      return { fired: hellPw.fired, live: hellPwLive(), done: hellPw.done };
    },
    get bossSnapshot() {
      return boss ? {
        hp: boss.hp, alive: boss.alive, landed: bossLanded,
        seq: bossSeq ? bossSeq.phase : null,
        satanDying: +satanDying.toFixed(2)
      } : null;
    },
    /* отладка: жирный шар босса — размер, скорость, отскоки */
    get bossBallSnapshot() {
      const B = fx.bossBall;
      return B ? {
        x: Math.round(B.x), y: Math.round(B.y), r: B.r,
        speed: Math.round(Math.hypot(B.vx, B.vy)),
        bounces: B.bounces, life: +B.life.toFixed(2)
      } : null;
    },
    /* отладка: параметры каскадного заполнения текущего уровня */
    blocksSnapshot() {
      return blocks.map(b => ({ fill: b.fill, fromLeft: b.fromLeft, born: b.born > 0 }));
    },
    /* отладка: живые мутанты текущего уровня (позиции в клетках) */
    mutantsSnapshot() {
      return blocks.filter(b => b.alive && b.kind).map(b => ({
        kind: b.kind, gx: b.gx, gy: b.gy, hp: b.hp,
        shield: b.shield != null ? +b.shield.toFixed(1) : null,
        angle: b.angle != null ? +(b.angle * 180 / Math.PI).toFixed(0) % 360 : null
      }));
    },
    get fxSnapshot() {
      return {
        mode, fieldW: W, stagesTotal: stagesTotal(), finalePending,
        shield: fx.shield ? fx.shield.stages : 0,
        shieldY: Math.round(extraShieldY),
        wall: fx.wall ? fx.wall.layers.filter(L => !L.dead).length : 0,
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
      const st = stageDef(stageNum, mode);
      if (st.hell) return `${st.target}`;
      return layoutId === 0 ? `${st.cells * 10} (rigged)` : `${st.target} ± ${st.tol}`;
    },
    /* отладка: счётчики видимых объектов поля (тесты очистки канваса) */
    get debugCounts() {
      let mut = 0;
      for (const b of blocks) if (b.alive && b.kind && b.kind !== 'boss') mut++;
      return {
        blocks: blocks.length, particles: particles.length,
        floaters: floaters.length, mutants: mut,
        boss: boss && boss.alive ? boss.hp : null
      };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
