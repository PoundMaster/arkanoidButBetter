/* ============================================================
   НЕОН·АРКАНОИД — генераторы расстановок (строгие правила)
   Сетка 9x5 (x: 0..8 — столбцы, y: 0..4 — строки, 0;0 — верхний левый).

   Философия: КОМПОЗИЦИЯ ВАЖНЕЕ ПОГРЕЧНОСТИ.
   Правило расстановки соблюдается абсолютно; состав блоков меняется
   лишь настолько, насколько нужно, чтобы суммарные очки вошли в
   допуск ±10% цели этапа. Никакого «случайного ремонта» — только
   структурно осмысленные операции (демотация клеток, слои колонн,
   расширение шагов градиента).

   Итоговые суммы по этапам:
     Строки  — ровно цель этапа (60/120/170/250/350);
     Столбцы — цель ± 1–2 слоя прочности колонн (±5..10 очков, в допуске);
     Хаос    — случайно в пределах допуска;
     Сетка   — детерминированно (зависит от чётности): 66 / 111–114 /
               178–182 / 268–272 / 358–362, на этапе 1 — всегда ровно 66;
     Зигзаг  — максимум «полного» градиента с шагом 1, случайно ослабляется
               расширением шагов до 2 (всегда в допуске);
     Rigged  — все блоки ×10, ровно 450 очков.
   ============================================================ */
