import {
  audio,
  atmosphereEnabledInput,
  canvas,
  combineModeSelect,
  controls,
  displayModeButtons,
  fileInput,
  frameRateLimitButtons,
  highColorInput,
  lowColorInput,
  midColorInput,
  numericControls,
  plateShapeButtons,
  renderStyleButtons,
  singleModeViewButtons,
  statusNode,
  themeSelect,
  glCanvas,
  wgpuCanvas,
} from "../state/dom";
import {
  profiler,
  rendererFlags,
  state,
  writeDirectGpuPreference,
} from "../state/runtime-state";
import {
  applyTheme,
  buildModes,
  ensureAudioGraph,
  setProfilerEnabled,
  syncControlVisibility,
  syncThemeInputs,
  updateModeLabel,
} from "../core/runtime";
import {
  clearSpatialCache,
} from "../core/geometry";
import {
  clearGpuPresentation,
  setGpuCanvasFrame,
} from "../render/gpu";
import {
  handleWebGpuResize,
} from "../render/webgpu";
import {
  requestRender,
  startAnimationLoop,
  stopAnimationLoop,
} from "../render/renderer";
import {
  hexToRgb,
} from "../core/utils";
import type {
  CombineMode,
  ThemeKey,
} from "../types";

let eventsBound = false;

