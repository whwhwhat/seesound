import {
  BASE_BG_COLOR,
  atmosphereEnabledInput,
  audio,
  canvas,
  contourPathCache,
  ctx,
  directGpuUnderlayCanvas,
  fieldCanvas,
  fieldCtx,
  fieldGeometry,
  fieldImage,
  fieldSize,
  fieldStride,
  glowCanvas,
  glowCtx,
  gpuFieldValidation,
  numericControls,
  renderBuffers,
  rendererFlags,
  state,
} from "../state/context.js";
import {
  beginFrameProfile,
  buildModeRenderState,
  finishFrameProfile,
  getThemeGlowPalette,
  getThemeLineColor,
  profileSectionEnd,
  profileSectionStart,
  updateModeState,
} from "../core/runtime.js";
import {
  ensureSpatialAtlas,
  getSpatialMode,
  percentileOfField,
  removeRadialAverage,
  resetRenderBuffers,
  updateDirectGpuUnderlay,
} from "../core/geometry.js";
import {
  clearGpuPresentation,
  readGpuFieldIntoCpuBuffer,
  readGpuGlowAccumulation,
  runGpuFieldAccumulation,
  setGpuCanvasFrame,
  setGpuCanvasPresentation,
  setGpuCanvasVisible,
  shadeFieldOnGpu,
  shouldValidateGpuField,
  validateGpuFieldAgainstCpu,
} from "./gpu.js";
import {
  clamp,
  lerp,
  lerpColor,
  toRgba,
} from "../core/utils.js";

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
  glowCtx.strokeStyle = toRgba(outerGlowColor, (0.08 + alpha * 0.09) * glowAlphaScale);
  glowCtx.lineWidth = (10 + alpha * 8) * (0.9 + thickness * 0.42);
  glowCtx.filter = `blur(${((12 + alpha * 12) * glowSpread).toFixed(2)}px)`;
  strokePath(glowCtx, path);
  glowCtx.restore();

  glowCtx.save();
  glowCtx.strokeStyle = toRgba(innerGlowColor, (0.1 + alpha * 0.11) * glowAlphaScale);
  glowCtx.lineWidth = (4.4 + alpha * 2.4) * (0.92 + thickness * 0.32);
  glowCtx.filter = `blur(${((3.5 + alpha * 3.2) * glowSpread).toFixed(2)}px)`;
  strokePath(glowCtx, path);
  glowCtx.restore();

  ctx.save();
  ctx.globalAlpha = 0.95;
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

