// Attacker script for overlay-killer.html (threat T6). While a run is active it
// tries to get rid of anything the page did not create, which includes the
// shield's overlay: hide it, remove it, close dialogs and popovers, and lay a
// max z-index layer of its own over the page. It runs on every animation frame
// and on every DOM insertion. Counts are shown on the page; the shield passes if
// the strobe stays covered for the whole run.
(function () {
  "use strict";

  var startBtn = document.getElementById("start");
  var countEl = document.getElementById("attacks");
  var mine = new Set(document.querySelectorAll("*")); // everything that exists before any run
  var counts = { removed: 0, hidden: 0, dialogs: 0, popovers: 0 };
  var active = false;
  var raf = 0;
  var shown = 0;

  // A full-page, transparent, max z-index layer of our own. pointer-events:none so the
  // operator can always reach Stop (Escape also works).
  var cover = document.createElement("div");
  cover.setAttribute("aria-hidden", "true");
  cover.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:transparent;pointer-events:none";
  mine.add(cover);

  function attack() {
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (mine.has(el)) continue;
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("opacity", "0", "important");
      el.style.setProperty("z-index", "-1", "important");
      el.setAttribute("hidden", "");
      counts.hidden++;
      el.remove();
      counts.removed++;
    }
    var dialogs = document.querySelectorAll("dialog[open]");
    for (var d = 0; d < dialogs.length; d++) if (!mine.has(dialogs[d])) { dialogs[d].close(); counts.dialogs++; }
    try {
      var pops = document.querySelectorAll(":popover-open");
      for (var p = 0; p < pops.length; p++) if (!mine.has(pops[p])) { pops[p].hidePopover(); counts.popovers++; }
    } catch (e) { /* no popover support */ }
    if (!cover.isConnected) document.body.appendChild(cover);
  }

  function show() {
    countEl.textContent = "Attacks so far: " + counts.removed + " removals, " + counts.hidden + " hides, " +
      counts.dialogs + " dialogs closed, " + counts.popovers + " popovers closed.";
  }

  function frame(now) {
    if (!startBtn.disabled) { stop(); return; } // run ended (Stop, Escape, hidden tab or time up)
    attack();
    if (now - shown > 250) { shown = now; show(); } // text updates 4 times a second, never per frame
    raf = requestAnimationFrame(frame);
  }

  var observer = new MutationObserver(function () { if (active) attack(); });

  function start() {
    if (active) return;
    active = true;
    counts = { removed: 0, hidden: 0, dialogs: 0, popovers: 0 };
    observer.observe(document.documentElement, { childList: true, subtree: true });
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    active = false;
    cancelAnimationFrame(raf);
    observer.disconnect();
    cover.remove();
    show();
  }

  // After fixture.js's own click handler, so the run has started (Start is disabled).
  startBtn.addEventListener("click", function () { if (startBtn.disabled) start(); });
})();
