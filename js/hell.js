/* ============================================================
   НЕОН·АРКАНОИД — АДСКИЙ РЕЖИМ: вход и сессия

   Вход всегда доступен из настроек новой игры: нужно нажать на
   кнопку регенерации жизней 15 раз. Первые пять нажатий кнопка
   молча терпит; с 6-го она начинает телепортироваться по панели
   (всё хаотичнее), по странице раскидываются трещины с лавой
   (статичные) и глюки (трясутся 5 раз в секунду), экран трясётся
   всё сильнее, а над меню появляются провожающие:
     3      — «Не следует столько нажимать - выбирай уже.»
     6      — «Говорил же, не стоит спамить - посмотри, что наделал.»
                (трещины, кнопка телепортируется)
     9      — «Серьезно, остановись, пока не раскрошил тут всё.»
                (глюки, тряска экрана)
     12     — «Последний шанс прекратить шалить.» (кнопка дрожит,
              свечение вокруг меню красно-оранжевое)
     15     — «Сам выбрал себе участь, грешный спамер.»
              (только при первом входе; дальше — «Ладно, дозволю
              на этот раз.»); после 15-го нажатия кнопка «Играть»
              закрывается глюком.
   Через 3 секунды экран схлопывается: элементы по порядку
   превращаются в глюки и, крутясь, падают в центр экрана.
   Дальше — чёрный экран, и через пару секунд «камера» зумит
   от ~80% размерного положения менюшки, поворачиваясь с 15°
   в обычное положение; движение — 3 секунды с замедлением,
   размытие уходит за 5 секунд.
   Из ада можно выйти только после 1 попытки пройти уровень.
   ============================================================ */
