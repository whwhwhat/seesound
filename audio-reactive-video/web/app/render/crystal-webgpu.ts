import {
  CRYSTAL_PALETTES,
  FFT_SIZE,
} from "../state/constants";
import {
  canvas,
  wgpuCanvas,
} from "../state/dom";
import {
  state,
} from "../state/runtime-state";
import CRYSTAL_SURFACE_SHADER from "../shaders/wgsl/crystal-surface.wgsl?raw";
import {
  getSharedWebGpuPresentationState,
  primeWebGpuRenderer,
} from "./webgpu";
import type {
  AudioFrame,
} from "../types";

interface CrystalWebGpuState {
  device: GPUDevice | null;
  context: GPUCanvasContext | null;
  format: string;
  pipeline: GPURenderPipeline | null;
  uniformBuffer: GPUBuffer | null;
  bindGroup: object | null;
  ready: boolean;
  initPromise: Promise<boolean> | null;
  failed: boolean;
  canvasSizeKey: string;
  harmonicScratch: Float32Array;
  smoothedHarmonyX: number;
  smoothedHarmonyY: number;
  smoothedCoherence: number;
  smoothedConcentration: number;
}

const crystalState: CrystalWebGpuState = {
  device: null,
  context: null,
  format: "",
  pipeline: null,
  uniformBuffer: null,
  bindGroup: null,
  ready: false,
  initPromise: null,
  failed: false,
  canvasSizeKey: "",
  harmonicScratch: new Float32Array(12),
  smoothedHarmonyX: 0,
  smoothedHarmonyY: -1,
  smoothedCoherence: 0,
  smoothedConcentration: 0,
};

function setCrystalCanvasVisible(visible: boolean): void {
  wgpuCanvas.classList.toggle("is-visible", visible);
  wgpuCanvas.style.transform = "";
}

function isSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.gpu) && Boolean(wgpuCanvas);
}

function buildPitchClassProfile(): Float32Array {
  const profile = new Float32Array(12);
  if (!state.freqData) {
    for (let index = 0; index < 12; index += 1) {
      state.crystalPitchProfile[index] *= 0.92;
    }
    return state.crystalPitchProfile;
  }
  const sampleRate = state.audioContext?.sampleRate ?? state.audioSampleRate ?? 48000;
  const binHz = sampleRate / FFT_SIZE;
  const harmonicWeights = [1, 0.82, 0.58, 0.42, 0.3];
  for (let index = 1; index < state.freqData.length; index += 1) {
    const frequency = index * binHz;
    if (frequency < 48 || frequency > 4200) {
      continue;
    }
    const binEnergy = Math.pow(state.freqData[index] / 255, 1.85);
    if (binEnergy < 1e-5) {
      continue;
    }
    for (let harmonicIndex = 0; harmonicIndex < harmonicWeights.length; harmonicIndex += 1) {
      const fundamental = frequency / (harmonicIndex + 1);
      if (fundamental < 48 || fundamental > 1600) {
        continue;
      }
      const midi = 69 + 12 * Math.log2(fundamental / 440);
      const note = Math.round(midi);
      const pitchClass = ((note % 12) + 12) % 12;
      const detune = Math.abs(midi - note);
      const precision = Math.max(0, 1 - detune * 1.55);
      const octaveBias = 1 - Math.min(0.32, Math.abs(midi - 60) * 0.012);
      profile[pitchClass] += binEnergy * harmonicWeights[harmonicIndex] * precision * octaveBias;
    }
  }
  const blurred = crystalState.harmonicScratch;
  for (let index = 0; index < 12; index += 1) {
    const left = profile[(index + 11) % 12];
    const center = profile[index];
    const right = profile[(index + 1) % 12];
    blurred[index] = left * 0.18 + center * 0.64 + right * 0.18;
  }
  let maxValue = 0;
  for (let index = 0; index < blurred.length; index += 1) {
    maxValue = Math.max(maxValue, blurred[index]);
  }
  if (maxValue > 1e-6) {
    for (let index = 0; index < blurred.length; index += 1) {
      blurred[index] /= maxValue;
    }
  }
  const smoothing = 0.16 + state.crystalFlow * 0.08;
  for (let index = 0; index < 12; index += 1) {
    state.crystalPitchProfile[index] =
      state.crystalPitchProfile[index] * (1 - smoothing) +
      blurred[index] * smoothing;
  }
  return state.crystalPitchProfile;
}

