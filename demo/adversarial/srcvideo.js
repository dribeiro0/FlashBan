// Source-swap fixtures (srcswap.html, srcflip.html). One <video> element, two
// synthetic live sources drawn in the page on hidden canvases (no files, nothing
// visible until Start): a strobe (#222/#777 at data-hz cycles/s, default 4, from real elapsed time)
// and a calm source (steady #444444). Each source is a canvas.captureStream(),
// switched with video.srcObject, which changes instantly (a recorded clip can
// take longer than 600 ms to load on a slow machine). data-mode on the video:
//   "swap": strobe for 3 s, then the calm source in the same element (like an ad
//           followed by the real video). Pass: protected during the strobe, and
//           the calm source plays uncovered within about 1.5 s of the swap.
//   "flip": switch the element between strobe and calm every 600 ms (resetting a
//           per-source check). Pass: protected the whole run.
// The run is started and bounded by fixture.js (kind "static"); this script stops
// everything as soon as Start is enabled again (Stop, Escape, hidden tab, time up).
(function () {
  "use strict";

  var DARK = "#222222";
  var LIGHT = "#777777";
  var CALM = "#444444";

  var video = document.getElementById("clip");
  var startBtn = document.getElementById("start");
  var phase = document.getElementById("phase");
  var mode = video.dataset.mode;
  var halfMs = 500 / (Number(video.dataset.hz) || 4); // half a strobe cycle
  var timers = [];
  var raf = 0;
  var watch = 0;
  var strobe = null;
  var calm = null;

  function source() {
    var c = document.createElement("canvas");
    c.width = 320; c.height = 180;
    return { canvas: c, ctx: c.getContext("2d"), stream: c.captureStream(30) };
  }

  function draw(t0) {
    return function frame(now) {
      strobe.ctx.fillStyle = Math.floor((now - t0) / halfMs) % 2 ? LIGHT : DARK; // data-hz cycles/s (default 4)
      strobe.ctx.fillRect(0, 0, 320, 180);
      calm.ctx.fillStyle = CALM;
      calm.ctx.fillRect(0, 0, 320, 180);
      raf = requestAnimationFrame(frame);
    };
  }

  function show(s, label) {
    video.srcObject = s.stream;
    video.play().catch(function () {});
    phase.textContent = label;
  }

  function stop() {
    timers.forEach(clearTimeout);
    timers.forEach(clearInterval);
    timers = [];
    clearInterval(watch);
    cancelAnimationFrame(raf);
    video.pause();
    video.srcObject = null;
    phase.textContent = "Stopped.";
  }

  startBtn.addEventListener("click", function () {
    if (!startBtn.disabled) return; // fixture.js didn't start a run (reduced motion)
    strobe = strobe || source();
    calm = calm || source();
    raf = requestAnimationFrame(draw(performance.now()));
    watch = setInterval(function () { if (!startBtn.disabled) stop(); }, 100);
    show(strobe, "Playing: strobe source.");
    if (mode === "swap") {
      timers.push(setTimeout(function () { show(calm, "Playing: calm source (same element). It should play uncovered within about 1.5 s."); }, 3000));
    } else {
      var k = 0;
      timers.push(setInterval(function () {
        k++;
        show(k % 2 ? calm : strobe, (k % 2 ? "Playing: calm source" : "Playing: strobe source") + " (flip " + k + ").");
      }, 600));
    }
  });
})();
