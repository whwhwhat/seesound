import {
  audio,
  audioPlayPauseButton,
  audioSeekInput,
  audioTimeNode,
  audioVolumeInput,
  audioVolumeToggleButton,
  audioVolumeWrap,
  currentTrackNode,
  fileInput,
  statusNode,
} from "../state/dom";
import {
  state,
} from "../state/runtime-state";
import {
  ensureAudioGraph,
} from "../core/runtime";
import {
  requestRender,
  startAnimationLoop,
  stopAnimationLoop,
} from "../render/renderer";

let audioPlayerBound = false;
let volumeOpen = false;

function setVolumeOpen(open: boolean) {
  volumeOpen = open;
  audioVolumeWrap.classList.toggle("is-open", open);
  audioVolumeToggleButton.setAttribute("aria-expanded", String(open));
  audioVolumeToggleButton.setAttribute("aria-label", open ? "Hide volume control" : "Show volume control");
  const popover = audioVolumeWrap.querySelector<HTMLElement>(".audio-player__volume-popover");
  if (popover) {
    popover.hidden = !open;
  }
}

function formatPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function syncAudioUi() {
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const progress = duration > 0 ? Math.round((currentTime / duration) * 1000) : 0;
  const volume = Math.min(1, Math.max(0, audio.volume));
  audioSeekInput.value = String(progress);
  audioSeekInput.style.setProperty("--seek-fill", `${(progress / 10).toFixed(3)}%`);
  audioTimeNode.textContent = `${formatPlaybackTime(currentTime)} / ${formatPlaybackTime(duration)}`;
  audioVolumeInput.value = String(Math.round(volume * 100));
  audioVolumeInput.style.setProperty("--seek-fill", `${(volume * 100).toFixed(3)}%`);
  const isPlaying = !audio.paused && !audio.ended;
  const volumeLevel = volume <= 0.001
    ? "mute"
    : volume < 0.34
      ? "low"
      : volume < 0.67
        ? "mid"
        : "high";
  audioPlayPauseButton.classList.toggle("is-playing", isPlaying);
  audioPlayPauseButton.setAttribute("aria-label", isPlaying ? "Pause audio" : "Play audio");
  audioVolumeToggleButton.dataset.volumeLevel = volumeLevel;
}

function bindAudioPlayer() {
  if (audioPlayerBound) {
    return;
  }
  audioPlayerBound = true;

  audioPlayPauseButton.addEventListener("click", async () => {
    if (!audio.src) {
      fileInput.click();
      return;
    }
    if (audio.paused || audio.ended) {
      try {
        await audio.play();
      } catch {
        statusNode.textContent = "Unable to start playback. Try loading the track again.";
      }
      return;
    }
    audio.pause();
  });

  audioVolumeToggleButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setVolumeOpen(!volumeOpen);
  });

  fileInput.addEventListener("change", () => {
    const [file] = fileInput.files || [];
    if (!file) {
      return;
    }
    ensureAudioGraph();
    if (state.currentAudioObjectUrl) {
      URL.revokeObjectURL(state.currentAudioObjectUrl);
    }
    state.currentAudioObjectUrl = URL.createObjectURL(file);
    state.currentAudioFileName = file.name;
    audio.src = state.currentAudioObjectUrl;
    audio.load();
    currentTrackNode.textContent = state.currentAudioFileName;
    statusNode.textContent = `Loaded ${file.name}. Press play to drive the field.`;
    syncAudioUi();
    requestRender();
  });

  const seekAudio = () => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      syncAudioUi();
      return;
    }
    audio.currentTime = (Number.parseFloat(audioSeekInput.value) / 1000) * audio.duration;
    syncAudioUi();
    requestRender();
  };

  audioSeekInput.addEventListener("input", seekAudio);
  audioSeekInput.addEventListener("change", seekAudio);

  const setVolume = () => {
    audio.volume = Math.min(1, Math.max(0, Number.parseFloat(audioVolumeInput.value) / 100));
    syncAudioUi();
  };

  audioVolumeInput.addEventListener("input", setVolume);
  audioVolumeInput.addEventListener("change", setVolume);

  audioVolumeWrap.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", () => {
    if (volumeOpen) {
      setVolumeOpen(false);
    }
  });

  audio.addEventListener("play", async () => {
    ensureAudioGraph();
    if (state.audioContext) {
      await state.audioContext.resume();
    }
    statusNode.textContent = "Running realtime resonance preview.";
    syncAudioUi();
    startAnimationLoop();
  });

  audio.addEventListener("pause", () => {
    statusNode.textContent = "Playback paused. Field is frozen at the current state.";
    syncAudioUi();
    stopAnimationLoop();
    requestRender();
  });

  audio.addEventListener("ended", () => {
    statusNode.textContent = "Playback ended. Field is frozen at the final state.";
    syncAudioUi();
    stopAnimationLoop();
    requestRender();
  });

  audio.addEventListener("loadedmetadata", syncAudioUi);
  audio.addEventListener("timeupdate", syncAudioUi);
  audio.addEventListener("durationchange", syncAudioUi);
  audio.addEventListener("emptied", syncAudioUi);
  setVolumeOpen(false);
  syncAudioUi();
}

export {
  bindAudioPlayer,
};
