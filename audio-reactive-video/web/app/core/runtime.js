import {
  BASE_BG_COLOR,
  BESSEL_ZEROS,
  COLOR_FOCUS_HIGH_HZ,
  COLOR_FOCUS_LOW_HZ,
  FFT_SIZE,
  THEME_PRESETS,
} from "../state/constants.js";
import {
  adaptiveColorMixWrap,
  angularRotationWrap,
  atmosphereWrap,
  audio,
  bandLabel,
  colorSeparationWrap,
  combineModeWrap,
  contrastWrap,
  controls,
  glowSpreadWrap,
  glowIntensityWrap,
  glowThicknessWrap,
  highColorInput,
  highColorWrap,
  lowColorInput,
  lowColorWrap,
  midColorInput,
  midColorWrap,
  modeLabel,
  nodalFocusWrap,
  numericControls,
  singleModeIndexOutput,
  singleModeViewWrap,
  singleModeWrap,
  themeSelect,
  themeWrap,
} from "../state/dom.js";
import {
  profiler,
  rendererFlags,
  state,
  writeProfilePreference,
} from "../state/runtime-state.js";
import {
  renderBuffers,
} from "../state/render-resources.js";
import {
  clamp,
  lerp,
  lerpColor,
  mixColor3,
  rgbToHex,
  toMel,
} from "./utils.js";
import {
  ensureInactiveBands,
  getBandRanges,
} from "./geometry.js";

function ensureProfilerOverlay() {
  if (!profiler.enabled) {
    if (profiler.overlay) {
      profiler.overlay.remove();
      profiler.overlay = null;
    }
    return;
  }
  if (profiler.overlay) {
    return;
  }
  const overlay = document.createElement("pre");
  overlay.style.position = "fixed";
  overlay.style.right = "16px";
  overlay.style.bottom = "16px";
  overlay.style.margin = "0";
  overlay.style.padding = "10px 12px";
  overlay.style.borderRadius = "12px";
  overlay.style.background = "rgba(4, 10, 14, 0.86)";
  overlay.style.border = "1px solid rgba(186, 218, 230, 0.18)";
  overlay.style.color = "#d7ece7";
  overlay.style.font = '12px/1.45 "IBM Plex Mono", monospace';
  overlay.style.whiteSpace = "pre";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "9999";
  overlay.textContent = "Profiling...";
  document.body.appendChild(overlay);
  profiler.overlay = overlay;
}

function resetProfilerSamples() {
  profiler.frameCount = 0;
  profiler.fps = 0;
  profiler.samples = Object.create(null);
  if (profiler.overlay) {
    profiler.overlay.textContent = "Profiling...";
  }
}

function setProfilerEnabled(enabled) {
  profiler.enabled = enabled;
  writeProfilePreference(enabled);
  if (!enabled) {
    ensureProfilerOverlay();
    return;
  }
  resetProfilerSamples();
  ensureProfilerOverlay();
}

function beginFrameProfile() {
  if (!profiler.enabled) {
    return null;
  }
  ensureProfilerOverlay();
  return {
    start: performance.now(),
    sections: Object.create(null),
  };
}

function profileSectionStart(frameProfile) {
  return frameProfile ? performance.now() : 0;
}

function profileSectionEnd(frameProfile, name, startTime) {
  if (!frameProfile) {
    return;
  }
  frameProfile.sections[name] = (frameProfile.sections[name] || 0) + (performance.now() - startTime);
}

function finishFrameProfile(frameProfile) {
  if (!frameProfile) {
    return;
  }
  frameProfile.sections.frame = performance.now() - frameProfile.start;
  for (const name of profiler.order) {
    const value = frameProfile.sections[name] || 0;
    const previous = profiler.samples[name] ?? value;
    profiler.samples[name] = previous * 0.84 + value * 0.16;
  }
  const instantaneousFps = 1000 / Math.max(frameProfile.sections.frame, 1e-6);
  profiler.fps = profiler.fps === 0
    ? instantaneousFps
    : profiler.fps * 0.84 + instantaneousFps * 0.16;
  profiler.frameCount += 1;
  if (!profiler.overlay || profiler.frameCount % 12 !== 0) {
    return;
  }
  const lines = [
    `profile avg (${profiler.frameCount}f)`,
    `renderer`.padEnd(15) + ` ${state.activeRenderer}`,
    `presenter`.padEnd(15) + ` ${state.activePresentation}`,
    `mode`.padEnd(15) + ` ${rendererFlags.directGpuPresentation ? "prefer-webgl" : "stable"}`,
    `limit`.padEnd(15) + ` ${state.frameRateLimit === "auto" ? "auto" : "60 fps"}`,
    `fps`.padEnd(15) + ` ${profiler.fps.toFixed(1)}`,
  ];
  for (const name of profiler.order) {
    lines.push(`${name.padEnd(15)} ${profiler.samples[name].toFixed(2)} ms`);
  }
  profiler.overlay.textContent = lines.join("\n");
}

