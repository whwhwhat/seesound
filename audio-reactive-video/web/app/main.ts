import {
  controls,
  numericControls,
  state,
} from "./state/context";
import {
  buildModes,
  syncControlVisibility,
  syncThemeInputs,
  updateModeLabel,
} from "./core/runtime";
import {
  bindEventHandlers,
} from "./ui/events";
import {
  initializeFieldGeometry,
} from "./core/geometry";
import {
  primeWebGpuRenderer,
} from "./render/webgpu";
import {
  requestRender,
} from "./render/renderer";

initializeFieldGeometry();
syncThemeInputs();
state.modeState = buildModes(Math.round(numericControls.modeCount));
controls.singleModeIndex.max = String(Math.round(numericControls.modeCount));
updateModeLabel();
syncControlVisibility();
bindEventHandlers();
window.dispatchEvent(new Event("resize"));
primeWebGpuRenderer().then((ready) => {
  if (ready) {
    requestRender();
  }
});
