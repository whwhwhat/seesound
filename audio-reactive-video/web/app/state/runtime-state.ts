import {
  THEME_PRESETS,
} from "./constants";
import type {
  AppState,
  ProfilerState,
  RendererFlags,
} from "../types";

function readProfilePreference(): boolean {
  try {
    return window.localStorage.getItem("arv_profile") === "1";
  } catch {
    return false;
  }
}

function writeProfilePreference(enabled: boolean): void {
  try {
    window.localStorage.setItem("arv_profile", enabled ? "1" : "0");
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

function readDirectGpuPreference(): boolean {
  try {
    return window.localStorage.getItem("arv_direct_gpu") === "1";
  } catch {
    return false;
  }
}

function writeDirectGpuPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem("arv_direct_gpu", enabled ? "1" : "0");
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

const rendererFlags: RendererFlags = {
  directGpuPresentation:
    new URLSearchParams(window.location.search).get("directGpu") === "1" ||
    window.location.hash.includes("direct-gpu") ||
    readDirectGpuPreference(),
};

const profiler: ProfilerState = {
  enabled:
    new URLSearchParams(window.location.search).get("profile") === "1" ||
    window.location.hash.includes("profile") ||
    readProfilePreference(),
  overlay: null,
  frameCount: 0,
  fps: 0,
  lastFrameTimestamp: 0,
  samples: Object.create(null),
  order: [
    "frame",
    "updateModeState",
    "webgpuField",
    "webgpuReduce",
    "webgpuShade",
    "gpuAccumulate",
    "gpuReadback",
    "cpuAccumulate",
    "fieldPost",
    "cpuShade",
    "isoline",
    "glowContours",
    "composite",
  ],
};

const state: AppState = {
  audioContext: null,
  analyser: null,
  sourceNode: null,
  freqData: null,
  timeData: null,
  modeState: [],
  bandProfile: new Float32Array(),
  animationFrame: 0,
  isAnimating: false,
  lastAnimationTimestamp: 0,
  phase: 0,
  renderStyle: "glow",
  displayMode: "sum",
  combineMode: "signed",
  singleModeView: "amplitude",
  frameRateLimit: "auto",
  plateShape: "square",
  activeTheme: "lab",
  lowBandColor: [...THEME_PRESETS.lab.low],
  midBandColor: [...THEME_PRESETS.lab.mid],
  highBandColor: [...THEME_PRESETS.lab.high],
  currentAudioObjectUrl: null,
  activeRenderer: "legacy",
  activePresentation: "cpu",
};

export {
  profiler,
  rendererFlags,
  state,
  writeDirectGpuPreference,
  writeProfilePreference,
};