function buildModes(count) {
  if (state.plateShape === "circle") {
    return buildCircleModes(count);
  }
  return buildSquareModes(count);
}

function buildSquareModes(count) {
  const pairs = [];
  for (let order = 2; pairs.length < count * 2 && order <= 16; order += 1) {
    for (let m = 1; m < order; m += 1) {
      const n = order - m;
      if (m === n) {
        continue;
      }
      pairs.push([m, n]);
    }
  }

  const modes = [];
  for (let index = 0; index < count; index += 1) {
    const [m, n] = pairs[index % pairs.length];
    modes.push({
      m,
      n,
      phase: (index / Math.max(1, count)) * Math.PI * 2,
      bandBias: index / Math.max(1, count - 1),
      amp: 0,
      velocity: 0,
    });
  }
  return modes;
}

function buildCircleModes(count) {
  const pairs = [];
  for (let radial = 1; radial <= 3; radial += 1) {
    for (let angular = 0; angular <= 8; angular += 1) {
      if (!BESSEL_ZEROS[angular] || !BESSEL_ZEROS[angular][radial - 1]) {
        continue;
      }
      pairs.push({
        n: angular,
        m: radial,
        zero: BESSEL_ZEROS[angular][radial - 1],
      });
    }
  }
  pairs.sort((a, b) => a.zero - b.zero || a.n - b.n || a.m - b.m);

  const modes = [];
  for (let index = 0; index < count; index += 1) {
    const { n, m } = pairs[index % pairs.length];
    modes.push({
      n,
      m,
      phase: (index / Math.max(1, count)) * Math.PI * 2,
      bandBias: index / Math.max(1, count - 1),
      amp: 0,
      velocity: 0,
    });
  }
  return modes;
}

function getBandRange(groupIndex, groups, sampleRate) {
  const ranges = getBandRanges(groups, sampleRate);
  return ranges[Math.max(0, Math.min(ranges.length - 1, groupIndex))];
}

function updateModeLabel() {
  const singleModeIndex = Math.max(0, Math.min(state.modeState.length - 1, Math.round(numericControls.singleModeIndex) - 1));
  const mode = state.modeState[singleModeIndex];
  if (!mode) {
    modeLabel.textContent = "Mode pair: unavailable";
    bandLabel.textContent = "Drive band: unavailable";
    return;
  }
  if (state.plateShape === "circle") {
    modeLabel.textContent = `Mode pair: (n=${mode.n}, m=${mode.m})`;
  } else {
    modeLabel.textContent = `Mode pair: (m=${mode.m}, n=${mode.n})`;
  }
  const groups = Math.round(numericControls.modeCount);
  const sampleRate = state.audioContext?.sampleRate ?? 48000;
  const { lowHz, highHz } = getBandRange(singleModeIndex, groups, sampleRate);
  bandLabel.textContent = `Drive band: ${Math.round(lowHz)} - ${Math.round(highHz)} Hz`;
}

function syncControlVisibility() {
  const isGlow = state.renderStyle === "glow";
  const isSingle = state.displayMode === "single";
  const isCircle = state.plateShape === "circle";
  angularRotationWrap.classList.toggle("is-hidden", !isCircle);
  atmosphereWrap.classList.toggle("is-hidden", false);
  glowThicknessWrap.classList.toggle("is-hidden", !isGlow);
  glowSpreadWrap.classList.toggle("is-hidden", !isGlow);
  glowIntensityWrap.classList.toggle("is-hidden", !isGlow);
  colorSeparationWrap.classList.toggle("is-hidden", !isGlow);
  adaptiveColorMixWrap.classList.toggle("is-hidden", !isGlow);
  themeWrap.classList.toggle("is-hidden", !isGlow);
  lowColorWrap.classList.toggle("is-hidden", !isGlow);
  midColorWrap.classList.toggle("is-hidden", !isGlow);
  highColorWrap.classList.toggle("is-hidden", !isGlow);
  nodalFocusWrap.classList.toggle("is-hidden", !isGlow);
  contrastWrap.classList.toggle("is-hidden", !isGlow);
  combineModeWrap.classList.toggle("is-hidden", isSingle);
  singleModeWrap.classList.toggle("is-hidden", !isSingle);
  modeLabel.classList.toggle("is-hidden", !isSingle);
  bandLabel.classList.toggle("is-hidden", !isSingle);
  singleModeViewWrap.classList.toggle("is-hidden", !isSingle);
}

