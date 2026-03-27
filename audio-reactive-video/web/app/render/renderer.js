import {
  canvas,
  ctx,
  gpuFieldValidation,
} from "../state/context.js";
import {
  state,
} from "../state/runtime-state.js";
import {
  beginFrameProfile,
  finishFrameProfile,
  profileSectionEnd,
  profileSectionStart,
  updateModeState,
} from "../core/runtime.js";
import {
  buildFrameContext,
} from "./frame-state.js";
import {
  resolveRenderPlan,
  setActiveRenderPath,
} from "./planner.js";
import {
  clearGpuPresentation,
} from "./gpu.js";
import {
  drawAtmosphereOverlay,
  drawGlowContours,
  drawIsolines,
  getIsolinePath,
} from "./draw-helpers.js";
import {
  accumulateLegacyField,
  postprocessLegacyField,
} from "./backends/legacy-backend.js";
import {
  compositeLegacyScene,
  shadeFieldOnCpu,
} from "./presenters/cpu-presenter.js";
import {
  presentLegacyWithWebGl,
} from "./presenters/webgl-presenter.js";
import {
  clearWebGpuPresentation,
  renderSignedFieldWithWebGpu,
} from "./webgpu.js";

function renderField() {
  const frameProfile = beginFrameProfile();
  gpuFieldValidation.frame += 1;

  let profileStart = profileSectionStart(frameProfile);
  const { bands, rms, centroid, isPlaying } = updateModeState();
  profileSectionEnd(frameProfile, "updateModeState", profileStart);

  const frameContext = buildFrameContext({
    bands,
    rms,
    centroid,
    isPlaying,
  });
  const renderPlan = resolveRenderPlan(frameContext);
  const {
    prefersLegacyWebGlPresentation,
    spatialAtlas,
    modeRenderState,
    isSingleMode,
    useGlowColor,
  } = frameContext;

  const usedWebGpuMainPath =
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
      legacyPresenter: "cpu",
    });
    clearGpuPresentation();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    finishFrameProfile(frameProfile);
    return;
  }
  setActiveRenderPath(renderPlan);
  clearWebGpuPresentation();

  const legacyFieldState = accumulateLegacyField(frameContext, renderPlan, {
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
