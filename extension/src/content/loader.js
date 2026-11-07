// Classic content script. MV3 content scripts can't be ES modules, so this
// loads the real entry point as a module from our own extension origin.
// If loading fails we can't analyse anything on this page, so we fail closed:
// visible media gets a static dim (see dimAllMedia below).
(() => {
  const url = chrome.runtime.getURL("src/content/main.js");
  import(url).catch((err) => {
    console.warn("[FlashBan] could not start; dimming media on this page.", err);
    dimAllMedia();
  });

  const SELECTOR = "video, canvas, img[src$='.gif' i], img[src$='.webp' i], img[src$='.apng' i]";

  /** Inline !important styles beat any page stylesheet rule. @param {Element} el */
  function dim(el) {
    if (el instanceof HTMLElement) el.style.setProperty("filter", "brightness(0.25) contrast(0.6) grayscale(1)", "important");
  }

  function dimAllMedia() {
    const scan = (/** @type {ParentNode} */ root) => root.querySelectorAll?.(SELECTOR).forEach(dim);
    scan(document);
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "attributes") {
          if (r.target instanceof Element && r.target.matches(SELECTOR)) dim(r.target);
          continue;
        }
        r.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.matches(SELECTOR)) dim(n);
          scan(n);
        });
      }
    }).observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "src"] });
  }
})();
