// CPU flood (threat T5): 40 small canvases, each flashing at 4 cycles per
// second with its own random phase (so they never flip together), plus busy
// work on every animation frame. No single tile is big enough to violate on its
// own, and checking all of them stretches the extension's per-page budget.
// Pass: FlashBan still protects the user: it softens, covers or dims the tiles
// (cross-element area, "too much moving media", or the cost budget).
// Fail: the tiles flash undimmed.
// Safety: same dim colours as the other fixtures, Start-gated, bounded run,
// stops on Stop / Escape / hidden tab, static under reduced motion.
(function () {
  "use strict";

  var DARK = "#222222";
  var LIGHT = "#777777";
  var TILES = 40;
  var COLS = 8;
  var W = 60;
  var H = 40;
  var HZ = 4;
  var BUSY_MS = 8; // busy work per frame

  var grid = document.getElementById("grid");
  var startBtn = document.getElementById("start");
  var stopBtn = document.getElementById("stop");
  var status = document.getElementById("status");
  var params = new URLSearchParams(location.search);
  var seconds = Math.min(10, Math.max(1, Number(params.get("seconds")) || 3));

  var tiles = [];
  for (var i = 0; i < TILES; i++) {
    var c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    c.className = "tile";
    c.setAttribute("aria-hidden", "true");
    grid.appendChild(c);
    var ctx = c.getContext("2d");
    ctx.fillStyle = DARK;
    ctx.fillRect(0, 0, W, H);
    tiles.push({ ctx: ctx, phase: Math.random() * 250, last: null });
  }
  grid.style.gridTemplateColumns = "repeat(" + COLS + ", " + W + "px)";

  var running = false;
  var raf = 0;

  function say(t) { status.textContent = t; }
  function setRunning(on) {
    running = on;
    startBtn.disabled = on;
    stopBtn.disabled = !on;
  }
  function paintAll(elapsed) {
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var light = Math.floor(((elapsed + t.phase) * HZ * 2) / 1000) % 2 === 1;
      if (light === t.last) continue;
      t.last = light;
      t.ctx.fillStyle = light ? LIGHT : DARK;
      t.ctx.fillRect(0, 0, W, H);
    }
  }
  function busy() {
    var end = performance.now() + BUSY_MS;
    var x = 0;
    while (performance.now() < end) x += Math.sqrt(x + 1);
    return x;
  }

  function start() {
    if (running) return;
    setRunning(true);
    say("Running: " + TILES + " canvases at " + HZ + " cycles per second, unsynchronised, with busy work, " + seconds + " s.");
    var t0 = performance.now();
    function frame(now) {
      var elapsed = now - t0;
      if (elapsed >= seconds * 1000) return stop("Run finished after " + seconds + " s. Static again.");
      busy();
      paintAll(elapsed);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }
  function stop(message) {
    if (!running) return;
    cancelAnimationFrame(raf);
    setRunning(false);
    say(message || "Stopped. Static.");
  }

  startBtn.addEventListener("click", start);
  stopBtn.addEventListener("click", function () { stop(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") stop(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop("Stopped because the tab was hidden."); });

  var reduce = matchMedia("(prefers-reduced-motion: reduce)");
  function applyReduce() {
    if (reduce.matches) {
      stop();
      startBtn.disabled = true;
      say("Your system asks for reduced motion, so this fixture stays static.");
    } else if (!running) {
      startBtn.disabled = false;
      say("Ready. Press Start.");
    }
  }
  reduce.addEventListener("change", applyReduce);
  applyReduce();
})();
