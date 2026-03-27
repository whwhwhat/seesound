import {
  BASE_BG_COLOR,
  fieldSize,
} from "../state/constants.js";
import {
  canvas,
  ctx,
  numericControls,
} from "../state/dom.js";
import {
  contourPathCache,
  fieldGeometry,
  fieldStride,
  glowCanvas,
  glowCtx,
} from "../state/render-resources.js";
import {
  state,
} from "../state/runtime-state.js";
import {
  getThemeLineColor,
} from "../core/runtime.js";
import {
  clamp,
  lerp,
  lerpColor,
  toRgba,
} from "../core/utils.js";

const atmosphereNoiseCanvas = document.createElement("canvas");
atmosphereNoiseCanvas.width = fieldSize;
atmosphereNoiseCanvas.height = fieldSize;
const atmosphereNoiseCtx = atmosphereNoiseCanvas.getContext("2d");
const atmosphereNoiseImage = atmosphereNoiseCtx.createImageData(fieldSize, fieldSize);
let atmosphereNoiseReady = false;

function ensureAtmosphereNoiseTexture() {
  if (atmosphereNoiseReady) {
    return;
  }
  const pixels = atmosphereNoiseImage.data;
  for (let ptr = 0; ptr < fieldGeometry.dither.length; ptr += 1) {
    const normalized = clamp(fieldGeometry.dither[ptr] / 0.018, -0.5, 0.5);
    const value = Math.round(128 + normalized * 44);
    pixels[ptr * 4] = value;
    pixels[ptr * 4 + 1] = value;
    pixels[ptr * 4 + 2] = value;
    pixels[ptr * 4 + 3] = 255;
  }
  atmosphereNoiseCtx.putImageData(atmosphereNoiseImage, 0, 0);
  atmosphereNoiseReady = true;
}

