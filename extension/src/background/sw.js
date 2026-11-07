// Background service worker: settings, the local domain log, and the HUD relay.
// Every message is checked (sender is our own extension, shape is valid)
// before it's used (threat T7, review checklist G6).

import { normalizeSettings, registrableDomain, isValidDomain } from "../shared/settings.js";
import { validateContentMessage, validateHudSubscribe, applyViolation } from "./validate.js";

const HUD_MIN_GAP_MS = 100; // at most 10 relayed messages per second per source
const HUD_PAGE_PREFIX = chrome.runtime.getURL("hud/");

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

/** Serialize log writes so concurrent violations aren't lost. */
function recordViolation(/** @type {string} */ domain, /** @type {string} */ source, /** @type {any} */ report, /** @type {number} */ at) {
  logChain = logChain
    .then(async () => {
      const stored = await chrome.storage.local.get("log");
      await chrome.storage.local.set({ log: applyViolation(stored.log, domain, source, report, at) });
    })
    .catch((err) => console.warn("[Seizure Shield] could not update the log", err));
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
      // Trust the frame URL Chrome gives us over the domain in the message.
      const domain = registrableDomain(sender.url || "") || msg.domain;
      if (isValidDomain(domain)) recordViolation(domain, msg.source, msg.report, Date.now());
      return false;
    }
    case "report":
    case "page":
      relayToHud(sender, msg);
      return false;
    default:
      return false;
  }
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