function computeHarmonyMetrics(pitchProfile: Float32Array) {
  let total = 0;
  let weightedX = 0;
  let weightedY = 0;
  let maxValue = 0;
  let entropy = 0;
  for (let index = 0; index < pitchProfile.length; index += 1) {
    const value = pitchProfile[index];
    total += value;
    maxValue = Math.max(maxValue, value);
    const angle = (index / 12) * Math.PI * 2 - Math.PI * 0.5;
    weightedX += Math.cos(angle) * value;
    weightedY += Math.sin(angle) * value;
  }
  if (total > 1e-6) {
    for (let index = 0; index < pitchProfile.length; index += 1) {
      const probability = pitchProfile[index] / total;
      if (probability > 1e-6) {
        entropy -= probability * Math.log2(probability);
      }
    }
  }
  const centerX = total > 1e-6 ? weightedX / total : 0;
  const centerY = total > 1e-6 ? weightedY / total : -1;
  const concentration = Math.min(1, Math.sqrt(centerX * centerX + centerY * centerY) * 1.65);
  const normalizedEntropy = total > 1e-6 ? entropy / Math.log2(12) : 1;
  const coherence = Math.max(0, Math.min(1, concentration * 0.65 + maxValue * 0.35 - normalizedEntropy * 0.28));
  return {
    centerX,
    centerY,
    coherence,
    concentration,
  };
}

function smoothHarmonyMetrics(harmony: {
  centerX: number;
  centerY: number;
  coherence: number;
  concentration: number;
}) {
  const targetLength = Math.max(0, Math.min(1, harmony.concentration));
  const currentLength = Math.hypot(crystalState.smoothedHarmonyX, crystalState.smoothedHarmonyY);
  const stableWeight = Math.max(0, Math.min(1, harmony.coherence * 0.82 + harmony.concentration * 0.18));
  const response = 0.018 + stableWeight * 0.09;
  const targetX = targetLength > 1e-5 ? harmony.centerX / Math.max(harmony.concentration, 1e-5) * targetLength : crystalState.smoothedHarmonyX;
  const targetY = targetLength > 1e-5 ? harmony.centerY / Math.max(harmony.concentration, 1e-5) * targetLength : crystalState.smoothedHarmonyY;
  const holdBias = 1 - stableWeight;

  crystalState.smoothedHarmonyX =
    crystalState.smoothedHarmonyX * (1 - response) +
    targetX * response * (1 - holdBias * 0.55);
  crystalState.smoothedHarmonyY =
    crystalState.smoothedHarmonyY * (1 - response) +
    targetY * response * (1 - holdBias * 0.55);

  const smoothedLength = Math.hypot(crystalState.smoothedHarmonyX, crystalState.smoothedHarmonyY);
  if (smoothedLength > 1e-5) {
    const clampedLength = currentLength * (1 - response) + targetLength * response;
    crystalState.smoothedHarmonyX = crystalState.smoothedHarmonyX / smoothedLength * clampedLength;
    crystalState.smoothedHarmonyY = crystalState.smoothedHarmonyY / smoothedLength * clampedLength;
  } else {
    crystalState.smoothedHarmonyX = 0;
    crystalState.smoothedHarmonyY = -Math.max(0.08, targetLength);
  }

  crystalState.smoothedCoherence =
    crystalState.smoothedCoherence * 0.9 +
    harmony.coherence * 0.1;
  crystalState.smoothedConcentration =
    crystalState.smoothedConcentration * 0.88 +
    harmony.concentration * 0.12;

  return {
    centerX: crystalState.smoothedHarmonyX,
    centerY: crystalState.smoothedHarmonyY,
    coherence: crystalState.smoothedCoherence,
    concentration: crystalState.smoothedConcentration,
  };
}

function buildCrystalPalette() {
  const preset = CRYSTAL_PALETTES[state.crystalPalette];
  const low = [...preset.low] as [number, number, number];
  const mid = [...preset.mid] as [number, number, number];
  const high = [...preset.high] as [number, number, number];

  if (state.crystalMaterial === "opal") {
    return {
      low: low.map((value, index) => value * 0.56 + mid[index] * 0.24 + 28) as [number, number, number],
      mid: mid.map((value, index) => value * 0.64 + high[index] * 0.16 + 42) as [number, number, number],
      high: high.map((value) => Math.min(255, value * 0.72 + 54)) as [number, number, number],
    };
  }

  if (state.crystalMaterial === "basalt") {
    return {
      low: low.map((value, index) => value * 0.38 + mid[index] * 0.12 + 10) as [number, number, number],
      mid: mid.map((value, index) => value * 0.52 + low[index] * 0.18 + 18) as [number, number, number],
      high: high.map((value, index) => value * 0.58 + mid[index] * 0.14 + 26) as [number, number, number],
    };
  }

  return {
    low,
    mid,
    high,
  };
}

function ensureCanvasConfigured(): boolean {
  if (!crystalState.device || !crystalState.context || !crystalState.format) {
    return false;
  }
  const key = `${wgpuCanvas.width}x${wgpuCanvas.height}`;
  if (crystalState.canvasSizeKey === key) {
    return true;
  }
  crystalState.context.configure({
    device: crystalState.device,
    format: crystalState.format,
    alphaMode: "opaque",
  });
  crystalState.canvasSizeKey = key;
  return true;
}

