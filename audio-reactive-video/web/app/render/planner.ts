import {
  state,
} from "../state/runtime-state";
import type {
  FrameContext,
  RenderPlan,
} from "../types";

const BACKEND_CAPABILITIES = {
  webgpu: {
    renderStyles: ["glow", "isoline"],
    combineModes: ["signed", "percentile"],
    displayModes: ["sum", "single"],
    presentation: "native",
  },
  legacy: {
    renderStyles: ["glow", "isoline"],
    combineModes: ["signed", "residual", "percentile"],
    displayModes: ["sum", "single"],
    presentation: "cpu",
    requiresSignedField: false,
  },
};

const LEGACY_PRESENTER_CAPABILITIES = {
  cpu: {
    renderStyles: ["glow", "isoline"],
    combineModes: ["signed", "residual", "percentile"],
    displayModes: ["sum", "single"],
    requiresGpuAccumulation: false,
  },
  webgl: {
    renderStyles: ["glow"],
    combineModes: ["signed"],
    displayModes: ["sum", "single"],
    requiresGpuAccumulation: true,
  },
};

function supportsCapability(capability: {
  renderStyles: string[];
  combineModes: string[];
  displayModes: string[];
  requiresSignedField?: boolean;
}, frameContext: FrameContext): boolean {
  return capability.renderStyles.includes(frameContext.renderStyle) &&
    capability.combineModes.includes(frameContext.combineMode) &&
    capability.displayModes.includes(frameContext.displayMode) &&
    (!capability.requiresSignedField || frameContext.isSignedMode);
}

function resolveLegacyPresenter(frameContext: FrameContext): "cpu" | "webgl" {
  if (frameContext.prefersLegacyWebGlPresentation && supportsCapability(LEGACY_PRESENTER_CAPABILITIES.webgl, frameContext)) {
    return "webgl";
  }
  return "cpu";
}

function resolveRenderPlan(frameContext: FrameContext): RenderPlan {
  const backend = supportsCapability(BACKEND_CAPABILITIES.webgpu, frameContext)
    ? "webgpu"
    : "legacy";
  const legacyPresenter = resolveLegacyPresenter(frameContext);

  return {
    backend,
    capabilityKey: backend === "webgpu" ? "webgpu" : `legacy:${legacyPresenter}`,
    legacyPresenter,
    shouldAttemptGpuField: frameContext.shouldAttemptGpuField && (
      backend === "webgpu" ||
      LEGACY_PRESENTER_CAPABILITIES[legacyPresenter].requiresGpuAccumulation ||
      legacyPresenter === "cpu"
    ),
  };
}

function setActiveRenderPath(plan: RenderPlan): void {
  state.activeRenderer = plan.backend;
  state.activePresentation = plan.backend === "webgpu"
    ? "native"
    : plan.legacyPresenter;
}

export {
  resolveRenderPlan,
  setActiveRenderPath,
};