function syncThemeInputs() {
  lowColorInput.value = rgbToHex(state.lowBandColor);
  midColorInput.value = rgbToHex(state.midBandColor);
  highColorInput.value = rgbToHex(state.highBandColor);
  themeSelect.value = state.activeTheme;
}

function applyTheme(themeKey) {
  const preset = THEME_PRESETS[themeKey];
  if (!preset) {
    return;
  }
  state.activeTheme = themeKey;
  state.lowBandColor = [...preset.low];
  state.midBandColor = [...preset.mid];
  state.highBandColor = [...preset.high];
  syncThemeInputs();
}

function getModeBaseColor(groupIndex, groups, sampleRate, themePalette) {
  const adaptiveMix = numericControls.adaptiveColorMix;
  const separation = numericControls.colorSeparation;
  const { lowHz, highHz } = getBandRange(groupIndex, groups, sampleRate);
  const centerHz = Math.sqrt(Math.max(1, lowHz) * Math.max(1, highHz));
  const melMin = toMel(COLOR_FOCUS_LOW_HZ);
  const melMax = toMel(Math.min(sampleRate / 2, COLOR_FOCUS_HIGH_HZ));
  const melCenter = toMel(centerHz);
  const fixedT = clamp((melCenter - melMin) / Math.max(1e-6, melMax - melMin), 0, 1);
  let adaptiveT = fixedT;
  if (state.bandProfile.length === groups) {
    let total = 0;
    for (let index = 0; index < state.bandProfile.length; index += 1) {
      total += state.bandProfile[index];
    }
    if (total > 1e-6) {
      let cumulative = 0;
      for (let index = 0; index <= groupIndex; index += 1) {
        cumulative += state.bandProfile[index];
      }
      const lower = cumulative - state.bandProfile[groupIndex];
      adaptiveT = clamp((lower + state.bandProfile[groupIndex] * 0.5) / total, 0, 1);
    }
  }
  const t = lerp(fixedT, adaptiveT, adaptiveMix);
  const centerSpread = clamp((t - 0.5) * (0.7 + separation * 0.55) + 0.5, 0, 1);
  const eased = Math.pow(centerSpread, 0.78 - Math.min(0.18, separation * 0.08));
  const paletteColor = mixColor3(state.lowBandColor, state.midBandColor, state.highBandColor, eased);
  const neutralMix = clamp(0.42 - separation * 0.12, 0.04, 0.42);
  return lerpColor(themePalette.baseColor, paletteColor, 1 - neutralMix);
}

function getThemeLineColor() {
  return lerpColor(state.midBandColor, state.highBandColor, 0.35);
}

function getThemeGlowPalette() {
  const lineColor = getThemeLineColor();
  const baseColor = lerpColor(lineColor, state.highBandColor, 0.22);
  const outerColor = lerpColor(state.lowBandColor, lineColor, 0.5);
  const backdropColor = lerpColor(BASE_BG_COLOR, lineColor, 0.18);
  const atmosphereCore = lerpColor(BASE_BG_COLOR, lineColor, 0.16);
  const atmosphereOuter = lerpColor(BASE_BG_COLOR, outerColor, 0.1);
  return {
    lineColor,
    baseColor,
    outerColor,
    backdropColor,
    atmosphereCore,
    atmosphereOuter,
  };
}

function ensureAudioGraph() {
  if (state.audioContext) {
    return;
  }

  state.audioContext = new AudioContext();
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = FFT_SIZE;
  state.analyser.smoothingTimeConstant = 0.78;
  state.freqData = new Uint8Array(state.analyser.frequencyBinCount);
  state.timeData = new Uint8Array(state.analyser.fftSize);

  state.sourceNode = state.audioContext.createMediaElementSource(audio);
  state.sourceNode.connect(state.analyser);
  state.analyser.connect(state.audioContext.destination);
  updateModeLabel();
}

