// Shared controls for the benign (false-positive) fixtures. Classic script, no modules.
// Each page shows ordinary motion that is NOT a flashing hazard: under the
// strict preset's limit (no more than 2 flashes in any second) and dim.
// Nothing moves until Start; Stop, Escape or hiding the tab ends a run; the
// run is bounded (?seconds=1..15, default 6). Reduced motion keeps it static.
// Timing uses real elapsed time (performance.now), never frame counts.
(function () {
  "use strict";

  var stage = document.getElementById("stage");
  var startBtn = document.getElementById("start");
  var stopBtn = document.getElementById("stop");
  var status = document.getElementById("status");
  var kind = stage.dataset.kind;

  var params = new URLSearchParams(location.search);
  var seconds = Math.min(15, Math.max(1, Number(params.get("seconds")) || 6));

  var running = false;
  var raf = 0;
  var ctx = stage.getContext ? stage.getContext("2d") : null;

  function say(text) { status.textContent = text; }
  function setRunning(on) {
    running = on;
    startBtn.disabled = on;
    stopBtn.disabled = !on;
  }
  function fill(color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, stage.width, stage.height);
  }
  function gray(v) { var h = Math.round(v).toString(16).padStart(2, "0"); return "#" + h + h + h; }

  // ---- painters: elapsed ms -> draw one frame. All levels stay at or below #bbbbbb.

  // Scene cuts: hard cuts between five "shots" every 700 ms. At most 2 cuts in
  // any second, so at most 1 flash per second even if every cut swings.
  var SHOTS = ["#2a3440", "#6b5a3a", "#1f2a1f", "#8a8a8a", "#3a2030"];
  function sceneCuts(ms) {
    var i = Math.floor(ms / 700) % SHOTS.length;
    fill(SHOTS[i]);
    // A little detail per shot so it reads as video, not a solid strobe.
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(40 + i * 30, 50, 120, 70);
  }

  // Camera flash: one 100 ms bright flash every 2.5 s on a dim scene
  // (2 transitions per 2.5 s: 1 flash, well under the limit).
  function cameraFlash(ms) {
    var phase = ms % 2500;
    fill(phase >= 500 && phase < 600 ? "#bbbbbb" : "#2b2b2b");
  }

  // Slow fade: 2 s from dark to light and 2 s back (0.25 cycles per second).
  function slowFade(ms) {
    var p = (ms % 4000) / 2000;
    var k = p < 1 ? p : 2 - p;
    fill(gray(0x1a + k * (0xbb - 0x1a)));
  }

  // Sunset timelapse: a sky gradient drifting from blue through orange to dusk
  // over 12 s (slow colour change, including reds, but no jumps).
  function lerp(a, b, k) { return a + (b - a) * k; }
  function mix(c1, c2, k) {
    return "rgb(" + Math.round(lerp(c1[0], c2[0], k)) + "," + Math.round(lerp(c1[1], c2[1], k)) + "," + Math.round(lerp(c1[2], c2[2], k)) + ")";
  }
  var SKY = [[90, 130, 180], [180, 120, 70], [150, 50, 40], [40, 30, 60]];
  function sunset(ms) {
    var p = Math.min(0.999, (ms % 12000) / 12000) * (SKY.length - 1);
    var i = Math.floor(p);
    var k = p - i;
    var top = mix(SKY[i], SKY[i + 1], k);
    var bottom = mix(SKY[Math.min(SKY.length - 1, i + 1)], SKY[Math.min(SKY.length - 1, i + 2) ] || SKY[SKY.length - 1], k);
    var g = ctx.createLinearGradient(0, 0, 0, stage.height);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, stage.width, stage.height);
  }

  // Dark-mode toggle (DOM, not canvas): the panel switches theme once every 1.5 s,
  // like a user flipping a theme switch (1 transition per 1.5 s).
  function themeToggle(ms) {
    stage.classList.toggle("light", Math.floor(ms / 1500) % 2 === 1);
  }

  var PAINTERS = { cuts: sceneCuts, camera: cameraFlash, fade: slowFade, sunset: sunset, theme: themeToggle };
  var paint = PAINTERS[kind];

  function reset() {
    if (kind === "theme") stage.classList.remove("light");
    else if (ctx) fill(kind === "sunset" ? "rgb(90,130,180)" : kind === "fade" ? "#1a1a1a" : "#2b2b2b");
  }

  function start() {
    if (running || !paint) return;
    setRunning(true);
    say("Running for " + seconds + " s.");
    var t0 = performance.now();
    function frame(now) {
      var ms = now - t0;
      if (ms >= seconds * 1000) { stop("Run finished after " + seconds + " s. Static again."); return; }
      paint(ms);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  function stop(message) {
    if (!running) return;
    cancelAnimationFrame(raf);
    reset();
    setRunning(false);
    say(message || "Stopped. Static.");
  }

  reset();
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
