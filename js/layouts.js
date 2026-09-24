/* ============================================================
   НЕОН·АРКАНОИД — генераторы расстановок (строгие правила)
   Сетка 9x5 (x — столбцы, y — строки, 0;0 — верхний левый);
   на финальном этапе убойного режима поле расширяется до 13
   колонн — те же правила, но клетки просторнее.

   Философия: КОМПОЗИЦИЯ ВАЖНЕЕ ПОГРЕЧНОСТИ.
   Правило расстановки соблюдается абсолютно; состав блоков меняется
   лишь настолько, насколько нужно, чтобы суммарные очки вошли в
   допуск ±10% цели этапа. Никакого «случайного ремонта» — только
   структурно осмысленные операции (демотация клеток, слои колонн,
   расширение шагов градиента, «толстая» диагональ зигзага).

   Итоговые суммы (обычный режим):
     Строки  — ровно цель этапа (60/120/170/250/350);
     Столбцы — цель ± 1–2 слоя прочности колонн (±5..10 очков, в допуске);
     Хаос    — случайно в пределах допуска;
     Сетка   — детерминированно (зависит от чётности): 66 / 111–114 /
               178–182 / 268–272 / 358–362, на этапе 1 — всегда ровно 66;
     Зигзаг  — максимум «полного» градиента с шагом 1, случайно ослабляется
               расширением шагов до 2 (всегда в допуске);
     Rigged  — все блоки ×10 (450 очков на 9 колоннах, 650 — на 13).
   В убойном режиме цели выше (160..600), поэтому:
     Сетка   — слабая величина поднимается выше min, чтобы доска
               дотянулась до допуска (чередование ровно двух величин);
     Зигзаг  — диагональ становится «толще» (полоса из max-блоков),
               градиент расходится от её краёв.
   ============================================================ */
