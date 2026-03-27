import {
  state,
} from "../state/runtime-state.js";

const BACKEND_CAPABILITIES = {
  webgpu: {
    renderStyles: ["glow", "isoline"],
    combineModes: ["signed"],
    displayModes: ["sum", "single"],
    presentation: "native",
    requiresSignedField: true,
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

function supportsCapability(capability, frameContext) {
  return capability.renderStyles.includes(frameContext.renderStyle) &&
    capability.combineModes.includes(frameContext.combineMode) &&
    capability.displayModes.includes(frameContext.displayMode) &&
    (!capability.requiresSignedField || frameContext.isSignedMode);
}

function resolveLegacyPresenter(frameContext) {
  if (frameContext.prefersLegacyWebGlPresentation && supportsCapability(LEGACY_PRESENTER_CAPABILITIES.webgl, frameContext)) {
    return "webgl";
  }
  return "cpu";
}

function resolveRenderPlan(frameContext) {
  const backend = supportsCapability(BACKEND_CAPABILITIES.webgpu, frameContext)
    ? "webgpu"
    : "legacy";
  const legacyPresenter = resolveLegacyPresenter(frameContext);
  const capability = backend === "webgpu"
    ? BACKEND_CAPABILITIES.webgpu
    : LEGACY_PRESENTER_CAPABILITIES[legacyPresenter];

  return {
    backend,
    capabilityKey: backend === "webgpu" ? "webgpu" : `legacy:${legacyPresenter}`,
    legacyPresenter,
    shouldAttemptGpuField: frameContext.shouldAttemptGpuField && (
      backend === "webgpu" || capability.requiresGpuAccumulation || legacyPresenter === "cpu"
    ),
  };
}

function setActiveRenderPath(plan) {
  state.activeRenderer = plan.backend;
  state.activePresentation = plan.backend === "webgpu"
    ? "native"
    : plan.legacyPresenter;
}

export {
  resolveRenderPlan,
  setActiveRenderPath,
};
