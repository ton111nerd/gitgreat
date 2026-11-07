"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

/**
 * Realistic deep-space backdrop rendered with WebGL:
 * - pass 1 (low resolution, only when the camera moves): domain-warped fbm nebula + Milky Way band with dust lanes
 * - pass 2 (full resolution, every frame): composite + three parallax star layers with
 *   temperature colours and twinkle, optional procedural planet with atmosphere, tone mapping, grain.
 * Falls back to the CSS background of the wrapper when WebGL is unavailable.
 */

export interface PlanetSpec {
  /** centre, as a fraction of width / height (y from top; may lie outside 0..1) */
  x: number;
  y: number;
  /** radius as a fraction of min(width, height) */
  r: number;
}

export interface BackdropApi {
  /** Camera offset in CSS pixels (e.g. the pan of the explorer). */
  setCamera(x: number, y: number): void;
}

interface Props {
  planet?: PlanetSpec | null;
  planetMobile?: PlanetSpec | null;
  /** Follow the pointer with a subtle parallax (landing hero). */
  pointerParallax?: boolean;
  animate?: boolean;
  className?: string;
  apiRef?: Ref<BackdropApi>;
}

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const COMMON = `
precision highp float;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
`;

// Pass 1: nebula + milky way (rendered small, upscaled with bilinear filtering).
const NEBULA_FRAG = `${COMMON}
uniform vec2 uRes;      // target size in px
uniform vec2 uCam;      // camera offset (css px)
uniform float uCss;     // css px per target px
void main() {
  vec2 px = gl_FragCoord.xy * uCss;                // css px, y up
  vec2 uv = (px + vec2(-uCam.x, uCam.y) * 0.06) / 520.0;

  // domain-warped fbm (Inigo Quilez)
  vec2 q = vec2(fbm(uv + vec2(0.0, 0.0)), fbm(uv + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(uv + 3.0 * q + vec2(1.7, 9.2)), fbm(uv + 3.0 * q + vec2(8.3, 2.8)));
  float n = fbm(uv + 2.6 * r);

  vec3 deep = vec3(0.012, 0.016, 0.045);
  vec3 col = deep;
  col = mix(col, vec3(0.07, 0.06, 0.20), clamp(n * n * 1.8, 0.0, 1.0));
  col = mix(col, vec3(0.30, 0.10, 0.36), clamp(length(q) * n - 0.62, 0.0, 1.0) * 0.9);
  col = mix(col, vec3(0.05, 0.24, 0.36), clamp(r.x * r.x * n * 1.4 - 0.32, 0.0, 1.0) * 0.8);
  col = mix(col, vec3(0.55, 0.32, 0.30), clamp(r.y * n * n * 2.2 - 0.62, 0.0, 1.0) * 0.35);

  float mask = smoothstep(0.38, 0.86, fbm(uv * 0.55 + vec2(11.0, 3.0)));
  col = deep + (col - deep) * (0.18 + 1.25 * mask);

  // Milky Way: diagonal band of diffuse light with dark dust lanes
  vec2 bandDir = normalize(vec2(1.0, 0.38));
  vec2 bp = (px + vec2(-uCam.x, uCam.y) * 0.04) / 900.0;
  float d = dot(bp, vec2(-bandDir.y, bandDir.x)) - 0.55 + 0.12 * sin(bp.x * 1.3);
  float band = exp(-d * d * 9.0);
  float dust = smoothstep(0.42, 0.75, fbm(bp * 7.0 + vec2(3.0, 7.0)));
  float glow = band * (0.55 + 0.45 * fbm(bp * 3.5));
  col += vec3(0.20, 0.19, 0.25) * glow * (1.0 - 0.85 * dust) * 0.55;

  gl_FragColor = vec4(col, 1.0);
}
`;

