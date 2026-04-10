import {
  audio,
  canvas,
  glCanvas,
  state,
  statusNode,
  wgpuCanvas,
} from "./state/context";

const EXPORT_WIDTH = 1920;
const EXPORT_HEIGHT = 1080;
const EXPORT_STAGE_SIZE = 1080;
const EXPORT_FPS = 60;
const EXPORT_AUDIO_BITS_PER_SECOND = 320_000;

type RecorderState = {
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  renderCanvas: HTMLCanvasElement;
  renderContext: CanvasRenderingContext2D;
  toggleButton: HTMLButtonElement | null;
  statusNode: HTMLElement | null;
  stateNode: HTMLElement | null;
  exportAudioElement: HTMLAudioElement | null;
  exportAudioContext: AudioContext | null;
  exportAudioSourceNode: MediaElementAudioSourceNode | null;
  exportAudioDestination: MediaStreamAudioDestinationNode | null;
  isArmed: boolean;
};

const exportCanvas = document.createElement("canvas");
exportCanvas.width = EXPORT_WIDTH;
exportCanvas.height = EXPORT_HEIGHT;

const exportContext = exportCanvas.getContext("2d");
if (!exportContext) {
  throw new Error("Unable to create export canvas context.");
}

const recorderState: RecorderState = {
  stream: null,
  recorder: null,
  chunks: [],
  renderCanvas: exportCanvas,
  renderContext: exportContext,
  toggleButton: null,
  statusNode: null,
  stateNode: null,
  exportAudioElement: null,
  exportAudioContext: null,
  exportAudioSourceNode: null,
  exportAudioDestination: null,
  isArmed: false,
};

function hasLoadedFileSource(): boolean {
  return Boolean(state.currentAudioObjectUrl || audio.src);
}

function getExportStatusNode(): HTMLElement | null {
  if (recorderState.statusNode) {
    return recorderState.statusNode;
  }
  recorderState.statusNode = document.getElementById("exportStatus");
  return recorderState.statusNode;
}

function getExportStateNode(): HTMLElement | null {
  if (recorderState.stateNode) {
    return recorderState.stateNode;
  }
  recorderState.stateNode = document.getElementById("exportState");
  return recorderState.stateNode;
}

function getExportToggleButton(): HTMLButtonElement | null {
  if (recorderState.toggleButton) {
    return recorderState.toggleButton;
  }
  recorderState.toggleButton = document.getElementById("exportToggle") as HTMLButtonElement | null;
  return recorderState.toggleButton;
}

function setExportStatus(message: string): void {
  const node = getExportStatusNode();
  if (node) {
    node.textContent = message;
  }
}

function setExportStateLabel(message: string): void {
  const node = getExportStateNode();
  if (node) {
    node.textContent = message;
  }
}

function updateExportButtonUi(isRecording: boolean): void {
  const button = getExportToggleButton();
  if (!button) {
    return;
  }
  const fileModeReady = hasLoadedFileSource();
  button.classList.toggle("is-live", isRecording);
  button.classList.toggle("is-armed", recorderState.isArmed && !isRecording);
  button.setAttribute("aria-checked", String(isRecording || recorderState.isArmed));
  button.disabled = !isRecording && !recorderState.isArmed && !fileModeReady;
}

function getVisibleStageCanvas(): HTMLCanvasElement {
  if (wgpuCanvas.classList.contains("is-visible")) {
    return wgpuCanvas;
  }
  if (glCanvas.classList.contains("is-visible")) {
    return glCanvas;
  }
  return canvas;
}

function drawExportBackdrop(context: CanvasRenderingContext2D): void {
  context.fillStyle = "#000000";
  context.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
}

function syncExportFrame(): void {
  if (!recorderState.recorder) {
    return;
  }

  const context = recorderState.renderContext;
  const stageCanvas = getVisibleStageCanvas();
  const stageX = Math.round((EXPORT_WIDTH - EXPORT_STAGE_SIZE) / 2);
  const stageY = Math.round((EXPORT_HEIGHT - EXPORT_STAGE_SIZE) / 2);

  drawExportBackdrop(context);
  context.drawImage(stageCanvas, stageX, stageY, EXPORT_STAGE_SIZE, EXPORT_STAGE_SIZE);
}

function getBestMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  const supported = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  return supported ?? "video/webm";
}

async function prepareExportAudioTrack(): Promise<MediaStreamTrack | null> {
  if (!hasLoadedFileSource() || !audio.src) {
    return null;
  }

  if (recorderState.exportAudioDestination) {
    return recorderState.exportAudioDestination.stream.getAudioTracks()[0] ?? null;
  }

  const exportAudioElement = document.createElement("audio");
  exportAudioElement.preload = "auto";
  exportAudioElement.src = audio.currentSrc || audio.src;
  exportAudioElement.crossOrigin = audio.crossOrigin;
  exportAudioElement.currentTime = audio.currentTime;
  exportAudioElement.playbackRate = audio.playbackRate;
  exportAudioElement.defaultPlaybackRate = audio.defaultPlaybackRate;
  exportAudioElement.volume = 1;

  const exportAudioContext = new AudioContext();
  const exportAudioSourceNode = exportAudioContext.createMediaElementSource(exportAudioElement);
  const exportAudioDestination = exportAudioContext.createMediaStreamDestination();
  exportAudioSourceNode.connect(exportAudioDestination);

  recorderState.exportAudioElement = exportAudioElement;
  recorderState.exportAudioContext = exportAudioContext;
  recorderState.exportAudioSourceNode = exportAudioSourceNode;
  recorderState.exportAudioDestination = exportAudioDestination;

  await exportAudioContext.resume();
  await exportAudioElement.play();
  return exportAudioDestination.stream.getAudioTracks()[0] ?? null;
}

async function syncExportAudioPlayback(): Promise<void> {
  const exportAudioElement = recorderState.exportAudioElement;
  if (!exportAudioElement) {
    return;
  }

  const timeDelta = Math.abs(exportAudioElement.currentTime - audio.currentTime);
  if (timeDelta > 0.05) {
    exportAudioElement.currentTime = audio.currentTime;
  }

  if (audio.paused || audio.ended) {
    exportAudioElement.pause();
    return;
  }

  exportAudioElement.playbackRate = audio.playbackRate;
  if (exportAudioElement.paused) {
    await exportAudioElement.play();
  }
}

function sanitizeFileStem(value: string): string {
  return value
    .replace(/\.[^./]+$/, "")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "seesound-export";
}

