import {
  BASE_BG_COLOR,
  atmosphereEnabledInput,
  canvas,
  ctx,
  directGpuUnderlayCanvas,
  fieldCanvas,
  fieldCtx,
  fieldImage,
  fieldGeometry,
  fieldSize,
  state,
} from "../../state/context.js";
import {
  clamp,
  lerp,
  toRgba,
} from "../../core/utils.js";
import {
  clearGpuPresentation,
} from "../gpu.js";
import {
  resolveDisplayScale,
} from "../backends/legacy-backend.js";

function shadeFieldOnCpu(frameContext, renderState, frameProfileTools) {
  if (renderState.useDirectGpuPresentation) {
    return renderState.displayScale;
  }

  clearGpuPresentation();
  const {
    backgroundWeight,
    centroid,
    colorAccum,
    colorWeight,
    contrast,
    field,
    fieldImageData,
    haloSharpness,
    haloWeight,
    isSingleMode,
    lineWeight,
    renderAsDormantField,
    rms,
    separation,
    singleAmpGate,
    themePalette,
    useGlowColor,
    coreSharpness,
  } = frameContext;
  const displayScale = resolveDisplayScale(field, isSingleMode);

  const profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
  let ptr = 0;
  const shapeMask = state.plateShape === "circle" ? fieldGeometry.circleMask : fieldGeometry.squareMask;
  for (let y = 0; y < fieldSize; y += 1) {
    for (let x = 0; x < fieldSize; x += 1) {
      const mask = shapeMask[ptr];
      const value = field[ptr] / Math.max(displayScale, 1e-6);
      const edgeX = x < fieldSize - 1 ? Math.abs(field[ptr] - field[ptr + 1]) : 0;
      const edgeY = y < fieldSize - 1 ? Math.abs(field[ptr] - field[ptr + fieldSize]) : 0;
      const gradient = Math.min(1, (edgeX + edgeY) / Math.max(displayScale, 1e-6) * 2.6);
      const nodeCore = renderAsDormantField ? 0 : Math.exp(-Math.abs(value) * coreSharpness);
      const nodeHalo = renderAsDormantField ? 0 : Math.exp(-Math.abs(value) * haloSharpness);
      const lineStrength = nodeCore * (lineWeight + gradient * 1.25) * singleAmpGate;
      const haloStrength = nodeHalo * (haloWeight + gradient * 0.22) * singleAmpGate;
      const displacement = Math.pow(Math.min(1, Math.abs(value)), contrast);
      const backgroundField = displacement * backgroundWeight * singleAmpGate;
      const brightness = Math.min(1, (lineStrength + haloStrength + backgroundField) * mask);
      const warm = Math.min(1, brightness * (0.7 + centroid * 0.55));
      const cool = Math.min(1, (gradient * 0.28 + rms * 0.18 + nodeHalo * 0.12) * mask);
      const dither = fieldGeometry.dither[ptr];
      const warmD = Math.min(1, Math.max(0, warm + dither * 0.7));
      const brightD = Math.min(1, Math.max(0, brightness + dither));
      const coolD = Math.min(1, Math.max(0, cool + dither * 0.55));

      let red =
        BASE_BG_COLOR[0] +
        warmD * themePalette.backdropColor[0] * 0.82 +
        brightD * themePalette.baseColor[0] * 0.12;
      let green =
        BASE_BG_COLOR[1] +
        brightD * themePalette.backdropColor[1] * 0.84 +
        lineStrength * themePalette.lineColor[1] * 0.12;
      let blue =
        BASE_BG_COLOR[2] +
        coolD * themePalette.backdropColor[2] * 0.92 +
        lineStrength * themePalette.lineColor[2] * 0.1;

      if (useGlowColor && renderState.hasCpuGlowAccumulation && colorWeight[ptr] > 1e-6) {
        const weight = colorWeight[ptr];
        const avgColor = [
          colorAccum[ptr * 3] / weight,
          colorAccum[ptr * 3 + 1] / weight,
          colorAccum[ptr * 3 + 2] / weight,
        ];
        const monoLuma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        const avgLuma = avgColor[0] * 0.2126 + avgColor[1] * 0.7152 + avgColor[2] * 0.0722;
        const luminanceScale = monoLuma / Math.max(avgLuma, 1);
        const tinted = [
          clamp(avgColor[0] * luminanceScale, 0, 255),
          clamp(avgColor[1] * luminanceScale, 0, 255),
          clamp(avgColor[2] * luminanceScale, 0, 255),
        ];
        const boostedTint = [
          clamp(tinted[0] * (0.98 - separation * 0.06), 0, 255),
          clamp(tinted[1] * (1 + separation * 0.03), 0, 255),
          clamp(tinted[2] * (1.03 + separation * 0.16), 0, 255),
        ];
        const tintMix = clamp(
          0.18 + separation * 0.16 + lineStrength * (0.96 + separation * 0.22) + haloStrength * (0.64 + separation * 0.16) + backgroundField * (0.34 + separation * 0.08),
          0,
          0.98,
        );
        red = lerp(red, boostedTint[0], tintMix);
        green = lerp(green, boostedTint[1], tintMix);
        blue = lerp(blue, boostedTint[2], tintMix);
      }

      fieldImageData[ptr * 4] = Math.round(red);
      fieldImageData[ptr * 4 + 1] = Math.round(green);
      fieldImageData[ptr * 4 + 2] = Math.round(blue);
      fieldImageData[ptr * 4 + 3] = Math.round(mask * 255);
      ptr += 1;
    }
  }
  fieldCtx.putImageData(fieldImage, 0, 0);
  frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "cpuShade", profileStart);

  return displayScale;
}

