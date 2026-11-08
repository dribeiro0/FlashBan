// Taints the stage canvas (threat T4): it draws one tiny dark image from a
// DIFFERENT origin onto the canvas at load. A tainted canvas can't be read back
// (getImageData throws SecurityError), so FlashBan can't measure the strobe that
// fixture.js then draws on it. Pass: FlashBan fails closed and dims the canvas.
// Fail: the strobe is shown undimmed.
//
// Cross-origin without a second server: the page is served from 127.0.0.1 (or
// localhost), and the image is fetched from the OTHER hostname on the same port,
// which the browser treats as a different origin.
(function () {
  "use strict";
  var stage = document.getElementById("stage");
  var note = document.getElementById("taint");
  var other = location.hostname === "localhost" ? "127.0.0.1" : "localhost";
  var src = location.protocol + "//" + other + (location.port ? ":" + location.port : "") +
    location.pathname.replace(/[^/]*$/, "") + "taint.svg";
  var img = new Image();
  img.onload = function () {
    var ctx = stage.getContext("2d");
    ctx.drawImage(img, 0, 0, stage.width, stage.height);
    var tainted = false;
    try {
      ctx.getImageData(0, 0, 1, 1);
    } catch (e) {
      tainted = true;
    }
    note.textContent = tainted
      ? "Canvas tainted by a cross-origin image (" + other + "): it can't be read back."
      : "Warning: the canvas is NOT tainted (the image wasn't cross-origin), so this page isn't testing T4.";
  };
  img.onerror = function () {
    note.textContent = "Couldn't load the cross-origin image from " + other + ", so this page isn't testing T4.";
  };
  img.src = src;
})();
