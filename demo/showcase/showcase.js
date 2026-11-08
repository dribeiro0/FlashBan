// Grain: the FlashBan demo site. Classic script (works from file:// too), no network, no storage.
// Safety rules, same as demo/fixture.js: every stimulus is generated here, dim (#222 / #777), bounded
// (?seconds=1..10, default 3), starts only after a click, and stops on Stop, Escape or a hidden tab.
// Reduced motion keeps everything static. Timing uses real elapsed time, never frame counts.
// Idle artwork is low-contrast ordered dither (two close greys) to stay safe for pattern sensitivity.
(function () {
  "use strict";

  var DARK = "#222222"; // relative luminance ~0.016
  var LIGHT = "#777777"; // ~0.184: each change ~0.17 (> 0.10), dark state < 0.80
  var HZ = 4; // full cycles per second
  var params = new URLSearchParams(location.search);
  var seconds = Math.min(10, Math.max(1, Number(params.get("seconds")) || 3));

  var startBtn = document.getElementById("start");
  var stopBtn = document.getElementById("stop");
  var statusEl = document.getElementById("status");
  var video = document.getElementById("v");
  var canvas = document.getElementById("c");
  var sticker = document.getElementById("s");
  var banner = document.getElementById("d");
  var playBtns = Array.prototype.slice.call(document.querySelectorAll("button.play"));

  var running = { video: false, canvas: false, css: false, dom: false };
  var raf = { canvas: 0, dom: 0 };
  var recorder = null;
  var videoReady = null;
  var abortVideo = null;
  var reduce = matchMedia("(prefers-reduced-motion: reduce)");

  function say(text) { statusEl.textContent = text; }
  function isLight(elapsed) { return Math.floor((elapsed * HZ * 2) / 1000) % 2 === 1; }
  function anyRunning() { return running.video || running.canvas || running.css || running.dom; }

  function refresh() {
    var blocked = reduce.matches;
    startBtn.disabled = blocked || feed.some(function (n) { return running[n]; });
    stopBtn.disabled = !anyRunning();
    playBtns.forEach(function (b) { b.disabled = blocked || running[b.dataset.clip]; });
  }

  // ---------------------------------------------------------------- dithered artwork (static)
  var BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  // Pairs of close greys (on, off): contrast between the two stays low on purpose.
  var GREY = [[74, 74, 68], [52, 52, 47]];
  var OLIVE = [[108, 120, 80], [88, 99, 64]];

  function stageScene(i, j, w, h) {
    var v = 0.6 - 0.35 * (j / h);
    if (j > h * (0.72 - 0.08 * Math.sin(i / (w / 9)))) v = 0.2;
    var crowd = [[0.15, 0.92, 0.07], [0.33, 0.95, 0.055], [0.55, 0.93, 0.065], [0.75, 0.92, 0.06], [0.9, 0.95, 0.05]];
    for (var k = 0; k < crowd.length; k++) {
      var dx = i / w - crowd[k][0], dy = (j / h - crowd[k][1]) * (h / w);
      if (dx * dx + dy * dy < crowd[k][2] * crowd[k][2]) v = 0.35;
    }
    var screen = i > w * 0.3 && i < w * 0.7 && j > h * 0.14 && j < h * 0.58;
    return { v: screen ? 0.55 : v, olive: screen };
  }
  function gameScene(i, j, w, h) {
    var cell = Math.floor(i / (w / 10)) + Math.floor(j / (h / 6));
    var v = cell % 3 === 0 ? 0.62 : 0.3;
    var ship = Math.abs(i - w * 0.5) + Math.abs(j - h * 0.7) * 1.6 < w * 0.09;
    return { v: ship ? 0.6 : v, olive: ship };
  }

  // Draws dither at quarter resolution, then scales up with smoothing off (crisp grain).
  function drawDither(target, scene) {
    var w = Math.max(16, Math.round(target.width / 4)), h = Math.max(9, Math.round(target.height / 4));
    var off = document.createElement("canvas");
    off.width = w; off.height = h;
    var octx = off.getContext("2d");
    var img = octx.createImageData(w, h);
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        var s = scene(i, j, w, h);
        var on = s.v * 16 > BAYER[j % 4][i % 4];
        var pal = s.olive ? OLIVE : GREY;
        var col = on ? pal[0] : pal[1];
        var k = (j * w + i) * 4;
        img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    var ctx = target.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, target.width, target.height);
  }

  function idleCanvas() { drawDither(canvas, gameScene); }
  function posterFor(scene) {
    var c = document.createElement("canvas");
    c.width = 640; c.height = 360;
    drawDither(c, scene);
    return c.toDataURL("image/png");
  }

  // ---------------------------------------------------------------- clips
  function finish(name, message) {
    running[name] = false;
    refresh();
    if (!anyRunning()) say(message || "Finished. Everything is static again.");
  }

  function startCanvas() {
    if (running.canvas) return;
    running.canvas = true;
    var ctx = canvas.getContext("2d");
    var t0 = performance.now();
    function frame(now) {
      if (!running.canvas) return;
      var elapsed = now - t0;
      if (elapsed >= seconds * 1000) { idleCanvas(); finish("canvas"); return; }
      ctx.fillStyle = isLight(elapsed) ? LIGHT : DARK;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      raf.canvas = requestAnimationFrame(frame);
    }
    raf.canvas = requestAnimationFrame(frame);
  }
  function stopCanvas() { cancelAnimationFrame(raf.canvas); if (running.canvas) { running.canvas = false; idleCanvas(); } }

  function startCss() {
    if (running.css) return;
    running.css = true;
    sticker.style.setProperty("--period", 1000 / HZ + "ms");
    sticker.style.setProperty("--cycles", String(HZ * seconds));
    sticker.classList.add("css-run");
  }
  function stopCss() { sticker.classList.remove("css-run"); running.css = false; }
  sticker.addEventListener("animationend", function () { if (running.css) { sticker.classList.remove("css-run"); finish("css"); } });

  function startDom() {
    if (running.dom) return;
    running.dom = true;
    banner.classList.add("running");
    var t0 = performance.now();
    function frame(now) {
      if (!running.dom) return;
      var elapsed = now - t0;
      if (elapsed >= seconds * 1000) { banner.classList.remove("running", "on"); finish("dom"); return; }
      banner.classList.toggle("on", isLight(elapsed));
      raf.dom = requestAnimationFrame(frame);
    }
    raf.dom = requestAnimationFrame(frame);
  }
  function stopDom() { cancelAnimationFrame(raf.dom); banner.classList.remove("running", "on"); running.dom = false; }

  // Records the strobe from a detached canvas so the video is same-origin (blob:) and synthetic.
  function makeVideo() {
    return new Promise(function (resolve, reject) {
      var c = document.createElement("canvas");
      c.width = 320; c.height = 180;
      var ctx = c.getContext("2d");
      var chunks = [];
      var track = c.captureStream(0).getVideoTracks()[0];
      var aborted = false;
      var loop = 0;
      recorder = new MediaRecorder(new MediaStream([track]), { mimeType: "video/webm" });
      recorder.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = function () {
        recorder = null;
        if (!aborted && chunks.length) resolve(URL.createObjectURL(new Blob(chunks, { type: "video/webm" })));
        else reject(new Error("aborted"));
      };
      var t0 = performance.now();
      function frame(now) {
        if (aborted) return;
        var elapsed = now - t0;
        ctx.fillStyle = isLight(elapsed) ? LIGHT : DARK;
        ctx.fillRect(0, 0, c.width, c.height);
        track.requestFrame();
        if (elapsed >= seconds * 1000) { recorder.stop(); return; }
        loop = requestAnimationFrame(frame);
      }
      abortVideo = function () { aborted = true; cancelAnimationFrame(loop); if (recorder) recorder.stop(); };
      recorder.start();
      loop = requestAnimationFrame(frame);
    });
  }

  function startVideo() {
    if (running.video) return;
    running.video = true;
    refresh();
    if (!videoReady) {
      say("Preparing the featured video off screen (" + seconds + " s). Nothing is shown yet.");
      videoReady = makeVideo();
    }
    videoReady.then(function (url) {
      if (!running.video) return;
      if (video.src !== url) video.src = url;
      video.currentTime = 0;
      say("Playing: featured video, " + HZ + " flashes a second, " + seconds + " s.");
      return video.play();
    }).catch(function () {
      videoReady = null;
      if (running.video) { running.video = false; refresh(); say("The video couldn't be prepared or played. Static."); }
    });
  }
  function stopVideo() {
    if (abortVideo && recorder) { abortVideo(); videoReady = null; }
    video.pause();
    if (video.src) video.currentTime = 0;
    running.video = false;
  }
  video.addEventListener("ended", function () { if (running.video) finish("video"); });

  // ---------------------------------------------------------------- controls
  var starters = { video: startVideo, canvas: startCanvas, css: startCss, dom: startDom };
  var names = { video: "featured video", canvas: "game trailer (canvas)", css: "sticker (CSS)", dom: "live banner (script)" };

  function play(name) {
    if (reduce.matches) return;
    starters[name]();
    refresh();
    if (name !== "video") say("Playing: " + names[name] + ", " + HZ + " flashes a second, " + seconds + " s.");
  }
  // data-feed on #start lists the clips "Play the feed" runs (default: everything except the video).
  var feed = (startBtn.dataset.feed || "canvas,css,dom").split(",").filter(function (n) { return starters[n]; });
  function playFeed() {
    if (reduce.matches) return;
    feed.forEach(function (n) { starters[n](); });
    refresh();
    if (feed.indexOf("video") < 0) say("Playing the feed: " + feed.map(function (n) { return names[n]; }).join(", ") + ", " + HZ + " flashes a second, " + seconds + " s.");
  }
  function stopAll(message) {
    if (!anyRunning()) return;
    stopCanvas(); stopCss(); stopDom(); stopVideo();
    refresh();
    say(message || "Stopped. Everything is static.");
  }

  startBtn.addEventListener("click", playFeed);
  stopBtn.addEventListener("click", function () { stopAll(); });
  playBtns.forEach(function (b) { b.addEventListener("click", function () { play(b.dataset.clip); }); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") stopAll(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden) stopAll("Stopped because the tab was hidden."); });

  function applyReduce() {
    if (reduce.matches) {
      stopAll();
      say("Your system asks for reduced motion, so Grain stays static. Nothing will play.");
    } else if (!anyRunning()) {
      say("Ready. Nothing moves until you press Play.");
    }
    refresh();
  }
  reduce.addEventListener("change", applyReduce);

  idleCanvas();
  video.poster = posterFor(stageScene);
  applyReduce();
})();