function drawAtmosphereOverlay(themePalette) {
  const gradient = ctx.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    canvas.width * 0.05,
    canvas.width / 2,
    canvas.height / 2,
    canvas.width * 0.5,
  );
  gradient.addColorStop(0, toRgba(themePalette.atmosphereCore, 0.18));
  gradient.addColorStop(0.3, toRgba(themePalette.atmosphereOuter, 0.12));
  gradient.addColorStop(0.68, toRgba(themePalette.atmosphereOuter, 0.04));
  gradient.addColorStop(1, toRgba(BASE_BG_COLOR, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ensureAtmosphereNoiseTexture();
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.24;
  ctx.drawImage(atmosphereNoiseCanvas, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function interpolatePoint(ax, ay, av, bx, by, bv) {
  const denom = bv - av;
  const t = Math.abs(denom) < 1e-6 ? 0.5 : (0 - av) / denom;
  return [lerp(ax, bx, t), lerp(ay, by, t)];
}

function appendIsolineSegment(path, p0, p1, scale, inset, drawSize, smoothed) {
  const x0 = inset + (p0[0] / scale) * drawSize;
  const y0 = inset + (p0[1] / scale) * drawSize;
  const x1 = inset + (p1[0] / scale) * drawSize;
  const y1 = inset + (p1[1] / scale) * drawSize;
  if (!smoothed) {
    path.moveTo(x0, y0);
    path.lineTo(x1, y1);
    return;
  }
  const mx = (x0 + x1) * 0.5;
  const my = (y0 + y1) * 0.5;
  path.moveTo(x0, y0);
  path.quadraticCurveTo(mx, my, x1, y1);
}

function buildIsolinePath(field, displayScale, inset, drawSize, smoothed = false) {
  const normalizedScale = Math.max(displayScale, 1e-6);
  const path = new Path2D();
  const rimCutoff = state.plateShape === "circle" ? fieldSize * 0.015 : -1;
  for (let y = 0; y < fieldSize - 1; y += 1) {
    for (let x = 0; x < fieldSize - 1; x += 1) {
      if (rimCutoff > 0) {
        const cx = x + 0.5;
        const cy = y + 0.5;
        const nx = (cx / (fieldSize - 1)) * 2 - 1;
        const ny = (cy / (fieldSize - 1)) * 2 - 1;
        const distanceToRim = 1 - Math.sqrt(nx * nx + ny * ny);
        if (distanceToRim < rimCutoff / fieldSize) {
          continue;
        }
      }
      const tl = field[y * fieldSize + x] / normalizedScale;
      const tr = field[y * fieldSize + x + 1] / normalizedScale;
      const br = field[(y + 1) * fieldSize + x + 1] / normalizedScale;
      const bl = field[(y + 1) * fieldSize + x] / normalizedScale;

      const points = [];
      if ((tl <= 0 && tr > 0) || (tl > 0 && tr <= 0)) {
        points.push(interpolatePoint(x, y, tl, x + 1, y, tr));
      }
      if ((tr <= 0 && br > 0) || (tr > 0 && br <= 0)) {
        points.push(interpolatePoint(x + 1, y, tr, x + 1, y + 1, br));
      }
      if ((br <= 0 && bl > 0) || (br > 0 && bl <= 0)) {
        points.push(interpolatePoint(x + 1, y + 1, br, x, y + 1, bl));
      }
      if ((bl <= 0 && tl > 0) || (bl > 0 && tl <= 0)) {
        points.push(interpolatePoint(x, y + 1, bl, x, y, tl));
      }

      if (points.length === 2) {
        const [p0, p1] = points;
        appendIsolineSegment(path, p0, p1, fieldStride, inset, drawSize, smoothed);
      } else if (points.length === 4) {
        const [p0, p1, p2, p3] = points;
        appendIsolineSegment(path, p0, p1, fieldStride, inset, drawSize, smoothed);
        appendIsolineSegment(path, p2, p3, fieldStride, inset, drawSize, smoothed);
      }
    }
  }
  return path;
}

function getIsolinePath(field, displayScale, inset, drawSize, smoothed = false) {
  const key = `${displayScale.toFixed(6)}:${inset.toFixed(3)}:${drawSize.toFixed(3)}:${smoothed ? 1 : 0}`;
  if (contourPathCache.key !== key) {
    contourPathCache.key = key;
    contourPathCache.path = buildIsolinePath(field, displayScale, inset, drawSize, smoothed);
  }
  return contourPathCache.path;
}

function strokePath(ctxTarget, path) {
  ctxTarget.beginPath();
  ctxTarget.stroke(path);
}

function drawIsolines(path, ampGate, drawSize) {
  const thresholdAlpha = Math.max(0.12, ampGate);
  const lineColor = getThemeLineColor();
  const shadowColor = lerpColor(lineColor, state.highBandColor, 0.45);
  ctx.save();
  if (state.plateShape === "circle") {
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, drawSize / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.strokeStyle = toRgba(lineColor, 0.38 + thresholdAlpha * 0.52);
  ctx.lineWidth = 1.35 + thresholdAlpha * 1.15;
  ctx.shadowColor = toRgba(shadowColor, 0.22);
  ctx.shadowBlur = 8 + thresholdAlpha * 8;
  strokePath(ctx, path);
  ctx.restore();
}

function drawGlowContours(path, drawSize, ampGate, glowColor, themePalette) {
  const alpha = Math.max(0.1, ampGate);
  const thickness = numericControls.glowThickness;
  const spread = numericControls.glowSpread;
  const intensity = numericControls.glowIntensity * 1.2;
  const separation = numericControls.colorSeparation;
  const glowSpread = Math.pow(spread, 0.7);
  const glowAlphaScale = 1 / Math.pow(thickness, 0.18);
  const outerGlowColor = lerpColor(themePalette.outerColor, glowColor, clamp(0.72 + separation * 0.12, 0, 1));
  const innerGlowColor = lerpColor(themePalette.baseColor, glowColor, clamp(0.9 + separation * 0.08, 0, 1));
  const lineColor = lerpColor(themePalette.baseColor, glowColor, 1);
  glowCtx.setTransform(1, 0, 0, 1, 0, 0);
  glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
  glowCtx.save();
  const scale = glowCanvas.width / canvas.width;
  glowCtx.scale(scale, scale);
  glowCtx.lineCap = "round";
  glowCtx.lineJoin = "round";
  if (state.plateShape === "circle") {
    glowCtx.beginPath();
    glowCtx.arc(canvas.width / 2, canvas.height / 2, drawSize / 2, 0, Math.PI * 2);
    glowCtx.clip();
  }

  glowCtx.save();
  glowCtx.strokeStyle = toRgba(outerGlowColor, (0.08 + alpha * 0.09) * glowAlphaScale * intensity);
  glowCtx.lineWidth = (10 + alpha * 8) * (0.9 + thickness * 0.42);
  glowCtx.filter = `blur(${((12 + alpha * 12) * glowSpread).toFixed(2)}px)`;
  strokePath(glowCtx, path);
  glowCtx.restore();

  glowCtx.save();
  glowCtx.strokeStyle = toRgba(innerGlowColor, (0.1 + alpha * 0.11) * glowAlphaScale * intensity);
  glowCtx.lineWidth = (4.4 + alpha * 2.4) * (0.92 + thickness * 0.32);
  glowCtx.filter = `blur(${((3.5 + alpha * 3.2) * glowSpread).toFixed(2)}px)`;
  strokePath(glowCtx, path);
  glowCtx.restore();

  ctx.save();
  ctx.globalAlpha = 0.95 * intensity;
  ctx.drawImage(glowCanvas, 0, 0, glowCanvas.width, glowCanvas.height, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  glowCtx.restore();

  ctx.save();
  if (state.plateShape === "circle") {
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, drawSize / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.strokeStyle = toRgba(lineColor, 0.32 + alpha * 0.34);
  ctx.lineWidth = (2.4 + alpha * 1.6) * (0.8 + thickness * 0.34);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokePath(ctx, path);
  ctx.restore();
}

export {
  drawAtmosphereOverlay,
  drawGlowContours,
  drawIsolines,
  getIsolinePath,
};
