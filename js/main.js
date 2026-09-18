/* ============================================================
   НЕОН·АРКАНОИД — точка входа
   ============================================================ */
(function () {
  'use strict';
  const canvas = document.getElementById('game');
  window.UI.init();
  window.Game.init(canvas);
  window.UI.showOverlay('menu');
  window.UI.sync();
})();
