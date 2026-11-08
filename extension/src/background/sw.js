// Background service worker: settings, the local domain log, and the HUD relay.
// Every message is checked (sender is our own extension, shape is valid)
// before it's used (threat T7, review checklist G6).

import { normalizeSettings, registrableDomain, isValidDomain } from "../shared/settings.js";
import { validateContentMessage, validateHudSubscribe, applyViolation, pruneLog } from "./validate.js";
import { animatedFromBytes } from "./imagesniff.js";
import { GROUND, INK, ACCENT, FONT } from "../shared/theme.js";

const HUD_MIN_GAP_MS = 100; // at most 10 relayed messages per second per source
const HUD_PAGE_PREFIX = chrome.runtime.getURL("hud/");

// Page lockdown (threat T6). Inserted with origin USER, so page scripts can't
// see or remove it, and user !important beats every page style, inline
// !important included. Hides media, stops animations, fixes the page
// background, dims and greys everything else, and explains why.
const LOCKDOWN_CSS = `
canvas, video, img, picture, svg, iframe, embed, object { visibility: hidden !important; }
*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }
html, body { background: ${GROUND} !important; background-image: none !important; }
body { filter: grayscale(1) brightness(0.25) !important; }
html::after {
  content: "FlashBan dimmed this page: it was flashing and kept trying to remove FlashBan's protection. To see it anyway, open FlashBan and turn off protection for this site." !important;
  display: block !important; position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important;
  z-index: 2147483647 !important; margin: 0 !important; padding: 14px 18px !important;
  background: ${GROUND} !important; color: ${INK} !important;
  border: 0 !important; border-bottom: 3px solid ${ACCENT} !important; border-radius: 0 !important; box-shadow: none !important;
  font: 600 16px/1.4 ${FONT} !important;
  text-align: center !important; visibility: visible !important; opacity: 1 !important; filter: none !important;
}
`;

/** @type {Set<string>} "tabId:frameId" with lockdown applied */
const lockedFrames = new Set();
const LOCKDOWN_TITLE = "FlashBan dimmed this page: it was flashing and kept trying to remove FlashBan's protection. Open FlashBan to turn off protection for this site.";

/**
 * The lockdown banner is CSS generated content, which screen readers may
 * never reach, so the toolbar button also says what happened (badge + label).
 * @param {number} tabId @param {boolean} on
 */
function markTab(tabId, on) {
  try {
    chrome.action.setBadgeText({ tabId, text: on ? "!" : "" });
    if (on) {
      chrome.action.setBadgeBackgroundColor({ tabId, color: "#ffd84d" });
      chrome.action.setBadgeTextColor?.({ tabId, color: "#121212" });
    }
    chrome.action.setTitle({ tabId, title: on ? LOCKDOWN_TITLE : "FlashBan" });
  } catch {}
}

/** @type {import("../shared/settings.js").Settings | null} */
let settingsCache = null;

async function getSettings() {
  if (!settingsCache) {
    const stored = await chrome.storage.local.get("settings");
    settingsCache = normalizeSettings(stored.settings);
  }
  return settingsCache;
}

chrome.runtime.onInstalled.addListener(async () => {
  // Write defaults only on a fresh install; never overwrite the user's choices.
  const stored = await chrome.storage.local.get("settings");
  if (stored.settings === undefined) await chrome.storage.local.set({ settings: normalizeSettings(undefined) });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  settingsCache = normalizeSettings(changes.settings.newValue);
  const enabled = settingsCache.hud;
  for (const port of hudPorts.keys()) safePost(port, { type: "hudStatus", v: 1, enabled });
});

// ---------------------------------------------------------------- domain log

let logChain = Promise.resolve();

/** Drop entries older than the retention period (30 days). */
function pruneStoredLog() {
  logChain = logChain
    .then(async () => {
      const stored = await chrome.storage.local.get("log");
      if (stored.log === undefined) return;
      const pruned = pruneLog(stored.log, Date.now());
      if (pruned !== stored.log) await chrome.storage.local.set({ log: pruned });
    })
    .catch(() => {});
}
pruneStoredLog(); // every time the worker starts
chrome.runtime.onStartup.addListener(pruneStoredLog);

/** Serialize log writes so concurrent violations aren't lost. */
function recordViolation(/** @type {string} */ domain, /** @type {string} */ source, /** @type {any} */ report, /** @type {number} */ at) {
  logChain = logChain
    .then(async () => {
      const stored = await chrome.storage.local.get("log");
      await chrome.storage.local.set({ log: applyViolation(stored.log, domain, source, report, at) });
    })
    .catch((err) => console.warn("[FlashBan] could not update the log", err));
}

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const msg = validateContentMessage(raw);
  if (!msg) return false;

  switch (msg.type) {
    case "getSettings":
      getSettings().then((s) => sendResponse({ type: "settings", ...s }));
      return true; // async response
    case "violation": {
      // The domain comes only from what Chrome reports about the sender: the
      // frame URL, or its origin for about:blank and srcdoc frames. Never from
      // the message itself.
      const domain = registrableDomain(sender.url || "") || registrableDomain(sender.origin || "");
      if (isValidDomain(domain)) recordViolation(domain, msg.source, msg.report, Date.now());
      return false;
    }
    case "report":
    case "page":
      relayToHud(sender, msg);
      return false;
    case "lockdown":
      setLockdown(sender, msg.on);
      return false;
    case "probeImage":
      probeImage(msg.url).then((animated) => sendResponse({ type: "probeResult", v: 1, animated }));
      return true; // async response
    default:
      return false;
  }
});

