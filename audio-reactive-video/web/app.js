import {
  controls,
  numericControls,
  state,
} from "./app-context.js";
import {
  buildModes,
  syncControlVisibility,
  syncThemeInputs,
  updateModeLabel,
} from "./app-core.js";
import {
  bindEventHandlers,
} from "./app-events.js";
import {
  initializeFieldGeometry,
  rebuildPlateUnderlayCanvases,
} from "./app-geometry.js";

initializeFieldGeometry();
rebuildPlateUnderlayCanvases();
syncThemeInputs();
state.modeState = buildModes(Math.round(numericControls.modeCount));
controls.singleModeIndex.max = String(Math.round(numericControls.modeCount));
updateModeLabel();
syncControlVisibility();
bindEventHandlers();
window.dispatchEvent(new Event("resize"));
