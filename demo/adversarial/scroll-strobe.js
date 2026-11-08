// Attacker script for scroll-strobe.html (CSS animation bound to scrolling).
// The stage's background-color animation runs on a scroll timeline, not on time:
// 10 dark/light cycles across the page's scroll range. During a run this script
// scrolls the page down and up once a second, which plays those 10 cycles each
// second (about 10 Hz). A real attacker would rely on the user scrolling.
(function () {
  "use strict";

  var stage = document.getElementById("stage");
  var startBtn = document.getElementById("start");
  var raf = 0;
  var t0 = 0;

  function frame(now) {
    if (!startBtn.disabled) { stop(); return; } // run over (Stop, Escape, hidden tab or time up)
    var max = document.documentElement.scrollHeight - innerHeight;
    var phase = ((now - t0) / 1000) % 2; // 0..2: down for 1 s, up for 1 s
    var y = phase < 1 ? phase : 2 - phase;
    scrollTo(0, Math.round(y * max));
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(raf);
    stage.classList.remove("scroll-run");
    scrollTo(0, 0);
  }

  // After fixture.js's own click handler, so the run has started (Start is disabled).
  startBtn.addEventListener("click", function () {
    if (!startBtn.disabled) return;
    stage.classList.add("scroll-run");
    t0 = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  });
})();
