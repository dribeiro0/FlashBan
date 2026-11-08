// FlashBan website script. Classic script, no network, no storage, no eval.
// 1) Draws the static, low-contrast dithered figures (<canvas data-scene="...">). Nothing animates.
// 2) Fills the download box from download/latest.js (written by node site/build.mjs).
// 3) "Copy" buttons for the checksum and commands.
(function () {
  "use strict";

  var BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  var dark = matchMedia("(prefers-color-scheme: dark)");
  // Close pairs (on, off) keep the dither low contrast.
  function palette() {
    return dark.matches
      ? { grey: [[66, 66, 60], [44, 44, 40]], accent: [[110, 122, 82], [90, 101, 66]], flat: [[96, 104, 74], [92, 100, 70]], line: [228, 225, 214] }
      : { grey: [[196, 193, 182], [168, 165, 154]], accent: [[160, 170, 128], [140, 151, 108]], flat: [[146, 156, 112], [142, 152, 108]], line: [17, 17, 17] };
  }

  // Scenes return { v: 0..1 tone, kind: "grey" | "accent" | "flat" }.
  var scenes = {
    // A video frame with its flashing area softened to a flat field.
    softened: function (i, j, w, h) {
      var v = 0.6 - 0.35 * (j / h);
      if (j > h * (0.72 - 0.08 * Math.sin(i / (w / 9)))) v = 0.2;
      var crowd = [[0.15, 0.93, 0.07], [0.33, 0.95, 0.055], [0.55, 0.94, 0.065], [0.75, 0.93, 0.06], [0.9, 0.95, 0.05]];
      for (var k = 0; k < crowd.length; k++) {
        var dx = i / w - crowd[k][0], dy = (j / h - crowd[k][1]) * (h / w);
        if (dx * dx + dy * dy < crowd[k][2] * crowd[k][2]) v = 0.36;
      }
      if ((i > w * 0.07 && i < w * 0.1 && j > h * 0.3 && j < h * 0.66) || (i > w * 0.9 && i < w * 0.93 && j > h * 0.28 && j < h * 0.66)) v = 0.48;
      if (i > w * 0.3 && i < w * 0.7 && j > h * 0.14 && j < h * 0.58) return { v: 0.5, kind: "flat" };
      return { v: v, kind: "grey" };
    },
    // The same frame "before": the flashing area as a coarse checker of the two strobe states (still).
    before: function (i, j, w, h) {
      var s = scenes.softened(i, j, w, h);
      if (s.kind === "flat") return { v: (Math.floor(i / (w / 8)) + Math.floor(j / (h / 6))) % 2 ? 0.75 : 0.3, kind: "accent" };
      return s;
    },
    // One-second window: 8 bars, the flashing ones in accent.
    window: function (i, j, w, h) {
      var bar = Math.floor(i / (w / 8));
      var inBar = (i % Math.floor(w / 8)) > 2;
      var tall = bar % 2 === 0 ? 0.25 : 0.75;
      if (inBar && j > h * (1 - tall) - 1) return { v: 0.62, kind: "accent" };
      return { v: 0.35, kind: "grey" };
    },
    // Covered: a solid panel over the frame.
    covered: function (i, j, w, h) {
      if (i > w * 0.18 && i < w * 0.82 && j > h * 0.16 && j < h * 0.84) return { v: 0.08, kind: "grey" };
      return scenes.softened(i, j, w, h);
    },
    // Can't verify: the whole frame dimmed.
    dimmed: function (i, j, w, h) {
      var s = scenes.before(i, j, w, h);
      return { v: s.v * 0.35, kind: "grey" };
    },
  };

  function draw(canvas) {
    var scene = scenes[canvas.dataset.scene];
    if (!scene) return;
    var w = Math.max(16, Math.round(canvas.width / 4)), h = Math.max(9, Math.round(canvas.height / 4));
    var off = document.createElement("canvas");
    off.width = w; off.height = h;
    var octx = off.getContext("2d");
    var img = octx.createImageData(w, h);
    var pal = palette();
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        var s = scene(i, j, w, h);
        var pair = pal[s.kind] || pal.grey;
        var col = s.v * 16 > BAYER[j % 4][i % 4] ? pair[0] : pair[1];
        var k = (j * w + i) * 4;
        img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    var ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }
  function drawAll() { Array.prototype.forEach.call(document.querySelectorAll("canvas[data-scene]"), draw); }
  drawAll();
  if (dark.addEventListener) dark.addEventListener("change", drawAll);

  // ---------------------------------------------------------------- download box
  var info = window.FLASHBAN_DOWNLOAD;
  function set(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }
  var box = document.getElementById("download-box");
  if (box) {
    var missing = document.getElementById("download-missing");
    if (info && typeof info.file === "string" && /^flashban-[\d.]+\.zip$/.test(info.file) && /^[0-9a-f]{64}$/.test(info.sha256)) {
      box.hidden = false;
      if (missing) missing.hidden = true;
      var link = document.getElementById("dl-link");
      link.href = "download/" + info.file;
      link.setAttribute("download", info.file);
      set("dl-label", "Download FlashBan " + info.version);
      set("dl-version", info.version);
      set("dl-file", info.file);
      set("dl-size", Math.round(info.size / 1024) + " KB, " + info.fileCount + " files, one folder: " + info.folder);
      set("dl-sha", info.sha256);
      set("dl-commit", info.commit || "unknown");
      set("dl-perms", (info.permissions || []).concat(info.hostPermissions || []).join(", "));
      Array.prototype.forEach.call(document.querySelectorAll("[data-file]"), function (el) { el.textContent = el.textContent.replace(/flashban-[\w.]+\.zip/g, info.file); });
      Array.prototype.forEach.call(document.querySelectorAll("[data-folder]"), function (el) { el.textContent = info.folder; });
      Array.prototype.forEach.call(document.querySelectorAll("[data-sha]"), function (el) { el.textContent = info.sha256; });
      if (/^[0-9a-f]{7,40}$/.test(info.commit || "")) Array.prototype.forEach.call(document.querySelectorAll("[data-commit]"), function (el) { el.textContent = info.commit; });
    }
  }

  // ---------------------------------------------------------------- copy buttons
  Array.prototype.forEach.call(document.querySelectorAll("button.copy[data-copy]"), function (btn) {
    if (!navigator.clipboard) { btn.hidden = true; return; }
    btn.addEventListener("click", function () {
      var src = document.getElementById(btn.dataset.copy);
      if (!src) return;
      navigator.clipboard.writeText(src.textContent.trim()).then(function () {
        var live = document.getElementById("copy-status");
        if (live) live.textContent = "Copied to the clipboard.";
      }, function () {
        var live = document.getElementById("copy-status");
        if (live) live.textContent = "Couldn't copy. Select the text and copy it instead.";
      });
    });
  });
})();