function renderField() {
  const frameProfile = beginFrameProfile();
  gpuFieldValidation.frame += 1;
  const coupling = numericControls.coupling;
  const persistence = numericControls.persistence;
  const nodalFocus = numericControls.nodalFocus;
  const contrast = numericControls.contrast;
  const motion = numericControls.motion;

  let profileStart = profileSectionStart(frameProfile);
  const { bands, rms, centroid, isPlaying } = updateModeState();
  profileSectionEnd(frameProfile, "updateModeState", profileStart);

  const sampleRate = state.audioContext?.sampleRate ?? 48000;
  const data = fieldImage.data;
  const field = renderBuffers.field;
  const colorWeight = renderBuffers.colorWeight;
  const colorAccum = renderBuffers.colorAccum;
  resetRenderBuffers();
  contourPathCache.key = "";
  contourPathCache.path = null;

  const singleModeIndex = Math.max(0, Math.min(state.modeState.length - 1, Math.round(numericControls.singleModeIndex) - 1));
  const isSingleMode = state.displayMode === "single";
  const isSignedMode = isSingleMode || state.combineMode === "signed";
  const useGlowColor = state.renderStyle === "glow";
  const themePalette = getThemeGlowPalette();
  const shouldAttemptGpuField = state.renderStyle === "isoline" || state.renderStyle === "glow";
  const wantsDirectGpuPresentation = rendererFlags.directGpuPresentation && state.renderStyle === "glow" && isSignedMode;
  const renderAsDormantScene = !isPlaying && audio.currentTime <= 0.001;
  let activeSingleAmp = 0;
  let sceneColorWeight = 0;
  const sceneColorAccum = [0, 0, 0];

  if (isPlaying) {
    state.phase += 0.01 + centroid * 0.08 + rms * motion * 0.03;
  }

  for (let index = 0; index < state.modeState.length; index += 1) {
    const mode = state.modeState[index];
    if (!isPlaying) {
      continue;
    }
    const bandValue = bands[index] || 0;
    const excitation = Math.pow(Math.max(0, bandValue), 1.35) * (0.4 + coupling * 1.3);
    const detune = Math.sin(state.phase * (0.6 + mode.bandBias * 1.8) + mode.phase) * motion * 0.06;
    mode.velocity = mode.velocity * persistence + (excitation - mode.amp) * (0.18 + coupling * 0.1);
    mode.amp = Math.max(0, mode.amp + mode.velocity + detune);
    mode.amp *= 0.985;
  }

  const spatialAtlas = ensureSpatialAtlas();
  const modeRenderState = buildModeRenderState(sampleRate, themePalette, singleModeIndex, isSingleMode);
  profileStart = profileSectionStart(frameProfile);
  const didAccumulateOnGpu = shouldAttemptGpuField
    ? runGpuFieldAccumulation(spatialAtlas, modeRenderState, isSingleMode, useGlowColor)
    : false;
  profileSectionEnd(frameProfile, "gpuAccumulate", profileStart);

  for (let index = 0; index < state.modeState.length; index += 1) {
    if (modeRenderState.enabled[index] === 0) {
      continue;
    }
    const modeContribution = modeRenderState.contribution[index];
    const modeMagnitude = Math.abs(modeContribution);
    activeSingleAmp = Math.max(activeSingleAmp, modeMagnitude);
    if (useGlowColor) {
      const sceneWeight = modeMagnitude;
      sceneColorWeight += sceneWeight;
      sceneColorAccum[0] += modeRenderState.color[index * 3] * sceneWeight;
      sceneColorAccum[1] += modeRenderState.color[index * 3 + 1] * sceneWeight;
      sceneColorAccum[2] += modeRenderState.color[index * 3 + 2] * sceneWeight;
    }
  }

  let hasCpuFieldData = false;
  let hasCpuGlowAccumulation = false;
  if (didAccumulateOnGpu && !wantsDirectGpuPresentation) {
    profileStart = profileSectionStart(frameProfile);
    if (useGlowColor) {
      readGpuGlowAccumulation(field, colorWeight, colorAccum);
      hasCpuGlowAccumulation = true;
    } else {
      readGpuFieldIntoCpuBuffer(field);
    }
    profileSectionEnd(frameProfile, "gpuReadback", profileStart);
    hasCpuFieldData = true;
  } else if (!didAccumulateOnGpu) {
    profileStart = profileSectionStart(frameProfile);
    for (let index = 0; index < state.modeState.length; index += 1) {
      const mode = state.modeState[index];
      const spatial = getSpatialMode(mode.m, mode.n);
      if (modeRenderState.enabled[index] === 0) {
        continue;
      }
      const modeContribution = modeRenderState.contribution[index];
      const sharpMix = modeRenderState.sharpMix[index];
      const blurredMix = modeRenderState.blurMix[index];
      const modeColor = useGlowColor
        ? [
          modeRenderState.color[index * 3],
          modeRenderState.color[index * 3 + 1],
          modeRenderState.color[index * 3 + 2],
        ]
        : null;
      for (let ptr = 0; ptr < field.length; ptr += 1) {
        const spatialValue = spatial.sharp[ptr] * sharpMix + spatial.blurred[ptr] * blurredMix;
        const signedContribution = spatialValue * modeContribution;
        const contribution =
          state.displayMode === "single" || state.combineMode === "signed"
            ? signedContribution
            : Math.abs(signedContribution);
        field[ptr] += contribution;
        if (modeColor) {
          const weight = Math.abs(contribution);
          colorWeight[ptr] += weight;
          colorAccum[ptr * 3] += modeColor[0] * weight;
          colorAccum[ptr * 3 + 1] += modeColor[1] * weight;
          colorAccum[ptr * 3 + 2] += modeColor[2] * weight;
        }
      }
    }
    profileSectionEnd(frameProfile, "cpuAccumulate", profileStart);
    hasCpuFieldData = true;
    hasCpuGlowAccumulation = useGlowColor;
  }

  if (!didAccumulateOnGpu && shouldValidateGpuField()) {
    validateGpuFieldAgainstCpu(field);
  }

  if (hasCpuFieldData) {
    profileStart = profileSectionStart(frameProfile);
  }
  if (hasCpuFieldData && state.displayMode !== "single" && state.combineMode !== "signed") {
    if (state.combineMode === "residual") {
      if (state.plateShape === "circle") {
        removeRadialAverage(field);
      } else {
        let meanField = 0;
        for (let ptr = 0; ptr < field.length; ptr += 1) {
          meanField += field[ptr];
        }
        meanField /= Math.max(1, field.length);
        for (let ptr = 0; ptr < field.length; ptr += 1) {
          field[ptr] -= meanField;
        }
      }
    } else if (state.combineMode === "percentile") {
      const threshold = percentileOfField(
        field,
        state.plateShape === "circle" ? 0.74 : 0.7,
        state.plateShape === "circle",
      );
      for (let ptr = 0; ptr < field.length; ptr += 1) {
        field[ptr] -= threshold;
      }
    }
  }
  if (hasCpuFieldData) {
    profileSectionEnd(frameProfile, "fieldPost", profileStart);
  }

  const singleAmpGate = isSingleMode ? Math.min(1, activeSingleAmp * 1.6) : 1;
  const singleAmpFloor = isSingleMode ? 0.0015 : 0;
  const renderAsDormantSingle = isSingleMode && activeSingleAmp < singleAmpFloor;
  const renderAsDormantField = renderAsDormantScene || renderAsDormantSingle;
  const singleFocus = isSingleMode ? Math.max(0, Math.min(1, singleAmpGate)) : 1;
  const coreSharpness = isSingleMode
    ? (3 + singleFocus * 27) * nodalFocus
    : 26 * nodalFocus;
  const haloSharpness = isSingleMode
    ? (0.8 + singleFocus * 7.2) * nodalFocus
    : 8 * nodalFocus;
  const lineWeight = isSingleMode
    ? 0.04 + singleFocus * 1.78
    : 0.55;
  const haloWeight = isSingleMode
    ? 0.62 - singleFocus * 0.34
    : 0.18;
  const backgroundWeight = isSingleMode
    ? 0.03 + (1 - singleFocus) * 0.18
    : 0.12;
  const singleModeBlur = isSingleMode ? (1 - singleFocus) * 12 : 0;
  const averageGlowColor =
    sceneColorWeight > 1e-6
      ? [
        sceneColorAccum[0] / sceneColorWeight,
        sceneColorAccum[1] / sceneColorWeight,
        sceneColorAccum[2] / sceneColorWeight,
      ]
      : themePalette.baseColor;
  const separation = numericControls.colorSeparation;
  const glowColor = lerpColor(themePalette.baseColor, averageGlowColor, clamp(0.78 + separation * 0.14, 0, 1));
  let useDirectGpuPresentation = false;
  let displayScale = 1;

  if (wantsDirectGpuPresentation && didAccumulateOnGpu) {
    profileStart = profileSectionStart(frameProfile);
    const readFieldOk = readGpuFieldIntoCpuBuffer(field);
    profileSectionEnd(frameProfile, "gpuReadback", profileStart);
    if (readFieldOk) {
      hasCpuFieldData = true;
      let maxAbs = 1e-6;
      for (let ptr = 0; ptr < field.length; ptr += 1) {
        maxAbs = Math.max(maxAbs, Math.abs(field[ptr]));
      }
      const gpuDisplayScale = isSingleMode ? 1 : maxAbs;
      displayScale = gpuDisplayScale;
      updateDirectGpuUnderlay(field, gpuDisplayScale, {
        plateShape: state.plateShape,
        glowSpread: numericControls.glowSpread,
        contrast,
        haloSharpness,
        backgroundWeight,
        singleAmpGate,
        renderAsDormantField,
        themePalette,
      });
      profileStart = profileSectionStart(frameProfile);
      useDirectGpuPresentation = shadeFieldOnGpu({
        rms,
        centroid,
        displayScale: Math.max(1e-6, gpuDisplayScale),
        contrast,
        coreSharpness,
        haloSharpness,
        lineWeight,
        haloWeight,
        backgroundWeight,
        singleAmpGate,
        separation,
        renderAsDormantSingle: renderAsDormantField,
        useGlowColor,
        glowThickness: numericControls.glowThickness,
        glowSpread: numericControls.glowSpread,
        glowColor,
        atmosphereEnabled: false,
        themePalette,
      });
      profileSectionEnd(frameProfile, "gpuShade", profileStart);
      if (useDirectGpuPresentation) {
        const glowBlur = 0.45 + singleModeBlur * 0.6;
        setGpuCanvasFrame(true);
        setGpuCanvasPresentation(true, {
          opacity: 0.14,
          blurPx: glowBlur,
          shadowAlpha: 0.08,
        });
        setGpuCanvasVisible(true, state.plateShape === "circle" && state.combineMode === "signed");
      }
    }
    if (!useDirectGpuPresentation) {
      profileStart = profileSectionStart(frameProfile);
      readGpuGlowAccumulation(field, colorWeight, colorAccum);
      profileSectionEnd(frameProfile, "gpuReadback", profileStart);
      hasCpuFieldData = true;
      hasCpuGlowAccumulation = true;
    }
  }

  if (!useDirectGpuPresentation) {
    clearGpuPresentation();
    let maxAbs = 1e-6;
    for (let ptr = 0; ptr < field.length; ptr += 1) {
      maxAbs = Math.max(maxAbs, Math.abs(field[ptr]));
    }
    displayScale = isSingleMode ? 1 : maxAbs;
  }

  if (!useDirectGpuPresentation) {
    profileStart = profileSectionStart(frameProfile);
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

        if (useGlowColor && hasCpuGlowAccumulation && colorWeight[ptr] > 1e-6) {
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

        data[ptr * 4] = Math.round(red);
        data[ptr * 4 + 1] = Math.round(green);
        data[ptr * 4 + 2] = Math.round(blue);
        data[ptr * 4 + 3] = Math.round(mask * 255);
        ptr += 1;
      }
    }
    fieldCtx.putImageData(fieldImage, 0, 0);
    profileSectionEnd(frameProfile, "cpuShade", profileStart);
  }

  const compositeStart = profileSectionStart(frameProfile);
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
    const gradient = ctx.createRadialGradient(
      canvas.width / 2,
      canvas.height / 2,
      canvas.width * 0.06,
      canvas.width / 2,
      canvas.height / 2,
      canvas.width * 0.48,
    );
    gradient.addColorStop(0, toRgba(themePalette.atmosphereCore, 0.22));
    gradient.addColorStop(0.45, toRgba(themePalette.atmosphereOuter, 0.11));
    gradient.addColorStop(1, toRgba(BASE_BG_COLOR, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  let smoothedIsolinePath = null;
  if (hasCpuFieldData) {
    const isolineStart = profileSectionStart(frameProfile);
    smoothedIsolinePath =
      state.renderStyle === "glow" || state.renderStyle === "isoline"
        ? getIsolinePath(field, displayScale, inset, drawSize, true)
        : null;
    profileSectionEnd(frameProfile, "isoline", isolineStart);
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
    const glowContourStart = profileSectionStart(frameProfile);
    drawGlowContours(smoothedIsolinePath, drawSize, singleAmpGate, glowColor, themePalette);
    profileSectionEnd(frameProfile, "glowContours", glowContourStart);
  } else if (useDirectGpuPresentation && state.renderStyle === "glow" && smoothedIsolinePath) {
    const glowContourStart = profileSectionStart(frameProfile);
    drawGlowContours(smoothedIsolinePath, drawSize, singleAmpGate, glowColor, themePalette);
    profileSectionEnd(frameProfile, "glowContours", glowContourStart);
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

  profileSectionEnd(frameProfile, "composite", compositeStart);
  finishFrameProfile(frameProfile);
}

function requestRender() {
  if (state.isAnimating || state.animationFrame) {
    return;
  }
  state.animationFrame = window.requestAnimationFrame(() => {
    state.animationFrame = 0;
    renderField();
  });
}

function tick() {
  if (!state.isAnimating) {
    state.animationFrame = 0;
    return;
  }
  const targetFrameMs = state.frameRateLimit === "60" ? 1000 / 60 : 0;
  const now = performance.now();
  if (targetFrameMs > 0 && state.lastAnimationTimestamp > 0 && now - state.lastAnimationTimestamp < targetFrameMs) {
    state.animationFrame = window.requestAnimationFrame(tick);
    return;
  }
  state.lastAnimationTimestamp = now;
  renderField();
  state.animationFrame = window.requestAnimationFrame(tick);
}

function startAnimationLoop() {
  if (state.isAnimating) {
    return;
  }
  state.isAnimating = true;
  if (state.animationFrame) {
    window.cancelAnimationFrame(state.animationFrame);
    state.animationFrame = 0;
  }
  state.lastAnimationTimestamp = 0;
  state.animationFrame = window.requestAnimationFrame(tick);
}

function stopAnimationLoop() {
  state.isAnimating = false;
  state.lastAnimationTimestamp = 0;
  if (state.animationFrame) {
    window.cancelAnimationFrame(state.animationFrame);
    state.animationFrame = 0;
  }
}

export {
  renderField,
  requestRender,
  startAnimationLoop,
  stopAnimationLoop,
};
