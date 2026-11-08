import { normalizeSettings } from "../src/shared/settings.js";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const statusEl = $("status");
const siteBox = /** @type {HTMLInputElement} */ ($("site-enabled"));
const siteName = $("site-name");
const guardedStart = /** @type {HTMLInputElement} */ ($("guardedStart"));
const failClosed = /** @type {HTMLInputElement} */ ($("failClosed"));
const hud = /** @type {HTMLInputElement} */ ($("hud"));
const openHud = /** @type {HTMLButtonElement} */ ($("open-hud"));
const presetRadios = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="preset"]'));
const onFlashRadios = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="onFlash"]'));
const dataSummary = $("data-summary");
const dataDetails = $("data-details");
const dataList = $("data-list");
const dataStatus = $("data-status");
const clearData = /** @type {HTMLButtonElement} */ ($("clear-data"));

/** @type {import("../src/shared/settings.js").Settings} */
let settings = normalizeSettings(undefined);
/** @type {number | null} */
let tabId = null;
let domain = "";

init();

async function init() {
  const stored = await chrome.storage.local.get("settings");
  settings = normalizeSettings(stored.settings);
  render();

  presetRadios.forEach((r) => r.addEventListener("change", () => r.checked && save({ preset: /** @type {any} */ (r.value) })));
  onFlashRadios.forEach((r) => r.addEventListener("change", () => r.checked && save({ onFlash: /** @type {any} */ (r.value) })));
  guardedStart.addEventListener("change", () => save({ guardedStart: guardedStart.checked }));
  failClosed.addEventListener("change", () => save({ failClosed: failClosed.checked }));
  hud.addEventListener("change", () => save({ hud: hud.checked }));
  siteBox.addEventListener("change", onSiteToggle);
  openHud.addEventListener("click", onOpenHud);
  clearData.addEventListener("click", onClearData);
  await renderData();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = typeof tab?.id === "number" ? tab.id : null;
  await refreshStatus();

  const hudExists = await fetch(chrome.runtime.getURL("hud/hud.html"), { method: "HEAD" })
    .then((r) => r.ok)
    .catch(() => false);
  if (!hudExists) {
    openHud.disabled = true;
    openHud.textContent = "HUD not built yet";
  }
}

function render() {
  presetRadios.forEach((r) => (r.checked = r.value === settings.preset));
  onFlashRadios.forEach((r) => (r.checked = r.value === settings.onFlash));
  guardedStart.checked = settings.guardedStart;
  failClosed.checked = settings.failClosed;
  hud.checked = settings.hud;
  if (domain) siteBox.checked = !settings.allowlist.includes(domain);
}

/** @param {Partial<import("../src/shared/settings.js").Settings>} patch */
async function save(patch) {
  settings = normalizeSettings({ ...settings, ...patch });
  await chrome.storage.local.set({ settings });
  render();
}

async function onSiteToggle() {
  if (!domain) return;
  const allow = new Set(settings.allowlist);
  if (siteBox.checked) allow.delete(domain);
  else allow.add(domain);
  await save({ allowlist: [...allow] });
  setTimeout(refreshStatus, 300);
}

async function refreshStatus() {
  if (tabId === null) {
    statusEl.textContent = "FlashBan can't run on this page.";
    return;
  }
  /** @type {any} */
  let status = null;
  try {
    status = await chrome.tabs.sendMessage(tabId, { type: "getStatus", v: 1 }, { frameId: 0 });
  } catch {
    status = null;
  }
  if (!status || status.type !== "status") {
    statusEl.textContent = "FlashBan can't run on this page (browser pages and the web store are off limits). Reload the page if you just installed it.";
    siteBox.disabled = true;
    return;
  }
  domain = typeof status.domain === "string" ? status.domain : "";
  siteName.textContent = domain || "this site";
  siteBox.disabled = !domain;
  render();

  if (!status.enabled) {
    statusEl.textContent = `Off for ${domain}: you chose "Show original" here, or turned it off. Turn the switch on to protect this site again.`;
    return;
  }
  if (status.repeatOffender && status.enabled && !status.lockdown) {
    statusEl.textContent = `FlashBan has found flashing on ${domain} before, so it's being extra careful here (strict, and media it can't check stays dimmed).`;
    return;
  }
  if (status.lockdown) {
    statusEl.textContent = "This page kept flashing and tried to remove FlashBan's protection, so the whole page is dimmed. To see it anyway, turn off protection for this site below.";
    return;
  }
  const parts = [];
  if (status.covered) parts.push(`${status.covered} item${status.covered === 1 ? "" : "s"} hidden for flashing`);
  if (status.dimmed) parts.push(`${status.dimmed} dimmed`);
  parts.push(`watching ${status.sources} media item${status.sources === 1 ? "" : "s"}`);
  let text = `On. ${capitalize(parts.join(", "))}.`;
  if (status.detector === "error") text += " The flash detector failed to load, so media is dimmed.";
  statusEl.textContent = text;
}

/** The local log: count, list, clear. Text only (textContent), never HTML. */
async function renderData() {
  const stored = await chrome.storage.local.get("log");
  const domains = stored.log && typeof stored.log.domains === "object" ? stored.log.domains : {};
  const rows = Object.entries(domains).sort((a, b) => (b[1]?.lastSeen ?? 0) - (a[1]?.lastSeen ?? 0));
  dataList.replaceChildren();
  if (rows.length === 0) {
    dataSummary.textContent = "Your log is empty. FlashBan hasn't hidden flashing on any site yet.";
    dataDetails.hidden = true;
    clearData.disabled = true;
    return;
  }
  dataSummary.textContent = `FlashBan has hidden flashing on ${rows.length} site${rows.length === 1 ? "" : "s"}. Only the site name and the time are kept.`;
  for (const [name, e] of rows) {
    const li = document.createElement("li");
    const when = Number.isFinite(e?.lastSeen) ? new Date(e.lastSeen).toLocaleDateString() : "unknown date";
    li.textContent = `${name}: ${e?.count ?? 1} time${e?.count === 1 ? "" : "s"}, last on ${when}`;
    dataList.append(li);
  }
  dataDetails.hidden = false;
  clearData.disabled = false;
}

async function onClearData() {
  await chrome.storage.local.remove("log");
  await renderData();
  dataStatus.textContent = "Your FlashBan data was cleared.";
}

async function onOpenHud() {
  if (tabId === null) return;
  if (!settings.hud) await save({ hud: true });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`hud/hud.html?tab=${tabId}`) });
}

/** @param {string} s */
function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
