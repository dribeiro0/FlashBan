// Script-driven DOM flicker (class / style / hidden toggles) has no pixels we
// can read, so we estimate what an element looks like from its computed style:
// its background composited over whatever is behind it, with opacity,
// visibility and simple filters applied. The result is fed to the detector as
// a 1x1 "frame" whose area is the element's visible area.
//
// The colour maths below is pure (unit-tested in Node); the DOM helpers at the
// bottom read computed styles.

/** @typedef {[number, number, number]} RGB   0..255 per channel */
/** @typedef {[number, number, number, number]} RGBA   alpha 0..1 */

/**
 * Parse a computed colour ("rgb(1, 2, 3)", "rgba(1, 2, 3, 0.5)", "transparent").
 * Browsers always serialise computed colours this way for sRGB; anything else
 * (color(display-p3 ...), oklch(...)) returns null.
 * @param {string} value
 * @returns {RGBA | null}
 */
export function parseComputedColor(value) {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  if (s === "transparent") return [0, 0, 0, 0];
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (!m) return parseModernColor(s);
  const rgb = [m[1], m[2], m[3]].map(Number);
  let a = 1;
  if (m[4] !== undefined) a = m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  if (rgb.some((c) => !Number.isFinite(c)) || !Number.isFinite(a)) return null;
  return [clamp255(rgb[0]), clamp255(rgb[1]), clamp255(rgb[2]), Math.min(1, Math.max(0, a))];
}

/**
 * CSS Color 4 computed values. Chrome keeps the authored colour space in the
 * computed value for oklch()/oklab()/lab()/lch()/color(), and Tailwind v4
 * sites author everything in oklch, so without this every element on such a
 * site reads as "colour we can't read" and gets dimmed. Wide-gamut colours
 * are clipped to sRGB, which is what a flash detector needs anyway.
 * @param {string} s  lower-cased computed value
 * @returns {RGBA | null}
 */
function parseModernColor(s) {
  const m = /^(oklch|oklab|lab|lch|color)\((.*)\)$/.exec(s);
  if (!m) return null;
  let body = m[2].trim();
  let alpha = 1;
  const slash = body.indexOf("/");
  if (slash >= 0) {
    const a = body.slice(slash + 1).trim();
    alpha = a.endsWith("%") ? Number(a.slice(0, -1)) / 100 : Number(a);
    body = body.slice(0, slash).trim();
  }
  const parts = body.split(/\s+/);
  const num = (/** @type {string} */ v, /** @type {number} */ pct) => {
    if (v === "none") return 0;
    if (v.endsWith("%")) return (Number(v.slice(0, -1)) / 100) * pct;
    return Number(v);
  };
  /** @type {number[] | null} */
  let lin = null; // linear sRGB
  if (m[1] === "color") {
    const space = parts.shift();
    if (parts.length !== 3) return null;
    const c = parts.map((v) => num(v, 1));
    if (space === "srgb") lin = c.map(srgbToLinear);
    else if (space === "srgb-linear") lin = c;
    else if (space === "display-p3") lin = p3ToLinearSrgb(c.map(srgbToLinear));
    else return null;
  } else {
    if (parts.length !== 3) return null;
    const isOk = m[1].startsWith("ok");
    let L = num(parts[0], isOk ? 1 : 100);
    let a;
    let b;
    if (m[1] === "oklch" || m[1] === "lch") {
      const C = num(parts[1], isOk ? 0.4 : 150);
      const h = parts[2] === "none" ? 0 : (Number(parts[2].replace(/deg$/, "")) * Math.PI) / 180;
      a = C * Math.cos(h);
      b = C * Math.sin(h);
    } else {
      a = num(parts[1], isOk ? 0.4 : 125);
      b = num(parts[2], isOk ? 0.4 : 125);
    }
    lin = isOk ? oklabToLinearSrgb(L, a, b) : labToLinearSrgb(L, a, b);
  }
  if (!lin || lin.some((v) => !Number.isFinite(v)) || !Number.isFinite(alpha)) return null;
  const rgb = lin.map((v) => clamp255(Math.round(linearToSrgb(Math.min(1, Math.max(0, v))) * 255)));
  return [rgb[0], rgb[1], rgb[2], Math.min(1, Math.max(0, alpha))];
}

/** @param {number} c  0..1 */
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
/** @param {number} c  0..1 */
function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}
/** @param {number} L @param {number} a @param {number} b */
function oklabToLinearSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
/** CIE Lab (D50) to linear sRGB (D65), Bradford-adapted matrix. @param {number} L @param {number} a @param {number} b */
function labToLinearSrgb(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (/** @type {number} */ t) => (t > 6 / 29 ? t ** 3 : 3 * (6 / 29) ** 2 * (t - 4 / 29));
  const X = 0.9642956 * inv(fx);
  const Y = 1.0 * inv(fy);
  const Z = 0.8251046 * inv(fz);
  return [
    3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z,
    -0.9787684 * X + 1.9161415 * Y + 0.033454 * Z,
    0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z,
  ];
}
/** @param {number[]} p  linear display-p3 */
function p3ToLinearSrgb(p) {
  const [r, g, b] = p;
  return [
    1.2249401762 * r - 0.2249401762 * g,
    -0.0420569547 * r + 1.0420569547 * g,
    -0.0196375546 * r - 0.0786360455 * g + 1.0982736001 * b,
  ];
}