async function primeCrystalRenderer(): Promise<boolean> {
  if (crystalState.ready) {
    return true;
  }
  if (crystalState.failed || !isSupported()) {
    crystalState.failed = true;
    return false;
  }
  if (crystalState.initPromise) {
    return crystalState.initPromise;
  }

  crystalState.initPromise = (async () => {
    try {
      const gpu = navigator.gpu;
      if (!gpu) {
        crystalState.failed = true;
        return false;
      }
      const sharedReady = await primeWebGpuRenderer();
      if (!sharedReady) {
        crystalState.failed = true;
        return false;
      }
      const sharedPresentation = getSharedWebGpuPresentationState();
      if (!sharedPresentation) {
        crystalState.failed = true;
        return false;
      }
      crystalState.device = sharedPresentation.device;
      crystalState.context = sharedPresentation.context;
      crystalState.format = sharedPresentation.format;
      crystalState.uniformBuffer = crystalState.device.createBuffer({
        size: 10 * 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const module = crystalState.device.createShaderModule({
        code: CRYSTAL_SURFACE_SHADER,
      });
      crystalState.pipeline = crystalState.device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module,
          entryPoint: "vsMain",
        },
        fragment: {
          module,
          entryPoint: "fsMain",
          targets: [{ format: crystalState.format }],
        },
        primitive: {
          topology: "triangle-list",
        },
      });
      crystalState.bindGroup = crystalState.device.createBindGroup({
        layout: crystalState.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: crystalState.uniformBuffer } },
        ],
      });
      crystalState.ready = ensureCanvasConfigured();
      return crystalState.ready;
    } catch {
      crystalState.failed = true;
      return false;
    }
  })();

  return crystalState.initPromise;
}

function renderCrystalScene(audioFrame: AudioFrame): boolean {
  if (!crystalState.ready || !ensureCanvasConfigured() || !crystalState.device || !crystalState.context || !crystalState.pipeline || !crystalState.uniformBuffer || !crystalState.bindGroup) {
    return false;
  }
  const pitchProfile = buildPitchClassProfile();
  const harmony = smoothHarmonyMetrics(computeHarmonyMetrics(pitchProfile));
  const palette = buildCrystalPalette();
  const bands = audioFrame.bands;
  const low = bands.length > 0 ? bands.slice(0, Math.max(1, Math.floor(bands.length / 3))).reduce((sum, value) => sum + value, 0) / Math.max(1, Math.floor(bands.length / 3)) : 0;
  const midStart = Math.max(0, Math.floor(bands.length / 3));
  const midEnd = Math.max(midStart + 1, Math.floor(bands.length * 2 / 3));
  let midAccum = 0;
  for (let index = midStart; index < midEnd; index += 1) {
    midAccum += bands[index] || 0;
  }
  const mid = midAccum / Math.max(1, midEnd - midStart);
  let highAccum = 0;
  for (let index = midEnd; index < bands.length; index += 1) {
    highAccum += bands[index] || 0;
  }
  const high = highAccum / Math.max(1, bands.length - midEnd);
  const uniformData = new Float32Array([
    wgpuCanvas.width, wgpuCanvas.height, performance.now() * 0.001, audioFrame.rms,
    audioFrame.centroid, state.crystalTonalFocus, state.crystalFlow, state.crystalTension,
    low, mid, high, state.crystalBloom,
    palette.low[0], palette.low[1], palette.low[2], 0,
    palette.mid[0], palette.mid[1], palette.mid[2], 0,
    palette.high[0], palette.high[1], palette.high[2], 0,
    harmony.centerX, harmony.centerY, harmony.coherence, harmony.concentration,
    pitchProfile[0], pitchProfile[1], pitchProfile[2], pitchProfile[3],
    pitchProfile[4], pitchProfile[5], pitchProfile[6], pitchProfile[7],
    pitchProfile[8], pitchProfile[9], pitchProfile[10], pitchProfile[11],
  ]);
  crystalState.device.queue.writeBuffer(crystalState.uniformBuffer, 0, uniformData);

  const encoder = crystalState.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: crystalState.context.getCurrentTexture().createView(),
        clearValue: { r: 3 / 255, g: 6 / 255, b: 9 / 255, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });
  pass.setPipeline(crystalState.pipeline);
  pass.setBindGroup(0, crystalState.bindGroup);
  pass.draw(3, 1, 0, 0);
  pass.end();
  crystalState.device.queue.submit([encoder.finish()]);
  setCrystalCanvasVisible(true);
  state.activeRenderer = "webgpu";
  state.activePresentation = "native";
  return true;
}

export {
  primeCrystalRenderer,
  renderCrystalScene,
};