function buildDownloadName(): string {
  const trackStem = sanitizeFileStem(state.currentAudioFileName ?? "seesound-export");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${trackStem}-${timestamp}.webm`;
}

function downloadRecording(blob: Blob): void {
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = buildDownloadName();
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 1000);
}

function cleanupRecorder(): void {
  recorderState.stream?.getTracks().forEach((track) => {
    track.stop();
  });
  recorderState.exportAudioElement?.pause();
  recorderState.exportAudioElement?.removeAttribute("src");
  recorderState.exportAudioElement?.load();
  recorderState.exportAudioSourceNode?.disconnect();
  recorderState.exportAudioDestination?.disconnect();
  void recorderState.exportAudioContext?.close();
  recorderState.stream = null;
  recorderState.recorder = null;
  recorderState.chunks = [];
  recorderState.exportAudioElement = null;
  recorderState.exportAudioContext = null;
  recorderState.exportAudioSourceNode = null;
  recorderState.exportAudioDestination = null;
  updateExportButtonUi(false);
}

function disarmExportRecording(): void {
  recorderState.isArmed = false;
  updateExportButtonUi(false);
}

async function startExportRecording(): Promise<void> {
  if (recorderState.recorder) {
    return;
  }
  if (!hasLoadedFileSource()) {
    setExportStatus("Export is available only in File mode after a song has been loaded.");
    updateExportButtonUi(false);
    return;
  }
  if (!("MediaRecorder" in window) || !("captureStream" in HTMLCanvasElement.prototype)) {
    setExportStatus("This browser cannot record canvas video. Try a current Chromium-based browser.");
    return;
  }

  syncExportFrame();
  const stream = exportCanvas.captureStream(EXPORT_FPS);
  const audioTrack = await prepareExportAudioTrack();
  if (audioTrack) {
    stream.addTrack(audioTrack);
  }

  const recorder = new MediaRecorder(stream, {
    mimeType: getBestMimeType(),
    videoBitsPerSecond: 16_000_000,
    audioBitsPerSecond: audioTrack ? EXPORT_AUDIO_BITS_PER_SECOND : undefined,
  });

  recorderState.stream = stream;
  recorderState.recorder = recorder;
  recorderState.chunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recorderState.chunks.push(event.data);
    }
  };

  recorder.onstop = () => {
    const blob = new Blob(recorderState.chunks, { type: recorder.mimeType || "video/webm" });
    cleanupRecorder();
    downloadRecording(blob);
    setExportStateLabel("Saved");
    setExportStatus("Recording saved as WebM. Auto record is now idle and ready for the next playback.");
    statusNode.textContent = "Recording finished and downloaded.";
  };

  recorder.onerror = () => {
    cleanupRecorder();
    setExportStateLabel("Error");
    setExportStatus("Recording failed before export could finish.");
    statusNode.textContent = "Recording failed.";
  };

  recorder.start(1000);
  recorderState.isArmed = false;
  updateExportButtonUi(true);
  setExportStateLabel("Recording...");
  setExportStatus("Auto record is active. Exporting 1920 x 1080 video with the stage centered and song audio included.");
  statusNode.textContent = "Recording export video…";
}

function stopExportRecording(): void {
  if (!recorderState.recorder) {
    return;
  }
  recorderState.recorder.stop();
}

function isExportRecording(): boolean {
  return Boolean(recorderState.recorder);
}

function bindExportRecorder(): void {
  const button = getExportToggleButton();
  if (!button || button.dataset.bound === "true") {
    return;
  }
  button.dataset.bound = "true";
  updateExportButtonUi(false);
  button.addEventListener("click", () => {
    if (isExportRecording()) {
      stopExportRecording();
      return;
    }
    if (recorderState.isArmed) {
      disarmExportRecording();
      setExportStateLabel("Idle");
      setExportStatus("Auto record is off.");
      return;
    }
    recorderState.isArmed = true;
    updateExportButtonUi(false);
    setExportStateLabel("Armed");
    setExportStatus("Auto record is armed. Playback will start capture automatically.");
    statusNode.textContent = "Auto record armed. Press play to begin export.";
    void syncExportRecordingLifecycle();
  });
}

function syncExportAvailability(): void {
  if (isExportRecording() || recorderState.isArmed) {
    updateExportButtonUi(isExportRecording());
    return;
  }
  if (hasLoadedFileSource()) {
    setExportStateLabel("Idle");
    setExportStatus("Auto record is ready. Playback will trigger export automatically.");
  } else {
    setExportStateLabel("Unavailable");
    setExportStatus("Auto record is available only in File mode after a song has been loaded.");
  }
  updateExportButtonUi(false);
}

async function syncExportRecordingLifecycle(): Promise<void> {
  if (!hasLoadedFileSource()) {
    if (isExportRecording()) {
      stopExportRecording();
    } else if (recorderState.isArmed) {
      disarmExportRecording();
      setExportStateLabel("Unavailable");
      setExportStatus("Auto record is available only in File mode after a song has been loaded.");
    }
    return;
  }

  const isPlaying = !audio.paused && !audio.ended;
  if (recorderState.isArmed && isPlaying) {
    await startExportRecording();
    return;
  }

  if (isExportRecording()) {
    await syncExportAudioPlayback();
    if (!isPlaying) {
      stopExportRecording();
    }
  }
}

export {
  bindExportRecorder,
  isExportRecording,
  stopExportRecording,
  syncExportRecordingLifecycle,
  syncExportAvailability,
  syncExportFrame,
};
