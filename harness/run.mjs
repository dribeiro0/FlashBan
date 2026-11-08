// FlashBan attack harness (docs/STRATEGY.md section 7.1).
//
// Loads the unpacked extension into a fresh Chrome profile, serves demo/ on
// localhost, opens every page that declares <meta name="shield-expected">,
// presses Start, and records what the shield did:
//   block  = a "Flashing content hidden" cover appeared or a violation was sent
//   dim    = only a "dimmed" panel appeared (fail-closed dim counts as block)
//   allow  = nothing
// It then compares with the page's expected verdict and prints a table.
//
// No dependencies: Chrome DevTools Protocol over --remote-debugging-pipe,
// Extensions.loadUnpacked (needs --enable-unsafe-extension-debugging).
// Headless by default so nothing flashes on anyone's screen; --headed to watch
// (warning: the demo pages flash).
//
// Usage: node harness/run.mjs [--headed] [--only canvas,css] [--shots dir] [--json file]
// Env:   CHROME=<path to chrome.exe>

import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(ROOT, "extension");
const DEMO = join(ROOT, "demo");
const PORT = 8000 + Math.floor(Math.random() * 900);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const HEADED = flag("--headed");
const ONLY = opt("--only")?.split(",").map((s) => s.trim());
const SHOTS = opt("--shots");
const JSON_OUT = opt("--json");
const RUN_SECONDS = 3;

const CHROME_CANDIDATES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ CDP over a pipe

function connectPipe(child) {
  const out = child.stdio[3]; // we write commands
  const inp = child.stdio[4]; // Chrome writes responses and events
  let buf = "";
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  inp.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const msg = JSON.parse(raw);
      if (msg.id && pending.has(msg.id)) {
        const { ok, fail } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? fail(new Error(`${msg.error.message} (${msg.error.code})`)) : ok(msg.result);
      } else {
        for (const l of listeners) l(msg);
      }
    }
  });
  return {
    send(method, params = {}, sessionId) {
      const id = nextId++;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      out.write(JSON.stringify(payload) + "\0");
      return new Promise((ok, fail) => {
        pending.set(id, { ok, fail });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            fail(new Error(`CDP timeout: ${method}`));
          }
        }, 15000);
      });
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// ------------------------------------------------------------ helpers

async function pagesToRun() {
  /** @type {{ rel: string, expected: string, title: string }[]} */
  const pages = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".html")) {
        const html = await readFile(p, "utf8");
        const m = /<meta\s+name="shield-expected"\s+content="(block|allow)"/i.exec(html);
        if (!m) continue;
        const title = (/<title>([^<]*)<\/title>/i.exec(html)?.[1] || e.name).split("|")[0].trim();
        // Optional <meta name="harness-seconds" content="N"> for pages whose pattern needs a longer run.
        const secs = Number(/<meta\s+name="harness-seconds"\s+content="(\d+)"/i.exec(html)?.[1]);
        // video.html keeps a 3 s default for live demos (Jun); the harness runs it 6 s so the
        // softened part of playback is clearly inside the window.
        const seconds = secs >= 1 && secs <= 15 ? secs : /video.html$/.test(e.name) ? 6 : RUN_SECONDS;
        // Optional <meta name="harness-forbid" content="soften,..."> outcomes that fail even though they
        // count as block elsewhere (on soften-killer pages "soften" means the attack won).
        const forbid = (/<meta\s+name="harness-forbid"\s+content="([a-z,\s]+)"/i.exec(html)?.[1] || "").split(",").map((s) => s.trim()).filter(Boolean);
        pages.push({ rel: relative(DEMO, p).replaceAll("\\", "/"), expected: m[1].toLowerCase(), title, seconds, forbid });
      }
    }
  }
  await walk(DEMO);
  pages.sort((a, b) => a.rel.localeCompare(b.rel));
  return ONLY ? pages.filter((p) => ONLY.some((o) => p.rel.includes(o))) : pages;
}

/** All text under a node (for the panel's reason line). */
function textOf(node) {
  if (!node) return "";
  if (node.nodeType === 3) return node.nodeValue || "";
  return (node.children || []).map(textOf).join(" ").replace(/\s+/g, " ").trim();
}

/** Walk a DOM.getDocument(pierce) tree and collect shield panel labels (with their text). */
function shieldPanels(node, out = []) {
  if (!node) return out;
  if (node.attributes) {
    const a = node.attributes;
    for (let i = 0; i < a.length; i += 2) {
      if (a[i] === "aria-label" && /Flashing content hidden|dimmed by (Seizure Shield|FlashBan)|softened by FlashBan/i.test(a[i + 1])) {
        const text = textOf(node);
        out.push(text ? `${a[i + 1]}: ${text}` : a[i + 1]);
      }
    }
  }
  for (const c of node.children || []) shieldPanels(c, out);
  for (const s of node.shadowRoots || []) shieldPanels(s, out);
  if (node.contentDocument) shieldPanels(node.contentDocument, out);
  return out;
}

