import {
  controls,
  numericControls,
  state,
} from "./state/context.js";
import {
  buildModes,
  syncControlVisibility,
  syncThemeInputs,
  updateModeLabel,
} from "./core/runtime.js";
import {
  bindEventHandlers,
} from "./ui/events.js";
import {
  initializeFieldGeometry,
} from "./core/geometry.js";

initializeFieldGeometry();
syncThemeInputs();
state.modeState = buildModes(Math.round(numericControls.modeCount));
controls.singleModeIndex.max = String(Math.round(numericControls.modeCount));
updateModeLabel();
syncControlVisibility();
bindEventHandlers();
window.dispatchEvent(new Event("resize"));
