/* ============================================================
   НЕОН·АРКАНОИД — отладочные инструменты
   pickLayoutForStage(stage, layout) — вызов из консоли браузера:
     stage  — номер этапа 1..5;
     layout — идентификатор расстановки 0..5 (0 = rigged,
              1 = строки, 2 = столбцы, 3 = хаос, 4 = сетка, 5 = зигзаг).
   Запускает новый забег сразу с указанного этапа и расстановки,
   сбрасывая очки и жизни, и возвращает сводку по уровню.
   ============================================================ */
(function (root) {
  'use strict';

  console.log(
    '%cНЕОН·АРКАНОИД%c загружен\n' +
    'Отладка: %cpickLayoutForStage(этап 1–5, расстановка 0–5)%c\n' +
    '0 — rigged · 1 — строки · 2 — столбцы · 3 — хаос · 4 — сетка · 5 — зигзаг\n' +
    'Enter — запуск шара · Esc — пауза · ЛКМ — мышь/стрелки · Пробел — автопилот.',
    'font-weight:700;color:#7dff5a;text-shadow:0 0 8px #00e5ff',
    'color:inherit',
    'color:#00e5ff;font-weight:600',
    'color:inherit'
  );

  root.pickLayoutForStage = function (stage, layout) {
    const s = Number(stage), l = Number(layout);
    if (!Number.isInteger(s) || s < 1 || s > 5) {
      const msg = `Неверный этап: ${JSON.stringify(stage)}. Допустимо целое 1–5.`;
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
    const info = root.Game.debugStart(s, l);
    console.log(
      `%c▶ Этап ${s} — «${info['расстановка']}»%c: ${info['блоков']} блоков, ${info['очки уровня']} очков (цель ${info['цель этапа']})`,
      'color:#7dff5a;font-weight:700',
      'color:inherit'
    );
    console.table ? (console.table({ [info['расстановка']]: info })) : console.log(info);
    return info;
  };
})(window);
