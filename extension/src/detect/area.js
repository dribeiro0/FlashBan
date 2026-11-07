// Area rule v2 (DESIGN.md section 5, W3C Understanding 2.3.1).
// WCAG judges the "combined area of flashes occurring concurrently" within any
// 10-degree visual field, which at 1024x768 is a 341 x 256 CSS px rectangle.
// Two refinements over "count every flashing pixel on the element":
//  (b) spatial: the largest flashing area inside any 341 x 256 box (either
//      orientation, so it doesn't matter which way the field is turned);
//  (c) temporal: pixels count together only if their flashing overlaps in
//      time. Each pixel's flashing span in the window is widened by half of its
//      own average interval between transitions (a "half-cycle" slack), so any
//      two regions strobing at a similar rate always overlap, whatever their
//      phase (a checkerboard can't slip through), while a burst early in the
//      window and a different burst late in it don't add up.
// The reported area is min(spatial max, temporal max): each is an upper bound
// of the true joint maximum, so the minimum still never under-counts.
// Pure module: no DOM, no chrome.*.

export const FIELD_W = 341;
export const FIELD_H = 256;

/**
 * Largest number of set cells in any bw x bh window of a W x H mask.
 * @param {Uint8Array} mask @param {number} W @param {number} H
 * @param {number} bw @param {number} bh @param {Uint32Array} sat  scratch, (W+1)*(H+1)
 */
export function maxInBox(mask, W, H, bw, bh, sat) {
  bw = Math.min(W, Math.max(1, bw));
  bh = Math.min(H, Math.max(1, bh));
  const S = W + 1;
  for (let x = 0; x <= W; x++) sat[x] = 0;
  for (let y = 1; y <= H; y++) {
    let row = 0;
    sat[y * S] = 0;
    for (let x = 1; x <= W; x++) {
      row += mask[(y - 1) * W + (x - 1)];
      sat[y * S + x] = sat[(y - 1) * S + x] + row;
    }
  }
  let best = 0;
  for (let y = bh; y <= H; y++) {
    for (let x = bw; x <= W; x++) {
      const v = sat[y * S + x] - sat[(y - bh) * S + x] - sat[y * S + x - bw] + sat[(y - bh) * S + x - bw];
      if (v > best) best = v;
    }
  }
  return best;
}

/**
 * Largest box count over both field orientations, in sample pixels.
 * @param {Uint8Array} mask @param {number} W @param {number} H
 * @param {number} scale  CSS px per sample px @param {Uint32Array} sat
 */
export function maxInField(mask, W, H, scale, sat) {
  const a = Math.ceil(FIELD_W / scale);
  const b = Math.ceil(FIELD_H / scale);
  if (a >= W && b >= H && b >= W && a >= H) {
    let n = 0;
    for (let i = 0; i < mask.length; i++) n += mask[i];
    return n;
  }
  return Math.max(maxInBox(mask, W, H, a, b, sat), maxInBox(mask, W, H, b, a, sat));
}

/**
 * Largest number of spans [start, end] that overlap at one instant.
 * @param {Float64Array} starts @param {Float64Array} ends @param {number} n
 */
export function maxOverlap(starts, ends, n) {
  if (n <= 1) return n;
  // Spans all lie within a couple of seconds, so count them in 1 ms buckets
  // (linear time) instead of sorting.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (starts[i] < lo) lo = starts[i];
    if (ends[i] > hi) hi = ends[i];
  }
  const size = Math.ceil(hi - lo) + 2;
  if (size <= 8192 && Number.isFinite(size)) {
    const diff = new Int32Array(size + 1);
    for (let i = 0; i < n; i++) {
      diff[Math.floor(starts[i] - lo)]++;
      diff[Math.floor(ends[i] - lo) + 1]--; // closed span: still open in its last bucket
    }
    let open = 0;
    let best = 0;
    for (let k = 0; k <= size; k++) {
      open += diff[k];
      if (open > best) best = open;
    }
    return best;
  }
  const s = Array.from(starts.subarray(0, n)).sort((x, y) => x - y);
  const e = Array.from(ends.subarray(0, n)).sort((x, y) => x - y);
  let best = 0;
  let open = 0;
  let j = 0;
  for (let i = 0; i < n; i++) {
    // Spans are closed: one that ends exactly when another starts still overlaps.
    while (j < n && e[j] < s[i]) {
      open--;
      j++;
    }
    open++;
    if (open > best) best = open;
  }
  return best;
}
