# Architecture Overview

SeeSound is split into a browser visualizer and an optional macOS companion. The browser app owns interaction, audio analysis, rendering, and presentation. The companion is only needed for the `Desktop App` source mode.

## Browser App Layers

```mermaid
flowchart TB
  UI["<b>Interaction Layer</b><br/>Controls / audio element / user input<br/><br/><span style='font-size:11px;color:#666'>code: ui/ + index.html</span>"]

  APP["<b>Application State</b><br/>Settings / playback state / render preferences<br/><br/><span style='font-size:11px;color:#666'>code: state/</span>"]

  FIELD["<b>Field Model</b><br/>Spatial modes / geometry masks / cached atlases<br/><br/><span style='font-size:11px;color:#666'>code: core/geometry.ts + state/render-resources.ts</span>"]

  FRAME["<b>Frame Preparation</b><br/>Audio analysis / mode dynamics / frame context<br/><br/><span style='font-size:11px;color:#666'>code: core/runtime.ts + render/frame-state.ts</span>"]

  PLAN["<b>Render Planning</b><br/>Capability rules / backend selection / legacy presenter selection<br/><br/><span style='font-size:11px;color:#666'>code: render/planner.ts + render/renderer.ts</span>"]

  WGPU["<b>WebGPU Pipeline</b><br/>Full GPU render path<br/><br/><span style='font-size:11px;color:#666'>code: render/webgpu.ts</span>"]

  LEGACY["<b>Legacy Pipeline</b><br/>Field accumulation / readback / postprocess<br/><br/><span style='font-size:11px;color:#666'>code: render/backends/legacy-backend.ts + render/gpu.ts</span>"]

  CPU["<b>CPU Presenter</b><br/>CPU shade / 2D composite<br/><br/><span style='font-size:11px;color:#666'>code: render/presenters/cpu-presenter.ts + render/draw-helpers.ts</span>"]

  WEBGL["<b>WebGL Presenter</b><br/>Legacy direct GPU presentation<br/><br/><span style='font-size:11px;color:#666'>code: render/presenters/webgl-presenter.ts</span>"]

  OUT["<b>Canvas Output</b><br/>preview / previewGl / previewWgpu<br/><br/><span style='font-size:11px;color:#666'>code: state/render-resources.ts</span>"]

  UI --> APP
  APP --> FRAME
  FIELD --> FRAME
  FRAME --> PLAN

  PLAN -->|Preferred and supported| WGPU
  PLAN -->|Fallback| LEGACY

  LEGACY --> CPU
  LEGACY --> WEBGL

  WGPU --> OUT
  CPU --> OUT
  WEBGL --> OUT
```

## Audio Input Paths

- `File`: local browser playback through `HTMLAudioElement`, `AudioContext`, and `AnalyserNode`.
- `Browser Tab`: `getDisplayMedia({ audio: true, video: true })` feeds a `MediaStreamAudioSourceNode`.
- `Desktop App`: the macOS companion captures system audio with `ScreenCaptureKit`, streams PCM over localhost WebSocket, and the browser feeds that data into an `AudioWorklet`.

`File` remains the lowest-latency baseline. Desktop audio is useful, but it has unavoidable capture and bridge stages.

## Current Public Surface

The public web app should expose realtime visualization only. Video export is disabled in the UI until the output quality is good enough to ship.
