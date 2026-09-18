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
    CRIT_CHANCE: 0.05,       // 5% шанс критического удара
    LIVES: 3,                // жизни на забег
    RIGGED_CHANCE: 0.01,     // 1% шанс расстановки rigged на любом этапе

    AUTO_SPEED: 900,          // скорость платформы в режиме автопилота, px/с
    KEY_SPEED: 760,           // скорость платформы с клавиатуры, px/с

    RECORD_KEY: 'neonArkanoid.record'
  };

  /* --- Этапы: относительная прочность и целевые очки (±10%) --- */
  const STAGES = [null,
    { min: 1, max: 3,  target: 60,  tol: 6  },
    { min: 1, max: 5,  target: 120, tol: 12 },
    { min: 2, max: 6,  target: 170, tol: 17 },
    { min: 4, max: 8,  target: 250, tol: 25 },
    { min: 6, max: 10, target: 350, tol: 35 }
  ];

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

  /* --- Рекорд (localStorage, безопасно для file://) --- */
  function loadRecord() {
    try {
      const v = +localStorage.getItem(CFG.RECORD_KEY);
      return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    } catch (e) { return 0; }
  }
  function saveRecord(v) {
    try { localStorage.setItem(CFG.RECORD_KEY, String(v)); } catch (e) { /* ignore */ }
  }

  Object.assign(root, {
    CFG, STAGES, BLOCK_COLORS, LAYOUT_INFO,
    randInt, randFloat, clamp, lerp, shuffle, loadRecord, saveRecord
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CFG, STAGES, BLOCK_COLORS, LAYOUT_INFO };
  }
})(typeof window !== 'undefined' ? window : globalThis);
