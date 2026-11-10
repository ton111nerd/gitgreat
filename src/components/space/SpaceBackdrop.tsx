"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

/**
 * Deep-space backdrop rendered with WebGL:
 * - pass 1 (low resolution, only when the camera moves): domain-warped fbm nebula + Milky Way band with dust lanes
 * - pass 2 (full resolution): composite + four star layers with temperature colours and twinkle.
 * The star layers react to pan (parallax) and zoom (depth), so flying through the
 * universe makes the stars stream past. Falls back to the CSS background without WebGL.
 */

export interface BackdropApi {
  /** Camera pan in CSS pixels and zoom as ln(scale / overview scale). */
  setCamera(x: number, y: number, zoom: number): void;
}

interface Props {
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

const NEBULA_FRAG = `${COMMON}
uniform vec2 uRes;      // target size in px
uniform vec2 uCam;      // camera offset (css px)
uniform float uCss;     // css px per target px
uniform float uZoom;
void main() {
  vec2 ctr = uRes * uCss * 0.5;
  vec2 px = ctr + (gl_FragCoord.xy * uCss - ctr) * exp(-uZoom * 0.05);   // css px, y up
  vec2 uv = (px + vec2(-uCam.x, uCam.y) * 0.03) / 560.0;

  vec2 q = vec2(fbm(uv + vec2(0.0, 0.0)), fbm(uv + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(uv + 3.0 * q + vec2(1.7, 9.2)), fbm(uv + 3.0 * q + vec2(8.3, 2.8)));
  float n = fbm(uv + 2.6 * r);

  vec3 deep = vec3(0.010, 0.013, 0.036);
  vec3 col = deep;
  col = mix(col, vec3(0.06, 0.055, 0.18), clamp(n * n * 1.8, 0.0, 1.0));
  col = mix(col, vec3(0.26, 0.09, 0.32), clamp(length(q) * n - 0.62, 0.0, 1.0) * 0.9);
  col = mix(col, vec3(0.04, 0.20, 0.32), clamp(r.x * r.x * n * 1.4 - 0.32, 0.0, 1.0) * 0.8);
  col = mix(col, vec3(0.50, 0.30, 0.28), clamp(r.y * n * n * 2.2 - 0.62, 0.0, 1.0) * 0.3);

  float mask = smoothstep(0.38, 0.86, fbm(uv * 0.55 + vec2(11.0, 3.0)));
  col = deep + (col - deep) * (0.14 + 1.05 * mask);

  // Milky Way: diagonal band of diffuse light with dark dust lanes
  vec2 bandDir = normalize(vec2(1.0, 0.38));
  vec2 bp = (px + vec2(-uCam.x, uCam.y) * 0.02) / 900.0;
  float d = dot(bp, vec2(-bandDir.y, bandDir.x)) - 0.4 + 0.12 * sin(bp.x * 1.3);
  float band = exp(-d * d * 9.0);
  float dust = smoothstep(0.42, 0.75, fbm(bp * 7.0 + vec2(3.0, 7.0)));
  float glow = band * (0.55 + 0.45 * fbm(bp * 3.5));
  col += vec3(0.18, 0.17, 0.23) * glow * (1.0 - 0.85 * dust) * 0.5;

  gl_FragColor = vec4(col, 1.0);
}
`;

const MAIN_FRAG = `${COMMON}
uniform vec2 uRes;      // drawing buffer px
uniform float uDpr;
uniform vec2 uCam;      // css px
uniform float uZoom;
uniform float uTime;
uniform sampler2D uNebula;

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
  float fade = 1.0 - smoothstep(cell * 0.12, cell * 0.28, d);
  float core = exp(-d * d / (r * r)) * fade;
  float halo = exp(-d * d / (r * r * 16.0)) * pow(b, 4.0) * 0.35 * fade;
  float tw = 1.0 + 0.35 * sin(uTime * (0.6 + 2.4 * b) + h * 60.0) * step(0.55, b);
  return starColor(hash12(id * 5.7 + seed)) * (core + halo) * (0.25 + bright * pow(b, 2.5)) * tw;
}

// layer coordinates: zooming in spreads the stars outwards, nearer layers faster
vec2 layer(vec2 css, vec2 ctr, vec2 cam, float depth) {
  return ctr + (css - ctr) * exp(-uZoom * depth) + cam * depth * 0.6;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 css = frag / uDpr;
  vec2 ctr = uRes / uDpr * 0.5;
  vec3 col = texture2D(uNebula, frag / uRes).rgb;

  vec2 cam = vec2(-uCam.x, uCam.y);
  col += starLayer(layer(css, ctr, cam, 0.03), 7.0, 0.11, 0.55, 0.9, 1.0);
  col += starLayer(layer(css, ctr, cam, 0.07), 17.0, 0.16, 0.75, 1.4, 17.0);
  col += starLayer(layer(css, ctr, cam, 0.13), 41.0, 0.20, 1.0, 2.4, 41.0);
  col += starLayer(layer(css, ctr, cam, 0.22), 97.0, 0.28, 1.25, 3.6, 97.0);

  col = 1.0 - exp(-col * 1.35);
  vec2 uv = frag / uRes;
  float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(1.15, 1.0)));
  col *= 0.68 + 0.32 * vig;
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

export default function SpaceBackdrop({ animate = true, className, apiRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef({ x: 0, y: 0, zoom: 0 });
  const kickRef = useRef<() => void>(() => {});
  const animateRef = useRef(animate);

  useEffect(() => {
    animateRef.current = animate;
    kickRef.current();
  }, [animate]);

  useImperativeHandle(apiRef, () => ({
    setCamera(x, y, zoom) {
      camRef.current = { x, y, zoom: Math.max(-4.5, Math.min(4.5, zoom)) };
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
    let nebCam = { x: NaN, y: NaN, zoom: NaN };

    const u = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
    const U = {
      nRes: u(nebulaProg, "uRes"),
      nCam: u(nebulaProg, "uCam"),
      nCss: u(nebulaProg, "uCss"),
      nZoom: u(nebulaProg, "uZoom"),
      res: u(mainProg, "uRes"),
      dpr: u(mainProg, "uDpr"),
      cam: u(mainProg, "uCam"),
      zoom: u(mainProg, "uZoom"),
      time: u(mainProg, "uTime"),
      neb: u(mainProg, "uNebula"),
    };

    let w = 0;
    let h = 0;
    let dpr = 1;
    let dirty = true;
    let raf = 0;

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
        nebCam = { x: NaN, y: NaN, zoom: NaN };
      }
      dirty = true;
    };

    const render = (time: number) => {
      const cam = camRef.current;
      const cssW = w / dpr;

      // pass 1 – only when the camera moved noticeably
      if (Number.isNaN(nebCam.x) || Math.abs(cam.x - nebCam.x) > 4 || Math.abs(cam.y - nebCam.y) > 4 || Math.abs(cam.zoom - nebCam.zoom) > 0.01) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, nebW, nebH);
        gl.useProgram(nebulaProg);
        gl.uniform2f(U.nRes, nebW, nebH);
        gl.uniform2f(U.nCam, cam.x, cam.y);
        gl.uniform1f(U.nCss, cssW / nebW);
        gl.uniform1f(U.nZoom, cam.zoom);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        nebCam = { ...cam };
      }

      gl.viewport(0, 0, w, h);
      gl.useProgram(mainProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(U.neb, 0);
      gl.uniform2f(U.res, w, h);
      gl.uniform1f(U.dpr, dpr);
      gl.uniform2f(U.cam, cam.x, cam.y);
      gl.uniform1f(U.zoom, cam.zoom);
      gl.uniform1f(U.time, time / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      dirty = false;
    };

    const loop = (time: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (animateRef.current || dirty) render(time);
    };

    kickRef.current = () => {
      dirty = true;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const onLost = (e: Event) => e.preventDefault();
    canvas.addEventListener("webglcontextlost", onLost);
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      kickRef.current = () => {};
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <canvas ref={canvasRef} className={`backdrop${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}
