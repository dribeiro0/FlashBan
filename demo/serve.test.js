// Demo server: stays inside demo/ and survives malformed URLs.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 18093;

test("demo server: path traversal and bad escapes give 404, server keeps running", async (t) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("serve.mjs", import.meta.url)), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  const get = (p) => fetch(`http://127.0.0.1:${PORT}${p}`).then((r) => r.status);

  assert.equal(await get("/%E0%A4%A"), 404);
  assert.equal(await get("/..%2fpackage.json"), 404);
  assert.equal(await get("/%2e%2e/package.json"), 404);
  assert.equal(await get("/index.html"), 200, "still serving after bad requests");
});
