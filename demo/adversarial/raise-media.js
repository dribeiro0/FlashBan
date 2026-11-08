// Attacker script for raise-media.html. Instead of attacking FlashBan's cover,
// it raises the flashing canvas above it: max z-index on the canvas, and the
// canvas's container shown as the page's own top-layer popover, re-opened on
// every animation frame so it is always the newest (topmost) top-layer element.
// Pass: FlashBan still keeps the strobe hidden or softened on screen, or locks the page down.
(function () {
  "use strict";

  var stage = document.getElementById("stage");
  var box = document.getElementById("box");
  var startBtn = document.getElementById("start");
  var countEl = document.getElementById("attacks");
  var raises = 0;
  var raf = 0;
  var shown = 0;

  function attack() {
    stage.style.setProperty("z-index", "2147483647", "important");
    stage.style.setProperty("position", "relative", "important");
    try {
      if (box.matches(":popover-open")) box.hidePopover();
      box.showPopover();
      raises++;
    } catch (e) { /* no popover support */ }
  }

  function frame(now) {
    if (!startBtn.disabled) { stop(); return; } // run over
    attack();
    if (now - shown > 250) { shown = now; countEl.textContent = "Raised above everything " + raises + " times so far."; }
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(raf);
    try { if (box.matches(":popover-open")) box.hidePopover(); } catch (e) {}
    stage.style.removeProperty("z-index");
    stage.style.removeProperty("position");
    countEl.textContent = "Raised above everything " + raises + " times.";
  }

  // After fixture.js's own click handler, so the run has started (Start is disabled).
  startBtn.addEventListener("click", function () {
    if (!startBtn.disabled) return;
    raises = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  });
})();
