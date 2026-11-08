// Shared controls for the synthetic demo fixtures (classic script, no modules, so pages also work from file://).
// Stimulus only runs after an explicit Start, stops on Stop, Escape or hidden tab (not on blur, so opening the extension popup does not end a run), and never restarts on its own.
// Timing uses real elapsed time (performance.now), never frame counts.
(function () {
  "use strict";

  var DARK = "#222222"; // relative luminance ~0.016
  var LIGHT = "#777777"; // relative luminance ~0.184, so each change is ~0.17 (> 0.10) and the dark state is < 0.80

  var stage = document.getElementById("stage");
  var startBtn = document.getElementById("start");
  var stopBtn = document.getElementById("stop");
  var status = document.getElementById("status");
  var kind = stage.dataset.kind;
  var hz = Number(stage.dataset.hz) || 0; // full on/off cycles per second
  var rateText = stage.dataset.hz === "frame" ? "a state change every frame" : hz + " cycles per second";
  if (stage.dataset.dark) DARK = stage.dataset.dark; // per-page colors (canvas only)
  if (stage.dataset.light) LIGHT = stage.dataset.light;
  var delay = Math.max(0, Number(stage.dataset.delay) || 0); // calm seconds before the strobe starts (canvas only)
  var countdown = document.getElementById("countdown");

  var params = new URLSearchParams(location.search);
  // Bounded run, ?seconds=1..10 (data-seconds sets a page default); a calm lead-in doesn't count toward the 10 s cap.
  var seconds = Math.min(10 + delay, Math.max(1, Number(params.get("seconds")) || Number(stage.dataset.seconds) || 3));

  var running = false;
  var raf = 0;
  var timer = 0;
  var recorder = null;
  var videoReady = null; // Promise<string> blob URL once generated

  function say(text) { status.textContent = text; }

  function setRunning(on) {
    running = on;
    startBtn.disabled = on;
    stopBtn.disabled = !on;
  }

  // Phase at elapsed ms: true = light half of the cycle.
  function isLight(elapsed) { return Math.floor((elapsed * hz * 2) / 1000) % 2 === 1; }

  function loop(paint) {
    var t0 = performance.now();
    var frames = 0;
    var everyFrame = stage.dataset.hz === "frame"; // flip on every animation frame (half the display rate)
    function frame(now) {
      var elapsed = now - t0;
      if (elapsed >= seconds * 1000) { stop("Run finished after " + seconds + " s. Static again."); return; }
      var calm = delay * 1000 - elapsed;
      if (countdown) countdown.textContent = calm > 0 ? "Flashing starts in " + Math.ceil(calm / 1000) + " s." : "Flashing now.";
      paint(calm > 0 ? false : everyFrame ? (frames++ % 2 === 1) : isLight(-calm));
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  function paintCanvas(light) {
    var ctx = stage.getContext("2d");
    ctx.fillStyle = light ? LIGHT : DARK;
    ctx.fillRect(0, 0, stage.width, stage.height);
  }

  // Draws the stimulus into a detached canvas and records it, so the video is same-origin (blob:) and synthetic.
  function makeVideo() {
    return new Promise(function (resolve, reject) {
      var c = document.createElement("canvas");
      c.width = 320; c.height = 180;
      var ctx = c.getContext("2d");
      var chunks = [];
      var track = c.captureStream(0).getVideoTracks()[0]; // frame rate 0: capture exactly when requestFrame() is called
      recorder = new MediaRecorder(new MediaStream([track]), { mimeType: "video/webm" });
      recorder.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = function () {
        var ok = recorder && recorder.state === "inactive" && chunks.length;
        recorder = null;
        if (ok && !c.aborted) resolve(URL.createObjectURL(new Blob(chunks, { type: "video/webm" })));
        else reject(new Error("aborted"));
      };
      var t0 = performance.now();
      function frame(now) {
        if (c.aborted) { if (recorder) recorder.stop(); return; }
        var elapsed = now - t0;
        ctx.fillStyle = isLight(elapsed) ? LIGHT : DARK;
        ctx.fillRect(0, 0, c.width, c.height);
        track.requestFrame();
        if (elapsed >= seconds * 1000) { recorder.stop(); return; }
        raf = requestAnimationFrame(frame);
      }
      // Stop the recorder here: stop() cancels the frame loop, so the loop can't do it.
      makeVideo.abort = function () { c.aborted = true; if (recorder) recorder.stop(); };
      recorder.start();
      raf = requestAnimationFrame(frame);
    });
  }

  function start() {
    if (running) return;
    setRunning(true);
    if (kind === "canvas") {
      say("Running: canvas, " + rateText + ", " + seconds + " s.");
      loop(paintCanvas);
    } else if (kind === "dom") {
      say("Running: JavaScript class toggle, " + rateText + ", " + seconds + " s.");
      loop(function (light) { stage.classList.toggle("on", light); });
    } else if (kind === "css") {
      say("Running: CSS keyframes, " + rateText + ", " + seconds + " s.");
      stage.style.setProperty("--period", 1000 / hz + "ms");
      stage.style.setProperty("--cycles", String(hz * seconds));
      stage.classList.add("css-run");
    } else if (kind === "video") {
      if (!videoReady) {
        say("Preparing the synthetic video off screen (" + seconds + " s). Nothing is shown yet.");
        videoReady = makeVideo();
      }
      videoReady.then(function (url) {
        if (!running) return;
        if (stage.src !== url) stage.src = url;
        stage.currentTime = 0;
        say("Running: video, " + rateText + ", " + seconds + " s.");
        return stage.play();
      }).catch(function () {
        videoReady = null;
        if (running) stop("Video could not be prepared or played. Static.");
      });
    } else {
      say("Running: static control. Nothing changes for " + seconds + " s.");
      timer = setTimeout(function () { stop("Run finished after " + seconds + " s."); }, seconds * 1000);
    }
  }

  function stop(message) {
    if (!running) return;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    if (countdown) countdown.textContent = "";
    if (recorder && makeVideo.abort) makeVideo.abort();
    if (kind === "canvas") paintCanvas(false);
    if (kind === "dom") stage.classList.remove("on");
    if (kind === "css") stage.classList.remove("css-run");
    if (kind === "video") { stage.pause(); if (stage.src) stage.currentTime = 0; }
    setRunning(false);
    say(message || "Stopped. Static.");
  }

  if (kind === "canvas") paintCanvas(false);
  if (kind === "css") stage.addEventListener("animationend", function () { stop("Run finished after " + seconds + " s. Static again."); });
  if (kind === "video") stage.addEventListener("ended", function () { stop("Run finished. Static again."); });

  startBtn.addEventListener("click", start);
  stopBtn.addEventListener("click", function () { stop(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") stop(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop("Stopped because the tab was hidden."); });

  var reduce = matchMedia("(prefers-reduced-motion: reduce)");
  function applyReduce() {
    if (reduce.matches && kind !== "static") {
      stop();
      startBtn.disabled = true;
      say("Your system asks for reduced motion, so this fixture stays static. The page description lists its parameters.");
    } else if (!running) {
      startBtn.disabled = false;
      say("Stopped. Static.");
    }
  }
  reduce.addEventListener("change", applyReduce);
  applyReduce();
  // ?autostart=1 starts the run at page load, but only on pages that opt in with data-autostart="allowed"
  // (the early-start attack page, for the harness), so no other page can be made to flash before its warning
  // is read. Reduced motion still wins.
  if (params.get("autostart") === "1" && stage.dataset.autostart === "allowed" && !startBtn.disabled) start();
})();
