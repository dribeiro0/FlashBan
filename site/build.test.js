// Tests for the download packager: reproducible bytes, valid zip, nothing extra shipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPackage, crc32, normalize, ships, zip } from "./build.mjs";

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("same source gives the same bytes and checksum", async () => {
  const a = await buildPackage();
  const b = await buildPackage();
  assert.equal(a.sha256, b.sha256);
  assert.ok(a.bytes.equals(b.bytes));
});

test("package ships the extension but not tests or notes", async () => {
  const pkg = await buildPackage();
  assert.ok(pkg.files.includes("manifest.json"));
  assert.ok(pkg.files.includes("popup/popup.html"));
  assert.ok(pkg.files.some((f) => f.startsWith("src/detect/")));
  assert.ok(!pkg.files.some((f) => f.startsWith("test/") || f.endsWith(".test.js") || f.endsWith(".md")));
  assert.equal(ships("src/detect/DESIGN.md"), false);
  assert.equal(ships("hud/view.test.js"), false);
});

test("zip has one root folder and a valid end record", async () => {
  const pkg = await buildPackage();
  const buf = pkg.bytes;
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50);
  assert.equal(buf.readUInt16LE(end + 10), pkg.files.length);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);
  assert.equal(cdOffset + cdSize, end);
  // every central-directory name sits under the one versioned folder
  let p = cdOffset;
  for (let i = 0; i < pkg.files.length; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const n = buf.readUInt16LE(p + 28);
    const name = buf.toString("utf8", p + 46, p + 46 + n);
    assert.ok(name.startsWith(pkg.folder + "/"), name);
    p += 46 + n;
  }
});

test("stored entries round-trip their data and CRC", () => {
  const data = Buffer.from("hello flashban");
  const buf = zip([{ name: "a/b.txt", data }]);
  const n = buf.readUInt16LE(26);
  assert.equal(buf.readUInt32LE(14), crc32(data));
  assert.ok(buf.subarray(30 + n, 30 + n + data.length).equals(data));
});

test("text files zip with LF, so Windows (CRLF) checkouts build the same bytes", () => {
  const lf = Buffer.from("a\nb\n"), crlf = Buffer.from("a\r\nb\r\n");
  assert.ok(normalize("src/x.js", crlf).equals(lf));
  assert.ok(normalize("manifest.json", lf).equals(lf));
  const png = Buffer.from([0x89, 0x50, 0x0d, 0x0a]);
  assert.ok(normalize("icon.png", png).equals(png), "binary files are untouched");
});
