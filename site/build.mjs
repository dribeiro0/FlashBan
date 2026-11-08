// Packages extension/ into a reproducible zip for the website's download page.
//   node site/build.mjs            -> site/download/flashban-<version>.zip, .sha256 and latest.js
// Reproducible: fixed file order, fixed timestamps, no compression, so the same source always gives the
// same bytes and the same SHA-256. Anyone can rebuild and compare. No dependencies.
// Leaves out tests and design notes; the zip holds one folder you can "Load unpacked".
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(ROOT, "extension");

/** Files that ship: everything under extension/ except tests and markdown notes. */
export function ships(rel) {
  const p = rel.replaceAll("\\", "/");
  if (p.startsWith("test/")) return false;
  if (p.endsWith(".test.js") || p.endsWith(".md")) return false;
  return true;
}

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// DOS date/time fixed at 1980-01-01 00:00 so timestamps never change the bytes.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** Builds a stored (uncompressed) zip from [{name, data}] in the given order. */
export function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    // extra, comment, disk, internal attrs = 0
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

/** Reads extension/ and returns the package (no files written). */
export async function buildPackage(extDir = EXT) {
  const manifest = JSON.parse(await readFile(join(extDir, "manifest.json"), "utf8"));
  const version = manifest.version;
  if (!/^\d+(\.\d+){0,3}$/.test(version)) throw new Error("manifest version is not a Chrome version string");
  const folder = `flashban-${version}`;
  const files = (await walk(extDir))
    .map((p) => relative(extDir, p).replaceAll("\\", "/"))
    .filter(ships)
    .sort();
  const entries = [];
  for (const rel of files) entries.push({ name: `${folder}/${rel}`, data: await readFile(join(extDir, rel)) });
  const bytes = zip(entries);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    version,
    folder,
    file: `${folder}.zip`,
    bytes,
    sha256,
    files,
    permissions: manifest.permissions || [],
    hostPermissions: manifest.host_permissions || [],
  };
}

async function main() {
  const pkg = await buildPackage();
  const out = join(ROOT, "site", "download");
  await mkdir(out, { recursive: true });
  await writeFile(join(out, pkg.file), pkg.bytes);
  await writeFile(join(out, `${pkg.file}.sha256`), `${pkg.sha256}  ${pkg.file}\n`);
  let commit = "";
  try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
  const info = {
    version: pkg.version,
    file: pkg.file,
    folder: pkg.folder,
    sha256: pkg.sha256,
    size: pkg.bytes.length,
    fileCount: pkg.files.length,
    permissions: pkg.permissions,
    hostPermissions: pkg.hostPermissions,
    commit,
  };
  // A classic script (not JSON + fetch) so the page also works when opened from file://.
  await writeFile(join(out, "latest.js"), `// Generated by node site/build.mjs. Do not edit.\nwindow.FLASHBAN_DOWNLOAD = ${JSON.stringify(info, null, 2)};\n`);
  console.log(`${pkg.file}  ${pkg.bytes.length} bytes  ${pkg.files.length} files\nsha256 ${pkg.sha256}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