function compositeLegacyScene(frameContext, renderState, drawHelpers, frameProfileTools) {
  const {
    drawAtmosphereOverlay,
    drawGlowContours,
    drawIsolines,
    getIsolinePath,
  } = drawHelpers;
  const {
    field,
    glowColor,
    singleAmpGate,
    singleModeBlur,
    themePalette,
  } = frameContext;
  const {
    displayScale,
    hasCpuFieldData,
    useDirectGpuPresentation,
  } = renderState;

  const compositeStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
  const inset = canvas.width * 0.09;
  const drawSize = canvas.width - inset * 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!useDirectGpuPresentation) {
    ctx.fillStyle = toRgba(BASE_BG_COLOR, 1);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (state.renderStyle === "glow") {
    ctx.save();
    ctx.fillStyle = toRgba(BASE_BG_COLOR, 0.94);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.filter = `blur(${(0.35 + singleModeBlur * 0.45).toFixed(2)}px)`;
    ctx.globalAlpha = 0.28;
    ctx.drawImage(directGpuUnderlayCanvas, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
  const rotateCircleSigned = state.plateShape === "circle" && state.combineMode === "signed";
  if (!useDirectGpuPresentation && rotateCircleSigned) {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
  }

  if (atmosphereEnabledInput.checked) {
    drawAtmosphereOverlay(themePalette);
  }

  let smoothedIsolinePath = null;
  if (hasCpuFieldData) {
    const isolineStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    smoothedIsolinePath =
      state.renderStyle === "glow" || state.renderStyle === "isoline"
        ? getIsolinePath(field, displayScale, inset, drawSize, true)
        : null;
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "isoline", isolineStart);
  }

  if (!useDirectGpuPresentation && state.renderStyle === "glow") {
    ctx.save();
    if (state.plateShape === "circle") {
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, drawSize / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.shadowColor = toRgba(themePalette.outerColor, 0.08);
    ctx.shadowBlur = 10;
    ctx.imageSmoothingEnabled = true;
    const glowBlur = 0.45 + singleModeBlur * 0.6;
    ctx.filter = `blur(${glowBlur.toFixed(2)}px)`;
    ctx.globalAlpha = 0.18;
    ctx.drawImage(fieldCanvas, inset, inset, drawSize, drawSize);
    ctx.restore();
    const glowContourStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    drawGlowContours(smoothedIsolinePath, drawSize, singleAmpGate, glowColor, themePalette);
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "glowContours", glowContourStart);
  } else if (useDirectGpuPresentation && state.renderStyle === "glow" && smoothedIsolinePath) {
    const glowContourStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    drawGlowContours(smoothedIsolinePath, drawSize, singleAmpGate, glowColor, themePalette);
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "glowContours", glowContourStart);
  } else if (!useDirectGpuPresentation) {
    ctx.save();
    ctx.shadowColor = toRgba(themePalette.outerColor, 0.12);
    ctx.shadowBlur = 14;
    ctx.imageSmoothingEnabled = true;
    ctx.filter = "none";
    ctx.globalAlpha = atmosphereEnabledInput.checked ? 0.14 : 0.07;
    ctx.drawImage(fieldCanvas, inset, inset, drawSize, drawSize);
    ctx.restore();
  }

  if (state.renderStyle === "isoline" && smoothedIsolinePath) {
    drawIsolines(smoothedIsolinePath, singleAmpGate, drawSize);
  }

  if (state.plateShape === "circle") {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const outerRadius = drawSize / 2;
    const ringWidth = Math.max(10, canvas.width * 0.01);
    const innerRadius = outerRadius - ringWidth;
    const ringGradient = ctx.createRadialGradient(centerX, centerY, innerRadius, centerX, centerY, outerRadius);
    ringGradient.addColorStop(0, toRgba(BASE_BG_COLOR, 0));
    ringGradient.addColorStop(0.35, toRgba(BASE_BG_COLOR, 0.12));
    ringGradient.addColorStop(0.75, toRgba(BASE_BG_COLOR, 0.56));
    ringGradient.addColorStop(1, toRgba(BASE_BG_COLOR, 0.98));

    ctx.save();
    ctx.fillStyle = ringGradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
    ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.restore();
  }

  ctx.strokeStyle = toRgba(themePalette.outerColor, 0.18);
  ctx.lineWidth = 2;
  if (state.plateShape !== "circle") {
    ctx.strokeRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2);
  }
  if (!useDirectGpuPresentation && rotateCircleSigned) {
    ctx.restore();
  }

  frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "composite", compositeStart);
}

export {
  compositeLegacyScene,
  shadeFieldOnCpu,
};