function bindEventHandlers() {
  if (eventsBound) {
    return;
  }
  eventsBound = true;

  for (const input of Object.values(controls)) {
    input.addEventListener("input", () => {
      requestRender();
    });
  }

  atmosphereEnabledInput.addEventListener("change", () => {
    requestRender();
  });

  fileInput.addEventListener("change", () => {
    const [file] = fileInput.files || [];
    if (!file) {
      return;
    }
    ensureAudioGraph();
    if (state.currentAudioObjectUrl) {
      URL.revokeObjectURL(state.currentAudioObjectUrl);
    }
    state.currentAudioObjectUrl = URL.createObjectURL(file);
    audio.src = state.currentAudioObjectUrl;
    audio.load();
    statusNode.textContent = `Loaded ${file.name}. Press play to drive the field.`;
    requestRender();
  });

  plateShapeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.plateShape = button.dataset.shape === "circle" ? "circle" : "square";
      clearSpatialCache();
      state.modeState = buildModes(Math.round(numericControls.modeCount));
      state.bandProfile = new Float32Array(state.modeState.length);
      updateModeLabel();
      plateShapeButtons.forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      statusNode.textContent =
        state.plateShape === "circle"
          ? "Showing circular Bessel-mode resonance fields."
          : "Showing square Chladni-mode resonance fields.";
      syncControlVisibility();
      requestRender();
    });
  });

  renderStyleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.renderStyle = button.dataset.renderStyle === "isoline" ? "isoline" : "glow";
      renderStyleButtons.forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      syncControlVisibility();
      statusNode.textContent =
        state.renderStyle === "isoline"
          ? "Showing extracted zero-contours."
          : "Showing glow-based nodal rendering.";
      requestRender();
    });
  });

  frameRateLimitButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.frameRateLimit = button.dataset.frameRate === "60" ? "60" : "auto";
      frameRateLimitButtons.forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      state.lastAnimationTimestamp = 0;
      statusNode.textContent =
        state.frameRateLimit === "60"
          ? "Frame rate capped at 60 FPS."
          : "Frame rate cap disabled.";
      requestRender();
    });
  });

  controls.singleModeIndex.addEventListener("input", () => {
    updateModeLabel();
    requestRender();
  });

  controls.angularRotation.addEventListener("input", () => {
    if (state.plateShape === "circle") {
      clearSpatialCache();
    }
    requestRender();
  });

  displayModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.displayMode = button.dataset.mode === "single" ? "single" : "sum";
      displayModeButtons.forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      syncControlVisibility();
      statusNode.textContent =
        state.displayMode === "single"
          ? "Inspecting one resonance basis at a time."
          : "Showing the combined resonance field.";
      requestRender();
    });
  });

  combineModeSelect.addEventListener("input", () => {
    state.combineMode = combineModeSelect.value as CombineMode;
    if (state.displayMode === "sum") {
      statusNode.textContent =
        state.combineMode === "signed"
          ? "Showing signed modal interference."
          : state.combineMode === "residual"
            ? "Showing residual envelope structure."
            : "Showing percentile-based envelope slices.";
    }
    requestRender();
  });

  singleModeViewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.singleModeView = button.dataset.singleView === "oscillation" ? "oscillation" : "amplitude";
      singleModeViewButtons.forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      if (state.displayMode === "single") {
        statusNode.textContent =
          state.singleModeView === "oscillation"
            ? "Inspecting one resonance basis with signed oscillation."
            : "Inspecting one resonance basis at a time.";
      }
      requestRender();
    });
  });

  themeSelect.addEventListener("input", () => {
    if (themeSelect.value === "custom") {
      state.activeTheme = "custom";
      syncThemeInputs();
      requestRender();
      return;
    }
    applyTheme(themeSelect.value as ThemeKey);
    requestRender();
  });

  [lowColorInput, midColorInput, highColorInput].forEach((input) => {
    input.addEventListener("input", () => {
      state.lowBandColor = hexToRgb(lowColorInput.value);
      state.midBandColor = hexToRgb(midColorInput.value);
      state.highBandColor = hexToRgb(highColorInput.value);
      state.activeTheme = "custom";
      themeSelect.value = "custom";
      requestRender();
    });
  });

  audio.addEventListener("play", async () => {
    ensureAudioGraph();
    if (state.audioContext) {
      await state.audioContext.resume();
    }
    statusNode.textContent = "Running realtime resonance preview.";
    startAnimationLoop();
  });

  audio.addEventListener("pause", () => {
    statusNode.textContent = "Playback paused. Field is frozen at the current state.";
    stopAnimationLoop();
    requestRender();
  });

  audio.addEventListener("ended", () => {
    statusNode.textContent = "Playback ended. Field is frozen at the final state.";
    stopAnimationLoop();
    requestRender();
  });

  window.addEventListener("keydown", (event) => {
    if (!event.shiftKey || event.key.toLowerCase() !== "p") {
      if (event.shiftKey && event.key.toLowerCase() === "g") {
        event.preventDefault();
        const nextEnabled = !rendererFlags.directGpuPresentation;
        rendererFlags.directGpuPresentation = nextEnabled;
        writeDirectGpuPreference(nextEnabled);
        clearGpuPresentation();
        statusNode.textContent = nextEnabled
          ? "Experimental direct GPU path enabled. Press Shift+G to disable it."
          : "Experimental direct GPU path disabled.";
        requestRender();
      }
      return;
    }
    event.preventDefault();
    const nextEnabled = !profiler.enabled;
    setProfilerEnabled(nextEnabled);
    statusNode.textContent = nextEnabled
      ? "Profiler enabled. Press Shift+P to hide it."
      : "Profiler disabled.";
    requestRender();
  });

  window.addEventListener("resize", () => {
    const ratio = window.devicePixelRatio || 1;
    const stageWidth = canvas.parentElement?.clientWidth || canvas.clientWidth || 1280;
    const stageHeight = canvas.parentElement?.clientHeight || canvas.clientHeight || 1280;
    const size = Math.min(stageWidth, stageHeight);
    const backingSize = Math.max(512, Math.round(size * ratio));
    canvas.width = backingSize;
    canvas.height = backingSize;
    wgpuCanvas.width = backingSize;
    wgpuCanvas.height = backingSize;
    glCanvas.width = backingSize;
    glCanvas.height = backingSize;
    handleWebGpuResize();
    clearGpuPresentation();
    setGpuCanvasFrame(rendererFlags.directGpuPresentation);
    requestRender();
  });
}

export {
  bindEventHandlers,
};
