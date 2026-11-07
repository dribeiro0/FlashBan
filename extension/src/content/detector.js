// Loads David's detection engine (extension/src/detect/index.js, docs/CONTRACTS.md
// section 1). While that file doesn't exist yet, a development stub is used so
// the rest of the extension can be built and tested. If the file exists but
// fails to load, we fail closed: every report says "block".

/** @typedef {"loaded" | "stub" | "error"} DetectorStatus */

/**
 * @returns {Promise<{ module: any, status: DetectorStatus, error?: string }>}
 */
export async function loadDetector() {
  const url = chrome.runtime.getURL("src/detect/index.js");
  let exists = false;
  try {
    const res = await fetch(url, { method: "HEAD" });
    exists = res.ok;
  } catch {
    exists = false;
  }
  if (!exists) {
    console.info("[Seizure Shield] detector not built yet; using the development stub.");
    return { module: stubModule("none"), status: "stub" };
  }
  try {
    const mod = await import(url);
    if (typeof mod.createDetector !== "function") throw new Error("createDetector is missing");
    return { module: mod, status: "loaded" };
  } catch (err) {
    console.warn("[Seizure Shield] detector failed to load; failing closed.", err);
    return { module: stubModule("block"), status: "error", error: String(err) };
  }
}

/**
 * Stand-in with the contract's shape.
 * @param {"none" | "block"} verdict
 */
function stubModule(verdict) {
  const report = () => ({
    v: 1,
    flashesPerSecond: 0,
    redFlashesPerSecond: 0,
    areaPx: 0,
    areaPct: 0,
    violation: verdict === "block",
    severity: verdict,
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
