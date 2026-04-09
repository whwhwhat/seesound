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

function updateExportButtonUi(isRecording: boolean): void {
  const button = getExportToggleButton();
  if (!button) {
    return;
  }
  const fileModeReady = hasLoadedFileSource();
  button.textContent = isRecording ? "Stop Recording" : "Start Recording";
  button.classList.toggle("is-live", isRecording);
  button.setAttribute("aria-pressed", String(isRecording));
  button.disabled = !isRecording && !fileModeReady;
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

function getAudioTrack(): MediaStreamTrack | null {
  if (!hasLoadedFileSource()) {
    return null;
  }
  const capturableAudio = audio as HTMLAudioElement & {
    captureStream?: () => MediaStream;
    webkitCaptureStream?: () => MediaStream;
  };
  let stream: MediaStream | null = null;
  if (typeof capturableAudio.captureStream === "function") {
    stream = capturableAudio.captureStream();
  } else {
    if (typeof capturableAudio.webkitCaptureStream === "function") {
      stream = capturableAudio.webkitCaptureStream();
    }
  }
  return stream?.getAudioTracks()[0] ?? null;
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
  recorderState.stream = null;
  recorderState.recorder = null;
  recorderState.chunks = [];
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
  const audioTrack = getAudioTrack();
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
    setExportStatus("Recording saved as WebM. The stage was exported as a centered 1920 x 1080 scene.");
    statusNode.textContent = "Recording finished and downloaded.";
  };

  recorder.onerror = () => {
    cleanupRecorder();
    setExportStatus("Recording failed before export could finish.");
    statusNode.textContent = "Recording failed.";
  };

  recorder.start(1000);
  updateExportButtonUi(true);
  setExportStatus("Recording 1920 x 1080 video with the stage centered and song audio included.");
  statusNode.textContent = "Recording export video…";

  if (state.activeAudioSource === "file" && audio.paused && !audio.ended) {
    try {
      await audio.play();
    } catch {
      setExportStatus("Recording started, but playback is still paused. Press play when you are ready.");
    }
  }
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
    void startExportRecording();
  });
}

function syncExportAvailability(): void {
  if (isExportRecording()) {
    return;
  }
  if (hasLoadedFileSource()) {
    setExportStatus("Export a clean 1920 x 1080 video with the stage centered.");
  } else {
    setExportStatus("Export is available only in File mode after a song has been loaded.");
  }
  updateExportButtonUi(false);
}

export {
  bindExportRecorder,
  isExportRecording,
  stopExportRecording,
  syncExportAvailability,
  syncExportFrame,
};