(function (root) {
  'use strict';
  const { randFloat, randInt, loadPref, savePref } = root;
  const SEEN_KEY = 'neonArkanoid.hellSeen';

  const MAX_CLICKS = 15;
  let clicks = 0;          // нажатий в текущем ритуале
  let doomed = false;      // 15-е нажатие сделано — пути назад нет
  let active = false;      // адская сессия (меню или забег)
  let collapsing = false;  // идёт схлопывание/кинематограф
  let fxLayer = null, blackEl = null, msgEl = null;
  let regenRow = null, panel = null;
  let timers = [];

  function T(fn, ms) { const t = setTimeout(fn, ms); timers.push(t); return t; }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  /* ---------- слой эффектов: трещины и глюки по странице ---------- */

  function ensureFx() {
    if (!fxLayer || !document.body.contains(fxLayer)) {
      fxLayer = document.createElement('div');
      fxLayer.id = 'hellRitualFx';
      document.body.appendChild(fxLayer);
    }
    return fxLayer;
  }
  function ensureBlack() {
    if (!blackEl || !document.body.contains(blackEl)) {
      blackEl = document.createElement('div');
      blackEl.id = 'hellBlack';
      blackEl.className = 'hidden';
      document.body.appendChild(blackEl);
    }
    return blackEl;
  }
  function fxCounts() {
    const l = ensureFx();
    return {
      cracks: l.querySelectorAll('.hell-crack').length,
      glitches: l.querySelectorAll('.hell-glitch').length
    };
  }

  /* трещина с лавой: тёмный разлом с яркой каймой — крупнее
     и плотнее прежнего, чтобы читались на любом фоне */
  function spawnCrack() {
    const l = ensureFx();
    const c = fxCounts();
    if (c.cracks >= 26) return;
    const el = document.createElement('div');
    el.className = 'hell-crack';
    const w = randInt(34, 132), h = randInt(12, 48);
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.left = randFloat(2, 94) + '%';
    el.style.top = randFloat(3, 92) + '%';
    el.style.transform = `rotate(${randFloat(-38, 38).toFixed(1)}deg)`;
    el.style.opacity = randFloat(0.78, 1).toFixed(2);
    l.appendChild(el);
  }

  /* глюк: плотная зелёная полоса, трясётся 5 раз в секунду */
  function spawnGlitch() {
    const l = ensureFx();
    const c = fxCounts();
    if (c.glitches >= 22) return;
    const el = document.createElement('div');
    el.className = 'hell-glitch';
    const w = randInt(38, 156), h = randInt(10, 38);
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.left = randFloat(2, 94) + '%';
    el.style.top = randFloat(3, 92) + '%';
    el.style.animationDelay = (randFloat(0, 0.2)).toFixed(2) + 's';
    el.style.opacity = randFloat(0.72, 1).toFixed(2);
    l.appendChild(el);
  }

  /* ---------- сообщения над меню ---------- */

  function hellSeen() { return loadPref('hellSeen', '0') === '1'; }
  function markHellSeen() { savePref('hellSeen', '1'); }

  function msgFor(n) {
    if (n >= 15) {
      return hellSeen()
        ? 'Ладно, <span class="hl">дозволю</span> на этот раз.'
        : 'Сам выбрал себе участь, <span class="hl">грешный спамер</span>.';
    }
    if (n >= 12) return 'Последний шанс прекратить шалить.';
    if (n >= 9)  return 'Серьезно, остановись, пока не раскрошил тут всё.';
    if (n >= 6)  return 'Говорил же, не стоит спамить - посмотри, что наделал.';
    if (n >= 3)  return 'Не следует столько нажимать - выбирай уже.';
    return '';
  }

  function setMsg(html) {
    if (!panel) return;
    if (!html) { if (msgEl) { msgEl.remove(); msgEl = null; } return; }
    if (!msgEl || !panel.contains(msgEl)) {
      msgEl = document.createElement('div');
      msgEl.className = 'hell-msg';
      panel.appendChild(msgEl);
    }
    msgEl.innerHTML = html;
    /* подпись последних диапазонов (с 12-го) слегка трясётся 5 раз в секунду */
    msgEl.classList.toggle('shake5', clicks >= 12);
  }

  /* ---------- тряска экрана (растёт с нажатиями) ---------- */

  function updateShake() {
    const amp = clicks < 9 ? 0 : clicks < 12 ? 1.5 : clicks < 15 ? 3 : 5;
    document.body.classList.toggle('ritual-shake', amp > 0);
    if (amp > 0) document.body.style.setProperty('--ritual-amp', amp + 'px');
  }

  /* ---------- кнопка-беглянка ---------- */

  /* первые 5 нажатий кнопка терпит и стоит на месте;
     с 6-го — телепортируется по панели всё хаотичнее */
  function moveRegenChaotic() {
    if (!regenRow || !panel) return;
    if (clicks < 6) return;
    const pr = panel.getBoundingClientRect();
    const rr = regenRow.getBoundingClientRect();
    if (rr.width < 2) return;
    const amp = Math.min(10 + (clicks - 5) * 10, 96);
    let dx = randFloat(-amp, amp), dy = randFloat(-amp * 0.7, amp * 0.7);
    /* не вылезать за пределы панели — кнопка должна оставаться нажимаемой */
    const cur = regenRow.__off || { x: 0, y: 0 };
    const baseL = rr.left - cur.x, baseT = rr.top - cur.y;
    const nx = Math.max(pr.left + 4 - baseL, Math.min(pr.right - rr.width - 4 - baseL, cur.x + dx));
    const ny = Math.max(pr.top + 4 - baseT, Math.min(pr.bottom - rr.height - 4 - baseT, cur.y + dy));
    const rot = clicks >= 12 ? randFloat(-2.5, 2.5) : 0;
    regenRow.__off = { x: nx, y: ny };
    regenRow.style.transition = 'none';
    regenRow.style.transform = `translate(${nx.toFixed(1)}px, ${ny.toFixed(1)}px) rotate(${rot.toFixed(1)}deg)`;
  }

  /* ---------- сам ритуал ---------- */

  function onRegenClick() {
    if (collapsing || doomed) return;
    clicks++;
    moveRegenChaotic();
    setMsg(msgFor(clicks));

    /* трещины начинаются с 6-го нажатия, глюки — с 9-го */
    if (clicks >= 6) {
      const nC = clicks >= 12 ? 2 : 1;
      for (let i = 0; i < nC; i++) spawnCrack();
    }
    if (clicks >= 9) {
      const nG = clicks >= 12 ? 2 : 1;
      for (let i = 0; i < nG; i++) spawnGlitch();
      spawnCrack();
    }
    updateShake();

    if (clicks >= 12 && panel) panel.classList.add('hell-glow');

    if (clicks >= MAX_CLICKS) {
      doomed = true;
      markHellSeen();
      /* кнопка «Играть» преждевременно закрывается глюком —
         раз уже переход в ад */
      const play = document.getElementById('ovBtn');
      if (play) {
        play.disabled = true;
        const cover = document.createElement('div');
        cover.className = 'glitch-cover';
        play.appendChild(cover);
      }
      updateShake();
      T(collapse, 3000);
    }
  }

  /* ---------- схлопывание экрана ---------- */

  function collapseElements(els) {
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    els.forEach((el, i) => {
      T(() => {
        if (!document.body.contains(el)) return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        const dx = cx - (r.left + r.width / 2);
        const dy = cy - (r.top + r.height / 2);
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
        el.style.setProperty('--cx', dx.toFixed(1) + 'px');
        el.style.setProperty('--cy', dy.toFixed(1) + 'px');
        el.style.setProperty('--rot', (randFloat(420, 900) * (Math.random() < 0.5 ? -1 : 1)).toFixed(0) + 'deg');
        el.classList.add('collapsing');
        void el.offsetWidth;
        el.classList.add('collapsing-anim');
      }, i * 75);
    });
    return els.length * 75 + 950;
  }

  function collapse() {
    if (collapsing) return;
    collapsing = true;
    /* участвуют все элементы по порядку: содержимое меню + глюки/трещины,
       а самой последней схлопывается рамка панели */
    const els = [];
    if (panel) els.push(...panel.querySelectorAll(':scope > *'));
    if (fxLayer) els.push(...fxLayer.children);
    if (panel) els.push(panel);
    const wait = collapseElements(els);
    T(() => {
      /* экран уходит в чёрный */
      const black = ensureBlack();
      black.classList.remove('hidden');
      black.style.transition = 'none';
      black.style.opacity = '0';
      void black.offsetWidth;
      black.style.transition = 'opacity .45s ease';
      black.style.opacity = '1';
      T(() => {
        clearRitual(true);
        /* тема ада включается под чёрным экраном */
        [document.body, document.documentElement].forEach(el =>
          el.classList.add('mode-hell'));
        /* через пару секунд — кинематограф */
        T(cinematic, 2000);
      }, 700);
    }, wait);
  }

  /* ---------- кинематограф: чёрный → зум с 80% и 15°, размытие 5 с ---------- */

  function cinematic() {
    const black = ensureBlack();
    active = true;
    if (root.Game) root.Game.hellExitLocked = true;
    /* адское меню новой игры — с анимацией «камеры» */
    root.UI && root.UI.showHellNewGame(true);
    const ov = document.getElementById('overlay');
    const pn = document.getElementById('overlayPanel');
    if (ov) ov.classList.add('hell-cine');
    if (pn) pn.classList.add('hell-cine');
    /* чёрный растворяется за те же 5 секунд, что уходит размытие */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        black.style.transition = 'opacity 5s linear';
        black.style.opacity = '0';
      });
    });
    T(() => {
      black.classList.add('hidden');
      if (ov) ov.classList.remove('hell-cine');
      if (pn) pn.classList.remove('hell-cine');
      collapsing = false;
    }, 5300);
  }

  /* ---------- сессия ---------- */

  function armRitual(p, row) {
    clearRitual();
    panel = p;
    regenRow = row;
    if (regenRow) {
      regenRow.__off = { x: 0, y: 0 };
      regenRow.style.transform = '';
    }
  }

  /* сброс ритуала (уход из меню, старт игры, победа над искушением) */
  function clearRitual(keepTheme) {
    clearTimers();
    clicks = 0; doomed = false;
    if (fxLayer) { fxLayer.remove(); fxLayer = null; }
    if (blackEl && !keepTheme) { blackEl.classList.add('hidden'); blackEl = null; }
    if (msgEl) { msgEl.remove(); msgEl = null; }
    if (regenRow) {
      regenRow.style.transform = '';
      regenRow.style.transition = '';
      regenRow.__off = { x: 0, y: 0 };
      const cover = regenRow.querySelector && regenRow.querySelector('.glitch-cover');
      if (cover) cover.remove();
    }
    if (panel) {
      panel.classList.remove('hell-glow');
      panel.querySelectorAll('.collapsing, .collapsing-anim').forEach(el => {
        el.classList.remove('collapsing', 'collapsing-anim');
        el.style.removeProperty('--cx');
        el.style.removeProperty('--cy');
        el.style.removeProperty('--rot');
      });
    }
    document.body.classList.remove('ritual-shake');
    document.body.style.removeProperty('--ritual-amp');
    if (!keepTheme) {
      document.getElementById('ovBtn') && (document.getElementById('ovBtn').disabled = false);
      const pc = document.querySelector('#ovBtn .glitch-cover');
      if (pc) pc.remove();
    }
  }

  /* выход из ада (после 1 попытки) — сессия завершена */
  function exitSession() {
    active = false;
    collapsing = false;
    clearRitual(false);
    if (root.Game) root.Game.hellExitLocked = true;
  }

  /* отладка: мгновенно пройти ритуал (для тестов без 15 нажатий) */
  function debugEnter(fast) {
    if (active || collapsing) return 'уже в аду';
    if (!panel || !document.body.contains(panel)) {
      root.UI && root.UI.showNewGame();
    }
    clicks = 15;
    doomed = true;
    markHellSeen();
    if (fast) { collapse(); return 'схлопывание запущено (быстро)'; }
    T(collapse, 3000);
    return 'переход в ад через 3 с';
  }

  root.Hell = {
    armRitual,
    clearRitual,
    exitSession,
    debugEnter,
    onRegenClick,
    get active() { return active; },
    get clicks() { return clicks; },
    get doomed() { return doomed; },
    get busy() { return collapsing; },
    get hellSeen() { return hellSeen(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
