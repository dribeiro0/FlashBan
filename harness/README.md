# Attack harness

Runs every demo page that declares `<meta name="shield-expected" content="block|allow">` against the real extension and prints whether the shield did what the page expects.

```bash
node harness/run.mjs
```

Options: `--headed` to watch (the pages flash: read their warnings first), `--only canvas,css` to filter by path, `--shots <dir>` to save a screenshot of each page (taken just after the cover appears), `--json <file>` for machine-readable results. Set `CHROME=<path>` if Chrome isn't in the default place.

How it works, with no dependencies:

- It starts Chrome with a throwaway profile, `--remote-debugging-pipe` and `--enable-unsafe-extension-debugging`, then loads `extension/` with the DevTools Protocol command `Extensions.loadUnpacked`. It runs **headless by default**, so nothing flashes on screen.
- It serves `demo/` with `demo/serve.mjs` on a random localhost port.
- It hooks the extension's service worker (test-only, through the debugger) to record every `violation` message.
- For each page it presses Start with a real (trusted) mouse event, then reads the page's DOM, including closed shadow roots, through the debugger to see which shield panels are showing.

Scoring:

| Shield did | Counts as |
|---|---|
| "Flashing content hidden" cover appeared | block |
| Soften layer showed and stayed (output verified by its own detector) | soften (counts as block) |
| Page lockdown banner (`html::after` "FlashBan dimmed this page"; media hidden by user-origin CSS) | lockdown (counts as block) |
| Violation sent but nothing visible protected the user (e.g. the page deleted the cover) | detected (always a FAIL: unprotected on a block page, a false positive on an allow page) |
| Still dimmed at the end of the run | block (fail-closed dim) |
| Only the short guarded-start "Checking for flashing…" dim | allow |
| Nothing | allow |

The exit code is 0 when every page matches. Add a page to `demo/` (or `demo/adversarial/`, `demo/benign/`) with the meta tag and the harness picks it up. Runs last 3 s unless the page sets `<meta name="harness-seconds" content="N">` (1 to 15), e.g. for patterns that repeat slowly.

Known limits: headless timing is noisier than a real window. In headless Chrome, reading canvas pixels back is slow and spiky, so the content script's CPU budget (`COST_LIMIT_MS`, 3 ms average) can occasionally mark a benign canvas unverifiable and dim it ("There is too much moving media to check all of it"). That shows up as a flaky FAIL on an allow page; `--json` records each page's end-of-run panel text (`endPanels`) so you can tell this apart from a real false positive. The harness polls the DOM every 400 ms, because faster polling stalls the page. It can only see what the extension shows in the page; it doesn't measure pixels on screen.