(function (root) {
  'use strict';
  const { CFG, MODES, stageDef, randInt, randFloat, clamp, shuffle, MUTANTS } = root;
  const STAGES = MODES.normal.stages;   // обратная совместимость (обычный режим)

  /* Набор колонн расстановки «Столбцы» фиксируется на сессию для каждой
     пары режим+этап: при каждом выпадании меняется только порядок колонн
     и, по желанию, прочность 1–2 колонн на один слой. */
  const columnCache = new Map();

  function emptyGrid(st) {
    return Array.from({ length: st.rows || CFG.ROWS }, () => Array(st.cols).fill(0));
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
         не более чем на 1. Работает на любом числе строк (ад: 8). --- */
  function genRows(st) {
    const grid = emptyGrid(st);
    const cols = st.cols, cells = st.cells, R = st.rows || 5;
    for (let y = 0; y < R; y++) for (let x = 0; x < cols; x++) grid[y][x] = st.min;

    const aim = st.target;
    let left = aim - cells * st.min;        // сколько единиц раздать
    const p = randFloat(1.2, 2.6);          // крутизна уклона — своя каждый раз

    let guard = 100000;
    while (left > 0 && guard-- > 0) {
      // строки, у которых можно поднять самую слабую клетку
      const cands = [], w = [];
      for (let y = 0; y < R; y++) {
        let lo = Infinity;
        for (let x = 0; x < cols; x++) if (grid[y][x] < lo) lo = grid[y][x];
        let lim = st.max;                   // верхняя строка ограничена лишь шкалой
        if (y > 0) {                        // ниже — самым слабым блоком сверху
          lim = Infinity;
          for (let x = 0; x < cols; x++) if (grid[y - 1][x] < lim) lim = grid[y - 1][x];
        }
        if (lo + 1 <= lim) { cands.push(y); w.push(Math.pow(R - y, p)); }
      }
      if (!cands.length) break;             // теоретически недостижимо (цель < cells*max)

      let wsum = 0;
      for (const v of w) wsum += v;
      let r = Math.random() * wsum, pickY = cands[cands.length - 1];
      for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) { pickY = cands[i]; break; } }

      // поднимаем случайную из самых слабых клеток выбранной строки
      let lo = Infinity;
      for (let x = 0; x < cols; x++) if (grid[pickY][x] < lo) lo = grid[pickY][x];
      const idx = [];
      for (let x = 0; x < cols; x++) if (grid[pickY][x] === lo) idx.push(x);
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
    const cols = st.cols, R = st.rows || 5;
    const S = Math.round(st.target / R);      // сумма значений всех колонн
    const v = [];
    let rem = S;
    for (let i = 0; i < cols; i++) {
      const val = clamp(rem - (cols - 1 - i) * st.min, st.min, st.max);
      v.push(val);
      rem -= val;
    }
    // лёгкое сглаживание лестницы случайными переносами единицы
    let k = randInt(0, 3);
    while (k-- > 0) {
      let nMax = 0, nMin = 0;
      for (const val of v) { if (val === st.max) nMax++; if (val === st.min) nMin++; }
      const donors = [], receivers = [];
      for (let i = 0; i < cols; i++) {
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
    const key = st.mode + ':' + st.n;
    let base = columnCache.get(key);
    if (!base) { base = columnBaseSet(st); columnCache.set(key, base); }

    const cols = base.slice();
    const lo = st.target - st.tol, hi = st.target + st.tol;
    let pts = cols.reduce((a, b) => a + b, 0) * 5;

    // вариативность: ±1 слой прочности в 1–2 колоннах
    const tweaks = randInt(0, 2);
    for (let t = 0; t < tweaks; t++) {
      const i = randInt(0, cols.length - 1);
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
    const grid = emptyGrid(st);
    for (let y = 0; y < (st.rows || 5); y++) {
      for (let x = 0; x < cols.length; x++) grid[y][x] = cols[x];
    }
    return grid;
  }

  /* --- 3. Хаос: блоки в случайных местах (пустоты допустимы),
         прочность из относительной шкалы этапа, сумма точно в допуске. --- */
  function genChaos(st) {
    const grid = emptyGrid(st);
    const R = st.rows || 5;
    const aim = randInt(st.target - st.tol, st.target + st.tol);

    // плотность тоже случайная: иногда реже и прочнее, иногда чаще и слабее
    const avgPick = randInt(st.min, st.max);
    const nLo = Math.ceil(aim / st.max);
    const nHi = Math.min(st.cells, Math.floor(aim / st.min));
    const n = Math.min(Math.max(Math.round(aim / avgPick), nLo), nHi);

    const all = [];
    for (let y = 0; y < R; y++) for (let x = 0; x < st.cols; x++) {
      if (st.excl && st.excl.some(c => c[0] === x && c[1] === y)) continue;  // зона босса
      all.push([y, x]);
    }
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
         при которой чистая доска не вылезает за допуск; слабая
         величина W — минимум шкалы, но если доска не дотягивается
         до допуска (высокие цели убойного режима), W поднимается.
         Итог по обычному режиму: 66 / 114 / 182 / 272 / 362. --- */
  function genGrid(st) {
    const lo = st.target - st.tol, hi = st.target + st.tol;
    const R = st.rows || 5;
    const parity = randInt(0, 1);               // чётность «сильных» клеток
    let nStrong = 0;
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < st.cols; x++) if ((x + y) % 2 === parity) nStrong++;
    }
    const nWeak = st.cells - nStrong;

    // максимальная прочность сильной клетки с чистой доской в допуске
    let S = st.min + 1;
    for (let s = st.max; s >= st.min + 1; s--) {
      if (nStrong * s + nWeak * st.min <= hi) { S = s; break; }
    }
    // слабая величина: min, а если не дотягиваемся — поднимаем
    let W = st.min;
    if (nStrong * S + nWeak * W < lo) {
      W = clamp(Math.ceil((lo - nStrong * S) / nWeak), st.min, S);
    }

    const grid = emptyGrid(st);
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < st.cols; x++) {
        grid[y][x] = ((x + y) % 2 === parity) ? S : W;
      }
    }

    // если чистая доска всё же выше допуска — демотируем сильные клетки
    let sum = total(grid), guard = 200;
    while (sum > hi && guard-- > 0) {
      const cands = [];
      for (let y = 0; y < R; y++) {
        for (let x = 0; x < st.cols; x++) {
          if ((x + y) % 2 === parity && grid[y][x] > W) cands.push([y, x]);
        }
      }
      if (!cands.length) break;
      const [y, x] = cands[randInt(0, cands.length - 1)];
      grid[y][x]--;
      sum--;
    }
    return grid;
  }

  /* --- 5. Зигзаг: диагональ max-блоков (на 9 колоннах — 2;5 – 6;1,
         левый верхний угол = 0;0), от неё по горизонтали расходится
         градиент прочности (шаг 1–2 за клетку, не ниже min этапа).
         С вероятностью 50% — зеркало. Если максимум «полного»
         градиента не дотягивается до допуска (убойный режим),
         диагональ становится полосой толщиной w: w подбирается
         минимальной, чтобы поле достало до нижней границы допуска,
         а дальше шаги расширяются до случайной цели в допуске. --- */
  function genZigzag(st) {
    const lo = st.target - st.tol, hi = st.target + st.tol;
    const cols = st.cols, R = st.rows || 5;
    const mirror = Math.random() < 0.5;
    const anchorX = (y) => mirror ? (2 + y) : (cols - 3 - y);

    // максимум суммы при толщине полосы w (все шаги = 1)
    const maxSumFor = (w) => {
      let s = 0;
      for (let y = 0; y < R; y++) {
        const ax = anchorX(y);
        for (let x = 0; x < cols; x++) {
          const d = Math.abs(x - ax);
          s += (d <= w - 1) ? st.max : Math.max(st.min, st.max - (d - w + 1));
        }
      }
      return s;
    };
    let w = 1;
    while (w < cols && maxSumFor(w) < lo + 8) w++;

    // steps[y][k] — шаг градиента между k-й и (k+1)-й клеткой от края полосы
    const steps = [];
    for (let y = 0; y < R; y++) steps.push(Array(Math.max(1, cols - 1)).fill(1));

    function build() {
      const grid = emptyGrid(st);
      for (let y = 0; y < R; y++) {
        const ax = anchorX(y);
        grid[y][ax] = st.max;
        let v = st.max;                          // вправо от якоря
        for (let x = ax + 1; x < cols; x++) {
          const d = x - ax;
          if (d <= w - 1) { grid[y][x] = st.max; v = st.max; }
          else { v = Math.max(st.min, v - steps[y][d - w]); grid[y][x] = v; }
        }
        v = st.max;                              // влево от якоря
        for (let x = ax - 1; x >= 0; x--) {
          const d = ax - x;
          if (d <= w - 1) { grid[y][x] = st.max; }
          else { v = Math.max(st.min, v - steps[y][d - w]); grid[y][x] = v; }
        }
      }
      return grid;
    }

    let grid = build();
    let sum = total(grid);
    // все шаги = 1 дают максимум; ослабляем до случайной цели в допуске
    const aim = randInt(lo, Math.min(hi, sum));
    let guard = 600;
    while (sum > aim && guard-- > 0) {
      const y = randInt(0, R - 1), k = randInt(0, cols - 2);
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

  /* --- 0. Rigged: все блоки ×10 независимо от этапа (450 / 650 очков). --- */
  function genRigged(st) {
    const grid = emptyGrid(st);
    for (let y = 0; y < (st.rows || 5); y++) for (let x = 0; x < st.cols; x++) grid[y][x] = 10;
    return grid;
  }

  /* --- Мутации: особые блоки поздних этапов ----------------------
     Телепорт (4), Вверх-вниз (6), Вправо-влево (6), Блоко-Змей (5)
     замещают блоки СВОЕЙ прочности; если таких в расстановке нет
     (поздние этапы стартуют с 6–8), им достаются блоки НАИМЕНЬШЕЙ
     прочности — как и телепорту всегда (у него всего 4, а мутации
     начинаются с этапов, где 4 уже не бывает).
     Шароблок — особый случай: заранее выбранная клетка из ПЕРВЫХ ДВУХ
     РЯДОВ СНИЗУ (ближе к платформе — от них есть смысл; не больше 4
     на ряд), ему сразу назначается прочность 1–10, которая откроется
     после спадения щита. В расстановку попадает с этой прочностью,
     счёт уровня считается по итоговой сетке. --- */
  function applyMutations(grid, st) {
    const mutants = [];
    if (!st.mut) return mutants;

    const rows = st.rows || CFG.ROWS;
    const cells = [];
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < grid[y].length; x++)
        if (grid[y][x] > 0) cells.push({ x, y, hp: grid[y][x] });
    if (!cells.length) return mutants;

    const wanted = Math.round(cells.length * st.mut);
    if (wanted < 1) return mutants;
    const taken = new Set();
    const key = c => c.x + ',' + c.y;

    /* 1. Шароблоки: первые два ряда СНИЗУ, ≤ 4 на ряд */
    let nBall = Math.min(Math.ceil(wanted * 0.25), 8);
    const rowCnt = {};
    for (let y = rows - 2; y < rows; y++) rowCnt[y] = 0;
    const ballCands = shuffle(cells.filter(c => c.y >= rows - 2));
    for (const c of ballCands) {
      if (nBall <= 0) break;
      if (rowCnt[c.y] >= 4) continue;
      taken.add(key(c));
      rowCnt[c.y]++;
      const hp = randInt(1, 10);            // будущая прочность — заранее
      grid[c.y][c.x] = hp;
      mutants.push({ x: c.x, y: c.y, kind: 'ball', hp });
      nBall--;
    }

    /* 2. Движущиеся и телепорт: деление остатка бюджета.
       Пулы строятся заново на каждом шаге (клетки занимается по одной),
       поэтому одна и та же клетка не может достаться двум мутантам. */
    const kinds = ['updown', 'rightleft', 'snake', 'teleport'];
    let budget = wanted - mutants.length;
    const bag = [];
    while (budget-- > 0) bag.push(kinds[bag.length % 4]);
    shuffle(bag);

    const freeCells = wantHp => {
      let minHp = Infinity;
      for (const c of cells) if (!taken.has(key(c))) minHp = Math.min(minHp, c.hp);
      const aim = wantHp > 0 && cells.some(c => !taken.has(key(c)) && c.hp === wantHp)
        ? wantHp : minHp;
      return cells.filter(c => !taken.has(key(c)) && c.hp === aim);
    };
    const pickFrom = pool => (pool.length ? pool[randInt(0, pool.length - 1)] : null);

    for (const kind of bag) {
      const want = (kind === 'updown' || kind === 'rightleft') ? 6
                 : (kind === 'snake') ? 5 : -1;
      let c = pickFrom(freeCells(want));
      if (!c) {                                   // свой пул иссяк — любой доступный
        for (const k2 of kinds) {
          const w2 = (k2 === 'updown' || k2 === 'rightleft') ? 6 : (k2 === 'snake') ? 5 : -1;
          c = pickFrom(freeCells(w2));
          if (c) break;
        }
      }
      if (!c) break;                              // свободных блоков не осталось
      taken.add(key(c));
      const hp = MUTANTS[kind].hp;
      grid[c.y][c.x] = hp;
      mutants.push({ x: c.x, y: c.y, kind, hp });
    }
    return mutants;
  }

  /* Зона босса на 10-м этапе ада: 5×3 в центре задних (верхних) рядов.
     Колонки 7..11 из 19 — центр ровно посередине поля. */
  function bossArea(st) {
    const x0 = Math.floor((st.cols - 5) / 2);   // 7 при 19 колонках
    return { x: x0, y: 0, w: 5, h: 3 };
  }

  /* Жертвенные блоки под боссом: 15 клеток, суммарно РОВНО 100
     прочности (босс приземляется и ломает их все разом). */
  function placeSacrifice(grid, st) {
    const a = bossArea(st);
    const cells = [];
    for (let y = a.y; y < a.y + a.h; y++)
      for (let x = a.x; x < a.x + a.w; x++) cells.push([x, y]);
    const hp = cells.map(() => 6);              // 90 базовых
    let left = 100 - 6 * cells.length;          // раздать ещё 10
    let guard = 500;
    while (left > 0 && guard-- > 0) {
      const i = randInt(0, cells.length - 1);
      if (hp[i] < 10) { hp[i]++; left--; }
    }
    cells.forEach(([x, y], i) => { grid[y][x] = hp[i]; });
    return { area: a, total: hp.reduce((s, v) => s + v, 0) };
  }

  /* Цель базовой (до-мутационной) сетки: компенсируем ожидаемый дрейф
     прочности от замен, но не выше 95% максимума поля — иначе «Сетка»
     вырождается в сплошные десятки, а остальные — в «почти rigged». */
  function baseAimFor(st) {
    const comp = st.comp || 0;
    const cap = Math.floor(st.cells * st.max * 0.95);
    return Math.min(st.target + comp, cap);
  }

  /* Ремонт итога после мутаций: держим сумму в допуске этапа.
     Вверх — поднимаем самые слабые обычные блоки; если все уже
     максимумы (хаос любит такие поля) — отказываемся от последних
     мутантов, возвращая их клеткам исходную прочность («до X%»
     это разрешает). Вниз — снижаем самые прочные обычные. */
  function repairMutatedTotal(grid, st, mutants, baseGrid) {
    const lo = st.target - st.tol, hi = st.target + st.tol;
    let sum = total(grid);
    const mutSet = new Set(mutants.map(m => m.x + ',' + m.y));
    let guard = st.cells * 3;

    while (sum > hi && guard-- > 0) {
      let best = null;
      for (let y = 0; y < CFG.ROWS; y++) {
        for (let x = 0; x < grid[y].length; x++) {
          const v = grid[y][x];
          if (v > 0 && !mutSet.has(x + ',' + y) && v > st.min) {
            if (!best || v > grid[best.y][best.x]) best = { x, y };
          }
        }
      }
      if (!best) break;
      grid[best.y][best.x]--; sum--;
    }

    guard = st.cells * 3;
    while (sum < lo && guard-- > 0) {
      let best = null;
      for (let y = 0; y < CFG.ROWS; y++) {
        for (let x = 0; x < grid[y].length; x++) {
          const v = grid[y][x];
          if (v > 0 && !mutSet.has(x + ',' + y) && v < st.max) {
            if (!best || v < grid[best.y][best.x]) best = { x, y };
          }
        }
      }
      if (best) { grid[best.y][best.x]++; sum++; continue; }
      /* поднимать некого — сначала «повышаем» самых лёгких мутантов:
         телепорт (4) становится вверх-вниз (6), змей (5) — тоже */
      const t = mutants.find(m => m.kind === 'teleport');
      if (t) { t.kind = 'updown'; grid[t.y][t.x] = 6; sum += 6 - 4; continue; }
      const s = mutants.find(m => m.kind === 'snake');
      if (s) { s.kind = 'updown'; grid[s.y][s.x] = 6; sum += 6 - 5; continue; }
      const m = mutants.pop();                    // и только потом — минус мутант
      if (!m) break;
      mutSet.delete(m.x + ',' + m.y);
      sum += baseGrid[m.y][m.x] - grid[m.y][m.x];
      grid[m.y][m.x] = baseGrid[m.y][m.x];
    }
  }

  const GENERATORS = {
    0: genRigged,
    1: genRows,
    2: genColumns,
    3: genChaos,
    4: genGrid,
    5: genZigzag
  };

  /* Сгенерировать расстановку layoutId для этапа stageNum режима mode.
     Возвращает итоговую сетку (с мутациями), исходную (baseGrid —
     для структурных тестов), список мутантов и сумму очков.
     АД: этапы 4–9 — 13 колонн, полное поле десяток (номинальная цель
     ниже максимума 65×10=650 — ад не сверяет счёты, мутанты снижают
     сумму сколько хотят); 10-й этап — всегда Хаос 19×8, зона босса 5×3
     с жертвенными блоками ровно на 100 прочности (босс добавит свои 100). */
  function generate(stageNum, layoutId, mode) {
    const st = stageDef(stageNum, mode || 'normal');
    if (st.boss) layoutId = 3;                     // финал ада — всегда хаос
    const mutate = layoutId !== 0 && st.mut;
    let gst = st, sacrifice = null;

    if (st.hell && st.boss) {
      /* 10-й этап: зону босса держим пустой, остальное поле — плотный
         хаос десяток (~1120), чтобы после 80% мутантов осталось ~700;
         вместе с жертвой (100) и боссом (100) — около 1000 */
      const a = bossArea(st);
      const excl = [];
      for (let y = a.y; y < a.y + a.h; y++)
        for (let x = a.x; x < a.x + a.w; x++) excl.push([x, y]);
      gst = Object.assign({}, st, { target: 1120, tol: 12, excl });
    } else if (st.hell && st.fullBoard) {
      /* этапы 4–9 ада: полное поле — потолок клеток × максимум
         (tol 0 — иначе хаос иногда кладёт 44/45 клеток) */
      gst = Object.assign({}, st, { target: st.cells * st.max, tol: 0 });
    } else if (mutate) {
      /* база целится выше на ожидаемый дрейф мутаций и ходит поужее:
         расстановки с полной шириной допуска (хаос, зигзаг) иначе
         проваливаются под нижнюю границу после замен */
      gst = Object.assign({}, st, {
        target: baseAimFor(st),
        tol: Math.max(6, st.tol - (st.comp || 0) - 8)
      });
    }

    const grid = GENERATORS[layoutId](gst);
    const baseGrid = grid.map(row => row.slice());
    const mutants = mutate ? applyMutations(grid, st) : [];
    if (st.boss) sacrifice = placeSacrifice(grid, st);
    /* ремонт итога — только там, где цель достижима: адские fullBoard
       (4–9) и финал не чиним, там мутанты уводят сумму ниже номинала
       намеренно; hell-3 чинится как убойный (цель достижима) */
    if (mutate && (!st.hell || (!st.fullBoard && !st.boss))) {
      repairMutatedTotal(grid, st, mutants, baseGrid);
    }
    return {
      grid,
      baseGrid,
      mutants,
      sacrifice,
      boss: st.boss ? bossArea(st) : null,
      stage: stageNum,
      layoutId,
      cols: st.cols,
      rows: st.rows,
      total: total(grid) + (st.boss ? 100 : 0)
    };
  }

  /* Обычный выбор расстановки на этапе:
     1% — rigged, иначе случайная из 1..5 без повтора предыдущей.
     АД: финал — всегда хаос; на остальных этапах rigged не выпадает
     (дьявол не играет честно, но и не дарит 450 очков за так). */
  function pick(stageNum, lastLayoutId, mode) {
    const st = stageDef(stageNum, mode || 'normal');
    if (st.hell) {
      if (st.chaosOnly) return 3;
      const cands = [1, 2, 3, 4, 5].filter(id => id !== lastLayoutId);
      return cands[randInt(0, cands.length - 1)];
    }
    if (Math.random() < 0.01) return 0;
    const cands = [1, 2, 3, 4, 5].filter(id => id !== lastLayoutId);
    return cands[randInt(0, cands.length - 1)];
  }

  const Layouts = { generate, pick, baseAimFor };
  root.Layouts = Layouts;
  if (typeof module !== 'undefined' && module.exports) module.exports = Layouts;
})(typeof window !== 'undefined' ? window : globalThis);
