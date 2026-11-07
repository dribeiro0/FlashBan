// Is an image file animated? Reads only container headers (no decoding) so the
// background can tell a still cross-origin GIF/WebP/PNG from an animated one.
// Pure: unit-tested in Node.

/**
 * @param {Uint8Array} b   the first bytes of the file (may be truncated)
 * @returns {boolean | null}  true animated, false still, null unknown
 */
export function animatedFromBytes(b) {
  if (!(b instanceof Uint8Array) || b.length < 12) return null;
  if (ascii(b, 0, 3) === "GIF") return gif(b);
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return webp(b);
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return png(b);
  return null;
}

/** @param {Uint8Array} b @param {number} at @param {number} n */
function ascii(b, at, n) {
  let s = "";
  for (let i = at; i < at + n && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** Count image descriptors; 2+ means animated. @param {Uint8Array} b */
function gif(b) {
  let p = 13; // header (6) + logical screen descriptor (7)
  if (b.length < 13) return null;
  if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 0x07) + 1)); // global colour table
  let frames = 0;
  const skipSubBlocks = () => {
    while (p < b.length) {
      const n = b[p];
      p += 1;
      if (n === 0) return true;
      p += n;
    }
    return false; // truncated
  };
  while (p < b.length) {
    const tag = b[p];
    if (tag === 0x3b) return frames >= 2; // trailer
    if (tag === 0x21) {
      p += 2; // extension introducer + label
      if (!skipSubBlocks()) break;
    } else if (tag === 0x2c) {
      frames++;
      if (frames >= 2) return true;
      if (p + 10 > b.length) break;
      const flags = b[p + 9];
      p += 10; // image descriptor
      if (flags & 0x80) p += 3 * (1 << ((flags & 0x07) + 1)); // local colour table
      p += 1; // LZW minimum code size
      if (!skipSubBlocks()) break;
    } else {
      return frames >= 2 ? true : null; // corrupt
    }
  }
  return frames >= 2 ? true : null; // truncated before we could tell
}

/** VP8X animation flag or an ANIM chunk. @param {Uint8Array} b */
function webp(b) {
  const first = ascii(b, 12, 4);
  if (first === "VP8 " || first === "VP8L") return false; // simple (still) format
  if (first !== "VP8X") return null;
  if (b.length < 21) return null;
  return (b[20] & 0x02) !== 0;
}

/** APNG has an acTL chunk before the first IDAT. @param {Uint8Array} b */
function png(b) {
  let p = 8;
  while (p + 8 <= b.length) {
    const len = ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
    const type = ascii(b, p + 4, 4);
    if (type === "acTL") return true;
    if (type === "IDAT") return false;
    p += 12 + len;
  }
  return null;
}
