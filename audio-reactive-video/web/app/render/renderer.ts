import {
  canvas,
  ctx,
  gpuFieldValidation,
} from "../state/context";
import {
  state,
} from "../state/runtime-state";
import {
  beginFrameProfile,
  finishFrameProfile,
  profileSectionEnd,
  profileSectionStart,
  updateModeState,
} from "../core/runtime";
import {
  buildFrameContext,
} from "./frame-state";
import {
  resolveRenderPlan,
  setActiveRenderPath,
} from "./planner";
import {
  clearGpuPresentation,
} from "./gpu";
import {
  drawAtmosphereOverlay,
  drawGlowContours,
  drawIsolines,
  getIsolinePath,
} from "./draw-helpers";
import {
  accumulateLegacyField,
  postprocessLegacyField,
} from "./backends/legacy-backend";
import {
  compositeLegacyScene,
  shadeFieldOnCpu,
} from "./presenters/cpu-presenter";
import {
  presentLegacyWithWebGl,
} from "./presenters/webgl-presenter";
import {
  clearWebGpuPresentation,
  renderSignedFieldWithWebGpu,
} from "./webgpu";
import {
  renderCrystalScene,
} from "./crystal-webgpu";

const FRAME_LIMIT_TOLERANCE_MS = 1.25;

function renderField() {
  const frameProfile = beginFrameProfile();
  gpuFieldValidation.frame += 1;

  let profileStart = profileSectionStart(frameProfile);
  const { bands, rms, centroid, isPlaying } = updateModeState();
  profileSectionEnd(frameProfile, "updateModeState", profileStart);

  if (state.visualMode === "crystal") {
    clearGpuPresentation();
    const rendered = renderCrystalScene({
      bands,
      rms,
      centroid,
      isPlaying,
    });
    if (!rendered) {
      clearWebGpuPresentation();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    finishFrameProfile(frameProfile);
    return;
  }

  const frameContext = buildFrameContext({
    bands,
    rms,
    centroid,
    isPlaying,
  });
  const renderPlan = resolveRenderPlan(frameContext);
  const useAnalyticCircleSingle = state.plateShape === "circle" && frameContext.displayMode === "single";
  const effectiveRenderPlan = useAnalyticCircleSingle
    ? {
      backend: "legacy" as const,
      capabilityKey: "legacy:cpu",
      legacyPresenter: "cpu" as const,
      shouldAttemptGpuField: false,
    }
    : renderPlan;
  const {
    prefersLegacyWebGlPresentation,
    spatialAtlas,
    modeRenderState,
    isSingleMode,
    useGlowColor,
  } = frameContext;

  const usedWebGpuMainPath =
    !useAnalyticCircleSingle &&
    renderPlan.backend === "webgpu" &&
    renderSignedFieldWithWebGpu(
      spatialAtlas,
      modeRenderState,
      {
        rms: frameContext.rms,
        centroid: frameContext.centroid,
        contrast: frameContext.contrast,
        coreSharpness: frameContext.coreSharpness,
        haloSharpness: frameContext.haloSharpness,
        lineWeight: frameContext.lineWeight,
        haloWeight: frameContext.haloWeight,
        backgroundWeight: frameContext.backgroundWeight,
        singleAmpGate: frameContext.singleAmpGate,
        separation: frameContext.separation,
        renderAsDormantField: frameContext.renderAsDormantField,
        useGlowColor: frameContext.useGlowColor,
        themePalette: frameContext.themePalette,
        glowColor: frameContext.glowColor,
        isSingleMode: frameContext.isSingleMode,
      },
      {
        frameProfile,
        profileSectionStart,
        profileSectionEnd,
      },
    );
  if (usedWebGpuMainPath) {
    setActiveRenderPath({
      backend: "webgpu",
      capabilityKey: "webgpu",
      legacyPresenter: "cpu",
      shouldAttemptGpuField: true,
    });
    clearGpuPresentation();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    finishFrameProfile(frameProfile);
    return;
  }
  setActiveRenderPath(effectiveRenderPlan);
  clearWebGpuPresentation();

  const legacyFieldState = accumulateLegacyField(frameContext, effectiveRenderPlan, {
    frameProfile,
    profileSectionEnd,
    profileSectionStart,
  });
  postprocessLegacyField(frameContext, legacyFieldState.hasCpuFieldData, {
    frameProfile,
    profileSectionEnd,
    profileSectionStart,
  });

  const directPresentationState =
    prefersLegacyWebGlPresentation && legacyFieldState.didAccumulateOnGpu
      ? presentLegacyWithWebGl(frameContext, {
        frameProfile,
        profileSectionEnd,
        profileSectionStart,
      })
      : {
        displayScale: 1,
        hasCpuFieldData: legacyFieldState.hasCpuFieldData,
        hasCpuGlowAccumulation: legacyFieldState.hasCpuGlowAccumulation,
        useDirectGpuPresentation: false,
      };

  const displayScale = shadeFieldOnCpu(
    frameContext,
    {
      displayScale: directPresentationState.displayScale,
      hasCpuGlowAccumulation: directPresentationState.hasCpuGlowAccumulation,
      useDirectGpuPresentation: directPresentationState.useDirectGpuPresentation,
    },
    {
      frameProfile,
      profileSectionEnd,
      profileSectionStart,
    },
  );

  compositeLegacyScene(
    frameContext,
    {
      displayScale,
      hasCpuFieldData: directPresentationState.hasCpuFieldData,
      useDirectGpuPresentation: directPresentationState.useDirectGpuPresentation,
    },
    {
      drawAtmosphereOverlay,
      drawGlowContours,
      drawIsolines,
      getIsolinePath,
    },
    {
      frameProfile,
      profileSectionEnd,
      profileSectionStart,
    },
  );
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
  if (
    targetFrameMs > 0 &&
    state.lastAnimationTimestamp > 0 &&
    now - state.lastAnimationTimestamp < targetFrameMs - FRAME_LIMIT_TOLERANCE_MS
  ) {
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
