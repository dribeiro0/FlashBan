// Attacker script for the soften-killer pages. FlashBan softens instead of covering:
// it slows CSS animations (playbackRate) and adds a slow inline transition to
// elements that flicker via class toggles. Both live in state the page controls,
// so during a run this script undoes them on every animation frame. Pass: FlashBan
// notices (tampering) and covers or locks the page down. "Softened" while this runs
// means the attack won.
(function () {
  "use strict";

  var stage = document.getElementById("stage");
  var startBtn = document.getElementById("start");
  var countEl = document.getElementById("attacks");
  var undone = 0;
  var raf = 0;
  var shown = 0;

  function attack() {
    if (stage.dataset.kind === "css") {
      var anims = stage.getAnimations();
      for (var i = 0; i < anims.length; i++) {
        if (anims[i].playbackRate !== 1) { anims[i].playbackRate = 1; undone++; }
      }
    } else if (stage.style.getPropertyValue("transition")) {
      stage.style.removeProperty("transition");
      undone++;
    }
  }

  function frame(now) {
    if (!startBtn.disabled) { countEl.textContent = "Soften undone " + undone + " times."; return; } // run over
    attack();
    if (now - shown > 250) { shown = now; countEl.textContent = "Soften undone " + undone + " times so far."; }
    raf = requestAnimationFrame(frame);
  }

  // After fixture.js's own click handler, so the run has started (Start is disabled).
  startBtn.addEventListener("click", function () {
    if (!startBtn.disabled) return;
    undone = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  });
})();
