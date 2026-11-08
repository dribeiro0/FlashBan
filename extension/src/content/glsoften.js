// GPU soften filter (soften mode). David's masked brightness clamp
// (extension/src/detect/clamp.js, SOFTEN_DESIGN.md) at the media's own
// resolution in a WebGL fragment shader, so the picture stays sharp:
//
//   avg  = two-stage exponential average of the frame (linear light)
//   inside the flashing mask (weight w, from the detector on the raw frames):
//     luminance is clamped to avg's luminance +/- BAND, keeping avg's
//     chromaticity, with the frame's fine spatial detail (x - lowpass(x))
//     laid back on top, then clamped again to 2*BAND
//   outside the mask: the frame passes through untouched
//   out = mix(frame, clamped, w)
//
// The caller owns the mask (hold, ramp, safe start at w = 1 everywhere) and
// the output verifier. Returns null when WebGL isn't available; the caller
// then uses the 2D-canvas path.

const BAND = 0.03; // linear-light luminance half-band around the average (clamp.js: BAND)
// Average time constant per stage. clamp.js's swing bound (2*BAND plus the
// average's ripple under 0.10) holds for 0.5 s; at 0.2 s David's sim (Sun
// 12:50 AM) let a 2-4 Hz full-swing strobe through at 0.12-0.22, and a
// browser run measured 0.17 at 4 Hz. Don't shorten it to cut trailing: the
// desaturated base below hides the colour smear instead.
const AVG_TAU = 0.5;
// Share of the average's colour kept inside the mask (the rest goes to grey of
// the same luminance): the lagging average's colours looked too vibrant and
// smeared behind moving things (David's real-GPU check), and less saturation
// also means less red. David (Sun 1:25 AM): grey it out entirely, no colour.
const BASE_CHROMA = 0;
// How much of the frame's fine detail is laid back on inside the mask. At 0.6 the
// flat clamped base plus stride-4 detail looked blocky ("cubed"), and the detail
// term is added after the clamp, so less of it is also safer.
const DETAIL_GAIN = 0.2;
const DETAIL_STRIDE_PX = 4; // low-pass tap spacing for the detail estimate
const MAX_STEP = 0.15; // largest share of the way to a new frame the average may move per processed frame

