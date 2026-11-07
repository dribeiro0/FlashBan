// Demo HUD: an extension page that subscribes to one tab's detector reports (CONTRACTS 3a).
// Renders with textContent only. Announces only state changes, never per-frame values.
import { parseHudMessage, formatRow } from "./view.js";

const statusEl = document.getElementById("status");
const pageEl = document.getElementById("page");
const rowsEl = document.getElementById("rows");
const emptyEl = document.getElementById("empty");

const tabId = Number(new URLSearchParams(location.search).get("tab"));
/** @type {Map<string, {row: object, at: number, tr: HTMLTableRowElement, severity: string}>} */
const sources = new Map();
let page = null;
let pageAt = 0;
let enabled = null;

function say(text) {
  if (statusEl.textContent !== text) statusEl.textContent = text;
}

function connect() {
  const port = chrome.runtime.connect({ name: "hud" });
  port.onMessage.addListener((m) => onMessage(parseHudMessage(m, tabId)));
  port.onDisconnect.addListener(() => {
    say("Disconnected from the extension. Reconnecting…");
    setTimeout(connect, 1000);
  });
  port.postMessage({ type: "hudSubscribe", v: 1, tabId });
}

function onMessage(msg) {
  if (!msg) return;
  if (msg.kind === "status") {
    enabled = msg.enabled;
    say(enabled ? `Connected to tab ${tabId}. Waiting for reports.` : 'The Demo HUD setting is off. Turn it on in the Seizure Shield popup to see numbers.');
  } else if (msg.kind === "report") {
    let s = sources.get(msg.id);
    if (!s) {
      const tr = document.createElement("tr");
      tr.appendChild(document.createElement("th")).scope = "row";
      for (let i = 0; i < 6; i++) tr.appendChild(document.createElement("td"));
      emptyEl.hidden = true;
      rowsEl.appendChild(tr);
      s = { row: msg.row, at: 0, tr, severity: "" };
      sources.set(msg.id, s);
    }
    if (msg.row.severity === "block" && s.severity !== "block") say(`Blocked: ${msg.row.source} source ${msg.id}.`);
    s.row = msg.row;
    s.at = performance.now();
    s.severity = msg.row.severity;
  } else if (msg.kind === "page") {
    page = msg.page;
    pageAt = performance.now();
  }
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

// Repaint 4 times per second: readable, and text changes are not a flash risk.
function render() {
  const now = performance.now();
  for (const [id, s] of sources) {
    const f = formatRow(s.row, now - s.at);
    const cells = s.tr.children;
    setText(cells[0], `${s.row.source} ${id}`);
    setText(cells[1], s.row.preset);
    setText(cells[2], f.fps);
    setText(cells[3], f.red);
    setText(cells[4], f.area);
    setText(cells[5], f.rate);
    setText(cells[6], f.severity);
    cells[6].className = f.severity.startsWith("block") ? "block" : "";
  }
  if (page && now - pageAt <= 1000) {
    setText(pageEl, `${page.violation ? "Violation" : "No violation"}: ${Math.round(page.totalAreaPx).toLocaleString("en-US")} px flashing across ${page.count} guarded source(s).`);
    pageEl.className = page.violation ? "block" : "";
  } else if (page) {
    setText(pageEl, "Page result unavailable.");
    pageEl.className = "";
  }
}

if (!Number.isInteger(tabId) || tabId < 0) {
  say("No tab selected. Open the HUD from the Seizure Shield popup.");
} else {
  connect();
  setInterval(render, 250);
}