// ---------------------------------------------------------------- image animation probe
// Cross-origin images can't be read in the page, so the background fetches
// the file's first bytes (no cookies) and reads its container headers to tell
// a still image from an animated one. Only a boolean goes back to the page.

const PROBE_MAX_BYTES = 512 * 1024;
const PROBE_TIMEOUT_MS = 4000;
const PROBE_MAX_CONCURRENT = 4;
/** @type {Map<string, Promise<boolean | null>>} */
const probeCache = new Map();
let probesRunning = 0;
/** @type {(() => void)[]} */
const probeQueue = [];

/** @param {string} url @returns {Promise<boolean | null>} */
function probeImage(url) {
  let p = probeCache.get(url);
  if (!p) {
    p = withProbeSlot(() => fetchAnimated(url));
    probeCache.set(url, p);
    if (probeCache.size > 500) probeCache.delete(probeCache.keys().next().value);
  }
  return p;
}

/** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
async function withProbeSlot(fn) {
  if (probesRunning >= PROBE_MAX_CONCURRENT) await new Promise((r) => probeQueue.push(() => r(undefined)));
  probesRunning++;
  try {
    return await fn();
  } finally {
    probesRunning--;
    probeQueue.shift()?.();
  }
}

/** @param {string} url */
async function fetchAnimated(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: "omit", redirect: "follow", signal: ctrl.signal });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    let buf = new Uint8Array(0);
    let verdict = null;
    while (buf.length < PROBE_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const next = new Uint8Array(buf.length + value.length);
      next.set(buf);
      next.set(value, buf.length);
      buf = next;
      verdict = animatedFromBytes(buf);
      if (verdict !== null) break;
    }
    reader.cancel().catch(() => {});
    return verdict ?? animatedFromBytes(buf);
  } catch {
    return null; // unknown: the page treats it as animated (fail closed)
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- page lockdown

/** @param {chrome.runtime.MessageSender} sender @param {boolean} on */
async function setLockdown(sender, on) {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return;
  const frameId = sender.frameId ?? 0;
  const key = `${tabId}:${frameId}`;
  if (on === lockedFrames.has(key)) return;
  const target = { tabId, frameIds: [frameId] };
  try {
    if (on) {
      await chrome.scripting.insertCSS({ target, css: LOCKDOWN_CSS, origin: "USER" });
      lockedFrames.add(key);
    } else {
      await chrome.scripting.removeCSS({ target, css: LOCKDOWN_CSS, origin: "USER" });
      lockedFrames.delete(key);
    }
    markTab(tabId, [...lockedFrames].some((k) => k.startsWith(`${tabId}:`)));
  } catch (err) {
    console.warn("[FlashBan] lockdown failed", err);
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const key of [...lockedFrames]) if (key.startsWith(`${tabId}:`)) lockedFrames.delete(key);
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  // A navigation or reload drops inserted CSS; forget this tab's lockdowns.
  if (info.status !== "loading") return;
  let had = false;
  for (const key of [...lockedFrames]) {
    if (key.startsWith(`${tabId}:`)) {
      lockedFrames.delete(key);
      had = true;
    }
  }
  if (had) markTab(tabId, false);
});

// ---------------------------------------------------------------- HUD relay (CONTRACTS 3a)

/** @type {Map<chrome.runtime.Port, number | null>} port -> subscribed tab id */
const hudPorts = new Map();
/** @type {Map<string, number>} */
const lastRelay = new Map();

chrome.runtime.onConnect.addListener((port) => {
  const s = port.sender;
  // Only our own HUD page may subscribe: never a content script or another extension.
  const fromHudPage = port.name === "hud" && s?.id === chrome.runtime.id && typeof s?.url === "string" && s.url.startsWith(HUD_PAGE_PREFIX) && !s.frameId;
  if (!fromHudPage) {
    port.disconnect();
    return;
  }
  hudPorts.set(port, null);
  port.onMessage.addListener(async (raw) => {
    const m = validateHudSubscribe(raw);
    if (!m) return;
    hudPorts.set(port, m.tabId);
    const settings = await getSettings();
    safePost(port, { type: "hudStatus", v: 1, enabled: settings.hud });
  });
  port.onDisconnect.addListener(() => hudPorts.delete(port));
});

/** @param {chrome.runtime.MessageSender} sender @param {any} msg */
async function relayToHud(sender, msg) {
  if (hudPorts.size === 0) return;
  const settings = await getSettings();
  if (!settings.hud) return;
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return;
  const frame = sender.frameId ?? 0;
  const key = msg.type === "report" ? `${tabId}:${frame}:${msg.sourceId}` : `${tabId}:${frame}:page`;
  const now = Date.now();
  if (now - (lastRelay.get(key) ?? 0) < HUD_MIN_GAP_MS) return;
  lastRelay.set(key, now);
  if (lastRelay.size > 2000) lastRelay.clear();

  const out = msg.type === "report" ? { ...msg, tabId, sourceId: `f${frame}-${msg.sourceId}` } : { ...msg, tabId };
  for (const [port, subscribed] of hudPorts) if (subscribed === tabId) safePost(port, out);
}

/** @param {chrome.runtime.Port} port @param {any} msg */
function safePost(port, msg) {
  try {
    port.postMessage(msg);
  } catch {
    hudPorts.delete(port);
  }
}
