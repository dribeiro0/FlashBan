// Classic content script. MV3 content scripts can't be ES modules, so this
// loads the real entry point as a module from our own extension origin.
// If loading fails we can't analyse anything on this page, so we fail closed:
// visible media gets a static dim (see dimAllMedia below).
(() => {
  const SELECTOR = "video, canvas, img[src$='.gif' i], img[src$='.webp' i], img[src$='.apng' i]";

  // Fail closed DURING load too (threat T8 variant, measured by Yaovi: a strobe
  // that starts at page load was shown for ~0.5 s before the module was in).
  // From document_start until main.js has scanned the page, media is dimmed by
  // a static stylesheet; main.js removes it (globalThis.__flashbanBoot).
  const boot = document.createElement("style");
  boot.textContent = `${SELECTOR} { filter: brightness(0.25) contrast(0.6) grayscale(1) !important; }`;
  (document.documentElement || document).append(boot);
  /** @type {any} */ (globalThis).__flashbanBoot = boot;

  const url = chrome.runtime.getURL("src/content/main.js");
  import(url).catch((err) => {
    console.warn("[FlashBan] could not start; dimming media on this page.", err);
    dimAllMedia();
  });

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