// Pass 2: composite, stars, planet.
const MAIN_FRAG = `${COMMON}
uniform vec2 uRes;      // drawing buffer px
uniform float uDpr;
uniform vec2 uCam;      // css px
uniform float uTime;
uniform sampler2D uNebula;
uniform vec4 uPlanet;   // x, y (buffer px, y up), radius (buffer px), enabled
uniform vec2 uLight;    // light direction (xy), z derived

vec3 starColor(float t) {
  if (t < 0.12) return vec3(1.0, 0.72, 0.52);
  if (t < 0.32) return vec3(1.0, 0.90, 0.80);
  if (t < 0.78) return vec3(0.93, 0.95, 1.0);
  return vec3(0.68, 0.79, 1.0);
}

vec3 starLayer(vec2 px, float cell, float density, float size, float bright, float seed) {
  vec2 g = px / cell;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = hash12(id + seed);
  if (h > density) return vec3(0.0);
  vec2 pos = 0.3 + 0.4 * hash22(id * 1.37 + seed);
  float d = length((f - pos) * cell);
  float b = hash12(id * 3.1 + seed + 7.0);
  float r = size * (0.55 + 1.6 * pow(b, 8.0));
  // everything fades to zero well inside the cell, so no square cut-offs
  float fade = 1.0 - smoothstep(cell * 0.12, cell * 0.28, d);
  float core = exp(-d * d / (r * r));
  float halo = exp(-d * d / (r * r * 16.0)) * pow(b, 4.0) * 0.35;
  core *= fade;
  halo *= fade;
  float tw = 1.0 + 0.35 * sin(uTime * (0.6 + 2.4 * b) + h * 60.0) * step(0.55, b);
  return starColor(hash12(id * 5.7 + seed)) * (core + halo) * (0.25 + bright * pow(b, 2.5)) * tw;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 css = frag / uDpr;
  vec3 col = texture2D(uNebula, frag / uRes).rgb;

  vec2 cam = vec2(-uCam.x, uCam.y);
  float px = 1.0 / uDpr;
  col += starLayer(css + cam * 0.02, 7.0, 0.11, 0.55, 0.9, 1.0);
  col += starLayer(css + cam * 0.05, 17.0, 0.16, 0.75, 1.4, 17.0);
  col += starLayer(css + cam * 0.10, 41.0, 0.20, 1.0, 2.4, 41.0);
  col += starLayer(css + cam * 0.16, 97.0, 0.28, 1.25, 3.6, 97.0);

  if (uPlanet.w > 0.5) {
    vec2 d = (frag - uPlanet.xy) / uPlanet.z;
    float r2 = dot(d, d);
    vec3 L = normalize(vec3(uLight, 0.55));
    float edge = 1.0 - smoothstep(1.0 - 2.0 / uPlanet.z, 1.0, sqrt(r2));
    if (r2 < 1.0) {
      vec3 n = vec3(d, sqrt(1.0 - r2));
      float lon = atan(n.x, n.z) + uTime * 0.006;
      float lat = asin(clamp(n.y, -1.0, 1.0));
      vec2 tuv = vec2(lon * 1.4, lat * 3.2);
      float warp = fbm(tuv * 1.4 + vec2(3.0, 1.0));
      float bands = fbm(vec2(tuv.x * 0.35, tuv.y * 2.6 + warp * 1.6));
      float storms = smoothstep(0.62, 0.8, fbm(tuv * 3.0 + 7.0));
      vec3 surf = mix(vec3(0.05, 0.06, 0.16), vec3(0.24, 0.28, 0.58), bands);
      surf = mix(surf, vec3(0.62, 0.52, 0.86), smoothstep(0.55, 0.78, bands) * 0.55);
      surf = mix(surf, vec3(0.80, 0.86, 1.0), storms * 0.25);
      float ndl = dot(n, L);
      float diff = smoothstep(-0.12, 1.0, ndl);
      vec3 lit = surf * (0.015 + 1.35 * diff * diff);
      float fres = pow(1.0 - n.z, 2.6);
      lit += vec3(0.30, 0.52, 1.0) * fres * smoothstep(-0.25, 0.5, ndl) * 1.1;
      // specular-ish sheen
      vec3 hv = normalize(L + vec3(0.0, 0.0, 1.0));
      lit += vec3(0.6, 0.7, 1.0) * pow(max(dot(n, hv), 0.0), 40.0) * 0.12;
      col = mix(col, lit, edge);
    }
    // atmospheric halo outside the limb, brighter on the lit side
    float dist = sqrt(r2) - 1.0;
    if (dist > -0.02) {
      vec2 dir = normalize(d);
      float side = smoothstep(-0.6, 0.9, dot(dir, normalize(uLight)));
      float halo = exp(-max(dist, 0.0) * 22.0) * 0.85 + exp(-max(dist, 0.0) * 5.0) * 0.18;
      col += vec3(0.32, 0.55, 1.0) * halo * (0.12 + side);
    }
  }

  // tone mapping, vignette, grain
  col = 1.0 - exp(-col * 1.35);
  vec2 uv = frag / uRes;
  float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(1.15, 1.0)));
  col *= 0.72 + 0.28 * vig;
  col += (hash12(frag + fract(uTime) * 91.0) - 0.5) / 255.0 * 2.0;
  gl_FragColor = vec4(pow(col, vec3(0.92)), 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
  return s;
}

function program(gl: WebGLRenderingContext, frag: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link error");
  return p;
}

const NEBULA_SCALE = 0.4; // fraction of css resolution for the nebula pass

export default function SpaceBackdrop({ planet = null, planetMobile = null, pointerParallax = false, animate = true, className, apiRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef({ x: 0, y: 0 });
  const kickRef = useRef<() => void>(() => {});
  const cfgRef = useRef({ planet, planetMobile, animate });

  useEffect(() => {
    cfgRef.current = { planet, planetMobile, animate };
    kickRef.current();
  }, [planet, planetMobile, animate]);

  useImperativeHandle(apiRef, () => ({
    setCamera(x, y) {
      camRef.current = { x, y };
      kickRef.current();
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!gl) return;
    let nebulaProg: WebGLProgram;
    let mainProg: WebGLProgram;
    try {
      nebulaProg = program(gl, NEBULA_FRAG);
      mainProg = program(gl, MAIN_FRAG);
    } catch (err) {
      console.warn("[backdrop] WebGL shader failed, using CSS fallback", err);
      return;
    }
    canvas.dataset.ready = "1";

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    let nebW = 0;
    let nebH = 0;
    let nebCam = { x: NaN, y: NaN };

    const u = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
    const U = {
      nRes: u(nebulaProg, "uRes"),
      nCam: u(nebulaProg, "uCam"),
      nCss: u(nebulaProg, "uCss"),
      res: u(mainProg, "uRes"),
      dpr: u(mainProg, "uDpr"),
      cam: u(mainProg, "uCam"),
      time: u(mainProg, "uTime"),
      neb: u(mainProg, "uNebula"),
      planet: u(mainProg, "uPlanet"),
      light: u(mainProg, "uLight"),
    };

    let w = 0;
    let h = 0;
    let dpr = 1;
    let dirty = true;
    let visible = true;
    let raf = 0;
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      w = Math.max(1, Math.round(rect.width * dpr));
      h = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = w;
      canvas.height = h;
      const nw = Math.max(2, Math.round(rect.width * NEBULA_SCALE));
      const nh = Math.max(2, Math.round(rect.height * NEBULA_SCALE));
      if (nw !== nebW || nh !== nebH) {
        nebW = nw;
        nebH = nh;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nebW, nebH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        nebCam = { x: NaN, y: NaN };
      }
      dirty = true;
    };

    const render = (time: number) => {
      const cam = {
        x: camRef.current.x + pointer.x * 28,
        y: camRef.current.y + pointer.y * 18,
      };
      const cssW = w / dpr;

      // pass 1 – only when the camera moved noticeably
      if (Math.abs(cam.x - nebCam.x) > 0.5 || Math.abs(cam.y - nebCam.y) > 0.5 || Number.isNaN(nebCam.x)) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, nebW, nebH);
        gl.useProgram(nebulaProg);
        gl.uniform2f(U.nRes, nebW, nebH);
        gl.uniform2f(U.nCam, cam.x, cam.y);
        gl.uniform1f(U.nCss, cssW / nebW);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        nebCam = cam;
      }

      // pass 2
      gl.viewport(0, 0, w, h);
      gl.useProgram(mainProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(U.neb, 0);
      gl.uniform2f(U.res, w, h);
      gl.uniform1f(U.dpr, dpr);
      gl.uniform2f(U.cam, cam.x, cam.y);
      gl.uniform1f(U.time, time / 1000);
      const { planet, planetMobile } = cfgRef.current;
      const spec = cssW < 700 && planetMobile ? planetMobile : planet;
      if (spec) {
        const m = Math.min(w, h);
        gl.uniform4f(U.planet, spec.x * w + pointer.x * 10 * dpr, (1 - spec.y) * h - pointer.y * 6 * dpr, spec.r * m, 1);
      } else {
        gl.uniform4f(U.planet, 0, 0, 1, 0);
      }
      gl.uniform2f(U.light, -0.62, 0.5);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      dirty = false;
    };

    const loop = (time: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      if (pointerParallax) {
        pointer.x += (pointer.tx - pointer.x) * 0.05;
        pointer.y += (pointer.ty - pointer.y) * 0.05;
        if (Math.abs(pointer.tx - pointer.x) > 0.001 || Math.abs(pointer.ty - pointer.y) > 0.001) dirty = true;
      }
      if (cfgRef.current.animate || dirty) render(time);
    };

    kickRef.current = () => {
      dirty = true;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(canvas);
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      pointer.tx = e.clientX / window.innerWidth - 0.5;
      pointer.ty = e.clientY / window.innerHeight - 0.5;
    };
    if (pointerParallax) window.addEventListener("pointermove", onPointer, { passive: true });
    const onLost = (e: Event) => e.preventDefault();
    canvas.addEventListener("webglcontextlost", onLost);
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("webglcontextlost", onLost);
      kickRef.current = () => {};
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [pointerParallax]);

  return <canvas ref={canvasRef} className={`backdrop${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}
