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
  if (state.visualMode === "crystal") {
    return "No source feeding the harmonic membrane";
  }
  if (state.visualMode === "lattice") {
    return "No source driving the spatial lattice";
  }
  return "No track loaded";
}

function getIdleStatusText(): string {
  if (state.visualMode === "crystal") {
    return "Load audio, capture a browser tab, or connect the desktop companion to excite the crystal membrane.";
  }
  if (state.visualMode === "lattice") {
    return "Load audio, capture a browser tab, or connect the desktop companion to energize the lattice projection.";
  }
  return "Load audio, capture a browser tab, or connect the desktop companion to start the analyser.";
}

function getLoadedStatusText(fileName: string): string {
  if (state.visualMode === "crystal") {
    return `Loaded ${fileName}. Press play to wake the crystal membrane.`;
  }
  if (state.visualMode === "lattice") {
    return `Loaded ${fileName}. Press play to fold the lattice in motion.`;
  }
  return `Loaded ${fileName}. Press play to drive the field.`;
}

function getRunningStatusText(): string {
  if (state.visualMode === "crystal") {
    return "Crystal membrane is resolving harmonic flow in realtime.";
  }
  if (state.visualMode === "lattice") {
    return "Lattice projection is folding and pulsing in realtime.";
  }
  return "Running realtime resonance preview.";
}

function getPausedStatusText(): string {
  if (state.visualMode === "crystal") {
    return "Playback paused. Crystal structure is held at the current harmonic state.";
  }
  if (state.visualMode === "lattice") {
    return "Playback paused. Lattice structure is held at the current folded state.";
  }
  return "Playback paused. Field is frozen at the current state.";
}

function getEndedStatusText(): string {
  if (state.visualMode === "crystal") {
    return "Playback ended. Crystal structure is held at the terminal harmonic state.";
  }
  if (state.visualMode === "lattice") {
    return "Playback ended. Lattice structure is held at the final folded state.";
  }
  return "Playback ended. Field is frozen at the final state.";
}

function getPlayErrorStatusText(): string {
  if (state.visualMode === "crystal") {
    return "Unable to start playback. Try loading the source again to re-seed the crystal renderer.";
  }
  if (state.visualMode === "lattice") {
    return "Unable to start playback. Try loading the source again to re-seed the lattice renderer.";
  }
  return "Unable to start playback. Try loading the track again.";
}

function applyModeCopy(): void {
  if (state.visualMode === "crystal") {
    heroTitle.textContent = "Grow sound into a harmonic crystal membrane.";
    heroLede.textContent =
      "This mode treats harmony like internal stress across a luminous crystal skin, letting tonal centers bend, polish, and illuminate a continuous surface.";
    playbackKicker.textContent = "Feed it music with strong pitch content, then watch the membrane settle, tense, and flow.";
  } else if (state.visualMode === "lattice") {
    heroTitle.textContent = "Fold sound through a projected spatial lattice.";
    heroLede.textContent =
      "This mode treats the mix like a moving wireframe volume, letting rhythm, density, and brightness bend a tesseract-like scaffold in realtime.";
    playbackKicker.textContent = "Use it to judge whether the structural, hypercube-inspired direction feels promising.";
  } else {
    heroTitle.textContent = "Shape sound into a living resonance field.";
    heroLede.textContent =
      "Inspired by Chladni figures and resonant plate patterns, this canvas turns audio energy into shifting nodal geometry.";
    playbackKicker.textContent = "Start with a track, then shape the field in real time.";
  }

  if (!state.currentAudioFileName && state.activeAudioSource !== "capture" && state.activeAudioSource !== "desktop") {
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
