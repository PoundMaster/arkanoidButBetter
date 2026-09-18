/* ============================================================
   НЕОН·АРКАНОИД — интерфейс: HUD, баннеры, оверлеи
   ============================================================ */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let els = {};
  let bannerTimer = null;

  function statRow(label, value, strong) {
    return `<div class="row"><span>${label}</span><b class="${strong ? 'hi' : ''}">${value}</b></div>`;
  }

  const TEMPLATES = {
    menu(G) {
      return `
        <div class="p-title">НЕОН<span>·</span>АРКАНОИД</div>
        <div class="p-sub">5 этапов · 6 расстановок · прочность 1–10</div>
        <div class="p-record">РЕКОРД: <b>${G.record}</b></div>
        <div class="p-controls">
          <div><kbd>Мышь</kbd> / <kbd>◀</kbd> <kbd>▶</kbd><span>платформа · <b>ЛКМ</b> — переключение</span></div>
          <div><kbd>Enter</kbd><span>запуск шара</span></div>
          <div><kbd>Esc</kbd><span>пауза</span></div>
          <div><kbd>Пробел</kbd><span>автопилот (тест)</span></div>
          <div><kbd>F12</kbd><span>pickLayoutForStage(этап, 0–5)</span></div>
        </div>
        <button class="btn" id="ovBtn">ИГРАТЬ</button>`;
    },
    pause(G) {
      return `
        <div class="p-title sm">ПАУЗА</div>
        <div class="p-sub">Игра приостановлена</div>
        <div class="p-stats">
          ${statRow('Этап', G.stageNum + ' / 5')}
          ${statRow('Расстановка', G.layoutName)}
          ${statRow('Очки', G.score, true)}
          ${statRow('Рекорд', G.record)}
        </div>
        <button class="btn" id="ovBtn">ПРОДОЛЖИТЬ</button>
        <div class="p-eschint"><kbd>Esc</kbd> — вернуться в игру</div>`;
    },
    levelComplete(G) {
      const newRec = G.score > G.runStartRecord && G.score > 0;
      return `
        <div class="p-title sm">УРОВЕНЬ ПРОЙДЕН</div>
        ${newRec ? '<div class="p-newrec">НОВЫЙ РЕКОРД!</div>' : ''}
        <div class="p-stats">
          ${statRow('Расстановка', G.layoutName)}
          ${statRow('Очки за уровень', '+' + G.levelPoints, true)}
          ${statRow('Цель этапа', G.levelTargetText)}
          ${statRow('Всего очков', G.score)}
          ${statRow('Рекорд', G.record)}
        </div>
        <button class="btn" id="ovBtn">ДАЛЕЕ&nbsp;▶</button>`;
    },
    gameOver(G) {
      const newRec = G.score > G.runStartRecord && G.score > 0;
      return `
        <div class="p-title sm danger">ИГРА ОКОНЧЕНА</div>
        ${newRec ? '<div class="p-newrec">НОВЫЙ РЕКОРД!</div>' : ''}
        <div class="p-stats">
          ${statRow('Этап', G.stageNum + ' / 5')}
          ${statRow('Очки', G.score, true)}
          ${statRow('Рекорд', G.record)}
        </div>
        <button class="btn" id="ovBtn">ЗАНОВО</button>`;
    },
    victory(G) {
      const newRec = G.score > G.runStartRecord && G.score > 0;
      return `
        <div class="p-title sm win">ПОБЕДА!</div>
        <div class="p-sub">Все 5 этапов пройдены</div>
        ${newRec ? '<div class="p-newrec">НОВЫЙ РЕКОРД!</div>' : ''}
        <div class="p-stats">
          ${statRow('Итоговый счёт', G.score, true)}
          ${statRow('Рекорд', G.record)}
        </div>
        <button class="btn" id="ovBtn">ИГРАТЬ СНОВА</button>`;
    }
  };

  const ACTIONS = {
    menu(G) { G.startRun(1); },
    pause(G) { G.togglePause(); },
    levelComplete(G) { G.nextLevel(); },
    gameOver(G) { G.startRun(1); },
    victory(G) { G.startRun(1); }
  };

  const UI = {
    init() {
      els = {
        score: $('scoreVal'), stage: $('stageVal'), lives: $('livesVal'),
        layout: $('layoutVal'), record: $('recordVal'),
        autoChip: $('autoChip'), frame: $('frameWrap'), banner: $('banner'),
        overlay: $('overlay'), panel: $('overlayPanel'), restart: $('restartBtn')
      };
      els.restart.addEventListener('click', () => { root.Game.startRun(1); });
    },

    sync() {
      const G = root.Game;
      if (!G || !els.score) return;
      els.score.textContent = G.score;
      els.record.textContent = G.record;
      const inGame = G.state !== 'menu';
      els.stage.textContent = inGame ? `${G.stageNum}/5` : '–';
      els.layout.textContent = inGame ? G.layoutName : '–';
      if (inGame) {
        let s = '';
        for (let i = 0; i < 3; i++) s += `<i class="${i < G.lives ? '' : 'off'}"></i>`;
        els.lives.innerHTML = s;
      } else {
        els.lives.textContent = '–';
      }
      els.autoChip.classList.toggle('hidden', !G.autopilot);
      els.frame.classList.toggle('auto', G.autopilot);

      // индикатор режима управления внизу страницы
      const ctrl = document.getElementById('ctrlHint');
      if (ctrl) {
        ctrl.innerHTML = (G.controlMode === 'mouse')
          ? '<kbd>Мышь</kbd> платформа · <kbd>ЛКМ</kbd> → стрелки'
          : '<kbd>◀</kbd> <kbd>▶</kbd> платформа · <kbd>ЛКМ</kbd> → мышь';
      }
    },

    banner(title, sub, rigged) {
      const b = els.banner;
      b.innerHTML = `<div class="b-title">${title}</div><div class="b-sub">${sub}</div>`;
      b.classList.toggle('rigged', !!rigged);
      b.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => b.classList.remove('show'), 2000);
    },

    showOverlay(kind) {
      const G = root.Game;
      els.panel.innerHTML = TEMPLATES[kind](G);
      const btn = $('ovBtn');
      btn.addEventListener('click', () => ACTIONS[kind](G));
      els.overlay.classList.remove('hidden');
      this.sync();
    },

    hideOverlay() {
      els.overlay.classList.add('hidden');
    },

    clickPrimary() {
      const btn = $('ovBtn');
      if (btn && !els.overlay.classList.contains('hidden')) btn.click();
    }
  };

  root.UI = UI;
})(window);
