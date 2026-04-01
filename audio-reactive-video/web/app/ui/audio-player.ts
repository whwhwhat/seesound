import {
  audio,
  audioCaptureToggleButton,
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
  connectAudioElementSource,
  connectCaptureStream,
  ensureAudioGraph,
  setActiveAudioInput,
  stopCaptureStream,
} from "../core/runtime";
import {
  getDefaultTrackLabel,
  getEndedStatusText,
  getIdleStatusText,
  getLoadedStatusText,
  getPausedStatusText,
  getPlayErrorStatusText,
  getRunningStatusText,
} from "./mode-copy";
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

function isCaptureMode(): boolean {
  return state.activeAudioSource === "capture";
}

function updateCaptureButtonUi(): void {
  const captureLive = isCaptureMode() && state.isAudioInputActive;
  audioCaptureToggleButton.classList.toggle("is-live", captureLive);
  audioCaptureToggleButton.textContent = captureLive ? "Stop" : "Tab";
  audioCaptureToggleButton.setAttribute("aria-label", captureLive ? "Stop browser tab capture" : "Capture browser tab audio");
}

function syncAudioUi() {
  const captureMode = isCaptureMode();
  const duration = captureMode ? 0 : Number.isFinite(audio.duration) ? audio.duration : 0;
  const currentTime = captureMode ? 0 : Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const progress = duration > 0 ? Math.round((currentTime / duration) * 1000) : 0;
  const volume = Math.min(1, Math.max(0, audio.volume));
  const isPlaying = captureMode ? state.isAudioInputActive : !audio.paused && !audio.ended;
  const volumeLevel = volume <= 0.001
    ? "mute"
    : volume < 0.34
      ? "low"
      : volume < 0.67
        ? "mid"
        : "high";

  audioSeekInput.disabled = captureMode || !Number.isFinite(audio.duration) || audio.duration <= 0;
  audioSeekInput.value = String(progress);
  audioSeekInput.style.setProperty("--seek-fill", `${(progress / 10).toFixed(3)}%`);
  audioTimeNode.textContent = captureMode ? "LIVE" : `${formatPlaybackTime(currentTime)} / ${formatPlaybackTime(duration)}`;
  audioVolumeInput.value = String(Math.round(volume * 100));
  audioVolumeInput.style.setProperty("--seek-fill", `${(volume * 100).toFixed(3)}%`);
  audioPlayPauseButton.classList.toggle("is-playing", isPlaying);
  audioPlayPauseButton.setAttribute("aria-label", captureMode ? "Stop captured tab audio" : isPlaying ? "Pause audio" : "Play audio");
  audioVolumeToggleButton.dataset.volumeLevel = volumeLevel;
  updateCaptureButtonUi();
}

function handleCaptureEnded(): void {
  stopCaptureStream();
  if (state.currentAudioObjectUrl) {
    currentTrackNode.textContent = state.currentAudioFileName ?? getDefaultTrackLabel();
    statusNode.textContent = state.currentAudioFileName ? getLoadedStatusText(state.currentAudioFileName) : getIdleStatusText();
  } else {
    currentTrackNode.textContent = getDefaultTrackLabel();
    statusNode.textContent = getIdleStatusText();
  }
  stopAnimationLoop();
  syncAudioUi();
  requestRender();
}

async function startTabCapture(): Promise<void> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    statusNode.textContent = "This browser cannot capture tab audio. Try a recent Chromium-based browser.";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    const [audioTrack] = stream.getAudioTracks();
    if (!audioTrack) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      statusNode.textContent = "No tab audio was shared. Choose a browser tab and enable audio sharing.";
      return;
    }

    stopCaptureStream();
    audio.pause();
    setActiveAudioInput(null);
    connectCaptureStream(stream);
    audioTrack.addEventListener("ended", handleCaptureEnded, { once: true });
    if (state.audioContext) {
      await state.audioContext.resume();
    }
    const captureLabel = audioTrack.label || "Shared browser tab audio";
    currentTrackNode.textContent = captureLabel;
    statusNode.textContent = "Captured tab audio is driving the field in realtime.";
    startAnimationLoop();
    syncAudioUi();
    requestRender();
  } catch {
    statusNode.textContent = "Tab capture was cancelled or blocked before audio could start.";
    syncAudioUi();
  }
}

function bindAudioPlayer() {
  if (audioPlayerBound) {
    return;
  }
  audioPlayerBound = true;

  audioPlayPauseButton.addEventListener("click", async () => {
    if (isCaptureMode()) {
      handleCaptureEnded();
      return;
    }
    if (!audio.src) {
      fileInput.click();
      return;
    }
    if (audio.paused || audio.ended) {
      try {
        connectAudioElementSource();
        await audio.play();
      } catch {
        statusNode.textContent = getPlayErrorStatusText();
      }
      return;
    }
    audio.pause();
  });

  audioCaptureToggleButton.addEventListener("click", async () => {
    if (isCaptureMode()) {
      handleCaptureEnded();
      return;
    }
    await startTabCapture();
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
    stopCaptureStream();
    setActiveAudioInput(null);
    if (state.currentAudioObjectUrl) {
      URL.revokeObjectURL(state.currentAudioObjectUrl);
    }
    state.currentAudioObjectUrl = URL.createObjectURL(file);
    state.currentAudioFileName = file.name;
    audio.src = state.currentAudioObjectUrl;
    audio.load();
    currentTrackNode.textContent = state.currentAudioFileName;
    statusNode.textContent = getLoadedStatusText(file.name);
    syncAudioUi();
    requestRender();
  });

  const seekAudio = () => {
    if (isCaptureMode() || !Number.isFinite(audio.duration) || audio.duration <= 0) {
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
    connectAudioElementSource();
    if (state.audioContext) {
      await state.audioContext.resume();
    }
    statusNode.textContent = getRunningStatusText();
    syncAudioUi();
    startAnimationLoop();
  });

  audio.addEventListener("pause", () => {
    if (isCaptureMode()) {
      return;
    }
    setActiveAudioInput(null);
    statusNode.textContent = getPausedStatusText();
    syncAudioUi();
    stopAnimationLoop();
    requestRender();
  });

  audio.addEventListener("ended", () => {
    if (isCaptureMode()) {
      return;
    }
    setActiveAudioInput(null);
    statusNode.textContent = getEndedStatusText();
    syncAudioUi();
    stopAnimationLoop();
    requestRender();
  });

  audio.addEventListener("loadedmetadata", syncAudioUi);
  audio.addEventListener("timeupdate", syncAudioUi);
  audio.addEventListener("durationchange", syncAudioUi);
  audio.addEventListener("emptied", () => {
    if (isCaptureMode()) {
      return;
    }
    currentTrackNode.textContent = getDefaultTrackLabel();
    statusNode.textContent = getIdleStatusText();
    syncAudioUi();
  });

  setVolumeOpen(false);
  syncAudioUi();
}

export {
  bindAudioPlayer,
};
