import {
  wgpuCanvas,
} from "../state/dom";
import {
  state,
} from "../state/runtime-state";
import LATTICE_SPACE_SHADER from "../shaders/wgsl/lattice-space.wgsl?raw";
import {
  getSharedWebGpuPresentationState,
  primeWebGpuRenderer,
} from "./webgpu";
import type {
  AudioFrame,
} from "../types";

interface LatticeWebGpuState {
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
  smoothedEnergy: number;
  smoothedPulse: number;
  smoothedCentroid: number;
  rotationPhase: number;
  lastPhaseTimestamp: number;
}

const latticeState: LatticeWebGpuState = {
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
  smoothedEnergy: 0,
  smoothedPulse: 0,
  smoothedCentroid: 0,
  rotationPhase: 0,
  lastPhaseTimestamp: 0,
};

function setLatticeCanvasVisible(visible: boolean): void {
  wgpuCanvas.classList.toggle("is-visible", visible);
  wgpuCanvas.style.transform = "";
}

function isSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.gpu) && Boolean(wgpuCanvas);
}

function ensureCanvasConfigured(): boolean {
  if (!latticeState.device || !latticeState.context || !latticeState.format) {
    return false;
  }
  const key = `${wgpuCanvas.width}x${wgpuCanvas.height}`;
  if (latticeState.canvasSizeKey === key) {
    return true;
  }
  latticeState.context.configure({
    device: latticeState.device,
    format: latticeState.format,
    alphaMode: "opaque",
  });
  latticeState.canvasSizeKey = key;
  return true;
}

async function primeLatticeRenderer(): Promise<boolean> {
  if (latticeState.ready) {
    return true;
  }
  if (latticeState.failed || !isSupported()) {
    latticeState.failed = true;
    return false;
  }
  if (latticeState.initPromise) {
    return latticeState.initPromise;
  }

  latticeState.initPromise = (async () => {
    try {
      const sharedReady = await primeWebGpuRenderer();
      if (!sharedReady) {
        latticeState.failed = true;
        return false;
      }
      const sharedPresentation = getSharedWebGpuPresentationState();
      if (!sharedPresentation) {
        latticeState.failed = true;
        return false;
      }
      latticeState.device = sharedPresentation.device;
      latticeState.context = sharedPresentation.context;
      latticeState.format = sharedPresentation.format;
      latticeState.uniformBuffer = latticeState.device.createBuffer({
        size: 9 * 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const module = latticeState.device.createShaderModule({
        code: LATTICE_SPACE_SHADER,
      });
      latticeState.pipeline = latticeState.device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module,
          entryPoint: "vsMain",
        },
        fragment: {
          module,
          entryPoint: "fsMain",
          targets: [{ format: latticeState.format }],
        },
        primitive: {
          topology: "triangle-list",
        },
      });
      latticeState.bindGroup = latticeState.device.createBindGroup({
        layout: latticeState.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: latticeState.uniformBuffer } },
        ],
      });
      latticeState.ready = ensureCanvasConfigured();
      return latticeState.ready;
    } catch {
      latticeState.failed = true;
      return false;
    }
  })();

  return latticeState.initPromise;
}

function averageBandRange(bands: Float32Array, startRatio: number, endRatio: number): number {
  if (bands.length === 0) {
    return 0;
  }
  const start = Math.max(0, Math.floor(bands.length * startRatio));
  const end = Math.max(start + 1, Math.min(bands.length, Math.floor(bands.length * endRatio)));
  let total = 0;
  for (let index = start; index < end; index += 1) {
    total += bands[index] || 0;
  }
  return total / Math.max(1, end - start);
}

function samplePulse(): number {
  if (!state.timeData || state.timeData.length === 0) {
    latticeState.smoothedPulse *= 0.92;
    return latticeState.smoothedPulse;
  }
  let transient = 0;
  for (let index = 1; index < state.timeData.length; index += 1) {
    transient += Math.abs(state.timeData[index] - state.timeData[index - 1]) / 255;
  }
  const normalized = Math.min(1, transient / Math.max(1, state.timeData.length - 1) * 3.4);
  latticeState.smoothedPulse = latticeState.smoothedPulse * 0.8 + normalized * 0.2;
  return latticeState.smoothedPulse;
}

function renderLatticeScene(audioFrame: AudioFrame): boolean {
  if (!latticeState.ready || !ensureCanvasConfigured() || !latticeState.device || !latticeState.context || !latticeState.pipeline || !latticeState.uniformBuffer || !latticeState.bindGroup) {
    return false;
  }

  const now = performance.now() * 0.001;
  if (latticeState.lastPhaseTimestamp <= 0) {
    latticeState.lastPhaseTimestamp = now;
  }
  const delta = Math.max(0, Math.min(0.05, now - latticeState.lastPhaseTimestamp));
  if (audioFrame.isPlaying) {
    latticeState.rotationPhase += delta;
  }
  latticeState.lastPhaseTimestamp = now;

  const low = 0;
  const mid = 0;
  const high = 0;
  const pulse = 0;
  latticeState.smoothedEnergy = 0;
  latticeState.smoothedCentroid = 0;

  const uniformData = new Float32Array([
    wgpuCanvas.width, wgpuCanvas.height, latticeState.rotationPhase, audioFrame.isPlaying ? 1 : 0,
    low, mid, high, latticeState.smoothedEnergy,
    pulse, latticeState.smoothedCentroid, 0, 0,
    20, 42, 74, 0,
    92, 212, 240, 0,
    168, 224, 255, 0,
    214, 234, 245, 0,
    state.latticePerspectiveEnabled ? 1 : 0, state.latticeRotationSpeed, 0, 0,
    state.latticeTranslateX, state.latticeTranslateY, state.latticeTranslateZ, state.latticeTranslateW,
  ]);
  latticeState.device.queue.writeBuffer(latticeState.uniformBuffer, 0, uniformData);

  const encoder = latticeState.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: latticeState.context.getCurrentTexture().createView(),
        clearValue: { r: 4 / 255, g: 7 / 255, b: 13 / 255, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });
  pass.setPipeline(latticeState.pipeline);
  pass.setBindGroup(0, latticeState.bindGroup);
  pass.draw(3, 1, 0, 0);
  pass.end();
  latticeState.device.queue.submit([encoder.finish()]);
  setLatticeCanvasVisible(true);
  state.activeRenderer = "webgpu";
  state.activePresentation = "native";
  return true;
}

export {
  primeLatticeRenderer,
  renderLatticeScene,
};
