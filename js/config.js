/* ============================================================
   НЕОН·АРКАНОИД — конфигурация, палитры и утилиты
   Работает и в браузере (window), и в Node (для тестов).
   ============================================================ */
(function (root) {
  'use strict';

  /* --- Игровое поле --- */
  const CFG = {
    COLS: 9, ROWS: 5,                  // сетка блоков 9 x 5
    CANVAS_W: 720, CANVAS_H: 920,      // логический размер холста
    FIELD_PAD_X: 17, FIELD_TOP: 34,    // отступ сетки блоков
    BLOCK_W: 61, BLOCK_H: 28,          // размер блока
    GAP_X: 17, GAP_Y: 17,              // зазоры: чуть больше шара — он может залетать между блоками

    PADDLE_W: 110, PADDLE_H: 16, PADDLE_Y: 850,
    BALL_R: 7,                         // сжатый шар (диаметр 14 < зазора 17)

    /* --- Механика --- */
    BASE_SPEED: 430,          // базовая скорость шара (этап 1), px/с
    SPEED_PER_STAGE: 0.07,    // +7% скорости за этап
    LAUNCH_MAX_ANGLE: 50 * Math.PI / 180,  // случайный угол запуска: до ±50°
    PADDLE_MAX_ANGLE: 50 * Math.PI / 180,  // край платформы: до 50° от вертикали
    // отскок от самого центра платформы — 5–10° (случайный знак и величина
    // выбираются на каждую попытку, чтобы шар не зависал вертикально)
    CENTER_BOUNCE_MIN: 5 * Math.PI / 180,
    CENTER_BOUNCE_MAX: 10 * Math.PI / 180,
    GRADIENT_P_MIN: 0.85,    // разброс формы градиента отскока на попытку
    GRADIENT_P_MAX: 1.35,
    CRIT_CHANCE: 0.05,       // база (обычный); убоиный 15%, адский 25% — см. MODES
    LIVES: 3,                // жизни на забег
    RIGGED_CHANCE: 0.01,     // 1% шанс расстановки rigged на любом этапе

    AUTO_SPEED: 900,          // скорость платформы в режиме автопилота, px/с
    KEY_SPEED: 760,           // скорость платформы с клавиатуры, px/с

    RECORD_KEYS: {             // рекорды раздельные по режимам
      normal: 'neonArkanoid.record.normal',
      badass: 'neonArkanoid.record.badass',
      hell: 'neonArkanoid.record.hell'
    },
    RECORD_KEY_LEGACY: 'neonArkanoid.record'   // старый общий рекорд -> обычный
  };

  /* --- Режимы игры ---
     Обычный — как раньше: 5 этапов, ~950 блоков за полное прохождение.
     Badass (в интерфейсе зовётся «УБОЙНЫМ» — badass только в коде)
     открывается после полного прохождения обычного: 6 этапов,
     ~2000 блоков, прочнее блоки, на 6-м этапе поле расширяется
     до 13 колонн и вся тема уходит в фиолетовое свечение.
     Hell (в интерфейсе «АДСКИЙ») — 10 этапов, ~5000 прочности,
     красно-белая тема с огнём; вход — 15 нажатий на регенерацию
     в настройках новой игры. Поле 10-го этапа — 19 колонн × 8 строк,
     всегда хаос + босс-Сатана (5×3, 100 прочности, криты дают 5).
     crit — шанс крита: 5% / 15% / 25%. Шар в аду быстрее, с 4-го
     этапа — огненный след, на 10-м — ещё быстрее и больше огня.
     С поздних этапов появляются МУТИРОВАННЫЕ блоки (mut — доля
     от общего числа блоков): телепорт, вверх-вниз, вправо-влево,
     блоко-змей и шароблок.
     fullBoard — этапы, где поле всегда заполняется целиком десятками
     (номинальная цель выше физического максимума 9×5×10=450,
     мутанты снижают сумму — ад не сверяет счёты).
     id режима: normal=0, badass=1, hell=2 — входит в формулы
     интервалов движения и щитов шароблоков. */
  const MODES = {
    normal: {
      id: 'normal', name: 'ОБЫЧНЫЙ', crit: 0.05,
      stages: [null,
        { min: 1, max: 3,  target: 60,  tol: 6  },
        { min: 1, max: 5,  target: 120, tol: 12 },
        { min: 2, max: 6,  target: 170, tol: 17 },
        { min: 4, max: 8,  target: 250, tol: 25 },
        { min: 6, max: 10, target: 350, tol: 35, mut: 0.05, comp: 3 }
      ]
    },
    badass: {
      id: 'badass', name: 'УБОЙНЫЙ', crit: 0.15,
      stages: [null,
        { min: 1, max: 4,  target: 160, tol: 16 },
        { min: 3, max: 6,  target: 240, tol: 24 },
        { min: 4, max: 8,  target: 280, tol: 28 },
        { min: 5, max: 10, target: 320, tol: 32, mut: 0.10, comp: 4 },
        { min: 7, max: 10, target: 400, tol: 40, mut: 0.20, comp: 20 },
        { min: 8, max: 10, target: 600, tol: 60, mut: 0.30, comp: 61, wide: true }  // 13 колонн
      ]
    },
    hell: {
      id: 'hell', name: 'АДСКИЙ', crit: 0.25, hell: true,
      stages: [null,
        { min: 3, max: 5,  target: 200, tol: 20 },
        { min: 4, max: 8,  target: 280, tol: 28 },
        { min: 8, max: 10, target: 400, tol: 40, mut: 0.10, comp: 19 },
        /* с 4-го этапа поле расширяется до 13 колонн и таким остаётся
           до 9-го включительно; 10-й — 19 колонн × 8 строк + Сатана */
        { min: 9, max: 10, target: 490, tol: 49, mut: 0.20, fullBoard: true, wide: true },
        { min: 10, max: 10, target: 500, tol: 50, mut: 0.30, fullBoard: true, wide: true },
        { min: 10, max: 10, target: 510, tol: 51, mut: 0.40, fullBoard: true, wide: true },
        { min: 10, max: 10, target: 530, tol: 53, mut: 0.50, fullBoard: true, wide: true },
        { min: 10, max: 10, target: 540, tol: 54, mut: 0.60, fullBoard: true, wide: true },
        { min: 10, max: 10, target: 550, tol: 55, mut: 0.70, fullBoard: true, wide: true },
        { min: 10, max: 10, target: 1000, tol: 100, mut: 0.80, wide: 19, tall: 8,
          chaosOnly: true, boss: true }
      ]
    }
  };

  /* Обратная совместимость: STAGES — таблица обычного режима */
  const STAGES = MODES.normal.stages;

  /* Ширина поля под число колонок (9 -> 720, 13 -> 1032) */
  function fieldWFor(cols) {
    return CFG.FIELD_PAD_X * 2 + cols * CFG.BLOCK_W + (cols - 1) * CFG.GAP_X + 1;
  }
  /* Определение этапа с учётом режима (колонки/строки, номер, сами границы).
     wide может быть true (13 колонн — финал Badass и этапы 4–9 ада)
     или числом (19 — финал ада); tall добавляет строки (8 — вертикальное
     расширение ада). */
  function stageDef(stageNum, mode) {
    const m = MODES[mode] || MODES.normal;
    const st = Object.assign({ n: stageNum, mode: m.id }, m.stages[stageNum]);
    st.cols = st.wide ? (typeof st.wide === 'number' ? st.wide : 13) : 9;
    st.rows = st.tall ? st.tall : CFG.ROWS;
    st.cells = st.cols * st.rows;
    if (m.hell) st.hell = true;                 // флаги уровня режима
    if (m.crit != null) st.crit = m.crit;
    return st;
  }

  /* --- Прочие ключи localStorage (настройки, разблокировка режима) --- */
  const PREF_KEYS = {
    mode: 'neonArkanoid.prefs.mode',
    regen: 'neonArkanoid.prefs.regen',
    badassUnlocked: 'neonArkanoid.badassUnlocked',
    hellSeen: 'neonArkanoid.hellSeen'      // «грешный спамер» уже заходил в ад
  };
  function loadPref(key, def) {
    try {
      const v = localStorage.getItem(PREF_KEYS[key]);
      return v == null ? def : v;
    } catch (e) { return def; }
  }
  function savePref(key, v) {
    try { localStorage.setItem(PREF_KEYS[key], String(v)); } catch (e) { /* ignore */ }
  }
  function isBadassUnlocked() { return loadPref('badassUnlocked', '0') === '1'; }
  function setBadassUnlocked() { savePref('badassUnlocked', '1'); }
  function clearBadassUnlock() { savePref('badassUnlocked', '0'); }

  /* Разовая миграция старых ключей времён «убойного» (hard) на badass-ключи —
     чтобы разблокировка, рекорд и выбранный режим не потерялись. */
  (function migrateHardKeys() {
    try {
      if (localStorage.getItem(PREF_KEYS.badassUnlocked) == null) {
        const oldUnlock = localStorage.getItem('neonArkanoid.hardUnlocked');
        if (oldUnlock != null) localStorage.setItem(PREF_KEYS.badassUnlocked, oldUnlock);
      }
      if (localStorage.getItem(CFG.RECORD_KEYS.badass) == null) {
        const oldRec = +localStorage.getItem('neonArkanoid.record.hard');
        if (Number.isFinite(oldRec) && oldRec > 0) {
          localStorage.setItem(CFG.RECORD_KEYS.badass, String(oldRec));
        }
      }
      if (localStorage.getItem(PREF_KEYS.mode) === 'hard') {
        localStorage.setItem(PREF_KEYS.mode, 'badass');
      }
    } catch (e) { /* ignore */ }
  })();

  /* --- Палитра блоков по прочности (rgb-строки) ---
     1–5: чёрная обводка и цифра; 6–10: белая обводка и цифра. */
  const BLOCK_COLORS = {
    1:  '255,46,46',
    2:  '244,201,29',
    3:  '234,255,45',
    4:  '128,255,0',
    5:  '44,188,73',
    6:  '2,104,92',
    7:  '39,84,220',
    8:  '136,39,220',
    9:  '159,2,138',
    10: '55,69,114'
  };

  /* --- Мутированные блоки: базовые прочности и описания ---
     Появляются на поздних этапах (см. mut в таблице этапов).
     Замещают в основном блоки своей прочности; телепорту (и движимым,
     если блоков такой прочности нет) достаются наименее прочные.
     Шароблок — заранее выбранная клетка первых двух рядов с прочностью
     1–10 и щитом на первые секунды уровня.
     comp — ожидаемый дрейф очков от замен: базовая сетка генерируется
     под цель target+comp, чтобы итог (с мутантами) остался в допуске. */
  const MUTANTS = {
    teleport:  { hp: 4, name: 'Телепорт' },
    updown:    { hp: 6, name: 'Вверх-вниз' },
    rightleft: { hp: 6, name: 'Вправо-влево' },
    snake:     { hp: 5, name: 'Блоко-Змей' },
    ball:      { hp: 0, name: 'Шароблок' }   // hp индивидуален: 1–10
  };

  /* --- Идентификаторы расстановок (rigged = 0) --- */
  const LAYOUT_INFO = {
    0: { name: 'Rigged',   desc: 'все блоки ×10' },
    1: { name: 'Строки',   desc: 'лёгкие снизу — тяжёлые сверху' },
    2: { name: 'Столбцы',  desc: 'колонны в случайном порядке' },
    3: { name: 'Хаос',     desc: 'случайные позиции, есть пустоты' },
    4: { name: 'Сетка',    desc: 'чередование сильных и слабых' },
    5: { name: 'Зигзаг',   desc: 'прочная диагональ в центре' }
  };

  /* --- Утилиты --- */
  const randInt   = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const randFloat = (a, b) => a + Math.random() * (b - a);
  const clamp     = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const lerp      = (a, b, k) => a + (b - a) * k;

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* --- Рекорд (localStorage, безопасно для file://) — раздельно по режимам --- */
  function loadRecord(mode) {
    const key = CFG.RECORD_KEYS[mode] || CFG.RECORD_KEYS.normal;
    try {
      let v = +localStorage.getItem(key);
      if (!Number.isFinite(v) || v <= 0) {
        /* миграция: старый общий рекорд принадлежит обычному режиму,
           а рекорд «убойного» жил под hard-ключом */
        if (mode === 'badass') v = +localStorage.getItem('neonArkanoid.record.hard');
        if (mode === 'normal' || mode == null) v = +localStorage.getItem(CFG.RECORD_KEY_LEGACY);
      }
      return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    } catch (e) { return 0; }
  }
  function saveRecord(v, mode) {
    const key = CFG.RECORD_KEYS[mode] || CFG.RECORD_KEYS.normal;
    try { localStorage.setItem(key, String(v)); } catch (e) { /* ignore */ }
  }

  Object.assign(root, {
    CFG, MODES, STAGES, BLOCK_COLORS, LAYOUT_INFO, MUTANTS,
    fieldWFor, stageDef,
    randInt, randFloat, clamp, lerp, shuffle, loadRecord, saveRecord,
    loadPref, savePref, isBadassUnlocked, setBadassUnlocked, clearBadassUnlock
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CFG, MODES, STAGES, BLOCK_COLORS, LAYOUT_INFO, MUTANTS, fieldWFor, stageDef };
  }
})(typeof window !== 'undefined' ? window : globalThis);
