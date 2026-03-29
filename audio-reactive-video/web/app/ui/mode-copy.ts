import {
  currentTrackNode,
  heroLede,
  heroTitle,
  playbackKicker,
  statusNode,
} from "../state/dom";
import {
  state,
} from "../state/runtime-state";

function getDefaultTrackLabel(): string {
  return state.visualMode === "crystal"
    ? "No source feeding the harmonic membrane"
    : "No track loaded";
}

function getIdleStatusText(): string {
  return state.visualMode === "crystal"
    ? "Load audio to excite the crystal membrane."
    : "Load audio to start the analyser.";
}

function getLoadedStatusText(fileName: string): string {
  return state.visualMode === "crystal"
    ? `Loaded ${fileName}. Press play to wake the crystal membrane.`
    : `Loaded ${fileName}. Press play to drive the field.`;
}

function getRunningStatusText(): string {
  return state.visualMode === "crystal"
    ? "Crystal membrane is resolving harmonic flow in realtime."
    : "Running realtime resonance preview.";
}

function getPausedStatusText(): string {
  return state.visualMode === "crystal"
    ? "Playback paused. Crystal structure is held at the current harmonic state."
    : "Playback paused. Field is frozen at the current state.";
}

function getEndedStatusText(): string {
  return state.visualMode === "crystal"
    ? "Playback ended. Crystal structure is held at the terminal harmonic state."
    : "Playback ended. Field is frozen at the final state.";
}

function getPlayErrorStatusText(): string {
  return state.visualMode === "crystal"
    ? "Unable to start playback. Try loading the source again to re-seed the crystal renderer."
    : "Unable to start playback. Try loading the track again.";
}

function applyModeCopy(): void {
  if (state.visualMode === "crystal") {
    heroTitle.textContent = "Grow sound into a harmonic crystal membrane.";
    heroLede.textContent =
      "This mode treats harmony like internal stress across a luminous crystal skin, letting tonal centers bend, polish, and illuminate a continuous surface.";
    playbackKicker.textContent = "Feed it music with strong pitch content, then watch the membrane settle, tense, and flow.";
  } else {
    heroTitle.textContent = "Shape sound into a living resonance field.";
    heroLede.textContent =
      "Inspired by Chladni figures and resonant plate patterns, this canvas turns audio energy into shifting nodal geometry.";
    playbackKicker.textContent = "Start with a track, then shape the field in real time.";
  }

  if (!state.currentAudioFileName) {
    currentTrackNode.textContent = getDefaultTrackLabel();
    statusNode.textContent = getIdleStatusText();
  }
}

export {
  applyModeCopy,
  getDefaultTrackLabel,
  getEndedStatusText,
  getIdleStatusText,
  getLoadedStatusText,
  getPausedStatusText,
  getPlayErrorStatusText,
  getRunningStatusText,
};
