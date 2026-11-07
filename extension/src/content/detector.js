// Loads David's detection engine (extension/src/detect/index.js, docs/CONTRACTS.md
// section 1). If it can't be loaded for any reason (missing file, syntax error,
// wrong exports) we fail closed: the content script dims media instead of
// analysing it, and the stand-in below reports "block".

/** @typedef {"loaded" | "error"} DetectorStatus */

/**
 * @returns {Promise<{ module: any, status: DetectorStatus, error?: string }>}
 */
export async function loadDetector() {
  try {
    const mod = await import(chrome.runtime.getURL("src/detect/index.js"));
    if (typeof mod.createDetector !== "function") throw new Error("createDetector is missing");
    return { module: mod, status: "loaded" };
  } catch (err) {
    console.warn("[Seizure Shield] detector failed to load; failing closed.", err);
    return { module: failClosedModule(), status: "error", error: String(err) };
  }
}

/** Stand-in with the contract's shape that always reports "block". */
function failClosedModule() {
  const report = () => ({
    v: 1,
    flashesPerSecond: 0,
    redFlashesPerSecond: 0,
    areaPx: 0,
    areaPct: 0,
    violation: true,
    severity: "block",
    windowMs: 1000,
  });
  return {
    createDetector() {
      let last = report();
      return {
        push() {
          last = report();
          return last;
        },
        peek() {
          return last;
        },
        reset() {},
      };
    },
  };
}
