/* ============================================================
   НЕОН·АРКАНОИД — интерфейс: HUD, баннеры, оверлеи,
   окно усилений в паузе + предупреждение о запуске,
   панель усилений справа (режим стрелок)
   ============================================================ */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let els = {};
  let bannerTimer = null;

  const WARN_KEY = 'neonArkanoid.pwWarnOff';
  const RARITY_ORDER = ['common', 'epic', 'legendary', 'unknown'];

  function statRow(label, value, strong) {
    return `<div class="row"><span>${label}</span><b class="${strong ? 'hi' : ''}">${value}</b></div>`;
  }

  const TEMPLATES = {
    menu(G) {
      return `
        <div class="p-title">НЕОН<span>·</span>АРКАНОИД</div>
        <div class="p-sub">5 этапов · 6 расстановок · 11 усилений</div>
        <div class="p-record">РЕКОРД: <b>${G.record}</b></div>
        <div class="p-controls">
          <div><kbd>Мышь</kbd> / <kbd>◀</kbd> <kbd>▶</kbd><span>платформа · <b>ЛКМ</b> — переключение</span></div>
          <div><kbd>Enter</kbd><span>запуск шара</span></div>
          <div><kbd>Esc</kbd><span>пауза и усиления</span></div>
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
        <button class="btn btn-ghost pw-open" id="pwOpenBtn">УСИЛЕНИЯ</button>
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
    currentView: null,

    init() {
      els = {
        score: $('scoreVal'), stage: $('stageVal'), lives: $('livesVal'),
        layout: $('layoutVal'), record: $('recordVal'),
        autoChip: $('autoChip'), frame: $('frameWrap'), banner: $('banner'),
        overlay: $('overlay'), panel: $('overlayPanel'), restart: $('restartBtn'),
        fxChip: $('fxChip')
      };
      els.restart.addEventListener('click', () => { root.Game.startRun(1); });
      this.buildSidePanel();
    },

    get warnOff() {
      try { return localStorage.getItem(WARN_KEY) === '1'; } catch (e) { return false; }
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
      document.body.classList.toggle('keys-ctrl', G.controlMode === 'keys');

      // индикатор режима управления внизу страницы
      const ctrl = document.getElementById('ctrlHint');
      if (ctrl) {
        ctrl.innerHTML = (G.controlMode === 'mouse')
          ? '<kbd>Мышь</kbd> платформа · <kbd>ЛКМ</kbd> → стрелки'
          : '<kbd>◀</kbd> <kbd>▶</kbd> платформа · <kbd>ЛКМ</kbd> → мышь';
      }
      this.updateSidePanel();
    },

    fxChip(txt) {
      const el = els.fxChip;
      if (!el) return;
      el.classList.toggle('hidden', !txt);
      const b = el.querySelector('b');
      if (b) b.textContent = txt;
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
      if (kind === 'pause') {
        const pw = $('pwOpenBtn');
        if (pw) pw.addEventListener('click', () => this.showPowers());
      }
      els.overlay.classList.remove('hidden');
      this.currentView = kind;
      this.sync();
    },

    hideOverlay() {
      els.overlay.classList.add('hidden');
      this.currentView = null;
    },

    clickPrimary() {
      const btn = $('ovBtn');
      if (btn && !els.overlay.classList.contains('hidden')) btn.click();
    },

    /* ---------- усиления: окно в паузе ---------- */

    showPowers() {
      const G = root.Game, P = root.Powers;
      let html = `
        <div class="p-title sm">УСИЛЕНИЯ</div>
        <div class="p-sub">Активация автоматически продолжит игру</div>
        ${G.powerBusy ? '<div class="pw-busy">Идёт действие усиления — вся таблица станет доступной сразу после его конца</div>' : ''}
        <div class="pw-list">`;
      for (const rar of RARITY_ORDER) {
        html += `<div class="pw-group" style="--pw-color:${P.rarity[rar].color}">${P.rarity[rar].label}</div>`;
        for (const id of P.order) {
          const d = P.defs[id];
          if (d.rarity !== rar) continue;
          const n = P.count(id);
          const ok = n > 0 && G.canActivatePower(id);
          const desc = d.rarity === 'unknown'
            ? `${d.desc}<span class="pw-how">${d.howGet}</span>`
            : d.desc;
          html += `
            <button class="pw-row ${ok ? '' : 'off'}" data-pw="${id}" style="--pw-color:${P.rarity[rar].color}">
              <span class="pw-head"><b>${d.name}</b><i>×${n}</i></span>
              <span class="pw-desc">${desc}</span>
            </button>`;
        }
      }
      html += `</div>
        <button class="btn" id="ovBtn">НАЗАД</button>
        <div class="p-eschint"><kbd>Esc</kbd> — назад, к паузе</div>`;
      els.panel.innerHTML = html;
      els.overlay.classList.remove('hidden');
      this.currentView = 'powers';
      els.panel.querySelectorAll('.pw-row').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.classList.contains('off')) return;
          this.requestPower(btn.dataset.pw);
        });
      });
      $('ovBtn').addEventListener('click', () => this.showOverlay('pause'));
      this.sync();
    },

    requestPower(id) {
      if (this.warnOff) this.commitPower(id);
      else this.showWarning(id);
    },

    /* активировать и продолжить игру (из паузы она снимается сама) */
    commitPower(id) {
      const G = root.Game;
      this.currentView = null;
      if (!G.activatePower(id)) { this.showPowers(); return; }
      if (G.state === 'paused') G.togglePause();
    },

    /* предупреждение о запуске: игра продолжится, паузу можно будет
       вернуть, кроме усилений-сценок (это указано в их описании) */
    showWarning(id) {
      const d = root.Powers.defs[id];
      els.panel.innerHTML = `
        <div class="p-title sm">ВНИМАНИЕ</div>
        <div class="p-sub">${d.name}</div>
        <div class="pw-warn">
          После активации игра <b>сразу продолжится</b> — так работает запуск
          усиления из паузы. Снова поставить игру на паузу можно в любой
          момент, <b>кроме усилений-сценок</b>: пока такая сценка не
          закончится, пауза будет недоступна (это указано в их описании).
        </div>
        <label class="pw-check">
          <input type="checkbox" id="pwWarnChk"><span>Понял, не показывай опять.</span>
        </label>
        <button class="btn" id="ovBtn">АКТИВИРОВАТЬ</button>
        <button class="btn btn-ghost pw-open" id="pwCancelBtn">ОТМЕНА</button>`;
      els.overlay.classList.remove('hidden');
      this.currentView = 'warning';
      $('pwCancelBtn').addEventListener('click', () => this.showPowers());
      $('ovBtn').addEventListener('click', () => {
        const chk = $('pwWarnChk');
        if (chk && chk.checked) {
          try { localStorage.setItem(WARN_KEY, '1'); } catch (e) { /* ignore */ }
        }
        this.commitPower(id);
      });
    },

    /* Esc внутри окон усилений возвращает на шаг назад, а не в игру */
    handleEsc() {
      if (this.currentView === 'warning') { this.showPowers(); return true; }
      if (this.currentView === 'powers') { this.showOverlay('pause'); return true; }
      return false;
    },

    /* ---------- усиления: панель справа (режим стрелок) ---------- */

    buildSidePanel() {
      const P = root.Powers;
      const body = document.getElementById('pwBody');
      if (!body) return;
      let html = `<div class="pw-side-title">УСИЛЕНИЯ</div>`;
      for (const rar of RARITY_ORDER) {
        html += `<div class="pw-group" style="--pw-color:${P.rarity[rar].color}">${P.rarity[rar].label}</div>`;
        for (const id of P.order) {
          const d = P.defs[id];
          if (d.rarity !== rar) continue;
          const tip = d.rarity === 'unknown'
            ? `${d.desc}<br><i>${d.howGet}</i>`
            : d.desc;
          html += `
            <button class="pw-btn" data-pw="${id}" style="--pw-color:${P.rarity[rar].color}">
              <span class="pw-name">${d.name}</span>
              <b class="pw-cnt">×${P.count(id)}</b>
              <span class="pw-tip">${tip}</span>
            </button>`;
        }
      }
      body.innerHTML = html;
      body.querySelectorAll('.pw-btn').forEach(btn => {
        /* не красть фокус — Enter/стрелки остаются клавишами игры */
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => {
          const G = root.Game;
          const id = btn.dataset.pw;
          if (G.state === 'playing' && root.Powers.count(id) > 0 && G.canActivatePower(id)) {
            G.activatePower(id);
          }
        });
      });
    },

    updateSidePanel() {
      const G = root.Game, P = root.Powers;
      const body = document.getElementById('pwBody');
      if (!body || !G) return;
      body.querySelectorAll('.pw-btn').forEach(btn => {
        const id = btn.dataset.pw;
        const n = P.count(id);
        const ok = G.state === 'playing' && n > 0 && G.canActivatePower(id);
        btn.classList.toggle('off', !ok);
        const cnt = btn.querySelector('.pw-cnt');
        if (cnt) cnt.textContent = '×' + n;
      });
    }
  };

  root.UI = UI;
})(window);