(function (root) {
  'use strict';
  const { CFG, STAGES, randInt, randFloat, clamp, shuffle } = root;

  /* Набор колонн расстановки «Столбцы» фиксируется на сессию:
     при каждом выпадании меняется только порядок колонн и, по желанию,
     прочность 1–2 колонн на один слой. Общий «вес блоков» почти неизменен. */
  const columnCache = new Map();

  function emptyGrid() {
    return Array.from({ length: CFG.ROWS }, () => Array(CFG.COLS).fill(0));
  }

  function total(grid) {
    let s = 0;
    for (const row of grid) for (const v of row) s += v;
    return s;
  }

  /* --- 1. Строки: снизу лёгкие, к верху тяжелее. Сумма = цель точно.
         Строгая вложенность пирамиды: ЛЮБОЙ блок строки y не прочнее
         САМОГО СЛАБОГО блока строки y-1 — градиент читается идеально.
         Единицы прочности раздаются по одной, с уклоном к верхним
         строкам; строка может получить +1 к клетке, только пока это
         не нарушает вложенность. Внутри строки значения различаются
         не более чем на 1. --- */
  function genRows(st) {
    const grid = emptyGrid();
    for (let y = 0; y < 5; y++) for (let x = 0; x < 9; x++) grid[y][x] = st.min;

    const aim = st.target;
    let left = aim - 45 * st.min;              // сколько единиц раздать
    const p = randFloat(1.2, 2.6);             // крутизна уклона — своя каждый раз

    let guard = 100000;
    while (left > 0 && guard-- > 0) {
      // строки, у которых можно поднять самую слабую клетку
      const cands = [], w = [];
      for (let y = 0; y < 5; y++) {
        let lo = Infinity;
        for (let x = 0; x < 9; x++) if (grid[y][x] < lo) lo = grid[y][x];
        let lim = st.max;                      // верхняя строка ограничена лишь шкалой
        if (y > 0) {                           // ниже — самым слабым блоком сверху
          lim = Infinity;
          for (let x = 0; x < 9; x++) if (grid[y - 1][x] < lim) lim = grid[y - 1][x];
        }
        if (lo + 1 <= lim) { cands.push(y); w.push(Math.pow(5 - y, p)); }
      }
      if (!cands.length) break;                // теоретически недостижимо (цель < 45*max)

      let wsum = 0;
      for (const v of w) wsum += v;
      let r = Math.random() * wsum, pickY = cands[cands.length - 1];
      for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) { pickY = cands[i]; break; } }

      // поднимаем случайную из самых слабых клеток выбранной строки
      let lo = Infinity;
      for (let x = 0; x < 9; x++) if (grid[pickY][x] < lo) lo = grid[pickY][x];
      const idx = [];
      for (let x = 0; x < 9; x++) if (grid[pickY][x] === lo) idx.push(x);
      grid[pickY][idx[randInt(0, idx.length - 1)]]++;
      left--;
    }
    return grid;
  }

  /* --- 2. Столбцы: колонны однородной прочности, их порядок
         случайный при каждом выпадании. Базовый набор колонн —
         «лестница» от самых прочных к слабым (максимальная прочность
         этапа гарантированно присутствует), фиксируется на сессию.
         При выпадании можно добавить/убрать один слой прочности
         у 1–2 колонн — очки гуляют в пределах допуска. --- */
  function columnBaseSet(st) {
    const S = Math.round(st.target / 5);      // сумма значений 9 колонн
    const v = [];
    let rem = S;
    for (let i = 0; i < 9; i++) {
      const val = clamp(rem - (8 - i) * st.min, st.min, st.max);
      v.push(val);
      rem -= val;
    }
    // лёгкое сглаживание лестницы случайными переносами единицы
    let k = randInt(0, 3);
    while (k-- > 0) {
      let nMax = 0, nMin = 0;
      for (const val of v) { if (val === st.max) nMax++; if (val === st.min) nMin++; }
      const donors = [], receivers = [];
      for (let i = 0; i < 9; i++) {
        if (v[i] - 1 >= st.min && (v[i] < st.max || nMax > 1)) donors.push(i);
        if (v[i] + 1 <= st.max && (v[i] > st.min || nMin > 1)) receivers.push(i);
      }
      if (!donors.length || !receivers.length) break;
      const d = donors[randInt(0, donors.length - 1)];
      const r = receivers[randInt(0, receivers.length - 1)];
      if (r === d) continue;
      v[d]--; v[r]++;
    }
    return v;
  }

  function genColumns(st) {
    let base = columnCache.get(st.n);
    if (!base) { base = columnBaseSet(st); columnCache.set(st.n, base); }

    const cols = base.slice();
    const lo = st.target - st.tol, hi = st.target + st.tol;
    let pts = cols.reduce((a, b) => a + b, 0) * 5;

    // вариативность: ±1 слой прочности в 1–2 колоннах
    const tweaks = randInt(0, 2);
    for (let t = 0; t < tweaks; t++) {
      const i = randInt(0, 8);
      const dir = Math.random() < 0.5 ? -1 : 1;
      const nv = cols[i] + dir;
      if (nv < st.min || nv > st.max) continue;
      const np = pts + dir * 5;
      if (np < lo || np > hi) continue;
      let nMax = 0, nMin = 0;
      for (const c of cols) { if (c === st.max) nMax++; if (c === st.min) nMin++; }
      if (cols[i] === st.max && dir < 0 && nMax === 1) continue;  // не терять последнюю макс. колонну
      if (cols[i] === st.min && dir > 0 && nMin === 1) continue;
      cols[i] = nv;
      pts = np;
    }

    shuffle(cols);
    const grid = emptyGrid();
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 9; x++) grid[y][x] = cols[x];
    }
    return grid;
  }

  /* --- 3. Хаос: блоки в случайных местах (пустоты допустимы),
         прочность из относительной шкалы этапа, сумма точно в допуске. --- */
  function genChaos(st) {
    const grid = emptyGrid();
    const aim = randInt(st.target - st.tol, st.target + st.tol);

    // плотность тоже случайная: иногда реже и прочнее, иногда чаще и слабее
    const avgPick = randInt(st.min, st.max);
    const nLo = Math.ceil(aim / st.max);
    const nHi = Math.min(45, Math.floor(aim / st.min));
    const n = Math.min(Math.max(Math.round(aim / avgPick), nLo), nHi);

    const all = [];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 9; x++) all.push([y, x]);
    const cells = shuffle(all).slice(0, n);

    const vals = cells.map(() => st.min);
    let extra = aim - n * st.min, guard = 5000;
    while (extra > 0 && guard-- > 0) {
      const i = randInt(0, n - 1);
      if (vals[i] < st.max) { vals[i]++; extra--; }
    }
    cells.forEach(([y, x], i) => { grid[y][x] = vals[i]; });
    return grid;
  }

  /* --- 4. Сетка: шахматное чередование прочных и слабых блоков
         ровно двумя величинами. Берётся самая прочная величина S,
         при которой чистая доска укладывается в допуск; если такой
         нет — минимально возможная, с демотацией лишних сильных
         клеток. Итог по этапам: 66 / 114 / 182 / 272 / 362. --- */
  function genGrid(st) {
    const lo = st.target - st.tol, hi = st.target + st.tol;
    const parity = randInt(0, 1);               // чётность «сильных» клеток
    let nStrong = 0;
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 9; x++) if ((x + y) % 2 === parity) nStrong++;
    }
    const nWeak = 45 - nStrong;

    // максимальная прочность сильной клетки с чистой доской в допуске
    let S = st.min + 1;
    for (let s = st.max; s >= st.min + 1; s--) {
      if (nStrong * s + nWeak * st.min <= hi) { S = s; break; }
    }
    if (nStrong * S + nWeak * st.min < lo) S = Math.min(st.max, S + 1);

    const grid = emptyGrid();
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 9; x++) {
        grid[y][x] = ((x + y) % 2 === parity) ? S : st.min;
      }
    }

    // если чистая доска всё же выше допуска — демотируем сильные клетки
    let sum = total(grid), guard = 200;
    while (sum > hi && guard-- > 0) {
      const cands = [];
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 9; x++) {
          if ((x + y) % 2 === parity && grid[y][x] > st.min) cands.push([y, x]);
        }
      }
      if (!cands.length) break;
      const [y, x] = cands[randInt(0, cands.length - 1)];
      grid[y][x]--;
      sum--;
    }
    return grid;
  }

  /* --- 5. Зигзаг: 5 максимально прочных блоков на центральной
         диагонали 2;5 – 6;1 (левый верхний угол = 0;0), от них по
         горизонтали расходится градиент прочности (шаг 1–2 за клетку,
         не ниже min этапа). С вероятностью 50% — зеркало 2;1 – 6;5.
         Шаги градиента расширяются случайным образом, пока сумма
         не опустится до случайной цели в допуске. --- */
  function genZigzag(st) {
    const lo = st.target - st.tol, hi = st.target + st.tol;
    const mirror = Math.random() < 0.5;
    const anchorX = (y) => mirror ? (2 + y) : (6 - y);

    // steps[y][k] — шаг градиента между колонками k и k+1
    const steps = [];
    for (let y = 0; y < 5; y++) steps.push(Array(8).fill(1));

    function build() {
      const grid = emptyGrid();
      for (let y = 0; y < 5; y++) {
        const ax = anchorX(y);
        grid[y][ax] = st.max;
        let v = st.max;
        for (let x = ax - 1; x >= 0; x--) {
          v = Math.max(st.min, v - steps[y][x]);
          grid[y][x] = v;
        }
        v = st.max;
        for (let x = ax + 1; x < 9; x++) {
          v = Math.max(st.min, v - steps[y][x - 1]);
          grid[y][x] = v;
        }
      }
      return grid;
    }

    let grid = build();
    let sum = total(grid);
    // все шаги = 1 дают максимум; для этапов 1–5 он всегда в допуске
    const aim = randInt(lo, Math.min(hi, sum));
    let guard = 600;
    while (sum > aim && guard-- > 0) {
      const y = randInt(0, 4), k = randInt(0, 7);
      if (steps[y][k] === 2) continue;
      steps[y][k] = 2;
      const g2 = build();
      const s2 = total(g2);
      if (s2 < lo || s2 >= sum) { steps[y][k] = 1; continue; }  // слишком круто или без эффекта
      grid = g2;
      sum = s2;
    }
    return grid;
  }

  /* --- 0. Rigged: все блоки ×10 независимо от этапа (450 очков). --- */
  function genRigged() {
    const grid = emptyGrid();
    for (let y = 0; y < 5; y++) for (let x = 0; x < 9; x++) grid[y][x] = 10;
    return grid;
  }

  const GENERATORS = {
    0: genRigged,
    1: genRows,
    2: genColumns,
    3: genChaos,
    4: genGrid,
    5: genZigzag
  };

  /* Сгенерировать расстановку layoutId для этапа stageNum. */
  function generate(stageNum, layoutId) {
    const st = Object.assign({ n: stageNum }, STAGES[stageNum]);
    const grid = GENERATORS[layoutId](st);
    return {
      grid,
      stage: stageNum,
      layoutId,
      total: total(grid)
    };
  }

  /* Обычный выбор расстановки на этапе:
     1% — rigged, иначе случайная из 1..5 без повтора предыдущей. */
  function pick(stageNum, lastLayoutId) {
    if (Math.random() < 0.01) return 0;
    const cands = [1, 2, 3, 4, 5].filter(id => id !== lastLayoutId);
    return cands[randInt(0, cands.length - 1)];
  }

  const Layouts = { generate, pick };
  root.Layouts = Layouts;
  if (typeof module !== 'undefined' && module.exports) module.exports = Layouts;
})(typeof window !== 'undefined' ? window : globalThis);
