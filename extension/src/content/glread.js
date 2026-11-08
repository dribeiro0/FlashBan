// Asynchronous frame readback through WebGL2 (Sat 11:10 PM, Avery's laptop).
//
// A 2D canvas drawImage(video) + getImageData stalls the main thread until
// the GPU has decoded, scaled and copied the frame back: 16-20 ms per read on
// a real Windows laptop for a plain 720p YouTube video, so the cost guard
// called ordinary videos "couldn't keep up" and covered them, and the soften
// layer (two reads per frame) made pages janky. Here the frame is uploaded
// and scaled on the GPU, read into a pixel buffer, and fetched once a fence
// says the GPU is done: about 1 ms of main-thread time per read, measured on
// the same laptop and video.
//
// read() returns a promise of RGBA pixels (top row first, like getImageData),
// or null when this reader can't be used (no WebGL2, context lost, too many
// reads in flight); the caller then uses its synchronous 2D path. A source
// the page can't read (cross-origin) throws SecurityError synchronously, the
// same as getImageData would.

const MAX_IN_FLIGHT = 6; // across all callers; more means the GPU is far behind
const POLL_MS = 1;

/** @type {ReturnType<typeof create> | null | undefined} */
let shared;

/**
 * @param {CanvasImageSource} source
 * @param {number} w
 * @param {number} h
 * @returns {Promise<Uint8ClampedArray> | null}
 */
export function readAsync(source, w, h) {
  if (shared === undefined) {
    try {
      shared = create();
    } catch {
      shared = null;
    }
  }
  if (!shared || shared.lost) return null;
  return shared.read(source, w, h);
}

/** For tests and diagnostics. */
export function asyncReadAvailable() {
  if (shared === undefined) readAsync(/** @type {any} */ (null), 0, 0);
  return !!shared && !shared.lost;
}

function create() {
  if (typeof OffscreenCanvas !== "function") return null;
  const canvas = new OffscreenCanvas(1, 1);
  const gl = /** @type {WebGL2RenderingContext | null} */ (
    canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power" })
  );
  if (!gl) return null;

  const vs = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = vec2(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;
  // Framebuffer row 0 (bottom) samples the source's top row (uv.y = 0, since
  // the upload isn't flipped), so readPixels returns the top row first.
  const fs = `#version 300 es
precision mediump float;
uniform sampler2D t; in vec2 uv; out vec4 o;
void main() { o = vec4(texture(t, uv).rgb, 1.0); }`;
  const prog = gl.createProgram();
  for (const [type, src] of /** @type {[number, string][]} */ ([[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]])) {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) return null;
    gl.attachShader(prog, s);
  }
  gl.bindAttribLocation(prog, 0, "p");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.uniform1i(gl.getUniformLocation(prog, "t"), 0);

  /** @type {Map<string, { fbo: WebGLFramebuffer, tex: WebGLTexture }>} */
  const targets = new Map();
  /** @type {{ w: number, h: number, pbo: WebGLBuffer, sync: WebGLSync, resolve: (d: Uint8ClampedArray) => void, reject: (e: any) => void }[]} */
  const jobs = [];
  /** @type {WebGLBuffer[]} */
  const freePbos = [];
  let polling = false;
  const state = { lost: false, read };

  canvas.addEventListener?.("webglcontextlost", () => {
    state.lost = true;
    for (const j of jobs.splice(0)) j.reject(new Error("context lost"));
  });

  /** @param {number} w @param {number} h */
  function target(w, h) {
    const key = `${w}x${h}`;
    let t = targets.get(key);
    if (!t) {
      if (targets.size > 8) {
        for (const old of targets.values()) {
          gl.deleteFramebuffer(old.fbo);
          gl.deleteTexture(old.tex);
        }
        targets.clear();
      }
      const ttex = /** @type {WebGLTexture} */ (gl.createTexture());
      gl.bindTexture(gl.TEXTURE_2D, ttex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer());
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ttex, 0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      t = { fbo, tex: ttex };
      targets.set(key, t);
    }
    return t;
  }

  /** @param {CanvasImageSource} source @param {number} w @param {number} h */
  function read(source, w, h) {
    if (state.lost || !source || !(w > 0) || !(h > 0)) return null;
    if (jobs.length >= MAX_IN_FLIGHT) return null;
    if (gl.isContextLost()) {
      state.lost = true;
      return null;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Throws SecurityError for a tainted source, like getImageData.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, /** @type {any} */ (source));
    const t = target(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const pbo = freePbos.pop() || /** @type {WebGLBuffer} */ (gl.createBuffer());
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    if (!sync) {
      freePbos.push(pbo);
      return null;
    }
    return new Promise((resolve, reject) => {
      jobs.push({ w, h, pbo, sync, resolve, reject });
      if (!polling) {
        polling = true;
        setTimeout(poll, POLL_MS);
      }
    });
  }

  function poll() {
    // Fences signal in order, so finish jobs from the front.
    while (jobs.length) {
      const j = jobs[0];
      let status;
      try {
        status = gl.clientWaitSync(j.sync, 0, 0);
      } catch {
        status = gl.WAIT_FAILED;
      }
      if (status === gl.TIMEOUT_EXPIRED) break;
      jobs.shift();
      gl.deleteSync(j.sync);
      if (status === gl.WAIT_FAILED) {
        freePbos.push(j.pbo);
        j.reject(new Error("readback failed"));
        continue;
      }
      const out = new Uint8ClampedArray(j.w * j.h * 4);
      try {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, j.pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      } catch (e) {
        freePbos.push(j.pbo);
        j.reject(e);
        continue;
      }
      freePbos.push(j.pbo);
      j.resolve(out);
    }
    if (jobs.length && !state.lost) setTimeout(poll, POLL_MS);
    else polling = false;
  }

  return state;
}
