// Classic content script. MV3 content scripts can't be ES modules, so this
// loads the real entry point as a module from our own extension origin.
// If loading fails we can't analyse anything on this page, so we fail closed:
// visible media gets a static dim (see dimAllMedia below).
(() => {
  const url = chrome.runtime.getURL("src/content/main.js");
  import(url).catch((err) => {
    console.warn("[Seizure Shield] could not start; dimming media on this page.", err);
    dimAllMedia();
  });

  function dimAllMedia() {
    const style = document.createElement("style");
    style.textContent =
      "video, canvas, img[src$='.gif' i], img[src$='.webp' i], img[src$='.apng' i] { filter: brightness(0.25) contrast(0.6) !important; }";
    (document.head || document.documentElement).appendChild(style);
  }
})();