/**
 * Source-over composite of `top` (with alpha) onto an opaque `bottom`.
 * Browsers blend in sRGB space, so we do too.
 * @param {RGB} bottom @param {RGB} top @param {number} alpha
 * @returns {RGB}
 */
export function composite(bottom, top, alpha) {
  const a = Math.min(1, Math.max(0, alpha));
  return [0, 1, 2].map((i) => clamp255(top[i] * a + bottom[i] * (1 - a)));
}

/**
 * Apply the simple CSS filter functions that change brightness:
 * invert, brightness, contrast, grayscale, opacity. Anything else (blur,
 * drop-shadow, url()) leaves the colour unchanged.
 * Returns { color, opacity } where opacity is the extra opacity from opacity().
 * @param {RGB} color @param {string} filter
 */
export function applyFilter(color, filter) {
  let [r, g, b] = color;
  let opacity = 1;
  if (!filter || filter === "none") return { color: /** @type {RGB} */ ([r, g, b]), opacity };
  const re = /([a-z-]+)\(\s*([^)]*)\)/g;
  let m;
  while ((m = re.exec(filter))) {
    const fn = m[1];
    const amount = parseAmount(m[2]);
    if (amount === null) continue;
    if (fn === "invert") {
      const k = Math.min(1, amount);
      [r, g, b] = [r, g, b].map((c) => c * (1 - k) + (255 - c) * k);
    } else if (fn === "brightness") {
      [r, g, b] = [r, g, b].map((c) => c * amount);
    } else if (fn === "contrast") {
      [r, g, b] = [r, g, b].map((c) => (c - 127.5) * amount + 127.5);
    } else if (fn === "grayscale") {
      const k = Math.min(1, amount);
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      [r, g, b] = [r, g, b].map((c) => c * (1 - k) + y * k);
    } else if (fn === "opacity") {
      opacity *= Math.min(1, amount);
    }
  }
  return { color: /** @type {RGB} */ ([clamp255(r), clamp255(g), clamp255(b)]), opacity };
}

/** @param {string} raw "0.5", "50%", "" (default 1) */
function parseAmount(raw) {
  const s = raw.trim();
  if (s === "") return 1;
  const v = s.endsWith("%") ? Number(s.slice(0, -1)) / 100 : Number(s);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/** @param {number} c */
function clamp255(c) {
  return Math.min(255, Math.max(0, Math.round(c)));
}

/**
 * WCAG relative luminance of an sRGB colour (0..1).
 * @param {RGB} rgb
 */
export function relativeLuminance(rgb) {
  const lin = rgb.map((c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

// ---------------------------------------------------------------- DOM helpers

const PAGE_DEFAULT = /** @type {RGB} */ ([255, 255, 255]);

/**
 * What is painted behind `el`: the first fully opaque ancestor background,
 * compositing any translucent ancestor backgrounds in between, falling back to
 * the root background or white. Also returns the product of ancestor opacity.
 * @param {Element} el
 * @returns {{ color: RGB, opacity: number, ok: boolean }}
 */
export function backdropOf(el) {
  /** @type {{ color: RGBA, opacity: number }[]} */
  const layers = [];
  let opacity = 1;
  let ok = true;
  let base = null;
  for (let p = el.parentElement, depth = 0; p && depth < 64; p = p.parentElement, depth++) {
    const cs = getComputedStyle(p);
    opacity *= Number(cs.opacity) || 0;
    const bg = parseComputedColor(cs.backgroundColor);
    if (!bg) {
      ok = false;
      continue;
    }
    if (bg[3] >= 0.999) {
      base = /** @type {RGB} */ ([bg[0], bg[1], bg[2]]);
      break;
    }
    if (bg[3] > 0) layers.push({ color: bg, opacity: 1 });
  }
  if (!base) {
    const rootBg = parseComputedColor(getComputedStyle(document.documentElement).backgroundColor);
    base = rootBg && rootBg[3] >= 0.999 ? /** @type {RGB} */ ([rootBg[0], rootBg[1], rootBg[2]]) : PAGE_DEFAULT;
  }
  let color = base;
  for (let i = layers.length - 1; i >= 0; i--) {
    const c = layers[i].color;
    color = composite(color, [c[0], c[1], c[2]], c[3]);
  }
  return { color, opacity, ok };
}

/**
 * Estimated on-screen colour of `el`'s box.
 * @param {Element} el
 * @param {{ color: RGB, opacity: number, ok: boolean }} backdrop  from backdropOf (may be cached)
 * @returns {{ color: RGB, ok: boolean }}
 */
export function effectiveColor(el, backdrop) {
  const cs = getComputedStyle(el);
  const visible =
    typeof el.checkVisibility === "function"
      ? el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })
      : cs.display !== "none" && cs.visibility === "visible";
  if (!visible) return { color: backdrop.color, ok: backdrop.ok };
  const bg = parseComputedColor(cs.backgroundColor);
  if (!bg) return { color: backdrop.color, ok: false };
  const filtered = applyFilter([bg[0], bg[1], bg[2]], cs.filter);
  const alpha = bg[3] * (Number(cs.opacity) || 0) * filtered.opacity * backdrop.opacity;
  return { color: composite(backdrop.color, filtered.color, alpha), ok: backdrop.ok };
}

/**
 * Visible area of an element in CSS px (clipped to the viewport).
 * @param {Element} el
 */
export function visibleArea(el) {
  const r = el.getBoundingClientRect();
  const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
  const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
  return { area: w * h, rect: r };
}