function buildModeRenderState(sampleRate, themePalette, singleModeIndex, isSingleMode) {
  const modeContribution = renderBuffers.modeContribution;
  const modeSharpMix = renderBuffers.modeSharpMix;
  const modeBlurMix = renderBuffers.modeBlurMix;
  const modeEnabled = renderBuffers.modeEnabled;
  const modeColor = renderBuffers.modeColor;

  for (let index = 0; index < state.modeState.length; index += 1) {
    const mode = state.modeState[index];
    if (state.displayMode === "single" && index !== singleModeIndex) {
      continue;
    }

    const contribution =
      state.displayMode === "single" && state.singleModeView === "oscillation"
        ? mode.amp * Math.sin(state.phase * (1.1 + mode.bandBias * 2.4) + mode.phase)
        : mode.amp;
    const focus = Math.max(0, Math.min(1, Math.abs(contribution) * 1.6));
    const sharpMix = isSingleMode ? 1 : focus;
    const color = state.renderStyle === "glow" ? getModeBaseColor(index, state.modeState.length, sampleRate, themePalette) : null;

    modeContribution[index] = contribution;
    modeSharpMix[index] = sharpMix;
    modeBlurMix[index] = 1 - sharpMix;
    modeEnabled[index] = 1;
    if (color) {
      modeColor[index * 3] = color[0];
      modeColor[index * 3 + 1] = color[1];
      modeColor[index * 3 + 2] = color[2];
    }
  }

  return {
    contribution: modeContribution,
    sharpMix: modeSharpMix,
    blurMix: modeBlurMix,
    enabled: modeEnabled,
    color: modeColor,
  };
}

function groupBands(data, groups) {
  const values = new Float32Array(groups);
  const sampleRate = state.audioContext?.sampleRate ?? 48000;
  const ranges = getBandRanges(groups, sampleRate);

  for (let group = 0; group < groups; group += 1) {
    const { start, end } = ranges[group];
    let sum = 0;
    for (let index = start; index < end; index += 1) {
      sum += data[index] / 255;
    }
    values[group] = sum / Math.max(1, end - start);
  }

  return values;
}

function updateModeState() {
  const targetCount = Math.round(numericControls.modeCount);
  if (state.modeState.length !== targetCount) {
    state.modeState = buildModes(targetCount);
    state.bandProfile = new Float32Array(targetCount);
    controls.singleModeIndex.max = String(targetCount);
    if (Math.round(numericControls.singleModeIndex) > targetCount) {
      controls.singleModeIndex.value = String(targetCount);
      singleModeIndexOutput.value = controls.singleModeIndex.value;
      singleModeIndexOutput.textContent = controls.singleModeIndex.value;
      numericControls.singleModeIndex = targetCount;
    }
    updateModeLabel();
  }

  const isPlaying = Boolean(state.analyser) && !audio.paused && !audio.ended && audio.currentTime > 0;
  if (!state.analyser || !isPlaying) {
    return { bands: ensureInactiveBands(targetCount), rms: 0, centroid: 0, isPlaying: false };
  }

  state.analyser.getByteFrequencyData(state.freqData);
  state.analyser.getByteTimeDomainData(state.timeData);

  const bands = groupBands(state.freqData, targetCount);
  if (state.bandProfile.length !== targetCount) {
    state.bandProfile = new Float32Array(targetCount);
  }
  for (let index = 0; index < targetCount; index += 1) {
    const smoothing = 0.025;
    state.bandProfile[index] = state.bandProfile[index] * (1 - smoothing) + bands[index] * smoothing;
  }
  let rmsAccum = 0;
  let centroidAccum = 0;
  let energyAccum = 0;

  for (let index = 0; index < state.timeData.length; index += 1) {
    const centered = (state.timeData[index] - 128) / 128;
    rmsAccum += centered * centered;
  }

  for (let index = 0; index < bands.length; index += 1) {
    const energy = bands[index];
    energyAccum += energy;
    centroidAccum += energy * (index + 1);
  }

  return {
    bands,
    rms: Math.sqrt(rmsAccum / state.timeData.length),
    centroid: energyAccum > 1e-6 ? centroidAccum / energyAccum / bands.length : 0,
    isPlaying: true,
  };
}

export {
  applyTheme,
  beginFrameProfile,
  buildModeRenderState,
  buildModes,
  ensureAudioGraph,
  finishFrameProfile,
  getThemeGlowPalette,
  getThemeLineColor,
  profileSectionEnd,
  profileSectionStart,
  setProfilerEnabled,
  syncControlVisibility,
  syncThemeInputs,
  updateModeLabel,
  updateModeState,
};