const VERT = `
attribute vec2 p; varying vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const LIN = `
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }`;

// avg' = avg + a (src - avg), src already linear (or converted when fromSrgb = 1)
const FRAG_AVG = `
precision highp float; varying vec2 uv;
uniform sampler2D src; uniform sampler2D prev; uniform float a; uniform float fromSrgb; uniform float flipSrc;
${LIN}
void main() {
  vec2 suv = vec2(uv.x, mix(uv.y, 1.0 - uv.y, flipSrc));
  vec3 s = texture2D(src, suv).rgb; if (fromSrgb > 0.5) s = toLin(s);
  vec3 p = texture2D(prev, uv).rgb;
  gl_FragColor = vec4(p + a * (s - p), 1.0);
}`;

const FRAG_OUT = `
precision highp float; varying vec2 uv;
uniform sampler2D frame; uniform sampler2D avg; uniform sampler2D mask; uniform vec2 texel; uniform float band; uniform float detailGain; uniform float stride; uniform float chroma;
${LIN}
void main() {
  vec2 fuv = vec2(uv.x, 1.0 - uv.y);
  vec3 x = toLin(texture2D(frame, fuv).rgb);
  vec3 A = texture2D(avg, uv).rgb;
  float w = texture2D(mask, fuv).r;
  if (w <= 0.001) { gl_FragColor = vec4(toSrgb(x), 1.0); return; }
  // Fine detail of the frame: x minus a cheap 3x3 low-pass at a wide stride.
  vec2 d = texel * stride;
  vec3 lp = x * 0.25
    + (toLin(texture2D(frame, fuv + vec2(d.x, 0.0)).rgb) + toLin(texture2D(frame, fuv - vec2(d.x, 0.0)).rgb)
    +  toLin(texture2D(frame, fuv + vec2(0.0, d.y)).rgb) + toLin(texture2D(frame, fuv - vec2(0.0, d.y)).rgb)) * 0.125
    + (toLin(texture2D(frame, fuv + d).rgb) + toLin(texture2D(frame, fuv - d).rgb)
    +  toLin(texture2D(frame, fuv + vec2(d.x, -d.y)).rgb) + toLin(texture2D(frame, fuv + vec2(-d.x, d.y)).rgb)) * 0.0625;
  vec3 detail = x - lp;
  float La = lum(A);
  float Lx = lum(x);
  float L = clamp(Lx, La - band, La + band);
  vec3 Ad = mix(vec3(La), A, chroma); // same luminance, less colour
  vec3 base = Ad * (L / max(La, 0.0005));
  vec3 o = base + detail * detailGain;
  float Lo = lum(o);
  float Lc = clamp(Lo, max(La - 2.0 * band, 0.0), La + 2.0 * band);
  o = o * (Lc / max(Lo, 0.0005));
  gl_FragColor = vec4(toSrgb(mix(x, o, w)), 1.0);
}`;

/**
 * @param {HTMLCanvasElement} canvas  the visible output canvas (becomes a WebGL canvas)
 * @param {{ width: number, height: number, maskWidth: number, maskHeight: number }} opts
 * @returns {null | {
 *   frame(source: CanvasImageSource, dt: number, maskWeights: Float32Array | null): boolean,
 *   resize(width: number, height: number): void,
 *   destroy(): void,
 *   readonly lost: boolean,
 * }}
 */
export function createGlSoftener(canvas, opts) {
  /** @type {WebGLRenderingContext | null} */
  let gl = null;
  try {
    gl = /** @type {WebGLRenderingContext | null} */ (canvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: "low-power" }));
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const G = gl;
  const halfFloat = G.getExtension("OES_texture_half_float");
  G.getExtension("OES_texture_half_float_linear");
  const hfRender = !!G.getExtension("EXT_color_buffer_half_float");
  const avgType = halfFloat && hfRender ? halfFloat.HALF_FLOAT_OES : G.UNSIGNED_BYTE;

  function shader(type, src) {
    const sh = G.createShader(type);
    if (!sh) throw new Error("shader");
    G.shaderSource(sh, src);
    G.compileShader(sh);
    if (!G.getShaderParameter(sh, G.COMPILE_STATUS)) throw new Error(G.getShaderInfoLog(sh) || "compile");
    return sh;
  }
  function program(frag) {
    const pr = G.createProgram();
    if (!pr) throw new Error("program");
    G.attachShader(pr, shader(G.VERTEX_SHADER, VERT));
    G.attachShader(pr, shader(G.FRAGMENT_SHADER, frag));
    G.bindAttribLocation(pr, 0, "p");
    G.linkProgram(pr);
    if (!G.getProgramParameter(pr, G.LINK_STATUS)) throw new Error(G.getProgramInfoLog(pr) || "link");
    return pr;
  }
  let progAvg;
  let progOut;
  try {
    progAvg = program(FRAG_AVG);
    progOut = program(FRAG_OUT);
  } catch {
    return null;
  }
  const quad = G.createBuffer();
  G.bindBuffer(G.ARRAY_BUFFER, quad);
  G.bufferData(G.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), G.STATIC_DRAW);
  G.enableVertexAttribArray(0);
  G.vertexAttribPointer(0, 2, G.FLOAT, false, 0, 0);

  function tex(filter) {
    const t = G.createTexture();
    G.bindTexture(G.TEXTURE_2D, t);
    G.texParameteri(G.TEXTURE_2D, G.TEXTURE_MIN_FILTER, filter);
    G.texParameteri(G.TEXTURE_2D, G.TEXTURE_MAG_FILTER, filter);
    G.texParameteri(G.TEXTURE_2D, G.TEXTURE_WRAP_S, G.CLAMP_TO_EDGE);
    G.texParameteri(G.TEXTURE_2D, G.TEXTURE_WRAP_T, G.CLAMP_TO_EDGE);
    return t;
  }
  const frameTex = tex(G.LINEAR);
  const maskTex = tex(G.LINEAR);
  /** @type {{ t: WebGLTexture, f: WebGLFramebuffer }[][]} */
  let avg = []; // [stage][pingpong]
  let W = 0;
  let H = 0;
  let MW = opts.maskWidth;
  let MH = opts.maskHeight;
  let first = true;
  let lost = false;
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    lost = true;
  });

  function allocAvg(w, h) {
    for (const stage of avg) for (const { t, f } of stage) {
      G.deleteTexture(t);
      G.deleteFramebuffer(f);
    }
    avg = [];
    for (let s = 0; s < 2; s++) {
      const pair = [];
      for (let i = 0; i < 2; i++) {
        const t = tex(G.NEAREST);
        G.texImage2D(G.TEXTURE_2D, 0, G.RGBA, w, h, 0, G.RGBA, avgType, null);
        const f = G.createFramebuffer();
        if (!f) throw new Error("fbo");
        G.bindFramebuffer(G.FRAMEBUFFER, f);
        G.framebufferTexture2D(G.FRAMEBUFFER, G.COLOR_ATTACHMENT0, G.TEXTURE_2D, t, 0);
        if (G.checkFramebufferStatus(G.FRAMEBUFFER) !== G.FRAMEBUFFER_COMPLETE) throw new Error("fbo incomplete");
        pair.push({ t, f });
      }
      avg.push(pair);
    }
    G.bindFramebuffer(G.FRAMEBUFFER, null);
    first = true;
  }

  function resize(w, h) {
    W = w;
    H = h;
    canvas.width = w;
    canvas.height = h;
    G.viewport(0, 0, w, h);
    allocAvg(w, h);
  }
  try {
    resize(opts.width, opts.height);
  } catch {
    return null;
  }
  const uAvg = { src: G.getUniformLocation(progAvg, "src"), prev: G.getUniformLocation(progAvg, "prev"), a: G.getUniformLocation(progAvg, "a"), fromSrgb: G.getUniformLocation(progAvg, "fromSrgb"), flipSrc: G.getUniformLocation(progAvg, "flipSrc") };
  const uOut = { frame: G.getUniformLocation(progOut, "frame"), avg: G.getUniformLocation(progOut, "avg"), mask: G.getUniformLocation(progOut, "mask"), texel: G.getUniformLocation(progOut, "texel"), band: G.getUniformLocation(progOut, "band"), detailGain: G.getUniformLocation(progOut, "detailGain"), stride: G.getUniformLocation(progOut, "stride"), chroma: G.getUniformLocation(progOut, "chroma") };
  const ones = new Uint8Array(MW * MH).fill(255);
  const maskBytes = new Uint8Array(MW * MH);
  let ping = 0;

  /** One frame. Returns false when the frame couldn't be uploaded (caller fails closed). */
  function frame(source, dt, maskWeights) {
    if (lost) return false;
    try {
      G.activeTexture(G.TEXTURE0);
      G.bindTexture(G.TEXTURE_2D, frameTex);
      G.pixelStorei(G.UNPACK_FLIP_Y_WEBGL, false);
      G.texImage2D(G.TEXTURE_2D, 0, G.RGBA, G.RGBA, G.UNSIGNED_BYTE, /** @type {TexImageSource} */ (source));
      if (G.getError() !== G.NO_ERROR) return false;
    } catch {
      return false;
    }
    // Mask weights (0..1 per small pixel), LINEAR-sampled in the shader. Null = clamp everything.
    G.activeTexture(G.TEXTURE2);
    G.bindTexture(G.TEXTURE_2D, maskTex);
    G.pixelStorei(G.UNPACK_ALIGNMENT, 1);
    if (maskWeights) for (let i = 0; i < maskBytes.length; i++) maskBytes[i] = Math.round(Math.min(1, Math.max(0, maskWeights[i])) * 255);
    G.texImage2D(G.TEXTURE_2D, 0, G.LUMINANCE, MW, MH, 0, G.LUMINANCE, G.UNSIGNED_BYTE, maskWeights ? maskBytes : ones);

    // tau 0.2 s per stage (SOFTEN_DESIGN). The step is capped so a slow frame
    // loop (a busy page, software GL) still averages over several frames
    // instead of jumping to each new frame, which would let a strobe through.
    const a = first ? 1 : Math.min(MAX_STEP, 1 - Math.exp(-Math.max(0, dt) / 1000 / AVG_TAU));
    first = false;
    // Stage 1: avg1 <- frame (sRGB -> linear). Stage 2: avg2 <- avg1.
    G.useProgram(progAvg);
    G.uniform1f(uAvg.a, a);
    for (let s = 0; s < 2; s++) {
      const src = s === 0 ? frameTex : avg[0][ping ^ 1].t;
      const prev = avg[s][ping].t;
      const dst = avg[s][ping ^ 1];
      G.bindFramebuffer(G.FRAMEBUFFER, dst.f);
      G.viewport(0, 0, W, H);
      G.activeTexture(G.TEXTURE0);
      G.bindTexture(G.TEXTURE_2D, src);
      G.activeTexture(G.TEXTURE1);
      G.bindTexture(G.TEXTURE_2D, prev);
      G.uniform1i(uAvg.src, 0);
      G.uniform1i(uAvg.prev, 1);
      G.uniform1f(uAvg.fromSrgb, s === 0 ? 1 : 0);
      G.uniform1f(uAvg.flipSrc, s === 0 ? 1 : 0); // image sources are top-down; FBO textures are not
      G.drawArrays(G.TRIANGLE_STRIP, 0, 4);
    }
    const avg2 = avg[1][ping ^ 1].t;
    ping ^= 1;
    // Output.
    G.bindFramebuffer(G.FRAMEBUFFER, null);
    G.viewport(0, 0, W, H);
    G.useProgram(progOut);
    G.activeTexture(G.TEXTURE0);
    G.bindTexture(G.TEXTURE_2D, frameTex);
    G.activeTexture(G.TEXTURE1);
    G.bindTexture(G.TEXTURE_2D, avg2);
    G.activeTexture(G.TEXTURE2);
    G.bindTexture(G.TEXTURE_2D, maskTex);
    G.uniform1i(uOut.frame, 0);
    G.uniform1i(uOut.avg, 1);
    G.uniform1i(uOut.mask, 2);
    G.uniform2f(uOut.texel, 1 / W, 1 / H);
    G.uniform1f(uOut.band, BAND);
    G.uniform1f(uOut.detailGain, DETAIL_GAIN);
    G.uniform1f(uOut.stride, DETAIL_STRIDE_PX);
    G.uniform1f(uOut.chroma, BASE_CHROMA);
    G.drawArrays(G.TRIANGLE_STRIP, 0, 4);
    return G.getError() === G.NO_ERROR;
  }

  function destroy() {
    try {
      G.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {}
  }

  return {
    frame,
    resize: (w, h) => {
      try {
        resize(w, h);
      } catch {
        lost = true;
      }
    },
    destroy,
    get lost() {
      return lost;
    },
  };
}