// ------------------------------------------------------------ main

async function main() {
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) throw new Error("Chrome not found; set CHROME=<path>");
  const pages = await pagesToRun();
  if (pages.length === 0) throw new Error("no demo pages with shield-expected found");

  const server = spawn(process.execPath, [join(DEMO, "serve.mjs"), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, fail) => {
    server.stdout.once("data", ok);
    server.once("exit", (c) => fail(new Error(`demo server exited ${c}`)));
  });

  const profile = await mkdtemp(join(tmpdir(), "flashban-harness-"));
  const chromeArgs = [
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1280,900",
    "about:blank",
  ];
  if (!HEADED) chromeArgs.unshift("--headless=new");
  const child = spawn(chrome, chromeArgs, { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const cdp = connectPipe(child);

  const results = [];
  try {
    const { id: extId } = await cdp.send("Extensions.loadUnpacked", { path: EXT });

    // Hook the service worker so we see every violation message the content
    // script sends. MV3 service workers restart during long runs, which drops
    // the hook (and our debugger session), so hookWorker() runs before every
    // page and before reading results: it re-finds the worker and re-installs
    // the hook if it's missing.
    await cdp.send("Target.setDiscoverTargets", { discover: true });
    let swSession = null;
    let swTarget = null;
    const HOOK = `(() => {
      if (globalThis.__harness) return "kept";
      globalThis.__harness = [];
      chrome.runtime.onMessage.addListener((m, s) => {
        if (s.id !== chrome.runtime.id || !m || m.type !== "violation") return;
        __harness.push({ url: s.url, source: m.source, reason: m.report && m.report.reason, fps: m.report && m.report.flashesPerSecond, at: Date.now() });
      });
      return "installed";
    })()`;
    const hookWorker = async () => {
      for (let i = 0; i < 50; i++) {
        const { targetInfos } = await cdp.send("Target.getTargets");
        const sw = targetInfos.find((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${extId}/`));
        if (!sw) {
          await sleep(200);
          continue;
        }
        if (sw.targetId !== swTarget || !swSession) {
          ({ sessionId: swSession } = await cdp.send("Target.attachToTarget", { targetId: sw.targetId, flatten: true }));
          swTarget = sw.targetId;
        }
        try {
          await cdp.send("Runtime.evaluate", { expression: HOOK, returnByValue: true }, swSession);
          return swSession;
        } catch {
          swSession = null; // stale session (worker restarted): attach again
        }
      }
      throw new Error("extension service worker not found");
    };
    await hookWorker();

    if (SHOTS) await mkdir(SHOTS, { recursive: true });

    for (const page of pages) {
      await hookWorker();
      const url = `http://127.0.0.1:${PORT}/${page.rel}?seconds=${page.seconds}`;
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Runtime.enable", {}, sessionId);
      await cdp.send("Page.bringToFront", {}, sessionId);
      const loaded = new Promise((ok) => {
        const off = cdp.on((m) => {
          if (m.sessionId === sessionId && m.method === "Page.loadEventFired") {
            off();
            ok();
          }
        });
      });
      await cdp.send("Page.navigate", { url }, sessionId);
      await Promise.race([loaded, sleep(8000)]);
      await sleep(800); // extension loader + detector import

      // Trusted click on Start (real input event, like a user).
      const box = await cdp.send(
        "Runtime.evaluate",
        { expression: `(() => { const b = document.getElementById("start"); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`, returnByValue: true },
        sessionId,
      );
      const xy = box.result.value;
      const startedAt = Date.now();
      if (xy) {
        for (const type of ["mousePressed", "mouseReleased"]) {
          await cdp.send("Input.dispatchMouseEvent", { type, x: xy[0], y: xy[1], button: "left", clickCount: 1 }, sessionId);
        }
      }

      // Sample the shield's panels during the run. The guarded-start "Checking
      // for flashing" dim is expected on every moving source for ~800 ms, so a
      // dim only counts if it is still there at the end of the run.
      let everCovered = false;
      let everSoftened = false;
      let everLocked = false;
      let firstCoverMs = null;
      let lastPanels = [];
      let shot = null;
      const extra = page.rel.includes("video") ? page.seconds * 1000 + 1000 : 0; // video page records first, as long as it plays
      const runEnd = startedAt + page.seconds * 1000 + extra;
      const shoot = async (suffix) => {
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
        const file = join(SHOTS, page.rel.replaceAll("/", "_").replace(/\.html$/, `${suffix}.png`));
        await writeFile(file, Buffer.from(data, "base64"));
        return file;
      };
      while (Date.now() < runEnd - 100) {
        await sleep(400); // DOM.getDocument(pierce) is heavy: polling faster stalls the page and trips the gap rule
        const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true }, sessionId);
        lastPanels = shieldPanels(root);
        // Page lockdown (threat T6 fix): panels are gone on purpose, media is
        // hidden by user-origin CSS, and a banner is drawn in html::after.
        const lock = await cdp.send(
          "Runtime.evaluate",
          { expression: `getComputedStyle(document.documentElement, "::after").content.includes("FlashBan dimmed this page")`, returnByValue: true },
          sessionId,
        );
        // Soften without a layer: a slowed CSS animation, or a DOM element the
        // shield smooths with a 2 s transition. Visible only as page state.
        const softState = await cdp.send(
          "Runtime.evaluate",
          {
            expression: `(() => {
              const s = document.getElementById("stage");
              const slowed = document.getAnimations().some((a) => a.playbackRate > 0 && a.playbackRate < 0.999);
              const smooth = !!s && /(^|[ ,])2s/.test(getComputedStyle(s).transitionDuration);
              return { slowed, smooth };
            })()`,
            returnByValue: true,
          },
          sessionId,
        );
        const ss = softState.result.value || {};
        if (ss.slowed) lastPanels.push("Animation softened by FlashBan (slowed)");
        if (ss.smooth) lastPanels.push("Element softened by FlashBan (smoothed)");
        if ((ss.slowed || ss.smooth) && !everSoftened) {
          everSoftened = true;
          if (firstCoverMs === null) firstCoverMs = Date.now() - startedAt;
        }
        if (lock.result.value === true) {
          lastPanels.push("Page locked down by FlashBan");
          if (!everLocked) {
            everLocked = true;
            if (firstCoverMs === null) firstCoverMs = Date.now() - startedAt;
          }
        }
        if (lastPanels.some((p) => /softened/i.test(p))) everSoftened = true;
        const covered = lastPanels.some((p) => /hidden|softened/i.test(p));
        if (covered && !everCovered) {
          everCovered = true;
          firstCoverMs = Date.now() - startedAt;
          if (SHOTS) {
            await sleep(250);
            shot = await shoot("");
          }
        }
      }
      if (SHOTS && !shot) shot = await shoot("");
      const panels = lastPanels;

      let violations = [];
      try {
        const session = await hookWorker();
        const { result } = await cdp.send(
          "Runtime.evaluate",
          { expression: `JSON.stringify((globalThis.__harness || []).filter((v) => v.url && v.url.includes(${JSON.stringify("/" + page.rel)})))`, returnByValue: true },
          session,
        );
        violations = JSON.parse(result.value);
      } catch {
        // worker restarted mid-page: the visible verdict (panels) still stands
      }
      const covered = everCovered;
      const dimmed = panels.some((p) => /dimmed/i.test(p)); // still dimmed at the end
      const stillSoftened = panels.some((p) => /softened/i.test(p));
      const fellBack = everSoftened && panels.some((p) => /hidden/i.test(p));
      // Only what the user would actually see counts. A violation message with
      // no cover on screen (e.g. the page deleted it) is "detected", not protected.
      const lockedNow = panels.some((p) => /locked down/i.test(p));
      const actual = everSoftened && !fellBack && (stillSoftened || !panels.length)
        ? "soften"
        : everLocked && (lockedNow || !violations.length || covered) ? "lockdown"
        : covered ? "block" : dimmed ? "dim" : violations.length ? "detected" : "allow";
      // Protective outcomes: soften (output verified below the limit), cover,
      // page lockdown (media hidden by user-origin CSS), or fail-closed dim.
      // "detected" always fails: on a block page nothing protected the user; on
      // an allow page it is a false positive (and it lands in the domain log).
      const verdict = ["dim", "soften", "lockdown"].includes(actual) ? "block" : actual;
      results.push({
        page: page.rel,
        title: page.title,
        endPanels: panels,
        expected: page.expected,
        actual,
        pass: verdict === page.expected && !page.forbid.includes(actual),
        firstCoverMs,
        reasons: [...new Set(violations.map((v) => v.reason).filter(Boolean))],
        sources: [...new Set(violations.map((v) => v.source))],
        screenshot: shot,
      });
      await cdp.send("Target.closeTarget", { targetId });
    }
  } finally {
    try {
      await cdp.send("Browser.close");
    } catch {}
    child.kill();
    server.kill();
    await sleep(500);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  // ---------------------------------------------------------------- report
  const rows = results.map((r) => [
    r.pass ? "PASS" : "FAIL",
    r.page,
    r.expected,
    r.actual,
    r.firstCoverMs === null ? "-" : `${r.firstCoverMs} ms`,
    [...r.sources, ...r.reasons].join(" ") || "-",
  ]);
  const head = ["", "page", "expected", "shield", "covered after", "source / reason"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log(line(head));
  for (const r of rows) console.log(line(r));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed} of ${results.length} pages match their expected verdict.`);
  if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  process.exitCode = passed === results.length ? 0 : 1;
}

main().catch((err) => {
  console.error(`harness error: ${err.message}`);
  process.exitCode = 2;
});
