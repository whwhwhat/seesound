import {
  audio,
  audioCapturePanel,
  audioCaptureToggleButton,
  audioDesktopHint,
  audioDesktopPanel,
  audioDesktopToggleButton,
  audioFilePanel,
  audioInputModeSelect,
  audioInputModeValue,
  audioMeta,
  audioPlayerCard,
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
import type {
  AudioInputSource,
} from "../types";
import {
  state,
} from "../state/runtime-state";
import {
  connectAudioElementSource,
  connectCaptureStream,
  ensureDesktopPcmBridge,
  ensureAudioGraph,
  pushDesktopPcmChunk,
  setActiveAudioInput,
  stopCaptureStream,
  stopDesktopAudioInput,
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
let selectedInputMode: AudioInputSource = "file";
let desktopSocket: WebSocket | null = null;

const DESKTOP_BRIDGE_HTTP_URL = "http://127.0.0.1:43821";
const DESKTOP_BRIDGE_WS_URL = "ws://127.0.0.1:43822";

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

function isDesktopMode(): boolean {
  return state.activeAudioSource === "desktop";
}

function isLiveMode(): boolean {
  return isCaptureMode() || isDesktopMode();
}

function syncInputModeUi(): void {
  const fileMode = selectedInputMode === "file";
  const captureMode = selectedInputMode === "capture";
  const desktopMode = selectedInputMode === "desktop";
  audioPlayerCard.hidden = !fileMode;
  audioMeta.hidden = !fileMode;
  audioFilePanel.hidden = !fileMode;
  audioCapturePanel.hidden = !captureMode;
  audioDesktopPanel.hidden = !desktopMode;
  audioInputModeSelect.value = selectedInputMode;
  audioInputModeValue.textContent = audioInputModeSelect.selectedOptions[0]?.textContent ?? "";
}

function restoreIdleSourceState(): void {
  if (state.currentAudioObjectUrl) {
    currentTrackNode.textContent = state.currentAudioFileName ?? getDefaultTrackLabel();
    statusNode.textContent = state.currentAudioFileName ? getLoadedStatusText(state.currentAudioFileName) : getIdleStatusText();
    return;
  }
  currentTrackNode.textContent = getDefaultTrackLabel();
  statusNode.textContent = getIdleStatusText();
}

function updateCaptureButtonUi(): void {
  const captureLive = isCaptureMode() && state.isAudioInputActive;
  audioCaptureToggleButton.classList.toggle("is-live", captureLive);
  audioCaptureToggleButton.textContent = captureLive ? "Stop Browser Tab Capture" : "Capture Browser Tab Audio";
  audioCaptureToggleButton.setAttribute("aria-label", captureLive ? "Stop browser tab capture" : "Capture browser tab audio");
}

function updateDesktopButtonUi(): void {
  const desktopLive = isDesktopMode() && state.isAudioInputActive;
  audioDesktopToggleButton.classList.toggle("is-live", desktopLive);
  audioDesktopToggleButton.textContent = desktopLive ? "Stop Desktop Audio" : "Start Desktop Audio";
  audioDesktopToggleButton.setAttribute("aria-label", desktopLive ? "Stop desktop audio capture" : "Start desktop audio capture");
}

function syncAudioUi() {
  const liveMode = isLiveMode();
  const duration = liveMode ? 0 : Number.isFinite(audio.duration) ? audio.duration : 0;
  const currentTime = liveMode ? 0 : Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const progress = duration > 0 ? Math.round((currentTime / duration) * 1000) : 0;
  const volume = Math.min(1, Math.max(0, audio.volume));
  const isPlaying = liveMode ? state.isAudioInputActive : !audio.paused && !audio.ended;
  const volumeLevel = volume <= 0.001
    ? "mute"
    : volume < 0.34
      ? "low"
      : volume < 0.67
        ? "mid"
        : "high";

  audioPlayPauseButton.disabled = liveMode;
  audioSeekInput.disabled = liveMode || !Number.isFinite(audio.duration) || audio.duration <= 0;
  audioVolumeToggleButton.disabled = liveMode;
  audioVolumeInput.disabled = liveMode;
  fileInput.disabled = liveMode;
  audioVolumeWrap.classList.toggle("is-disabled", liveMode);
  audio.closest(".audio-player")?.classList.toggle("is-readonly", liveMode);
  if (liveMode && volumeOpen) {
    setVolumeOpen(false);
  }
  audioSeekInput.value = String(progress);
  audioSeekInput.style.setProperty("--seek-fill", `${(progress / 10).toFixed(3)}%`);
  audioTimeNode.textContent = liveMode ? "LIVE" : `${formatPlaybackTime(currentTime)} / ${formatPlaybackTime(duration)}`;
  audioVolumeInput.value = String(Math.round(volume * 100));
  audioVolumeInput.style.setProperty("--seek-fill", `${(volume * 100).toFixed(3)}%`);
  audioPlayPauseButton.classList.toggle("is-playing", isPlaying);
  audioPlayPauseButton.setAttribute("aria-label", isPlaying ? "Pause audio" : "Play audio");
  audioVolumeToggleButton.dataset.volumeLevel = volumeLevel;
  updateCaptureButtonUi();
  updateDesktopButtonUi();
}

function stopDesktopBridgeCapture(options: { remote: boolean }): void {
  closeDesktopSocket();
  stopDesktopAudioInput();
  if (options.remote) {
    void postDesktopBridge("/capture/stop");
  }
  restoreIdleSourceState();
  stopAnimationLoop();
  syncAudioUi();
  requestRender();
}

function setSelectedInputMode(mode: AudioInputSource): void {
  if (selectedInputMode === mode) {
    syncInputModeUi();
    return;
  }

  if (mode === "capture" || mode === "desktop") {
    if (!audio.paused && !audio.ended) {
      audio.pause();
    } else if (state.activeAudioSource === "file") {
      setActiveAudioInput(null);
      stopAnimationLoop();
      requestRender();
    }
  } else if (state.activeAudioSource === "capture") {
    stopCaptureStream();
    stopAnimationLoop();
    restoreIdleSourceState();
    requestRender();
  } else if (state.activeAudioSource === "desktop") {
    stopDesktopBridgeCapture({ remote: false });
  }

  selectedInputMode = mode;
  syncInputModeUi();
  syncAudioUi();
}

function handleCaptureEnded(): void {
  stopCaptureStream();
  restoreIdleSourceState();
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

    closeDesktopSocket();
    stopDesktopAudioInput();
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

async function postDesktopBridge(path: string): Promise<Response | null> {
  try {
    return await fetch(`${DESKTOP_BRIDGE_HTTP_URL}${path}`, {
      method: "POST",
      mode: "cors",
    });
  } catch {
    return null;
  }
}

function closeDesktopSocket(): void {
  if (!desktopSocket) {
    return;
  }
  desktopSocket.onopen = null;
  desktopSocket.onmessage = null;
  desktopSocket.onerror = null;
  desktopSocket.onclose = null;
  if (desktopSocket.readyState === WebSocket.OPEN || desktopSocket.readyState === WebSocket.CONNECTING) {
    desktopSocket.close();
  }
  desktopSocket = null;
}

function openDesktopSocket(): void {
  closeDesktopSocket();
  const socket = new WebSocket(DESKTOP_BRIDGE_WS_URL);
  socket.binaryType = "arraybuffer";

  socket.onopen = () => {
    currentTrackNode.textContent = "macOS system output";
    audioDesktopHint.textContent = "Desktop companion websocket is streaming PCM directly into the browser analyser.";
    statusNode.textContent = "Desktop companion is driving the field in realtime.";
    syncAudioUi();
  };

  socket.onmessage = (event) => {
    if (!(event.data instanceof ArrayBuffer)) {
      return;
    }
    void pushDesktopPcmChunk(new Float32Array(event.data), {
      isPlaying: true,
      sampleRate: 48_000,
    }).then(() => {
      currentTrackNode.textContent = "macOS system output";
      audioDesktopHint.textContent = "Desktop companion websocket is streaming PCM directly into the browser analyser.";
      statusNode.textContent = "Desktop companion is driving the field in realtime.";
      syncAudioUi();
      startAnimationLoop();
      requestRender();
    });
  };

  socket.onerror = () => {
    audioDesktopHint.textContent = "Desktop companion websocket could not connect. Make sure the menu bar app is running.";
    statusNode.textContent = "Desktop PCM websocket is offline.";
    syncAudioUi();
  };

  socket.onclose = () => {
    if (desktopSocket !== socket) {
      return;
    }
    desktopSocket = null;
    if (selectedInputMode === "desktop") {
      stopDesktopAudioInput();
      audioDesktopHint.textContent = "Desktop companion websocket closed. Restart capture from the menu bar app if needed.";
      statusNode.textContent = "Desktop companion connection closed.";
      syncAudioUi();
      stopAnimationLoop();
      requestRender();
    }
  };

  desktopSocket = socket;
}

async function startDesktopBridgeCapture(): Promise<void> {
  setSelectedInputMode("desktop");
  ensureAudioGraph();
  if (state.audioContext) {
    await state.audioContext.resume();
  }
  const workletNode = await ensureDesktopPcmBridge();
  if (!workletNode) {
    audioDesktopHint.textContent = "This browser cannot attach the desktop PCM bridge. Try a current Chromium-based browser on localhost.";
    statusNode.textContent = "AudioWorklet is unavailable for desktop companion input.";
    syncAudioUi();
    return;
  }
  workletNode.port.postMessage({ type: "reset" });
  openDesktopSocket();
  const response = await postDesktopBridge("/capture/start");
  if (!response) {
    closeDesktopSocket();
    audioDesktopHint.textContent = "SeeSound Companion is not running. Start the menu bar app first.";
    statusNode.textContent = "Unable to reach the desktop companion on localhost.";
    syncAudioUi();
    return;
  }

  if (!response.ok) {
    closeDesktopSocket();
    audioDesktopHint.textContent = "Desktop companion is running but could not start capture. Check the menu bar app for permission details.";
    statusNode.textContent = "Desktop companion rejected the capture request.";
    syncAudioUi();
    return;
  }

  audioDesktopHint.textContent = "Desktop companion is starting system audio capture.";
  statusNode.textContent = "Connecting to desktop companion…";
  syncAudioUi();
}

function bindAudioPlayer() {
  if (audioPlayerBound) {
    return;
  }
  audioPlayerBound = true;

  const initialMode = audioInputModeSelect.value;
  if (initialMode === "file" || initialMode === "capture" || initialMode === "desktop") {
    selectedInputMode = initialMode;
  }

  audioPlayPauseButton.addEventListener("click", async () => {
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
    setSelectedInputMode("capture");
    await startTabCapture();
  });

  audioDesktopToggleButton.addEventListener("click", async () => {
    if (isDesktopMode()) {
      stopDesktopBridgeCapture({ remote: true });
      return;
    }
    await startDesktopBridgeCapture();
  });

  audioInputModeSelect.addEventListener("input", () => {
    const mode = audioInputModeSelect.value;
    if (mode === "file" || mode === "capture" || mode === "desktop") {
      setSelectedInputMode(mode);
    }
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
    selectedInputMode = "file";
    syncInputModeUi();
    closeDesktopSocket();
    stopDesktopAudioInput();
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
    if (isLiveMode() || !Number.isFinite(audio.duration) || audio.duration <= 0) {
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
    if (isLiveMode()) {
      return;
    }
    setActiveAudioInput(null);
    statusNode.textContent = getPausedStatusText();
    syncAudioUi();
    stopAnimationLoop();
    requestRender();
  });

  audio.addEventListener("ended", () => {
    if (isLiveMode()) {
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
    if (isLiveMode()) {
      return;
    }
    currentTrackNode.textContent = getDefaultTrackLabel();
    statusNode.textContent = getIdleStatusText();
    syncAudioUi();
  });

  setVolumeOpen(false);
  syncInputModeUi();
  syncAudioUi();
}

export {
  bindAudioPlayer,
};
