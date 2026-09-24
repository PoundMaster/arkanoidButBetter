/* ============================================================
   НЕОН·АРКАНОИД — отладочные инструменты
   pickLayoutForStage(stage, layout, mode) — вызов из консоли:
     stage  — номер этапа: 1..5 в обычном, 1..6 в Badass, 1..10 в аду;
     layout — идентификатор расстановки 0..5 (0 = rigged,
              1 = строки, 2 = столбцы, 3 = хаос, 4 = сетка, 5 = зигзаг;
              на 10-м этапе ада всегда хаос — параметр игнорируется);
     mode   — 'normal' (по умолчанию), 'badass' или 'hell'.
   Запускает новый забег сразу с указанного этапа и расстановки,
   сбрасывая очки и жизни, и возвращает сводку по уровню.

   Прочее:
     unlockBadass() / lockBadass() — открыть/закрыть режим Badass;
     winLevel()   — мгновенно пройти текущий уровень;
     loseLife()   — потерять одну жизнь.
   Мутанты (поздние этапы):
     Game.mutantsSnapshot() — живые мутанты с позициями;
     Game.debugHitMutant(вид) — ударить шаром по мутанту
       (teleport/updown/rightleft/snake/ball);
     Game.debugShieldTime(сек) — поджать щиты шароблоков.
   Ад:
     Hell.debugEnter() — мгновенно пройти ритуал 15 нажатий;
     Game.debugSkipBossIntro() — пропустить падение Сатаны;
     Game.debugNearKillBoss() — оставить Сатане 1 прочности;
     Game.debugSetCalm(сек) — промотать спокойствие после Сатаны;
     Game.debugBallFall() — уронить шар вниз (стена ада/щит);
     Game.bossSnapshot — состояние босса; Game.hellWallSnapshot — стена.
   ============================================================ */
(function (root) {
  'use strict';

  const STAGES = { normal: 5, badass: 6, hell: 10 };

  console.log(
    '%cНЕОН·АРКАНОИД%c загружен\n' +
    'Отладка: %cpickLayoutForStage(этап, расстановка 0–5, режим)%c\n' +
    '0 — rigged · 1 — строки · 2 — столбцы · 3 — хаос · 4 — сетка · 5 — зигзаг\n' +
    'Режимы: normal (1–5) · badass (1–6, финал 13 колонн) · hell (1–10: 4–9 — 13 колонн, финал 19×8 + Сатана)\n' +
    'Усиления: %cGame.activatePower(id)%c — life, rogue, split, paddle, gators, boss,\n' +
    'bomb, elephant, fist, globdtr, buff.gv · инвентарь: %cPowers.counts%c\n' +
    'Прочее: %cunlockBadass()/lockBadass()%c · %cwinLevel()%c · %closeLife()%c\n' +
    'Ад: %cHell.debugEnter()%c · %cGame.debugSkipBossIntro()%c · %cGame.debugNearKillBoss()%c · %cGame.debugSetCalm(сек)%c · %cGame.debugBallFall()%c\n' +
    'Стена ада: %cGame.hellWallSnapshot%c · Жирный шар: %cGame.bossBallSnapshot%c\n' +
    'Enter — запуск · Esc — пауза/усиления · ЛКМ — мышь/стрелки · Пробел — автопилот.',
    'font-weight:700;color:#7dff5a;text-shadow:0 0 8px #00e5ff',
    'color:inherit',
    'color:#00e5ff;font-weight:600',
    'color:inherit',
    'color:#9dffb0;font-weight:600',
    'color:inherit',
    'color:#9dffb0;font-weight:600',
    'color:inherit',
    'color:#d470ff;font-weight:600',
    'color:inherit',
    'color:#d470ff;font-weight:600',
    'color:inherit',
    'color:#d470ff;font-weight:600',
    'color:inherit',
    'color:#ff6a4a;font-weight:600',
    'color:inherit',
    'color:#ff6a4a;font-weight:600',
    'color:inherit',
    'color:#ff6a4a;font-weight:600',
    'color:inherit',
    'color:#ff6a4a;font-weight:600',
    'color:inherit',
    'color:#ffb347;font-weight:600',
    'color:inherit',
    'color:#ffb347;font-weight:600',
    'color:inherit'
  );

  root.pickLayoutForStage = function (stage, layout, mode) {
    /* legacy-алиасы: 'hard' -> 'badass' */
    const m = (mode === 'badass' || mode === 'hard') ? 'badass'
      : (mode === 'hell') ? 'hell' : 'normal';
    const maxStage = STAGES[m];
    const s = Number(stage), l = Number(layout);
    if (!Number.isInteger(s) || s < 1 || s > maxStage) {
      const msg = `Неверный этап: ${JSON.stringify(stage)}. Допустимо целое 1–${maxStage}${m !== 'normal' ? ` (${m})` : ''}.`;
      console.warn(msg);
      return { error: msg };
    }
    if (!Number.isInteger(l) || l < 0 || l > 5) {
      const msg = `Неверная расстановка: ${JSON.stringify(layout)}. Допустимо целое 0–5 (0 = rigged).`;
      console.warn(msg);
      return { error: msg };
    }
    if (!root.Game) {
      const msg = 'Игра ещё не инициализирована.';
      console.warn(msg);
      return { error: msg };
    }
    const info = root.Game.debugStart(s, l, m);
    console.log(
      `%c▶ [${info['режим']}] Этап ${s} — «${info['расстановка']}»%c: ${info['блоков']} блоков (${info['колонн']} колонн), ${info['очки уровня']} очков (цель ${info['цель этапа']})`,
      'color:#7dff5a;font-weight:700',
      'color:inherit'
    );
    console.table ? (console.table({ [info['расстановка']]: info })) : console.log(info);
    return info;
  };

  /* быстрые обёртки для тестов */
  root.unlockBadass = function () { root.setBadassUnlocked(); return 'Режим Badass открыт.'; };
  root.lockBadass = function () { root.clearBadassUnlock(); return 'Режим Badass закрыт (для тестов).'; };
  root.winLevel = function () {
    const ok = root.Game.debugWinLevel();
    return ok ? 'Уровень пройден.' : 'Нельзя: игра не в состоянии playing.';
  };
  root.loseLife = function () {
    const ok = root.Game.debugLoseLife();
    return ok ? 'Жизнь потеряна.' : 'Нельзя: игра не в состоянии playing.';
  };
})(window);
