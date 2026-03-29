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
  bindAudioPlayer,
} from "./ui/audio-player";
import {
  applyModeCopy,
} from "./ui/mode-copy";
import {
  bindColorPicker,
} from "./ui/color-picker";
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
  primeCrystalRenderer,
} from "./render/crystal-webgpu";
import {
  requestRender,
} from "./render/renderer";

initializeFieldGeometry();
syncThemeInputs();
state.modeState = buildModes(Math.round(numericControls.modeCount));
controls.singleModeIndex.max = String(Math.round(numericControls.modeCount));
updateModeLabel();
syncControlVisibility();
applyModeCopy();
bindAudioPlayer();
bindColorPicker();
bindEventHandlers();
window.dispatchEvent(new Event("resize"));
void primeCrystalRenderer();
primeWebGpuRenderer().then((ready) => {
  if (ready) {
    requestRender();
  }
});
