import {
  appShell,
  atmosphereEnabledInput,
  audioInputModeMenu,
  audioInputModeSelect,
  audioInputModeTrigger,
  audioInputModeValue,
  canvas,
  combineModeMenu,
  combineModeSelect,
  combineModeTrigger,
  combineModeValue,
  controlPanelViewport,
  controls,
  crystalBloomInput,
  crystalBloomOutput,
  crystalFlowInput,
  crystalFlowOutput,
  crystalMaterialButtons,
  crystalPaletteButtons,
  crystalTensionInput,
  crystalTensionOutput,
  crystalTonalFocusInput,
  crystalTonalFocusOutput,
  displayModeButtons,
  frameRateLimitButtons,
  highColorInput,
  latticePerspectiveEnabledInput,
  latticeRotationSpeedInput,
  latticeRotationSpeedOutput,
  latticeTranslateWInput,
  latticeTranslateWOutput,
  latticeTranslateXInput,
  latticeTranslateXOutput,
  latticeTranslateYInput,
  latticeTranslateYOutput,
  latticeTranslateZInput,
  latticeTranslateZOutput,
  lowColorInput,
  midColorInput,
  numericControls,
  panelCollapseHandle,
  panelExpandHandle,
  plateShapeButtons,
  renderStyleButtons,
  singleModeViewButtons,
  statusNode,
  themeMenu,
  themeSelect,
  themeTrigger,
  themeValue,
  visualModeMenu,
  visualModeSelect,
  visualModeTrigger,
  visualModeValue,
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
  setProfilerEnabled,
  syncControlVisibility,
  syncThemeInputs,
  updateModeLabel,
} from "../core/runtime";
import {
  refreshThemeColorSwatches,
} from "./color-picker";
import {
  applyModeCopy,
} from "./mode-copy";
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
  primeCrystalRenderer,
} from "../render/crystal-webgpu";
import {
  primeLatticeRenderer,
} from "../render/lattice-webgpu";
import {
  requestRender,
} from "../render/renderer";
import type {
  CrystalMaterial,
  CrystalPalette,
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

  const bindCrystalRange = (
    input: HTMLInputElement,
    output: HTMLOutputElement,
    onUpdate: (value: number) => void,
  ) => {
    const sync = () => {
      output.value = input.value;
      output.textContent = input.value;
      onUpdate(Number.parseFloat(input.value));
      requestRender();
    };
    sync();
    input.addEventListener("input", sync);
  };

  bindCrystalRange(crystalTonalFocusInput, crystalTonalFocusOutput, (value) => {
    state.crystalTonalFocus = value;
  });
  bindCrystalRange(crystalFlowInput, crystalFlowOutput, (value) => {
    state.crystalFlow = value;
  });
  bindCrystalRange(crystalTensionInput, crystalTensionOutput, (value) => {
    state.crystalTension = value;
  });
  bindCrystalRange(crystalBloomInput, crystalBloomOutput, (value) => {
    state.crystalBloom = value;
  });
  bindCrystalRange(latticeRotationSpeedInput, latticeRotationSpeedOutput, (value) => {
    state.latticeRotationSpeed = value;
  });
  bindCrystalRange(latticeTranslateXInput, latticeTranslateXOutput, (value) => {
    state.latticeTranslateX = value;
  });
  bindCrystalRange(latticeTranslateYInput, latticeTranslateYOutput, (value) => {
    state.latticeTranslateY = value;
  });
  bindCrystalRange(latticeTranslateZInput, latticeTranslateZOutput, (value) => {
    state.latticeTranslateZ = value;
  });
  bindCrystalRange(latticeTranslateWInput, latticeTranslateWOutput, (value) => {
    state.latticeTranslateW = value;
  });

  latticePerspectiveEnabledInput.addEventListener("change", () => {
    state.latticePerspectiveEnabled = latticePerspectiveEnabledInput.checked;
    requestRender();
  });

  atmosphereEnabledInput.addEventListener("change", () => {
    requestRender();
  });

  const updateSelectLabel = (valueNode: HTMLElement, select: HTMLSelectElement) => {
    valueNode.textContent = select.selectedOptions[0]?.textContent ?? "";
  };

  const closeSelectMenu = (trigger: HTMLButtonElement, menu: HTMLElement) => {
    trigger.setAttribute("aria-expanded", "false");
    menu.hidden = true;
  };

  const openSelectMenu = (trigger: HTMLButtonElement, menu: HTMLElement) => {
    trigger.setAttribute("aria-expanded", "true");
    menu.hidden = false;
  };

  const toggleSelectMenu = (trigger: HTMLButtonElement, menu: HTMLElement) => {
    if (menu.hidden) {
      openSelectMenu(trigger, menu);
      return;
    }
    closeSelectMenu(trigger, menu);
  };

  const closeAllMenus = () => {
    closeSelectMenu(audioInputModeTrigger, audioInputModeMenu);
    closeSelectMenu(visualModeTrigger, visualModeMenu);
    closeSelectMenu(themeTrigger, themeMenu);
    closeSelectMenu(combineModeTrigger, combineModeMenu);
  };

  updateSelectLabel(audioInputModeValue, audioInputModeSelect);
  updateSelectLabel(visualModeValue, visualModeSelect);
  updateSelectLabel(themeValue, themeSelect);
  updateSelectLabel(combineModeValue, combineModeSelect);

  audioInputModeTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    closeSelectMenu(visualModeTrigger, visualModeMenu);
    closeSelectMenu(themeTrigger, themeMenu);
    closeSelectMenu(combineModeTrigger, combineModeMenu);
    toggleSelectMenu(audioInputModeTrigger, audioInputModeMenu);
  });

  visualModeTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    closeSelectMenu(audioInputModeTrigger, audioInputModeMenu);
    closeSelectMenu(themeTrigger, themeMenu);
    closeSelectMenu(combineModeTrigger, combineModeMenu);
    toggleSelectMenu(visualModeTrigger, visualModeMenu);
  });

  themeTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    closeSelectMenu(audioInputModeTrigger, audioInputModeMenu);
    closeSelectMenu(visualModeTrigger, visualModeMenu);
    closeSelectMenu(combineModeTrigger, combineModeMenu);
    toggleSelectMenu(themeTrigger, themeMenu);
  });

  combineModeTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    closeSelectMenu(audioInputModeTrigger, audioInputModeMenu);
    closeSelectMenu(visualModeTrigger, visualModeMenu);
    closeSelectMenu(themeTrigger, themeMenu);
    toggleSelectMenu(combineModeTrigger, combineModeMenu);
  });

  document.querySelectorAll<HTMLButtonElement>(".select-option").forEach((option) => {
    option.addEventListener("click", () => {
      const target = option.dataset.select;
      const value = option.dataset.value;
      if (!value) {
        return;
      }
      if (target === "audio-input-mode") {
        audioInputModeSelect.value = value;
        updateSelectLabel(audioInputModeValue, audioInputModeSelect);
        closeSelectMenu(audioInputModeTrigger, audioInputModeMenu);
        audioInputModeSelect.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if (target === "visual-mode") {
        visualModeSelect.value = value;
        updateSelectLabel(visualModeValue, visualModeSelect);
        closeSelectMenu(visualModeTrigger, visualModeMenu);
        visualModeSelect.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if (target === "theme") {
        themeSelect.value = value;
        updateSelectLabel(themeValue, themeSelect);
        closeSelectMenu(themeTrigger, themeMenu);
        themeSelect.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      combineModeSelect.value = value;
      updateSelectLabel(combineModeValue, combineModeSelect);
      closeSelectMenu(combineModeTrigger, combineModeMenu);
      combineModeSelect.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  document.addEventListener("click", () => {
    closeAllMenus();
  });

  const syncPanelToggleState = (collapsed: boolean) => {
    panelCollapseHandle.setAttribute("aria-expanded", String(!collapsed));
    panelCollapseHandle.setAttribute("aria-label", collapsed ? "Expand control panel" : "Collapse control panel");
    panelExpandHandle.setAttribute("aria-expanded", String(!collapsed));
    panelExpandHandle.setAttribute("aria-label", collapsed ? "Expand control panel" : "Collapse control panel");
  };

  const setPanelCollapsed = (collapsed: boolean) => {
    appShell.classList.toggle("is-collapsed", collapsed);
    controlPanelViewport.classList.toggle("is-collapsed", collapsed);
    syncPanelToggleState(collapsed);
    requestRender();
  };

  controlPanelViewport.classList.toggle("is-collapsed", appShell.classList.contains("is-collapsed"));
  syncPanelToggleState(appShell.classList.contains("is-collapsed"));
  panelCollapseHandle.addEventListener("click", () => {
    setPanelCollapsed(true);
  });
  panelExpandHandle.addEventListener("click", () => {
    setPanelCollapsed(false);
  });

  plateShapeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.plateShape = button.dataset.shape === "circle" ? "circle" : "square";
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

  visualModeSelect.addEventListener("input", () => {
    const nextMode = visualModeSelect.value;
    state.visualMode =
      nextMode === "crystal"
        ? "crystal"
        : nextMode === "lattice"
          ? "lattice"
          : "spectral";
    updateSelectLabel(visualModeValue, visualModeSelect);
    syncControlVisibility();
    applyModeCopy();
    statusNode.textContent = state.visualMode === "crystal"
      ? "Crystal mode active. Harmonic membrane rendering is driving the scene."
      : state.visualMode === "lattice"
        ? "Lattice mode active. Spatial wireframe projection is driving the scene."
        : "Spectral mode active. Resonance field rendering is back online.";
    if (state.visualMode === "crystal") {
      void primeCrystalRenderer().then(() => {
        requestRender();
      });
      return;
    }
    if (state.visualMode === "lattice") {
      void primeLatticeRenderer().then(() => {
        requestRender();
      });
      return;
    }
    requestRender();
  });

  crystalMaterialButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.crystalMaterial = (button.dataset.crystalMaterial as CrystalMaterial) || "prism";
      crystalMaterialButtons.forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      requestRender();
    });
  });

  crystalPaletteButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.crystalPalette = (button.dataset.crystalPalette as CrystalPalette) || "glacial";
      crystalPaletteButtons.forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
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
      clearSpatialCache("circle");
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
      refreshThemeColorSwatches();
      updateSelectLabel(themeValue, themeSelect);
      requestRender();
      return;
    }
    applyTheme(themeSelect.value as ThemeKey);
    refreshThemeColorSwatches();
    updateSelectLabel(themeValue, themeSelect);
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
