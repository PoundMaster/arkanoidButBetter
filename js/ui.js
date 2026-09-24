/* ============================================================
   НЕОН·АРКАНОИД — интерфейс: HUD, баннеры, оверлеи,
   главное меню (продолжить/загрузить/новая игра/настройки/выход),
   меню новой игры (достижения, выбор режима, регенерация, магазин,
   кнопка «Играть» с плавным сиквенсом), финальный сиквенс режима
   Badass, окно усилений в паузе + предупреждение, панель справа
   ============================================================ */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let els = {};
  let bannerTimer = null;

  const WARN_KEY = 'neonArkanoid.pwWarnOff';
  const RARITY_ORDER = ['common', 'epic', 'legendary', 'unknown'];
  const { isBadassUnlocked, loadPref, savePref, clamp } = root;

  function statRow(label, value, strong) {
    return `<div class="row"><span>${label}</span><b class="${strong ? 'hi' : ''}">${value}</b></div>`;
  }

  const TEMPLATES = {
    /* Главное меню: название игры и 5 кнопок. Контроль, рекорд и
       описание контента живут в игре (HUD/подвал) — здесь их нет. */
    menu() {
      return `
        <div class="p-title">НЕОН<span>·</span>АРКАНОИД</div>
        <div class="menu-list">
          <button class="btn m-btn ph" id="mContinue" aria-disabled="true"><span>ПРОДОЛЖИТЬ ПРОШЛУЮ ИГРУ</span><i class="soon">скоро</i></button>
          <button class="btn m-btn ph" id="mLoad" aria-disabled="true"><span>ЗАГРУЗИТЬ СОХРАНЕНИЕ</span><i class="soon">скоро</i></button>
          <button class="btn m-btn" id="ovBtn">НОВАЯ ИГРА</button>
          <button class="btn m-btn ph" id="mSettings" aria-disabled="true"><span>НАСТРОЙКИ</span><i class="soon">скоро</i></button>
          <button class="btn m-btn m-exit" id="mExit">ВЫХОД</button>
        </div>`;
    },
    pause(G) {
      const hell = G.mode === 'hell';
      const locked = hell && G.hellExitLocked;
      const noPw = hell && G.hellStage10;
      return `
        <div class="p-title sm">ПАУЗА</div>
        <div class="p-sub">Игра приостановлена${hell ? ' · АД' : (G.mode === 'badass' ? ' · УБОЙНЫЙ' : '')}</div>
        <div class="p-stats">
          ${statRow('Этап', G.stageNum + ' / ' + G.stagesTotal)}
          ${statRow('Расстановка', G.layoutName)}
          ${statRow('Очки', G.score, true)}
          ${statRow('Рекорд', G.record)}
        </div>
        <button class="btn" id="ovBtn">ПРОДОЛЖИТЬ</button>
        <button class="btn btn-ghost pw-open${noPw ? ' cracked" disabled="disabled' : ''}" id="pwOpenBtn">УСИЛЕНИЯ</button>
        <button class="btn btn-ghost${locked ? ' hell-locked' : ''}" id="menuExitBtn">В ГЛАВНОЕ МЕНЮ</button>
        <div class="p-eschint"><kbd>Esc</kbd> — вернуться в игру</div>`;
    },
    levelComplete(G, finale) {
      const newRec = G.score > G.runStartRecord && G.score > 0;
      const hell = G.mode === 'hell';
      return `
        <div class="p-title sm">УРОВЕНЬ ПРОЙДЕН</div>
        ${finale ? `<div class="p-finale">${hell ? 'Впереди Сатана — не отвлекайся на мелочь' : 'Впереди финальный этап — поле расширится'}</div>` : ''}
        ${newRec ? '<div class="p-newrec">НОВЫЙ РЕКОРД!</div>' : ''}
        <div class="p-stats">
          ${statRow('Расстановка', G.layoutName)}
          ${statRow('Очки за уровень', '+' + G.levelPoints, true)}
          ${statRow('Цель этапа', G.levelTargetText)}
          ${G.lastRegenGain ? statRow('Регенерация', '+1 жизнь', true) : ''}
          ${statRow('Всего очков', G.score)}
          ${statRow('Рекорд', G.record)}
        </div>
        <button class="btn" id="ovBtn">${finale ? (hell ? 'К АДСКОМУ ФИНАЛУ&nbsp;▶' : 'К ФИНАЛУ&nbsp;▶') : 'ДАЛЕЕ&nbsp;▶'}</button>`;
    },
    gameOver(G) {
      const newRec = G.score > G.runStartRecord && G.score > 0;
      return `
        <div class="p-title sm danger">ИГРА ОКОНЧЕНА</div>
        ${newRec ? '<div class="p-newrec">НОВЫЙ РЕКОРД!</div>' : ''}
        <div class="p-stats">
          ${statRow('Режим', G.mode === 'hell' ? 'Адский' : (G.mode === 'badass' ? 'Убойный' : 'Обычный'))}
          ${statRow('Этап', G.stageNum + ' / ' + G.stagesTotal)}
          ${statRow('Очки', G.score, true)}
          ${statRow('Рекорд', G.record)}
        </div>
        <button class="btn" id="ovBtn">В ГЛАВНОЕ МЕНЮ</button>`;
    },
    victory(G) {
      const newRec = G.score > G.runStartRecord && G.score > 0;
      const unlock = G.mode === 'normal' && G.badassJustUnlocked;
      const hell = G.mode === 'hell';
      return `
        <div class="p-title sm win">ПОБЕДА!</div>
        ${hell
          ? '<div class="p-hell-hint">Тебе следует сфокусироваться<br>не на простых блоках.</div>'
          : `<div class="p-sub">Все ${G.stagesTotal} этапов пройдены${G.mode === 'badass' ? ' · режим УБОЙНЫЙ повержен' : ''}</div>`}
        ${unlock ? '<div class="p-unlock">ОТКРЫТ РЕЖИМ: УБОЙНЫЙ</div>' : ''}
        ${newRec ? '<div class="p-newrec">НОВЫЙ РЕКОРД!</div>' : ''}
        <div class="p-stats">
          ${statRow('Итоговый счёт', G.score, true)}
          ${statRow('Рекорд', G.record)}
        </div>
        <button class="btn" id="ovBtn">В ГЛАВНОЕ МЕНЮ</button>`;
    }
  };

  const ACTIONS = {
    menu() { root.UI.showNewGame(); },
    pause(G) { G.togglePause(); },
    levelComplete(G) { G.nextLevel(); },
    gameOver(G) { G.backToMenu(); },
    victory(G) { G.backToMenu(); }
  };

  const UI = {
    currentView: null,
    ngMode: 'normal',        // выбранный режим в меню новой игры
    ngRegen: false,          // чекбокс регенерации
    _hoverMode: null,        // режим под курсором в переключателе (для описания)

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
      els.stage.textContent = inGame ? `${G.stageNum}/${G.stagesTotal}` : '–';
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

    /* ---------- оверлеи ---------- */

    showOverlay(kind, opts) {
      const G = root.Game;
      opts = opts || {};
      els.panel.innerHTML = TEMPLATES[kind](G, opts.finale);
      els.panel.className = 'panel' + (kind === 'newgame' ? ' ng' : '');
      els.overlay.classList.toggle('finale', !!opts.finale);
      if (kind !== 'newgame') {
        const btn = $('ovBtn');
        if (btn) btn.addEventListener('click', () => ACTIONS[kind](G));
      }
      if (kind === 'menu') {
        /* главное меню нейтрально: снимаем фиолетовый/адский превью
           и прячем финальное сообщение */
        document.body.classList.remove('mode-badass');
        document.documentElement.classList.remove('mode-badass');
        document.body.classList.add('in-menu');
        this.showFinaleMsg(false);
        if (root.Hell && !root.Hell.doomed && !root.Hell.busy) root.Hell.clearRitual();
        this.bindMenu();
      }
      if (kind === 'pause') {
        const pw = $('pwOpenBtn');
        if (pw && !pw.disabled) pw.addEventListener('click', () => this.showPowers());
        else if (pw) {
          pw.addEventListener('click', () => {
            pw.classList.remove('deny');
            void pw.offsetWidth;
            pw.classList.add('deny');
          });
        }
        const mx = $('menuExitBtn');
        if (mx) mx.addEventListener('click', () => {
          /* из ада — только после 1 попытки пройти уровень */
          if (root.Game.mode === 'hell' && root.Game.hellExitLocked) {
            mx.classList.remove('deny');
            void mx.offsetWidth;
            mx.classList.add('deny');
            return;
          }
          this.exitToMenu();
        });
      }
      els.overlay.classList.remove('hidden');
      els.overlay.classList.remove('fading');
      this.currentView = kind;
      this.sync();
    },

    hideOverlay() {
      els.overlay.classList.add('hidden');
      els.overlay.classList.remove('finale', 'fading');
      this.currentView = null;
      this.stopExitDodge();
      /* чистим содержимое: у скрытых кнопок не должны срабатывать
         повешенные обработчики (например, при программном click()) */
      els.panel.innerHTML = '';
    },

    clickPrimary() {
      if (this._exitingMenu || this._transitioning) return;
      if (root.Hell && (root.Hell.doomed || root.Hell.busy)) return;
      const btn = $('ovBtn');
      if (btn && !els.overlay.classList.contains('hidden')) btn.click();
    },

    /* Плавный выход из паузы в главное меню — для удобства: окно паузы
       растворяется, и тут же плавно приезжает меню. */
    exitToMenu() {
      if (this._exitingMenu) return;
      this._exitingMenu = true;
      this.currentView = 'transition';
      els.overlay.classList.add('fading');
      setTimeout(() => {
        this._exitingMenu = false;
        root.Game.backToMenu();
      }, 480);
    },

    /* ---------- главное меню ---------- */

    bindMenu() {
      this.stopExitDodge();
      /* плейсхолдеры: лёгкое «отказное» покачивание */
      ['mContinue', 'mLoad', 'mSettings'].forEach(id => {
        const b = $(id);
        if (!b) return;
        b.addEventListener('click', () => {
          b.classList.remove('deny');
          void b.offsetWidth;
          b.classList.add('deny');
        });
      });
      /* выход: кнопка слегка увертывается от курсора (как в MiSide).
         Геометрия по макету пользователя:
         • реакция начинается только у самой кнопки (синие круги) —
           ZONE от края СТАТИЧНОЙ кнопки, а не текущей: зона не
           «ездит» за кнопкой и не разгоняет её по всему меню;
         • движение ограничено прямоугольником вокруг статичного
           места (зелёная рамка): вправо-вниз можно больше, вверх —
           совсем чуть-чуть, чтобы кнопка никогда не залезала на
           «НАСТРОЙКИ» при курсоре снизу;
         • у края зоны сдвиг минимальный, при курсоре прямо на
           кнопке — до предела прямоугольника.
         Статичный прямоугольник кэшируется при показе меню и
         пересчитывается при изменении окна. */
      const exitBtn = $('mExit');
      if (!exitBtn) return;
      const ZONE = 28;                          // радиус реакции от края кнопки
      const FULL = 30;                          // полный разгон при курсоре на кнопке
      const LIM = { xMin: -18, xMax: 26, yMin: -6, yMax: 24 }; // зелёный прямоугольник
      let base = null;                          // статичный rect кнопки
      const measure = () => {
        exitBtn.style.transform = '';
        const rr = exitBtn.getBoundingClientRect();
        /* скрытая (display:none) кнопка даёт нулевой rect — тогда
           base остаётся null и замер повторится лениво */
        base = (rr.width > 1 && rr.height > 1) ? rr : null;
      };
      measure();
      /* bindMenu вызывается ДО снятия .hidden с оверлея и до
         panelIn-анимации панели — переносим замер на после неё */
      setTimeout(() => { if (!exitBtn.style.transform) measure(); }, 420);
      const onResize = () => { measure(); };
      window.addEventListener('resize', onResize);
      const dodge = (e) => {
        if (this.currentView !== 'menu') return;
        if (!base) measure();                     // кнопка была скрыта при bind
        if (!base) return;
        const r = base;
        /* расстояние от курсора до статичного прямоугольника кнопки */
        const zx = Math.max(0, r.left - e.clientX, e.clientX - r.right);
        const zy = Math.max(0, r.top - e.clientY, e.clientY - r.bottom);
        const dOut = Math.hypot(zx, zy);
        if (dOut >= ZONE) { exitBtn.style.transform = ''; return; }
        const k = 1 - dOut / ZONE;              // 0 у синих точек → 1 на кнопке
        const s = FULL * Math.pow(k, 1.2);      // у края — минимальный
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let dx = cx - e.clientX, dy = cy - e.clientY;
        const d = Math.hypot(dx, dy);
        if (d < 1) { dx = 0.6; dy = 0.8; }      // курсор в центре — уход вниз-вправо
        else { dx /= d; dy /= d; }
        /* желаемый сдвиг → кламп в прямоугольник лимитов */
        let ox = dx * s, oy = dy * s * 0.85;
        /* страховка: не вылезать за пределы панели */
        const pr = els.panel.getBoundingClientRect();
        const minX = Math.max(LIM.xMin, pr.left - r.left + 6);
        const maxX = Math.min(LIM.xMax, pr.right - r.right - 6);
        const minY = Math.max(LIM.yMin, pr.top - r.top + 6);
        const maxY = Math.min(LIM.yMax, pr.bottom - r.bottom - 6);
        ox = clamp(ox, minX, maxX);
        oy = clamp(oy, minY, maxY);
        exitBtn.style.transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`;
      };
      document.addEventListener('pointermove', dodge);
      this._dodgeCleanup = () => {
        document.removeEventListener('pointermove', dodge);
        window.removeEventListener('resize', onResize);
        exitBtn.style.transform = '';
      };
      exitBtn.addEventListener('click', () => this.tryExit());
    },

    stopExitDodge() {
      if (this._dodgeCleanup) { this._dodgeCleanup(); this._dodgeCleanup = null; }
    },

    tryExit() {
      this.stopExitDodge();
      window.close();
      /* браузер не дал закрыть вкладку — возвращаемся мистическим тоном */
      setTimeout(() => { if (!document.hidden) this.showExitRefused(); }, 140);
    },

    showExitRefused() {
      els.panel.innerHTML = `
        <div class="p-title sm exit-t">НЕ ВЫХОДИ</div>
        <div class="p-sub">Вкладку закрыть может только тот, кто её открыл.</div>
        <div class="exit-note">Но если очень хочется — просто закрой вкладку руками.<br>Я не обижусь. Наверно.</div>
        <button class="btn" id="ovBtn">ЛАДНО, ОСТАЮСЬ</button>`;
      els.panel.className = 'panel';
      $('ovBtn').addEventListener('click', () => this.showOverlay('menu'));
      this.currentView = 'menu';
    },

    /* ---------- меню новой игры ---------- */

    showNewGame() {
      /* адская сессия — своё меню (дырка вместо регенерации,
         трещина на переключателе, глюки на выходе и магазине) */
      if (root.Hell && root.Hell.active) return this.showHellNewGame();
      this.stopExitDodge();
      const badassOk = isBadassUnlocked();
      this.ngMode = (badassOk && loadPref('mode', 'normal') === 'badass') ? 'badass' : 'normal';
      this.ngRegen = loadPref('regen', '0') === '1';
      this._hoverMode = null;

      els.panel.innerHTML = `
        <button class="ach-btn" id="achBtn" title="Достижения" aria-disabled="true">
          <span class="ach-d">Д</span><span class="ach-rest">остижения</span>
        </button>
        <button class="ng-back" id="ngBack" title="К главному меню">◀ НАЗАД</button>
        <div class="p-title sm">НОВАЯ ИГРА</div>
        <div class="p-sub">Настрой забег и вперёд</div>

        <div class="ng-block">
          <div class="ng-label">РЕЖИМ</div>
          <div class="mode-switch" id="modeSwitch">
            <div class="mode-thumb"></div>
            <button class="mode-opt" data-mode="normal" type="button">ОБЫЧНЫЙ</button>
            <button class="mode-opt ${badassOk ? '' : 'locked'}" data-mode="badass" type="button">УБОЙНЫЙ</button>
          </div>
          <div class="mode-desc" id="modeDesc"></div>
        </div>

        <button class="regen-row" id="regenRow" role="switch" aria-checked="false">
          <span class="regen-box"></span>
          <span class="regen-txt"><b>Регенерация жизней</b><i>После прохождения двух этапов восстанавливается 1 жизнь.</i></span>
        </button>

        <button class="btn ng-play" id="ovBtn">ИГРАТЬ</button>

        <div class="shop-slot"><span>МАГАЗИН УСИЛЕНИЙ · СКОРО</span></div>`;

      els.panel.className = 'panel ng';
      els.overlay.classList.remove('hidden');
      els.overlay.classList.remove('finale', 'fading');
      document.body.classList.add('in-menu');
      this.currentView = 'newgame';
      this.bindNewGame(badassOk);
      /* ритуал входа в ад: 15 нажатий на регенерацию */
      if (root.Hell) root.Hell.armRitual(els.panel, document.getElementById('regenRow'));
      this.sync();
    },

    /* ---------- адское меню новой игры ----------
       Раскиданных глюков больше нет — только трещины. Один глюк
       остаётся на стрелке к главному меню (выход из режима; пока
       не сделана 1 попытка пройти уровень — она закрыта), магазин
       усилений тоже за глюком, на переключателе режимов трещина
       (не выбран ни один), в подписи — «Добро пожаловать в Ад.»
       с эффектом неизвестных усилений. Регенерации вовсе нет —
       вместо чекбокса дырка (значение остаётся выставленным
       до перехода, но нигде не отображается). */
    showHellNewGame(cine) {
      this.stopExitDodge();
      const G = root.Game;
      const locked = G.hellExitLocked;
      els.panel.innerHTML = `
        <button class="ach-btn" id="achBtn" title="Достижения" aria-disabled="true">
          <span class="ach-d">Д</span><span class="ach-rest">остижения</span>
        </button>
        <button class="ng-back${locked ? ' hell-locked' : ''}" id="ngBack" title="${locked ? 'Пока нельзя' : 'К главному меню'}">◀ НАЗАД</button>
        <div class="p-title sm">НОВАЯ ИГРА</div>

        <div class="ng-block">
          <div class="ng-label">РЕЖИМ</div>
          <div class="mode-switch hell-cracked" id="modeSwitch">
            <div class="mode-thumb"></div>
            <button class="mode-opt" data-mode="normal" type="button" tabindex="-1">ОБЫЧНЫЙ</button>
            <button class="mode-opt" data-mode="badass" type="button" tabindex="-1">УБОЙНЫЙ</button>
            <div class="crack-cover"></div>
          </div>
          <div class="mode-desc hell-zalgo">Добро пожаловать в Ад.</div>
        </div>

        <div class="hell-hole"><i></i></div>

        <button class="btn ng-play" id="ovBtn">ИГРАТЬ</button>

        <div class="shop-slot hell-shop"><span>МАГАЗИН УСИЛЕНИЙ · СКОРО</span><div class="glitch-cover"></div></div>`;

      els.panel.className = 'panel ng' + (cine ? ' hell-cine' : '');
      els.overlay.classList.remove('hidden');
      els.overlay.classList.remove('finale', 'fading');
      document.body.classList.add('in-menu');
      this.currentView = 'newgame';

      const denyShake = (b) => {
        b.classList.remove('deny');
        void b.offsetWidth;
        b.classList.add('deny');
      };
      $('achBtn').addEventListener('click', () => denyShake($('achBtn')));
      $('ngBack').addEventListener('click', () => {
        if (G.hellExitLocked) { denyShake($('ngBack')); return; }
        /* выход из режима — попытка уже была сделана */
        G.backToMenu();
      });
      $('ovBtn').addEventListener('click', () => this.playTransition(true));
      this.sync();
    },

    bindNewGame(badassOk) {
      const sw = $('modeSwitch'), desc = $('modeDesc');
      /* описание под переключателем: при наведении — про режим под
         курсором (для закрытого Badass — своя фраза), без наведения —
         про выбранный режим */
      const setDesc = () => {
        if (this._hoverMode) {
          desc.classList.add('bro');
          desc.textContent = this._hoverMode === 'normal'
            ? 'Стандарт - ничего особенного, лил бро.'
            : (badassOk ? 'Испытай свою мощь, бро.'
                        : 'Пройди сначала базу, попытайся - подумай, пробуй, постарайся.');
          return;
        }
        desc.classList.remove('bro');
        desc.textContent = this.ngMode === 'badass'
          ? '6 этапов · ~2000 блоков · мутанты с 4-го · поле расширится · фиолет'
          : '5 этапов · ~950 блоков · мутанты на финале · как ты привык';
      };
      const applyMode = (m, user) => {
        if (m === 'badass' && !badassOk) {
          if (user) { sw.classList.remove('denied'); void sw.offsetWidth; sw.classList.add('denied'); }
          return;
        }
        if (m !== this.ngMode) {
          this.ngMode = m;
          savePref('mode', m);
          if (user) {
            const kick = (m === 'badass') ? 'kickR' : 'kickL';
            sw.classList.remove('kickL', 'kickR');
            void sw.offsetWidth;
            sw.classList.add(kick);
          }
        }
        sw.classList.toggle('on-badass', this.ngMode === 'badass');
        /* фиолетовый превью темы */
        document.body.classList.toggle('mode-badass', this.ngMode === 'badass');
        document.documentElement.classList.toggle('mode-badass', this.ngMode === 'badass');
        setDesc();
      };
      sw.querySelectorAll('.mode-opt').forEach(b => {
        b.addEventListener('click', () => applyMode(b.dataset.mode, true));
        b.addEventListener('mouseenter', () => { this._hoverMode = b.dataset.mode; setDesc(); });
        b.addEventListener('mouseleave', () => { this._hoverMode = null; setDesc(); });
      });
      applyMode(this.ngMode, false);

      /* регенерация жизней: чекбокс-кнопка (+ счётчик ритуала ада) */
      const regenRow = $('regenRow');
      const syncRegen = () => {
        regenRow.classList.toggle('on', this.ngRegen);
        regenRow.setAttribute('aria-checked', this.ngRegen ? 'true' : 'false');
      };
      regenRow.addEventListener('click', () => {
        this.ngRegen = !this.ngRegen;
        savePref('regen', this.ngRegen ? '1' : '0');
        syncRegen();
        root.Hell && root.Hell.onRegenClick();
      });
      syncRegen();

      /* достижения: плейсхолдер для расстановки элементов */
      $('achBtn').addEventListener('click', () => {
        const b = $('achBtn');
        b.classList.remove('deny');
        void b.offsetWidth;
        b.classList.add('deny');
      });
      $('ngBack').addEventListener('click', () => {
        /* 15-е нажатие сделано — назад хода нет */
        if (root.Hell && root.Hell.doomed) return;
        this.showOverlay('menu');
      });
      $('ovBtn').addEventListener('click', () => this.playTransition(false));
    },

    /* Сиквенс запуска (~1,2 с): модуль увеличивается и растворяется,
       размытие вокруг спадает, а игровые элементы вырастают из ~80%
       и проявляются — всё на безье-интерполяции. Канвас очищается
       сразу, до транзиции — кадры прошлой попытки не мелькают.
       В адской сессии запуск идёт в режим ада; регенерация берётся
       молча — та, что была выставлена до перехода. */
    playTransition(hellMode) {
      if (this._transitioning) return;
      if (root.Hell && (root.Hell.doomed || root.Hell.busy)) return;
      this._transitioning = true;
      const G = root.Game;
      const mode = hellMode ? 'hell' : this.ngMode;
      const regen = hellMode ? (loadPref('regen', '0') === '1') : this.ngRegen;
      this.stopExitDodge();
      root.Hell && root.Hell.clearRitual();
      G.wipeCanvas();                       // чистое поле до начала транзиции
      els.panel.classList.add('zoom-out');
      els.overlay.classList.add('unblur');
      document.body.classList.remove('in-menu');
      document.body.classList.add('intro-game');
      setTimeout(() => {
        this.hideOverlay();
        els.overlay.classList.remove('unblur');
        els.panel.classList.remove('zoom-out');
        G.startRun(1, null, { mode, regen });
        this._transitioning = false;
        setTimeout(() => document.body.classList.remove('intro-game'), 950);
      }, 640);
    },

    /* ---------- финальные сиквенсы (Badass и ад) ---------- */

    /* После 5-го этапа Badass: короткая пауза — и сообщение
       «Приготовься к финалу» с окном завершения этапа появляются
       вместе (сообщение выше окна и не перекрывает его). Окно
       закрывается с запаздыванием и фейдом (closeFinaleWindow).
       В аду то же происходит после 9-го этапа — с фиолетовой
       подсказкой «Тебе следует сфокусироваться не на простых
       блоках.» (базовый фиолетовый цвет, как у Badass). */
    beginFinale(hell) {
      clearTimeout(this._finaleTimer);
      this._finaleTimer = setTimeout(() => {
        const el = document.getElementById('finaleMsg');
        if (el) {
          el.textContent = hell
            ? 'Тебе следует сфокусироваться не на простых блоках.'
            : 'ПРИГОТОВЬСЯ К\u00A0ФИНАЛУ';
          el.classList.toggle('hell', false);
          el.classList.toggle('hell-hint', !!hell);
        }
        this.showFinaleMsg(true);
        this.showOverlay('levelComplete', { finale: true });
      }, 480);
    }
    ,
    /* Победа в аду: над окном победы — «Приветствую тебя, смертный.»
       размером из версии создания адского режима (clamp 17–26px,
       перенос строк), красным цветом адской темы; на самом окне —
       фиолетовая подсказка «Тебе следует сфокусироваться не на
       простых блоках.» двумя строками (см. шаблон victory) */
    hellVictory() {
      const el = document.getElementById('finaleMsg');
      if (el) {
        el.textContent = 'Приветствую тебя, смертный.';
        el.classList.remove('hell-hint');
        el.classList.add('hell');
      }
      this.showFinaleMsg(true);
      this.showOverlay('victory');
    },

    closeFinaleWindow() {
      clearTimeout(this._finaleTimer);
      this.showFinaleMsg(false);
      if (!els.overlay.classList.contains('hidden')) {
        els.overlay.classList.add('fading');
        setTimeout(() => {
          els.overlay.classList.add('hidden');
          els.overlay.classList.remove('fading', 'finale');
          if (this.currentView === 'levelComplete') this.currentView = null;
        }, 520);
      }
    },

    showFinaleMsg(on) {
      const el = document.getElementById('finaleMsg');
      if (el) el.classList.toggle('show', !!on);
    },

    /* ---------- усиления: окно в паузе ---------- */

    showPowers() {
      const G = root.Game, P = root.Powers;
      const hell = G.mode === 'hell';
      const gl = hell ? G.hellPwGlitch : { fired: false, live: false, done: false };
      /* фаза глюка на неизвестных усилениях: delay (ещё не появился)
         → fall (появляется гигантским и повёрнутым) → landed */
      const glitchPhase = (g) => g.live ? 'fall' : (g.done ? 'landed' : 'delay');
      /* случайный поворот ±30° и «гигантский» масштаб появления */
      const glitchVars = () => `--g-rot:${(Math.random() * 60 - 30).toFixed(1)}deg;` +
        `--g-scale:${(2.6 + Math.random() * 0.8).toFixed(2)}`;
      let html = `
        <div class="p-title sm">УСИЛЕНИЯ</div>
        <div class="p-sub">Активация автоматически продолжит игру</div>
        ${G.powerBusy ? '<div class="pw-busy">Идёт действие усиления — вся таблица станет доступной сразу после его конца</div>' : ''}
        ${G.hellStage10 ? '<div class="pw-burnt">Таблица усилений пылает — ад больше не даёт их использовать</div>' : ''}
        <div class="pw-list${G.hellStage10 ? ' burning' : ''}">`;
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
          /* в аду неизвестные усиления накрывает глюк (после первого
             переключения на стрелки на этом этапе) */
          const glitched = hell && d.rarity === 'unknown' && gl.fired;
          html += `
            <button class="pw-row ${ok ? '' : 'off'}${glitched ? ' pw-glitched' : ''}" data-pw="${id}" style="--pw-color:${P.rarity[rar].color}">
              <span class="pw-head"><b>${d.name}</b><i>×${n}</i></span>
              <span class="pw-desc">${desc}</span>
              ${glitched ? `<div class="pw-glitch" data-phase="${glitchPhase(gl)}" style="${glitchVars()}"></div>` : ''}
            </button>`;
        }
      }
      html += `</div>
        <button class="btn" id="ovBtn">НАЗАД</button>
        <div class="p-eschint"><kbd>Esc</kbd> — назад, к паузе</div>`;
      els.panel.innerHTML = html;
      els.panel.className = 'panel';
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
      els.panel.className = 'panel';
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

    /* Esc внутри окон возвращает на шаг назад, а не в игру.
       Пока идёт транзиция (пауза → меню) — Esc глотается.
       Пока ритуал ада дошёл до 15 нажатий или экран схлопывается —
       Esc вообще ничего не делает: участь уже выбрана. */
    handleEsc() {
      if (root.Hell && (root.Hell.doomed || root.Hell.busy)) return true;
      if (this._exitingMenu || this.currentView === 'transition') return true;
      if (this.currentView === 'newgame' && !this._transitioning) {
        if (root.Hell && root.Hell.doomed) return true;
        this.showOverlay('menu'); return true;
      }
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
      const hell = G.mode === 'hell';
      const gl = hell ? G.hellPwGlitch : { fired: false, live: false, done: false };
      const glitchPhase = (g) => g.live ? 'fall' : (g.done ? 'landed' : 'delay');
      body.querySelectorAll('.pw-btn').forEach(btn => {
        const id = btn.dataset.pw;
        const d = P.defs[id];
        const n = P.count(id);
        const ok = G.state === 'playing' && n > 0 && G.canActivatePower(id);
        btn.classList.toggle('off', !ok);
        /* в аду неизвестные усиления накрывает глюк — после первого
           переключения на стрелки; появление меняет фазу на «встал» */
        const glitched = hell && d.rarity === 'unknown' && gl.fired;
        btn.classList.toggle('pw-glitched', !!glitched);
        let glitchEl = btn.querySelector('.pw-glitch');
        if (glitched) {
          if (!glitchEl) {
            glitchEl = document.createElement('div');
            glitchEl.className = 'pw-glitch';
            glitchEl.style.setProperty('--g-rot', (Math.random() * 60 - 30).toFixed(1) + 'deg');
            glitchEl.style.setProperty('--g-scale', (2.6 + Math.random() * 0.8).toFixed(2));
            btn.appendChild(glitchEl);
          }
          glitchEl.dataset.phase = glitchPhase(gl);
        } else if (glitchEl) {
          glitchEl.remove();
        }
        const cnt = btn.querySelector('.pw-cnt');
        if (cnt) cnt.textContent = '×' + n;
      });
    }
  };

  root.UI = UI;
})(window);
