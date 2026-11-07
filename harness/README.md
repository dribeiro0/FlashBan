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
| "Flashing content hidden" cover appeared, or a violation was sent | block |
| Still dimmed at the end of the run | block (fail-closed dim) |
| Only the short guarded-start "Checking for flashing…" dim | allow |
| Nothing | allow |

The exit code is 0 when every page matches. Add a page to `demo/` (or `demo/adversarial/`, `demo/benign/`) with the meta tag and the harness picks it up.

Known limits: headless timing is a little noisier than a real window, so a borderline page can occasionally end as "dim" instead of "block" (both count as block). The harness can only see what the extension shows in the page; it doesn't measure pixels on screen.
